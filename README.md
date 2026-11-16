# 螺线谱 Spiral Notation

> **极坐标对数等角螺线音乐可视化与音律基础库 (Foundation / Root Library)**  
> 音级 = 极角（12 地支 × 30°），八度 = 旋转圈数（$r = r_0 \cdot 2^{\theta/2\pi}$），三合局 = 增三和弦（120° 旋转保形）。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Edge Ready](https://img.shields.io/badge/WebAudio-2.5MB%20SoundFont-emerald)](https://asn.git4ta.fun/spiral-notation)

---

## 🌐 线上试玩与门户

* 🏛️ **官方项目门户**：[https://asn.git4ta.fun/spiral-notation](https://asn.git4ta.fun/spiral-notation)
* 🎮 **全屏互动播放器**：[https://asn.git4ta.fun/spiral-notation/player](https://asn.git4ta.fun/spiral-notation/player)
* 📜 **长卷工程落地 (右上角璇玑谱)**：[https://asn.git4ta.fun/handscroll/kunlun-tianwen](https://asn.git4ta.fun/handscroll/kunlun-tianwen)

---

## 💡 为什么需要螺线谱？

传统五线谱（Staff Notation）起源于 11 世纪中世纪修道院，本质是“时间在横轴、离散半音在纵轴”的欧几里得平直网格。在此平面网格中：
1. 八度音程的翻倍只是纵向距离的简单拉扯，切断了自相似收敛性；
2. 和声转调无法在几何上实现旋转保形；
3. 泛音列在频率域的自然向心性被机械切分。

**螺线谱** 将音律还原为纯粹的 **对数等角螺线（Logarithmic Equiangular Spiral）**：
$$r(\theta) = r_0 \cdot 2^{\frac{\theta}{2\pi}}$$

* **音级对应极角**：周天 360° 均匀分立为 12 个 30° 扇区（对应周天十二地支）。子位锚定 C（0°），卯位锚定 D#（90°），未位锚定 G（210°）。所有八度的同名音严格排布在同一条放射状向心射线上。
* **八度对应周回**：频率每翻倍一次（跨越一个八度），极角完整绕行一圈（$\Delta \theta = 2\pi$）。低音向心收缩，高音向外舒展。
* **三合局即增三和弦**：“申子辰、寅午戌、巳酉丑、亥卯未”四组三合局，在几何上恰好为间隔 120° 的正三角形。和声转调表现为纯粹的等角旋转保形变换。

---

## 🎹 音频引擎与 VSTi 宿主互联

1. **轻量内置音源**：
   * 搭载开源 **2.5 MB SoundFont（Acoustic Grand Piano）**，零外部网络依赖，纯前端 WebAudio 驱动，开箱即弹。
   * 支持直接将本地 `.mid` / `.midi` 文件拖入画面解析播放，并内置 YIN 算法实时音频转谱流。

2. **宿主（DAW）与 VSTi 虚拟乐器连接**：
   * 🍏 **macOS (库乐队 GarageBand)**：已实测通过。启用系统自带的 **IAC Driver（虚拟 MIDI 总线）** 配合 WebMIDI 即可零延迟直通库乐队各轨合成器与管弦乐音色。
   * 🪟 **Windows**：**当前暂无官方推荐方案**。由于 Windows 平台配置虚拟 MIDI 路由驱动常常涉及购买第三方商业软件，**本项目原则上不推荐亦不支持任何需要付费购买的商业方案**，全面贯彻纯开源与自由软件精神。

---

## 🛠️ 项目目录结构

```
src/core/pitch.js            音位数学：半音↔角度、有向/劣弧音程、对数螺旋半径计算
src/core/bureau.js           三合局判定：四个增三和弦、120° 旋转保形
src/audio/transcriber.js     音频前置转谱：YIN 算法基频提取 + 离线全曲切片 + 麦克风实时音高流
src/audio/midi-player.js     MIDI 播放与高精度时钟调度器
src/render/logarithmic-spiral.js 对数等角螺线 Canvas 渲染引擎
src/registry/                席位数据与阵列配置
legacy/                      原始原型与演进存证
scripts/transcribe_audio.py  命令行离线音频扒带工具 (MP3/WAV ➔ 标准 MIDI)
scripts/check-registry.mjs   注册表自洽检查
tests/                       核心不变量与基频转录单测
```

---

## 🚀 本地运行与单测

```bash
# 运行核心数学不变量单测
node --test

# 运行注册表自洽检查报告
node scripts/check-registry.mjs
```

---

## 📜 许可证与免责声明 (License & Support Disclaimer)

本项目采用 [MIT License](LICENSE) 开源发布。

> **免责与支持范围声明**：  
> 本仓库作为纯数学与音律几何的基础 Root 库提供，按 **"AS IS"** 现状交付，不附带任何形式的人工技术答疑、环境排错或客制化支持义务。请自由分叉（Fork）、修改并集成至任何开源或商业作品中。
