// MIDI 播放与时钟同步调度器
// 采用 Web Audio currentTime 作为高精度主时钟，杜绝定时器累积误差

import { AudioEngine } from './synth.js';

export class MidiPlayer {
  constructor() {
    this.audio = new AudioEngine();
    this.midiData = null;
    this.notesList = []; // Flattened and sorted array of all note events
    this.duration = 0;
    this.playbackTime = 0; // seconds
    this.startAudioTime = 0;
    this.startPlaybackOffset = 0;
    this.isPlaying = false;
    this.playbackRate = 1.0;
    this.activeVisualNotes = []; // notes sounding right now

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
      for (const note of track.notes) {
        const item = {
          midi: note.midi,
          time: note.time,
          duration: note.duration,
          velocity: note.velocity ?? 0.8,
          name: note.name,
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

    if (this.onProgress) {
      this.onProgress(0, this.duration);
    }
  }

  play() {
    if (!this.midiData || this.isPlaying) return;
    const ctx = this.audio.ensureContext();

    this.isPlaying = true;
    this.startAudioTime = ctx.currentTime;
    this.startPlaybackOffset = this.playbackTime;

    // 重置未播放笔记状态
    this.notesList.forEach(n => {
      n.triggered = n.time < this.playbackTime;
      n.released = (n.time + n.duration) <= this.playbackTime;
    });

    if (this.onStateChange) this.onStateChange(true);
    this._tick();
  }

  pause() {
    if (!this.isPlaying) return;
    this.isPlaying = false;
    this.audio.stopAll();
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
    this.notesList.forEach(n => {
      n.triggered = n.time < this.playbackTime;
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

    this.notesList.forEach(note => {
      // 触发 Note On
      if (!note.triggered && note.time <= cur + lookahead) {
        note.triggered = true;
        this.audio.triggerAttack(note.midi, note.velocity);
        this.activeVisualNotes.push(note);
        if (this.onNoteTrigger) this.onNoteTrigger(note);
      }

      // 触发 Note Off
      if (note.triggered && !note.released && (note.time + note.duration) <= cur) {
        note.released = true;
        this.audio.triggerRelease(note.midi);
        const idx = this.activeVisualNotes.indexOf(note);
        if (idx !== -1) {
          this.activeVisualNotes.splice(idx, 1);
        }
        if (this.onNoteRelease) this.onNoteRelease(note);
      }
    });

    if (this.onProgress) {
      this.onProgress(this.playbackTime, this.duration);
    }

    this._rafId = requestAnimationFrame(this._tick);
  };
}
