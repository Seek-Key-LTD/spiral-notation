// GarageBand / CoreMIDI 远端音源直通桥接客户端
// 支持原生 Web MIDI API (零延迟直接握手 IAC 总线) 与 本地 HTTP Hub 双模直通

export class GarageBandBridge {
  constructor() {
    this.enabled = true; // 默认启用
    this.midiOutput = null;
    this.activeUrl = '/bridge'; // 统一由 Caddy HTTPS 反代直通 MBP 8089，无 Mixed-Content/CORS 阻隔
    this.fallbackUrl = 'http://127.0.0.1:8089';
    this.isConnected = false;
    this.boundName = '';
  }

  async init() {
    // 1. 本机优先：若在 MBP 本机运行，尝试直通原生 Web MIDI
    if (typeof navigator !== 'undefined' && navigator.requestMIDIAccess) {
      try {
        const midiAccess = await navigator.requestMIDIAccess();
        const outputs = Array.from(midiAccess.outputs.values());
        let matched = outputs.find(out => {
          const n = (out.name || '').toLowerCase();
          return n.includes('iac') || n.includes('总线') || n.includes('bus') || n.includes('spiral') || n.includes('piano') || n.includes('garageband') || n.includes('库乐队');
        });
        if (matched) {
          this.midiOutput = matched;
          this.boundName = `Web MIDI (${matched.name})`;
          this.isConnected = true;
          this.enabled = true;
          console.log('[Bridge] ✅ 本机 Web MIDI 已锁定输出总线:', matched.name);
          return true;
        }
      } catch (e) {}
    }

    // 2. 跨机直通：如果在 Mac Mini / 其他设备上，通过 /bridge 统一将音符推给 MacBook Pro
    return await this.checkConnection();
  }

  async checkConnection() {
    try {
      const res = await fetch(`${this.activeUrl}/`, { method: 'GET', signal: AbortSignal.timeout(1500) });
      if (res.ok) {
        this.isConnected = true;
        this.boundName = 'MBP 音频枢纽 (HTTPS直通)';
        console.log('[Bridge] ✅ 跨机音频网桥已联通 MacBook Pro');
        return true;
      }
    } catch (e) {
      try {
        const res2 = await fetch(`${this.fallbackUrl}/`, { method: 'GET', signal: AbortSignal.timeout(1000) });
        if (res2.ok) {
          this.activeUrl = this.fallbackUrl;
          this.isConnected = true;
          this.boundName = 'MBP 本地 (127.0.0.1:8089)';
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
    if (this.isConnected) {
      fetch(`${this.activeUrl}/api/note`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'note_on', pitch, velocity: vel })
      }).catch(() => {});
    }
  }

  sendNoteOff(pitch) {
    if (!this.enabled) return;
    if (this.midiOutput) {
      try {
        this.midiOutput.send([0x80, pitch, 0]);
      } catch (e) {}
      return;
    }
    if (this.isConnected) {
      fetch(`${this.activeUrl}/api/note`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'note_off', pitch })
      }).catch(() => {});
    }
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
    if (this.isConnected) {
      fetch(`${this.activeUrl}/api/note`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'all_off' })
      }).catch(() => {});
    }
  }
}
