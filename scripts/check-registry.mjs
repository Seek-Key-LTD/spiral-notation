#!/usr/bin/env node
// 校验注册表与乐律规则是否自洽。默认只报告，--strict 时以非零码退出。
// 当前八仙数据有 4/8 的根音落在自己声明的三合局之外（见 README「已知问题」），
// 所以默认不阻断。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BUREAUS, bureauOfAngle } from '../src/core/bureau.js';
import { semitoneToAngle } from '../src/core/pitch.js';

const strict = process.argv.includes('--strict');
const data = JSON.parse(
  readFileSync(fileURLToPath(new URL('../src/registry/eight-immortals.json', import.meta.url)), 'utf8')
);

const pad = (s, n) => String(s).padEnd(n, ' ');
let mismatches = 0;

console.log(pad('席位', 8) + pad('卦', 6) + pad('根音', 6) + pad('根音角', 8) + pad('声明局', 8) + pad('实际局', 8) + '判定');
console.log('-'.repeat(64));

for (const seat of data.seats) {
  const rootAngle = semitoneToAngle(seat.root_pitch_class);
  const actual = bureauOfAngle(rootAngle);
  const ok = actual === seat.bureau;
  if (!ok) mismatches += 1;
  console.log(
    pad(seat.id, 8) +
      pad(seat.hexagram, 6) +
      pad(seat.root_name, 6) +
      pad(`${rootAngle}°`, 8) +
      pad(seat.bureau, 8) +
      pad(actual ?? '—', 8) +
      (ok ? '一致' : '不一致')
  );

  if (seat.seat_angle % 30 !== 0) {
    console.log(`  · 阵位角 ${seat.seat_angle}° 不落在音位网格上（= ${seat.seat_angle / 30} 个半音），仅可用于布阵`);
  }
}

console.log('-'.repeat(64));
console.log(`三合局: ${Object.keys(BUREAUS).join(' / ')}`);
console.log(`根音与声明局不一致: ${mismatches}/${data.seats.length}`);

if (strict && mismatches > 0) process.exit(1);
