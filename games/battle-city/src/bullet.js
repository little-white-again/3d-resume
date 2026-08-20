/**
 * bullet.js — 子弹。
 * 支持打钢墙反弹（maxBounce 次）、穿甲（piercing，击穿砖墙）。
 * 由游戏主循环做对象池管理，命中后置 alive=false。
 */
window.BC = window.BC || {};

BC.Bullet = class extends BC.Entity {
  constructor() {
    super(0, 0);
    this.size = BC.CONFIG.bullet.size;
    this.dir = { x: 0, y: 0 };
    this.speed = 6;
    this.owner = null;        // 发射者（'player' 或敌方坦克）
    this.piercing = false;    // 穿甲弹
    this.bounces = 0;         // 已反弹次数
    this.trail = [];          // 拖尾（用于发光尾迹）
    this.homing = false;      // 追踪导弹
    this.homingTarget = null;
  }

  init(x, y, dir, speed, owner, piercing) {
    this.x = x; this.y = y;
    this.dir = dir;
    this.speed = speed;
    this.owner = owner;
    this.piercing = !!piercing;
    this.bounces = 0;
    this.alive = true;
    this.trail = [];
    this.homing = false;
    this.homingTarget = null;
    return this;
  }

  update(dt, game) {
    // 追踪导弹：每帧转向最近目标
    if (this.homing && this.homingTarget && this.homingTarget.alive) {
      const dx = Math.sign(this.homingTarget.cx - this.x) || 0;
      const dy = Math.sign(this.homingTarget.cy - this.y) || 0;
      if (dx !== 0 || dy !== 0) this.dir = { x: dx, y: dy };
    }
    this.trail.push({ x: this.x, y: this.y });
    if (this.trail.length > 6) this.trail.shift();

    this.x += this.dir.x * this.speed;
    this.y += this.dir.y * this.speed;

    // 出界销毁
    if (this.x < 0 || this.y < 0 ||
        this.x + this.size > game.map.cols * game.C.TILE ||
        this.y + this.size > game.map.rows * game.C.TILE) {
      this.alive = false;
      return;
    }

    const result = game.bulletCollide(this);
    if (!this.alive) return;
    // 若命中钢墙且未达反弹上限，则反弹
    if (result === 'steel' && this.bounces < BC.CONFIG.bullet.maxBounce) {
      this.bounces++;
      // 根据飞行方向与撞击点近似反弹：先退回，再反转
      this.x -= this.dir.x * this.speed;
      this.y -= this.dir.y * this.speed;
      // 精确反弹：判断撞击的是水平还是垂直面（简化：反转分量）
      const tx = Math.floor((this.x + this.size / 2) / game.C.TILE);
      const ty = Math.floor((this.y + this.size / 2) / game.C.TILE);
      // 探测邻近哪一侧是钢墙，反转对应轴
      const cx = this.x + this.size / 2, cy = this.y + this.size / 2;
      const left = game.map.tile(tx - 1, ty) === BC.TILE.STEEL;
      const right = game.map.tile(tx + 1, ty) === BC.TILE.STEEL;
      const up = game.map.tile(tx, ty - 1) === BC.TILE.STEEL;
      const down = game.map.tile(tx, ty + 1) === BC.TILE.STEEL;
      if (left || right) this.dir.x = -this.dir.x;
      if (up || down) this.dir.y = -this.dir.y;
      game.audio.hit();
    }
  }

  render(ctx) {
    // 发光拖尾
    for (let i = 0; i < this.trail.length; i++) {
      const a = (i + 1) / this.trail.length * 0.5;
      ctx.fillStyle = 'rgba(255,220,120,' + a + ')';
      const t = this.trail[i];
      ctx.fillRect(t.x + 1, t.y + 1, this.size - 2, this.size - 2);
    }
    // Kenney 子弹 sprite：玩家用 yellow，敌方用 red
    const key = this.owner && this.owner.owner === 'player' ? 'bulletYellow' : 'bulletRed';
    const img = BC.assets && BC.assets.loaded[key];
    if (img) {
      ctx.drawImage(img, this.x, this.y, this.size, this.size);
    } else {
      // fallback：纯色方块
      ctx.fillStyle = '#fff';
      ctx.fillRect(this.x, this.y, this.size, this.size);
      ctx.fillStyle = this.piercing ? '#ff5a5a' : '#ffe066';
      ctx.fillRect(this.x + 2, this.y + 2, this.size - 4, this.size - 4);
    }
  }
};
