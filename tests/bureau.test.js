import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUREAUS, bureauOfAngle, bureauRotationSteps, isBureauRotation, rotateByBureau
} from '../src/core/bureau.js';
import { intervalSemitones } from '../src/core/pitch.js';

test('四个三合局各占 120°，合起来覆盖 12 地支', () => {
  const all = Object.values(BUREAUS).flat().sort((a, b) => a - b);
  assert.deepEqual(all, [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330]);
  const c = BUREAUS['申子辰'];
  assert.ok(isBureauRotation(c[0], c[1]));
  assert.ok(isBureauRotation(c[1], c[2]));
  assert.equal(intervalSemitones(c[0], c[1]), 4);
});

test('任一音位都恰属于一个局', () => {
  assert.equal(bureauOfAngle(0), '申子辰');
  assert.equal(bureauOfAngle(90), '亥卯未');
  assert.equal(bureauOfAngle(180), '寅午戌');
  assert.equal(bureauOfAngle(270), '巳酉丑');
  assert.equal(bureauOfAngle(45), null);
});

test('三合局轮转保形：角度差不变', () => {
  const angle = 0;
  const rotated = rotateByBureau(angle, 1);
  assert.equal(rotated, 120);
  assert.equal(isBureauRotation(0, 90), false);
  assert.equal(bureauRotationSteps(0, 240), 2);
  assert.equal(bureauRotationSteps(0, 90), null);
});
