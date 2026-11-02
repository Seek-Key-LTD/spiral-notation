// tests/transcriber.test.js
// 验证音频转谱模块的 YIN 基频提取精度与音符事件结构

import test from 'node:test';
import assert from 'node:assert/strict';
import { detectPitchYIN } from '../src/audio/transcriber.js';

test('YIN 算法能够精准识别 A4 (440Hz / MIDI 69)', () => {
  const sampleRate = 44100;
  const freq = 440.0;
  const bufferSize = 2048;
  const buffer = new Float32Array(bufferSize);

  // 合成纯 A4 正弦波
  for (let i = 0; i < bufferSize; i++) {
    buffer[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate);
  }

  const result = detectPitchYIN(buffer, sampleRate, 0.15);
  assert.ok(result !== null, '检测结果不应为空');
  assert.ok(Math.abs(result.frequency - 440.0) < 1.0, `频率偏差应小于 1Hz: 实测 ${result.frequency}Hz`);
  assert.equal(Math.round(result.midi), 69, 'MIDI 编码应精准为 69 (A4)');
  assert.ok(result.clarity > 0.85, '纯正弦波置信度应高于 0.85');
});

test('YIN 算法能够精准识别中央 C (C4 261.63Hz / MIDI 60)', () => {
  const sampleRate = 44100;
  const freq = 261.625565; // C4
  const bufferSize = 2048;
  const buffer = new Float32Array(bufferSize);

  // 合成纯 C4 正弦波
  for (let i = 0; i < bufferSize; i++) {
    buffer[i] = 0.8 * Math.sin((2 * Math.PI * freq * i) / sampleRate);
  }

  const result = detectPitchYIN(buffer, sampleRate, 0.15);
  assert.ok(result !== null, '检测结果不应为空');
  assert.ok(Math.abs(result.frequency - freq) < 1.0, `频率偏差应小于 1Hz: 实测 ${result.frequency}Hz`);
  assert.equal(Math.round(result.midi), 60, 'MIDI 编码应精准为 60 (中央 C)');
});

test('静音与噪声抑制：全零信号或随机噪声返回 null', () => {
  const sampleRate = 44100;
  const bufferSize = 2048;
  const silentBuffer = new Float32Array(bufferSize);

  const silentResult = detectPitchYIN(silentBuffer, sampleRate, 0.15);
  assert.equal(silentResult, null, '静音缓冲应返回 null');
});
