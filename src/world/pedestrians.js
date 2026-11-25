import * as THREE from 'three';
import { mulberry32 } from '../core/random.js';

// Pedestrians walk a path network: a loop around the sidewalk of every block,
// joined at the corners by the painted crosswalks. They only start crossing
// when their walk signal is on, wait for any car in the way, and pause if the
// player is right in front of them.
//
// Rendering: each body part is one InstancedMesh shared by everyone (legs,
// arms and shoes have two instances per person), and the walk cycle is done by
// recomputing part matrices each frame. ~7 draw calls for the whole crowd.

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
    this.crossing = []; // people currently on a crosswalk (cars check these)

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
    const mat = (rough = 0.85) => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: rough });
    // Body part geometry in person-local space (feet at y=0, facing +Z).
    // Limbs hang from their joint at the origin so they can swing.
    const torso = new THREE.CapsuleGeometry(0.17, 0.42, 4, 10).scale(1.12, 1, 0.62).translate(0, 1.2, 0);
    const hips = new THREE.CapsuleGeometry(0.15, 0.08, 4, 10).scale(1, 1, 0.66).translate(0, 0.95, 0);
    const head = new THREE.SphereGeometry(0.105, 14, 10).scale(0.92, 1.1, 1).translate(0, 1.63, 0.005);
    const hair = new THREE.SphereGeometry(0.113, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.42).scale(0.95, 1.1, 1.03).rotateX(-0.45).translate(0, 1.645, -0.012);
    const leg = new THREE.CapsuleGeometry(0.068, 0.72, 4, 8).translate(0, -0.43, 0);
    const shoe = new THREE.BoxGeometry(0.1, 0.08, 0.25).translate(0, -0.86, 0.04);
    const arm = new THREE.CapsuleGeometry(0.048, 0.5, 4, 8).translate(0, -0.29, 0);

    const make = (geo, material, n) => {
      const m = new THREE.InstancedMesh(geo, material, n);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.castShadow = true;
      m.frustumCulled = false;
      scene.add(m);
      return m;
    };
    const clothes = mat(0.9);
    this.mesh = {
      torso: make(torso, clothes, count),
      hips: make(hips, clothes, count),
      head: make(head, mat(0.6), count),
      hair: make(hair, mat(0.8), count),
      legs: make(leg, clothes, count * 2),
      shoes: make(shoe, mat(0.6), count * 2),
      arms: make(arm, clothes, count * 2),
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
      M.hair.setColorAt(n, pick(HAIR));
      const shoeColor = pick(SHOES);
      for (const k of [0, 1]) {
        M.legs.setColorAt(n * 2 + k, bottom);
        M.shoes.setColorAt(n * 2 + k, shoeColor);
        M.arms.setColorAt(n * 2 + k, shortSleeves ? skin : top);
      }
    }
    for (const m of Object.values(M)) m.instanceColor.needsUpdate = true;
  }

  // --- Behaviour ---------------------------------------------------------------
  _nextEdge(p) {
    const node = this.nodes[p.to];
    let options = node.edges.filter((e) => e.to !== p.from);
    if (!options.length) options = node.edges;
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
    if (player && Math.abs(player.pos.x - hx) < 0.8 && Math.abs(player.pos.z - hz) < 0.8 && player.pos.y < 2.5) return true;
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

  update(dt, player) {
    const time = this.traffic.time;
    this.crossing.length = 0;
    const dir = new THREE.Vector3();
    const side = new THREE.Vector3();
    for (const p of this.people) {
      const a = this.nodes[p.from].pos;
      const b = this.nodes[p.to].pos;
      dir.subVectors(b, a).normalize();

      if (p.state === 'wait' && canStartCrossing(p.edge.cross, time)) {
        p.state = 'cross';
        if (this._blocked(p, dir, null)) p.state = 'wait';
      }

      const blocked = p.state !== 'wait' && this._blocked(p, dir, player);
      p.blockedFor = blocked ? (p.blockedFor ?? 0) + dt : 0;
      // Last resort so nobody stands frozen forever: squeeze past after a few seconds.
      p.moving = p.state !== 'wait' && (!blocked || p.blockedFor > 6);
      if (p.moving) {
        p.t += p.speed * (p.state === 'cross' ? 1.25 : 1) * dt;
        p.phase += p.speed * dt * 5.2;
        if (p.t >= p.len) {
          this._nextEdge(p);
          continue; // position updated next frame
        }
      }
      if (p.state === 'cross') this.crossing.push(p);

      // On crosswalks stay inside the painted stripes.
      const lat = p.state === 'walk' ? p.lat : p.lat * 0.8;
      side.set(-dir.z, 0, dir.x);
      p.pos.copy(a).addScaledVector(dir, p.t).addScaledVector(side, lat);
      const targetYaw = Math.atan2(dir.x, dir.z);
      let d = targetYaw - p.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      p.yaw += d * Math.min(1, dt * 8);
    }
    this._render();
  }

  _render() {
    const M = this.mesh;
    const base = new THREE.Matrix4();
    const local = new THREE.Matrix4();
    const out = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const pos = new THREE.Vector3();
    const e = new THREE.Euler();

    this.people.forEach((p, n) => {
      const walk = p.moving ? 1 : 0;
      const sw = Math.sin(p.phase) * walk;
      const bob = p.moving ? Math.abs(Math.cos(p.phase)) * 0.035 : 0;
      q.setFromAxisAngle(up, p.yaw);
      s.set(p.scale * p.girth, p.scale, p.scale * p.girth);
      pos.set(p.pos.x, bob, p.pos.z);
      base.compose(pos, q, s);

      for (const name of ['torso', 'hips', 'head', 'hair']) M[name].setMatrixAt(n, base);

      for (const k of [0, 1]) {
        const sx = k === 0 ? -1 : 1;
        // Legs swing from the hip, arms swing the opposite way from the shoulder.
        local.makeRotationFromEuler(e.set(sw * 0.5 * sx, 0, 0)).setPosition(sx * 0.095 / p.girth, 0.9, 0);
        out.multiplyMatrices(base, local);
        M.legs.setMatrixAt(n * 2 + k, out);
        M.shoes.setMatrixAt(n * 2 + k, out);
        local.makeRotationFromEuler(e.set(-sw * 0.4 * sx + 0.05, 0, sx * 0.08)).setPosition(sx * 0.215, 1.43, 0);
        out.multiplyMatrices(base, local);
        M.arms.setMatrixAt(n * 2 + k, out);
      }
    });
    for (const m of Object.values(M)) m.instanceMatrix.needsUpdate = true;
  }
}
