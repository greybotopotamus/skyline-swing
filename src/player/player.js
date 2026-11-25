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
    this.ride = null; // car the player is standing on (moves with it)
    this.respawn();
  }

  respawn() {
    this.pos.copy(this.world.spawn);
    this.vel.set(0, 0, 0);
    this.ride = null;
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

    // Standing on a car: move with it.
    const ride = this.ride;
    if (ride) this.pos.add(ride.delta);

    if (this.onGround) {
      const speed = this.sprint ? SPRINT_SPEED : WALK_SPEED;
      const k = Math.min(1, GROUND_ACCEL * dt);
      v.x += (this.wish.x * speed - v.x) * k;
      v.z += (this.wish.z * speed - v.z) * k;
      if (this.jumpQueued) {
        v.y = JUMP_SPEED;
        this.onGround = false;
        // Jumping off a moving car keeps its momentum.
        if (ride) v.addScaledVector(ride.delta, 1 / dt).setY(JUMP_SPEED);
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
    this.ride = null;
    this._move('x', v.x * dt);
    this._move('z', v.z * dt);
    this._move('y', v.y * dt);
    this._resolveCars(dt);

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
    for (const b of this.world.dynamic) {
      if (!overlaps(p, b)) continue;
      if (amount > 0) p[axis] = b.min[axis] - HALF[axis] - EPS;
      else p[axis] = b.max[axis] + HALF[axis] + EPS;
      this.vel[axis] = 0;
      if (axis === 'y' && amount < 0) {
        this.onGround = true;
        this.ride = b.car;
      }
    }
  }

  // Cars move into the player too: push the player out (onto the roof if they
  // are near the top, otherwise sideways with a bump from the car).
  _resolveCars(dt) {
    const p = this.pos;
    for (const b of this.world.dynamic) {
      if (!overlaps(p, b)) continue;
      const fromTop = b.max.y - (p.y - HALF.y);
      if (fromTop < 0.7) {
        p.y = b.max.y + HALF.y + EPS;
        if (this.vel.y < 0) this.vel.y = 0;
        this.onGround = true;
        this.ride = b.car;
        continue;
      }
      const penX = Math.min(p.x + HALF.x - b.min.x, b.max.x - (p.x - HALF.x));
      const penZ = Math.min(p.z + HALF.z - b.min.z, b.max.z - (p.z - HALF.z));
      const cx = (b.min.x + b.max.x) / 2;
      const cz = (b.min.z + b.max.z) / 2;
      if (penX < penZ) p.x += p.x < cx ? -penX - EPS : penX + EPS;
      else p.z += p.z < cz ? -penZ - EPS : penZ + EPS;
      const carSpeed = b.car.delta.length() / dt;
      if (carSpeed > 2) {
        this.vel.x = (b.car.delta.x / dt) * 1.2;
        this.vel.z = (b.car.delta.z / dt) * 1.2;
        this.vel.y = Math.max(this.vel.y, 4);
      }
    }
  }
}

function overlaps(p, b) {
  return (
    p.x + HALF.x > b.min.x && p.x - HALF.x < b.max.x &&
    p.y + HALF.y > b.min.y && p.y - HALF.y < b.max.y &&
    p.z + HALF.z > b.min.z && p.z - HALF.z < b.max.z
  );
}
