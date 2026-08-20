/**
 * utils.js — 数学、碰撞、A* 寻路等通用工具。
 */
window.BC = window.BC || {};

BC.utils = {
  clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; },

  rand(min, max) { return min + Math.random() * (max - min); },

  randInt(min, max) { return Math.floor(min + Math.random() * (max - min + 1)); },

  /** AABB 相交检测 */
  aabb(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  },

  /** 点是否落在矩形内 */
  pointInRect(px, py, rx, ry, rw, rh) {
    return px >= rx && px <= rx + rw && py >= ry && py <= ry + rh;
  },

  /** 距离 */
  dist(x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    return Math.sqrt(dx * dx + dy * dy);
  },

  /** 颜色明暗调节：percent 负=变暗，正=变亮（-100~100） */
  shade(hex, percent) {
    const n = parseInt(String(hex).replace('#', ''), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const t = percent < 0 ? 0 : 255;
    const p = Math.abs(percent) / 100;
    r = Math.round((t - r) * p + r);
    g = Math.round((t - g) * p + g);
    b = Math.round((t - b) * p + b);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  },
};

/**
 * A* 寻路：在网格地图上找一条路径。
 * @param {number[][]} grid 可通行标记（1=可通行）
 * @param {number} cols
 * @param {number} rows
 * @param {{x,y}} start 起点（格子坐标）
 * @param {{x,y}} goal 终点（格子坐标）
 * @returns {Array<{x,y}>} 路径（不含起点），不可达返回 null
 */
BC.utils.astar = function (grid, cols, rows, start, goal) {
  if (start.x === goal.x && start.y === goal.y) return [];
  const key = (x, y) => y * cols + x;
  const open = [];            // 简化：用数组 + 线性取最小（地图很小，性能足够）
  const came = new Map();
  const g = new Map();
  const startK = key(start.x, start.y);
  g.set(startK, 0);
  open.push({ x: start.x, y: start.y, f: 0 });

  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  while (open.length) {
    // 取 f 最小节点
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const cur = open.splice(bi, 1)[0];
    const curK = key(cur.x, cur.y);

    if (cur.x === goal.x && cur.y === goal.y) {
      // 回溯路径
      const path = [];
      let k = curK;
      while (came.has(k)) {
        const prev = came.get(k);
        path.push({ x: prev.x, y: prev.y });
        k = key(prev.x, prev.y);
      }
      path.reverse();
      return path; // 不含终点
    }

    for (const [dx, dy] of dirs) {
      const nx = cur.x + dx, ny = cur.y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      if (!grid[ny][nx]) continue;
      const nk = key(nx, ny);
      const ng = g.get(curK) + 1;
      if (!g.has(nk) || ng < g.get(nk)) {
        g.set(nk, ng);
        came.set(nk, { x: cur.x, y: cur.y });
        const h = Math.abs(nx - goal.x) + Math.abs(ny - goal.y);
        open.push({ x: nx, y: ny, f: ng + h });
      }
    }
  }
  return null;
};
