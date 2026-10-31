// MIDI 播放与时钟同步调度器
// 采用 Web Audio currentTime 作为高精度主时钟，杜绝定时器累积误差

import { AudioEngine } from './synth.js';
import { GarageBandBridge } from './bridge-client.js';

export class MidiPlayer {
  constructor() {
    this.audio = new AudioEngine();
    this.bridge = new GarageBandBridge();
    this.midiData = null;
    this.notesList = []; // Flattened and sorted array of all note events
    this.duration = 0;
    this.playbackTime = 0; // seconds
    this.startAudioTime = 0;
    this.startPlaybackOffset = 0;
    this.isPlaying = false;
    this.playbackRate = 1.0;
    this.activeVisualNotes = []; // notes sounding right now
    this._noteCursor = 0;        // 高性能播放游标 (单调递增，杜绝 O(N) 全谱轮询)
    this.pedalEvents = [];       // CC 64 延音踏板事件队列
    this._pedalCursor = 0;
    this.isPedalDown = false;
    this.pedalSustainedNotes = new Set(); // 琴键已松但由踏板持续延音的音符集合

    this.onNoteTrigger = null; // callback(noteEvent)
    this.onNoteRelease = null; // callback(noteEvent)
    this.onProgress = null;    // callback(currentTime, duration)
    this.onStateChange = null; // callback(isPlaying)
    this.onPedalChange = null; // callback(isDown)

    this._rafId = null;
    this._scheduledVoices = new Set();
  }

  loadMidi(midi) {
    this.stop();
    this.midiData = midi;
    this.notesList = [];

    let maxEnd = 0;
    for (const track of midi.tracks) {
      const trackName = (track.name || '').toLowerCase();
      const isLeft = trackName.includes('left') || trackName.includes('links') || trackName.includes('bass');
      const isRight = trackName.includes('right') || trackName.includes('rechts') || trackName.includes('treble');

      for (const note of track.notes) {
        // 区分左右手: 优先根据音轨名称，若无则以中央 C (60) 为界
        let hand = 'right';
        if (isLeft) {
          hand = 'left';
        } else if (isRight) {
          hand = 'right';
        } else {
          hand = (note.midi < 60) ? 'left' : 'right';
        }

        const item = {
          midi: note.midi,
          time: note.time,
          duration: note.duration,
          velocity: note.velocity ?? 0.8,
          name: note.name,
          hand,
          triggered: false,
          released: false
        };
        this.notesList.push(item);
        if (item.time + item.duration > maxEnd) {
          maxEnd = item.time + item.duration;
        }
      }
    }

    // 按起始时间排序
    this.notesList.sort((a, b) => a.time - b.time);

    // 提取 CC 64 延音踏板事件 (Damper / Sustain Pedal)
    this.pedalEvents = [];
    if (midi.tracks) {
      for (const track of midi.tracks) {
        if (track.controlChanges && track.controlChanges[64]) {
          for (const cc of track.controlChanges[64]) {
            this.pedalEvents.push({
              time: cc.time,
              value: cc.value ?? 0
            });
            if (cc.time > maxEnd) {
              maxEnd = cc.time;
            }
          }
        }
      }
    }
    this.pedalEvents.sort((a, b) => a.time - b.time);
    this._pedalCursor = 0;
    this.isPedalDown = false;
    this.pedalSustainedNotes.clear();

    this.duration = Math.max(0.1, maxEnd);
    this.playbackTime = 0;
    this._noteCursor = 0;

    if (this.onProgress) {
      this.onProgress(0, this.duration);
    }
  }

  play() {
    if (!this.midiData || this.isPlaying) return;
    if (this.bridge && !this.bridge.isConnected) {
      this.bridge.init().catch(() => {});
    }
    const ctx = this.audio.ensureContext();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().then(() => {
        this.startAudioTime = ctx.currentTime;
      });
    }

    // 若开篇存在长于 0.5s 的死寂空白（如匈牙利狂想曲前 1.2s 纯休止），自动预滚到首音爆发前 0.12s
    if (this.playbackTime === 0 && this.notesList.length > 0 && this.notesList[0].time > 0.5) {
      this.playbackTime = Math.max(0, this.notesList[0].time - 0.12);
    }

    this.isPlaying = true;
    this.startAudioTime = ctx ? ctx.currentTime : 0;
    this.startPlaybackOffset = this.playbackTime;

    // 根据当前时间对齐音符游标
    this._noteCursor = 0;
    while (this._noteCursor < this.notesList.length && this.notesList[this._noteCursor].time < this.playbackTime) {
      this._noteCursor++;
    }

    // 对齐踏板游标与当前踏板状态
    this._pedalCursor = 0;
    this.isPedalDown = false;
    while (this._pedalCursor < this.pedalEvents.length && this.pedalEvents[this._pedalCursor].time <= this.playbackTime) {
      const pe = this.pedalEvents[this._pedalCursor];
      this.isPedalDown = (pe.value >= 0.5 || pe.value >= 64);
      this._pedalCursor++;
    }
    this.pedalSustainedNotes.clear();

    // 重置未播放笔记状态
    this.notesList.forEach((n, idx) => {
      n.triggered = idx < this._noteCursor;
      n.released = (n.time + n.duration) <= this.playbackTime;
      n.keyReleased = n.released;
      n.isPedalSustained = false;
    });

    if (this.onStateChange) this.onStateChange(true);
    if (this.onPedalChange) this.onPedalChange(this.isPedalDown);
    this._tick();
  }

  pause() {
    if (!this.isPlaying) return;
    this.isPlaying = false;
    this.audio.stopAll();
    if (this.bridge?.enabled) {
      this.bridge.sendAllOff();
      this.bridge.sendPedal?.(false);
    }
    this.activeVisualNotes = [];
    this.pedalSustainedNotes.clear();
    this.isPedalDown = false;

    if (this._rafId && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }

    if (this.onStateChange) this.onStateChange(false);
    if (this.onPedalChange) this.onPedalChange(false);
  }

  stop() {
    this.pause();
    this.playbackTime = 0;
    this._noteCursor = 0;
    this._pedalCursor = 0;
    this.isPedalDown = false;
    this.pedalSustainedNotes.clear();
    this.notesList.forEach(n => {
      n.triggered = false;
      n.released = false;
      n.keyReleased = false;
      n.isPedalSustained = false;
    });
    if (this.onProgress) this.onProgress(0, this.duration);
  }

  seek(seconds) {
    const wasPlaying = this.isPlaying;
    if (wasPlaying) this.pause();

    this.playbackTime = Math.max(0, Math.min(seconds, this.duration));
    this._noteCursor = 0;
    while (this._noteCursor < this.notesList.length && this.notesList[this._noteCursor].time < this.playbackTime) {
      this._noteCursor++;
    }

    // 重新对齐踏板状态
    this._pedalCursor = 0;
    this.isPedalDown = false;
    while (this._pedalCursor < this.pedalEvents.length && this.pedalEvents[this._pedalCursor].time <= this.playbackTime) {
      const pe = this.pedalEvents[this._pedalCursor];
      this.isPedalDown = (pe.value >= 0.5 || pe.value >= 64);
      this._pedalCursor++;
    }
    this.pedalSustainedNotes.clear();

    this.notesList.forEach((n, idx) => {
      n.triggered = idx < this._noteCursor;
      n.released = (n.time + n.duration) <= this.playbackTime;
      n.keyReleased = n.released;
      n.isPedalSustained = false;
    });

    if (this.onProgress) this.onProgress(this.playbackTime, this.duration);
    if (this.onPedalChange) this.onPedalChange(this.isPedalDown);
    if (wasPlaying) this.play();
  }

  setPlaybackRate(rate) {
    const wasPlaying = this.isPlaying;
    if (wasPlaying) {
      const current = this.playbackTime;
      this.pause();
      this.playbackRate = Math.max(0.25, Math.min(3.0, rate));
      this.seek(current);
      this.play();
    } else {
      this.playbackRate = Math.max(0.25, Math.min(3.0, rate));
    }
  }

  _releaseSingleNote(note, indexInActive = -1) {
    note.released = true;
    note.isPedalSustained = false;
    this.pedalSustainedNotes.delete(note);
    this.audio.triggerRelease(note.midi);
    if (this.bridge?.enabled) {
      this.bridge.sendNoteOff(note.midi);
    }
    const idx = (indexInActive !== -1) ? indexInActive : this.activeVisualNotes.indexOf(note);
    if (idx !== -1) {
      this.activeVisualNotes.splice(idx, 1);
    }
    if (this.onNoteRelease) this.onNoteRelease(note);
  }

  _releasePedalNotes() {
    if (this.pedalSustainedNotes.size === 0) return;
    const notesToRelease = Array.from(this.pedalSustainedNotes);
    for (const note of notesToRelease) {
      this._releaseSingleNote(note);
    }
    this.pedalSustainedNotes.clear();
  }

  _tick = () => {
    if (!this.isPlaying) return;

    const ctx = this.audio.ctx;
    const elapsedAudio = (ctx.currentTime - this.startAudioTime) * this.playbackRate;
    this.playbackTime = this.startPlaybackOffset + elapsedAudio;

    if (this.playbackTime >= this.duration) {
      this.playbackTime = this.duration;
      if (this.onProgress) this.onProgress(this.duration, this.duration);
      this.stop();
      return;
    }

    const cur = this.playbackTime;
    const lookahead = 0.04 * this.playbackRate; // 40ms 提前量
    const cutoff = cur + lookahead;

    // 0. 更新 CC 64 延音踏板状态
    while (this._pedalCursor < this.pedalEvents.length) {
      const pe = this.pedalEvents[this._pedalCursor];
      if (pe.time > cur) break;
      const wasDown = this.isPedalDown;
      this.isPedalDown = (pe.value >= 0.5 || pe.value >= 64);
      if (wasDown && !this.isPedalDown) {
        // 踏板抬起：物理制音器落下，琴弦余震立即进入 Damper 衰减
        this._releasePedalNotes();
      }
      if (this.bridge?.enabled && this.bridge.sendPedal) {
        this.bridge.sendPedal(this.isPedalDown);
      }
      if (this.onPedalChange) this.onPedalChange(this.isPedalDown);
      this._pedalCursor++;
    }

    // 1. Note On: 从当前已排序游标单向快速推进，O(1) 复杂度，杜绝全谱扫描
    while (this._noteCursor < this.notesList.length) {
      const note = this.notesList[this._noteCursor];
      if (note.time > cutoff) {
        break; // 数组已按时间升序，后续音符必定未到时间，直接 break
      }
      if (!note.triggered) {
        note.triggered = true;
        note.keyReleased = false;
        note.isPedalSustained = false;
        this.audio.triggerAttack(note.midi, note.velocity);
        if (this.bridge?.enabled) {
          this.bridge.sendNoteOn(note.midi, note.velocity);
        }
        this.activeVisualNotes.push(note);
        if (this.onNoteTrigger) this.onNoteTrigger(note);
      }
      this._noteCursor++;
    }

    // 2. Note Off: 检查正在发声的音符池
    for (let i = this.activeVisualNotes.length - 1; i >= 0; i--) {
      const note = this.activeVisualNotes[i];
      if ((note.time + note.duration) <= cur) {
        if (!note.keyReleased) {
          note.keyReleased = true; // 琴键已物理抬起
        }
        if (this.isPedalDown) {
          // 踏板踩着：制音器脱离琴弦，音符持续在空气中轰鸣共振！
          if (!this.pedalSustainedNotes.has(note)) {
            this.pedalSustainedNotes.add(note);
            note.isPedalSustained = true;
          }
          // 安全超时保护：单音在踏板下最多自然振动 12 秒，防止异常长踩导致复音堆积
          if (cur - note.time > 12) {
            this._releaseSingleNote(note, i);
          }
          continue;
        }
        // 无踏板踩下，立即触发琴弦制音衰减
        this._releaseSingleNote(note, i);
      }
    }

    if (this.onProgress) {
      this.onProgress(this.playbackTime, this.duration);
    }

    if (typeof requestAnimationFrame !== 'undefined') {
      this._rafId = requestAnimationFrame(this._tick);
    }
  };
}
