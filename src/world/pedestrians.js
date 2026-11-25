import * as THREE from 'three';
import { mulberry32 } from '../core/random.js';
import { textureSet } from './textures.js';
import { faceTexture, hairTexture, denimTexture, knitTexture } from './humanTextures.js';
import { Ragdoll, J } from './ragdoll.js';

// Pedestrians walk a path network: a loop around the sidewalk of every block,
// joined at the corners by the painted crosswalks. They only start crossing
// when their walk signal is on, wait for any car in the way, and pause if the
// player is right in front of them.
//
// Reactions: walk into someone and they stumble aside; run into them and they're
// knocked off balance; hit them at sprint or swinging speed and they go down as a
// physics ragdoll (ragdoll.js), lie there a moment, get up and hurry off. People nearby scatter, and a hard landing
// next to a crowd startles it.
//
// Bodies are jointed: thigh/shin with a knee, upper arm/forearm with an elbow.
// Each body part is one InstancedMesh shared by everyone (limbs have two
// instances per person); animation recomputes part matrices each frame.

const PATH_INSET = 2.1; // distance of the walking line from the kerb; lines up with crosswalk centres
const CYCLE = 28; // must match the traffic light cycle in traffic.js

// Walk signals: crossing a road whose cars travel along `axis` is allowed early in
// that road's red phase, leaving time to get across before cars get green again.
function canStartCrossing(axis, t) {
  const p = ((t % CYCLE) + CYCLE) % CYCLE;
  return axis === 'x' ? p >= 14 && p <= 20 : p <= 6;
}

const SKIN = [0xf1c8a8, 0xe0ac88, 0xc68863, 0xa86b47, 0x8a5434, 0x5f3a24, 0x3f271a];
const HAIR = [0x16110d, 0x2b1d14, 0x4a3122, 0x7a5636, 0xb08a58, 0xd9c08a, 0x8d8d8d, 0x5a2416];
const TOPS = [0xf2f2f2, 0x1d1f24, 0x2f4a7a, 0x8b1f24, 0x3c6b48, 0xc9a24a, 0x6b6f76, 0x5a3f6b, 0xd0763a, 0x9fc3e0, 0xe6d2b5];
const BOTTOMS = [0x2d3e5c, 0x1c1e22, 0x3b4a66, 0x8f7f63, 0x55595f, 0x4a3b2c];
const SHOES = [0x1a1a1a, 0xe8e8e8, 0x5a3a24, 0x2a2a2a];

const UP = new THREE.Vector3(0, 1, 0);

const POSES = {
  walk: { legAmp: 0.5, legSpread: 0, armAmp: 0.4, armBase: 0.05, armSpread: 0, kneeBase: 0.04, elbow: 0.2 },
  flee: { legAmp: 0.85, legSpread: 0, armAmp: 0.9, armBase: -0.25, armSpread: 0.05, kneeBase: 0.1, elbow: 1.2 },
  down: { legAmp: 0, legSpread: 0.22, armAmp: 0, armBase: -0.4, armSpread: 1.1, kneeBase: 0.2, elbow: 0.3 },
};

export class Pedestrians {
  constructor(scene, world, traffic, { count = 220, seed = 99 } = {}) {
    const g = world.roadGrid;
    this.traffic = traffic;
    this.world = world;
    this.rand = mulberry32(seed);
    this.c = (k) => -g.half + k * g.period;
    this.hr = g.road / 2;
    this.blockSize = g.period - g.road;
    this.blocks = g.blocks;
    this.people = [];
    this.crossing = []; // people on a crosswalk or knocked into the road (cars yield to these)
    this._prevAir = false;
    this._lastVy = 0;

    this._buildGraph();
    this._buildMeshes(scene, count);
    this._spawn(count);
  }

  // --- Path network -----------------------------------------------------------
  // Node id = ((i * blocks) + j) * 4 + corner; corners 0..3 = SW, SE, NE, NW.
  _buildGraph() {
    const B = this.blocks;
    const nodes = [];
    const sign = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const cornerOf = (sx, sz) => (sx < 0 ? (sz < 0 ? 0 : 3) : sz < 0 ? 1 : 2);
    for (let i = 0; i < B; i++) {
      for (let j = 0; j < B; j++) {
        const bx = this.c(i) + this.hr;
        const bz = this.c(j) + this.hr;
        for (let q = 0; q < 4; q++) {
          const [sx, sz] = sign[q];
          nodes.push({
            pos: new THREE.Vector3(sx < 0 ? bx + PATH_INSET : bx + this.blockSize - PATH_INSET, 0, sz < 0 ? bz + PATH_INSET : bz + this.blockSize - PATH_INSET),
            edges: [],
          });
        }
      }
    }
    const id = (i, j, q) => (i * B + j) * 4 + q;
    for (let i = 0; i < B; i++) {
      for (let j = 0; j < B; j++) {
        for (let q = 0; q < 4; q++) {
          const n = nodes[id(i, j, q)];
          // Along the block's sidewalk.
          n.edges.push({ to: id(i, j, (q + 1) % 4), cross: null });
          n.edges.push({ to: id(i, j, (q + 3) % 4), cross: null });
          // Across the street at the crosswalks.
          const [sx, sz] = sign[q];
          if (i + sx >= 0 && i + sx < B) n.edges.push({ to: id(i + sx, j, cornerOf(-sx, sz)), cross: 'z' }); // over a z-axis road
          if (j + sz >= 0 && j + sz < B) n.edges.push({ to: id(i, j + sz, cornerOf(sx, -sz)), cross: 'x' }); // over an x-axis road
        }
      }
    }
    this.nodes = nodes;
  }

  // --- Meshes ------------------------------------------------------------------
  _buildMeshes(scene, count) {
    const tiled = (set, rx, ry) => {
      for (const t of Object.values(set)) t.repeat.set(rx, ry);
      return set;
    };
    const materials = {
      face: new THREE.MeshStandardMaterial({ map: faceTexture(), roughness: 0.62 }),
      skin: new THREE.MeshStandardMaterial({ roughness: 0.62 }),
      hair: new THREE.MeshStandardMaterial({ map: hairTexture(), roughness: 0.75 }),
      top: new THREE.MeshStandardMaterial({
        map: knitTexture(),
        ...tiled(textureSet('Fabric081C', { maps: ['normal', 'roughness'] }), 5, 5),
        normalScale: new THREE.Vector2(0.6, 0.6),
      }),
      pants: new THREE.MeshStandardMaterial({ map: denimTexture(), ...tiled(textureSet('Fabric081C', { maps: ['normal'] }), 6, 6), roughness: 0.9 }),
      shoes: new THREE.MeshStandardMaterial({ ...tiled(textureSet('Leather026', { maps: ['normal', 'roughness'] }), 2, 2) }),
    };

    // Body part geometry in person-local space (feet at y=0, facing +Z).
    // Limbs hang from their joint at the origin so they can swing.
    const torso = new THREE.CapsuleGeometry(0.17, 0.42, 4, 12).scale(1.12, 1, 0.62).translate(0, 1.2, 0);
    const hips = new THREE.CapsuleGeometry(0.15, 0.08, 4, 12).scale(1, 1, 0.66).translate(0, 0.95, 0);
    const head = new THREE.SphereGeometry(0.105, 24, 16).scale(0.92, 1.1, 1).translate(0, 1.63, 0.005);
    const hair = new THREE.SphereGeometry(0.113, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.42).scale(0.95, 1.1, 1.03).rotateX(-0.45).translate(0, 1.645, -0.012);
    const neck = new THREE.CylinderGeometry(0.045, 0.052, 0.14, 10).translate(0, 1.5, 0);
    // Limbs hang from their joint: thigh from the hip, shin from the knee, etc.
    const thigh = new THREE.CapsuleGeometry(0.075, 0.33, 4, 8).translate(0, -0.215, 0);
    const shin = new THREE.CapsuleGeometry(0.06, 0.35, 4, 8).translate(0, -0.215, 0);
    const shoe = new THREE.CapsuleGeometry(0.05, 0.16, 4, 8).rotateX(Math.PI / 2).scale(1, 0.75, 1).translate(0, -0.43, 0.045);
    const upperArm = new THREE.CapsuleGeometry(0.05, 0.2, 4, 8).translate(0, -0.145, 0);
    const forearm = new THREE.CapsuleGeometry(0.043, 0.2, 4, 8).translate(0, -0.14, 0);
    const hand = new THREE.SphereGeometry(0.042, 10, 8).scale(0.75, 1.3, 0.55).translate(0, -0.31, 0.005);
    // Knee and elbow caps so bent joints look continuous.
    const knee = new THREE.SphereGeometry(0.066, 10, 8);
    const elbow = new THREE.SphereGeometry(0.046, 8, 6);

    const make = (geo, material, n) => {
      const m = new THREE.InstancedMesh(geo, material, n);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.castShadow = true;
      m.frustumCulled = false;
      scene.add(m);
      return m;
    };
    this.mesh = {
      torso: make(torso, materials.top, count),
      hips: make(hips, materials.pants, count),
      head: make(head, materials.face, count),
      hair: make(hair, materials.hair, count),
      neck: make(neck, materials.skin, count),
      thighs: make(thigh, materials.pants, count * 2),
      shins: make(shin, materials.pants, count * 2),
      knees: make(knee, materials.pants, count * 2),
      shoes: make(shoe, materials.shoes, count * 2),
      upperArms: make(upperArm, materials.top, count * 2),
      forearms: make(forearm, materials.top, count * 2),
      elbows: make(elbow, materials.top, count * 2),
      hands: make(hand, materials.skin, count * 2),
    };
  }

  _spawn(count) {
    const r = this.rand;
    const pick = (list) => new THREE.Color(list[Math.floor(r() * list.length)]);
    const M = this.mesh;
    for (let n = 0; n < count; n++) {
      // Start somewhere along a random sidewalk edge.
      const from = Math.floor(r() * this.nodes.length);
      const sideEdges = this.nodes[from].edges.filter((e) => !e.cross);
      const edge = sideEdges[Math.floor(r() * sideEdges.length)];
      const p = {
        from, to: edge.to, edge,
        t: 0, len: this.nodes[from].pos.distanceTo(this.nodes[edge.to].pos),
        lat: (r() - 0.5) * 1.3, // lateral offset from the walking line so people pass each other
        speed: 1.15 + r() * 0.45,
        scale: 0.9 + r() * 0.18,
        girth: 0.9 + r() * 0.3,
        phase: r() * Math.PI * 2,
        state: 'walk', // walk | wait | cross
        pos: new THREE.Vector3(), yaw: 0, moving: true,
        // Reactions
        react: null, // null | 'stumble' | 'down'
        reactT: 0, peak: 0, flee: 0,
        offset: new THREE.Vector3(), offVel: new THREE.Vector3(),
        tilt: 0, tiltAxis: new THREE.Vector3(1, 0, 0),
        rag: null, // Ragdoll while knocked down
        pose: { ...POSES.walk },
      };
      p.t = r() * p.len;
      this.people.push(p);

      const top = pick(TOPS);
      const bottom = pick(BOTTOMS);
      const skin = pick(SKIN);
      const shortSleeves = r() < 0.4;
      M.torso.setColorAt(n, top);
      M.hips.setColorAt(n, bottom);
      M.head.setColorAt(n, skin);
      M.neck.setColorAt(n, skin);
      M.hair.setColorAt(n, pick(HAIR));
      const shoeColor = pick(SHOES);
      for (const k of [0, 1]) {
        M.thighs.setColorAt(n * 2 + k, bottom);
        M.shins.setColorAt(n * 2 + k, bottom);
        M.knees.setColorAt(n * 2 + k, bottom);
        M.shoes.setColorAt(n * 2 + k, shoeColor);
        // Short sleeves: the sleeve covers the upper arm, the forearm is bare.
        M.upperArms.setColorAt(n * 2 + k, top);
        M.forearms.setColorAt(n * 2 + k, shortSleeves ? skin : top);
        M.elbows.setColorAt(n * 2 + k, shortSleeves ? skin : top);
        M.hands.setColorAt(n * 2 + k, skin);
      }
    }
    for (const m of Object.values(M)) m.instanceColor.needsUpdate = true;
  }

  // --- Behaviour ---------------------------------------------------------------
  _nextEdge(p) {
    const node = this.nodes[p.to];
    let options = node.edges.filter((e) => e.to !== p.from);
    if (!options.length) options = node.edges;
    // While fleeing, don't stop at a kerb to wait for the lights.
    if (p.flee > 0) {
      const sideOnly = options.filter((e) => !e.cross);
      if (sideOnly.length) options = sideOnly;
    }
    const weights = options.map((e) => (e.cross ? 0.7 : 1));
    let pick = this.rand() * weights.reduce((a, b) => a + b, 0);
    let chosen = options[options.length - 1];
    for (let k = 0; k < options.length; k++) {
      if ((pick -= weights[k]) <= 0) { chosen = options[k]; break; }
    }
    p.from = p.to;
    p.to = chosen.to;
    p.edge = chosen;
    p.t = 0;
    p.len = node.pos.distanceTo(this.nodes[p.to].pos);
    p.state = chosen.cross ? 'wait' : 'walk';
  }

  // Is a car (or the player) right in front of this person?
  _blocked(p, dir, player) {
    const hx = p.pos.x + dir.x * 1.2;
    const hz = p.pos.z + dir.z * 1.2;
    if (player && p.flee <= 0 && Math.abs(player.pos.x - hx) < 0.8 && Math.abs(player.pos.z - hz) < 0.8 && player.pos.y < 2.5) return true;
    if (p.state !== 'cross') return false;
    // Check a short stretch of the path ahead against every car's footprint.
    for (const b of this.world.dynamic) {
      for (const d of [0.4, 1.2, 2.2]) {
        const ax = p.pos.x + dir.x * d;
        const az = p.pos.z + dir.z * d;
        if (ax > b.min.x - 0.45 && ax < b.max.x + 0.45 && az > b.min.z - 0.45 && az < b.max.z + 0.45) return true;
      }
    }
    return false;
  }

  // The player ran into p. (dx, dz) points from the player to p.
  _hit(p, player, dx, dz) {
    const speed = Math.hypot(player.vel.x, player.vel.z);
    let len = Math.hypot(dx, dz);
    if (len < 1e-3) {
      dx = player.vel.x;
      dz = player.vel.z;
      len = Math.hypot(dx, dz) || 1;
    }
    dx /= len;
    dz /= len;
    p.tiltAxis.set(dz, 0, -dx); // tipping about this axis moves the head away from the player
    p.yaw = Math.atan2(-dx, -dz); // turn to face the player
    p.reactT = 0;
    if (speed > 11) {
      p.react = 'down';
      p.tilt = 0;
      p.offVel.set(0, 0, 0);
      const push = Math.min(speed * 0.55, 9);
      p.rag = new Ragdoll(this._baseMatrix(p, new THREE.Matrix4()), p.girth, new THREE.Vector3(dx, 0, dz), push, this.world.grid);
      player.vel.x *= 0.55;
      player.vel.z *= 0.55;
      this._startle(p.pos, 11, p);
    } else if (speed > 3.5) {
      p.react = 'stumble';
      p.peak = 0.5;
      p.offVel.set(dx * speed * 0.45, 0, dz * speed * 0.45);
      player.vel.x *= 0.75;
      player.vel.z *= 0.75;
      this._startle(p.pos, 5, p);
    } else {
      p.react = 'stumble';
      p.peak = 0.16;
      p.offVel.set(dx * 1.3, 0, dz * 1.3);
    }
  }

  // Make everyone within `radius` of `center` hurry away from it.
  _startle(center, radius, except = null) {
    for (const q of this.people) {
      if (q === except || q.react === 'down') continue;
      if (q.pos.distanceTo(center) > radius) continue;
      q.flee = 2.5 + this.rand() * 1.5;
      const awayDot = (n) => {
        const np = this.nodes[n].pos;
        return (np.x - q.pos.x) * (q.pos.x - center.x) + (np.z - q.pos.z) * (q.pos.z - center.z);
      };
      if (q.state === 'wait') {
        // Standing at a kerb: run along the sidewalk instead of into the road.
        const sideOnly = this.nodes[q.from].edges.filter((e) => !e.cross);
        const best = sideOnly.reduce((a, b) => (awayDot(b.to) > awayDot(a.to) ? b : a));
        q.to = best.to;
        q.edge = best;
        q.t = 0;
        q.len = this.nodes[q.from].pos.distanceTo(this.nodes[q.to].pos);
        q.state = 'walk';
      } else if (q.state === 'walk' && awayDot(q.to) < 0) {
        // Heading toward the commotion: turn around.
        const f = q.from;
        q.from = q.to;
        q.to = f;
        q.t = q.len - q.t;
        q.edge = this.nodes[q.from].edges.find((e) => e.to === q.to) ?? q.edge;
      }
    }
  }

  _updateReaction(p, dt) {
    p.reactT += dt;
    const t = p.reactT;
    if (p.react === 'down') {
      const rag = p.rag;
      rag.step(dt);
      if (!rag.getup && t > 2.9) {
        // Stand up where the hips ended up, facing the way the body points.
        const pel = rag.pelvis;
        const fwd = new THREE.Vector3().subVectors(rag.p[J.chest], pel);
        if (Math.hypot(fwd.x, fwd.z) > 0.1) p.yaw = Math.atan2(fwd.x, fwd.z);
        p.pos.set(pel.x, 0, pel.z);
        rag.beginGetUp(this._baseMatrix(p, new THREE.Matrix4()));
      }
      if (rag.getup && rag.stepGetUp(dt, 1.4)) {
        p.react = null;
        p.rag = null;
        p.flee = 3;
      }
    } else if (p.react === 'stumble') {
      p.tilt = p.peak * Math.sin(Math.PI * Math.min(1, t / 0.8));
      if (t > 0.9) {
        p.react = null;
        p.tilt = 0;
        if (p.peak > 0.3) p.flee = 1.5;
      }
    }
  }

  update(dt, player) {
    const time = this.traffic.time;
    this.crossing.length = 0;
    const dir = new THREE.Vector3();
    const side = new THREE.Vector3();

    // A hard landing near people startles them.
    if (this._prevAir && player.onGround && this._lastVy < -14) this._startle(player.pos, 9);
    this._prevAir = !player.onGround;
    if (!player.onGround) this._lastVy = player.vel.y;

    const feet = player.pos.y - 0.9;
    for (const p of this.people) {
      const a = this.nodes[p.from].pos;
      const b = this.nodes[p.to].pos;
      dir.subVectors(b, a).normalize();

      // Bumped by the player?
      if (p.react !== 'down' && !(p.react === 'stumble' && p.reactT < 0.5)) {
        const dx = p.pos.x - player.pos.x;
        const dz = p.pos.z - player.pos.z;
        if (dx * dx + dz * dz < 0.62 * 0.62 && feet < 1.6 * p.scale && player.pos.y + 0.9 > 0.2) this._hit(p, player, dx, dz);
      }

      // Knock-back slides them off the path; afterwards they walk back to it.
      if (p.react) {
        this._updateReaction(p, dt);
        p.offset.addScaledVector(p.offVel, dt);
        p.offVel.multiplyScalar(Math.exp(-4 * dt));
      } else if (p.offset.lengthSq() > 1e-4) {
        const back = Math.min(p.offset.length(), 1.2 * dt);
        p.offset.addScaledVector(p.offset.clone().normalize(), -back);
      }
      if (p.flee > 0) p.flee -= dt;

      if (!p.react && p.state === 'wait' && canStartCrossing(p.edge.cross, time)) {
        p.state = 'cross';
        if (this._blocked(p, dir, null)) p.state = 'wait';
      }

      const blocked = !p.react && p.state !== 'wait' && this._blocked(p, dir, player);
      p.blockedFor = blocked ? (p.blockedFor ?? 0) + dt : 0;
      // Last resort so nobody stands frozen forever: squeeze past after a few seconds.
      p.moving = !p.react && p.state !== 'wait' && (!blocked || p.blockedFor > 6);
      const run = p.flee > 0 ? 2.7 : 1;
      if (p.moving) {
        p.t += p.speed * run * (p.state === 'cross' ? 1.25 : 1) * dt;
        p.phase += p.speed * run * dt * (p.flee > 0 ? 3.2 : 5.2);
        if (p.t >= p.len) this._nextEdge(p);
      }

      // Pose for this frame.
      if (p.react === 'down') Object.assign(p.pose, POSES.down);
      else if (p.react === 'stumble') {
        const k = p.peak / 0.5;
        Object.assign(p.pose, { legAmp: 0, legSpread: 0.12, armAmp: 0, armBase: -1.1 * k, armSpread: 0.5 * k, kneeBase: 0.25 * k, elbow: 0.9 * k });
      } else Object.assign(p.pose, p.flee > 0 ? POSES.flee : POSES.walk);

      if (p.state === 'cross' || p.react === 'down' || p.offset.lengthSq() > 1) this.crossing.push(p);

      // On crosswalks stay inside the painted stripes.
      const lat = p.state === 'walk' ? p.lat : p.lat * 0.8;
      // Recompute from the current edge (_nextEdge may have just moved to a new one).
      const na = this.nodes[p.from].pos;
      const nb = this.nodes[p.to].pos;
      dir.subVectors(nb, na).normalize();
      side.set(-dir.z, 0, dir.x);
      const pathX = na.x + dir.x * Math.min(p.t, p.len) + side.x * lat;
      const pathZ = na.z + dir.z * Math.min(p.t, p.len) + side.z * lat;
      if (p.rag) {
        if (!p.rag.getup) p.pos.set(p.rag.pelvis.x, 0, p.rag.pelvis.z);
        p.offset.set(p.pos.x - pathX, 0, p.pos.z - pathZ); // walk back to the path afterwards
      } else {
        p.pos.set(pathX, 0, pathZ).add(p.offset);
      }
      if (!p.react) {
        const targetYaw = Math.atan2(dir.x, dir.z);
        let d = targetYaw - p.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        p.yaw += d * Math.min(1, dt * 8);
      }
    }
    this._render();
  }

  // The person's world matrix (position, facing, size) when standing/animated.
  _baseMatrix(p, out) {
    const q = new THREE.Quaternion().setFromAxisAngle(UP, p.yaw);
    if (p.tilt > 0) q.premultiply(new THREE.Quaternion().setFromAxisAngle(p.tiltAxis, p.tilt));
    return out.compose(new THREE.Vector3(p.pos.x, 0, p.pos.z), q, new THREE.Vector3(p.scale * p.girth, p.scale, p.scale * p.girth));
  }

  _render() {
    const M = this.mesh;
    const base = new THREE.Matrix4();
    const m1 = new THREE.Matrix4();
    const m2 = new THREE.Matrix4();
    const local = new THREE.Matrix4();
    const e = new THREE.Euler();

    this.people.forEach((p, n) => {
      if (p.rag) {
        this._renderRagdoll(p, n);
        return;
      }
      const pose = p.pose;
      const sw = p.moving ? Math.sin(p.phase) : 0;
      const cw = p.moving ? Math.cos(p.phase) : 0;
      this._baseMatrix(p, base);
      base.elements[13] += p.moving ? Math.abs(cw) * (p.flee > 0 ? 0.06 : 0.035) : 0; // bob

      for (const name of ['torso', 'hips', 'head', 'hair', 'neck']) M[name].setMatrixAt(n, base);

      const stride = pose.legAmp / 0.5; // 0 standing .. 1 walking .. 1.7 running
      for (const k of [0, 1]) {
        const sx = k === 0 ? -1 : 1;
        const i2 = n * 2 + k;
        // Leg: thigh swings from the hip; the knee bends as the leg comes forward.
        m1.multiplyMatrices(base, local.makeRotationFromEuler(e.set(sw * pose.legAmp * sx, 0, sx * pose.legSpread)).setPosition(sx * 0.095 / p.girth, 0.9, 0));
        M.thighs.setMatrixAt(i2, m1);
        const kneeBend = stride * (0.12 + 0.85 * Math.max(0, sx * cw)) + pose.kneeBase;
        m2.multiplyMatrices(m1, local.makeRotationX(kneeBend).setPosition(0, -0.43, 0));
        M.knees.setMatrixAt(i2, m2);
        M.shins.setMatrixAt(i2, m2);
        M.shoes.setMatrixAt(i2, m2);
        // Arm: swings opposite the leg; elbows bend more when running.
        m1.multiplyMatrices(base, local.makeRotationFromEuler(e.set(-sw * pose.armAmp * sx + pose.armBase, 0, sx * (0.08 + pose.armSpread))).setPosition(sx * 0.215, 1.43, 0));
        M.upperArms.setMatrixAt(i2, m1);
        m2.multiplyMatrices(m1, local.makeRotationX(-pose.elbow - Math.max(0, -sx * sw) * 0.25 * stride).setPosition(0, -0.29, 0));
        M.elbows.setMatrixAt(i2, m2);
        M.forearms.setMatrixAt(i2, m2);
        M.hands.setMatrixAt(i2, m2);
      }
    });
    for (const m of Object.values(M)) m.instanceMatrix.needsUpdate = true;
  }

  // Build every part's matrix from the ragdoll's joint positions.
  _renderRagdoll(p, n) {
    const M = this.mesh;
    const P = p.rag.p;
    const s = p.scale;
    const sg = p.scale * p.girth;
    const right = new THREE.Vector3().subVectors(P[J.shR], P[J.shL]);
    if (right.lengthSq() < 1e-6) right.subVectors(P[J.hipR], P[J.hipL]);
    const frame = (origin, up, localY, out) => {
      const u = up.clone().normalize();
      const r = right.clone().addScaledVector(u, -right.dot(u)).normalize();
      const f = new THREE.Vector3().crossVectors(r, u);
      out.makeBasis(r.multiplyScalar(sg), u.clone().multiplyScalar(s), f.multiplyScalar(sg));
      const pos = origin.clone().addScaledVector(u, -localY * s);
      return out.setPosition(pos);
    };
    // Segment from joint a to joint b; geometry hangs down local -Y for restLen.
    const segment = (a, b, restLen, out) => {
      const d = new THREE.Vector3().subVectors(P[b], P[a]);
      const len = d.length() || 1e-3;
      const y = d.clone().divideScalar(-len);
      const x = right.clone().addScaledVector(y, -right.dot(y)).normalize();
      const z = new THREE.Vector3().crossVectors(x, y);
      out.makeBasis(x.multiplyScalar(sg), y.multiplyScalar(len / restLen), z.multiplyScalar(sg));
      return out.setPosition(P[a]);
    };
    const m = new THREE.Matrix4();
    frame(P[J.pelvis], new THREE.Vector3().subVectors(P[J.chest], P[J.pelvis]), 0.95, m);
    for (const name of ['torso', 'hips', 'neck']) M[name].setMatrixAt(n, m);
    frame(P[J.chest], new THREE.Vector3().subVectors(P[J.head], P[J.chest]), 1.45, m);
    M.head.setMatrixAt(n, m);
    M.hair.setMatrixAt(n, m);
    const sides = [
      [J.hipL, J.knL, J.ftL, J.shL, J.elL, J.haL],
      [J.hipR, J.knR, J.ftR, J.shR, J.elR, J.haR],
    ];
    sides.forEach(([hip, kn, ft, sh, el, ha], k) => {
      const i2 = n * 2 + k;
      M.thighs.setMatrixAt(i2, segment(hip, kn, 0.43, m));
      segment(kn, ft, 0.43, m);
      M.shins.setMatrixAt(i2, m);
      M.knees.setMatrixAt(i2, m);
      M.shoes.setMatrixAt(i2, m);
      M.upperArms.setMatrixAt(i2, segment(sh, el, 0.29, m));
      segment(el, ha, 0.28, m);
      M.forearms.setMatrixAt(i2, m);
      M.elbows.setMatrixAt(i2, m);
      M.hands.setMatrixAt(i2, m);
    });
  }
}

