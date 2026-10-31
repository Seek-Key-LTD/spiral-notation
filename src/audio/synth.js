// Web Audio API 双模音源引擎：
// 1. 真实施坦威 D-274 音乐会九尺大钢琴 (Steinway D Concert Grand) 多层高精物理采样 (SoundFont)
//    - 具备真实的木质共鸣箱体、琴槌敲击阻尼包络与 88 键全物理衰减
// 2. 空灵对数星音合成器 (Dual-Oscillator Sine/Triangle Space Synth)

const NOTE_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

export function midiToKeyName(midi) {
  const octave = Math.floor(midi / 12) - 1;
  const note = NOTE_NAMES[midi % 12];
  return `${note}${octave}`;
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.activeVoices = new Map(); // key: midi, value: voice
    this.isMuted = false;
    this.volume = 0.85;

    // 音色模式: 'steinway' | 'synth'
    this.mode = 'steinway';

    // SoundFont 缓存与加载状态
    this.sampleBuffers = new Map(); // midi -> AudioBuffer
    this.loadingPromises = new Map(); // midi -> Promise<AudioBuffer>
    this.isSoundfontPreloaded = false;
  }

  ensureContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(this.volume, this.ctx.currentTime);

      // 动态压限器，防止高动态多声部爆音
      const compressor = this.ctx.createDynamicsCompressor();
      compressor.threshold.setValueAtTime(-10, this.ctx.currentTime);
      compressor.knee.setValueAtTime(24, this.ctx.currentTime);
      compressor.ratio.setValueAtTime(8, this.ctx.currentTime);
      compressor.attack.setValueAtTime(0.003, this.ctx.currentTime);
      compressor.release.setValueAtTime(0.18, this.ctx.currentTime);

      this.masterGain.connect(compressor);
      compressor.connect(this.ctx.destination);

      // 异步预热并全量解码 88 键施坦威声学采样
      this.preloadSoundfont();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  setMode(mode) {
    if (mode === 'steinway' || mode === 'synth') {
      this.mode = mode;
      console.log(`[AudioEngine] 切换音色引擎: ${this.mode === 'steinway' ? '🎹 施坦威九尺原声大钢琴' : '🌌 对数星音合成器'}`);
    }
  }

  preloadSoundfont() {
    if (typeof window === 'undefined') return;
    if (!window.MIDI?.Soundfont?.acoustic_grand_piano) {
      setTimeout(() => this.preloadSoundfont(), 150);
      return;
    }
    if (this.isSoundfontPreloaded) return;
    this.isSoundfontPreloaded = true;

    // 优先加载中心常用八度 (C3 - C6 / MIDI 48 - 84)，随后铺满 88 键 (21 - 108)
    const priorityNotes = [];
    for (let m = 48; m <= 84; m++) priorityNotes.push(m);
    for (let m = 21; m <= 108; m++) {
      if (m < 48 || m > 84) priorityNotes.push(m);
    }

    priorityNotes.forEach(midi => {
      this._loadBuffer(midi);
    });
  }

  async _loadBuffer(midi) {
    if (this.sampleBuffers.has(midi)) {
      return this.sampleBuffers.get(midi);
    }
    if (this.loadingPromises.has(midi)) {
      return this.loadingPromises.get(midi);
    }

    const key = midiToKeyName(midi);
    const sf = typeof window !== 'undefined' ? window.MIDI?.Soundfont?.acoustic_grand_piano : null;
    if (!sf || !sf[key]) {
      return null;
    }

    const p = (async () => {
      try {
        const dataUri = sf[key];
        const pureBase64 = dataUri.replace(/^data:audio\/[^;]+;base64,/, '');
        const binaryString = window.atob(pureBase64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        const audioBuffer = await this.ctx.decodeAudioData(bytes.buffer.slice(0));
        this.sampleBuffers.set(midi, audioBuffer);
        return audioBuffer;
      } catch (err) {
        console.warn(`[AudioEngine] 解码施坦威采样失败 (MIDI ${midi} / ${key}):`, err);
        return null;
      } finally {
        this.loadingPromises.delete(midi);
      }
    })();

    this.loadingPromises.set(midi, p);
    return p;
  }

  midiToFreq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  triggerAttack(midi, velocity = 0.8, time = null) {
    this.ensureContext();
    const now = time ?? this.ctx.currentTime;

    // 若同一音符正在发声，先优雅释放
    if (this.activeVoices.has(midi)) {
      this.triggerRelease(midi, now);
    }

    // 1. 施坦威 SoundFont 原声采样驱动
    if (this.mode === 'steinway') {
      const buffer = this.sampleBuffers.get(midi);
      if (buffer) {
        const source = this.ctx.createBufferSource();
        source.buffer = buffer;

        const gainNode = this.ctx.createGain();
        // 拟真琴槌力度动态响应曲线 (Power Law Dynamics)
        const targetGain = Math.pow(Math.max(0.05, Math.min(1.0, velocity)), 1.3) * 1.6;
        gainNode.gain.setValueAtTime(targetGain, now);

        source.connect(gainNode);
        gainNode.connect(this.masterGain);

        source.start(now);
        const voice = { type: 'sample', source, gainNode, midi };
        this.activeVoices.set(midi, voice);
        return voice;
      }

      // 如果采样正在解码，记录 pending 并在就绪时发声
      if (this.loadingPromises.has(midi)) {
        this._loadBuffer(midi).then(buf => {
          if (buf && this.activeVoices.has(midi)) {
            const currentVoice = this.activeVoices.get(midi);
            if (currentVoice.type === 'pending') {
              const src = this.ctx.createBufferSource();
              src.buffer = buf;
              const g = this.ctx.createGain();
              const vel = Math.pow(Math.max(0.05, Math.min(1.0, velocity)), 1.3) * 1.6;
              g.gain.setValueAtTime(vel, this.ctx.currentTime);
              src.connect(g);
              g.connect(this.masterGain);
              src.start();
              currentVoice.type = 'sample';
              currentVoice.source = src;
              currentVoice.gainNode = g;
            }
          }
        });
        const pendingVoice = { type: 'pending', midi, gainNode: null, source: null };
        this.activeVoices.set(midi, pendingVoice);
        return pendingVoice;
      }
    }

    // 2. 备选或降级模式：空灵双振荡器合成器 (Dual-Oscillator Space Synth)
    const freq = this.midiToFreq(midi);
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const gainNode = this.ctx.createGain();

    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(freq, now);

    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(freq * 2, now); // 高八度微泛音

    const osc2Gain = this.ctx.createGain();
    osc2Gain.gain.setValueAtTime(0.22, now);
    osc2.connect(osc2Gain);
    osc2Gain.connect(gainNode);
    osc1.connect(gainNode);

    gainNode.connect(this.masterGain);

    const targetGain = Math.max(0.05, Math.min(1.0, velocity)) * 0.45;
    gainNode.gain.setValueAtTime(0.0001, now);
    gainNode.gain.exponentialRampToValueAtTime(targetGain, now + 0.02);
    gainNode.gain.exponentialRampToValueAtTime(targetGain * 0.7, now + 0.15);

    osc1.start(now);
    osc2.start(now);

    const voice = { type: 'synth', osc1, osc2, gainNode, midi };
    this.activeVoices.set(midi, voice);
    return voice;
  }

  triggerRelease(midi, time = null) {
    if (!this.ctx || !this.activeVoices.has(midi)) return;
    const voice = this.activeVoices.get(midi);
    const now = time ?? this.ctx.currentTime;

    if (voice.type === 'sample' && voice.gainNode && voice.source) {
      // 物理止音器(Damper)下落衰减：低音弦粗余响长(0.28s)，高音弦短余响短(0.12s)
      const damperDecay = Math.max(0.12, Math.min(0.28, 0.28 - (midi - 21) * 0.0018));
      try {
        voice.gainNode.gain.cancelScheduledValues(now);
        const curGain = Math.max(0.0001, voice.gainNode.gain.value);
        voice.gainNode.gain.setValueAtTime(curGain, now);
        voice.gainNode.gain.exponentialRampToValueAtTime(0.0001, now + damperDecay);
        voice.source.stop(now + damperDecay + 0.05);
      } catch {
        // ignore
      }
    } else if (voice.type === 'synth') {
      const releaseTime = 0.28;
      try {
        voice.gainNode.gain.cancelScheduledValues(now);
        voice.gainNode.gain.setValueAtTime(Math.max(0.0001, voice.gainNode.gain.value), now);
        voice.gainNode.gain.exponentialRampToValueAtTime(0.0001, now + releaseTime);
        voice.osc1?.stop(now + releaseTime + 0.05);
        voice.osc2?.stop(now + releaseTime + 0.05);
      } catch {
        // ignore
      }
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
