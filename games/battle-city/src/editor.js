/**
 * editor.js — 关卡编辑器。
 * 菜单按 E 进入，鼠标点击/拖动放置地块，数字键 1-6 选类型，S 保存，Enter 游玩，Esc 返回。
 */
window.BC = window.BC || {};

BC.Editor = class {
  constructor(game) {
    this.game = game;
    this.tile = BC.TILE.BRICK;       // 当前选中地块（默认砖墙）
    this.layout = this._empty();
    this.tmpMap = new BC.Map();      // 临时地图实例，仅用于渲染
    this._sync();
  }

  /** 空关卡（默认带一个基地） */
  _empty() {
    const g = [];
    for (let y = 0; y < 13; y++) {
      g[y] = [];
      for (let x = 0; x < 13; x++) g[y][x] = BC.TILE.EMPTY;
    }
    g[12][6] = BC.TILE.BASE;
    return g;
  }

  /** 同步临时地图（供渲染复用 Map 的绘制逻辑） */
  _sync() {
    this.tmpMap.layout = this.layout.map(r => r.slice());
    this.tmpMap.originalLayout = this.layout.map(r => r.slice());
    this.tmpMap.hp = [];
    for (let y = 0; y < 13; y++) {
      this.tmpMap.hp[y] = [];
      for (let x = 0; x < 13; x++) {
        const t = this.layout[y][x];
        this.tmpMap.hp[y][x] = t === BC.TILE.BRICK ? BC.CONFIG.wall.brickHp : (t === BC.TILE.BASE ? 1 : 0);
      }
    }
    this.tmpMap.baseAlive = true;
  }

  /** 放置当前选中地块到 (x,y) */
  setTile(x, y) {
    if (x < 0 || y < 0 || x >= 13 || y >= 13) return;
    // 基地只能放底部两行（先校验位置，避免误删旧基地）
    if (this.tile === BC.TILE.BASE && y < 10) return;
    // 基地唯一：放置基地时清除其他基地
    if (this.tile === BC.TILE.BASE) {
      for (let yy = 0; yy < 13; yy++)
        for (let xx = 0; xx < 13; xx++)
          if (this.layout[yy][xx] === BC.TILE.BASE) this.layout[yy][xx] = BC.TILE.EMPTY;
    }
    this.layout[y][x] = this.tile;
    this._sync();
  }

  render(ctx, time) {
    this.tmpMap.render(ctx, time);
    this.tmpMap.renderTop(ctx);
    // 编辑网格线（淡色）
    const T = BC.CONFIG.TILE;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < 13; i++) {
      ctx.moveTo(i * T, 0); ctx.lineTo(i * T, 13 * T);
      ctx.moveTo(0, i * T); ctx.lineTo(13 * T, i * T);
    }
    ctx.stroke();
    // 高亮当前鼠标所在格（由 main 传入 hover 坐标）
    if (this.hoverX != null && this.hoverY != null &&
        this.hoverX >= 0 && this.hoverY >= 0 && this.hoverX < 13 && this.hoverY < 13) {
      ctx.strokeStyle = '#f2c94c';
      ctx.lineWidth = 2;
      ctx.strokeRect(this.hoverX * T, this.hoverY * T, T, T);
    }
    ctx.restore();
  }

  save() {
    try {
      localStorage.setItem('battle_city_custom', JSON.stringify(this.layout));
      return true;
    } catch (e) { return false; }
  }

  load() {
    try {
      const s = localStorage.getItem('battle_city_custom');
      if (!s) return false;
      const arr = JSON.parse(s);
      if (arr.length === 13 && arr[0] && arr[0].length === 13) {
        this.layout = arr;
        this._sync();
        return true;
      }
    } catch (e) {}
    return false;
  }

  /** 校验：至少有一个基地 */
  hasBase() {
    for (let y = 0; y < 13; y++)
      for (let x = 0; x < 13; x++)
        if (this.layout[y][x] === BC.TILE.BASE) return true;
    return false;
  }
};
