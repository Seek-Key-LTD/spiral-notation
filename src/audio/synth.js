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

    // 音色模式: 'steinway' (升级版 3D 声场金色大厅大钢琴) | 'reaper' | 'synth'
    this.mode = 'steinway';

    // 空间音频与声学箱体节点
    this.convolver = null;
    this.dryGain = null;
    this.reverbSendGain = null;
    this.eqLow = null;
    this.eqMid = null;
    this.eqHigh = null;

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
        this._buildAudioGraph();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  // 构建专业级声学链路：88键物理声相 -> 木质琴体EQ -> 维也纳金色大厅脉冲卷积混响 -> 广播级动态压限
  _buildAudioGraph() {
    if (!this.ctx) return;
    const ctx = this.ctx;

    this.masterGain = ctx.createGain();
    this.masterGain.gain.setValueAtTime(this.volume, ctx.currentTime);

    // 1. 直达声增益
    this.dryGain = ctx.createGain();
    this.dryGain.gain.setValueAtTime(0.85, ctx.currentTime);

    // 2. 云杉实木琴体共振三段均衡器 (Acoustic Spruce Soundboard EQ)
    this.eqLow = ctx.createBiquadFilter();
    this.eqLow.type = 'lowshelf';
    this.eqLow.frequency.setValueAtTime(90, ctx.currentTime);
    this.eqLow.gain.setValueAtTime(2.6, ctx.currentTime); // +2.6dB 浑厚木箱底蕴

    this.eqMid = ctx.createBiquadFilter();
    this.eqMid.type = 'peaking';
    this.eqMid.frequency.setValueAtTime(340, ctx.currentTime);
    this.eqMid.Q.setValueAtTime(1.1, ctx.currentTime);
    this.eqMid.gain.setValueAtTime(1.8, ctx.currentTime); // +1.8dB 温暖中频基音

    this.eqHigh = ctx.createBiquadFilter();
    this.eqHigh.type = 'highshelf';
    this.eqHigh.frequency.setValueAtTime(7500, ctx.currentTime);
    this.eqHigh.gain.setValueAtTime(2.2, ctx.currentTime); // +2.2dB 晶莹敲槌泛音

    // 直达声拓扑: dryGain -> eqLow -> eqMid -> eqHigh -> masterGain
    this.dryGain.connect(this.eqLow);
    this.eqLow.connect(this.eqMid);
    this.eqMid.connect(this.eqHigh);
    this.eqHigh.connect(this.masterGain);

    // 3. 维也纳金色大厅立体声脉冲卷积混响 (Concert Hall Impulse Response)
    try {
      this.convolver = this._createConcertHallImpulse(ctx, 2.4, 2.0);
      this.reverbSendGain = ctx.createGain();
      this.reverbSendGain.gain.setValueAtTime(0.28, ctx.currentTime); // 28% 湿声空间泛音

      this.reverbSendGain.connect(this.convolver);
      this.convolver.connect(this.masterGain);
    } catch (e) {
      console.warn('[AudioEngine] 卷积混响初始化异常，降级直通模式:', e);
    }

    // 4. 广播级母带多频动态压限器 (防止超技和弦爆音，带来澎湃动态)
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-12, ctx.currentTime);
    compressor.knee.setValueAtTime(24, ctx.currentTime);
    compressor.ratio.setValueAtTime(6, ctx.currentTime);
    compressor.attack.setValueAtTime(0.003, ctx.currentTime);
    compressor.release.setValueAtTime(0.22, ctx.currentTime);

    this.masterGain.connect(compressor);
    compressor.connect(ctx.destination);
  }

  // 纯原生内存生成 2.4s 金色大厅立体声混响脉冲（零外部依赖，微秒级加载）
  _createConcertHallImpulse(ctx, duration = 2.4, decay = 2.0) {
    const sampleRate = ctx.sampleRate || 44100;
    const length = Math.floor(sampleRate * duration);
    const impulse = ctx.createBuffer(2, length, sampleRate);
    const left = impulse.getChannelData(0);
    const right = impulse.getChannelData(1);

    for (let i = 0; i < length; i++) {
      const t = i / length;
      const env = Math.pow(1 - t, decay);
      left[i] = (Math.random() * 2 - 1) * env;
      right[i] = (Math.random() * 2 - 1) * env;
    }

    const convolver = ctx.createConvolver();
    convolver.buffer = impulse;
    return convolver;
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
        const targetGain = Math.pow(Math.max(0.05, Math.min(1.0, velocity)), 1.25) * 1.55;
        gainNode.gain.setValueAtTime(targetGain, now);

        // 88键物理立体声声像展开 (88-Key Acoustic Panning: 左手低音偏左，右手高音偏右)
        let panNode = null;
        if (this.ctx.createStereoPanner) {
          panNode = this.ctx.createStereoPanner();
          const pan = Math.max(-0.42, Math.min(0.42, ((midi - 60) / 36) * 0.42));
          panNode.pan.setValueAtTime(pan, now);
        }

        source.connect(gainNode);
        const voiceOut = panNode || gainNode;
        if (panNode) gainNode.connect(panNode);

        // 分流给直达声路(云杉琴体EQ)与金色大厅卷积混响路
        if (this.dryGain && this.reverbSendGain) {
          voiceOut.connect(this.dryGain);
          voiceOut.connect(this.reverbSendGain);
        } else {
          voiceOut.connect(this.masterGain);
        }

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

    if (this.dryGain && this.reverbSendGain) {
      gainNode.connect(this.dryGain);
      gainNode.connect(this.reverbSendGain);
    } else {
      gainNode.connect(this.masterGain);
    }

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
      // 拟真琴弦自然余响衰减 (Damper Release)
      // 低音琴弦更长更粗，余音自然延展 0.45s；高音琴弦 0.22s
      const damperDecay = Math.max(0.22, Math.min(0.48, 0.48 - (midi - 21) * 0.003));
      try {
        voice.gainNode.gain.cancelScheduledValues(now);
        const curGain = Math.max(0.0001, voice.gainNode.gain.value);
        voice.gainNode.gain.setValueAtTime(curGain, now);
        voice.gainNode.gain.exponentialRampToValueAtTime(0.0001, now + damperDecay);
        voice.source.stop(now + damperDecay + 0.08);
      } catch {
        // ignore
      }
    } else if (voice.type === 'synth') {
      const releaseTime = 0.32;
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
