// GarageBand / CoreMIDI 远端音源直通桥接客户端
// 支持本地 (127.0.0.1:8089) 与内网 Tailscale (100.121.16.28:8089) 自动探测与无缝击弦

export class GarageBandBridge {
  constructor() {
    this.enabled = false;
    this.serverUrl = 'http://127.0.0.1:8089';
    this.fallbackUrl = 'http://100.121.16.28:8089';
    this.activeUrl = this.serverUrl;
    this.isConnected = false;
  }

  async checkConnection() {
    try {
      const res = await fetch(`${this.activeUrl}/`, { method: 'GET', mode: 'cors' });
      if (res.ok) {
        this.isConnected = true;
        return true;
      }
    } catch (e) {
      try {
        const res2 = await fetch(`${this.fallbackUrl}/`, { method: 'GET', mode: 'cors' });
        if (res2.ok) {
          this.activeUrl = this.fallbackUrl;
          this.isConnected = true;
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
    fetch(`${this.activeUrl}/api/note`, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'note_on', pitch, velocity: vel })
    }).catch(() => {});
  }

  sendNoteOff(pitch) {
    if (!this.enabled) return;
    fetch(`${this.activeUrl}/api/note`, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'note_off', pitch })
    }).catch(() => {});
  }

  sendAllOff() {
    if (!this.enabled) return;
    fetch(`${this.activeUrl}/api/note`, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'all_off' })
    }).catch(() => {});
  }
}
