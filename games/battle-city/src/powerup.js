/**
 * powerup.js — 道具拾取系统。
 * 击毁敌人概率掉落，玩家坦克触碰拾取。
 * 类型：护盾/速射/穿甲/电磁脉冲/时间减速/追踪导弹/生命回复。
 * 图标为程序化绘制图形（盾牌/闪电/子弹/波纹/时钟/导弹/心形）。
 */
window.BC = window.BC || {};

BC.POWERUP_TYPES = {
  shield:  { color: '#4ad1ff', desc: '护盾' },
  rapid:   { color: '#ff9a3c', desc: '速射' },
  pierce:  { color: '#ff5a5a', desc: '穿甲' },
  emp:     { color: '#d78bff', desc: '脉冲' },
  time:    { color: '#7aff9a', desc: '减速' },
  missile: { color: '#ffd23c', desc: '导弹' },
  life:    { color: '#ff6b9d', desc: '生命' },
};

BC.PowerUp = class extends BC.Entity {
  constructor() {
    super(0, 0);
    this.size = 30;
    this.type = 'shield';
    this.age = 0;
  }

  init(x, y, type) {
    this.x = x; this.y = y;
    this.type = type;
    this.age = 0;
    this.alive = true;
    return this;
  }

  update(dt, game) {
    this.age++;
    if (this.age > 600) this.alive = false; // 10 秒未拾取消失
    // 被玩家 1 / 玩家 2 拾取
    const players = [game.player];
    if (game.player2) players.push(game.player2);
    for (const p of players) {
      if (p && p.alive && BC.utils.aabb(this.x, this.y, this.size, this.size, p.x, p.y, p.size, p.size)) {
        this.alive = false;
        game.applyPowerUp(this.type, p);
        return;
      }
    }
  }

  render(ctx) {
    const t = BC.POWERUP_TYPES[this.type];
    const pulse = 1 + Math.sin(this.age * 0.15) * 0.12;
    // 生成弹跳：前 12 帧从 0.55 放大到 1（下限不能过低，避免图标绘制半径为负）
    const bornScale = this.age < 12 ? 0.55 + (this.age / 12) * 0.45 : 1;
    const s = this.size * pulse * bornScale;
    // 上下悬浮 + 轻微旋转（更灵动）
    const float = Math.sin(this.age * 0.07) * 3;
    const cx = this.x + this.size / 2, cy = this.y + this.size / 2 + float;
    const wobble = Math.sin(this.age * 0.05) * 0.15;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(wobble);
    ctx.translate(-cx, -cy);
    // 外发光
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = t.color;
    ctx.beginPath(); ctx.arc(cx, cy, s / 2 + 4, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    // 深色底
    ctx.fillStyle = '#20242a';
    ctx.beginPath(); ctx.arc(cx, cy, s / 2, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = t.color;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, s / 2, 0, Math.PI * 2); ctx.stroke();

    // 图形图标
    ctx.fillStyle = t.color;
    ctx.strokeStyle = t.color;
    ctx.lineWidth = 2;
    const c = s / 2 - 7; // 图标绘制半径
    this._drawIcon(ctx, cx, cy, c);
    ctx.restore();
  }

  _drawIcon(ctx, cx, cy, c) {
    if (c < 2) c = 2; // 防止缩放初期半径为负导致 ctx.arc 抛异常
    const type = this.type;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (type === 'shield') {
      // 盾牌
      ctx.beginPath();
      ctx.moveTo(cx, cy - c);
      ctx.lineTo(cx + c * 0.7, cy - c * 0.5);
      ctx.lineTo(cx + c * 0.7, cy + c * 0.3);
      ctx.quadraticCurveTo(cx + c * 0.7, cy + c * 0.9, cx, cy + c);
      ctx.quadraticCurveTo(cx - c * 0.7, cy + c * 0.9, cx - c * 0.7, cy + c * 0.3);
      ctx.lineTo(cx - c * 0.7, cy - c * 0.5);
      ctx.closePath();
      ctx.fill();
    } else if (type === 'rapid') {
      // 闪电
      ctx.beginPath();
      ctx.moveTo(cx + c * 0.3, cy - c);
      ctx.lineTo(cx - c * 0.3, cy);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx - c * 0.3, cy + c);
      ctx.lineTo(cx + c * 0.3, cy);
      ctx.lineTo(cx, cy);
      ctx.closePath();
      ctx.fill();
    } else if (type === 'pierce') {
      // 子弹
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(cx, cy, c * 0.7, 0, Math.PI * 2); ctx.fill();
    } else if (type === 'emp') {
      // 波纹
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, c * 0.35, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, c * 0.7, 0, Math.PI * 2); ctx.stroke();
    } else if (type === 'time') {
      // 时钟
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, c * 0.8, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, cy - c * 0.55); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + c * 0.4, cy); ctx.stroke();
    } else if (type === 'missile') {
      // 导弹
      ctx.beginPath();
      ctx.moveTo(cx, cy - c);
      ctx.lineTo(cx + c * 0.6, cy + c * 0.2);
      ctx.lineTo(cx, cy + c * 0.7);
      ctx.lineTo(cx - c * 0.6, cy + c * 0.2);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ff9a3c';
      ctx.beginPath(); ctx.arc(cx, cy - c * 0.15, c * 0.28, 0, Math.PI * 2); ctx.fill();
    } else if (type === 'life') {
      // 心形
      ctx.beginPath();
      ctx.moveTo(cx, cy + c * 0.8);
      ctx.bezierCurveTo(cx - c * 1.1, cy - c * 0.1, cx - c * 0.6, cy - c * 0.9, cx, cy - c * 0.3);
      ctx.bezierCurveTo(cx + c * 0.6, cy - c * 0.9, cx + c * 1.1, cy - c * 0.1, cx, cy + c * 0.8);
      ctx.fill();
    }
  }
};
