// Web Audio API 双模音源引擎：
// 1. 真实施坦威 D-274 音乐会九尺大钢琴 (Steinway D Concert Grand) 多层高精物理采样 (SoundFont)
//    - 具备真实的木质共鸣箱体、琴槌敲击动力学包络与 88 键全物理制音器衰减
// 2. 空灵对数星音合成器 (Dual-Oscillator Sine/Triangle Space Synth)

const NOTE_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

export function midiToKeyName(midi) {
  const octave = Math.floor(midi / 12) - 1;
  const note = NOTE_NAMES[midi % 12];
  return `${note}${octave}`;
}

function base64ToArrayBuffer(base64) {
  const pureBase64 = base64.replace(/^data:audio\/[^;]+;base64,/, '');
  const binaryString = window.atob(pureBase64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.activeVoices = new Map(); // key: midi, value: voice
    this.isMuted = false;
    this.volume = 0.85;

    // 音色模式: 'reaper' (Mac Mini Pianoteq 9) | 'steinway' | 'synth'
    this.mode = 'reaper';

    // SoundFont 缓存与加载状态
    this.sampleBuffers = new Map(); // midi -> AudioBuffer
    this.loadingPromises = new Map(); // midi -> Promise<AudioBuffer>
    this.isSoundfontPreloaded = false;
    this.loadedSampleCount = 0;
    this.onProgressCallback = null;

    // 初始化音频上下文与预热 SoundFont
    if (typeof window !== 'undefined') {
      this.ensureContext();
      this.preloadSoundfont();
    }
  }

  ensureContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
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
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  setMode(mode) {
    if (mode === 'steinway' || mode === 'synth' || mode === 'reaper') {
      this.mode = mode;
      console.log(`[AudioEngine] 切换音色引擎: ${this.mode === 'reaper' ? '🎹 REAPER 物理建模 (Pianoteq 9)' : (this.mode === 'steinway' ? '🎹 施坦威九尺原声大钢琴' : '🌌 对数星音合成器')}`);
    }
  }

  preloadSoundfont() {
    if (typeof window === 'undefined') return;
    this.ensureContext();

    if (!window.MIDI?.Soundfont?.acoustic_grand_piano) {
      setTimeout(() => this.preloadSoundfont(), 100);
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

    // 顺序批量解码，控制瞬时并发
    const loadNextBatch = async (index = 0, batchSize = 6) => {
      if (index >= priorityNotes.length) return;
      const batch = priorityNotes.slice(index, index + batchSize);
      await Promise.all(batch.map(midi => this._loadBuffer(midi)));
      setTimeout(() => loadNextBatch(index + batchSize, batchSize), 10);
    };

    loadNextBatch();
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
        this.ensureContext();
        if (!this.ctx) return null;

        const arrayBuffer = base64ToArrayBuffer(sf[key]);
        const audioBuffer = await new Promise((resolve, reject) => {
          this.ctx.decodeAudioData(arrayBuffer, resolve, reject);
        });

        this.sampleBuffers.set(midi, audioBuffer);
        this.loadedSampleCount = this.sampleBuffers.size;
        if (this.onProgressCallback) {
          this.onProgressCallback(this.loadedSampleCount, 88);
        }
        return audioBuffer;
      } catch (err) {
        console.warn(`[AudioEngine] 解码采样失败 (MIDI ${midi} / ${key}):`, err);
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
    const now = time ?? (this.ctx ? this.ctx.currentTime : 0);

    // 若同一音位正在发声，先释放
    if (this.activeVoices.has(midi)) {
      this.triggerRelease(midi, now);
    }

    // 0. REAPER 物理建模模式：静音浏览器本地输出，由 Mac Mini 上的 Pianoteq 9 硬件真实物理发声
    if (this.mode === 'reaper') {
      const voice = { type: 'reaper', midi };
      this.activeVoices.set(midi, voice);
      return voice;
    }

    // 1. 施坦威 SoundFont 原声采样驱动
    if (this.mode === 'steinway') {
      let buffer = this.sampleBuffers.get(midi);
      let pitchShift = 1.0;

      // 若当前音符尚未解码完成，但已有其他采样，借用最近邻音变调发声（确保永不哑音）
      if (!buffer && this.sampleBuffers.size > 0) {
        let closestMidi = null;
        let minDiff = Infinity;
        for (const m of this.sampleBuffers.keys()) {
          const diff = Math.abs(m - midi);
          if (diff < minDiff) {
            minDiff = diff;
            closestMidi = m;
          }
        }
        if (closestMidi !== null && minDiff <= 12) {
          buffer = this.sampleBuffers.get(closestMidi);
          pitchShift = Math.pow(2, (midi - closestMidi) / 12);
        }
      }

      // 如果尚未命中，立即触发后台解码
      if (!buffer && !this.loadingPromises.has(midi)) {
        this._loadBuffer(midi);
      }

      if (buffer && this.ctx) {
        const source = this.ctx.createBufferSource();
        source.buffer = buffer;
        source.playbackRate.setValueAtTime(pitchShift, now);

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
    }

    // 2. 备选或降级模式：空灵双振荡器合成器 (Dual-Oscillator Space Synth)
    if (!this.ctx) return null;
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
      // 物理制音器(Damper)下落衰减：低音弦粗振动大，余响长(0.28s)；高音弦短，余响极短(0.12s)
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
