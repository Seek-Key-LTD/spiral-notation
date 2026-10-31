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

    this.onNoteTrigger = null; // callback(noteEvent)
    this.onNoteRelease = null; // callback(noteEvent)
    this.onProgress = null;    // callback(currentTime, duration)
    this.onStateChange = null; // callback(isPlaying)

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

    // 根据当前时间对齐播放游标
    this._noteCursor = 0;
    while (this._noteCursor < this.notesList.length && this.notesList[this._noteCursor].time < this.playbackTime) {
      this._noteCursor++;
    }

    // 重置未播放笔记状态
    this.notesList.forEach((n, idx) => {
      n.triggered = idx < this._noteCursor;
      n.released = (n.time + n.duration) <= this.playbackTime;
    });

    if (this.onStateChange) this.onStateChange(true);
    this._tick();
  }

  pause() {
    if (!this.isPlaying) return;
    this.isPlaying = false;
    this.audio.stopAll();
    if (this.bridge?.enabled) this.bridge.sendAllOff();
    this.activeVisualNotes = [];

    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }

    if (this.onStateChange) this.onStateChange(false);
  }

  stop() {
    this.pause();
    this.playbackTime = 0;
    this._noteCursor = 0;
    this.notesList.forEach(n => {
      n.triggered = false;
      n.released = false;
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

    this.notesList.forEach((n, idx) => {
      n.triggered = idx < this._noteCursor;
      n.released = (n.time + n.duration) <= this.playbackTime;
    });

    if (this.onProgress) this.onProgress(this.playbackTime, this.duration);
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

    // 调度触发 Note On 与 Note Off
    const cur = this.playbackTime;
    const lookahead = 0.04 * this.playbackRate; // 40ms 提前量
    const cutoff = cur + lookahead;

    // 1. Note On: 从当前已排序游标单向快速推进，O(1) 复杂度，杜绝全谱扫描
    while (this._noteCursor < this.notesList.length) {
      const note = this.notesList[this._noteCursor];
      if (note.time > cutoff) {
        break; // 数组已按时间升序，后续音符必定未到时间，直接 break
      }
      if (!note.triggered) {
        note.triggered = true;
        this.audio.triggerAttack(note.midi, note.velocity);
        if (this.bridge?.enabled) {
          this.bridge.sendNoteOn(note.midi, note.velocity);
        }
        this.activeVisualNotes.push(note);
        if (this.onNoteTrigger) this.onNoteTrigger(note);
      }
      this._noteCursor++;
    }

    // 2. Note Off: 仅需检查正在发声的音符池 (仅 1~8 个活跃音符)，彻底淘汰扫描数千全谱笔记！
    for (let i = this.activeVisualNotes.length - 1; i >= 0; i--) {
      const note = this.activeVisualNotes[i];
      if ((note.time + note.duration) <= cur) {
        note.released = true;
        this.audio.triggerRelease(note.midi);
        if (this.bridge?.enabled) {
          this.bridge.sendNoteOff(note.midi);
        }
        this.activeVisualNotes.splice(i, 1);
        if (this.onNoteRelease) this.onNoteRelease(note);
      }
    }

    if (this.onProgress) {
      this.onProgress(this.playbackTime, this.duration);
    }

    this._rafId = requestAnimationFrame(this._tick);
  };
}
