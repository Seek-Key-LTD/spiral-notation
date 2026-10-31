// 螺线谱主交互控制器
import { Midi } from './vendor/midi.bundle.js';
import { MidiPlayer } from './audio/midi-player.js';
import { LogarithmicSpiralRenderer, BRANCH_NAMES, BUREAU_COLORS } from './render/logarithmic-spiral.js';
import { pitchClass, SEMITONE_ANGLE } from './core/pitch.js';
import { bureauOfAngle } from './core/bureau.js';

export class SpiralApp {
  constructor() {
    this.canvas = document.getElementById('spiral-canvas');
    this.renderer = new LogarithmicSpiralRenderer(this.canvas);
    this.player = new MidiPlayer();

    // DOM 元素绑定
    this.btnPlay = document.getElementById('btn-play');
    this.btnStop = document.getElementById('btn-stop');
    this.sliderProgress = document.getElementById('progress-bar');
    this.timeDisplay = document.getElementById('time-display');
    this.selectSample = document.getElementById('sample-select');
    this.fileInput = document.getElementById('file-input');
    this.btnUpload = document.getElementById('btn-upload');
    this.sliderSpeed = document.getElementById('speed-slider');
    this.speedLabel = document.getElementById('speed-label');
    this.statusBureau = document.getElementById('active-bureau');
    this.statusNotes = document.getElementById('active-notes');
    this.dropZone = document.getElementById('drop-zone');
    this.centerPlayBtn = document.getElementById('center-play-btn');
    this.btnBridge = document.getElementById('btn-bridge');

    this._bindControls();
    this._bindPlayerCallbacks();
    this._startRenderLoop();
    this._autoDetectBridge();

    // 默认加载示例（拉格朗日共振30-60-90度直角三角赋格）
    this.loadSample('samples/silent_night_lagrange_resonance.mid');
  }

  _bindControls() {
    // 居中大播放按钮
    this.centerPlayBtn?.addEventListener('click', () => {
      this.player.play();
    });

    // 播放 / 暂停
    this.btnPlay.addEventListener('click', () => {
      if (this.player.isPlaying) {
        this.player.pause();
      } else {
        this.player.play();
      }
    });

    // 停止
    this.btnStop.addEventListener('click', () => {
      this.player.stop();
    });

    // 进度条拖动
    this.sliderProgress.addEventListener('input', (e) => {
      const targetSec = (parseFloat(e.target.value) / 1000) * this.player.duration;
      this.player.seek(targetSec);
    });

    // 速度滑块
    this.sliderSpeed.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      this.player.setPlaybackRate(val);
      this.speedLabel.textContent = `${val.toFixed(1)}x`;
    });

    // 施坦威直通切换
    this.btnBridge?.addEventListener('click', async () => {
      if (!this.player.bridge.enabled) {
        this.btnBridge.textContent = '⏳ 探测中...';
        const ok = await this.player.bridge.init();
        if (ok) {
          this.player.bridge.enabled = true;
          const target = this.player.bridge.boundName || 'GarageBand';
          this.btnBridge.textContent = `🎹 施坦威直通: ${target} ✅`;
          this.btnBridge.style.backgroundColor = 'rgba(56, 189, 248, 0.2)';
          this.btnBridge.style.color = '#38bdf8';
        } else {
          this.btnBridge.textContent = '❌ 未连通 GarageBand';
          setTimeout(() => {
            this.btnBridge.textContent = '🎹 施坦威直通: 关';
            this.btnBridge.style.backgroundColor = '';
            this.btnBridge.style.color = '';
          }, 2000);
        }
      } else {
        this.player.bridge.enabled = false;
        this.player.bridge.sendAllOff();
        this.btnBridge.textContent = '🎹 施坦威直通: 关';
        this.btnBridge.style.backgroundColor = '';
        this.btnBridge.style.color = '';
      }
    });

    // 示例曲目切换
    this.selectSample.addEventListener('change', (e) => {
      if (e.target.value) {
        this.loadSample(e.target.value);
      }
    });

    // 本地上传按钮
    this.btnUpload.addEventListener('click', () => {
      this.fileInput.click();
    });

    this.fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (file) {
        await this.loadMidiFile(file);
      }
    });

    // 拖拽文件进入视口
    window.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.dropZone.classList.add('active');
    });

    window.addEventListener('dragleave', (e) => {
      if (e.clientX === 0 && e.clientY === 0) {
        this.dropZone.classList.remove('active');
      }
    });

    window.addEventListener('drop', async (e) => {
      e.preventDefault();
      this.dropZone.classList.remove('active');
      const file = e.dataTransfer.files[0];
      if (file && (file.name.endsWith('.mid') || file.name.endsWith('.midi'))) {
        await this.loadMidiFile(file);
      }
    });

    // 视角控制按键
    document.getElementById('btn-zoom-in')?.addEventListener('click', () => {
      this.renderer.zoom = Math.min(5.0, this.renderer.zoom * 1.25);
    });
    document.getElementById('btn-zoom-out')?.addEventListener('click', () => {
      this.renderer.zoom = Math.max(0.3, this.renderer.zoom * 0.8);
    });
    document.getElementById('btn-reset-view')?.addEventListener('click', () => {
      this.renderer.zoom = 1.0;
      this.renderer.panX = 0;
      this.renderer.panY = 0;
    });
  }

  _bindPlayerCallbacks() {
    this.player.onStateChange = (isPlaying) => {
      this.btnPlay.textContent = isPlaying ? '⏸ 暂停' : '▶ 播放';
      if (this.centerPlayBtn) {
        this.centerPlayBtn.classList.toggle('hidden', isPlaying);
      }
      if (isPlaying) {
        this.btnPlay.classList.add('playing');
      } else {
        this.btnPlay.classList.remove('playing');
      }
    };

    this.player.onProgress = (currentTime, duration) => {
      const pct = (currentTime / duration) * 1000;
      this.sliderProgress.value = pct;
      this.timeDisplay.textContent = `${this._formatTime(currentTime)} / ${this._formatTime(duration)}`;
    };

    this.player.onNoteTrigger = (note) => {
      this.renderer.triggerNote(note);
    };

    this.player.onNoteRelease = (note) => {
      this.renderer.releaseNote(note);
    };
  }

  _formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  async loadSample(url) {
    try {
      this.timeDisplay.textContent = '加载示例曲目...';
      const res = await fetch(url);
      const arrayBuffer = await res.arrayBuffer();
      const midi = new Midi(arrayBuffer);
      this.player.loadMidi(midi);
      this.timeDisplay.textContent = `就绪: ${url.split('/').pop()}`;
    } catch (err) {
      console.error('加载示例曲目失败:', err);
      this.timeDisplay.textContent = '加载失败';
    }
  }

  async loadMidiFile(file) {
    try {
      this.timeDisplay.textContent = `解析中: ${file.name}...`;
      const arrayBuffer = await file.arrayBuffer();
      const midi = new Midi(arrayBuffer);
      this.player.loadMidi(midi);
      this.timeDisplay.textContent = `已载入: ${file.name} (${this.player.notesList.length} 音符)`;
      // 自动播放
      this.player.play();
    } catch (err) {
      console.error('解析 MIDI 失败:', err);
      alert('无法解析该 MIDI 文件，请确保是标准的 .mid 格式。');
    }
  }

  _startRenderLoop() {
    const loop = () => {
      const active = this.player.activeVisualNotes;
      this.renderer.render(active);
      this._updateStatusPanel(active);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  async _autoDetectBridge() {
    if (!this.btnBridge) return;
    const ok = await this.player.bridge.init();
    if (ok) {
      this.player.bridge.enabled = true;
      const target = this.player.bridge.boundName || 'GarageBand';
      this.btnBridge.textContent = `🎹 施坦威直通: ${target} ✅`;
      this.btnBridge.style.backgroundColor = 'rgba(56, 189, 248, 0.2)';
      this.btnBridge.style.color = '#38bdf8';
    }
  }

  _updateStatusPanel(activeNotes) {
    if (!this.statusNotes) return;

    if (activeNotes.length === 0) {
      this.statusNotes.textContent = '静默中';
      this.statusBureau.textContent = '—';
      this.statusBureau.style.color = '#64748b';
      return;
    }

    // 活跃音符列表
    const names = activeNotes.map(n => {
      const pc = pitchClass(n.midi);
      const branch = BRANCH_NAMES[pc];
      return `${branch.z}(${branch.n}${Math.floor(n.midi / 12) - 1})`;
    });
    this.statusNotes.textContent = names.join('  ');

    // 检查活跃三合局
    const bureausFound = new Set();
    activeNotes.forEach(n => {
      const pc = pitchClass(n.midi);
      const angle = pc * SEMITONE_ANGLE;
      const b = bureauOfAngle(angle);
      if (b) bureausFound.add(b);
    });

    if (bureausFound.size > 0) {
      const bList = Array.from(bureausFound);
      const bName = bList[0];
      const cfg = BUREAU_COLORS[bName];
      this.statusBureau.textContent = bList.map(b => BUREAU_COLORS[b].name).join(' · ');
      this.statusBureau.style.color = cfg.hex;
      this.statusBureau.style.textShadow = `0 0 10px ${cfg.glow}`;
    } else {
      this.statusBureau.textContent = '—';
      this.statusBureau.style.color = '#64748b';
      this.statusBureau.style.textShadow = 'none';
    }
  }
}

// 启动应用
window.addEventListener('DOMContentLoaded', () => {
  window.spiralApp = new SpiralApp();
});
