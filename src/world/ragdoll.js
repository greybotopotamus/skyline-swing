import * as THREE from 'three';

// A simple Verlet ragdoll: 15 joint particles linked by bones (fixed-length
// sticks), torso braces (keep the chest/hips box from collapsing) and joint
// limits (knees and elbows can bend but not fold flat or hyper-extend past
// straight; the head can't fold into the chest). Particles fall under gravity,
// keep their momentum, slide with friction on the ground and are pushed out of
// buildings. After lying still for a moment the body blends back to standing,
// feet first, then hips, then chest and head, like someone getting up.

// Joint indices.
export const J = {
  pelvis: 0, chest: 1, head: 2,
  shL: 3, elL: 4, haL: 5, shR: 6, elR: 7, haR: 8,
  hipL: 9, knL: 10, ftL: 11, hipR: 12, knR: 13, ftR: 14,
};

// Rest pose in person-local space (unscaled, feet at y=0, facing +Z).
// Hip x is divided by girth because the person's matrix scales x by girth.
export function restPose(girth) {
  const hx = 0.095 / girth;
  return [
    [0, 0.95, 0], [0, 1.45, 0], [0, 1.63, 0],
    [-0.215, 1.43, 0], [-0.215, 1.14, 0], [-0.215, 0.86, 0],
    [0.215, 1.43, 0], [0.215, 1.14, 0], [0.215, 0.86, 0],
    [-hx, 0.9, 0], [-hx, 0.47, 0], [-hx, 0.04, 0],
    [hx, 0.9, 0], [hx, 0.47, 0], [hx, 0.04, 0],
  ];
}

const BONES = [
  [J.pelvis, J.chest], [J.chest, J.head],
  [J.chest, J.shL], [J.shL, J.elL], [J.elL, J.haL],
  [J.chest, J.shR], [J.shR, J.elR], [J.elR, J.haR],
  [J.pelvis, J.hipL], [J.hipL, J.knL], [J.knL, J.ftL],
  [J.pelvis, J.hipR], [J.hipR, J.knR], [J.knR, J.ftR],
];
// Cross-braces so the torso stays a torso.
const BRACES = [
  [J.shL, J.shR], [J.hipL, J.hipR], [J.shL, J.pelvis], [J.shR, J.pelvis],
  [J.hipL, J.chest], [J.hipR, J.chest], [J.shL, J.hipL], [J.shR, J.hipR],
];
// [a, b, minFraction of straight length]: how far a limb can fold.
const LIMITS = [
  [J.hipL, J.ftL, 0.55], [J.hipR, J.ftR, 0.55],
  [J.shL, J.haL, 0.4], [J.shR, J.haR, 0.4],
  [J.pelvis, J.head, 0.85],
];
const RADIUS = [0.13, 0.13, 0.11, 0.07, 0.06, 0.05, 0.07, 0.06, 0.05, 0.08, 0.07, 0.06, 0.08, 0.07, 0.06];
// Order in which body parts come up when getting up (0 = first).
const GETUP_DELAY = [0.25, 0.4, 0.45, 0.35, 0.3, 0.25, 0.35, 0.3, 0.25, 0.15, 0.05, 0, 0.15, 0.05, 0];

// Per joint: [share of the push, upward m/s, random flail m/s].
const KICK = [
  [0.55, 1.6, 0.3], [0.95, 1.3, 0.4], [1.12, 1.1, 0.6], // pelvis, chest, head
  [0.9, 2.2, 1.2], [1.0, 2.8, 2.0], [1.15, 3.2, 2.6], // left shoulder, elbow, hand
  [0.9, 2.2, 1.2], [1.0, 2.8, 2.0], [1.15, 3.2, 2.6], // right
  [0.5, 1.4, 0.3], [0.22, 1.2, 0.8], [-0.18, 0.7, 1.0], // left hip, knee, foot
  [0.5, 1.4, 0.3], [0.22, 1.2, 0.8], [-0.18, 0.7, 1.0], // right
];

const GRAVITY = -16;
const DAMPING = 0.99;
const ITERATIONS = 7;
const H = 1 / 180; // fixed internal timestep, independent of frame rate

export class Ragdoll {
  // base: the person's world matrix at the moment of impact.
  // dir: unit horizontal push direction; push: m/s.
  constructor(base, girth, dir, push, grid) {
    this.grid = grid;
    this.rest = restPose(girth);
    this.p = this.rest.map(([x, y, z]) => new THREE.Vector3(x, y, z).applyMatrix4(base));
    this.prev = this.p.map((v) => v.clone());
    this.t = 0;
    this.near = [];
    // Each joint gets its own kick: head and chest whip back hardest, hips lag,
    // knees barely move and the feet are swept the other way, and the arms flail
    // up and out. The different velocities make the body bend at its joints as
    // it goes over instead of tipping like a plank.
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    this.p.forEach((v, i) => {
      const [k, up, flail] = KICK[i];
      const vel = new THREE.Vector3(dir.x * push * k, up, dir.z * push * k);
      const r = (Math.random() - 0.5) * 2;
      vel.addScaledVector(side, r * flail);
      vel.y += Math.random() * flail * 0.6;
      this.prev[i].addScaledVector(vel, -H);
    });
    const link = (a, b) => [a, b, this.p[a].distanceTo(this.p[b])];
    this.sticks = [...BONES, ...BRACES].map(([a, b]) => link(a, b));
    this.limits = LIMITS.map(([a, b, f]) => {
      // Straight length = sum of the two bones between a and b (or direct distance).
      return [a, b, this.p[a].distanceTo(this.p[b]) * f];
    });
    this.getup = null;
    this.acc = 0;
  }

  get pelvis() {
    return this.p[J.pelvis];
  }

  step(dt) {
    this.t += dt;
    if (this.getup) return;
    this.acc = Math.min(this.acc + dt, 0.1);
    const g = GRAVITY * H * H;
    const v = new THREE.Vector3();
    const d = new THREE.Vector3();
    for (; this.acc >= H; this.acc -= H) {
      for (let i = 0; i < this.p.length; i++) {
        const p = this.p[i];
        v.subVectors(p, this.prev[i]).multiplyScalar(DAMPING);
        this.prev[i].copy(p);
        p.add(v);
        p.y += g;
      }
      for (let it = 0; it < ITERATIONS; it++) {
        for (const [a, b, len] of this.sticks) this._solve(a, b, len, len, d);
        for (const [a, b, min] of this.limits) this._solve(a, b, min, Infinity, d);
        this._collide();
      }
    }
  }

  // Keep |a-b| within [min, max].
  _solve(a, b, min, max, d) {
    const pa = this.p[a];
    const pb = this.p[b];
    d.subVectors(pb, pa);
    const len = d.length();
    if (len < 1e-6) return;
    let target;
    if (len < min) target = min;
    else if (len > max) target = max;
    else return;
    const corr = ((len - target) / len) * 0.5;
    pa.addScaledVector(d, corr);
    pb.addScaledVector(d, -corr);
  }

  _collide() {
    for (let i = 0; i < this.p.length; i++) {
      const p = this.p[i];
      const r = RADIUS[i];
      if (p.y < r) {
        p.y = r;
        // Ground friction: bleed off horizontal velocity.
        const pr = this.prev[i];
        pr.x += (p.x - pr.x) * 0.35;
        pr.z += (p.z - pr.z) * 0.35;
      }
      // Push out of buildings, trunks and other solid props.
      const near = this.grid.query(p.x - r, p.z - r, p.x + r, p.z + r, this.near);
      for (const b of near) {
        if (p.x + r <= b.min.x || p.x - r >= b.max.x || p.y + r <= b.min.y || p.y - r >= b.max.y || p.z + r <= b.min.z || p.z - r >= b.max.z) continue;
        const pushes = [
          [b.min.x - r - p.x, 'x'], [b.max.x + r - p.x, 'x'],
          [b.min.z - r - p.z, 'z'], [b.max.z + r - p.z, 'z'],
          [b.max.y + r - p.y, 'y'],
        ];
        let best = pushes[0];
        for (const q of pushes) if (Math.abs(q[0]) < Math.abs(best[0])) best = q;
        p[best[1]] += best[0];
      }
    }
  }

  // Start blending back to a standing pose given by targetBase.
  beginGetUp(targetBase) {
    this.getup = {
      from: this.p.map((v) => v.clone()),
      to: this.rest.map(([x, y, z]) => new THREE.Vector3(x, y, z).applyMatrix4(targetBase)),
      u: 0,
    };
  }

  // Advance the get-up blend; returns true when finished.
  stepGetUp(dt, duration) {
    const G = this.getup;
    G.u = Math.min(1, G.u + dt / duration);
    for (let i = 0; i < this.p.length; i++) {
      const k = Math.min(1, Math.max(0, (G.u - GETUP_DELAY[i]) / (1 - GETUP_DELAY[i])));
      const e = k * k * (3 - 2 * k);
      this.p[i].lerpVectors(G.from[i], G.to[i], e);
    }
    return G.u >= 1;
  }
}
