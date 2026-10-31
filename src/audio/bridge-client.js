// GarageBand / CoreMIDI 远端音源直通桥接客户端
// 支持原生 Web MIDI API (零延迟直接握手 IAC 总线) 与 本地 HTTP Hub 双模直通

export class GarageBandBridge {
  constructor() {
    this.enabled = true; // 默认启用
    this.midiOutput = null;
    this.activeUrl = 'http://127.0.0.1:8089';
    this.fallbackUrl = 'http://100.121.16.28:8089';
    this.isConnected = false;
    this.boundName = '';
  }

  async init() {
    // 1. 优先使用 Chrome 原生 Web MIDI API 直通 CoreMIDI IAC 总线（无跨域/无 Mixed-Content 拦截，微秒级延迟）
    if (navigator.requestMIDIAccess) {
      try {
        const midiAccess = await navigator.requestMIDIAccess();
        for (const out of midiAccess.outputs.values()) {
          const name = out.name || '';
          if (name.includes('IAC') || name.includes('Spiral') || name.includes('库乐队') || name.includes('GarageBand')) {
            this.midiOutput = out;
            this.boundName = name;
            this.isConnected = true;
            this.enabled = true;
            console.log('[GarageBandBridge] ✅ Web MIDI 已锁定核心总线:', name);
            return true;
          }
        }
        // 如果没有特定名字，拾取第一个可用输出口
        const firstOut = midiAccess.outputs.values().next().value;
        if (firstOut) {
          this.midiOutput = firstOut;
          this.boundName = firstOut.name;
          this.isConnected = true;
          this.enabled = true;
          console.log('[GarageBandBridge] ✅ Web MIDI 已连接通用端口:', firstOut.name);
          return true;
        }
      } catch (e) {
        console.warn('[GarageBandBridge] Web MIDI 探测异常:', e);
      }
    }

    // 2. 备选方案：HTTP Localhost / Tailscale 桥接
    return await this.checkConnection();
  }

  async checkConnection() {
    try {
      const res = await fetch(`${this.activeUrl}/`, { method: 'GET', mode: 'cors' });
      if (res.ok) {
        this.isConnected = true;
        this.boundName = 'HTTP 127.0.0.1:8089';
        return true;
      }
    } catch (e) {
      try {
        const res2 = await fetch(`${this.fallbackUrl}/`, { method: 'GET', mode: 'cors' });
        if (res2.ok) {
          this.activeUrl = this.fallbackUrl;
          this.isConnected = true;
          this.boundName = 'HTTP Tailscale:8089';
          return true;
        }
      } catch (e2) {}
    }
    this.isConnected = false;
    return false;
  }

  sendNoteOn(pitch, velocity = 0.8) {
    if (!this.enabled) return;
    const vel = Math.round(Math.min(1.0, Math.max(0.1, velocity)) * 127);
    if (this.midiOutput) {
      try {
        this.midiOutput.send([0x90, pitch, vel]);
      } catch (e) {}
      return;
    }
    fetch(`${this.activeUrl}/api/note`, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'note_on', pitch, velocity: vel })
    }).catch(() => {});
  }

  sendNoteOff(pitch) {
    if (!this.enabled) return;
    if (this.midiOutput) {
      try {
        this.midiOutput.send([0x80, pitch, 0]);
      } catch (e) {}
      return;
    }
    fetch(`${this.activeUrl}/api/note`, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'note_off', pitch })
    }).catch(() => {});
  }

  sendAllOff() {
    if (!this.enabled) return;
    if (this.midiOutput) {
      try {
        for (let p = 0; p < 128; p++) {
          this.midiOutput.send([0x80, p, 0]);
        }
      } catch (e) {}
      return;
    }
    fetch(`${this.activeUrl}/api/note`, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'all_off' })
    }).catch(() => {});
  }
}
