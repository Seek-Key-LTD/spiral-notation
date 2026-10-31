import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SEMITONE_ANGLE, angleBetween, angleToSemitone, archimedeanRadius, directedSemitones,
  isPitchAngle, intervalSemitones, logarithmicRadius, midiToSpiral, pitchClass, rotateCell,
  semitoneToAngle, transposeAngle
} from '../src/core/pitch.js';

test('12 半音 = 360°，每半音 30°', () => {
  assert.equal(SEMITONE_ANGLE, 30);
  assert.equal(semitoneToAngle(0), 0);
  assert.equal(semitoneToAngle(6), 180);
  assert.equal(semitoneToAngle(12), 0);
  assert.equal(semitoneToAngle(-1), 330);
});

test('地支锚点：子=C=0°，卯=D#=90°，未=G=210°', () => {
  assert.equal(semitoneToAngle(0), 0);
  assert.equal(semitoneToAngle(3), 90);
  assert.equal(semitoneToAngle(7), 210);
});

test('45° 不是合法音位', () => {
  assert.equal(angleToSemitone(45), 1.5);
  assert.equal(isPitchAngle(45), false);
  assert.equal(isPitchAngle(30), true);
});

test('角距取劣弧，七度以上折叠成转位', () => {
  assert.equal(angleBetween(0, 120), 120);
  assert.equal(angleBetween(0, 240), 120);
  assert.equal(angleBetween(330, 30), 60);
  assert.equal(intervalSemitones(0, 210), 5);
  assert.equal(intervalSemitones(0, 150), 5);
});

test('有向音程保留方向，五度与四度可分', () => {
  assert.equal(directedSemitones(0, 210), 7);
  assert.equal(directedSemitones(0, 150), 5);
  assert.equal(directedSemitones(330, 30), 2);
});

test('移调 = 旋转，音程结构不变', () => {
  const cell = [0, 120, 210];
  for (const t of [1, 4, 7, 11]) {
    const rotated = rotateCell(cell, t);
    assert.equal(intervalSemitones(rotated[0], rotated[1]), intervalSemitones(cell[0], cell[1]));
    assert.equal(intervalSemitones(rotated[1], rotated[2]), intervalSemitones(cell[1], cell[2]));
  }
  assert.equal(transposeAngle(330, 4), 90);
});

test('两种历史螺旋在同一 θ 上给出不同的半径规则', () => {
  assert.equal(logarithmicRadius(0), 20);
  assert.equal(archimedeanRadius(0), 40);
  const theta = Math.PI * 2;
  assert.ok(Math.abs(logarithmicRadius(theta) - 20 * Math.exp(0.12 * theta)) < 1e-9);
  assert.ok(Math.abs(archimedeanRadius(theta) - (40 + 78)) < 1e-9);
});

test('midiToSpiral 与 spiral-engine 的 freqToSpiral 对齐', () => {
  assert.equal(pitchClass(60), 0);
  assert.equal(pitchClass(69), 9);

  const c4 = midiToSpiral(60);
  assert.deepEqual([c4.pitch_class, c4.angle, c4.octave], [0, 0, 0]);

  const a4 = midiToSpiral(69);
  assert.equal(a4.angle, 270);
  assert.equal(a4.octave, 0);

  const c5 = midiToSpiral(72);
  assert.equal(c5.angle, 0);
  assert.equal(c5.octave, 1);
  assert.ok(Math.abs(c5.theta - Math.PI * 2) < 1e-12);

  const b3 = midiToSpiral(59);
  assert.equal(b3.octave, -1);
  assert.equal(b3.angle, 330);
});
