import * as THREE from 'three';

// Player is an axis-aligned box (half extents below). `pos` is the box centre.
export const HALF = new THREE.Vector3(0.4, 0.9, 0.4);

const GRAVITY = 24;
const WALK_SPEED = 9;
const SPRINT_SPEED = 15;
const GROUND_ACCEL = 12; // how quickly ground velocity converges on the target
const AIR_ACCEL = 14;
const AIR_MAX_SPEED = 10; // air control can't push you beyond this on its own
const JUMP_SPEED = 9;
const MAX_SPEED = 90;
const EPS = 1e-4;

export class Player {
  constructor(world) {
    this.world = world;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.onGround = false;
    this.airTime = 0;
    this.jumpQueued = false;
    this.sprint = false;
    this.wish = new THREE.Vector3(); // desired horizontal move direction (world space, length <= 1)
    this._near = [];
    this.respawn();
  }

  respawn() {
    this.pos.copy(this.world.spawn);
    this.vel.set(0, 0, 0);
    this.yaw = this.world.spawnYaw ?? 0;
    this.pitch = 0;
  }

  get forward() {
    return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  get right() {
    return new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  // gadgets: objects with optional physics(dt, player)
  step(dt, gadgets) {
    const v = this.vel;

    if (this.onGround) {
      const speed = this.sprint ? SPRINT_SPEED : WALK_SPEED;
      const k = Math.min(1, GROUND_ACCEL * dt);
      v.x += (this.wish.x * speed - v.x) * k;
      v.z += (this.wish.z * speed - v.z) * k;
      if (this.jumpQueued) {
        v.y = JUMP_SPEED;
        this.onGround = false;
      }
    } else if (this.wish.lengthSq() > 0) {
      const along = v.x * this.wish.x + v.z * this.wish.z;
      if (along < AIR_MAX_SPEED) {
        v.x += this.wish.x * AIR_ACCEL * dt;
        v.z += this.wish.z * AIR_ACCEL * dt;
      }
    }
    this.jumpQueued = false;

    v.y -= GRAVITY * dt;

    for (const g of gadgets) g.physics?.(dt, this);

    if (v.length() > MAX_SPEED) v.setLength(MAX_SPEED);

    this.onGround = false;
    this._move('x', v.x * dt);
    this._move('z', v.z * dt);
    this._move('y', v.y * dt);

    if (this.pos.y - HALF.y < 0) {
      this.pos.y = HALF.y;
      if (v.y < 0) v.y = 0;
      this.onGround = true;
    }

    this.airTime = this.onGround ? 0 : this.airTime + dt;
  }

  _move(axis, amount) {
    if (amount === 0) return;
    const p = this.pos;
    p[axis] += amount;
    const near = this.world.grid.query(p.x - HALF.x, p.z - HALF.z, p.x + HALF.x, p.z + HALF.z, this._near);
    for (const b of near) {
      if (
        p.x + HALF.x > b.min.x && p.x - HALF.x < b.max.x &&
        p.y + HALF.y > b.min.y && p.y - HALF.y < b.max.y &&
        p.z + HALF.z > b.min.z && p.z - HALF.z < b.max.z
      ) {
        if (amount > 0) p[axis] = b.min[axis] - HALF[axis] - EPS;
        else p[axis] = b.max[axis] + HALF[axis] + EPS;
        this.vel[axis] = 0;
        if (axis === 'y' && amount < 0) this.onGround = true;
      }
    }
  }
}
