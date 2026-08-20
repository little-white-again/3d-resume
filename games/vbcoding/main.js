const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
const startBtn = document.getElementById('startBtn');
const upgradePanel = document.getElementById('upgradePanel');
const upgradeOptions = document.getElementById('upgradeOptions');

let width = 0;
let height = 0;
let dpr = 1;
let gameState = 'menu';
let lastTime = 0;
let gameTime = 0;
let score = 0;
let highScore = Number(localStorage.getItem('starborne-high-score') || 0);
let nextUpgradeTime = 16;
let upgradePending = false;
let screenShake = 0;
let combo = 0;
let comboTimer = 0;
let bossWarningTimer = 0;

let stars = [];
let bullets = [];
let enemies = [];
let particles = [];
let pickups = [];
let boss = null;

const keys = {};
const mouse = { x: 0, y: 0, active: false };

let player = null;

function resetGame() {
  gameState = 'playing';
  gameTime = 0;
  score = 0;
  nextUpgradeTime = 16;
  upgradePending = false;
  bullets = [];
  enemies = [];
  particles = [];
  pickups = [];
  boss = null;
  stars = createStars(140);
  player = createPlayer();
  overlay.classList.add('hidden');
  upgradePanel.classList.add('hidden');
}

function createPlayer() {
  return {
    x: width / 2,
    y: height - 110,
    width: 36,
    height: 48,
    speed: 360,
    hp: 3,
    maxHp: 3,
    shield: 0,
    maxShield: 0,
    fireCooldown: 0,
    fireRate: 7,
    bulletSpeed: 520,
    multiShot: 1,
    spread: 0,
    tracking: false,
    specialCharges: 1,
    invincible: 0,
    color: '#7de3ff'
  };
}

function createStars(count) {
  return Array.from({ length: count }, () => ({
    x: Math.random() * width,
    y: Math.random() * height,
    r: Math.random() * 1.8 + 0.4,
    speed: Math.random() * 40 + 20,
    alpha: Math.random() * 0.7 + 0.2,
    layer: Math.random() * 0.7 + 0.4,
    twinkle: Math.random() * Math.PI * 2
  }));
}

function resizeCanvas() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  width = window.innerWidth;
  height = window.innerHeight;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  if (!player) {
    stars = createStars(140);
    return;
  }

  player.x = Math.min(Math.max(player.x, 40), width - 40);
  player.y = Math.min(Math.max(player.y, 40), height - 40);
}

function startGame() {
  resetGame();
  requestAnimationFrame(loop);
}

function loop(timestamp) {
  if (!lastTime) lastTime = timestamp;
  const dt = Math.min((timestamp - lastTime) / 1000, 0.03);
  lastTime = timestamp;

  if (gameState === 'playing') {
    update(dt);
  }

  render();
  requestAnimationFrame(loop);
}

function update(dt) {
  gameTime += dt;
  updateStars(dt);

  if (player) {
    updatePlayer(dt);
  }

  updateBullets(dt);
  updateEnemies(dt);
  updatePickups(dt);
  updateParticles(dt);
  updateBoss(dt);
  checkCollisions();
  maybeTriggerUpgrade(dt);

  if (comboTimer > 0) {
    comboTimer = Math.max(0, comboTimer - dt);
    if (comboTimer <= 0) combo = 0;
  }

  if (screenShake > 0) {
    screenShake = Math.max(0, screenShake - dt * 1.4);
  }

  if (bossWarningTimer > 0) {
    bossWarningTimer = Math.max(0, bossWarningTimer - dt);
  }
}

function updateStars(dt) {
  stars.forEach((star) => {
    star.y += star.speed * dt * (0.7 + star.layer);
    star.twinkle += dt * (0.9 + star.layer);
    if (star.y > height + 6) {
      star.y = -6;
      star.x = Math.random() * width;
    }
  });
}

function updatePlayer(dt) {
  let moveX = 0;
  let moveY = 0;

  if (keys['ArrowLeft'] || keys['KeyA']) moveX -= 1;
  if (keys['ArrowRight'] || keys['KeyD']) moveX += 1;
  if (keys['ArrowUp'] || keys['KeyW']) moveY -= 1;
  if (keys['ArrowDown'] || keys['KeyS']) moveY += 1;

  if (mouse.active) {
    const targetX = mouse.x;
    const targetY = mouse.y;
    player.x += (targetX - player.x) * 0.15;
    player.y += (targetY - player.y) * 0.15;
  }

  if (moveX || moveY) {
    const len = Math.hypot(moveX, moveY) || 1;
    player.x += (moveX / len) * player.speed * dt;
    player.y += (moveY / len) * player.speed * dt;
  }

  player.x = Math.max(26, Math.min(width - 26, player.x));
  player.y = Math.max(36, Math.min(height - 36, player.y));

  player.fireCooldown -= dt;
  if (player.fireCooldown <= 0) {
    firePlayerBullets();
    player.fireCooldown = 1 / player.fireRate;
  }

  if (player.invincible > 0) {
    player.invincible = Math.max(0, player.invincible - dt);
  }

  if (keys['Space']) {
    useSpecial();
    keys['Space'] = false;
  }
}

function firePlayerBullets() {
  const baseAngle = -Math.PI / 2;
  const shots = player.multiShot;
  const spread = player.spread * 0.12;

  for (let i = 0; i < shots; i += 1) {
    const offset = (i - (shots - 1) / 2) * (0.12 + spread);
    const angle = baseAngle + offset;
    bullets.push({
      x: player.x + Math.cos(angle) * 8,
      y: player.y - 18,
      vx: Math.cos(angle) * player.bulletSpeed,
      vy: Math.sin(angle) * player.bulletSpeed,
      radius: player.tracking ? 5 : 3,
      damage: 1 + (player.spread > 0 ? 1 : 0),
      color: player.tracking ? '#ff7b54' : '#7de3ff',
      type: player.tracking ? 'tracking' : 'normal'
    });
  }

  if (player.spread > 0) {
    bullets.push({
      x: player.x,
      y: player.y - 20,
      vx: 0,
      vy: -player.bulletSpeed * 1.1,
      radius: 4,
      damage: 1,
      color: '#8fffd7',
      type: 'normal'
    });
  }
}

function useSpecial() {
  if (player.specialCharges <= 0) return;
  player.specialCharges -= 1;
  particles.push(...createBurst(player.x, player.y, '#ff9f43', 24, 220));
  for (const enemy of enemies) {
    const dx = enemy.x - player.x;
    const dy = enemy.y - player.y;
    const dist = Math.hypot(dx, dy) || 1;
    if (dist < 240) {
      enemy.hp -= 2;
      enemy.hitFlash = 0.16;
      if (enemy.hp <= 0) killEnemy(enemy);
    }
  }
  if (boss) {
    const dx = boss.x - player.x;
    const dy = boss.y - player.y;
    if (Math.hypot(dx, dy) < 260) {
      boss.hp -= 16;
      boss.hitFlash = 0.2;
    }
  }
}

function updateBullets(dt) {
  for (let i = bullets.length - 1; i >= 0; i -= 1) {
    const bullet = bullets[i];
    bullet.x += bullet.vx * dt;
    bullet.y += bullet.vy * dt;

    if (bullet.type === 'tracking') {
      const target = enemies.find((enemy) => enemy && enemy.hp > 0);
      if (target) {
        const tx = target.x - bullet.x;
        const ty = target.y - bullet.y;
        const mag = Math.hypot(tx, ty) || 1;
        bullet.vx += (tx / mag) * 160 * dt;
        bullet.vy += (ty / mag) * 160 * dt;
      }
    }

    if (bullet.y < -20 || bullet.x < -40 || bullet.x > width + 40) {
      bullets.splice(i, 1);
      continue;
    }
  }
}

function updateEnemies(dt) {
  const spawnInterval = Math.max(0.36, 0.82 - gameTime / 120);
  if (Math.random() < spawnInterval * dt) {
    spawnEnemy();
  }

  for (let i = enemies.length - 1; i >= 0; i -= 1) {
    const enemy = enemies[i];
    enemy.y += enemy.speed * dt;

    if (enemy.type === 'elite') {
      enemy.x += Math.sin(gameTime * 1.8 + enemy.seed) * 70 * dt;
      enemy.shootTimer -= dt;
      if (enemy.shootTimer <= 0) {
        enemy.shootTimer = 1.2;
        bullets.push({
          x: enemy.x,
          y: enemy.y + 16,
          vx: 0,
          vy: 250,
          radius: 4,
          damage: 1,
          color: '#ff5b5b',
          type: 'enemy'
        });
      }
    }

    if (enemy.type === 'bomber') {
      enemy.x += Math.sin(gameTime * 1.6 + enemy.seed) * 45 * dt;
    }

    if (enemy.y > height + 60) {
      enemies.splice(i, 1);
      continue;
    }

    if (enemy.hitFlash > 0) {
      enemy.hitFlash = Math.max(0, enemy.hitFlash - dt);
    }
  }
}

function updatePickups(dt) {
  for (let i = pickups.length - 1; i >= 0; i -= 1) {
    const pickup = pickups[i];
    pickup.y += pickup.speed * dt;
    if (pickup.y > height + 20) {
      pickups.splice(i, 1);
    }
  }
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i -= 1) {
    const p = particles[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= dt;
    p.vy += 40 * dt;
    if (p.life <= 0) {
      particles.splice(i, 1);
    }
  }
}

function updateBoss(dt) {
  if (!boss) return;
  boss.y = Math.min(height * 0.2 + 20, boss.y + 26 * dt);
  boss.x += Math.sin(gameTime * 1.7 + boss.phase) * 120 * dt;
  boss.attackTimer -= dt;
  boss.hitFlash = Math.max(0, (boss.hitFlash || 0) - dt);

  if (boss.attackTimer <= 0) {
    boss.attackTimer = Math.max(0.35, 0.7 - boss.phase * 0.08);
    if (boss.phase === 1) {
      for (let i = -2; i <= 2; i += 1) {
        const ang = (i / 2) * 0.25;
        bullets.push({
          x: boss.x,
          y: boss.y + 40,
          vx: Math.sin(ang) * 220,
          vy: 240,
          radius: 5,
          damage: 1,
          color: '#ff6b6b',
          type: 'enemy'
        });
      }
    } else if (boss.phase === 2) {
      for (let i = 0; i < 10; i += 1) {
        const angle = (i / 10) * Math.PI * 2;
        bullets.push({
          x: boss.x,
          y: boss.y + 40,
          vx: Math.cos(angle) * 180,
          vy: Math.sin(angle) * 180 + 120,
          radius: 4,
          damage: 1,
          color: '#ff8c42',
          type: 'enemy'
        });
      }
    } else {
      for (let i = 0; i < 7; i += 1) {
        const angle = (i / 7) * Math.PI * 2;
        bullets.push({
          x: boss.x,
          y: boss.y + 40,
          vx: Math.cos(angle) * 240,
          vy: Math.sin(angle) * 240 + 80,
          radius: 4,
          damage: 1,
          color: '#ff4d6d',
          type: 'enemy'
        });
      }
    }
  }

  if (boss.hp <= boss.maxHp * 0.66 && boss.phase === 1) {
    boss.phase = 2;
    boss.attackTimer = 0.2;
  }
  if (boss.hp <= boss.maxHp * 0.33 && boss.phase === 2) {
    boss.phase = 3;
    boss.attackTimer = 0.1;
  }

  if (boss.hp <= 0) {
    particles.push(...createBurst(boss.x, boss.y, '#ffe66d', 40, 260));
    score += 1500;
    updateHighScore();
    boss = null;
    gameState = 'menu';
    overlay.classList.remove('hidden');
    overlay.querySelector('.panel').innerHTML = `
      <h1>胜利</h1>
      <p>你成功击败了黑暗主宰，星域重新被照亮。</p>
      <div class="controls">
        <div>本局分数：${score}</div>
        <div>最高分数：${highScore}</div>
      </div>
      <button id="restartBtn">再战一次</button>
    `;
    document.getElementById('restartBtn').onclick = () => startGame();
    overlay.classList.remove('hidden');
  }
}

function checkCollisions() {
  if (!player) return;

  for (let i = bullets.length - 1; i >= 0; i -= 1) {
    const bullet = bullets[i];
    if (bullet.type === 'enemy') {
      if (rectCircleCollide(player, bullet)) {
        bullets.splice(i, 1);
        damagePlayer(1);
      }
      continue;
    }

    for (let j = enemies.length - 1; j >= 0; j -= 1) {
      const enemy = enemies[j];
      if (rectCircleCollide(enemy, bullet)) {
        bullets.splice(i, 1);
        enemy.hp -= bullet.damage;
        enemy.hitFlash = 0.08;
        if (enemy.hp <= 0) {
          killEnemy(enemy);
        }
        break;
      }
    }
  }

  for (let i = enemies.length - 1; i >= 0; i -= 1) {
    const enemy = enemies[i];
    if (rectRectCollide(player, enemy)) {
      enemies.splice(i, 1);
      damagePlayer(1);
      particles.push(...createBurst(enemy.x, enemy.y, '#ff5b5b', 12, 140));
      if (enemy.type === 'bomber') {
        damagePlayer(1);
      }
    }
  }

  for (let i = pickups.length - 1; i >= 0; i -= 1) {
    const pickup = pickups[i];
    if (rectRectCollide(player, pickup)) {
      pickups.splice(i, 1);
      applyPickup(pickup.type);
    }
  }
}

function damagePlayer(amount) {
  if (player.invincible > 0) return;
  if (player.shield > 0) {
    player.shield = Math.max(0, player.shield - amount);
    if (player.shield === 0) {
      player.invincible = 0.6;
    }
    return;
  }

  player.hp -= amount;
  player.invincible = 1.0;
  screenShake = Math.min(0.55, screenShake + 0.16);
  combo = 0;
  comboTimer = 0;
  particles.push(...createBurst(player.x, player.y, '#ff8c42', 20, 200));
  if (player.hp <= 0) {
    gameOver();
  }
}

function killEnemy(enemy) {
  enemies = enemies.filter((item) => item !== enemy);
  combo += 1;
  comboTimer = 1.2;
  score += (enemy.score || 75) + combo * 5;
  updateHighScore();
  screenShake = Math.min(0.45, screenShake + 0.08);
  particles.push(...createBurst(enemy.x, enemy.y, enemy.type === 'elite' ? '#ffd166' : '#7de3ff', 18, 180));

  if (Math.random() < 0.13) {
    const type = Math.random() < 0.5 ? 'heal' : 'shield';
    pickups.push({ x: enemy.x, y: enemy.y, width: 16, height: 16, speed: 110, type });
  }
}

function applyPickup(type) {
  if (type === 'heal') {
    player.hp = Math.min(player.maxHp, player.hp + 1);
  } else if (type === 'shield') {
    player.shield = Math.min(player.maxShield + 1, player.shield + 1);
  }
  particles.push(...createBurst(player.x, player.y, '#9a72ff', 8, 120));
}

function maybeTriggerUpgrade(dt) {
  if (upgradePending || gameState !== 'playing') return;
  if (gameTime >= nextUpgradeTime) {
    upgradePending = true;
    showUpgrade();
    nextUpgradeTime += 18 + Math.random() * 8;
  }

  if (!boss && gameTime > 85) {
    spawnBoss();
  }
}

function showUpgrade() {
  gameState = 'upgrade';
  upgradePanel.classList.remove('hidden');
  const options = [
    {
      title: '双重火力',
      desc: '增加一束额外子弹，提高输出密度。',
      apply: () => {
        player.multiShot += 1;
      }
    },
    {
      title: '散射炮',
      desc: '开启扩散射击，攻击范围更广。',
      apply: () => {
        player.spread += 1;
      }
    },
    {
      title: '护盾强化',
      desc: '升级护盾容量，抵挡一次额外伤害。',
      apply: () => {
        player.maxShield += 1;
        player.shield = player.maxShield;
      }
    },
    {
      title: '速射强化',
      desc: '提升射速，让你的火力更连续。',
      apply: () => {
        player.fireRate += 1.4;
      }
    },
    {
      title: '追踪导弹',
      desc: '子弹会自动锁定敌机，压制更高效。',
      apply: () => {
        player.tracking = true;
      }
    },
    {
      title: '炸弹储备',
      desc: '增加一个特殊炸弹，可清空周围敌机。',
      apply: () => {
        player.specialCharges += 1;
      }
    }
  ];

  const picked = [];
  while (picked.length < 3) {
    const item = options[Math.floor(Math.random() * options.length)];
    if (!picked.includes(item)) picked.push(item);
  }

  upgradeOptions.innerHTML = '';
  picked.forEach((option) => {
    const card = document.createElement('button');
    card.className = 'upgrade-card';
    card.innerHTML = `<h3>${option.title}</h3><p>${option.desc}</p>`;
    card.onclick = () => {
      option.apply();
      upgradePanel.classList.add('hidden');
      gameState = 'playing';
      upgradePending = false;
      particles.push(...createBurst(player.x, player.y, '#7de3ff', 14, 140));
    };
    upgradeOptions.appendChild(card);
  });
}

function spawnEnemy() {
  const typeRoll = Math.random();
  let enemy = null;
  const x = 30 + Math.random() * (width - 60);
  const y = -30;
  if (gameTime > 28 && typeRoll < 0.18) {
    enemy = {
      x,
      y,
      width: 38,
      height: 38,
      hp: 4,
      speed: 130 + Math.random() * 30,
      type: 'elite',
      score: 140,
      shootTimer: 0.8 + Math.random() * 0.5,
      seed: Math.random() * 10,
      hitFlash: 0
    };
  } else if (gameTime > 45 && typeRoll < 0.3) {
    enemy = {
      x,
      y,
      width: 44,
      height: 40,
      hp: 3,
      speed: 150 + Math.random() * 25,
      type: 'bomber',
      score: 100,
      hitFlash: 0
    };
  } else {
    enemy = {
      x,
      y,
      width: 28,
      height: 26,
      hp: 2,
      speed: 110 + Math.random() * 25,
      type: 'basic',
      score: 70,
      hitFlash: 0
    };
  }
  enemies.push(enemy);
}

function spawnBoss() {
  boss = {
    x: width / 2,
    y: -120,
    width: 120,
    height: 124,
    hp: 260,
    maxHp: 260,
    phase: 1,
    attackTimer: 0.8,
    hitFlash: 0
  };
  bossWarningTimer = 2.2;
  screenShake = 0.22;
}

function gameOver() {
  gameState = 'menu';
  overlay.classList.remove('hidden');
  overlay.querySelector('.panel').innerHTML = `
    <h1>任务失败</h1>
    <p>你的战机被击毁，星域的夜色再次吞没了希望。</p>
    <div class="controls">
      <div>本局分数：${score}</div>
      <div>最高分数：${highScore}</div>
    </div>
    <button id="restartBtn">重新出发</button>
  `;
  document.getElementById('restartBtn').onclick = () => startGame();
}

function updateHighScore() {
  if (score > highScore) {
    highScore = score;
    localStorage.setItem('starborne-high-score', String(highScore));
  }
}

function createBurst(x, y, color, count, speed) {
  return Array.from({ length: count }, () => ({
    x,
    y,
    vx: (Math.random() - 0.5) * speed,
    vy: (Math.random() - 0.5) * speed,
    life: 0.4 + Math.random() * 0.3,
    color
  }));
}

function rectRectCollide(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function rectCircleCollide(rect, circle) {
  const closestX = Math.max(rect.x, Math.min(rect.x + rect.width, circle.x));
  const closestY = Math.max(rect.y, Math.min(rect.y + rect.height, circle.y));
  const dx = circle.x - closestX;
  const dy = circle.y - closestY;
  return dx * dx + dy * dy < circle.radius * circle.radius;
}

function render() {
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  if (screenShake > 0) {
    ctx.translate((Math.random() - 0.5) * screenShake * 16, (Math.random() - 0.5) * screenShake * 16);
  }
  drawBackground();
  drawStars();

  if (player) {
    drawPlayer();
  }

  bullets.forEach(drawBullet);
  enemies.forEach(drawEnemy);
  pickups.forEach(drawPickup);
  particles.forEach(drawParticle);
  if (boss) drawBoss();
  drawHud();
  drawBossAlert();
  ctx.restore();
}

function drawBackground() {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, '#08111e');
  gradient.addColorStop(0.45, '#050814');
  gradient.addColorStop(1, '#010208');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  const glow = ctx.createRadialGradient(width * 0.2, height * 0.15, 0, width * 0.2, height * 0.15, width * 0.35);
  glow.addColorStop(0, 'rgba(0, 208, 255, 0.16)');
  glow.addColorStop(1, 'rgba(0, 208, 255, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  const glow2 = ctx.createRadialGradient(width * 0.8, height * 0.22, 0, width * 0.8, height * 0.22, width * 0.32);
  glow2.addColorStop(0, 'rgba(170, 78, 255, 0.15)');
  glow2.addColorStop(1, 'rgba(170, 78, 255, 0)');
  ctx.fillStyle = glow2;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = 'rgba(126, 191, 255, 0.08)';
  ctx.lineWidth = 1;
  for (let i = 0; i < width; i += 90) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, height);
    ctx.stroke();
  }
  for (let i = 0; i < height; i += 90) {
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(width, i);
    ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(126, 191, 255, 0.06)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, height * 0.8 + Math.sin(gameTime * 0.4) * 16);
  ctx.quadraticCurveTo(width * 0.25, height * 0.75, width * 0.5, height * 0.8 + Math.cos(gameTime * 0.3) * 10);
  ctx.quadraticCurveTo(width * 0.75, height * 0.85, width, height * 0.8 + Math.sin(gameTime * 0.5) * 16);
  ctx.stroke();
}

function drawStars() {
  stars.forEach((star) => {
    const alpha = star.alpha * (0.65 + 0.35 * Math.sin(star.twinkle));
    ctx.beginPath();
    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawPlayer() {
  ctx.save();
  ctx.translate(player.x, player.y);
  ctx.shadowBlur = 24;
  ctx.shadowColor = '#7de3ff';

  ctx.fillStyle = player.invincible > 0 ? '#d8f5ff' : '#7de3ff';
  ctx.beginPath();
  ctx.moveTo(0, -28);
  ctx.lineTo(16, 12);
  ctx.lineTo(8, 8);
  ctx.lineTo(0, 18);
  ctx.lineTo(-8, 8);
  ctx.lineTo(-16, 12);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#9ff5ff';
  ctx.fillRect(-8, 0, 16, 12);
  ctx.fillRect(-6, 12, 12, 8);
  ctx.fillStyle = '#ff8c42';
  ctx.fillRect(-2, -22, 4, 10);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
  ctx.fillRect(-10, -8, 20, 2);
  ctx.restore();

  if (player.shield > 0) {
    ctx.beginPath();
    ctx.arc(player.x, player.y, 30, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(157, 245, 255, 0.7)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function drawBullet(bullet) {
  ctx.save();
  ctx.fillStyle = bullet.color;
  ctx.beginPath();
  ctx.arc(bullet.x, bullet.y, bullet.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawEnemy(enemy) {
  ctx.save();
  ctx.translate(enemy.x, enemy.y);
  if (enemy.hitFlash > 0) {
    ctx.shadowBlur = 16;
    ctx.shadowColor = '#ff9f43';
  }
  if (enemy.type === 'elite') {
    ctx.fillStyle = '#ff7d7d';
    ctx.beginPath();
    ctx.moveTo(0, -19);
    ctx.lineTo(16, -2);
    ctx.lineTo(8, 18);
    ctx.lineTo(-8, 18);
    ctx.lineTo(-16, -2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffd166';
    ctx.fillRect(-7, -9, 14, 8);
  } else if (enemy.type === 'bomber') {
    ctx.fillStyle = '#ff5f5f';
    ctx.beginPath();
    ctx.moveTo(0, -18);
    ctx.lineTo(20, -6);
    ctx.lineTo(14, 18);
    ctx.lineTo(-14, 18);
    ctx.lineTo(-20, -6);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.fillStyle = '#6ad7ff';
    ctx.beginPath();
    ctx.moveTo(0, -14);
    ctx.lineTo(12, 0);
    ctx.lineTo(0, 14);
    ctx.lineTo(-12, 0);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawPickup(pickup) {
  ctx.save();
  ctx.translate(pickup.x, pickup.y);
  ctx.fillStyle = pickup.type === 'heal' ? '#8fffd7' : '#9a72ff';
  ctx.beginPath();
  ctx.arc(0, 0, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawParticle(particle) {
  ctx.save();
  ctx.globalAlpha = Math.max(0, particle.life / 0.5);
  ctx.fillStyle = particle.color;
  ctx.beginPath();
  ctx.arc(particle.x, particle.y, 2.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBoss() {
  ctx.save();
  ctx.translate(boss.x, boss.y);
  if (boss.hitFlash > 0) {
    ctx.shadowBlur = 24;
    ctx.shadowColor = '#ff8e3c';
  }
  ctx.fillStyle = '#ff4d6d';
  ctx.beginPath();
  ctx.moveTo(0, -66);
  ctx.lineTo(46, -30);
  ctx.lineTo(28, 46);
  ctx.lineTo(0, 64);
  ctx.lineTo(-28, 46);
  ctx.lineTo(-46, -30);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#ffd166';
  ctx.fillRect(-16, -12, 32, 18);
  ctx.fillStyle = '#6ad7ff';
  ctx.fillRect(-24, 12, 48, 8);
  ctx.restore();

  ctx.fillStyle = 'rgba(255, 95, 95, 0.24)';
  ctx.fillRect(24, 24, width - 48, 14);
  ctx.fillStyle = '#ff5d73';
  ctx.fillRect(24, 24, (boss.hp / boss.maxHp) * (width - 48), 14);
  ctx.fillStyle = '#eaf6ff';
  ctx.font = 'bold 16px sans-serif';
  ctx.fillText('BOSS', 24, 20);
}

function drawBossAlert() {
  if (bossWarningTimer <= 0) return;
  const alpha = Math.min(1, bossWarningTimer / 1.6);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = 'rgba(255, 92, 92, 0.16)';
  ctx.fillRect(0, height * 0.18, width, 64);
  ctx.fillStyle = '#ff6b6b';
  ctx.font = 'bold 28px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('BOSS INBOUND', width / 2, height * 0.225);
  ctx.restore();
}

function drawHud() {
  const panelText = `分数: ${Math.floor(score)}  最高分: ${Math.floor(highScore)}  生命: ${player ? player.hp : 0}  护盾: ${player ? player.shield : 0}  炸弹: ${player ? player.specialCharges : 0}`;
  ctx.save();
  ctx.fillStyle = 'rgba(4, 10, 24, 0.82)';
  ctx.fillRect(18, 18, Math.min(width - 36, 640), 58);
  ctx.strokeStyle = 'rgba(125, 227, 255, 0.45)';
  ctx.lineWidth = 1.2;
  ctx.strokeRect(18, 18, Math.min(width - 36, 640), 58);
  ctx.fillStyle = '#dff6ff';
  ctx.font = '15px sans-serif';
  ctx.fillText(panelText, 32, 46);
  if (combo > 0) {
    ctx.fillStyle = '#ffd166';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText(`COMBO x${combo}`, 32, 66);
  }
  ctx.restore();
}

function handleKeyDown(e) {
  keys[e.code] = true;
  if (e.code === 'Escape') {
    if (gameState === 'playing') {
      gameState = 'menu';
      overlay.classList.remove('hidden');
      overlay.querySelector('.panel').innerHTML = `
        <h1>暂停</h1>
        <p>战斗暂停，准备继续冲锋？</p>
        <div class="controls">
          <div>移动：WASD / 鼠标 / 方向键</div>
          <div>特殊技能：空格键</div>
        </div>
        <button id="resumeBtn">继续战斗</button>
      `;
      document.getElementById('resumeBtn').onclick = () => {
        gameState = 'playing';
        overlay.classList.add('hidden');
      };
    }
  }
}

function handleKeyUp(e) {
  keys[e.code] = false;
}

function handlePointerMove(e) {
  const rect = canvas.getBoundingClientRect();
  mouse.x = e.clientX - rect.left;
  mouse.y = e.clientY - rect.top;
  mouse.active = true;
}

function handlePointerLeave() {
  mouse.active = false;
}

window.addEventListener('resize', resizeCanvas);
window.addEventListener('keydown', handleKeyDown);
window.addEventListener('keyup', handleKeyUp);
window.addEventListener('mousemove', handlePointerMove);
window.addEventListener('touchmove', (e) => {
  if (e.touches[0]) {
    const rect = canvas.getBoundingClientRect();
    mouse.x = e.touches[0].clientX - rect.left;
    mouse.y = e.touches[0].clientY - rect.top;
    mouse.active = true;
  }
}, { passive: true });
canvas.addEventListener('mouseleave', handlePointerLeave);
startBtn.addEventListener('click', startGame);

resizeCanvas();
render();
requestAnimationFrame(loop);
