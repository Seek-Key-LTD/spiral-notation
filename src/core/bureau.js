// 三合局 = 12 地支上相隔 120° 的三点 = 增三和弦 = 大三度循环。
// 它是"只许沿三合局转调"这条规则的数学实体：120° 旋转保形，所以身份在该变换下守恒。

import { angleBetween, normalizeAngle, transposeAngle } from './pitch.js';

export const BUREAUS = {
  申子辰: [240, 0, 120],
  亥卯未: [330, 90, 210],
  寅午戌: [60, 180, 300],
  巳酉丑: [150, 270, 30]
};

export const ELEMENTS = {
  申子辰: '水',
  亥卯未: '木',
  寅午戌: '火',
  巳酉丑: '金'
};

export const bureauNames = () => Object.keys(BUREAUS);

export const bureauAngles = (name) => BUREAUS[name] ?? null;

export function bureauOfAngle(angle) {
  const a = normalizeAngle(angle);
  for (const [name, angles] of Object.entries(BUREAUS)) {
    if (angles.includes(a)) return name;
  }
  return null;
}

// 夹角为 120° 的整数倍，即一次（或多次）增三和弦轮转。
export function isBureauRotation(from, to) {
  return angleBetween(from, to) % 120 === 0;
}

// 0 = 原地，1 = 顺时针 120°，2 = 240°；不在同一条三合局轴上则返回 null。
export function bureauRotationSteps(from, to) {
  if (!isBureauRotation(from, to)) return null;
  return (normalizeAngle(to - from) % 360) / 120;
}

export const rotateByBureau = (angle, steps) => transposeAngle(angle, steps * 4);
