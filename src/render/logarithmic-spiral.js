// 纯对数螺旋（等角螺线 / 鹦鹉螺几何）Canvas 渲染引擎
// 半径方程：r = r0 * 2^((midi - 60) / 12)
// 角度方程：θ = (midi - 60) * (π / 6)
// 保证：每跨一个八度（2π），空间半径与声学物理频率严格翻倍同步！

import { SEMITONE_ANGLE, pitchClass } from '../core/pitch.js';
import { BUREAUS, ELEMENTS, bureauOfAngle } from '../core/bureau.js';

export const BRANCH_NAMES = [
  { n: 'C',  z: '子', s: '♈' }, { n: 'C#', z: '丑', s: '♉' },
  { n: 'D',  z: '寅', s: '♊' }, { n: 'D#', z: '卯', s: '♋' },
  { n: 'E',  z: '辰', s: '♌' }, { n: 'F',  z: '巳', s: '♍' },
  { n: 'F#', z: '午', s: '♎' }, { n: 'G',  z: '未', s: '♏' },
  { n: 'G#', z: '申', s: '♐' }, { n: 'A',  z: '酉', s: '♑' },
  { n: 'A#', z: '戌', s: '♒' }, { n: 'B',  z: '亥', s: '♓' }
];

export const BUREAU_COLORS = {
  申子辰: { name: '水局·申子辰', hex: '#38bdf8', glow: 'rgba(56, 189, 248, 0.45)' },
  亥卯未: { name: '木局·亥卯未', hex: '#34d399', glow: 'rgba(52, 211, 153, 0.45)' },
  寅午戌: { name: '火局·寅午戌', hex: '#f87171', glow: 'rgba(248, 113, 113, 0.45)' },
  巳酉丑: { name: '金局·巳酉丑', hex: '#fbbf24', glow: 'rgba(251, 191, 36, 0.45)' }
};

export class LogarithmicSpiralRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    // 视图缩放与位移参数
    this.zoom = 1.0;
    this.panX = 0;
    this.panY = 0;
    this.isDragging = false;
    this.lastMouse = { x: 0, y: 0 };

    // 基准参数
    this.r0 = 150; // C4 (60) 的基准像素半径
    this.minMidi = 28; // E1
    this.maxMidi = 96; // C7

    // 动效实体池
    this.activePulses = new Map(); // midi -> pulse info
    this.sparks = [];             // 粒子光点
    this.decayNotes = [];         // 刚释放的余辉 note

    this._bindEvents();
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.scale(dpr, dpr);
  }

  _bindEvents() {
    window.addEventListener('resize', () => this.resize());

    // 滚轮缩放对数螺旋视口
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
      this.zoom = Math.max(0.3, Math.min(5.0, this.zoom * zoomFactor));
    }, { passive: false });

    // 鼠标拖拽平移
    this.canvas.addEventListener('mousedown', (e) => {
      this.isDragging = true;
      this.lastMouse = { x: e.clientX, y: e.clientY };
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isDragging) return;
      const dx = e.clientX - this.lastMouse.x;
      const dy = e.clientY - this.lastMouse.y;
      this.panX += dx;
      this.panY += dy;
      this.lastMouse = { x: e.clientX, y: e.clientY };
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
    });

    // 双击重置视角
    this.canvas.addEventListener('dblclick', () => {
      this.zoom = 1.0;
      this.panX = 0;
      this.panY = 0;
    });
  }

  // 核心：MIDI 转对数螺线笛卡尔坐标
  // 子位(0°)在正上方(-90°)，顺时针旋转
  midiToCoords(midi) {
    const fromC4 = midi - 60;
    const phi = -Math.PI / 2 + fromC4 * (Math.PI / 6);
    // 对数螺线公式：每 12 半音半径刚好翻倍
    const r = this.r0 * Math.pow(2, fromC4 / 12) * this.zoom;
    const cx = this.width / 2 + this.panX;
    const cy = this.height / 2 + this.panY;
    return {
      x: cx + r * Math.cos(phi),
      y: cy + r * Math.sin(phi),
      phi,
      r,
      cx,
      cy
    };
  }

  // 触发音符击弦动效
  triggerNote(note) {
    const coords = this.midiToCoords(note.midi);
    const pc = pitchClass(note.midi);
    const angle = pc * SEMITONE_ANGLE;
    const bureau = bureauOfAngle(angle);

    this.activePulses.set(note.midi, {
      ...note,
      x: coords.x,
      y: coords.y,
      birth: performance.now(),
      bureau
    });

    // 产生发光火花粒子
    const sparkCount = Math.floor(6 + (note.velocity || 0.8) * 8);
    const color = bureau ? BUREAU_COLORS[bureau].hex : '#e2e8f0';
    for (let i = 0; i < sparkCount; i++) {
      const spd = (1 + Math.random() * 2.5);
      const ang = Math.random() * Math.PI * 2;
      this.sparks.push({
        x: coords.x,
        y: coords.y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        life: 1.0,
        decay: 0.02 + Math.random() * 0.03,
        color
      });
    }
  }

  releaseNote(note) {
    if (this.activePulses.has(note.midi)) {
      const p = this.activePulses.get(note.midi);
      this.decayNotes.push({
        ...p,
        releaseTime: performance.now(),
        alpha: 1.0
      });
      this.activePulses.delete(note.midi);
    }
  }

  // 主渲染帧循环
  render(activeNotes = []) {
    const ctx = this.ctx;
    const cx = this.width / 2 + this.panX;
    const cy = this.height / 2 + this.panY;

    // 清屏，留淡淡半透明底色产生微弱余辉
    ctx.fillStyle = '#060814';
    ctx.fillRect(0, 0, this.width, this.height);

    this._drawBackgroundGrid(cx, cy);
    this._drawLogarithmicSpiral(cx, cy);
    this._drawBranchesAndRays(cx, cy);
    this._drawDualHandConstellations(activeNotes);
    this._drawTriUnionChords(activeNotes);
    this._drawDecayTrail();
    this._drawActiveNotes(activeNotes);
    this._drawSparks();
  }

  // 1. 背景同心八度指示虚圈
  _drawBackgroundGrid(cx, cy) {
    const ctx = this.ctx;
    ctx.save();
    ctx.lineWidth = 1;
    // C2..C6 同心八度标记
    for (let m = 36; m <= 84; m += 12) {
      const r = this.r0 * Math.pow(2, (m - 60) / 12) * this.zoom;
      if (r < 10 || r > Math.max(this.width, this.height) * 1.5) continue;

      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = (m === 60) ? 'rgba(212, 175, 55, 0.22)' : 'rgba(255, 255, 255, 0.05)';
      ctx.setLineDash([4, 6]);
      ctx.stroke();

      // 八度文字标尺 (C2, C3, C4...)
      const oct = Math.floor(m / 12) - 1;
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(212, 175, 55, 0.35)';
      ctx.font = '10px monospace';
      ctx.fillText(`C${oct}`, cx + 6, cy - r + 12);
    }
    ctx.restore();
  }

  // 2. 纯对数螺旋母线绘制
  _drawLogarithmicSpiral(cx, cy) {
    const ctx = this.ctx;
    ctx.save();

    // 绘制深空对数螺旋轨迹（由密至疏）
    ctx.beginPath();
    const step = 0.03; // 细密弧度采样
    let started = false;

    for (let m = this.minMidi; m <= this.maxMidi; m += step) {
      const fromC4 = m - 60;
      const phi = -Math.PI / 2 + fromC4 * (Math.PI / 6);
      const r = this.r0 * Math.pow(2, fromC4 / 12) * this.zoom;
      const x = cx + r * Math.cos(phi);
      const y = cy + r * Math.sin(phi);

      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }

    ctx.strokeStyle = 'rgba(212, 175, 55, 0.3)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 发光外晕层
    ctx.strokeStyle = 'rgba(212, 175, 55, 0.08)';
    ctx.lineWidth = 4;
    ctx.stroke();

    ctx.restore();
  }

  // 3. 12 地支射线与徽标
  _drawBranchesAndRays(cx, cy) {
    const ctx = this.ctx;
    ctx.save();

    const maxR = Math.min(this.width, this.height) * 0.44;

    for (let i = 0; i < 12; i++) {
      const phi = -Math.PI / 2 + i * (Math.PI / 6);
      const x2 = cx + maxR * Math.cos(phi);
      const y2 = cy + maxR * Math.sin(phi);

      // 辐射线
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = (i === 0) ? 'rgba(212, 175, 55, 0.25)' : 'rgba(255, 255, 255, 0.04)';
      ctx.lineWidth = (i % 3 === 0) ? 1.2 : 0.8;
      ctx.stroke();

      // 地支与音名标牌
      const labelR = maxR + 24;
      const lx = cx + labelR * Math.cos(phi);
      const ly = cy + labelR * Math.sin(phi);
      const item = BRANCH_NAMES[i];

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // 地支大字
      ctx.font = 'bold 13px "Noto Serif SC", "Songti SC", serif';
      ctx.fillStyle = (i === 0) ? '#fbbf24' : '#cbd5e1';
      ctx.fillText(item.z, lx, ly - 7);

      // 音名小注
      ctx.font = '10px monospace';
      ctx.fillStyle = '#64748b';
      ctx.fillText(item.n, lx, ly + 8);
    }

    ctx.restore();
  }

  // 4. 双手手势星轨连线网络 (区分左手与右手骨骼，展现双手交感)
  _drawDualHandConstellations(activeNotes) {
    if (!activeNotes || activeNotes.length === 0) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    const leftGroup = [];
    const rightGroup = [];

    activeNotes.forEach(n => {
      const c = this.midiToCoords(n.midi);
      const node = { ...c, midi: n.midi, velocity: n.velocity || 0.8 };
      if (n.hand === 'left') {
        leftGroup.push(node);
      } else {
        rightGroup.push(node);
      }
    });

    // 1. 右手手势连线网 (阳 · 天青与金辉星轨)
    if (rightGroup.length >= 2) {
      ctx.beginPath();
      ctx.moveTo(rightGroup[0].x, rightGroup[0].y);
      for (let i = 1; i < rightGroup.length; i++) {
        ctx.lineTo(rightGroup[i].x, rightGroup[i].y);
      }
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.85)';
      ctx.lineWidth = 2.5;
      ctx.shadowColor = '#38bdf8';
      ctx.shadowBlur = 14;
      ctx.stroke();

      // 右手和弦星芒多边形
      if (rightGroup.length >= 3) {
        ctx.closePath();
        ctx.fillStyle = 'rgba(56, 189, 248, 0.12)';
        ctx.fill();
      }
    }

    // 2. 左手手势连线网 (阴 · 紫罗兰地脉织体)
    if (leftGroup.length >= 2) {
      ctx.beginPath();
      ctx.moveTo(leftGroup[0].x, leftGroup[0].y);
      for (let i = 1; i < leftGroup.length; i++) {
        ctx.lineTo(leftGroup[i].x, leftGroup[i].y);
      }
      ctx.strokeStyle = 'rgba(192, 132, 252, 0.85)';
      ctx.lineWidth = 3.0;
      ctx.shadowColor = '#c084fc';
      ctx.shadowBlur = 16;
      ctx.stroke();

      // 左手和弦多边形
      if (leftGroup.length >= 3) {
        ctx.closePath();
        ctx.fillStyle = 'rgba(192, 132, 252, 0.12)';
        ctx.fill();
      }
    }

    // 3. 跨手能量引力对偶虚线 (双手同时发声时的纠缠弦)
    if (leftGroup.length > 0 && rightGroup.length > 0) {
      const leftCenter = leftGroup.reduce(
        (acc, p) => ({ x: acc.x + p.x / leftGroup.length, y: acc.y + p.y / leftGroup.length }),
        { x: 0, y: 0 }
      );
      const rightCenter = rightGroup.reduce(
        (acc, p) => ({ x: acc.x + p.x / rightGroup.length, y: acc.y + p.y / rightGroup.length }),
        { x: 0, y: 0 }
      );

      ctx.beginPath();
      ctx.setLineDash([3, 5]);
      ctx.moveTo(leftCenter.x, leftCenter.y);
      ctx.lineTo(rightCenter.x, rightCenter.y);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.lineWidth = 1.2;
      ctx.shadowColor = '#ffffff';
      ctx.shadowBlur = 8;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();
  }

  // 5. 多音和弦与三合局动态能量连线
  _drawTriUnionChords(activeNotes) {
    if (!activeNotes || activeNotes.length < 2) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // 提取所有活跃音符的坐标
    const coordsList = activeNotes.map(n => {
      const c = this.midiToCoords(n.midi);
      const pc = pitchClass(n.midi);
      const angle = pc * SEMITONE_ANGLE;
      const bureau = bureauOfAngle(angle);
      return { ...c, midi: n.midi, pc, bureau };
    });

    // 检查是否有同属一个三合局（增三和弦）的音符
    for (let i = 0; i < coordsList.length; i++) {
      for (let j = i + 1; j < coordsList.length; j++) {
        const a = coordsList[i];
        const b = coordsList[j];

        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);

        // 如果两人都在同一个三合局，触发专属高亮光弦！
        if (a.bureau && a.bureau === b.bureau) {
          const cfg = BUREAU_COLORS[a.bureau];
          ctx.strokeStyle = cfg.hex;
          ctx.lineWidth = 2.5;
          ctx.shadowColor = cfg.hex;
          ctx.shadowBlur = 12;
          ctx.stroke();
        } else {
          // 普通和声连线
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
          ctx.lineWidth = 1;
          ctx.shadowBlur = 0;
          ctx.stroke();
        }
      }
    }

    ctx.restore();
  }

  // 5. 活跃击弦点与脉冲光环
  _drawActiveNotes(activeNotes) {
    if (!activeNotes || activeNotes.length === 0) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    const now = performance.now();

    activeNotes.forEach(note => {
      const c = this.midiToCoords(note.midi);
      const pc = pitchClass(note.midi);
      const angle = pc * SEMITONE_ANGLE;
      const bureau = bureauOfAngle(angle);
      
      // 左右手专属色彩与三合局光彩互融
      const isLeft = (note.hand === 'left');
      const handColor = isLeft ? '#c084fc' : '#38bdf8';
      const color = bureau ? BUREAU_COLORS[bureau].hex : handColor;

      // 击弦脉冲波纹
      const elapsed = (now % 1000) / 1000;
      const rippleR = 8 + elapsed * 24;
      const rippleAlpha = 1.0 - elapsed;

      ctx.beginPath();
      ctx.arc(c.x, c.y, rippleR, 0, Math.PI * 2);
      ctx.strokeStyle = handColor;
      ctx.lineWidth = isLeft ? 2.0 : 1.5;
      ctx.globalAlpha = rippleAlpha * 0.7;
      ctx.stroke();

      // 发光实心核心
      ctx.globalAlpha = 1.0;
      ctx.beginPath();
      ctx.arc(c.x, c.y, 6.5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = handColor;
      ctx.shadowBlur = 18;
      ctx.fill();

      // 外光晕圈
      ctx.beginPath();
      ctx.arc(c.x, c.y, 11, 0, Math.PI * 2);
      ctx.fillStyle = handColor;
      ctx.globalAlpha = 0.45;
      ctx.fill();

      // 左右手微标 L / R
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 8px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(isLeft ? 'L' : 'R', c.x, c.y);
    });

    ctx.restore();
  }

  // 6. 余辉渐变拖尾
  _drawDecayTrail() {
    if (this.decayNotes.length === 0) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    const now = performance.now();
    for (let i = this.decayNotes.length - 1; i >= 0; i--) {
      const item = this.decayNotes[i];
      const elapsed = (now - item.releaseTime) / 1000;
      const life = 1.0 - elapsed / 0.45; // 450ms 余辉渐隐

      if (life <= 0) {
        this.decayNotes.splice(i, 1);
        continue;
      }

      const c = this.midiToCoords(item.midi);
      const color = item.bureau ? BUREAU_COLORS[item.bureau].hex : '#94a3b8';

      ctx.beginPath();
      ctx.arc(c.x, c.y, 5 * life, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.globalAlpha = life * 0.4;
      ctx.fill();
    }

    ctx.restore();
  }

  // 7. 火花粒子更新
  _drawSparks() {
    if (this.sparks.length === 0) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.x += s.vx;
      s.y += s.vy;
      s.vx *= 0.94;
      s.vy *= 0.94;
      s.life -= s.decay;

      if (s.life <= 0) {
        this.sparks.splice(i, 1);
        continue;
      }

      ctx.beginPath();
      ctx.arc(s.x, s.y, 1.8 * s.life, 0, Math.PI * 2);
      ctx.fillStyle = s.color;
      ctx.globalAlpha = s.life * 0.8;
      ctx.fill();
    }

    ctx.restore();
  }
}
