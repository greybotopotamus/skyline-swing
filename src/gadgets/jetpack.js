const THRUST = 40; // upward accel (gravity is 24, so net ~ +16)
const HORIZONTAL_THRUST = 14;
const MAX_RISE = 18;
const BURN_RATE = 0.3; // fraction of tank per second (~3.3s of flight)
const REGEN_GROUND = 0.5;
const REGEN_AIR = 0.06;
const ARM_DELAY = 0.2; // seconds after leaving the ground before holding jump fires the jetpack

// Jetpack. Hold Space while airborne to thrust.
export class Jetpack {
  constructor() {
    this.name = 'Jetpack';
    this.fuel = 1;
    this.want = false;
    this.thrusting = false;
  }

  handleInput(input, player) {
    this.want = input.down('Space') && !player.onGround && player.airTime > ARM_DELAY;
  }

  physics(dt, player) {
    const v = player.vel;
    if (this.want && this.fuel > 0) {
      this.thrusting = true;
      v.y = Math.min(MAX_RISE, v.y + THRUST * dt);
      v.x += player.wish.x * HORIZONTAL_THRUST * dt;
      v.z += player.wish.z * HORIZONTAL_THRUST * dt;
      this.fuel = Math.max(0, this.fuel - BURN_RATE * dt);
    } else {
      this.thrusting = false;
      this.fuel = Math.min(1, this.fuel + (player.onGround ? REGEN_GROUND : REGEN_AIR) * dt);
    }
  }
}
