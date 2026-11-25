import * as THREE from 'three';

// Visual rope for the grappling hook: a chain of points simulated with Verlet
// integration (gravity + inertia + length constraints), drawn as a braided tube
// with a claw hook on the end. Gameplay physics still uses the simple rope
// constraint in grapple.js; this only decides how the rope *looks*.
//
// The visual length lags behind the real distance (the winch takes a moment
// to reel in), so the rope sags and swings when slack, whips when it latches,
// and bends behind fast moves. Letting go retracts it instantly.

const N = 30; // segments
const RADIAL = 6;
const RADIUS = 0.022;
const GRAVITY = new THREE.Vector3(0, -22, 0);
const DAMPING = 0.985;
const ITERATIONS = 14;
const REEL_SPEED = 10; // m/s the winch takes up slack (swing up toward the anchor faster than this and it goes slack)
const BASE_SLACK = 1.003; // a taut rope still sags a little

function braidTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = '#d8d0bc';
  x.fillRect(0, 0, 64, 64);
  // Two interleaved strand colours spiralling around the rope.
  x.lineWidth = 9;
  for (const [color, off] of [['#9c8f74', 0], ['#e9e3d3', 32]]) {
    x.strokeStyle = color;
    for (let k = -64; k < 128; k += 64) {
      x.beginPath();
      x.moveTo(k + off, 0);
      x.lineTo(k + off + 64, 64);
      x.stroke();
    }
  }
  x.strokeStyle = 'rgba(40,30,20,0.35)';
  x.lineWidth = 1.5;
  for (let k = -64; k < 128; k += 16) {
    x.beginPath();
    x.moveTo(k, 0);
    x.lineTo(k + 64, 64);
    x.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function buildHook() {
  const metal = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 0.9, roughness: 0.3 });
  const g = new THREE.Group();
  // Built pointing along +Z (the direction of travel).
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.26, 8).rotateX(Math.PI / 2), metal);
  shaft.position.z = 0.05;
  g.add(shaft);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    const prong = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.2, 6), metal);
    // Prongs curve back from the tip like a grappling claw.
    prong.position.set(Math.cos(a) * 0.07, Math.sin(a) * 0.07, 0.14);
    prong.rotation.set(0, 0, 0);
    prong.lookAt(Math.cos(a) * 0.2, Math.sin(a) * 0.2, 0.02);
    prong.rotateX(Math.PI / 2);
    g.add(prong);
  }
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.1, 8).rotateX(Math.PI / 2), metal);
  tip.position.z = 0.22;
  g.add(tip);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

export class RopeVisual {
  constructor(scene) {
    this.p = Array.from({ length: N + 1 }, () => new THREE.Vector3());
    this.prev = Array.from({ length: N + 1 }, () => new THREE.Vector3());
    this.length = 0;
    this.mode = 'hidden'; // hidden | out (hook flying or attached)
    this.endPinned = false;

    // Tube mesh with preallocated buffers, rebuilt in place each frame.
    const verts = (N + 1) * (RADIAL + 1);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts * 3), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(verts * 3), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(verts * 2), 2));
    const idx = [];
    for (let i = 0; i < N; i++) {
      for (let r = 0; r < RADIAL; r++) {
        const a = i * (RADIAL + 1) + r;
        const b = a + RADIAL + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    geo.setIndex(idx);
    const map = braidTexture();
    this.mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map, roughness: 0.85 }));
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.visible = false;
    scene.add(this.mesh);

    this.hook = buildHook();
    this.hook.visible = false;
    scene.add(this.hook);

    this._t = new THREE.Vector3();
    this._n = new THREE.Vector3();
    this._b = new THREE.Vector3();
  }

  // Lay the rope out from `from` toward `to`, all points at `from` (it pays out as the hook flies).
  _reset(from, to) {
    const side = new THREE.Vector3().subVectors(to, from).cross(new THREE.Vector3(0, 1, 0));
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize();
    for (let i = 0; i <= N; i++) {
      this.p[i].copy(from);
      // A little sideways flick so the rope uncoils with a wave rather than a line.
      this.prev[i].copy(from).addScaledVector(side, Math.sin((i / N) * Math.PI * 2) * 0.02);
    }
  }

  // Send a wave down the rope (when it latches on and snaps taut).
  _jolt(strength) {
    const a = this.p[0];
    const b = this.p[N];
    const along = new THREE.Vector3().subVectors(b, a).normalize();
    const side = new THREE.Vector3().crossVectors(along, new THREE.Vector3(0, 1, 0));
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize();
    const up = new THREE.Vector3().crossVectors(side, along);
    for (let i = 1; i < N; i++) {
      const s = Math.sin((i / N) * Math.PI * 3) * strength * Math.sin((i / N) * Math.PI);
      this.prev[i].addScaledVector(side, s).addScaledVector(up, -s * 0.6);
    }
  }

  // state: 'idle' | 'firing' | 'attached'; hookPos: where the hook is now.
  update(dt, hand, state, hookPos) {
    dt = Math.min(dt, 1 / 30);
    const active = state === 'firing' || state === 'attached';

    if (active && this.mode !== 'out') {
      this._reset(hand, hookPos);
      this.mode = 'out';
      this.length = 0.3;
    } else if (!active && this.mode === 'out') {
      // Released: the rope retracts instantly.
      this.mode = 'hidden';
      this.endPinned = false;
      this.mesh.visible = false;
      this.hook.visible = false;
    }
    if (this.mode === 'hidden') {
      this._lastState = state;
      return;
    }

    const dist = hand.distanceTo(hookPos);
    if (this.mode === 'out') {
      if (state === 'firing') {
        // Paying out: a bit more rope than the hook has travelled, so it trails and sags.
        this.length = dist * 1.12 + 0.4;
      } else {
        if (this._lastState === 'firing') {
          // Just latched: the rope snaps nearly taut (it's taking your weight) with a wave running down it.
          this.length = Math.min(this.length, dist * 1.02);
          this._jolt(Math.min(0.5, dist * 0.012));
        }
        // The winch reels in slack at a finite speed; the rope can't be shorter than the gap.
        const taut = dist * BASE_SLACK;
        this.length = this.length < taut ? taut : Math.max(taut, this.length - REEL_SPEED * dt);
      }
      this.endPinned = state === 'attached' || state === 'firing';
    }

    const rest = this.length / N;
    const sub = 3;
    const h = dt / sub;
    const g2 = GRAVITY.clone().multiplyScalar(h * h);
    const v = new THREE.Vector3();
    const d = new THREE.Vector3();
    for (let s = 0; s < sub; s++) {
      for (let i = 1; i <= N; i++) {
        if (i === N && this.endPinned) continue;
        v.subVectors(this.p[i], this.prev[i]).multiplyScalar(DAMPING);
        this.prev[i].copy(this.p[i]);
        this.p[i].add(v).add(g2);
      }
      for (let it = 0; it < ITERATIONS; it++) {
        this.p[0].copy(hand);
        if (this.endPinned) this.p[N].copy(hookPos);
        for (let i = 0; i < N; i++) {
          const a = this.p[i];
          const b = this.p[i + 1];
          d.subVectors(b, a);
          const len = d.length();
          if (len <= rest || len < 1e-6) continue; // a rope can go slack but not stretch
          const corr = (len - rest) / len;
          const aFixed = i === 0;
          const bFixed = i + 1 === N && this.endPinned;
          if (aFixed && bFixed) continue;
          if (aFixed) b.addScaledVector(d, -corr);
          else if (bFixed) a.addScaledVector(d, corr);
          else {
            a.addScaledVector(d, corr * 0.5);
            b.addScaledVector(d, -corr * 0.5);
          }
        }
      }
      this.p[0].copy(hand);
      if (this.endPinned) this.p[N].copy(hookPos);
    }

    this._lastState = state;
    this._writeTube();
    this.mesh.visible = true;

    // Hook sits on the rope's end, pointing the way the last segment runs.
    this.hook.visible = true;
    this.hook.position.copy(this.p[N]);
    const tipDir = d.subVectors(this.p[N], this.p[N - 2]);
    if (tipDir.lengthSq() > 1e-6) this.hook.lookAt(this.p[N].clone().add(tipDir));
  }

  _writeTube() {
    const pos = this.mesh.geometry.attributes.position.array;
    const nor = this.mesh.geometry.attributes.normal.array;
    const uv = this.mesh.geometry.attributes.uv.array;
    const T = this._t;
    const Nn = this._n;
    const B = this._b;
    let along = 0;
    // Parallel-transport-ish frame: keep the previous normal to avoid twisting.
    Nn.set(0, 1, 0);
    for (let i = 0; i <= N; i++) {
      const a = this.p[Math.max(0, i - 1)];
      const b = this.p[Math.min(N, i + 1)];
      T.subVectors(b, a);
      if (T.lengthSq() < 1e-10) T.set(0, 0, 1);
      T.normalize();
      B.crossVectors(T, Nn);
      if (B.lengthSq() < 1e-8) B.crossVectors(T, Math.abs(T.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0));
      B.normalize();
      Nn.crossVectors(B, T).normalize();
      if (i > 0) along += this.p[i].distanceTo(this.p[i - 1]);
      for (let r = 0; r <= RADIAL; r++) {
        const ang = (r / RADIAL) * Math.PI * 2;
        const cx = Math.cos(ang);
        const sy = Math.sin(ang);
        const k = (i * (RADIAL + 1) + r) * 3;
        const nx = Nn.x * cx + B.x * sy;
        const ny = Nn.y * cx + B.y * sy;
        const nz = Nn.z * cx + B.z * sy;
        pos[k] = this.p[i].x + nx * RADIUS;
        pos[k + 1] = this.p[i].y + ny * RADIUS;
        pos[k + 2] = this.p[i].z + nz * RADIUS;
        nor[k] = nx;
        nor[k + 1] = ny;
        nor[k + 2] = nz;
        const u = (i * (RADIAL + 1) + r) * 2;
        uv[u] = along / 0.12; // braid repeats every 12 cm
        uv[u + 1] = r / RADIAL;
      }
    }
    const geo = this.mesh.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.attributes.normal.needsUpdate = true;
    geo.attributes.uv.needsUpdate = true;
  }
}
