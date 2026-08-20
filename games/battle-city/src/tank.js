/**
 * tank.js — 坦克实体：基类 Tank、玩家 PlayerTank、敌方 EnemyTank。
 * 三种敌方坦克外观/属性差异化，见 config.js。
 */
window.BC = window.BC || {};

BC.Tank = class extends BC.Entity {
  constructor(x, y, color) {
    super(x, y);
    this.color = color;
    this.dir = { x: 0, y: -1 };
    this.facing = 'up';
    this.speed = 2;
    this.hp = 1;
    this.cooldown = 0;
    this.owner = 'enemy';
    this.born = 0;      // 出生保护动画帧
    this.hitSize = 36;  // 碰撞盒（略小于格子，贴合精灵视觉，避免"体积大于显示"）
    this.flash = 0;     // 受击白闪计时（hit 时置 6，逐帧递减）
  }

  /** 当前碰撞盒（居中缩小） */
  get hitbox() {
    const ox = (this.size - this.hitSize) / 2;
    return { x: this.x + ox, y: this.y + ox, w: this.hitSize, h: this.hitSize };
  }

  /** 轴分离移动 + 碰撞（墙壁 / 边界 / 其他坦克） */
  move(dx, dy, game) {
    if (dx === 0 && dy === 0) return;
    const ox = this.x, oy = this.y;
    // X 轴
    this.x += dx;
    if (this._blocked(game)) this.x -= dx;
    // Y 轴
    this.y += dy;
    if (this._blocked(game)) this.y -= dy;

    // 像素拖尾：移动时在尾部撒像素块残影（履带扬尘）
    if (game.particles && (this.x !== ox || this.y !== oy)) {
      this.frameOffset = (this.frameOffset || 0) + 1; // 履齿滚动动画
      this.trailAcc = (this.trailAcc || 0) + Math.abs(this.x - ox) + Math.abs(this.y - oy);
      if (this.trailAcc > 7) {
        this.trailAcc = 0;
        const backX = this.cx - this.dir.x * (this.size / 2 + 2);
        const backY = this.cy - this.dir.y * (this.size / 2 + 2);
        const col = this.owner === 'player' ? '#5fce7a' : this.color;
        game.particles.pixelTrail(backX + BC.utils.rand(-4, 4), backY + BC.utils.rand(-4, 4),
          col, BC.utils.randInt(14, 26), BC.utils.randInt(2, 4));
      }
    }
  }

  _blocked(game) {
    const T = game.C.TILE;
    const snap = 0.01;
    const hb = this.hitbox;
    const x = hb.x - snap, y = hb.y - snap, s = hb.w + snap * 2;
    if (x < 0 || y < 0 || x + s > game.map.cols * T || y + s > game.map.rows * T) return true;
    if (game.map.collides(hb.x, hb.y, hb.w)) return true;
    // 与其他坦克碰撞
    const others = game.tanks || [];
    for (const t of others) {
      if (t === this || !t.alive) continue;
      const thb = t.hitbox;
      if (BC.utils.aabb(hb.x, hb.y, hb.w, hb.h, thb.x, thb.y, thb.w, thb.h)) return true;
    }
    return false;
  }

  fire(game, speed) {
    if (this.cooldown > 0) return;
    const cx = this.cx, cy = this.cy;
    const off = this.size / 2 + 2;
    const bx = cx - BC.CONFIG.bullet.size / 2 + this.dir.x * off;
    const by = cy - BC.CONFIG.bullet.size / 2 + this.dir.y * off;
    game.spawnBullet(bx, by, this.dir, speed, this);
    this.cooldown = this._cooldownBase;
    if (this.muzzleFlash) this.muzzleFlash = 4;
  }

  /** 坦克 sprite 资源 key（Kenney CC0），按玩家/敌人类型/Boss 分配不同颜色坦克 */
  _assetKey() {
    if (this.owner === 'player') return 'tankGreen';
    if (this.boss) return 'tankBlack';
    if (this.type === 'patrol') return 'tankBeige';
    if (this.type === 'sniper') return 'tankRed';
    if (this.type === 'rusher') return 'tankBlue';
    return 'tankBeige';
  }

  render(ctx) {
    const cx = this.cx, cy = this.cy;
    const s = this.size;
    const h = s / 2;
    const col = this.color;

    // 平滑旋转：renderAng 向目标角逼近（转向有动画，不瞬间跳变）
    const targetAng = this.facing === 'up' ? 0 : this.facing === 'right' ? Math.PI / 2 :
                      this.facing === 'down' ? Math.PI : -Math.PI / 2;
    if (this.renderAng === undefined) this.renderAng = targetAng;
    let diff = targetAng - this.renderAng;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.renderAng += diff * 0.28; // 平滑插值

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(this.renderAng);

    // 地面阴影（立体感）
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(1, 2, h - 2, h - 5, 0, 0, Math.PI * 2);
    ctx.fill();

    // 履带（左右，深色 + 履齿滚动动画）
    const trackW = 7;
    ctx.fillStyle = '#1a1d22';
    ctx.fillRect(-h, -h + 3, trackW, s - 6);
    ctx.fillRect(h - trackW, -h + 3, trackW, s - 6);
    ctx.fillStyle = '#2f343d';
    const tooth = (this.frameOffset || 0) % 6;
    for (let i = 0; i < 4; i++) {
      const ty = -h + 4 + i * 9 + tooth;
      if (ty > h - 3) continue;
      ctx.fillRect(-h + 1, ty, trackW - 2, 2);
      ctx.fillRect(h - trackW + 1, ty, trackW - 2, 2);
    }

    // 车体（上下渐变 + 高光/阴影边）
    const bodyGrad = ctx.createLinearGradient(0, -h + 3, 0, h - 3);
    bodyGrad.addColorStop(0, BC.utils.shade(col, 35));
    bodyGrad.addColorStop(0.5, col);
    bodyGrad.addColorStop(1, BC.utils.shade(col, -35));
    ctx.fillStyle = bodyGrad;
    ctx.fillRect(-h + trackW, -h + 5, s - trackW * 2, s - 10);
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fillRect(-h + trackW, -h + 5, s - trackW * 2, 2);
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(-h + trackW, h - 7, s - trackW * 2, 2);

    // 炮塔（径向渐变圆顶 + 高光）
    const turretGrad = ctx.createRadialGradient(-2, -3, 1, 0, 0, h - 6);
    turretGrad.addColorStop(0, BC.utils.shade(col, 45));
    turretGrad.addColorStop(1, BC.utils.shade(col, -25));
    ctx.fillStyle = turretGrad;
    ctx.beginPath(); ctx.arc(0, 0, h - 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.beginPath(); ctx.arc(-3, -4, h - 10, 0, Math.PI * 2); ctx.fill();

    // 炮管（横向渐变，从炮塔伸出）
    const barrelGrad = ctx.createLinearGradient(-3, 0, 3, 0);
    barrelGrad.addColorStop(0, BC.utils.shade(col, -25));
    barrelGrad.addColorStop(0.5, BC.utils.shade(col, 15));
    barrelGrad.addColorStop(1, BC.utils.shade(col, -25));
    ctx.fillStyle = barrelGrad;
    ctx.fillRect(-3, -h + 3, 6, h - 8);
    ctx.fillStyle = '#101215';
    ctx.fillRect(-3, -h + 1, 6, 3);

    // 炮口焰
    if (this.muzzleFlash > 0) {
      ctx.fillStyle = 'rgba(255,220,80,' + (this.muzzleFlash / 4) + ')';
      ctx.beginPath();
      ctx.arc(0, -h - 1, 5 + this.muzzleFlash, 0, Math.PI * 2);
      ctx.fill();
      this.muzzleFlash--;
    }

    // 受击白闪（命中瞬间闪白，增强打击感）
    if (this.flash > 0) {
      ctx.globalAlpha = this.flash / 6;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-h, -h, s, s);
      ctx.globalAlpha = 1;
      this.flash--;
    }

    ctx.restore();
  }
};

BC.PlayerTank = class extends BC.Tank {
  constructor(x, y, inputKey, color) {
    super(x, y, color || '#3fae5a');
    this.owner = 'player';
    this.inputKey = inputKey || 'p1';
    this.speed = BC.CONFIG.player.speed;
    this._cooldownBase = BC.CONFIG.player.bulletCooldown;
    this.lives = BC.CONFIG.player.lives;
    this.shieldTimer = 0;   // 护盾剩余帧
    this.rapidTimer = 0;    // 速射剩余帧
    this.pierceTimer = 0;   // 穿甲剩余帧
    this.spawnRing = 0;     // 护盾扩散光环动画计时（获得护盾/重生时触发）
  }

  get cooldownBase() {
    return this.rapidTimer > 0 ? this._cooldownBase / 2 : this._cooldownBase;
  }

  update(dt, game) {
    // 单人模式：P1 方向键+WASD 都可移动；双人模式：P1 方向键、P2 WASD
    let input;
    if (this.inputKey === 'p1') {
      input = game.mode !== 'solo' ? game.input.p1 : game.input.p1solo;
    } else {
      input = game.input.p2;
    }
    let dx = 0, dy = 0;
    if (input.up) dy -= 1;
    if (input.down) dy += 1;
    if (input.left) dx -= 1;
    if (input.right) dx += 1;
    if (dx !== 0 || dy !== 0) {
      // 归一化 + 朝向更新
      const len = Math.hypot(dx, dy);
      dx = dx / len * this.speed;
      dy = dy / len * this.speed;
      this.facing = dx < 0 ? 'left' : dx > 0 ? 'right' : dy < 0 ? 'up' : 'down';
      this.dir = { x: dx < 0 ? -1 : dx > 0 ? 1 : 0, y: dy < 0 ? -1 : dy > 0 ? 1 : 0 };
      this.move(dx, dy, game);
    }
    if (input.fire) {
      this.fire(game, this.pierceTimer > 0 ? game.C.player.bulletSpeed * 1.3 : game.C.player.bulletSpeed);
    }
    if (this.cooldown > 0) this.cooldown--;
    if (this.shieldTimer > 0) this.shieldTimer--;
    if (this.rapidTimer > 0) this.rapidTimer--;
    if (this.pierceTimer > 0) this.pierceTimer--;
    if (this.spawnRing > 0) this.spawnRing--;
  }

  render(ctx) {
    super.render(ctx);
    // 护盾特效
    if (this.shieldTimer > 0) {
      const cx = this.cx, cy = this.cy;
      ctx.save();
      // 护盾光圈（脉动）
      ctx.strokeStyle = 'rgba(74,209,255,' + (0.5 + Math.sin(this.shieldTimer * 0.3) * 0.3) + ')';
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(cx, cy, this.size / 2 + 4, 0, Math.PI * 2); ctx.stroke();
      // 扩散光环（获得护盾/重生瞬间向外扩散一圈，用独立计时器，半径恒为正）
      if (this.spawnRing > 0) {
        const t = 1 - this.spawnRing / 20; // 0→1
        const r = 12 + Math.max(0, t) * 34;
        ctx.globalAlpha = Math.max(0, 1 - t);
        ctx.strokeStyle = '#4ad1ff';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
    }
  }
};

BC.EnemyTank = class extends BC.Tank {
  constructor(x, y, type) {
    const cfg = BC.CONFIG.enemy[type];
    super(x, y, cfg.color);
    this.owner = 'enemy';
    this.type = type;
    this.speed = cfg.speed;
    this._cooldownBase = cfg.cooldown;
    this.hp = cfg.hp;
    this.score = cfg.score;
    this.ai = null;       // 由 ai.js 注入
    this.aiTimer = 0;
    this.path = [];
    this.boss = false;
    this.special = null;   // 特殊能力：invisible/speed/shield/suicide
    this.specialTimer = 0;
  }

  get cooldownBase() { return this._cooldownBase; }

  update(dt, game) {
    this.born++;
    this.specialTimer++;
    if (this.cooldown > 0) this.cooldown--;
    // 特殊能力行为
    if (this.special === 'suicide') {
      const p = game.player;
      if (p && p.alive && BC.utils.dist(this.cx, this.cy, p.cx, p.cy) < 70) {
        // 自爆：范围伤害玩家 + 自身爆炸
        this.alive = false;
        if (game.particles) game.particles.explosion(this.cx, this.cy, '#e24b4a');
        if (game.fx) game.fx.addShake(10);
        game.audio.boom();
        if (p.alive && p.shieldTimer <= 0 && BC.utils.dist(this.cx, this.cy, p.cx, p.cy) < 100) {
          game._playerHit();
        }
        return;
      }
    }
    if (this.ai) this.ai.update(this, game);
  }

  /** 当前是否处于隐身状态（隐形坦克周期性隐身） */
  isInvisible() {
    if (this.special !== 'invisible') return false;
    const t = this.specialTimer % 160;
    return t > 100; // 每 160 帧里 60 帧隐身
  }

  hit(game) {
    this.hp--;
    this.flash = 6; // 受击白闪
    if (this.hp <= 0) {
      this.alive = false;
      game.onEnemyDestroyed(this);
    } else if (this.ai) {
      // 被打后记仇：仇恨提升，越打越激进（去人机感）
      this.ai.aggro++;
    }
  }

  render(ctx) {
    // 隐形坦克：隐身时半透明
    if (this.isInvisible()) { ctx.save(); ctx.globalAlpha = 0.22; }
    super.render(ctx);
    if (this.isInvisible()) ctx.restore();

    // 特殊能力视觉标记
    if (this.special === 'shield') {
      ctx.save();
      ctx.strokeStyle = 'rgba(74,209,255,' + (0.6 + Math.sin(this.specialTimer * 0.2) * 0.3) + ')';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(this.cx, this.cy, this.size / 2 + 3, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    } else if (this.special === 'speed') {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(this.x - 2, this.y - 4); ctx.lineTo(this.x - 2, this.y + 6);
      ctx.moveTo(this.x + this.size + 2, this.y - 4); ctx.lineTo(this.x + this.size + 2, this.y + 6);
      ctx.stroke();
      ctx.restore();
    } else if (this.special === 'suicide') {
      ctx.save();
      ctx.fillStyle = Math.floor(this.specialTimer / 4) % 2 === 0 ? '#ff3030' : '#ff9090';
      ctx.beginPath(); ctx.arc(this.cx, this.cy, 4, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    if (this.boss) {
      ctx.save();
      ctx.strokeStyle = '#e24b4a';
      ctx.lineWidth = 2;
      ctx.strokeRect(this.x - 1, this.y - 1, this.size + 2, this.size + 2);
      ctx.restore();
    }
    // 出生光束动画（从天而降的传送光柱）
    if (this.born < 22) {
      const a = 1 - this.born / 22;
      ctx.save();
      ctx.globalAlpha = a * 0.55;
      ctx.fillStyle = '#4ad1ff';
      ctx.fillRect(this.cx - 4, 0, 8, this.y + this.size / 2);
      ctx.fillStyle = '#c0ecff';
      ctx.fillRect(this.cx - 2, 0, 4, this.y + this.size / 2);
      ctx.restore();
    }
    // 出生保护闪烁
    if (this.born < 30 && Math.floor(this.born / 3) % 2 === 0) {
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = '#fff';
      ctx.fillRect(this.x, this.y, this.size, this.size);
      ctx.restore();
    }
  }
};

/** 基地防御炮台：自动射击最近敌人，可被敌人摧毁 */
BC.Turret = class extends BC.Entity {
  constructor(x, y, owner) {
    super(x, y);
    this.size = 30;
    this.cooldown = 0;
    this.hp = 2;
    this.facing = 'up';
    this.owner = owner || 'turret'; // 'turret' 我方（打敌人） / 'enemy' 敌方（打玩家）
  }

  update(dt, game) {
    if (this.cooldown > 0) this.cooldown--;
    // 找目标：我方炮台打敌人，敌方炮台打玩家
    let target = null, minD = Infinity;
    const range = this.owner === 'enemy' ? 300 : 280;
    if (this.owner === 'enemy') {
      const players = [game.player];
      if (game.player2 && game.player2.alive) players.push(game.player2);
      for (const p of players) {
        if (!p.alive) continue;
        const d = BC.utils.dist(this.cx, this.cy, p.cx, p.cy);
        if (d < minD && d < range) { minD = d; target = p; }
      }
    } else {
      for (const e of game.enemies) {
        if (!e.alive) continue;
        const d = BC.utils.dist(this.cx, this.cy, e.cx, e.cy);
        if (d < minD && d < range) { minD = d; target = e; }
      }
    }
    if (!target) return;
    // 转向目标
    this.facing = Math.abs(target.cx - this.cx) > Math.abs(target.cy - this.cy)
      ? (target.cx > this.cx ? 'right' : 'left')
      : (target.cy > this.cy ? 'down' : 'up');
    // 对齐后开火
    if (this.cooldown <= 0) {
      const dx = Math.abs(target.cx - this.cx) < 14 ? 0 : Math.sign(target.cx - this.cx);
      const dy = Math.abs(target.cy - this.cy) < 14 ? 0 : Math.sign(target.cy - this.cy);
      let dir = { x: dx, y: dy };
      if (dir.x === 0 && dir.y === 0) {
        dir = { x: this.facing === 'left' ? -1 : this.facing === 'right' ? 1 : 0,
                y: this.facing === 'up' ? -1 : this.facing === 'down' ? 1 : 0 };
      }
      game.spawnBullet(this.cx - 4, this.cy - 4, dir, this.owner === 'enemy' ? BC.CONFIG.turret.enemyBulletSpeed : BC.CONFIG.turret.bulletSpeed, this, false);
      this.cooldown = this.owner === 'enemy' ? 50 : 45;
    }
  }

  hit(game) {
    this.hp--;
    if (this.hp <= 0) {
      this.alive = false;
      if (game.particles) game.particles.explosion(this.cx, this.cy, this.owner === 'enemy' ? '#b0483c' : '#8a8e96');
    }
  }

  render(ctx) {
    const cx = this.cx, cy = this.cy;
    const enemy = this.owner === 'enemy';
    const base = enemy ? '#5a2420' : '#4a4e56';
    const dark = enemy ? '#2a0e0c' : '#2a2e34';
    const barrel = enemy ? '#20100e' : '#20242a';
    const dome = enemy ? '#b0483c' : '#8a8e96';
    const shine = enemy ? '#e06a5a' : '#c0c4cc';
    ctx.save();
    ctx.translate(cx, cy);
    // 平滑旋转：炮管指向目标时平滑转动
    const targetAng = this.facing === 'up' ? 0 : this.facing === 'right' ? Math.PI / 2 :
                      this.facing === 'down' ? Math.PI : -Math.PI / 2;
    if (this.renderAng === undefined) this.renderAng = targetAng;
    let diff = targetAng - this.renderAng;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.renderAng += diff * 0.3;
    ctx.rotate(this.renderAng);
    // 底座
    ctx.fillStyle = base;
    ctx.fillRect(-12, -12, 24, 24);
    ctx.fillStyle = dark;
    ctx.fillRect(-10, -10, 20, 20);
    // 炮管
    ctx.fillStyle = barrel;
    ctx.fillRect(-3, -17, 6, 12);
    // 炮塔中心
    ctx.fillStyle = dome;
    ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = shine;
    ctx.beginPath(); ctx.arc(-1, -1, 2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
};
