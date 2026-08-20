/**
 * ai.js — 分层 AI 行为，规范的有限状态机（FSM）+ 伪视觉感知层。
 *
 * 状态集合：
 *   PATROL  巡逻：随机游走、随机开火
 *   SEEK    寻路：朝目标移动（A* 动态寻路 / 保持距离）
 *   ATTACK  攻击：转向玩家、对齐射击
 *   RETREAT 后撤：远离玩家
 *   ASSAULT 攻基地：朝我方基地寻路、对齐开火（敌人会主动摧毁基地）
 *
 * 伪视觉系统（perception）：每几帧扫描一次视野，识别四类实体——
 *   玩家（看到 → 攻击）、友方（识别 → 协同/不误伤）、建筑（识别 → 绕行）、
 *   子弹（看到威胁 → 躲避）。视野外的实体"看不见"，不产生反应。
 *
 * 三种敌人 = 三种不同的状态转换图（见 _fsm）。
 */
window.BC = window.BC || {};

BC.AI = class {
  constructor(tank) {
    this.tank = tank;
    this.state = BC.AI.STATE.PATROL;
    this.stateTimer = 0;
    this.replan = 0;
    this.path = [];
    this.patrolDir = { x: 0, y: 0 };
    this.patrolTimer = 0;
    this.assaultCooldown = 0; // 攻基地触发冷却（避免频繁切换）
    this.dodgeTimer = 0;      // 躲避子弹持续帧
    this.dodgeDir = null;     // 当前躲避方向
    // 个性参数：每个敌人随机生成，让同类型敌人也有行为差异（去"人机感"，但保持威胁）
    this.personality = {
      aggression: BC.utils.rand(0.8, 1.5),  // 攻击性：影响攻击距离/开火倾向
      caution: BC.utils.rand(0.7, 1.4),     // 谨慎度：影响后撤时机/躲子弹概率
      reaction: BC.utils.randInt(3, 12),    // 反应延迟帧（短，发现目标"愣一下"就行动）
      aimError: BC.utils.rand(0.02, 0.14),  // 瞄准抖动（小，偶尔失误但总体精准）
    };
    this.aggro = 0;            // 仇恨值：被打后提升，越打越激进
    this.hesitateTimer = 0;    // 巡逻犹豫停顿计时
    // 伪视觉：视野半径（每个敌人略有差异）
    this.visionRange = BC.utils.randInt(260, 320);
    this.perception = null;    // 最近一帧的感知结果
    this.perceiveTimer = 0;    // 感知刷新间隔
  }

  _set(s) {
    if (this.state !== s) { this.state = s; this.stateTimer = 0; }
  }

  update(tank, game) {
    this.stateTimer++;
    const perc = this._perceive(tank, game);
    this._fsm(tank, game, perc);
    this._tryFire(tank, game, perc);
  }

  /**
   * 伪视觉感知：扫描视野，识别玩家 / 友方 / 建筑 / 威胁子弹。
   * 每 3 帧扫描一次（省性能），结果缓存到 this.perception。
   */
  _perceive(tank, game) {
    this.perceiveTimer--;
    if (this.perceiveTimer > 0 && this.perception) return this.perception;
    this.perceiveTimer = 3;
    const v = this.visionRange;

    // 识别玩家（视野内才"看得到"，双人模式下选最近可见的）
    const p = game.player;
    const p2 = game.player2;
    let target = null, targetDist = Infinity;
    const d = (p && p.alive) ? BC.utils.dist(tank.cx, tank.cy, p.cx, p.cy) : Infinity;
    if (p && p.alive && d <= v) { target = p; targetDist = d; }
    const d2 = (p2 && p2.alive) ? BC.utils.dist(tank.cx, tank.cy, p2.cx, p2.cy) : Infinity;
    if (p2 && p2.alive && d2 <= v && d2 < targetDist) { target = p2; targetDist = d2; }
    const seesPlayer = target !== null;

    // 识别威胁子弹：视野内迎面飞来的友方子弹（玩家/炮台）
    let threat = null, threatD = Infinity;
    for (const b of game.bullets) {
      if (!b.alive || !b.owner) continue;
      const team = b.owner.owner;
      if (team !== 'player' && team !== 'turret') continue;
      const bd = BC.utils.dist(tank.cx, tank.cy, b.x, b.y);
      if (bd > v) continue;
      const dx = tank.cx - b.x, dy = tank.cy - b.y;
      const dot = (dx * b.dir.x + dy * b.dir.y) / (bd || 1);
      if (dot > 0.6 && bd < threatD) { threat = b; threatD = bd; }
    }

    // 识别友方（附近队友数量）
    let allies = 0;
    for (const e of game.enemies) {
      if (e !== tank && e.alive && BC.utils.dist(tank.cx, tank.cy, e.cx, e.cy) <= v) allies++;
    }

    this.perception = {
      seesPlayer, player: target, playerDist: targetDist, threat, allies,
    };
    return this.perception;
  }

  /** 状态机主循环：基于感知结果决策（看到玩家才攻击/追击） */
  _fsm(tank, game, perc) {
    const p = perc.player;
    const seesPlayer = perc.seesPlayer;
    const d = perc.playerDist;
    const base = game.map.baseTile();
    const bpx = base.x * game.C.TILE + game.C.TILE / 2;
    const bpy = base.y * game.C.TILE + game.C.TILE / 2;
    const db = BC.utils.dist(tank.cx, tank.cy, bpx, bpy);
    const type = tank.type;

    // 反应延迟：刚切换状态的头 reaction 帧内"观察转向"，不立即行动（去人机感）
    if (this.state !== BC.AI.STATE.PATROL && this.stateTimer < this.personality.reaction) {
      if (seesPlayer && p) this._faceTarget(tank, p);
      return;
    }

    // === 攻基地状态：寻路逼近我方基地并开火 ===
    if (this.state === BC.AI.STATE.ASSAULT) {
      if (!game.map.baseAlive) { this._set(BC.AI.STATE.PATROL); return; }
      this._assault(tank, game, base);
      // 看到玩家逼近且更近 → 回防玩家
      if (seesPlayer && d < db - 60) this._set(type === 'rusher' ? BC.AI.STATE.SEEK : BC.AI.STATE.PATROL);
      return;
    }

    // === 攻基地意图判定 ===
    if (game.map.baseAlive && this._wantAssault(game, db, d, seesPlayer)) {
      this._set(BC.AI.STATE.ASSAULT);
      return;
    }

    // === 原类型状态机（基于感知） ===
    if (type === 'patrol') {
      if (this.state === BC.AI.STATE.ATTACK) {
        if (!seesPlayer || d > 220) { this._set(BC.AI.STATE.PATROL); return; }
        this._attack(tank, game, p);
        if (this.stateTimer > 60) this._set(BC.AI.STATE.PATROL);
      } else {
        this._patrol(tank, game);
        // 看到玩家且够近才攻击（仇恨越高越早进入攻击）
        if (seesPlayer && d < 160 + this.aggro * 25) this._set(BC.AI.STATE.ATTACK);
      }
    } else if (type === 'sniper') {
      if (this.state === BC.AI.STATE.RETREAT) {
        this._retreat(tank, game, p);
        if (this.stateTimer > 40 || d > 220) this._set(BC.AI.STATE.SEEK);
      } else {
        if (seesPlayer) this._keepDistance(tank, game, p);
        else this._patrol(tank, game); // 没看到玩家 → 巡逻
        if (seesPlayer && d < 140) this._set(BC.AI.STATE.RETREAT);
      }
    } else { // rusher
      if (seesPlayer) {
        this._navigate(tank, game, this._goal(tank, game, p));
        if (this._aligned(tank, p)) this._set(BC.AI.STATE.ATTACK);
        else this._set(BC.AI.STATE.SEEK);
      } else {
        this._patrol(tank, game); // 没看到玩家 → 巡逻（攻基地由上方意图处理）
      }
    }
  }

  /** 是否切入攻基地 */
  _wantAssault(game, db, d, seesPlayer) {
    this.assaultCooldown--;
    if (this.assaultCooldown > 0) return false;
    if (!seesPlayer) return true;            // 没看到玩家 → 去攻基地
    if (db < 120 && d > 120) return true;     // 基地比玩家近得多 → 就近打基地
    // 协同进攻：已有队友在攻基地，且自己离基地不远 → 跟进，形成群体压上
    if (db < 280) {
      let assaulting = 0;
      for (const e of game.enemies) {
        if (e !== this.tank && e.alive && e.ai && e.ai.state === BC.AI.STATE.ASSAULT) assaulting++;
      }
      if (assaulting >= 1) return true;
    }
    // 高波次随机攻基地（概率随波次提升）
    const prob = game.wave >= 4 ? 0.008 : game.wave >= 2 ? 0.004 : 0.001;
    if (Math.random() < prob) { this.assaultCooldown = 160; return true; }
    return false;
  }

  /** 攻基地：优先逼近基地正上方（可通行的落点），否则直逼基地 */
  _assault(tank, game, base) {
    const up = { x: base.x, y: base.y - 1 };
    const target = game.map.walkable(up.x, up.y) ? up : base;
    this._navigate(tank, game, target);
  }

  _goal(tank, game, p) {
    // 突击型目标：玩家优先，其次基地
    if (p && p.alive) {
      const dp = BC.utils.dist(tank.cx, tank.cy, p.cx, p.cy);
      const base = game.map.baseTile();
      const db = BC.utils.dist(tank.cx, tank.cy, base.x * game.C.TILE + game.C.TILE / 2, base.y * game.C.TILE + game.C.TILE / 2);
      if (dp < db + 150) return { x: Math.floor(p.cx / game.C.TILE), y: Math.floor(p.cy / game.C.TILE) };
    }
    return game.map.baseTile();
  }

  _aligned(tank, p) {
    if (!p || !p.alive) return false;
    return Math.abs(tank.cx - p.cx) < 14 || Math.abs(tank.cy - p.cy) < 14;
  }

  /** 转向目标（不移动，用于反应延迟期"观察"） */
  _faceTarget(tank, p) {
    if (!p || !p.alive) return;
    const dx = p.cx - tank.cx, dy = p.cy - tank.cy;
    if (Math.abs(dx) > Math.abs(dy)) {
      tank.facing = dx > 0 ? 'right' : 'left';
      tank.dir = { x: dx > 0 ? 1 : -1, y: 0 };
    } else {
      tank.facing = dy > 0 ? 'down' : 'up';
      tank.dir = { x: 0, y: dy > 0 ? 1 : -1 };
    }
  }

  /** ATTACK：转向玩家、原地小幅逼近 */
  _attack(tank, game, p) {
    if (!p || !p.alive) return;
    const dx = Math.sign(p.cx - tank.cx);
    const dy = Math.sign(p.cy - tank.cy);
    if (dx !== 0 && dy !== 0) {
      if (Math.abs(p.cx - tank.cx) > Math.abs(p.cy - tank.cy)) this._applyMove(tank, game, dx, 0);
      else this._applyMove(tank, game, 0, dy);
    } else {
      this._applyMove(tank, game, dx, dy);
    }
  }

  /** RETREAT：远离玩家 */
  _retreat(tank, game, p) {
    if (!p || !p.alive) return;
    let dx = -Math.sign(p.cx - tank.cx);
    let dy = -Math.sign(p.cy - tank.cy);
    if (dx !== 0 && dy !== 0) dy = 0;
    this._applyMove(tank, game, dx, dy);
  }

  /** SEEK(狙击型)：与玩家保持距离，太远接近、太近远离，中间横向游走 */
  _keepDistance(tank, game, p) {
    if (!p || !p.alive) return;
    const d = BC.utils.dist(tank.cx, tank.cy, p.cx, p.cy);
    const keep = 220;
    let dx = 0, dy = 0;
    if (d > keep + 30) { dx = Math.sign(p.cx - tank.cx); dy = Math.sign(p.cy - tank.cy); }
    else if (d < keep - 30) { dx = -Math.sign(p.cx - tank.cx); dy = -Math.sign(p.cy - tank.cy); }
    else { dx = Math.sin(Date.now() * 0.002) > 0 ? 1 : -1; }
    if (dx !== 0 && dy !== 0) dy = 0;
    this._applyMove(tank, game, dx, dy);
  }

  /** 前方是否被建筑挡住（伪视觉识别建筑，用于巡逻绕行） */
  _aheadBlocked(tank, game) {
    const T = game.C.TILE;
    const nx = tank.cx + tank.dir.x * (tank.size / 2 + 6);
    const ny = tank.cy + tank.dir.y * (tank.size / 2 + 6);
    return !game.map.walkable(Math.floor(nx / T), Math.floor(ny / T));
  }

  /** PATROL：随机方向游走，识别建筑绕行，偶尔犹豫停顿（去"匀速机器人"感） */
  _patrol(tank, game) {
    // 犹豫停顿：偶尔停下来"思考"，不一直匀速游走
    if (this.hesitateTimer > 0) {
      this.hesitateTimer--;
      return;
    }
    this.patrolTimer--;
    // 前方有建筑（识别建筑）或计时到期 → 换向
    if (this.patrolTimer <= 0 || this._aheadBlocked(tank, game)) {
      this.patrolTimer = BC.utils.randInt(40, 120);
      const dirs = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];
      this.patrolDir = dirs[BC.utils.randInt(0, 3)];
      // 偶尔犹豫（谨慎型更爱犹豫，但不会太频繁导致"太菜"）
      if (Math.random() < 0.10 * this.personality.caution) {
        this.hesitateTimer = BC.utils.randInt(8, 22);
      }
    }
    this._applyMove(tank, game, this.patrolDir.x, this.patrolDir.y);
  }

  /** 通用：朝目标格子用 A* 寻路并沿路径移动（动态寻路记忆点） */
  _navigate(tank, game, goalTile) {
    this.replan--;
    if (this.replan <= 0 || this.path.length === 0) {
      const grid = game.map.getWalkableGrid();
      const sx = Math.floor(tank.cx / game.C.TILE);
      const sy = Math.floor(tank.cy / game.C.TILE);
      const gx = BC.utils.clamp(goalTile.x, 0, game.C.COLS - 1);
      const gy = BC.utils.clamp(goalTile.y, 0, game.C.ROWS - 1);
      if (grid[gy] && grid[gy][gx]) {
        this.path = BC.utils.astar(grid, game.C.COLS, game.C.ROWS, { x: sx, y: sy }, { x: gx, y: gy }) || [];
      } else {
        this.path = [{ x: gx, y: gy }];
      }
      this.replan = 20;
    }

    let waypoint;
    if (this.path.length > 0) {
      waypoint = this.path[0];
      const wx = waypoint.x * game.C.TILE + game.C.TILE / 2;
      const wy = waypoint.y * game.C.TILE + game.C.TILE / 2;
      if (Math.abs(tank.cx - wx) < 4 && Math.abs(tank.cy - wy) < 4) {
        this.path.shift();
        return;
      }
    } else {
      waypoint = goalTile;
    }

    const wx = (waypoint.x + 0.5) * game.C.TILE;
    const wy = (waypoint.y + 0.5) * game.C.TILE;
    let dx = Math.sign(wx - tank.cx);
    let dy = Math.sign(wy - tank.cy);
    if (Math.abs(wx - tank.cx) < 6) dx = 0;
    if (Math.abs(wy - tank.cy) < 6) dy = 0;
    if (dx !== 0 && dy !== 0) {
      if (Math.abs(wx - tank.cx) > Math.abs(wy - tank.cy)) dy = 0; else dx = 0;
    }
    this._applyMove(tank, game, dx, dy);
  }

  /** 躲避子弹：用感知到的威胁（识别子弹），侧移闪避（持续若干帧） */
  _dodgeDir(tank, game) {
    // 持续躲避中
    if (this.dodgeTimer > 0) {
      this.dodgeTimer--;
      return this.dodgeDir;
    }
    if (game.wave < 2) return null;          // 第 1 波敌人不躲，让玩家先上手
    const chance = Math.min(0.5, 0.1 + game.wave * 0.04);
    if (Math.random() > chance) return null; // 波次越高越会躲
    const threat = this.perception ? this.perception.threat : null;
    if (!threat) return null;
    // 侧移方向：子弹横向飞则上下躲，纵向飞则左右躲（轴对齐）
    let sx = 0, sy = 0;
    if (Math.abs(threat.dir.x) >= Math.abs(threat.dir.y)) sy = (Math.random() < 0.5 ? -1 : 1);
    else sx = (Math.random() < 0.5 ? -1 : 1);
    this.dodgeDir = { x: sx, y: sy };
    this.dodgeTimer = 14;
    return this.dodgeDir;
  }

  _applyMove(tank, game, dx, dy) {
    // 躲避子弹：感知到迎面威胁时侧移闪避
    const dodge = this._dodgeDir(tank, game);
    if (dodge) { dx = dodge.x; dy = dodge.y; }
    if (dx !== 0 || dy !== 0) {
      tank.facing = dx < 0 ? 'left' : dx > 0 ? 'right' : dy < 0 ? 'up' : 'down';
      tank.dir = { x: dx, y: dy };
      const sp = tank.speed * (game.slowTimer > 0 ? 0.45 : 1); // 时间减速道具
      tank.move(dx * sp, dy * sp, game);
    }
  }

  /** 敌人子弹速度（按类型） */
  _bulletSpeed(tank) {
    if (tank.type === 'sniper') return BC.CONFIG.enemy.sniper.bulletSpeed;
    if (tank.type === 'rusher') return BC.CONFIG.enemy.rusher.bulletSpeed;
    return BC.CONFIG.enemy.patrol.bulletSpeed;
  }

  /** 朝目标点开火，带瞄准抖动（敌人不是弹无虚发，aimError 概率打偏） */
  _shootAt(tank, game, px, py, speed) {
    if (tank.cooldown > 0) return;
    let dx = Math.sign(px - tank.cx) || 0;
    let dy = Math.sign(py - tank.cy) || 0;
    if (dx !== 0 && dy !== 0) {
      if (Math.abs(px - tank.cx) > Math.abs(py - tank.cy)) dy = 0; else dx = 0;
    }
    // 瞄准抖动：打偏到垂直方向（高仇恨时更准，aimError 快速收敛）
    const err = Math.max(0.01, this.personality.aimError - this.aggro * 0.03);
    if (Math.random() < err) {
      if (dx !== 0) { dx = 0; dy = Math.random() < 0.5 ? -1 : 1; }
      else if (dy !== 0) { dy = 0; dx = Math.random() < 0.5 ? -1 : 1; }
    }
    const off = tank.size / 2 + 2;
    const bx = tank.cx - BC.CONFIG.bullet.size / 2 + dx * off;
    const by = tank.cy - BC.CONFIG.bullet.size / 2 + dy * off;
    game.spawnBullet(bx, by, { x: dx, y: dy }, speed, tank, false);
    // 仇恨提升射速：越打越上头，冷却越短
    tank.cooldown = Math.max(20, tank._cooldownBase - this.aggro * 2);
    if (tank.muzzleFlash !== undefined) tank.muzzleFlash = 4;
    tank.facing = dx < 0 ? 'left' : dx > 0 ? 'right' : dy < 0 ? 'up' : 'down';
    tank.dir = { x: dx, y: dy };
  }

  /** 对齐某点（同列/同行且大致对齐） */
  _alignedPoint(tank, px, py) {
    return Math.abs(tank.cx - px) < 16 || Math.abs(tank.cy - py) < 16;
  }

  /** 是否面向某点 */
  _facingPoint(tank, px, py) {
    return (tank.facing === 'up' && py < tank.cy) ||
           (tank.facing === 'down' && py > tank.cy) ||
           (tank.facing === 'left' && px < tank.cx) ||
           (tank.facing === 'right' && px > tank.cx);
  }

  /** 最近的可摧毁炮台（射程内） */
  _nearestTurret(tank, game) {
    let best = null, minD = 260;
    for (const t of game.turrets) {
      if (!t.alive) continue;
      const d = BC.utils.dist(tank.cx, tank.cy, t.cx, t.cy);
      if (d < minD) { minD = d; best = t; }
    }
    return best;
  }

  /** Boss 扇形弹幕：朝玩家 + 垂直两侧各一发 */
  _bossBarrage(tank, game) {
    const p = game.player;
    if (!p || !p.alive) return;
    const sp = this._bulletSpeed(tank) * 0.9;
    tank.fire(game, this._bulletSpeed(tank)); // 中央（走 cooldown）
    const dx = Math.sign(p.cx - tank.cx) || 0;
    const dy = Math.sign(p.cy - tank.cy) || (tank.dir.y || -1);
    game.spawnBullet(tank.cx - 4, tank.cy - 4, { x: -dy, y: dx }, sp, tank, false);
    game.spawnBullet(tank.cx - 4, tank.cy - 4, { x: dy, y: -dx }, sp, tank, false);
  }

  /** 开火：攻基地状态打炮台/基地，Boss 弹幕，看到玩家则对齐开火 */
  _tryFire(tank, game, perc) {
    // Boss 扇形弹幕
    if (tank.boss && Math.random() < 0.08) { this._bossBarrage(tank, game); return; }

    // 攻基地状态：优先打炮台（削弱防守火力），其次打基地
    if (this.state === BC.AI.STATE.ASSAULT) {
      const turret = this._nearestTurret(tank, game);
      if (turret && this._alignedPoint(tank, turret.cx, turret.cy) && this._facingPoint(tank, turret.cx, turret.cy)) {
        tank.fire(game, this._bulletSpeed(tank));
        return;
      }
      if (game.map.baseAlive) {
        const base = game.map.baseTile();
        const bcx = base.x * game.C.TILE + game.C.TILE / 2;
        const bcy = base.y * game.C.TILE + game.C.TILE / 2;
        if (this._alignedPoint(tank, bcx, bcy) && this._facingPoint(tank, bcx, bcy)) {
          tank.fire(game, this._bulletSpeed(tank));
          return;
        }
      }
    }

    const p = perc.player;
    if (!p || !p.alive) return; // 没看到玩家 → 不开火
    const aligned = this._aligned(tank, p);
    const facingPlayer =
      (tank.facing === 'up' && p.cy < tank.cy) ||
      (tank.facing === 'down' && p.cy > tank.cy) ||
      (tank.facing === 'left' && p.cx < tank.cx) ||
      (tank.facing === 'right' && p.cx > tank.cx);

    if (tank.type === 'patrol') {
      if (Math.random() < 0.03 + this.aggro * 0.005) tank.fire(game, game.C.enemy.patrol.bulletSpeed);
    } else if (tank.type === 'sniper') {
      if (aligned) this._shootAt(tank, game, p.cx, p.cy, game.C.enemy.sniper.bulletSpeed);
    } else {
      if (aligned && facingPlayer) this._shootAt(tank, game, p.cx, p.cy, game.C.enemy.rusher.bulletSpeed);
    }
  }
};

BC.AI.STATE = {
  PATROL: '巡逻',
  SEEK: '追击',
  ATTACK: '攻击',
  RETREAT: '后撤',
  ASSAULT: '攻基地',
};
