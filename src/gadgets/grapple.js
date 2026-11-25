import * as THREE from 'three';

const RANGE = 140;
const HOOK_SPEED = 280; // m/s the hook travels before latching
const REEL_SPEED = 22;
const MIN_LENGTH = 2.5;
const SWING_ACCEL = 16; // steering force while swinging
const RELEASE_BOOST = 1.08;
const ATTACH_YANK = 10;
const GROUND_HOP = 6;

// Grappling hook. Hold left mouse to fire and hang on, right mouse to reel in.
// The rope is an inextensible constraint: it never lets the player get further
// than `length` from the anchor, and takes up slack automatically.
export class Grapple {
  constructor(scene) {
    this.name = 'Grappling hook';
    this.range = RANGE;
    this.state = 'idle'; // idle | firing | attached
    this.anchor = new THREE.Vector3();
    this.length = 0;
    this.travel = 0;
    this.fireDist = 0;
    this.reeling = false;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    this.rope = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xeaf6ff }));
    this.rope.frustumCulled = false;
    this.rope.visible = false;
    scene.add(this.rope);
  }

  // aim: result of the camera raycast ({ point, distance } or null)
  handleInput(input, player, aim) {
    if (input.mousePressed(0) && aim && aim.distance <= RANGE) {
      this.state = 'firing';
      this.anchor.copy(aim.point);
      this.travel = 0;
      this.fireDist = player.pos.distanceTo(aim.point);
    }
    if (input.mouseReleased(0) || (!input.mouseDown(0) && this.state !== 'idle')) {
      this.release(player);
    }
    this.reeling = input.mouseDown(2);
  }

  release(player, boost = true) {
    if (this.state === 'attached' && boost && !player.onGround) {
      player.vel.x *= RELEASE_BOOST;
      player.vel.z *= RELEASE_BOOST;
      if (player.vel.y > -4) player.vel.y += 3;
    }
    this.state = 'idle';
  }

  physics(dt, player) {
    if (this.state === 'firing') {
      this.travel += HOOK_SPEED * dt;
      if (this.travel >= this.fireDist) {
        this.state = 'attached';
        this.length = player.pos.distanceTo(this.anchor);
        // Yank toward the anchor so latching on feels punchy and lifts you off the ground.
        const pull = this.anchor.clone().sub(player.pos).normalize();
        player.vel.addScaledVector(pull, ATTACH_YANK);
        if (player.onGround) {
          player.vel.y += GROUND_HOP;
          player.onGround = false;
        }
      }
      return;
    }
    if (this.state !== 'attached') return;

    const toPlayer = player.pos.clone().sub(this.anchor);
    const dist = toPlayer.length();
    if (dist < MIN_LENGTH) {
      this.release(player);
      return;
    }
    const n = toPlayer.divideScalar(dist); // unit vector anchor -> player

    this.length = Math.min(this.length, dist); // take up slack
    if (this.reeling) this.length = Math.max(MIN_LENGTH, this.length - REEL_SPEED * dt);

    // Steering: push along the swing plane in the direction the player wants to go.
    if (!player.onGround && player.wish.lengthSq() > 0) {
      const t = player.wish.clone().addScaledVector(n, -player.wish.dot(n));
      if (t.lengthSq() > 1e-6) player.vel.addScaledVector(t.normalize(), SWING_ACCEL * dt);
    }

    // Constraint: if next position would be beyond the rope, pull it back onto the sphere.
    const predicted = player.pos.clone().addScaledVector(player.vel, dt);
    const d = predicted.distanceTo(this.anchor);
    if (d > this.length) {
      predicted.sub(this.anchor).setLength(this.length).add(this.anchor);
      player.vel.copy(predicted.sub(player.pos).divideScalar(dt));
    }
  }

  updateVisual(handPos) {
    if (this.state === 'idle') {
      this.rope.visible = false;
      return;
    }
    const end =
      this.state === 'firing'
        ? handPos.clone().lerp(this.anchor, Math.min(1, this.travel / Math.max(this.fireDist, 1e-3)))
        : this.anchor;
    const arr = this.rope.geometry.attributes.position.array;
    arr[0] = handPos.x; arr[1] = handPos.y; arr[2] = handPos.z;
    arr[3] = end.x; arr[4] = end.y; arr[5] = end.z;
    this.rope.geometry.attributes.position.needsUpdate = true;
    this.rope.visible = true;
  }
}
