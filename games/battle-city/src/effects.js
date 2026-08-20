/**
 * effects.js — 粒子系统、爆炸、屏幕震动、命中顿帧、CRT 复古滤镜。
 * 粒子类型：spark(火花) / smoke(烟雾) / pixel(像素拖尾块)。
 * 视觉思路参考 React Bits 的 Pixel Trail（像素拖尾）与 Grainient（胶片颗粒）。
 */
window.BC = window.BC || {};

/** 粒子池：火花 + 烟雾 + 像素拖尾 */
BC.Particles = class {
  constructor(max) {
    this.max = max;
    this.pool = [];
    for (let i = 0; i < max; i++) {
      this.pool.push({ alive: false });
    }
    this.idx = 0;
  }

  _next() {
    for (let i = 0; i < this.max; i++) {
      const p = this.pool[this.idx];
      this.idx = (this.idx + 1) % this.max;
      if (!p.alive) return p;
    }
    return this.pool[this.idx]; // 池满时复用最旧
  }

  spawn(x, y, vx, vy, life, color, size, type) {
    const p = this._next();
    p.alive = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy;
    p.life = life; p.maxLife = life; p.color = color; p.size = size; p.type = type;
  }

  /** 像素拖尾块：几乎静止、逐渐淡出的方形像素（Pixel Trail 思路） */
  pixelTrail(x, y, color, life, size) {
    this.spawn(x, y, BC.utils.rand(-0.4, 0.4), BC.utils.rand(-0.4, 0.4),
      life || 20, color, size || 3, 'pixel');
  }

  explosion(x, y, color) {
    // 冲击波圆环（扩散）
    this.spawn(x, y, 0, 0, 16, color, 4, 'shockwave');
    // 火花
    for (let i = 0; i < 22; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = BC.utils.rand(1, 4.5);
      this.spawn(x, y, Math.cos(a) * sp, Math.sin(a) * sp, BC.utils.randInt(12, 30), color, BC.utils.rand(2, 5), 'spark');
    }
    // 烟雾
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = BC.utils.rand(0.3, 1.2);
      this.spawn(x + BC.utils.rand(-6, 6), y + BC.utils.rand(-6, 6), Math.cos(a) * sp, Math.sin(a) * sp, BC.utils.randInt(30, 60), '#5a5a5a', BC.utils.rand(4, 9), 'smoke');
    }
    // 像素碎块（爆炸崩出的像素）
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = BC.utils.rand(0.6, 2.6);
      this.spawn(x, y, Math.cos(a) * sp, Math.sin(a) * sp, BC.utils.randInt(15, 40), color, BC.utils.randInt(2, 5), 'pixel');
    }
  }

  update() {
    for (const p of this.pool) {
      if (!p.alive) continue;
      p.life--;
      if (p.life <= 0) { p.alive = false; continue; }
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.94;
      p.vy *= 0.94;
    }
  }

  render(ctx) {
    for (const p of this.pool) {
      if (!p.alive) continue;
      const t = p.life / p.maxLife;
      if (p.type === 'shockwave') {
        // 冲击波：扩散圆环
        const r = (1 - t) * 30 + 4;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = t * 0.8;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke();
      } else if (p.type === 'pixel') {
        // 像素块：实心方块，普通混合，随寿命淡出
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = Math.min(1, t * 1.5);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, p.y, p.size, p.size);
      } else if (p.type === 'spark') {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = t;
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      } else {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = t * 0.4;
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }
};

/** 屏幕震动 / 顿帧 / CRT 滤镜 */
BC.FX = class {
  constructor() {
    this.shake = 0;
    this.hitStop = 0;
    this.crt = BC.CONFIG.crt.enabled;
  }

  addShake(n) { this.shake = Math.max(this.shake, n); }
  stop(frames) { this.hitStop = frames; }

  /** 抖动偏移（渲染时使用） */
  offset() {
    if (this.shake <= 0) return { x: 0, y: 0 };
    return { x: BC.utils.rand(-this.shake, this.shake), y: BC.utils.rand(-this.shake, this.shake) };
  }

  update() {
    this.shake *= 0.85;
    if (this.shake < 0.3) this.shake = 0;
    if (this.hitStop > 0) this.hitStop--;
  }

  /** 渲染 CRT 复古滤镜（扫描线 + 暗角 + 胶片颗粒） */
  renderCRT(ctx, w, h, time) {
    if (!this.crt) return;
    const C = BC.CONFIG.crt;
    ctx.save();

    // 扫描线
    ctx.fillStyle = 'rgba(0,0,0,' + C.scanlineAlpha + ')';
    for (let y = 0; y < h; y += 3) {
      ctx.fillRect(0, y, w, 1);
    }

    // 暗角（径向渐变）
    const g = ctx.createRadialGradient(w / 2, h / 2, h * 0.45, w / 2, h / 2, h * 0.85);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,' + C.vignette + ')');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // 胶片颗粒（Grainient 思路：带灰度的动画噪点）
    if (C.grain > 0) {
      const n = Math.floor(w * h / 600 * C.grain);
      ctx.globalAlpha = Math.min(1, C.grain * 6);
      for (let i = 0; i < n; i++) {
        const v = Math.floor(Math.random() * 180) + 40;
        ctx.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')';
        ctx.fillRect(Math.random() * w, Math.random() * h, C.grainSize, C.grainSize);
      }
    }
    ctx.restore();
  }
};
