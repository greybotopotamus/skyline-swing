// Keyboard + mouse input.
// The game is "playing" once the player clicks Play. We try to capture the mouse
// (pointer lock) for proper mouse-look, but play continues without it: some
// embedded browsers refuse pointer lock, and browsers also refuse it for about a
// second after Esc. Without lock, plain mouse movement still turns the camera.
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
    this.playing = false;
    this.onPlayingChange = null;

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.playing && !this.locked) this.setPlaying(false);
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.buttons.clear();
    });

    document.addEventListener('pointerlockchange', () => {
      const wasLocked = this.locked;
      this.locked = document.pointerLockElement === dom;
      if (!this.locked) this.buttons.clear();
      // Leaving pointer lock (Esc) pauses the game.
      if (wasLocked && !this.locked) this.setPlaying(false);
    });
    document.addEventListener('pointerlockerror', () => { this.locked = false; });

    // Cursor position in -1..1 (used for edge-turning when the mouse isn't captured).
    this.cursorX = 0;
    this.cursorY = 0;
    document.addEventListener('mousemove', (e) => {
      this.cursorX = (e.clientX / window.innerWidth) * 2 - 1;
      this.cursorY = (e.clientY / window.innerHeight) * 2 - 1;
      if (!this.playing) return;
      this.dx += e.movementX || 0;
      this.dy += e.movementY || 0;
    });
    // Cursor left the page (e.g. moved to another window): stop edge-turning.
    document.documentElement.addEventListener('mouseleave', () => {
      this.cursorX = 0;
      this.cursorY = 0;
    });
    dom.addEventListener('mousedown', (e) => {
      if (!this.playing) return;
      this.buttons.add(e.button);
      this.buttonsPressed.add(e.button);
      // Retry mouse capture if it isn't active (e.g. it was refused right after Esc).
      if (!this.locked) this.tryLock();
    });
    document.addEventListener('mouseup', (e) => {
      if (this.buttons.has(e.button)) this.buttonsReleased.add(e.button);
      this.buttons.delete(e.button);
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  start() {
    this.setPlaying(true);
    this.tryLock();
  }

  tryLock() {
    try {
      const p = this.dom.requestPointerLock?.();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {
      // Pointer lock unavailable; free mouse-look fallback is used instead.
    }
  }

  setPlaying(v) {
    if (this.playing === v) return;
    this.playing = v;
    this.keys.clear();
    this.buttons.clear();
    this.onPlayingChange?.(v);
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
