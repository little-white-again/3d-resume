/**
 * audio.js — Web Audio 程序化音效合成。
 * 不加载任何音频文件，全部实时合成：开火 / 爆炸 / 击中 / 拾取 / 游戏结束。
 * 支持距离衰减 + 低通滤波，营造空间感。
 */
window.BC = window.BC || {};

BC.Audio = class {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.5;
        this.master.connect(this.ctx.destination);
      }
    } catch (e) { /* 无音频环境时静默降级 */ }
  }

  /** 用户交互后恢复 AudioContext（浏览器自动播放策略） */
  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  _noiseBuffer() {
    if (!this._nb) {
      const len = this.ctx.sampleRate * 0.5;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this._nb = buf;
    }
    return this._nb;
  }

  /** 基础发声器：振荡器或噪声 + 包络 */
  _env(gain, t, vol, decay) {
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + decay);
  }

  /** 开火：短促方波 + 噪声爆破 */
  fire(dist = 0) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const vol = Math.max(0.05, 0.35 - dist * 0.02);
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'square';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(80, t + 0.08);
    this._env(g, t, vol, 0.09);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.1);
  }

  /** 爆炸：低频噪声 + 低通衰减，dist 越远越闷 */
  boom(dist = 0) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const vol = Math.max(0.08, 0.6 - dist * 0.04);
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer();
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(900 - dist * 40, t);
    f.frequency.exponentialRampToValueAtTime(120, t + 0.35);
    const g = this.ctx.createGain();
    this._env(g, t, vol, 0.35);
    src.connect(f).connect(g).connect(this.master);
    src.start(t); src.stop(t + 0.4);
  }

  /** 子弹打墙/钢墙：清脆短击 */
  hit() {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer();
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1600;
    const g = this.ctx.createGain();
    this._env(g, t, 0.18, 0.06);
    src.connect(f).connect(g).connect(this.master);
    src.start(t); src.stop(t + 0.08);
  }

  /** 拾取道具：上升琶音 */
  pickup() {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    [440, 660, 880].forEach((fr, i) => {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = fr;
      this._env(g, t + i * 0.07, 0.22, 0.12);
      o.connect(g).connect(this.master);
      o.start(t + i * 0.07); o.stop(t + i * 0.07 + 0.15);
    });
  }

  /** 游戏结束：下行滑音 */
  gameOver() {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(400, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.7);
    this._env(g, t, 0.3, 0.7);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.75);
  }
};
