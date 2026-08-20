/**
 * config.js — 全局可调参数
 * 所有手感 / 平衡性相关数值集中在此，方便调参。
 */
window.BC = window.BC || {};

BC.CONFIG = {
  // 画布与网格
  TILE: 40,            // 每个格子的像素边长
  COLS: 13,            // 地图列数
  ROWS: 13,            // 地图行数
  TANK_SIZE: 40,       // 坦克尺寸（占一格）

  // 玩家坦克
  player: {
    speed: 2.4,        // 每帧像素
    bulletSpeed: 4.0,  // 玩家子弹速度（慢，突出走位与预判）
    bulletCooldown: 18, // 帧数
    lives: 3,
  },

  // 敌人坦克（三种类型差异化）
  enemy: {
    patrol: { speed: 1.3, bulletSpeed: 3.0, cooldown: 75, hp: 1, color: '#c9b23c', score: 100 },
    sniper: { speed: 1.1, bulletSpeed: 4.2, cooldown: 45, hp: 1, color: '#b05a3c', score: 200 },
    rusher: { speed: 1.9, bulletSpeed: 3.2, cooldown: 65, hp: 2, color: '#8a6db0', score: 300 },
  },

  // 子弹
  bullet: { size: 8, maxBounce: 1 }, // 打钢墙最多反弹 1 次

  // 墙体多阶段破坏
  wall: { brickHp: 2 },

  // 基地（我方/敌方，多阶段破坏）
  base: { hp: 5, enemyHp: 5 },

  // 基地防御炮台（子弹较慢，给玩家和 AI 反应时间）
  turret: {
    bulletSpeed: 3.0,        // 我方炮台子弹速度
    enemyBulletSpeed: 2.6,   // 敌方炮台子弹速度
  },

  // 波次
  wave: {
    baseCount: 4,        // 第一波敌人数量
    countGrowth: 2,      // 每波增加数量
    maxAlive: 6,         // 场上同时存活上限
    spawnInterval: 60,   // 敌人出生间隔（帧）
    bossEvery: 4,        // 每 N 波出一个 Boss（血量翻倍、体型加大）
  },

  // 道具掉落
  powerup: {
    dropChance: 0.32,    // 击毁敌人掉落概率
    duration: 360,       // 持续帧数（约 6 秒）
  },

  // 特效
  fx: {
    shake: 7,            // 爆炸屏幕震动幅度
    hitStop: 3,          // 击毁顿帧数
    maxParticles: 240,   // 粒子池上限
  },

  // CRT 滤镜（F2 开关）
  crt: {
    enabled: true,
    scanlineAlpha: 0.10,
    vignette: 0.30,
    chromatic: 1.2,      // 色彩偏移像素
    grain: 0.05,         // 胶片颗粒强度（Grainient）
    grainSize: 2,        // 颗粒尺寸
  },
};
