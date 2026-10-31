// 螺线谱乐律核心：只做音位（12 地支 × 30°）上的纯数学。
// 八卦阵位角（45° 步进）不在这里——它不表示音高，混进来就是 1.5 个半音的错误。

export const SEMITONE_ANGLE = 30;
export const FULL_CIRCLE = 360;

export const mod = (n, m) => ((n % m) + m) % m;

export const pitchClass = (midi) => mod(midi, 12);

export const semitoneToAngle = (semitone) => mod(semitone, 12) * SEMITONE_ANGLE;

// 45° = 1.5 个半音，是阵位角混入音位的典型症状；这里如实返回非整数，由调用方拒绝。
export const angleToSemitone = (angle) => mod(angle, FULL_CIRCLE) / SEMITONE_ANGLE;

export const isPitchAngle = (angle) => Number.isInteger(angleToSemitone(angle));

export const normalizeAngle = (angle) => mod(angle, FULL_CIRCLE);

export function angleBetween(a, b) {
  const d = Math.abs(normalizeAngle(a) - normalizeAngle(b));
  return d > 180 ? 360 - d : d;
}

// 劣弧音程：0..6 个半音。七度以上会折叠成它的转位（0°→210° 得 5，即五度被读成四度），
// 这是圆几何的固有性质，不是误差；需要方向时用 directedSemitones。
export const intervalSemitones = (a, b) => angleBetween(a, b) / SEMITONE_ANGLE;

// 有向音程：从 a 逆时针到 b，0..11 个半音。细胞的身份必须靠这个，而不是音级集合。
export const directedSemitones = (a, b) =>
  Math.round(normalizeAngle(normalizeAngle(b) - normalizeAngle(a)) / SEMITONE_ANGLE) % 12;

export const transposeAngle = (angle, semitones) =>
  normalizeAngle(angle + semitones * SEMITONE_ANGLE);

export const rotateCell = (cell, semitones) => cell.map((a) => transposeAngle(a, semitones));

// 历史实现一（spiral-engine.js）：对数螺旋，θ 随八度累加，r = a·e^(bθ)
export function logarithmicRadius(theta, { a = 20, b = 0.12 } = {}) {
  return a * Math.exp(b * theta);
}

// 历史实现二（spiral-notation.html）：阿基米德螺旋，r = r0 + k·θ，每圈径向 +78 像素
export function archimedeanRadius(theta, { r0 = 40, k = 78 / (Math.PI * 2) } = {}) {
  return r0 + k * theta;
}

// 与 spiral-engine.js 的 freqToSpiral 对齐：C4=60 起算，八度 = 整圈
export function midiToSpiral(midi, opts = {}) {
  const fromC4 = midi - 60;
  const octave = Math.floor(fromC4 / 12);
  const semitone = mod(fromC4, 12);
  const theta = (semitone / 12) * Math.PI * 2 + octave * Math.PI * 2;
  return {
    midi,
    pitch_class: semitone,
    angle: semitone * SEMITONE_ANGLE,
    octave,
    theta,
    radius: logarithmicRadius(theta, opts)
  };
}

export function freqToSpiral(freq, opts = {}) {
  const midi = 69 + 12 * Math.log2(freq / 440);
  return midiToSpiral(midi, opts);
}
