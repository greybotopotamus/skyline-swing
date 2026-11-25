// Keyboard + mouse input with pointer lock.
// "pressed"/"released" sets are edge-triggered and cleared once per frame by endFrame().
export class Input {
  constructor(dom) {
    this.dom = dom;
    this.keys = new Set();
    this.pressed = new Set();
    this.buttons = new Set();
    this.buttonsPressed = new Set();
    this.buttonsReleased = new Set();
    this.dx = 0;
    this.dy = 0;
    this.locked = false;

    window.addEventListener('keydown', (e) => {
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (e.code === 'Space') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.buttons.clear();
    });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === dom;
      if (!this.locked) this.buttons.clear();
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.dx += e.movementX;
      this.dy += e.movementY;
    });
    document.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      this.buttons.add(e.button);
      this.buttonsPressed.add(e.button);
    });
    document.addEventListener('mouseup', (e) => {
      if (this.buttons.has(e.button)) this.buttonsReleased.add(e.button);
      this.buttons.delete(e.button);
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  requestLock() {
    if (!this.locked) this.dom.requestPointerLock?.();
  }

  down(code) { return this.keys.has(code); }
  justPressed(code) { return this.pressed.has(code); }
  mouseDown(b) { return this.buttons.has(b); }
  mousePressed(b) { return this.buttonsPressed.has(b); }
  mouseReleased(b) { return this.buttonsReleased.has(b); }

  endFrame() {
    this.pressed.clear();
    this.buttonsPressed.clear();
    this.buttonsReleased.clear();
    this.dx = 0;
    this.dy = 0;
  }
}
