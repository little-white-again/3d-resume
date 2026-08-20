/**
 * input.js — 键盘输入管理（方向键 / WASD / 空格，支持按键提示）。
 * 额外处理 iframe 预览面板的键盘焦点问题：自动聚焦 + 点击聚焦。
 */
window.BC = window.BC || {};

BC.Input = class {
  constructor() {
    this.keys = {};
    this.pressed = {}; // 本帧刚按下（边沿触发）
    this.onKeyDown = null; // 供菜单等一次性按键使用
    this.focused = true;

    // 只挂 window（keydown 会冒泡到 window，挂两处会导致每个键触发两次）
    window.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
        e.preventDefault();
      }
      if (!this.keys[e.code]) this.pressed[e.code] = true;
      this.keys[e.code] = true;
      if (this.onKeyDown) this.onKeyDown(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });

    // 焦点修复：iframe 预览面板需先获得键盘焦点，打开页面即可操作
    const focus = () => {
      this.focused = true;
      try {
        window.focus();
        if (document.body) document.body.focus();
      } catch (err) { /* 忽略 */ }
    };
    focus();
    window.addEventListener('mousedown', focus);
    window.addEventListener('touchstart', focus);
    window.addEventListener('pointerdown', focus);
    window.addEventListener('click', focus);
    window.addEventListener('focus', () => { this.focused = true; });
    window.addEventListener('blur', () => { this.focused = false; });
  }

  get up()    { return this.keys['ArrowUp']    || this.keys['KeyW']; }
  get down()  { return this.keys['ArrowDown']  || this.keys['KeyS']; }
  get left()  { return this.keys['ArrowLeft']  || this.keys['KeyA']; }
  get right() { return this.keys['ArrowRight'] || this.keys['KeyD']; }
  get fire()  { return this.keys['Space']      || this.keys['KeyJ']; }

  /** 玩家 1：方向键移动 + 空格/J 射击 */
  get p1() {
    return {
      up: this.keys['ArrowUp'], down: this.keys['ArrowDown'],
      left: this.keys['ArrowLeft'], right: this.keys['ArrowRight'],
      fire: this.keys['Space'] || this.keys['KeyJ'],
    };
  }

  /** 玩家 1（单人模式）：方向键 + WASD 都能移动，空格/J 射击 */
  get p1solo() {
    return {
      up: this.keys['ArrowUp'] || this.keys['KeyW'],
      down: this.keys['ArrowDown'] || this.keys['KeyS'],
      left: this.keys['ArrowLeft'] || this.keys['KeyA'],
      right: this.keys['ArrowRight'] || this.keys['KeyD'],
      fire: this.keys['Space'] || this.keys['KeyJ'],
    };
  }

  /** 玩家 2：WASD 移动 + F/G/K 射击 */
  get p2() {
    return {
      up: this.keys['KeyW'], down: this.keys['KeyS'],
      left: this.keys['KeyA'], right: this.keys['KeyD'],
      fire: this.keys['KeyF'] || this.keys['KeyG'] || this.keys['KeyK'],
    };
  }

  wasPressed(code) { return !!this.pressed[code]; }

  /** 每帧末尾调用，清空边沿触发状态 */
  endFrame() { this.pressed = {}; }
};
