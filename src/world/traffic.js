import * as THREE from 'three';
import { mulberry32 } from '../core/random.js';
import { CAR_TYPES, PARTS, buildTypeGeometry, createCarMaterials } from './carModels.js';

// Traffic: cars drive the playable street grid in lanes (right-hand traffic, two
// lanes each way), obey traffic lights, keep their distance, turn at
// intersections along quarter-circle paths, and stop for the player.
//
// A car is either driving 'straight' along a road (axis 'x' or 'z', on road line
// `line`, direction `dir`) toward intersection `nextK`, or following an 'arc'
// through an intersection while turning.

const LANES = [1.75, 5.25]; // lateral offset of each lane's centre from the road centre line
const CYCLE = 28; // traffic light cycle, seconds
const ACCEL = 3.5;
const BRAKE = 7;
const TURN_SPEED = { right: 5, left: 6.5 };

// x-axis: green 0–10, amber 10–12, all red 12–14; z-axis: green 14–24, amber 24–26, all red 26–28.
// The all-red gaps let cars still in an intersection clear it.
export function lightFor(axis, t) {
  const p = ((t % CYCLE) + CYCLE) % CYCLE;
  if (axis === 'x') return p < 10 ? 'green' : p < 12 ? 'amber' : 'red';
  return p >= 14 && p < 24 ? 'green' : p >= 24 && p < 26 ? 'amber' : 'red';
}

const hvec = (axis, dir) => (axis === 'x' ? new THREE.Vector3(dir, 0, 0) : new THREE.Vector3(0, 0, dir));
const rightOf = (h) => new THREE.Vector3(-h.z, 0, h.x);

export class Traffic {
  constructor(scene, world, { count = 80, seed = 7 } = {}) {
    const g = world.roadGrid;
    this.world = world;
    this.half = g.half;
    this.period = g.period;
    this.hr = g.road / 2;
    this.blocks = g.blocks;
    this.rand = mulberry32(seed);
    this.time = 0;
    this.cars = [];
    this.boxes = world.dynamic;

    this._buildMeshes(scene, count);
    this._spawn(count);
    this._buildLights(scene);
  }

  c(k) {
    return -this.half + k * this.period;
  }

  // --- Setup ----------------------------------------------------------------
  _buildMeshes(scene, count) {
    const mats = createCarMaterials();
    const types = Object.keys(CAR_TYPES);
    const total = types.reduce((s, t) => s + CAR_TYPES[t].weight, 0);
    this.typeCounts = {};
    let assigned = 0;
    types.forEach((t, i) => {
      const n = i === types.length - 1 ? count - assigned : Math.round((CAR_TYPES[t].weight / total) * count);
      this.typeCounts[t] = n;
      assigned += n;
    });

    this.meshes = {}; // type -> part -> InstancedMesh
    for (const t of types) {
      const n = this.typeCounts[t];
      if (!n) continue;
      const geos = buildTypeGeometry(t);
      this.meshes[t] = {};
      for (const p of PARTS) {
        if (!geos[p]) continue;
        const mesh = new THREE.InstancedMesh(geos[p], mats[p], n);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.castShadow = p !== 'head' && p !== 'tail';
        mesh.receiveShadow = p === 'paint';
        mesh.frustumCulled = false; // instances move all over the city
        scene.add(mesh);
        this.meshes[t][p] = mesh;
      }
    }
  }

  _spawn(count) {
    const r = this.rand;
    const tail = new THREE.Color();
    let tries = 0;
    for (const [type, n] of Object.entries(this.typeCounts)) {
      const spec = CAR_TYPES[type];
      for (let idx = 0; idx < n && tries < 5000; tries++) {
        const axis = r() < 0.5 ? 'x' : 'z';
        const line = Math.floor(r() * (this.blocks + 1));
        const dir = r() < 0.5 ? 1 : -1;
        const o = type === 'bus' ? LANES[1] : LANES[r() < 0.5 ? 0 : 1];
        const k = Math.floor(r() * this.blocks);
        const s0 = this.c(k) + this.hr + 8;
        const s1 = this.c(k + 1) - this.hr - 8;
        const s = s0 + r() * (s1 - s0);
        const clash = this.cars.some(
          (q) => q.mode === 'straight' && q.axis === axis && q.line === line && q.dir === dir && q.o === o &&
            Math.abs(q.s - s) < (q.len + spec.len) / 2 + 4
        );
        if (clash) continue;

        const carObj = {
          type, idx, len: spec.len, wid: spec.wid, hgt: spec.hgt,
          axis, line, dir, o, s, nextK: dir > 0 ? k + 1 : k,
          mode: 'straight', maneuver: 'straight', arc: null,
          speed: 0, cruise: type === 'bus' ? 9 : 10 + r() * 5,
          pos: new THREE.Vector3(), prev: new THREE.Vector3(), delta: new THREE.Vector3(),
          heading: hvec(axis, dir), braking: false, lastBraking: null,
        };
        carObj.box = { min: new THREE.Vector3(), max: new THREE.Vector3(), car: carObj };
        this._straightPos(carObj);
        carObj.prev.copy(carObj.pos);
        carObj.speed = carObj.cruise * 0.7;
        this._chooseManeuver(carObj);
        this._updateBox(carObj);
        this.cars.push(carObj);
        this.boxes.push(carObj.box);

        const color = spec.colors[Math.floor(r() * spec.colors.length)];
        this.meshes[type].paint.setColorAt(idx, new THREE.Color(color));
        this.meshes[type].tail.setColorAt(idx, tail.setRGB(0.45, 0.02, 0.02));
        idx++;
      }
      // If the road was too crowded to place them all, draw only the cars we placed.
      const placed = this.cars.filter((q) => q.type === type).length;
      for (const mesh of Object.values(this.meshes[type] ?? {})) mesh.count = placed;
    }
    for (const parts of Object.values(this.meshes)) {
      for (const m of Object.values(parts)) if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  _buildLights(scene) {
    // One pole per intersection corner. Poles on the (+,+) and (-,-) corners
    // show the x-axis signal, the others the z-axis signal.
    const poles = [];
    for (let i = 0; i <= this.blocks; i++) {
      for (let j = 0; j <= this.blocks; j++) {
        for (const [sx, sz] of [[1, 1], [-1, -1], [1, -1], [-1, 1]]) {
          poles.push({
            x: this.c(i) + sx * (this.hr + 0.9),
            z: this.c(j) + sz * (this.hr + 0.9),
            axis: sx === sz ? 'x' : 'z',
          });
        }
      }
    }
    const metal = new THREE.MeshStandardMaterial({ color: 0x2a2d31, metalness: 0.6, roughness: 0.5 });
    const poleMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.08, 0.1, 4.4, 8).translate(0, 2.2, 0), metal, poles.length);
    const headMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.24, 1.05, 0.24).translate(0, 4.9, 0), metal, poles.length);
    const lampMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.17, 12, 10), new THREE.MeshBasicMaterial({ color: 0xffffff }), poles.length * 3);
    const m = new THREE.Matrix4();
    poles.forEach((p, i) => {
      m.makeTranslation(p.x, 0, p.z);
      poleMesh.setMatrixAt(i, m);
      headMesh.setMatrixAt(i, m);
      [5.22, 4.9, 4.58].forEach((y, n) => {
        m.makeTranslation(p.x, y, p.z);
        lampMesh.setMatrixAt(i * 3 + n, m);
      });
    });
    poleMesh.castShadow = headMesh.castShadow = true;
    scene.add(poleMesh, headMesh, lampMesh);
    this.poles = poles;
    this.lampMesh = lampMesh;
    this._lightKey = '';
    this._updateLamps();
  }

  _updateLamps() {
    const sx = lightFor('x', this.time);
    const sz = lightFor('z', this.time);
    const key = sx + sz;
    if (key === this._lightKey) return;
    this._lightKey = key;
    const on = { red: new THREE.Color(2.2, 0.15, 0.1), amber: new THREE.Color(2.2, 1.1, 0.1), green: new THREE.Color(0.2, 2.0, 0.6) };
    const off = new THREE.Color(0.08, 0.08, 0.08);
    this.poles.forEach((p, i) => {
      const state = p.axis === 'x' ? sx : sz;
      ['red', 'amber', 'green'].forEach((name, n) => this.lampMesh.setColorAt(i * 3 + n, state === name ? on[name] : off));
    });
    this.lampMesh.instanceColor.needsUpdate = true;
  }

  // --- Driving logic --------------------------------------------------------
  _straightPos(car) {
    const lat = this.c(car.line);
    if (car.axis === 'x') car.pos.set(car.s, 0, lat + car.dir * car.o);
    else car.pos.set(lat - car.dir * car.o, 0, car.s);
    car.heading.copy(hvec(car.axis, car.dir));
  }

  _inRange(k) {
    return k >= 0 && k <= this.blocks;
  }

  // Decide what to do at the next intersection: straight on, left or right.
  _chooseManeuver(car) {
    const opts = [];
    if (this._inRange(car.nextK + car.dir)) opts.push(['straight', 0.6]);
    const h = hvec(car.axis, car.dir);
    // Lane discipline: right turns only from the outer lane, left turns only from the inner lane.
    const outer = car.o === LANES[1];
    for (const [name, vec] of [['right', rightOf(h)], ['left', rightOf(h).negate()]]) {
      if ((name === 'right') !== outer) continue;
      const newDir = vec.x + vec.z; // ±1 along the new axis
      if (this._inRange(car.line + newDir)) opts.push([name, car.type === 'bus' ? 0.1 : 0.3]);
    }
    // At the edge of the city the only way on may be a turn from the "wrong" lane.
    if (!opts.length) {
      for (const [name, vec] of [['right', rightOf(h)], ['left', rightOf(h).negate()]]) {
        if (this._inRange(car.line + vec.x + vec.z)) opts.push([name, 1]);
      }
    }
    const total = opts.reduce((s, o) => s + o[1], 0);
    let pick = this.rand() * total;
    for (const [name, w] of opts) {
      if ((pick -= w) <= 0) { car.maneuver = name; return; }
    }
    car.maneuver = opts[opts.length - 1][0];
  }

  _startTurn(car) {
    const H = hvec(car.axis, car.dir);
    const R = rightOf(H);
    const hr = this.hr;
    const o = car.o;
    const center = car.axis === 'x'
      ? new THREE.Vector3(this.c(car.nextK), 0, this.c(car.line))
      : new THREE.Vector3(this.c(car.line), 0, this.c(car.nextK));
    const entry = center.clone().addScaledVector(H, -hr).addScaledVector(R, o);
    let C;
    let exit;
    let newH;
    if (car.maneuver === 'right') {
      C = center.clone().addScaledVector(R, hr).addScaledVector(H, -hr);
      exit = center.clone().addScaledVector(R, hr).addScaledVector(H, -o);
      newH = R;
    } else {
      C = center.clone().addScaledVector(H, -hr).addScaledVector(R, -hr);
      exit = center.clone().addScaledVector(R, -hr).addScaledVector(H, o);
      newH = R.clone().negate();
    }
    const a = entry.sub(C);
    const b = exit.clone().sub(C);
    const newAxis = newH.x !== 0 ? 'x' : 'z';
    const newDir = newH.x + newH.z;
    car.mode = 'arc';
    car.arc = {
      C, a, b, r: a.length(), theta: 0,
      fromAxis: car.axis, fromDir: car.dir, fromLine: car.line,
      after: { axis: newAxis, dir: newDir, line: car.nextK, s: newAxis === 'x' ? exit.x : exit.z, nextK: car.line + newDir },
    };
  }

  _finishTurn(car, overshoot) {
    const t = car.arc.after;
    car.axis = t.axis;
    car.dir = t.dir;
    car.line = t.line;
    car.s = t.s + overshoot * t.dir;
    car.nextK = t.nextK;
    car.mode = 'straight';
    car.arc = null;
    this._straightPos(car);
    this._chooseManeuver(car);
  }

  _targetSpeed(car, player) {
    let target = car.cruise;
    const H = car.heading;
    const R = rightOf(H);

    if (car.mode === 'arc') {
      target = Math.min(target, TURN_SPEED[car.maneuver]);
    } else {
      const toEntry = (this.c(car.nextK) - car.s) * car.dir - this.hr - car.len / 2;
      if (car.maneuver !== 'straight') {
        target = Math.min(target, Math.sqrt(2 * 2.5 * Math.max(0, toEntry)) + TURN_SPEED[car.maneuver]);
      }
      // Turning left: wait at the edge of the intersection for oncoming traffic.
      if (car.maneuver === 'left' && toEntry < 8 && this._oncoming(car)) {
        target = Math.min(target, Math.sqrt(2 * 4 * Math.max(0, toEntry - 0.5)));
      }
      const stopDist = toEntry - 4.6; // stop line sits just before the crosswalk
      const light = lightFor(car.axis, this.time);
      if (light !== 'green' && stopDist > -0.3 && (light === 'red' || stopDist > 6)) {
        target = Math.min(target, Math.sqrt(2 * 4 * Math.max(0, stopDist - 0.3)));
      }
    }

    // Keep a gap to the car in front (only cars heading roughly the same way,
    // so cross traffic in an intersection can't deadlock).
    for (const q of this.cars) {
      if (q === car) continue;
      // A car mid-turn swings sideways and rotates, so look wider for it.
      const turning = q.mode === 'arc';
      if (q.heading.dot(H) < (turning ? -0.2 : 0.5)) continue;
      const rx = q.pos.x - car.pos.x;
      const rz = q.pos.z - car.pos.z;
      const along = rx * H.x + rz * H.z;
      if (along <= 0 || along > 35) continue;
      if (Math.abs(rx * R.x + rz * R.z) > (turning ? 2.6 : 1.6)) continue;
      const gap = along - (car.len + q.len) / 2;
      target = Math.min(target, Math.max(0, gap - 2.5) * 1.4);
    }

    // Yield to pedestrians on a crosswalk in front.
    for (const p of this.pedestrians?.crossing ?? []) {
      const rx = p.pos.x - car.pos.x;
      const rz = p.pos.z - car.pos.z;
      const along = rx * H.x + rz * H.z;
      // Only people clearly in front of the bumper; anyone level with the car waits for it instead.
      if (along - car.len / 2 > 0.8 && along < 22 && Math.abs(rx * R.x + rz * R.z) < car.wid / 2 + 1.2) {
        target = Math.min(target, Math.sqrt(2 * 5 * Math.max(0, along - car.len / 2 - 2.5)));
      }
    }

    // Turning: check the crosswalk on the street we're turning into.
    if (car.maneuver !== 'straight' && this.pedestrians && this._exitCrosswalkBusy(car)) {
      if (car.mode === 'straight') {
        const toEntry = (this.c(car.nextK) - car.s) * car.dir - this.hr - car.len / 2;
        target = Math.min(target, Math.sqrt(2 * 5 * Math.max(0, toEntry + 1)));
      } else if (car.arc.theta < 0.45) {
        target = 0; // just started the turn: wait
      }
    }

    // Stop for the player standing or walking in front.
    if (player) {
      const rx = player.pos.x - car.pos.x;
      const rz = player.pos.z - car.pos.z;
      const along = rx * H.x + rz * H.z;
      if (along > 0 && along < 26 && Math.abs(rx * R.x + rz * R.z) < car.wid / 2 + 1 && player.pos.y < car.hgt + 2) {
        // Aim to stop with ~3 m between the bumper and the player.
        target = Math.min(target, Math.sqrt(2 * 5 * Math.max(0, along - car.len / 2 - 3.4)));
      }
    }
    return target;
  }

  // Is anyone on the crosswalk of the street this car is about to turn into?
  _exitCrosswalkBusy(car) {
    const axis = car.mode === 'arc' ? car.arc.fromAxis : car.axis;
    const dir = car.mode === 'arc' ? car.arc.fromDir : car.dir;
    const line = car.mode === 'arc' ? car.arc.fromLine : car.line;
    const k = car.mode === 'arc' ? car.arc.after.line : car.nextK;
    const H = hvec(axis, dir);
    const R = rightOf(H);
    const out = car.maneuver === 'right' ? R : R.clone().negate();
    const cx = (axis === 'x' ? this.c(k) : this.c(line)) + out.x * (this.hr + 2.1);
    const cz = (axis === 'x' ? this.c(line) : this.c(k)) + out.z * (this.hr + 2.1);
    for (const p of this.pedestrians.crossing) {
      const rx = p.pos.x - cx;
      const rz = p.pos.z - cz;
      if (Math.abs(rx * out.x + rz * out.z) < 2.2 && Math.abs(rx * H.x + rz * H.z) < this.hr + 0.5) return true;
    }
    return false;
  }

  // Is there oncoming traffic about to go through car's next intersection?
  _oncoming(car) {
    const center = this.c(car.nextK);
    for (const q of this.cars) {
      if (q === car || q.mode !== 'straight' || q.axis !== car.axis || q.line !== car.line || q.dir !== -car.dir) continue;
      if (q.nextK !== car.nextK || q.maneuver === 'left') continue;
      const dist = (center - q.s) * q.dir; // q's distance to the intersection centre
      if (dist > -this.hr && dist < 30 && (q.speed > 1 || dist < this.hr + 6)) return true;
    }
    return false;
  }

  _updateBox(car) {
    const H = car.heading;
    const hl = car.len / 2;
    const hw = car.wid / 2;
    const ex = Math.abs(H.x) * hl + Math.abs(H.z) * hw;
    const ez = Math.abs(H.z) * hl + Math.abs(H.x) * hw;
    car.box.min.set(car.pos.x - ex, 0, car.pos.z - ez);
    car.box.max.set(car.pos.x + ex, car.hgt, car.pos.z + ez);
  }

  // Fixed-step simulation (called from the physics loop before the player).
  step(dt, player) {
    this.time += dt;
    for (const car of this.cars) {
      const target = this._targetSpeed(car, player);
      car.braking = target < car.speed - 0.3 || car.speed < 0.3;
      car.speed = target < car.speed ? Math.max(target, car.speed - BRAKE * dt) : Math.min(target, car.speed + ACCEL * dt);
      car.prev.copy(car.pos);

      const d = car.speed * dt;
      if (car.mode === 'straight') {
        car.s += d * car.dir;
        const toCenter = (this.c(car.nextK) - car.s) * car.dir;
        if (toCenter <= this.hr) {
          if (car.maneuver === 'straight') {
            car.nextK += car.dir;
            this._chooseManeuver(car);
          } else {
            this._startTurn(car);
          }
        }
        if (car.mode === 'straight') this._straightPos(car);
      }
      if (car.mode === 'arc') {
        const A = car.arc;
        A.theta += d / A.r;
        if (A.theta >= Math.PI / 2) {
          this._finishTurn(car, (A.theta - Math.PI / 2) * A.r);
        } else {
          const cs = Math.cos(A.theta);
          const sn = Math.sin(A.theta);
          car.pos.copy(A.C).addScaledVector(A.a, cs).addScaledVector(A.b, sn);
          car.heading.copy(A.a).multiplyScalar(-sn).addScaledVector(A.b, cs).normalize();
        }
      }
      car.delta.subVectors(car.pos, car.prev);
      this._updateBox(car);
    }
  }

  // Push car transforms to the GPU (once per rendered frame).
  updateVisual() {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    const up = new THREE.Vector3(0, 1, 0);
    const brakeOn = new THREE.Color(2.4, 0.1, 0.08);
    const brakeOff = new THREE.Color(0.45, 0.02, 0.02);
    const dirty = new Set();
    for (const car of this.cars) {
      q.setFromAxisAngle(up, Math.atan2(car.heading.x, car.heading.z));
      m.compose(car.pos, q, one);
      const parts = this.meshes[car.type];
      for (const mesh of Object.values(parts)) mesh.setMatrixAt(car.idx, m);
      if (car.braking !== car.lastBraking) {
        parts.tail.setColorAt(car.idx, car.braking ? brakeOn : brakeOff);
        car.lastBraking = car.braking;
        dirty.add(parts.tail);
      }
    }
    for (const parts of Object.values(this.meshes)) {
      for (const mesh of Object.values(parts)) mesh.instanceMatrix.needsUpdate = true;
    }
    for (const mesh of dirty) mesh.instanceColor.needsUpdate = true;
    this._updateLamps();
  }
}
