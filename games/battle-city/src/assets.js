/**
 * assets.js — 图片资源加载（Kenney Topdown Tanks, CC0）。
 * 加载是异步 fire-and-forget，渲染时按需取用，加载失败自动 fallback 到 canvas 绘制。
 * 坦克 sprite 仅含"朝上"朝向，通过 canvas rotate 适配 4 朝向。
 */
window.BC = window.BC || {};

BC.assets = { loaded: {} };

(function () {
  const base = 'assets/kenney_tanks/PNG/';
  const list = [
    // 坦克（Kenney tank 单一朝上，旋转适配 4 朝向）
    { key: 'tankGreen', src: base + 'Tanks/tankGreen.png' },   // 玩家
    { key: 'tankBeige', src: base + 'Tanks/tankBeige.png' },   // 巡逻型
    { key: 'tankRed',   src: base + 'Tanks/tankRed.png'   },   // 狙击型
    { key: 'tankBlue',  src: base + 'Tanks/tankBlue.png'  },   // 突击型
    { key: 'tankBlack', src: base + 'Tanks/tankBlack.png' },   // Boss
    // 子弹
    { key: 'bulletYellow', src: base + 'Bullets/bulletYellow.png' }, // 玩家
    { key: 'bulletRed',    src: base + 'Bullets/bulletRed.png'    }, // 敌方
  ];
  for (const { key, src } of list) {
    const img = new Image();
    img.onload = () => { BC.assets.loaded[key] = img; };
    img.onerror = () => { /* 加载失败时渲染层 fallback 到 canvas 绘制 */ };
    img.src = src;
  }
})();