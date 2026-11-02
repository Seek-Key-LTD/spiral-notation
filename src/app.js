// 螺线谱主交互控制器
import { Midi } from './vendor/midi.bundle.js';
import { MidiPlayer } from './audio/midi-player.js';
import { LogarithmicSpiralRenderer, BRANCH_NAMES, BUREAU_COLORS } from './render/logarithmic-spiral.js';
import { pitchClass, SEMITONE_ANGLE } from './core/pitch.js';
import { bureauOfAngle } from './core/bureau.js';
import { AudioTranscriber, RealtimeMicTracker } from './audio/transcriber.js';

export class SpiralApp {
  constructor() {
    this.canvas = document.getElementById('spiral-canvas');
    this.renderer = new LogarithmicSpiralRenderer(this.canvas);
    this.player = new MidiPlayer();
    this.transcriber = new AudioTranscriber();
    this.micTracker = null;

    // DOM 元素绑定
    this.btnPlay = document.getElementById('btn-play');
    this.btnStop = document.getElementById('btn-stop');
    this.sliderProgress = document.getElementById('progress-bar');
    this.timeDisplay = document.getElementById('time-display');
    this.selectSample = document.getElementById('sample-select');
    this.fileInput = document.getElementById('file-input');
    this.btnUpload = document.getElementById('btn-upload');
    this.btnMic = document.getElementById('btn-mic');
    this.sliderSpeed = document.getElementById('speed-slider');
    this.speedLabel = document.getElementById('speed-label');
    this.statusBureau = document.getElementById('active-bureau');
    this.dropZone = document.getElementById('drop-zone');
    this.centerPlayBtn = document.getElementById('center-play-btn');
    this.btnBridge = document.getElementById('btn-bridge');
    this.selectTimbre = document.getElementById('timbre-select');

    // DOM 脏检查缓存 (避免每秒 60 次触发浏览器重排和文本回流)
    this._lastActiveNotesKey = null;
    this._lastTimeDisplayStr = '';

    // 监听采样解码进度，实时反馈到 UI 下拉栏
    this.player.audio.onProgressCallback = (loaded, total) => {
      const opt = this.selectTimbre?.querySelector('option[value="steinway"]');
      if (opt) {
        if (loaded >= total) {
          opt.textContent = `🎹 施坦威音乐厅九尺大钢琴 (88键全部就绪 · 3D金色大厅)`;
        } else {
          opt.textContent = `🎹 施坦威音乐厅九尺大钢琴 (${loaded}/${total})`;
        }
      }
    };

    this._bindControls();
    this._bindPlayerCallbacks();
    this._startRenderLoop();
    this.player.audio.preloadSoundfont();

    // 初始化跨机 MBP 音频网桥 (连接 MBP 8089 上的 CoreMIDI/Pianoteq 枢纽)
    this.player.bridge.init().then(() => {
      this._updateBridgeButtonState();
    });

    // 默认加载示例（支持根据下拉框自动初始化，首推李斯特《钟》双手大师版）
    const initialSample = this.selectSample?.value || 'samples/liszt_campanella_full.mid';
    this._updateCenterPlayText();
    this.loadSample(initialSample);
  }

  _updateCenterPlayText() {
    if (this.centerPlayBtn && this.selectSample) {
      const opt = this.selectSample.options[this.selectSample.selectedIndex];
      if (opt) {
        this.centerPlayBtn.textContent = `▶ 点击启奏 ${opt.text.replace(/^[^\s]+\s+/, '')}`;
      }
    }
  }

  _bindControls() {
    // 居中大播放按钮
    this.centerPlayBtn?.addEventListener('click', () => {
      if (!this.player.bridge.isConnected) {
        this.player.bridge.init().then(() => this._updateBridgeButtonState()).catch(() => {});
      }
      this.player.play();
      this._triggerReaper('play');
    });

    // 播放 / 暂停
    this.btnPlay.addEventListener('click', () => {
      if (this.player.isPlaying) {
        this.player.pause();
        this._triggerReaper('pause');
      } else {
        if (!this.player.bridge.isConnected) {
          this.player.bridge.init().then(() => this._updateBridgeButtonState()).catch(() => {});
        }
        this.player.play();
        this._triggerReaper('play');
      }
    });

    // 停止
    this.btnStop.addEventListener('click', () => {
      this.player.stop();
      this._triggerReaper('stop');
    });

    // 进度条拖动
    this.sliderProgress.addEventListener('input', (e) => {
      const targetSec = (parseFloat(e.target.value) / 1000) * this.player.duration;
      this.player.seek(targetSec);
      this._triggerReaper('seek');
    });

    // 速度滑块
    this.sliderSpeed.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      this.player.setPlaybackRate(val);
      this.speedLabel.textContent = `${val.toFixed(1)}x`;
    });

    // 音色引擎切换 (REAPER Pianoteq 9 vs 施坦威原声 SoundFont vs 电子星音合成器)
    this.selectTimbre?.addEventListener('change', async (e) => {
      this.player.audio.setMode(e.target.value);
      if (e.target.value === 'reaper' && !this.player.bridge.isConnected) {
        await this.player.bridge.init();
        this._updateBridgeButtonState();
      }
    });

    // 外部 REAPER 联锁 / Web MIDI CoreMIDI 直通切换
    this.btnBridge?.addEventListener('click', async () => {
      const midiOk = await this.player.bridge.init();
      let reaperOk = false;
      try {
        const res = await fetch('/reaper/_/TRANSPORT');
        reaperOk = res.ok;
      } catch (err) {}

      this._updateBridgeButtonState(midiOk, reaperOk);
    });

    // 示例曲目切换
    this.selectSample.addEventListener('change', (e) => {
      if (e.target.value) {
        this.loadSample(e.target.value);
        this._updateCenterPlayText();
      }
    });

    // 本地上传按钮
    this.btnUpload.addEventListener('click', () => {
      this.fileInput.click();
    });

    this.fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (file) {
        if (file.name.endsWith('.mid') || file.name.endsWith('.midi')) {
          await this.loadMidiFile(file);
        } else {
          await this.loadAudioFile(file);
        }
      }
    });

    // 实时麦克风原声捕获开关
    this.btnMic?.addEventListener('click', async () => {
      await this._toggleMic();
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
      if (file) {
        if (file.name.endsWith('.mid') || file.name.endsWith('.midi')) {
          await this.loadMidiFile(file);
        } else {
          await this.loadAudioFile(file);
        }
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

  _updateBridgeButtonState(midiOk, reaperOk) {
    if (!this.btnBridge) return;
    const hasMidi = (midiOk !== undefined) ? midiOk : this.player.bridge.isConnected;
    const portName = this.player.bridge.boundName || '总线1 (IAC)';

    if (hasMidi) {
      this.btnBridge.textContent = `🎹 MIDI: ${portName} ✅`;
      this.btnBridge.style.backgroundColor = 'rgba(56, 189, 248, 0.2)';
      this.btnBridge.style.color = '#38bdf8';
    } else if (reaperOk) {
      this.btnBridge.textContent = '🎹 REAPER HTTP: 联通 ✅ (点此激活 IAC)';
      this.btnBridge.style.backgroundColor = 'rgba(56, 189, 248, 0.2)';
      this.btnBridge.style.color = '#38bdf8';
    } else {
      this.btnBridge.textContent = '❌ REAPER / IAC 未连接';
      this.btnBridge.style.backgroundColor = 'rgba(239, 68, 68, 0.15)';
      this.btnBridge.style.color = '#f87171';
    }
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
      const timeStr = `${this._formatTime(currentTime)} / ${this._formatTime(duration)}`;
      if (timeStr !== this._lastTimeDisplayStr) {
        this._lastTimeDisplayStr = timeStr;
        this.timeDisplay.textContent = timeStr;
      }
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

  async loadAudioFile(file) {
    try {
      this.player.stop();
      this.timeDisplay.textContent = `🎵 解码音频: ${file.name}...`;

      const arrayBuffer = await file.arrayBuffer();
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const tempCtx = new AudioCtx();
      const audioBuffer = await tempCtx.decodeAudioData(arrayBuffer);

      this.timeDisplay.textContent = `🎙️ 正在提取主旋律与绝对音高... 0%`;
      const virtualMidi = await this.transcriber.transcribe(audioBuffer, (pct) => {
        this.timeDisplay.textContent = `🎙️ 正在提取主旋律与绝对音高... ${pct}%`;
      });

      this.player.loadMidi(virtualMidi);
      const noteCount = this.player.notesList.length;
      this.timeDisplay.textContent = `转谱完成: ${file.name} (提纯 ${noteCount} 音符)`;

      if (this.centerPlayBtn) {
        this.centerPlayBtn.textContent = `▶ 启奏已转谱音频 (${file.name})`;
      }

      // 自动播放转录后的施坦威钢琴旋律
      this.player.play();
    } catch (err) {
      console.error('音频转录失败:', err);
      alert(`音频转录失败: ${err.message || '请确保是有效的音频文件'}`);
      this.timeDisplay.textContent = '转录失败';
    }
  }

  async _toggleMic() {
    if (this.micTracker && this.micTracker.isRunning) {
      this.micTracker.stop();
      this.micTracker = null;
      if (this.btnMic) {
        this.btnMic.textContent = '🎙️ 实时麦克风';
        this.btnMic.style.backgroundColor = '';
        this.btnMic.style.color = '';
        this.btnMic.style.borderColor = '';
      }
      this.timeDisplay.textContent = '麦克风监听已停止';
      return;
    }

    try {
      this.player.stop();
      this.timeDisplay.textContent = '正在连接麦克风原声流...';
      this.player.audio.ensureContext();
      this.micTracker = new RealtimeMicTracker(this.player.audio.ctx);

      let lastActiveTimer = null;
      this.micTracker.onPitch = (pitch) => {
        const noteObj = {
          midi: pitch.midi,
          velocity: Math.min(1.0, pitch.clarity * 1.2),
          name: pitch.name,
          hand: pitch.midi < 60 ? 'left' : 'right'
        };

        this.renderer.triggerNote(noteObj);
        this.timeDisplay.textContent = `🎙️ 实测原声: ${pitch.name} (${pitch.frequency.toFixed(1)}Hz · 置信度 ${(pitch.clarity * 100).toFixed(0)}%)`;

        // 动效短暂驻留后平滑淡出
        clearTimeout(lastActiveTimer);
        lastActiveTimer = setTimeout(() => {
          this.renderer.releaseNote(noteObj);
        }, 180);
      };

      await this.micTracker.start();

      if (this.btnMic) {
        this.btnMic.textContent = '🔴 麦克风监听中 (点此关闭)';
        this.btnMic.style.backgroundColor = 'rgba(239, 68, 68, 0.2)';
        this.btnMic.style.color = '#f87171';
        this.btnMic.style.borderColor = '#f87171';
      }
      this.timeDisplay.textContent = '🎙️ 麦克风已开启：请吹哨、哼唱或弹奏器乐';
    } catch (err) {
      console.error('麦克风开启异常:', err);
      alert(`无法访问麦克风: ${err.message}`);
      this.timeDisplay.textContent = '麦克风访问失败';
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

  async _triggerReaper(action) {
    if (this.selectTimbre?.value !== 'reaper') return;
    try {
      if (action === 'play') {
        // 确保 REAPER 轨道 1 开启全通道 MIDI 监听与录音就绪，充当纯净物理建模音源机
        await fetch('/reaper/_/SET/TRACK/1/I_RECINPUT/6112;SET/TRACK/1/RECARM/1;SET/TRACK/1/RECMON/1');
      } else if (action === 'pause' || action === 'stop') {
        this.player.bridge.sendAllOff();
      }
    } catch (e) {
      console.warn('[REAPER API] 触发异常:', e);
    }
  }

  _updateStatusPanel(activeNotes) {
    if (!this.statusBureau) return;

    if (!activeNotes || activeNotes.length === 0) {
      if (this._lastBureauKey !== '') {
        this._lastBureauKey = '';
        this.statusBureau.textContent = '—';
        this.statusBureau.style.color = '#64748b';
        this.statusBureau.style.textShadow = 'none';
      }
      return;
    }

    // 检查活跃三合局
    const bureausFound = new Set();
    for (let i = 0; i < activeNotes.length; i++) {
      const pc = pitchClass(activeNotes[i].midi);
      const angle = pc * SEMITONE_ANGLE;
      const b = bureauOfAngle(angle);
      if (b) bureausFound.add(b);
    }

    if (bureausFound.size > 0) {
      const bList = Array.from(bureausFound);
      const bKey = bList.join(',');
      if (bKey !== this._lastBureauKey) {
        this._lastBureauKey = bKey;
        const bName = bList[0];
        const cfg = BUREAU_COLORS[bName];
        this.statusBureau.textContent = bList.map(b => BUREAU_COLORS[b].name).join(' · ');
        this.statusBureau.style.color = cfg.hex;
        this.statusBureau.style.textShadow = `0 0 10px ${cfg.glow}`;
      }
    } else {
      if (this._lastBureauKey !== 'none') {
        this._lastBureauKey = 'none';
        this.statusBureau.textContent = '—';
        this.statusBureau.style.color = '#64748b';
        this.statusBureau.style.textShadow = 'none';
      }
    }
  }
}

// 启动应用
window.addEventListener('DOMContentLoaded', () => {
  window.spiralApp = new SpiralApp();
});
