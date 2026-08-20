/**
 * entity.js — 实体基类。
 * 所有游戏对象（坦克、子弹、道具等）继承此基类，统一 update/render 接口。
 */
window.BC = window.BC || {};

BC.Entity = class {
  constructor(x, y) {
    this.x = x;         // 左上角像素坐标
    this.y = y;
    this.size = BC.CONFIG.TANK_SIZE;
    this.alive = true;  // 标记是否存活，false 后由游戏主循环回收
  }

  update(dt, game) { /* 子类实现 */ }
  render(ctx) { /* 子类实现 */ }

  /** AABB 中心点 */
  get cx() { return this.x + this.size / 2; }
  get cy() { return this.y + this.size / 2; }

  get rect() { return { x: this.x, y: this.y, w: this.size, h: this.size }; }
};
