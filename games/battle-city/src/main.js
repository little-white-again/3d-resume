/**
 * main.js — 入口与渲染循环。
 * 组装游戏、驱动 update/render，负责 HUD 与各类覆盖层（菜单/暂停/胜负/调试）。
 */
window.BC = window.BC || {};

(function () {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const game = new BC.Game(canvas);

  const elScore = document.getElementById('score');
  const elWave = document.getElementById('wave');
  const elLives = document.getElementById('lives');
  const elCombo = document.getElementById('combo');
  const elLevel = document.getElementById('level');
  const elHighscore = document.getElementById('highscore');

  // FPS 统计
  let fps = 60, lastTime = performance.now(), frames = 0, fpsTimer = 0;

  function tankIcons(n, color) {
    let s = '';
    for (let i = 0; i < n; i++) {
      s += '<span class="tank-ico" style="background:' + color + ';box-shadow:0 0 6px ' + color + '"></span>';
    }
    return s || '<span class="tank-ico dead"></span>';
  }

  function updateHUD() {
    elScore.textContent = game.score;
    elWave.textContent = game.wave || 1;
    if (game.mode !== 'solo') {
      elLives.innerHTML = tankIcons(game.lives, '#5fce7a') + '<span class="tank-sep"></span>' + tankIcons(game.lives2, '#4a9fe0');
    } else {
      elLives.innerHTML = tankIcons(game.lives, '#5fce7a');
    }
    elLevel.textContent = (game.level || 0) + 1;
    elHighscore.textContent = game.highscore;
    if (game.combo > 1) {
      elCombo.textContent = 'COMBO x' + game.combo;
    } else {
      elCombo.textContent = '';
    }
  }

  function drawOverlay() {
    const W = canvas.width, H = canvas.height;
    const S = BC.GAME.STATES;
    if (game.state === S.MENU) {
      dim(ctx, W, H, 0.74);
      title(ctx, W, '坦克大战', 46);
      title(ctx, W, 'V I B E  重 制', 18);
      // 菜单选项框
      const boxY = H / 2 - 44;
      ctx.fillStyle = 'rgba(18,18,26,0.82)';
      ctx.fillRect(W / 2 - 178, boxY, 356, 168);
      ctx.strokeStyle = 'rgba(242,201,76,0.28)';
      ctx.lineWidth = 1;
      ctx.strokeRect(W / 2 - 178, boxY, 356, 168);
      const diff = game.hardcore ? '硬核' : '普通';
      const modeName = game.mode === 'solo' ? '单人' : game.mode === 'coop' ? '双人合作' : '双人对战';
      text(ctx, W, boxY + 32, '难度：' + diff + '（W/S） · 模式：' + modeName + '（A/D）',
        game.hardcore ? '#ff6b6b' : '#f2c94c', 16);
      text(ctx, W, boxY + 64, '按 Enter 开始', '#f2c94c', 20);
      text(ctx, W, boxY + 94, '目标：摧毁顶部红色敌基地', '#aab0ba', 13);
      text(ctx, W, boxY + 116, '最高分 ' + game.highscore, '#8a8f9c', 12);
      const hint = game.mode === 'solo' ? '方向键/WASD 移动 · 空格/J 射击'
        : 'P1:方向键+空格/J · P2:WASD+F/G/K 开火';
      text(ctx, W, boxY + 140, hint, '#6e727a', 12);
      text(ctx, W, H - 24, 'E 关卡编辑器 · F2 CRT · F3 调试', '#6e727a', 12);
    } else if (game.state === S.PAUSED) {
      dim(ctx, W, H, 0.55);
      title(ctx, W, '暂 停', 40);
      text(ctx, W, H / 2 + 12, '按 P 继续', '#f2c94c', 16);
    } else if (game.state === S.VICTORY) {
      dim(ctx, W, H, 0.7);
      if (game.pvpWinner) {
        title(ctx, W, '玩家 ' + game.pvpWinner + ' 胜!', 44);
        text(ctx, W, H / 2 + 10, '对战模式 · 玩家 ' + game.pvpWinner + ' 获胜', '#f2c94c', 20);
      } else {
        title(ctx, W, '胜 利 !', 44);
        text(ctx, W, H / 2 + 10, '最终得分 ' + game.score + ' · 评级 ' + game.getRank(), '#f2c94c', 20);
      }
      text(ctx, W, H / 2 + 44, '按 Enter 返回菜单', '#aab0ba', 14);
    } else if (game.state === S.DEFEAT) {
      dim(ctx, W, H, 0.7);
      title(ctx, W, '游戏结束', 44);
      text(ctx, W, H / 2 + 10, '最终得分 ' + game.score, '#e24b4a', 20);
      text(ctx, W, H / 2 + 44, '按 Enter 返回菜单', '#aab0ba', 14);
    } else if (game.state === S.EDITOR) {
      // 关卡编辑器提示条
      const names = { 0: '空地', 1: '砖墙', 2: '钢墙', 3: '水域', 4: '草地', 5: '基地', 6: '敌方基地' };
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(0, 0, W, 30);
      ctx.fillStyle = '#f2c94c';
      ctx.font = '13px monospace';
      ctx.textAlign = 'left';
      ctx.fillText('编辑器 · 鼠标放置 · 当前：' + (names[game.editor.tile] || '?'), 12, 20);
      ctx.fillStyle = '#aab0ba';
      ctx.font = '12px monospace';
      ctx.fillText('1空地 2砖 3钢 4水 5草 6基地 7敌基 · S保存 · Enter游玩 · Esc返回', 12, H - 10);
    }

    if (game.showDebug) drawDebug(ctx);
  }

  function dim(ctx, W, H, a) {
    ctx.fillStyle = 'rgba(0,0,0,' + a + ')';
    ctx.fillRect(0, 0, W, H);
  }
  function title(ctx, W, t, size) {
    ctx.textAlign = 'center';
    ctx.font = '700 ' + size + 'px "Courier New", monospace';
    const y = 150 + size;
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillText(t, W / 2 + 2, y + 3);
    ctx.fillStyle = '#f2c94c';
    ctx.fillText(t, W / 2, y);
  }
  function text(ctx, W, y, t, color, size) {
    ctx.fillStyle = color;
    ctx.font = size + 'px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(t, W / 2, y);
  }

  function drawDebug(ctx) {
    const d = game.debugInfo();
    const lines = [
      'FPS: ' + Math.round(fps),
      'enemies: ' + d.enemies + ' / queue ' + d.queue,
      'bullets: ' + d.bullets,
      'particles: ' + d.particles,
      'combo: ' + d.combo,
    ];
    // AI 有限状态机可视化：显示每个敌人的类型 + 当前状态
    const aiLines = game.enemies.map(e =>
      (e.boss ? '[BOSS] ' : '') + e.type + ' → ' + (e.ai ? e.ai.state : '?'));
    const all = aiLines.length ? lines.concat(['— AI FSM —']).concat(aiLines) : lines;
    const H = 20 + all.length * 17;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.82)';
    ctx.fillRect(8, 8, 175, H);
    ctx.fillStyle = '#4ad1ff';
    ctx.font = '12px monospace';
    ctx.textAlign = 'left';
    all.forEach((l, i) => ctx.fillText(l, 16, 28 + i * 17));
    ctx.restore();
  }

  // 关卡编辑器：鼠标点击/拖动放置地块
  let mouseDown = false;
  function canvasPos(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }
  function editorAction(e) {
    if (game.state !== BC.GAME.STATES.EDITOR) return;
    const p = canvasPos(e);
    game.editor.hoverX = Math.floor(p.x / BC.CONFIG.TILE);
    game.editor.hoverY = Math.floor(p.y / BC.CONFIG.TILE);
    if (mouseDown) {
      game.editor.setTile(game.editor.hoverX, game.editor.hoverY);
    }
  }
  canvas.addEventListener('mousedown', (e) => { mouseDown = true; editorAction(e); });
  canvas.addEventListener('mousemove', (e) => { editorAction(e); });
  canvas.addEventListener('mouseup', () => { mouseDown = false; });
  canvas.addEventListener('mouseleave', () => {
    mouseDown = false;
    game.editor.hoverX = null;
    game.editor.hoverY = null;
  });

  function loop(now) {
    // FPS
    frames++;
    fpsTimer += now - lastTime;
    lastTime = now;
    if (fpsTimer >= 500) { fps = frames * 1000 / fpsTimer; frames = 0; fpsTimer = 0; }

    game.update(1);
    game.render(ctx);
    drawOverlay();
    updateHUD();
    game.input.endFrame();
    requestAnimationFrame(loop);
  }

  // 首帧绘制菜单
  game.render(ctx);
  drawOverlay();
  updateHUD();
  requestAnimationFrame(loop);
})();
