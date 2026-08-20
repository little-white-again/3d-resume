/**
 * map.js — 地图系统。
 * 13x13 格子地图：砖墙（多阶段破坏）、钢墙（无敌）、水域、草地（半遮挡）、基地。
 * 墙体被击毁后连通性改变，供 AI 动态寻路使用。
 */
window.BC = window.BC || {};

BC.TILE = { EMPTY: 0, BRICK: 1, STEEL: 2, WATER: 3, GRASS: 4, BASE: 5, ENEMY_BASE: 6 };

BC.Map = class {
  constructor() {
    this.C = BC.CONFIG;
    this.cols = this.C.COLS;
    this.rows = this.C.ROWS;
    this.hp = [];
    this.baseAlive = true;
    this.enemyBaseAlive = true;
    this.level = 0;
    this.loadLevel(0);
  }

  /** 加载指定关卡地图（通关后进入下一关） */
  loadLevel(n) {
    this.level = n;
    this.layout = BC.Map.LEVELS[n].map(r => r.slice());
    this.originalLayout = this.layout.map(r => r.slice());
    this.reset();
  }

  reset() {
    this.layout = this.originalLayout.map(r => r.slice()); // 恢复原始地形（墙体被摧毁后会被改写）
    this.hp = [];
    this.baseAlive = true;
    this.enemyBaseAlive = true;
    this.baseHp = this.C.base.hp;          // 我方基地当前血量
    this.baseMaxHp = this.C.base.hp;
    this.enemyBaseHp = this.C.base.enemyHp; // 敌方基地当前血量
    this.enemyBaseMaxHp = this.C.base.enemyHp;
    for (let y = 0; y < this.rows; y++) {
      this.hp[y] = [];
      for (let x = 0; x < this.cols; x++) {
        const t = this.layout[y][x];
        this.hp[y][x] = t === BC.TILE.BRICK ? this.C.wall.brickHp : 0;
      }
    }
  }

  /** 我方基地格子坐标（动态查找，兼容编辑器自建地图） */
  baseTile() {
    for (let y = 0; y < this.rows; y++)
      for (let x = 0; x < this.cols; x++)
        if (this.layout[y][x] === BC.TILE.BASE) return { x, y };
    return { x: 6, y: 12 };
  }

  /** 敌方基地格子坐标 */
  enemyBaseTile() {
    for (let y = 0; y < this.rows; y++)
      for (let x = 0; x < this.cols; x++)
        if (this.layout[y][x] === BC.TILE.ENEMY_BASE) return { x, y };
    return { x: 6, y: 0 };
  }

  tile(x, y) {
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return BC.TILE.STEEL; // 边界视为钢墙
    return this.layout[y][x];
  }

  /** 该格子是否可通行（空地/草地可通行） */
  walkable(x, y) {
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return false;
    const t = this.layout[y][x];
    return t === BC.TILE.EMPTY || t === BC.TILE.GRASS;
  }

  /** 坦克 AABB 移动碰撞检测：新位置是否与不可通行格子重叠 */
  collides(px, py, size) {
    const T = this.C.TILE;
    const x0 = Math.floor(px / T), y0 = Math.floor(py / T);
    const x1 = Math.floor((px + size - 1) / T), y1 = Math.floor((py + size - 1) / T);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (!this.walkable(x, y)) return true;
      }
    }
    return false;
  }

  /** 子弹命中某个格子，返回命中结果 */
  bulletHit(tx, ty, piercing) {
    const t = this.tile(tx, ty);
    if (t === BC.TILE.BRICK) {
      if (piercing) this.hp[ty][tx] = 0;
      else this.hp[ty][tx]--;
      if (this.hp[ty][tx] <= 0) {
        // 关键：摧毁后更新地形为空地，墙体消失、可通行、AI 可穿（动态寻路记忆点）
        this.layout[ty][tx] = BC.TILE.EMPTY;
        return 'destroy';
      }
      return 'hit';
    }
    if (t === BC.TILE.STEEL) return 'steel';
    if (t === BC.TILE.BASE) return 'base';       // 标记，由 bulletCollide 判断敌我后伤害
    if (t === BC.TILE.ENEMY_BASE) return 'enemyBase'; // 标记，同上
    return 'pass';
  }

  /** 我方基地被命中：扣血，血量归零才摧毁（多阶段） */
  damageBase() {
    if (!this.baseAlive) return 'pass';
    this.baseHp--;
    if (this.baseHp <= 0) { this.baseAlive = false; return 'base'; }
    return 'baseHit';
  }

  /** 敌方基地被命中：扣血，血量归零才摧毁 */
  damageEnemyBase() {
    if (!this.enemyBaseAlive) return 'pass';
    this.enemyBaseHp--;
    if (this.enemyBaseHp <= 0) { this.enemyBaseAlive = false; return 'enemyBase'; }
    return 'enemyBaseHit';
  }

  /** 供 A* 使用的可通行矩阵（墙被破坏后实时更新） */
  getWalkableGrid() {
    const g = [];
    for (let y = 0; y < this.rows; y++) {
      g[y] = [];
      for (let x = 0; x < this.cols; x++) {
        const t = this.layout[y][x];
        g[y][x] = (t === BC.TILE.EMPTY || t === BC.TILE.GRASS) ? 1 : 0;
      }
    }
    return g;
  }

  render(ctx, time) {
    const T = this.C.TILE;
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        const t = this.layout[y][x];
        const px = x * T, py = y * T;
        switch (t) {
          case BC.TILE.BRICK: this._drawBrick(ctx, x, y, px, py); break;
          case BC.TILE.STEEL: this._drawSteel(ctx, px, py); break;
          case BC.TILE.WATER: this._drawWater(ctx, px, py, time); break;
          case BC.TILE.BASE: this._drawBase(ctx, px, py, time); break;
          case BC.TILE.ENEMY_BASE: this._drawEnemyBase(ctx, px, py, time); break;
        }
      }
    }
  }

  /** 草地绘制在坦克之上（半透明遮挡） */
  renderTop(ctx) {
    const T = this.C.TILE;
    ctx.save();
    ctx.globalAlpha = 0.65;
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        if (this.layout[y][x] === BC.TILE.GRASS) {
          const px = x * T, py = y * T;
          // 深绿底
          ctx.fillStyle = '#3a7030';
          ctx.fillRect(px, py, T, T);
          // 中绿叠层
          ctx.fillStyle = '#4a8a3c';
          ctx.fillRect(px + 2, py + 2, T - 4, T - 4);
          // 草叶（亮绿细线条）
          ctx.fillStyle = '#6ab050';
          for (let i = 0; i < 8; i++) {
            const gx = px + (i * 9 + x * 5) % (T - 3) + 1;
            const gy = py + (i * 11 + y * 7) % (T - 4) + 2;
            ctx.fillRect(gx, gy, 1, 3);
            ctx.fillRect(gx + 2, gy - 1, 1, 2);
          }
          // 随机小花（确定性 seed，增强丰富度）
          const fs = (x * 3 + y * 5) % 4;
          if (fs === 0) {
            ctx.fillStyle = '#e8e8d0';
            ctx.fillRect(px + 10, py + 18, 2, 2);
            ctx.fillRect(px + 26, py + 10, 2, 2);
          } else if (fs === 1) {
            ctx.fillStyle = '#e0c040';
            ctx.fillRect(px + 18, py + 26, 2, 2);
            ctx.fillRect(px + 30, py + 30, 1, 1);
          }
        }
      }
    }
    ctx.restore();
  }

  _drawBrick(ctx, x, y, px, py) {
    const T = this.C.TILE;
    const hp = this.hp[y][x];
    // 底色（破损时变暗）
    ctx.fillStyle = hp >= 2 ? '#c8602e' : '#8a3a1c';
    ctx.fillRect(px, py, T, T);
    // 2x2 砖块纹理（每块 20x20，颜色微差增强丰富度）
    const bw = T / 2;
    const seed = x * 7 + y * 13;
    const palettes = hp >= 2 ? ['#d97a48', '#c86a3c', '#ce7438', '#d07042'] : ['#a04e26', '#96441c', '#9a4820', '#944620'];
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
      ctx.fillStyle = palettes[(seed + i + j * 2) % 4];
      ctx.fillRect(px + i * bw + 1, py + j * bw + 1, bw - 2, bw - 2);
    }
    // 砖缝（深色十字）
    ctx.fillStyle = '#3a1408';
    ctx.fillRect(px, py + bw - 1, T, 2);
    ctx.fillRect(px + bw - 1, py, 2, T);
    // 受光面（左/上亮，右/下暗）
    ctx.fillStyle = 'rgba(255,180,120,0.3)';
    ctx.fillRect(px, py, T, 2);
    ctx.fillRect(px, py, 2, T);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(px, py + T - 2, T, 2);
    ctx.fillRect(px + T - 2, py, 2, T);
    // 立体渐变（上亮下暗）
    const grad = ctx.createLinearGradient(0, py, 0, py + T);
    grad.addColorStop(0, 'rgba(255,255,255,0.10)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.16)');
    ctx.fillStyle = grad;
    ctx.fillRect(px, py, T, T);
    // 破损阶段：裂纹 + 碎块
    if (hp <= 1) {
      ctx.strokeStyle = '#1a0804';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px + 5, py + 3); ctx.lineTo(px + 15, py + 18); ctx.lineTo(px + 7, py + 34);
      ctx.moveTo(px + 32, py + 5); ctx.lineTo(px + 22, py + 18); ctx.lineTo(px + 30, py + 35);
      ctx.stroke();
      ctx.fillStyle = '#2a0c04';
      ctx.fillRect(px + 26, py + 8, 4, 3);
      ctx.fillRect(px + 6, py + 26, 3, 4);
    }
  }

  _drawSteel(ctx, px, py) {
    const T = this.C.TILE;
    // 外框深灰
    ctx.fillStyle = '#6e727a';
    ctx.fillRect(px, py, T, T);
    // 中央金属面板（亮灰）
    ctx.fillStyle = '#b8bcc4';
    ctx.fillRect(px + 5, py + 5, T - 10, T - 10);
    // 接缝十字
    ctx.fillStyle = '#5a5e66';
    ctx.fillRect(px + T / 2 - 1, py + 4, 2, T - 8);
    ctx.fillRect(px + 4, py + T / 2 - 1, T - 8, 2);
    // 4 角铆钉
    ctx.fillStyle = '#3a3e46';
    ctx.beginPath(); ctx.arc(px + 6, py + 6, 2.2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(px + T - 6, py + 6, 2.2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(px + 6, py + T - 6, 2.2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(px + T - 6, py + T - 6, 2.2, 0, Math.PI * 2); ctx.fill();
    // 高光（左上）
    ctx.fillStyle = '#d8dce4';
    ctx.fillRect(px + 7, py + 7, T - 14, 1);
    ctx.fillRect(px + 7, py + 7, 1, T - 14);
    // 磨损划痕（确定性，3 种变体增强丰富度）
    const sc = (((px / T) * 7 + (py / T) * 13) % 3);
    ctx.strokeStyle = 'rgba(90,94,102,0.9)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (sc === 0) {
      ctx.moveTo(px + 8, py + 12); ctx.lineTo(px + 20, py + 20); ctx.lineTo(px + 16, py + 30);
    } else if (sc === 1) {
      ctx.moveTo(px + 28, py + 8); ctx.lineTo(px + 18, py + 22);
      ctx.moveTo(px + 10, py + 28); ctx.lineTo(px + 24, py + 26);
    }
    ctx.stroke();
    // 金属渐变反射（左上亮、右下暗）
    const mgrad = ctx.createLinearGradient(px, py, px + T, py + T);
    mgrad.addColorStop(0, 'rgba(255,255,255,0.18)');
    mgrad.addColorStop(0.45, 'rgba(255,255,255,0)');
    mgrad.addColorStop(1, 'rgba(0,0,0,0.22)');
    ctx.fillStyle = mgrad;
    ctx.fillRect(px, py, T, T);
  }

  _drawWater(ctx, px, py, time) {
    const T = this.C.TILE;
    // 深浅渐变底
    const wgrad = ctx.createLinearGradient(0, py, 0, py + T);
    wgrad.addColorStop(0, '#2a6ac0');
    wgrad.addColorStop(1, '#1a4a90');
    ctx.fillStyle = wgrad;
    ctx.fillRect(px, py, T, T);
    // 中蓝叠层
    ctx.fillStyle = '#3a7ad0';
    ctx.fillRect(px + 2, py + 2, T - 4, T - 4);
    // 3 条波纹（不同相位动画）
    ctx.fillStyle = '#6a9ae8';
    const w1 = Math.sin(time * 0.04 + py * 0.1) * 4;
    ctx.fillRect(px + 4 + Math.max(0, w1), py + 8, T - 8 - Math.abs(w1), 2);
    const w2 = Math.sin(time * 0.06 + py * 0.15 + 2) * 5;
    ctx.fillRect(px + 4 + Math.max(0, w2), py + 20, T - 8 - Math.abs(w2), 2);
    const w3 = Math.sin(time * 0.05 + py * 0.12 + 4) * 3;
    ctx.fillRect(px + 4 + Math.max(0, w3), py + 30, T - 8 - Math.abs(w3), 2);
    // 高光闪光
    ctx.fillStyle = '#a0d0ff';
    ctx.fillRect(px + 10, py + 12, 4, 1);
    ctx.fillRect(px + 24, py + 26, 5, 1);
  }

  _drawBase(ctx, px, py, time) {
    const T = this.C.TILE;
    if (this.baseAlive) {
      const ratio = this.baseHp / this.baseMaxHp;
      // 砖墙底座
      ctx.fillStyle = '#3a3a44';
      ctx.fillRect(px, py + T - 8, T, 8);
      // 砖缝
      ctx.fillStyle = '#1a1a22';
      ctx.fillRect(px, py + T - 4, T, 1);
      // 鹰徽底色面板（受损越重越暗）
      ctx.fillStyle = BC.utils.shade('#1a1a22', -Math.round((1 - ratio) * 30));
      ctx.fillRect(px + 6, py + 4, T - 12, T - 12);
      // 鹰徽（受损后变暗泛红）
      const eagle = ratio > 0.66 ? '#f2c94c' : ratio > 0.33 ? '#c89a2a' : '#8a6a1a';
      ctx.fillStyle = eagle;
      // 左翅
      ctx.beginPath();
      ctx.moveTo(px + 8, py + 8); ctx.lineTo(px + 20, py + 14);
      ctx.lineTo(px + 12, py + 22); ctx.lineTo(px + 8, py + 28);
      ctx.closePath(); ctx.fill();
      // 右翅
      ctx.beginPath();
      ctx.moveTo(px + T - 8, py + 8); ctx.lineTo(px + T - 20, py + 14);
      ctx.lineTo(px + T - 12, py + 22); ctx.lineTo(px + T - 8, py + 28);
      ctx.closePath(); ctx.fill();
      // 身体
      ctx.fillRect(px + T / 2 - 3, py + 10, 6, 18);
      // 喙
      ctx.fillStyle = '#e09020';
      ctx.fillRect(px + T / 2 - 1, py + 6, 2, 4);
      // 眼
      ctx.fillStyle = '#a02020';
      ctx.fillRect(px + T / 2 - 2, py + 13, 2, 2);
      // 底座支架
      ctx.fillStyle = '#8a5a10';
      ctx.fillRect(px + T / 2 - 7, py + T - 10, 14, 2);
      // 两侧警示灯（受损时变红闪烁）
      ctx.fillStyle = ratio > 0.5 ? '#ff9a3c' : (Math.floor(time / 8) % 2 === 0 ? '#ff3030' : '#801818');
      ctx.fillRect(px + 5, py + T - 6, 3, 3);
      ctx.fillRect(px + T - 8, py + T - 6, 3, 3);
      // 多阶段破损：裂缝 + 冒烟
      if (ratio <= 0.66) {
        ctx.strokeStyle = '#0a0a10';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(px + 6, py + 10); ctx.lineTo(px + 14, py + 20); ctx.lineTo(px + 9, py + 30);
        ctx.moveTo(px + T - 8, py + 12); ctx.lineTo(px + T - 16, py + 22);
        ctx.stroke();
      }
      if (ratio <= 0.33) {
        ctx.fillStyle = 'rgba(20,20,26,0.55)';
        ctx.fillRect(px + 10, py + 16, 8, 6);   // 弹孔
        ctx.strokeStyle = '#0a0a10';
        ctx.beginPath();
        ctx.moveTo(px + 20, py + 8); ctx.lineTo(px + 26, py + 18); ctx.lineTo(px + 20, py + 28);
        ctx.stroke();
        // 冒烟（向上飘的灰烟）
        ctx.fillStyle = 'rgba(120,120,130,0.5)';
        const s1 = Math.sin(time * 0.1 + py) * 2;
        ctx.fillRect(px + 12 + s1, py - 3, 4, 5);
        ctx.fillRect(px + 24 - s1, py - 6, 5, 7);
      }
    } else {
      ctx.fillStyle = '#202020';
      ctx.fillRect(px, py, T, T);
      ctx.fillStyle = '#e24b4a';
      ctx.font = '20px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('✕', px + 20, py + 28);
    }
  }

  /** 敌方基地：红色堡垒 + 骷髅标志（摧毁即胜利），多阶段破损 */
  _drawEnemyBase(ctx, px, py, time) {
    const T = this.C.TILE;
    if (this.enemyBaseAlive) {
      const ratio = this.enemyBaseHp / this.enemyBaseMaxHp;
      // 红色堡垒底座
      ctx.fillStyle = '#5a1a1a';
      ctx.fillRect(px, py + T - 8, T, 8);
      ctx.fillStyle = '#2a0a0a';
      ctx.fillRect(px, py + T - 4, T, 1);
      // 深色面板
      ctx.fillStyle = '#1a0a0a';
      ctx.fillRect(px + 6, py + 4, T - 12, T - 12);
      // 红色骷髅（受损变暗）
      const skull = ratio > 0.66 ? '#e24b4a' : ratio > 0.33 ? '#a83030' : '#701e1e';
      ctx.fillStyle = skull;
      ctx.beginPath(); ctx.arc(px + T / 2, py + 17, 6, 0, Math.PI * 2); ctx.fill(); // 头
      ctx.fillRect(px + T / 2 - 3, py + 22, 6, 6); // 下颌
      // 眼睛
      ctx.fillStyle = '#1a0a0a';
      ctx.fillRect(px + T / 2 - 4, py + 15, 3, 3);
      ctx.fillRect(px + T / 2 + 1, py + 15, 3, 3);
      // 交叉骨
      ctx.fillStyle = '#c8c8c8';
      ctx.fillRect(px + T / 2 - 10, py + 20, 20, 2);
      ctx.fillRect(px + T / 2 - 1, py + 11, 2, 20);
      // 警示灯（受损闪烁）
      ctx.fillStyle = ratio > 0.5 ? '#ff3030' : (Math.floor(time / 8) % 2 === 0 ? '#ff6060' : '#601010');
      ctx.fillRect(px + 5, py + T - 6, 3, 3);
      ctx.fillRect(px + T - 8, py + T - 6, 3, 3);
      // 多阶段破损
      if (ratio <= 0.66) {
        ctx.strokeStyle = '#0a0a0a';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(px + 6, py + 8); ctx.lineTo(px + 14, py + 18); ctx.lineTo(px + 8, py + 28);
        ctx.moveTo(px + T - 8, py + 10); ctx.lineTo(px + T - 15, py + 20);
        ctx.stroke();
      }
      if (ratio <= 0.33) {
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(px + 10, py + 14, 7, 6);
        ctx.fillStyle = 'rgba(150,150,150,0.5)';
        const s2 = Math.sin(time * 0.1 + px) * 2;
        ctx.fillRect(px + 14 + s2, py - 3, 4, 5);
        ctx.fillRect(px + 22 - s2, py - 6, 5, 7);
      }
    } else {
      ctx.fillStyle = '#202020';
      ctx.fillRect(px, py, T, T);
      ctx.fillStyle = '#e24b4a';
      ctx.font = '20px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('✕', px + 20, py + 28);
    }
  }
};

/** 关卡地图（13x13，0空 1砖墙 2钢墙 3水域 4草地 5基地） */
BC.Map.LEVELS = [
  // 第 1 关（简单）
  [
    [0,0,0,0,0,0,6,0,0,0,0,0,0],
    [0,1,0,0,1,0,0,0,1,0,0,1,0],
    [0,1,0,0,1,0,2,0,1,0,0,1,0],
    [0,1,1,0,1,1,2,1,1,0,1,1,0],
    [0,0,0,4,0,0,2,0,0,4,0,0,0],
    [0,1,1,0,1,1,1,1,1,0,1,1,0],
    [0,0,0,4,0,0,0,0,0,4,0,0,0],
    [0,1,1,0,1,1,1,1,1,0,1,1,0],
    [0,0,0,0,0,0,3,0,0,0,0,0,0],
    [0,1,1,0,0,0,0,0,0,0,1,1,0],
    [0,1,0,0,0,0,0,0,0,0,0,1,0],
    [0,0,0,0,0,0,1,0,0,0,0,0,0],
    [0,0,0,0,0,1,5,1,0,0,0,0,0],
  ],
  // 第 2 关（中等，更多钢墙与水）
  [
    [0,0,0,0,0,0,6,0,0,0,0,0,0],
    [0,1,0,0,1,0,0,0,1,0,0,1,0],
    [0,1,0,0,1,0,2,0,1,0,0,1,0],
    [0,1,1,0,1,1,2,1,1,0,1,1,0],
    [0,0,0,4,0,0,2,0,0,4,0,0,0],
    [0,1,1,0,1,1,1,1,1,0,1,1,0],
    [0,0,0,4,0,0,2,0,0,4,0,0,0],
    [0,1,1,0,1,1,1,1,1,0,1,1,0],
    [0,0,0,0,0,0,3,0,0,0,0,0,0],
    [0,1,1,0,0,0,3,0,0,0,1,1,0],
    [0,1,0,0,0,0,0,0,0,0,0,1,0],
    [0,0,0,0,0,0,1,0,0,0,0,0,0],
    [0,0,0,0,0,1,5,1,0,0,0,0,0],
  ],
  // 第 3 关（困难，钢墙+水域+草地混合）
  [
    [0,0,0,0,0,0,6,0,0,0,0,0,0],
    [0,1,0,0,1,0,0,0,1,0,0,1,0],
    [0,1,0,0,1,0,2,0,1,0,0,1,0],
    [0,1,1,0,1,1,2,1,1,0,1,1,0],
    [0,0,0,4,0,0,2,0,0,4,0,0,0],
    [0,1,1,0,1,1,2,1,1,0,1,1,0],
    [0,0,0,4,0,0,0,0,0,4,0,0,0],
    [0,1,1,0,1,1,2,1,1,0,1,1,0],
    [0,0,0,0,0,0,3,0,0,0,0,0,0],
    [0,1,1,0,0,0,3,0,0,0,1,1,0],
    [0,1,0,0,0,0,3,0,0,0,0,1,0],
    [0,0,0,0,0,0,1,0,0,0,0,0,0],
    [0,0,0,0,0,1,5,1,0,0,0,0,0],
  ],
  // 第 4 关（基地保护减弱，更多钢墙水域）
  [
    [0,0,0,0,0,0,6,0,0,0,0,0,0],
    [0,1,0,0,1,0,0,0,1,0,0,1,0],
    [0,1,0,0,1,0,2,0,1,0,0,1,0],
    [0,1,1,0,1,1,2,1,1,0,1,1,0],
    [0,0,0,4,0,0,2,0,0,4,0,0,0],
    [0,1,1,0,1,1,2,1,1,0,1,1,0],
    [0,0,0,4,0,0,2,0,0,4,0,0,0],
    [0,1,1,0,1,1,2,1,1,0,1,1,0],
    [0,0,0,0,0,0,3,0,0,0,0,0,0],
    [0,1,1,0,0,0,3,0,0,0,1,1,0],
    [0,1,0,0,0,0,3,0,0,0,0,1,0],
    [0,0,0,0,0,0,1,0,0,0,0,0,0],
    [0,0,0,0,0,1,5,1,0,0,0,0,0],
  ],
  // 第 5 关（基地裸露，玩家必须死守）
  [
    [0,0,0,0,0,0,6,0,0,0,0,0,0],
    [0,1,0,0,1,0,0,0,1,0,0,1,0],
    [0,1,0,0,1,0,2,0,1,0,0,1,0],
    [0,1,1,0,1,1,2,1,1,0,1,1,0],
    [0,0,0,4,0,0,2,0,0,4,0,0,0],
    [0,1,1,0,1,1,2,1,1,0,1,1,0],
    [0,0,0,4,0,0,2,0,0,4,0,0,0],
    [0,1,1,0,1,1,2,1,1,0,1,1,0],
    [0,0,0,0,0,0,3,0,0,0,0,0,0],
    [0,1,1,0,0,0,3,0,0,0,1,1,0],
    [0,1,0,0,0,0,3,0,0,0,0,1,0],
    [0,0,0,0,0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,5,0,0,0,0,0,0],
  ],
];
