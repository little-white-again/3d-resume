/**
 * game.js — 游戏主逻辑：状态机、波次、碰撞、得分、道具。
 */
window.BC = window.BC || {};

BC.GAME = {
  VICTORY_WAVE: 5,      // 通关波数（演示用）
  STATES: { MENU: 0, PLAYING: 1, PAUSED: 2, VICTORY: 3, DEFEAT: 4, EDITOR: 5 },
};

BC.Game = class {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.C = BC.CONFIG;
    this.map = new BC.Map();
    this.editor = new BC.Editor(this);
    this.input = new BC.Input();
    this.audio = new BC.Audio();
    this.particles = new BC.Particles(this.C.fx.maxParticles);
    this.fx = new BC.FX();
    this.bulletPool = [];
    for (let i = 0; i < 60; i++) this.bulletPool.push(new BC.Bullet());

    this.hardcore = false;   // 硬核模式
    this.hardcoreMul = 1;    // 难度系数
    this.mode = 'solo';      // 模式：solo 单人 / coop 双人合作 / pvp 双人对战
    this.pvpWinner = null;   // 对战模式的胜者（1 或 2）
    this.highscore = 0;
    try { this.highscore = parseInt(localStorage.getItem('battle_city_highscore')) || 0; } catch (e) {}

    this.state = BC.GAME.STATES.MENU;
    this.reset();
  }

  reset() {
    this.level = 0;
    this.map.loadLevel(0);
    this.player = new BC.PlayerTank(4 * this.C.TILE, 12 * this.C.TILE, 'p1');
    this.player2 = null;          // 双人模式下的玩家 2
    this.lives2 = this.C.player.lives;
    this.enemies = [];
    this.bullets = [];
    this.powerups = [];
    this.turrets = [];
    this.enemyTurrets = [];   // 敌方防御炮台（攻击玩家）
    this.tanks = [this.player];

    this.score = 0;
    this.lives = this.C.player.lives;
    this.wave = 0;
    this.waveQueue = [];
    this.spawnTimer = 0;
    this.bossPending = false;
    this.empTimer = 0;
    this.slowTimer = 0;   // 时间减速剩余帧
    this.combo = 0;
    this.comboTimer = 0;
    this.popups = []; // 屏幕提示 {text,color,timer}
    this.deadTimer = 0;   // 玩家重生/结束延迟
    this.deadTimer2 = 0;  // 玩家 2 重生延迟
    this.frameCount = 0;
    this.pendingLevelUp = false; // 延迟进关标志（在子弹遍历完成后执行，避免遍历中改数组）
    this.pendingViaBase = false;

    // 子弹池全部复位
    for (const b of this.bulletPool) b.alive = false;
    this._clearBullets();

    this.input.onKeyDown = (code) => this._onKey(code);
  }

  start() {
    this.reset();
    this.state = BC.GAME.STATES.PLAYING;
    this.pvpWinner = null;
    // 硬核模式：生命减半、敌人更快、射击更快、道具减半
    if (this.hardcore) {
      this.lives = 1;
      this.lives2 = 1;
      this.hardcoreMul = 1.35;
    } else {
      this.hardcoreMul = 1;
    }
    // 双人模式（合作/对战）：创建玩家 2（基地右侧，蓝色）
    if (this.mode !== 'solo') {
      this.player2 = new BC.PlayerTank(8 * this.C.TILE, 12 * this.C.TILE, 'p2', '#4a9fe0');
      this.player2.shieldTimer = 90; this.player2.spawnRing = 20;
      this.tanks = [this.player, this.player2];
    }
    if (this.mode === 'pvp') {
      // 对战模式：无敌人、无炮台、无波次，纯玩家互射
      this.waveQueue = [];
      this.turrets = [];
      this.enemyTurrets = [];
    } else {
      this.spawnTurret();
      this.startWave();
    }
  }

  /** 基地防御炮台：我方基地上方两侧（打敌人）+ 敌方基地下方两侧（打玩家） */
  spawnTurret() {
    this.turrets = [];
    this.enemyTurrets = [];
    const T = this.C.TILE;
    const half = (T - 30) / 2;
    // 我方炮台：我方基地上方两侧
    const base = this.map.baseTile();
    const allySpots = [
      { x: Math.max(0, base.x - 1), y: Math.max(0, base.y - 1) },
      { x: Math.min(this.C.COLS - 1, base.x + 1), y: Math.max(0, base.y - 1) },
    ];
    for (const s of allySpots) {
      this.turrets.push(new BC.Turret(s.x * T + half, s.y * T + half, 'turret'));
    }
    // 敌方炮台：敌方基地下方两侧
    const eb = this.map.enemyBaseTile();
    const enemySpots = [
      { x: Math.max(0, eb.x - 1), y: Math.min(this.C.ROWS - 1, eb.y + 1) },
      { x: Math.min(this.C.COLS - 1, eb.x + 1), y: Math.min(this.C.ROWS - 1, eb.y + 1) },
    ];
    for (const s of enemySpots) {
      this.enemyTurrets.push(new BC.Turret(s.x * T + half, s.y * T + half, 'enemy'));
    }
  }

  startWave() {
    this.wave++;
    const count = Math.min(20, Math.floor(this.C.wave.baseCount * Math.pow(1.18, this.wave - 1))); // 敌人数量指数增长（上限 20）
    this.waveQueue = [];
    for (let i = 0; i < count; i++) this.waveQueue.push(this._pickType());
    this.spawnTimer = this.C.wave.spawnInterval;
    this.bossPending = (this.wave % this.C.wave.bossEvery === 0);
    // 波次提示
    this.spawnPopup('第 ' + this.wave + ' 波' + (this.bossPending ? ' · BOSS!' : ''), '#f2c94c', 70);
  }

  _pickType() {
    const w = this.wave;
    // 波次越后，高级 AI 占比越高
    const roll = Math.random();
    if (w >= 4 && roll < 0.25) return 'rusher';
    if (w >= 3 && roll < 0.55) return 'sniper';
    return 'patrol';
  }

  _onKey(code) {
    if (this.state === BC.GAME.STATES.MENU) {
      // 菜单：W/S 切难度，A/D 切人数，E 编辑器，Enter/Space 开始
      if (code === 'ArrowUp' || code === 'ArrowDown' || code === 'KeyW' || code === 'KeyS') {
        this.hardcore = !this.hardcore;
        this.audio.hit();
      } else if (code === 'ArrowLeft' || code === 'ArrowRight' || code === 'KeyA' || code === 'KeyD') {
        // A/D 循环三模式：单人 → 双人合作 → 双人对战
        this.mode = this.mode === 'solo' ? 'coop' : this.mode === 'coop' ? 'pvp' : 'solo';
        this.audio.hit();
      } else if (code === 'KeyE') {
        this.editor.load();  // 尝试加载已保存关卡
        this.state = BC.GAME.STATES.EDITOR;
      } else if (code === 'Enter' || code === 'Space') {
        this.audio.resume();
        this.start();
      }
    } else if (this.state === BC.GAME.STATES.EDITOR) {
      // 编辑器：数字键选地块，S 保存，Enter 游玩，Esc 返回
      const tileMap = {
        Digit1: BC.TILE.EMPTY, Digit2: BC.TILE.BRICK, Digit3: BC.TILE.STEEL,
        Digit4: BC.TILE.WATER, Digit5: BC.TILE.GRASS, Digit6: BC.TILE.BASE, Digit7: BC.TILE.ENEMY_BASE,
      };
      if (tileMap[code] !== undefined) {
        this.editor.tile = tileMap[code];
        this.audio.hit();
      } else if (code === 'KeyS') {
        this.editor.save();
        this.audio.pickup();
      } else if (code === 'Enter') {
        this.audio.resume();
        this.playCustom();
      } else if (code === 'Escape') {
        this.state = BC.GAME.STATES.MENU;
      }
    } else if (this.state === BC.GAME.STATES.PLAYING && code === 'KeyP') {
      this.state = BC.GAME.STATES.PAUSED;
    } else if (this.state === BC.GAME.STATES.PAUSED && code === 'KeyP') {
      this.state = BC.GAME.STATES.PLAYING;
    } else if (this.state === BC.GAME.STATES.PLAYING && code === 'F2') {
      this.fx.crt = !this.fx.crt;
    } else if (code === 'F3') {
      this.showDebug = !this.showDebug;
    } else if ((this.state === BC.GAME.STATES.VICTORY || this.state === BC.GAME.STATES.DEFEAT) && code === 'Enter') {
      this.state = BC.GAME.STATES.MENU;
      this.reset();
    }
  }

  /** 对象池取子弹 */
  spawnBullet(x, y, dir, speed, owner, piercing) {
    for (const b of this.bulletPool) {
      if (!b.alive) {
        b.init(x, y, dir, speed, owner, piercing);
        this.bullets.push(b);
        return;
      }
    }
  }

  _clearBullets() { this.bullets = []; }

  update(dt) {
    this.frameCount++;
    if (this.state !== BC.GAME.STATES.PLAYING) return;
    this.fx.update();
    if (this.fx.hitStop > 0) return; // 顿帧：世界暂停

    // 玩家
    if (this.player.alive) this.player.update(dt, this);
    if (this.player2 && this.player2.alive) this.player2.update(dt, this);

    // 敌人
    if (this.empTimer > 0) this.empTimer--;
    if (this.slowTimer > 0) this.slowTimer--;
    this._spawnLogic();
    for (const e of this.enemies) {
      if (e.alive && this.empTimer <= 0) e.update(dt, this);
    }

    // 基地防御炮台（我方打敌人 + 敌方打玩家）
    for (const t of this.turrets) if (t.alive) t.update(dt, this);
    for (const t of this.enemyTurrets) if (t.alive) t.update(dt, this);

    // 子弹
    for (const b of this.bullets) if (b.alive) b.update(dt, this);

    // 道具
    for (const p of this.powerups) if (p.alive) p.update(dt, this);

    // 粒子
    this.particles.update();

    // 清理
    this.enemies = this.enemies.filter(e => e.alive);
    this.powerups = this.powerups.filter(p => p.alive);
    this.bullets = this.bullets.filter(b => b.alive);
    this.turrets = this.turrets.filter(t => t.alive);
    this.enemyTurrets = this.enemyTurrets.filter(t => t.alive);
    this.tanks = [this.player];
    if (this.player2) this.tanks.push(this.player2);
    this.tanks = this.tanks.concat(this.enemies);

    // 连击超时
    if (this.comboTimer > 0) { this.comboTimer--; if (this.comboTimer === 0) this.combo = 0; }

    // 波次推进 / 胜负判定
    this._checkWaveEnd();

    // 延迟进关（子弹遍历完成后执行，避免遍历中改数组）
    if (this.pendingLevelUp) {
      this.pendingLevelUp = false;
      this._doWinLevel();
    }
  }

  _spawnLogic() {
    if (this.waveQueue.length === 0) return;
    this.spawnTimer--;
    if (this.spawnTimer > 0) return;
    if (this.enemies.length >= this.C.wave.maxAlive) return;
    this.spawnTimer = this.C.wave.spawnInterval;

    const type = this.waveQueue.shift();
    // 出生点随关卡递增（第1关2个 → 第5关5个），避开顶部中央敌方基地
    const spawnPool = [
      { x: 0, y: 0 }, { x: 12, y: 0 }, { x: 3, y: 0 }, { x: 9, y: 0 }, { x: 6, y: 1 },
    ];
    const spawnCount = Math.min(spawnPool.length, 2 + this.level);
    const spots = spawnPool.slice(0, spawnCount);
    // 找空位出生点
    for (const s of spots) {
      const ex = s.x * this.C.TILE, ey = s.y * this.C.TILE;
      let ok = true;
      for (const t of this.tanks) {
        if (t.alive && BC.utils.aabb(ex, ey, this.C.TILE, this.C.TILE, t.x, t.y, t.size, t.size)) { ok = false; break; }
      }
      if (ok) {
        const e = new BC.EnemyTank(ex, ey, type);
        // 难度指数递增：每波速度 ×1.1、射速加快、血量每 2 波 +1
        const wd = Math.pow(1.1, this.wave - 1);
        e.speed *= wd;
        e._cooldownBase = Math.max(18, e._cooldownBase / Math.sqrt(wd));
        if (this.wave >= 2) e.hp += Math.floor((this.wave - 1) / 2);
        // Boss：每 bossEvery 波的首个敌人强化（血量翻倍、体型加大）
        if (this.bossPending) {
          this.bossPending = false;
          e.boss = true; e.hp = 4; e.speed *= 0.9; e._cooldownBase *= 0.7; e.score *= 3;
        }
        // 硬核模式：敌人更快、射速更高
        if (this.hardcoreMul !== 1) {
          e.speed *= this.hardcoreMul;
          e._cooldownBase = Math.max(30, e._cooldownBase / this.hardcoreMul);
        }
        // 特殊能力敌人（第 2 波起，波次越高概率越高）
        if (this.wave >= 2 && !e.boss && Math.random() < 0.2 + this.wave * 0.04) {
          const specials = ['invisible', 'speed', 'shield', 'suicide'];
          e.special = specials[BC.utils.randInt(0, specials.length - 1)];
          if (e.special === 'speed') e.speed *= 1.4;
          if (e.special === 'shield') e.hp += 1;
        }
        e.ai = new BC.AI(e);
        this.enemies.push(e);
        this.tanks = [this.player].concat(this.enemies);
        return;
      }
    }
    this.waveQueue.unshift(type); // 无空位，稍后重试
  }

  /** 子弹与地形/坦克的碰撞，返回状态供子弹反弹判断 */
  bulletCollide(bullet) {
    const T = this.C.TILE;
    const cx = bullet.x + bullet.size / 2, cy = bullet.y + bullet.size / 2;
    // 命中地形
    const tx = Math.floor(cx / T), ty = Math.floor(cy / T);
    const res = this.map.bulletHit(tx, ty, bullet.piercing);
    if (res === 'steel') return 'steel';
    if (res === 'base') {
      // 我方基地：仅敌人子弹造成伤害，玩家/炮台子弹穿过（不误伤自己家）
      const shooterTeam = bullet.owner ? bullet.owner.owner : null;
      if (shooterTeam === 'enemy') {
        bullet.alive = false;
        const r = this.map.damageBase();
        this.particles.explosion(cx, cy, '#f2c94c');
        if (r === 'base') {
          this.fx.addShake(this.C.fx.shake);
          this.audio.boom();
          this._gameOver();
        } else {
          this.fx.addShake(2);
          this.audio.hit();
          this.spawnPopup('我方基地受损! (' + this.map.baseHp + '/' + this.map.baseMaxHp + ')', '#ff9a3c', 50);
        }
        return 'hit';
      }
      return 'pass'; // 友方子弹穿过
    }
    if (res === 'enemyBase') {
      // 敌方基地：仅玩家/炮台子弹可伤害并胜利；敌人子弹穿过（不误伤自己家）
      const shooterTeam = bullet.owner ? bullet.owner.owner : null;
      if (shooterTeam === 'player' || shooterTeam === 'turret') {
        bullet.alive = false;
        const r = this.map.damageEnemyBase();
        this.particles.explosion(cx, cy, '#e24b4a');
        if (r === 'enemyBase') {
          this.fx.addShake(this.C.fx.shake);
          this.audio.boom();
          this._winLevel(true); // 摧毁敌方基地 → 自动进入下一关（最后一关才全通关）
        } else {
          this.fx.addShake(2);
          this.audio.hit();
          this.spawnPopup('敌方基地受损! (' + this.map.enemyBaseHp + '/' + this.map.enemyBaseMaxHp + ')', '#ff9a3c', 50);
        }
        return 'hit';
      }
      return 'pass'; // 敌方子弹穿过
    }
    if (res === 'destroy' || res === 'hit') {
      this.particles.explosion(cx, cy, '#c8602e');
      this.audio.hit();
      if (bullet.piercing) return 'pass';   // 穿甲弹继续飞行
      bullet.alive = false;
      return 'hit';
    }

    // 命中坦克 / 炮台
    const owner = bullet.owner;
    const ownerType = owner ? owner.owner : null;
    const isP1 = ownerType === 'player' && owner && owner.inputKey === 'p1';
    const isP2 = ownerType === 'player' && owner && owner.inputKey === 'p2';

    if (this.mode === 'pvp') {
      // 对战模式：P1 子弹打 P2，P2 子弹打 P1
      if (isP1) {
        const p2 = this.player2;
        if (p2 && p2.alive && p2.shieldTimer <= 0) {
          const hb2 = p2.hitbox;
          if (BC.utils.aabb(bullet.x, bullet.y, bullet.size, bullet.size, hb2.x, hb2.y, hb2.w, hb2.h)) {
            bullet.alive = false;
            this._playerHit(2);
            return 'hit';
          }
        }
      } else if (isP2) {
        const p = this.player;
        const hb = p.hitbox;
        if (p && p.alive && p.shieldTimer <= 0 &&
            BC.utils.aabb(bullet.x, bullet.y, bullet.size, bullet.size, hb.x, hb.y, hb.w, hb.h)) {
          bullet.alive = false;
          this._playerHit(1);
          return 'hit';
        }
      }
      return 'pass';
    }

    if (ownerType === 'player' || ownerType === 'turret') {
      // 友方子弹（玩家/炮台）→ 打敌人 + 敌方炮台
      for (const e of this.enemies) {
        const hb = e.hitbox;
        if (e.alive && BC.utils.aabb(bullet.x, bullet.y, bullet.size, bullet.size, hb.x, hb.y, hb.w, hb.h)) {
          bullet.alive = false;
          e.hit(this);
          this.audio.hit();
          this._hitSpark(cx, cy, e.color); // 命中火花
          return 'hit';
        }
      }
      for (const t of this.enemyTurrets) {
        if (t.alive && BC.utils.aabb(bullet.x, bullet.y, bullet.size, bullet.size, t.x, t.y, t.size, t.size)) {
          bullet.alive = false;
          t.hit(this);
          this.audio.hit();
          this._hitSpark(cx, cy, '#b0483c');
          return 'hit';
        }
      }
    } else {
      // 敌方子弹 → 打玩家 1 / 玩家 2 / 炮台
      const p = this.player;
      const hb = p.hitbox;
      if (p && p.alive && p.shieldTimer <= 0 &&
          BC.utils.aabb(bullet.x, bullet.y, bullet.size, bullet.size, hb.x, hb.y, hb.w, hb.h)) {
        bullet.alive = false;
        this._playerHit(1);
        return 'hit';
      }
      const p2 = this.player2;
      if (p2 && p2.alive && p2.shieldTimer <= 0) {
        const hb2 = p2.hitbox;
        if (BC.utils.aabb(bullet.x, bullet.y, bullet.size, bullet.size, hb2.x, hb2.y, hb2.w, hb2.h)) {
          bullet.alive = false;
          this._playerHit(2);
          return 'hit';
        }
      }
      for (const t of this.turrets) {
        if (t.alive && BC.utils.aabb(bullet.x, bullet.y, bullet.size, bullet.size, t.x, t.y, t.size, t.size)) {
          bullet.alive = false;
          t.hit(this);
          this.audio.hit();
          return 'hit';
        }
      }
    }
    return 'pass';
  }

  _playerHit(which) {
    which = which || 1;
    const p = which === 2 ? this.player2 : this.player;
    const color = which === 2 ? '#4a9fe0' : '#3fae5a';
    this.particles.explosion(p.cx, p.cy, color);
    this.fx.addShake(this.C.fx.shake);
    this.audio.boom();
    p.alive = false;
    if (which === 2) { this.lives2--; this.deadTimer2 = 60; }
    else { this.lives--; this.deadTimer = 60; }
  }

  onEnemyDestroyed(e) {
    const mult = 1 + this.combo;
    this.score += e.score * mult;
    this.combo++;
    this.comboTimer = 120;
    // 连击文字弹出
    if (this.combo >= 2) {
      this.spawnPopup('COMBO x' + this.combo, '#ff9a3c');
    }
    // 得分弹出
    this.spawnPopup('+' + (e.score * mult), '#ffe066', 30);
    this.particles.explosion(e.cx, e.cy, e.color);
    this.fx.addShake(this.C.fx.shake);
    this.fx.stop(this.C.fx.hitStop);
    this.audio.boom();

    // 概率掉落道具（硬核模式减半）
    const drop = this.hardcore ? this.C.powerup.dropChance / 2 : this.C.powerup.dropChance;
    if (Math.random() < drop) {
      const types = ['shield', 'rapid', 'pierce', 'emp', 'time', 'missile', 'life'];
      const type = types[BC.utils.randInt(0, types.length - 1)];
      const pu = new BC.PowerUp();
      pu.init(e.x + 5, e.y + 5, type);
      this.powerups.push(pu);
    }
  }

  /** 命中火花：子弹命中坦克/炮台时迸出小火花（区别于完整爆炸） */
  _hitSpark(x, y, color) {
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = BC.utils.rand(0.5, 2);
      this.particles.spawn(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 12, color, BC.utils.randInt(2, 3), 'spark');
    }
  }

  applyPowerUp(type, p) {
    p = p || this.player;
    const d = this.C.powerup.duration;
    this.audio.pickup();
    const descMap = {
      shield: '护盾：短时无敌', rapid: '速射：射速翻倍', pierce: '穿甲：击穿砖墙',
      emp: '脉冲：清屏敌方子弹', time: '减速：敌人变慢', missile: '导弹：自动追踪', life: '生命 +1',
    };
    if (type === 'shield') { p.shieldTimer = d; p.spawnRing = 20; }
    else if (type === 'rapid') p.rapidTimer = d;
    else if (type === 'pierce') p.pierceTimer = d;
    else if (type === 'time') this.slowTimer = d;       // 全局时间减速
    else if (type === 'missile') this.fireMissile(p);   // 追踪导弹
    else if (type === 'life') {                          // 生命 +1（上限 5）
      if (p === this.player) this.lives = Math.min(this.lives + 1, 5);
      else this.lives2 = Math.min(this.lives2 + 1, 5);
    }
    else if (type === 'emp') {
      this.empTimer = 90;
      for (const b of this.bullets) if (b.alive && b.owner && b.owner.owner === 'enemy') b.alive = false;
      this.fx.addShake(4);
    }
    // 道具说明弹出
    this.spawnPopup(descMap[type] || '', BC.POWERUP_TYPES[type].color, 60);
  }

  /** 发射追踪导弹：朝最近敌人追踪 */
  fireMissile(p) {
    let target = null, minD = Infinity;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const d = BC.utils.dist(p.cx, p.cy, e.cx, e.cy);
      if (d < minD) { minD = d; target = e; }
    }
    if (!target) return;
    const dir = { x: Math.sign(target.cx - p.cx) || 0, y: Math.sign(target.cy - p.cy) || -1 };
    for (const b of this.bulletPool) {
      if (!b.alive) {
        b.init(p.cx - 4, p.cy - 4, dir, 4.2, p, false);
        b.homing = true;
        b.homingTarget = target;
        this.bullets.push(b);
        return;
      }
    }
  }

  _checkWaveEnd() {
    // 基地被毁 -> 立即失败（对战模式不看基地）
    if (!this.map.baseAlive && this.mode !== 'pvp' && this.state === BC.GAME.STATES.PLAYING) {
      this._gameOver();
      return;
    }
    // 敌方基地被摧毁 -> 进下一关（兜底判定，正常由 bulletCollide 的 _winLevel 处理）
    if (!this.map.enemyBaseAlive && this.mode !== 'pvp' && this.state === BC.GAME.STATES.PLAYING) {
      this._winLevel(true);
      return;
    }

    // 玩家 1 重生
    if (!this.player.alive && this.deadTimer > 0) {
      this.deadTimer--;
      if (this.deadTimer === 0 && this.lives > 0) {
        this.player = new BC.PlayerTank(4 * this.C.TILE, 12 * this.C.TILE, 'p1');
        this.player.shieldTimer = 90; this.player.spawnRing = 20; this.player.spawnRing = 20;
        this._rebuildTanks();
      }
    }
    // 玩家 2 重生
    if (this.player2 && !this.player2.alive && this.deadTimer2 > 0) {
      this.deadTimer2--;
      if (this.deadTimer2 === 0 && this.lives2 > 0) {
        this.player2 = new BC.PlayerTank(8 * this.C.TILE, 12 * this.C.TILE, 'p2', '#4a9fe0');
        this.player2.shieldTimer = 90; this.player2.spawnRing = 20; this.player2.spawnRing = 20;
        this._rebuildTanks();
      }
    }

    // 对战模式：一方生命归零即结束，判定胜者
    if (this.mode === 'pvp' && this.state === BC.GAME.STATES.PLAYING) {
      const p1Dead = !this.player.alive && this.deadTimer === 0 && this.lives <= 0;
      const p2Dead = this.player2 && !this.player2.alive && this.deadTimer2 === 0 && this.lives2 <= 0;
      if (p1Dead) { this.pvpWinner = 2; this.state = BC.GAME.STATES.VICTORY; }
      else if (p2Dead) { this.pvpWinner = 1; this.state = BC.GAME.STATES.VICTORY; }
      return;
    }

    // 合作/单人：失败判定（P1 死光，或双人两人都死光）
    if (this.state === BC.GAME.STATES.PLAYING) {
      const p1Dead = !this.player.alive && this.deadTimer === 0 && this.lives <= 0;
      const p2Dead = this.mode === 'solo' || (this.player2 && !this.player2.alive && this.deadTimer2 === 0 && this.lives2 <= 0);
      if (p1Dead && p2Dead) {
        this._gameOver();
        return;
      }
    }

    if (this.state !== BC.GAME.STATES.PLAYING) return;
    // 本波敌人全灭
    if (this.waveQueue.length === 0 && this.enemies.length === 0) {
      if (this.wave >= BC.GAME.VICTORY_WAVE) {
        this._winLevel(false); // 打满 5 波 → 自动进入下一关（最后一关全通关）
      } else {
        this.startWave();
      }
    }
  }

  /** 更新最高分（localStorage 持久化） */
  updateHighscore() {
    if (this.score > this.highscore) {
      this.highscore = this.score;
      try { localStorage.setItem('battle_city_highscore', String(this.highscore)); } catch (e) {}
    }
  }

  /** 屏幕提示（波次/道具/连击/得分） */
  spawnPopup(text, color, timer) {
    timer = timer || 45;
    this.popups.push({ text: text, color: color || '#fff', timer: timer, maxTimer: timer });
    if (this.popups.length > 6) this.popups.shift();
  }

  /** 通关评级：S/A/B/C 按得分 */
  getRank() {
    if (this.score >= 10000) return 'S';
    if (this.score >= 6000) return 'A';
    if (this.score >= 3000) return 'B';
    return 'C';
  }

  /** 重建 tanks 数组（含玩家 1 / 玩家 2 / 敌人） */
  _rebuildTanks() {
    const arr = [this.player];
    if (this.player2) arr.push(this.player2);
    this.tanks = arr.concat(this.enemies);
  }

  /** 打赢一关：标记进关，由 update 循环末尾统一执行（避免遍历中改数组） */
  _winLevel(viaBase) {
    if (this.mode === 'pvp' || this.state !== BC.GAME.STATES.PLAYING) return;
    this.pendingLevelUp = true;
    this.pendingViaBase = !!viaBase;
  }

  /** 真正执行进关/通关（在 update 末尾调用） */
  _doWinLevel() {
    if (this.pendingViaBase) this.spawnPopup('敌方基地被摧毁!', '#ff6b6b', 50);
    if (this.level < BC.Map.LEVELS.length - 1) {
      this.nextLevel(); // 自动进入下一关
    } else {
      this.state = BC.GAME.STATES.VICTORY; // 最后一关 → 全通关
      this.updateHighscore();
    }
  }

  /** 通关进入下一关：保留分数/生命，换地图重开敌人 */
  nextLevel() {
    this.level++;
    this.map.loadLevel(this.level);
    this.wave = 0;
    this.waveQueue = [];
    this.enemies = [];
    this.bullets = [];
    this.powerups = [];
    this._clearBullets();
    this.player = new BC.PlayerTank(4 * this.C.TILE, 12 * this.C.TILE, 'p1');
    this.player.shieldTimer = 90; this.player.spawnRing = 20;
    if (this.mode !== 'solo') {
      this.player2 = new BC.PlayerTank(8 * this.C.TILE, 12 * this.C.TILE, 'p2', '#4a9fe0');
      this.player2.shieldTimer = 90; this.player2.spawnRing = 20;
    }
    this._rebuildTanks();
    this.spawnTurret();
    this.spawnPopup('第 ' + (this.level + 1) + ' 关', '#4ad1ff', 80);
    this.startWave();
  }

  _gameOver() {
    if (this.state !== BC.GAME.STATES.PLAYING) return;
    this.state = BC.GAME.STATES.DEFEAT;
    this.updateHighscore();
    this.audio.gameOver();
  }

  /** 游玩编辑器自建关卡 */
  playCustom() {
    if (!this.editor.hasBase()) {
      this.editor.layout[12][6] = BC.TILE.BASE;
      this.editor._sync();
    }
    this.reset();
    this.map.layout = this.editor.layout.map(r => r.slice());
    this.map.originalLayout = this.map.layout.map(r => r.slice());
    // 确保出生点安全（玩家/敌人出生格强制为空）
    this.map.layout[12][4] = BC.TILE.EMPTY;
    this.map.layout[12][8] = BC.TILE.EMPTY;
    this.map.layout[0][0] = BC.TILE.EMPTY;
    this.map.layout[0][6] = BC.TILE.EMPTY;
    this.map.layout[0][12] = BC.TILE.EMPTY;
    this.map.reset();

    this.state = BC.GAME.STATES.PLAYING;
    if (this.hardcore) { this.lives = 1; this.lives2 = 1; this.hardcoreMul = 1.35; }
    else { this.hardcoreMul = 1; }
    if (this.mode !== 'solo') {
      this.player2 = new BC.PlayerTank(8 * this.C.TILE, 12 * this.C.TILE, 'p2', '#4a9fe0');
      this.player2.shieldTimer = 90; this.player2.spawnRing = 20;
      this.tanks = [this.player, this.player2];
    }
    this.spawnTurret();
    this.startWave();
  }

  render(ctx) {
    const T = this.C.TILE;
    const W = this.C.COLS * T, H = this.C.ROWS * T;
    ctx.clearRect(0, 0, W, H);
    this._drawGround(ctx, W, H);

    // 编辑器模式：渲染编辑中的地图 + 网格
    if (this.state === BC.GAME.STATES.EDITOR) {
      this.editor.render(ctx, this.frameCount);
      this.fx.renderCRT(ctx, W, H, this.frameCount);
      return;
    }

    ctx.save();
    const off = this.fx.offset();
    ctx.translate(off.x, off.y);

    this.map.render(ctx, this.frameCount);

    for (const p of this.powerups) if (p.alive) p.render(ctx);
    for (const b of this.bullets) if (b.alive) b.render(ctx);
    for (const t of this.turrets) if (t.alive) t.render(ctx);
    for (const t of this.enemyTurrets) if (t.alive) t.render(ctx);
    for (const e of this.enemies) if (e.alive) e.render(ctx);
    if (this.player.alive) this.player.render(ctx);
    if (this.player2 && this.player2.alive) this.player2.render(ctx);

    this.map.renderTop(ctx);
    this.particles.render(ctx);

    ctx.restore();

    this.fx.renderCRT(ctx, W, H, this.frameCount);

    // 屏幕提示（波次/过关/道具/连击/得分），带缩放浮现动画
    this.popups = this.popups.filter(p => p.timer > 0);
    const sorted = [...this.popups].reverse(); // 新提示在下方
    sorted.forEach((p, i) => {
      const a = Math.min(1, p.timer / 20);
      const big = p.text.indexOf('波') >= 0 || p.text.indexOf('关') >= 0;
      const size = big ? 24 : 17;
      const t = p.timer / (p.maxTimer || 1);
      const scale = 1 + Math.max(0, t - 0.75) * 2; // 刚出现时放大，缩到 1
      ctx.save();
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.font = 'bold ' + size + 'px monospace';
      ctx.textAlign = 'center';
      const py = 40 + i * 24;
      ctx.translate(W / 2, py);
      ctx.scale(scale, scale);
      ctx.fillText(p.text, 0, 0);
      ctx.restore();
    });
    for (const p of this.popups) p.timer--;
  }

  /** 程序化战场地面：棋盘格地砖 + 网格线 + 固定噪点（比纯色丰富） */
  _drawGround(ctx, W, H) {
    const T = this.C.TILE;
    // 底色（深灰土）
    ctx.fillStyle = '#1b1b21';
    ctx.fillRect(0, 0, W, H);
    // 棋盘格微差色块
    for (let y = 0; y < H; y += T) {
      for (let x = 0; x < W; x += T) {
        ctx.fillStyle = ((x / T + y / T) % 2 === 0) ? '#1f1f26' : '#18181e';
        ctx.fillRect(x, y, T, T);
      }
    }
    // 斑驳土地纹理（确定性大块深浅斑，避免闪烁）
    for (let i = 0; i < 26; i++) {
      const bx = (i * 137 + i * i * 19) % W;
      const by = (i * 211 + i * i * 29) % H;
      const bw = 30 + (i * 53) % 70;
      const bh = 18 + (i * 31) % 44;
      ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.018)' : 'rgba(0,0,0,0.03)';
      ctx.beginPath();
      ctx.ellipse(bx, by, bw, bh, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // 网格线（淡）
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= W; x += T) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let y = 0; y <= H; y += T) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
    // 固定位置颗粒
    ctx.fillStyle = 'rgba(255,255,255,0.02)';
    for (let i = 0; i < 90; i++) {
      const gx = (i * 67 + i * i * 13) % W;
      const gy = (i * 89 + i * i * 7) % H;
      ctx.fillRect(gx, gy, 1, 1);
    }
    // 中央光照暗角（战场聚光感）
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.9);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.30)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  /** 调试信息（F3） */
  debugInfo() {
    return {
      fps: 60,
      enemies: this.enemies.length,
      queue: this.waveQueue.length,
      bullets: this.bullets.length,
      particles: this.particles.pool.filter(p => p.alive).length,
      combo: this.combo,
    };
  }
};
