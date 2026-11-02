// 螺线谱音频转谱模块 (Audio-to-MIDI Transcriber & Realtime Pitch Tracker)
// 核心算法：高精度 YIN (Cumulative Mean Normalized Difference Function) + 抛物线亚采样插值 + 能量包络自适应分段
// 零外部依赖，纯 Web Audio API / PCM 离散数学，支持浏览器纯前端离线分析与实时麦克风捕获

import { midiToKeyName } from './synth.js';

/**
 * YIN 算法单帧基频提取
 * @param {Float32Array} buffer - PCM 信号单声道切片
 * @param {number} sampleRate - 采样率 (通常 44100 或 48000)
 * @param {number} threshold - 周期性容差阈值 (默认 0.15)
 * @returns {{ frequency: number, midi: number, clarity: number } | null}
 */
export function detectPitchYIN(buffer, sampleRate, threshold = 0.15) {
  const bufferSize = buffer.length;
  const halfBuffer = Math.floor(bufferSize / 2);
  const yinBuffer = new Float32Array(halfBuffer);

  // 1. 差分函数 Difference function
  for (let tau = 0; tau < halfBuffer; tau++) {
    let sum = 0;
    for (let i = 0; i < halfBuffer; i++) {
      const delta = buffer[i] - buffer[i + tau];
      sum += delta * delta;
    }
    yinBuffer[tau] = sum;
  }

  // 2. 累积均值归一化差分函数 (CMNDF)
  yinBuffer[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau < halfBuffer; tau++) {
    runningSum += yinBuffer[tau];
    yinBuffer[tau] = (yinBuffer[tau] * tau) / runningSum;
  }

  // 3. 绝对阈值搜索与局部最小值锁定
  let tauEstimate = -1;
  for (let tau = 2; tau < halfBuffer; tau++) {
    if (yinBuffer[tau] < threshold) {
      while (tau + 1 < halfBuffer && yinBuffer[tau + 1] < yinBuffer[tau]) {
        tau++;
      }
      tauEstimate = tau;
      break;
    }
  }

  // 若未达到阈值，寻找全局最小值 (对于微弱乐音容错)
  if (tauEstimate === -1) {
    let minTau = 2;
    let minVal = yinBuffer[2];
    for (let tau = 3; tau < halfBuffer; tau++) {
      if (yinBuffer[tau] < minVal) {
        minVal = yinBuffer[tau];
        minTau = tau;
      }
    }
    if (minVal < 0.35) {
      tauEstimate = minTau;
    } else {
      return null; // 非周期性信号/无声
    }
  }

  // 4. 抛物线亚采样插值 (Parabolic Interpolation)
  let betterTau = tauEstimate;
  const x0 = tauEstimate < 1 ? tauEstimate : tauEstimate - 1;
  const x2 = tauEstimate + 1 < halfBuffer ? tauEstimate + 1 : tauEstimate;
  if (x0 !== tauEstimate && x2 !== tauEstimate) {
    const s0 = yinBuffer[x0];
    const s1 = yinBuffer[tauEstimate];
    const s2 = yinBuffer[x2];
    const bottom = 2 * (2 * s1 - s2 - s0);
    if (bottom !== 0) {
      betterTau = tauEstimate + (s2 - s0) / bottom;
    }
  }

  const frequency = sampleRate / betterTau;

  // 频率范围过滤 (乐理可用范围: C1 ~32Hz 到 B7 ~3951Hz)
  if (frequency < 30 || frequency > 4200) {
    return null;
  }

  // 转换为连续 MIDI 音高值 (A4 440Hz = 69)
  const midiFloat = 69 + 12 * Math.log2(frequency / 440);
  const clarity = 1 - Math.min(1, yinBuffer[tauEstimate]);

  return {
    frequency,
    midi: midiFloat,
    clarity
  };
}

/**
 * 离线全曲音频转录器 (AudioBuffer ➔ 虚拟 Tone.js MIDI 对象)
 */
export class AudioTranscriber {
  constructor(options = {}) {
    this.frameSize = options.frameSize || 2048;
    this.hopSize = options.hopSize || 512;
    this.yinThreshold = options.yinThreshold || 0.15;
    this.minEnergy = options.minEnergy || 0.015; // 忽略静音底噪
    this.minDuration = options.minDuration || 0.08; // 最小音符时值 (秒)
  }

  /**
   * 将 AudioBuffer 解析为结构化 MIDI 音符事件队列
   * @param {AudioBuffer} audioBuffer
   * @param {function(number):void} onProgress - 进度百分比回调 0~100
   * @returns {Promise<object>} 兼容 @tonejs/midi 规范的对象
   */
  async transcribe(audioBuffer, onProgress = null) {
    const sampleRate = audioBuffer.sampleRate;
    const channels = audioBuffer.numberOfChannels;

    // 混音为单声道
    const length = audioBuffer.length;
    const mono = new Float32Array(length);
    if (channels === 1) {
      mono.set(audioBuffer.getChannelData(0));
    } else {
      const left = audioBuffer.getChannelData(0);
      const right = audioBuffer.getChannelData(1);
      for (let i = 0; i < length; i++) {
        mono[i] = (left[i] + right[i]) * 0.5;
      }
    }

    const totalFrames = Math.floor((length - this.frameSize) / this.hopSize);
    const frameBuffer = new Float32Array(this.frameSize);
    const rawPitches = [];

    // 逐帧扫描
    for (let f = 0; f < totalFrames; f++) {
      const start = f * this.hopSize;
      for (let j = 0; j < this.frameSize; j++) {
        frameBuffer[j] = mono[start + j];
      }

      // 计算 RMS 能量
      let sumSq = 0;
      for (let j = 0; j < this.frameSize; j++) {
        sumSq += frameBuffer[j] * frameBuffer[j];
      }
      const rms = Math.sqrt(sumSq / this.frameSize);
      const time = start / sampleRate;

      if (rms >= this.minEnergy) {
        const pitch = detectPitchYIN(frameBuffer, sampleRate, this.yinThreshold);
        if (pitch && pitch.clarity > 0.45) {
          rawPitches.push({
            time,
            midi: Math.round(pitch.midi),
            rawMidi: pitch.midi,
            clarity: pitch.clarity,
            rms
          });
        } else {
          rawPitches.push({ time, midi: null, rms });
        }
      } else {
        rawPitches.push({ time, midi: null, rms: 0 });
      }

      if (onProgress && f % 100 === 0) {
        onProgress(Math.floor((f / totalFrames) * 80));
      }
    }

    // 音符切片聚类 (Note Segmentation)
    const notes = [];
    let currentNote = null;

    for (let i = 0; i < rawPitches.length; i++) {
      const p = rawPitches[i];

      if (p.midi !== null) {
        if (!currentNote) {
          // 开始新音符
          currentNote = {
            midi: p.midi,
            startTime: p.time,
            endTime: p.time,
            rmsAcc: p.rms,
            count: 1
          };
        } else if (p.midi === currentNote.midi) {
          // 相同音高持续
          currentNote.endTime = p.time;
          currentNote.rmsAcc += p.rms;
          currentNote.count++;
        } else {
          // 音高发生改变：闭合前一个音符，开启新音符
          const duration = currentNote.endTime - currentNote.startTime;
          if (duration >= this.minDuration) {
            const vel = Math.min(1.0, Math.max(0.3, (currentNote.rmsAcc / currentNote.count) * 8));
            notes.push({
              midi: currentNote.midi,
              time: currentNote.startTime,
              duration: duration,
              velocity: parseFloat(vel.toFixed(2)),
              name: midiToKeyName(currentNote.midi)
            });
          }
          currentNote = {
            midi: p.midi,
            startTime: p.time,
            endTime: p.time,
            rmsAcc: p.rms,
            count: 1
          };
        }
      } else {
        // 静音/无声：闭合当前音符
        if (currentNote) {
          const duration = currentNote.endTime - currentNote.startTime;
          if (duration >= this.minDuration) {
            const vel = Math.min(1.0, Math.max(0.3, (currentNote.rmsAcc / currentNote.count) * 8));
            notes.push({
              midi: currentNote.midi,
              time: currentNote.startTime,
              duration: duration,
              velocity: parseFloat(vel.toFixed(2)),
              name: midiToKeyName(currentNote.midi)
            });
          }
          currentNote = null;
        }
      }
    }

    // 处理末尾残余音符
    if (currentNote) {
      const duration = currentNote.endTime - currentNote.startTime;
      if (duration >= this.minDuration) {
        const vel = Math.min(1.0, Math.max(0.3, (currentNote.rmsAcc / currentNote.count) * 8));
        notes.push({
          midi: currentNote.midi,
          time: currentNote.startTime,
          duration: duration,
          velocity: parseFloat(vel.toFixed(2)),
          name: midiToKeyName(currentNote.midi)
        });
      }
    }

    if (onProgress) onProgress(100);

    const totalDuration = audioBuffer.duration;

    // 拼装符合 Tone.js MIDI 规范的数据对象
    return {
      header: {
        name: 'Transcribed Lead Melody',
        tempos: [{ bpm: 120, time: 0 }]
      },
      tracks: [
        {
          name: 'Lead Melody Track (AI Transcribed)',
          channel: 0,
          instrument: { family: 'piano', number: 0 },
          notes: notes
        }
      ],
      duration: totalDuration
    };
  }
}

/**
 * 实时麦克风音高监听器 (Live Microphone Pitch Stream)
 * 用于将真实人声、哨音、器乐现场吹弹的声音瞬时映射至螺线谱
 */
export class RealtimeMicTracker {
  constructor(audioContext) {
    this.ctx = audioContext;
    this.mediaStream = null;
    this.sourceNode = null;
    this.analyser = null;
    this.buffer = null;
    this.isRunning = false;
    this._rafId = null;

    this.onPitch = null; // callback({ midi, frequency, clarity, rms, name })
    this.onStop = null;
  }

  async start() {
    if (this.isRunning) return;

    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      });
    } catch (err) {
      throw new Error(`麦克风权限获取失败: ${err.message}`);
    }

    this.sourceNode = this.ctx.createMediaStreamSource(this.mediaStream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.sourceNode.connect(this.analyser);

    this.buffer = new Float32Array(this.analyser.fftSize);
    this.isRunning = true;
    this._poll();
  }

  _poll() {
    if (!this.isRunning) return;

    this.analyser.getFloatTimeDomainData(this.buffer);

    // 计算当前 RMS
    let sumSq = 0;
    for (let i = 0; i < this.buffer.length; i++) {
      sumSq += this.buffer[i] * this.buffer[i];
    }
    const rms = Math.sqrt(sumSq / this.buffer.length);

    if (rms > 0.015) {
      const pitch = detectPitchYIN(this.buffer, this.ctx.sampleRate, 0.15);
      if (pitch && pitch.clarity > 0.45 && this.onPitch) {
        const roundedMidi = Math.round(pitch.midi);
        this.onPitch({
          midi: roundedMidi,
          rawMidi: pitch.midi,
          frequency: pitch.frequency,
          clarity: pitch.clarity,
          rms,
          name: midiToKeyName(roundedMidi)
        });
      }
    }

    this._rafId = requestAnimationFrame(() => this._poll());
  }

  stop() {
    this.isRunning = false;
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(t => t.stop());
      this.mediaStream = null;
    }
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    if (this.onStop) this.onStop();
  }
}
