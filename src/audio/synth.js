// Web Audio API 轻量级多音复音合成器
// 采用双振荡器（基波 Sine + 次谐波 Triangle）与 ADSR 柔和包络，呈现温润空灵的星音质感

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.activeVoices = new Map(); // key: midi, value: voice
    this.isMuted = false;
    this.volume = 0.8;
  }

  ensureContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(this.volume, this.ctx.currentTime);

      // 动态压限器，防止多音和弦爆音
      const compressor = this.ctx.createDynamicsCompressor();
      compressor.threshold.setValueAtTime(-12, this.ctx.currentTime);
      compressor.knee.setValueAtTime(20, this.ctx.currentTime);
      compressor.ratio.setValueAtTime(10, this.ctx.currentTime);
      compressor.attack.setValueAtTime(0.003, this.ctx.currentTime);
      compressor.release.setValueAtTime(0.2, this.ctx.currentTime);

      this.masterGain.connect(compressor);
      compressor.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  midiToFreq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  triggerAttack(midi, velocity = 0.8, time = null) {
    this.ensureContext();
    const now = time ?? this.ctx.currentTime;
    const freq = this.midiToFreq(midi);

    // 如果该音正在发声，先优雅释放
    if (this.activeVoices.has(midi)) {
      this.triggerRelease(midi, now);
    }

    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const gainNode = this.ctx.createGain();

    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(freq, now);

    // 次振荡器：轻微失谐与泛音增添空灵感
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(freq * 2, now); // 高八度微弱泛音

    const osc2Gain = this.ctx.createGain();
    osc2Gain.gain.setValueAtTime(0.25, now);
    osc2.connect(osc2Gain);
    osc2Gain.connect(gainNode);
    osc1.connect(gainNode);

    gainNode.connect(this.masterGain);

    // ADSR 包络
    const targetGain = Math.max(0.05, Math.min(1.0, velocity)) * 0.45;
    gainNode.gain.setValueAtTime(0.0001, now);
    gainNode.gain.exponentialRampToValueAtTime(targetGain, now + 0.02); // 20ms Attack
    gainNode.gain.exponentialRampToValueAtTime(targetGain * 0.7, now + 0.15); // Decay to Sustain

    osc1.start(now);
    osc2.start(now);

    const voice = { osc1, osc2, gainNode, stopTime: null };
    this.activeVoices.set(midi, voice);
    return voice;
  }

  triggerRelease(midi, time = null) {
    if (!this.ctx || !this.activeVoices.has(midi)) return;
    const voice = this.activeVoices.get(midi);
    const now = time ?? this.ctx.currentTime;
    const releaseTime = 0.28; // 280ms 自然余响

    try {
      voice.gainNode.gain.cancelScheduledValues(now);
      voice.gainNode.gain.setValueAtTime(Math.max(0.0001, voice.gainNode.gain.value), now);
      voice.gainNode.gain.exponentialRampToValueAtTime(0.0001, now + releaseTime);
      voice.osc1.stop(now + releaseTime + 0.05);
      voice.osc2.stop(now + releaseTime + 0.05);
    } catch {
      // ignore
    }

    this.activeVoices.delete(midi);
  }

  setVolume(vol) {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : this.volume, this.ctx.currentTime);
    }
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    this.setVolume(this.volume);
    return this.isMuted;
  }

  stopAll() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const [midi] of this.activeVoices) {
      this.triggerRelease(midi, now);
    }
    this.activeVoices.clear();
  }
}
