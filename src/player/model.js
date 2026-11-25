import * as THREE from 'three';
import { textureSet } from '../world/textures.js';
import { faceTexture } from '../world/humanTextures.js';

// Load a texture set and tile it over limb UVs (u around, v along the limb).
function tiled(id, maps, rx, ry) {
  const set = textureSet(id, { maps });
  for (const t of Object.values(set)) t.repeat.set(rx, ry);
  return set;
}

// Procedurally built, procedurally animated humanoid: an aviator-inventor in a
// flight suit with goggles, harness, wrist grapple launcher and twin-tank jetpack.
// Everything is hierarchical joints (THREE.Group) with simple meshes attached,
// so poses are just joint rotations. Front of the character is -Z.

const V2 = THREE.Vector2;
const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);

// Rounded, tapered limb hanging down from its joint (top at y=0, bottom at y=-len).
// r0 = top radius, r1 = bottom radius, bulge = extra radius (muscle) around bulgeAt (0 top..1 bottom).
function limbGeo(len, r0, r1, bulge = 0, bulgeAt = 0.35, seg = 16) {
  const pts = [
    new V2(0, -len - r1 * 0.6),
    new V2(r1 * 0.55, -len - r1 * 0.5),
    new V2(r1 * 0.88, -len - r1 * 0.25),
  ];
  const N = 12;
  for (let i = N; i >= 0; i--) {
    const t = i / N;
    const r = r0 + (r1 - r0) * t + bulge * Math.exp(-(((t - bulgeAt) / 0.28) ** 2));
    pts.push(new V2(r, -len * t));
  }
  pts.push(new V2(r0 * 0.88, r0 * 0.25), new V2(r0 * 0.55, r0 * 0.5), new V2(0, r0 * 0.6));
  return new THREE.LatheGeometry(pts, seg);
}

function joint(parent, x = 0, y = 0, z = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

function mesh(parent, geo, mat, { p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1] } = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(...p);
  m.rotation.set(...r);
  m.scale.set(...s);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

const damp = (rate, dt) => 1 - Math.exp(-rate * dt);

export class PlayerModel {
  constructor(scene) {
    this.group = new THREE.Group(); // positioned at the player's centre; tilts around it
    this.body = joint(this.group, 0, -0.9, 0); // feet at local y=0
    this.facing = 0;
    this.phase = 0;
    this.time = 0;
    this._build();
    scene.add(this.group);
  }

  _build() {
    // Woven fabric (Fabric081C) for the suit, grained leather (Leather026) for straps, gloves, boots and cap.
    const fabric = () => tiled('Fabric081C', ['color', 'normal', 'roughness'], 6, 6);
    const leather = () => tiled('Leather026', ['normal', 'roughness'], 3, 3);
    const M = {
      suit: new THREE.MeshStandardMaterial({ ...fabric(), color: 0x2e4466, normalScale: new THREE.Vector2(0.8, 0.8) }),
      suitDark: new THREE.MeshStandardMaterial({ ...fabric(), color: 0x222d42 }),
      accent: new THREE.MeshStandardMaterial({ ...fabric(), color: 0xe07030 }),
      leather: new THREE.MeshStandardMaterial({ ...leather(), color: 0x6a4329 }),
      skin: new THREE.MeshStandardMaterial({ color: 0xc89274, roughness: 0.65 }),
      // Painted face (mouth, nose shading, stubble); eyes sit under the goggles.
      face: new THREE.MeshStandardMaterial({ color: 0xc89274, roughness: 0.62, map: faceTexture({ stubble: true }) }),
      metal: new THREE.MeshStandardMaterial({ color: 0x8a9099, roughness: 0.35, metalness: 0.85 }),
      brass: new THREE.MeshStandardMaterial({ color: 0xb8893e, roughness: 0.3, metalness: 0.9 }),
      lens: new THREE.MeshStandardMaterial({ color: 0x1b4a52, emissive: 0x3fd8c0, emissiveIntensity: 0.6, roughness: 0.1, metalness: 0.3 }),
      scarf: new THREE.MeshStandardMaterial({ color: 0xb8322a, roughness: 0.9 }),
    };
    const j = (this.joints = {});
    const b = this.body;

    // --- Pelvis / torso -----------------------------------------------------
    j.hips = joint(b, 0, 0.95, 0);
    mesh(j.hips, limbGeo(0.13, 0.145, 0.15, 0.01, 0.6), M.suitDark, { p: [0, 0.07, 0], s: [1.05, 1, 0.72] });
    const belt = mesh(j.hips, new THREE.TorusGeometry(0.152, 0.02, 8, 28), M.leather, { p: [0, 0.06, 0], r: [Math.PI / 2, 0, 0], s: [1.04, 0.74, 1] });
    belt.castShadow = false;
    mesh(j.hips, new THREE.BoxGeometry(0.06, 0.05, 0.02), M.brass, { p: [0, 0.06, -0.118] });
    mesh(j.hips, new THREE.BoxGeometry(0.07, 0.08, 0.05), M.leather, { p: [0.15, 0.0, -0.03] }); // utility pouch

    j.spine = joint(j.hips, 0, 0.08, 0);
    mesh(j.spine, limbGeo(0.2, 0.15, 0.135, 0, 0.5), M.suit, { p: [0, 0.2, 0], s: [1.05, 1, 0.7] });

    j.chest = joint(j.spine, 0, 0.2, 0);
    mesh(j.chest, limbGeo(0.25, 0.155, 0.15, 0.03, 0.35), M.suit, { p: [0, 0.27, 0], s: [1.2, 1, 0.68] });
    // Harness straps.
    for (const sx of [-1, 1]) {
      mesh(j.chest, new THREE.BoxGeometry(0.035, 0.3, 0.012), M.leather, { p: [sx * 0.085, 0.14, -0.112], r: [0.08, 0, sx * 0.12] });
    }
    mesh(j.chest, new THREE.BoxGeometry(0.24, 0.03, 0.012), M.leather, { p: [0, 0.07, -0.118] });
    mesh(j.chest, new THREE.CylinderGeometry(0.022, 0.022, 0.012, 16), M.brass, { p: [0, 0.07, -0.126], r: [Math.PI / 2, 0, 0] });

    // --- Neck / head ----------------------------------------------------------
    j.neck = joint(j.chest, 0, 0.27, 0);
    mesh(j.neck, limbGeo(0.08, 0.05, 0.056), M.skin, { p: [0, 0.08, 0] });
    mesh(j.neck, new THREE.TorusGeometry(0.068, 0.03, 10, 20), M.scarf, { p: [0, 0.005, 0], r: [Math.PI / 2, 0, 0], s: [1.05, 0.9, 1] });
    // Scarf tail flaps behind.
    j.scarfTail = joint(j.neck, 0.03, 0, 0.06);
    mesh(j.scarfTail, new THREE.BoxGeometry(0.06, 0.22, 0.012), M.scarf, { p: [0, -0.11, 0] });

    j.head = joint(j.neck, 0, 0.1, 0);
    // Face texture is painted on the sphere's +Z side; turn it to face forward (-Z).
    mesh(j.head, new THREE.SphereGeometry(0.105, 32, 24).rotateY(Math.PI), M.face, { p: [0, 0.03, 0], s: [0.92, 1.16, 1.02] });
    mesh(j.head, new THREE.SphereGeometry(0.018, 10, 8), M.skin, { p: [0, 0.015, -0.108], s: [0.9, 1.2, 1.1] }); // nose
    for (const sx of [-1, 1]) mesh(j.head, new THREE.SphereGeometry(0.022, 10, 8), M.skin, { p: [sx * 0.096, 0.03, 0.005], s: [0.5, 1, 0.8] });
    // Aviator cap.
    mesh(j.head, new THREE.SphereGeometry(0.113, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.52), M.leather, { p: [0, 0.04, 0.008], r: [0.32, 0, 0], s: [0.95, 1.08, 1.02] });
    // Goggles: strap + two lenses in brass rims.
    mesh(j.head, new THREE.TorusGeometry(0.106, 0.009, 6, 32), M.suitDark, { p: [0, 0.045, 0], r: [Math.PI / 2 - 0.12, 0, 0], s: [0.93, 1, 1] });
    for (const sx of [-1, 1]) {
      mesh(j.head, new THREE.CylinderGeometry(0.03, 0.033, 0.03, 18), M.brass, { p: [sx * 0.042, 0.05, -0.096], r: [Math.PI / 2 - 0.12, 0, 0] });
      mesh(j.head, new THREE.CylinderGeometry(0.025, 0.025, 0.032, 18), M.lens, { p: [sx * 0.042, 0.05, -0.1], r: [Math.PI / 2 - 0.12, 0, 0] });
    }

    // --- Arms -----------------------------------------------------------------
    for (const side of ['L', 'R']) {
      const sx = side === 'L' ? -1 : 1;
      const sh = (j['shoulder' + side] = joint(j.chest, sx * 0.205, 0.2, 0.0));
      mesh(sh, new THREE.SphereGeometry(0.068, 16, 12), M.accent, { p: [sx * 0.01, 0.01, 0], s: [1.1, 0.9, 1.1] }); // pad
      mesh(sh, limbGeo(0.28, 0.056, 0.044, 0.01, 0.35), M.suit);
      const el = (j['elbow' + side] = joint(sh, 0, -0.28, 0));
      mesh(el, limbGeo(0.25, 0.046, 0.035, 0.009, 0.25), M.suit);
      mesh(el, limbGeo(0.08, 0.042, 0.041), M.leather, { p: [0, -0.17, 0] }); // glove cuff
      const hand = (j['hand' + side] = joint(el, 0, -0.26, 0));
      mesh(hand, new THREE.SphereGeometry(0.05, 14, 10), M.leather, { p: [0, -0.045, 0], s: [0.75, 1.25, 0.5] }); // palm + fingers
      mesh(hand, limbGeo(0.045, 0.016, 0.014), M.leather, { p: [-sx * 0.035, -0.02, -0.02], r: [-0.4, 0, -sx * 0.6] }); // thumb
      if (side === 'R') {
        // Wrist-mounted grapple launcher.
        mesh(el, new THREE.BoxGeometry(0.07, 0.12, 0.06), M.metal, { p: [0, -0.15, -0.045] });
        mesh(el, new THREE.CylinderGeometry(0.018, 0.022, 0.09, 12), M.brass, { p: [0, -0.2, -0.08] });
        mesh(el, new THREE.CylinderGeometry(0.012, 0.012, 0.03, 10), M.lens, { p: [0, -0.1, -0.075], r: [Math.PI / 2, 0, 0] });
      }
    }

    // --- Legs -----------------------------------------------------------------
    for (const side of ['L', 'R']) {
      const sx = side === 'L' ? -1 : 1;
      const hip = (j['hip' + side] = joint(j.hips, sx * 0.095, -0.03, 0));
      mesh(hip, limbGeo(0.42, 0.085, 0.058, 0.014, 0.3), M.suit);
      mesh(hip, new THREE.BoxGeometry(0.06, 0.1, 0.05), M.leather, { p: [sx * 0.07, -0.15, 0] }); // thigh pocket
      const knee = (j['knee' + side] = joint(hip, 0, -0.42, 0));
      mesh(knee, new THREE.SphereGeometry(0.052, 12, 10), M.accent, { p: [0, 0, -0.03], s: [1, 1.1, 0.7] }); // knee pad
      mesh(knee, limbGeo(0.4, 0.06, 0.042, 0.014, 0.25), M.suit);
      mesh(knee, limbGeo(0.2, 0.056, 0.05), M.leather, { p: [0, -0.2, 0] }); // boot shaft
      const ankle = (j['ankle' + side] = joint(knee, 0, -0.41, 0));
      mesh(ankle, limbGeo(0.2, 0.05, 0.052), M.leather, { p: [0, -0.02, 0.05], r: [Math.PI / 2, 0, 0], s: [1.05, 1, 0.65] });
      mesh(ankle, new THREE.BoxGeometry(0.1, 0.02, 0.27), M.suitDark, { p: [0, -0.05, -0.045] }); // sole
    }

    // --- Jetpack --------------------------------------------------------------
    const pack = joint(j.chest, 0, 0.12, 0.125);
    mesh(pack, new THREE.BoxGeometry(0.24, 0.32, 0.07), M.metal, { p: [0, 0, 0] });
    this.flames = [];
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
    for (const sx of [-1, 1]) {
      mesh(pack, limbGeo(0.28, 0.065, 0.065), M.brass, { p: [sx * 0.1, 0.16, 0.07] });
      mesh(pack, new THREE.CylinderGeometry(0.05, 0.068, 0.07, 14), M.metal, { p: [sx * 0.1, -0.2, 0.07] }); // nozzle
      const f = joint(pack, sx * 0.1, -0.24, 0.07);
      const outer = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.5, 14, 1, true), flameMat);
      outer.rotation.x = Math.PI;
      outer.position.y = -0.25;
      const core = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.28, 12, 1, true), coreMat);
      core.rotation.x = Math.PI;
      core.position.y = -0.14;
      f.add(outer, core);
      f.visible = false;
      this.flames.push(f);
    }
    mesh(pack, new THREE.BoxGeometry(0.12, 0.06, 0.03), M.accent, { p: [0, 0.08, 0.05] });
    this.jetLight = new THREE.PointLight(0xff8a3c, 0, 6, 2);
    this.jetLight.position.set(0, -0.45, 0.07);
    pack.add(this.jetLight);
  }

  // state: { thrusting, visible, grapple }
  update(dt, player, { thrusting, visible, grapple }) {
    this.time += dt;
    this.group.visible = visible;
    this.group.position.copy(player.pos);
    if (!visible) return;

    const j = this.joints;
    const v = player.vel;
    const hv = Math.hypot(v.x, v.z);
    const swinging = grapple && grapple.state === 'attached';
    const airborne = !player.onGround;

    // --- Facing & body tilt --------------------------------------------------
    if (hv > 1.2) this.facing = lerpAngle(this.facing, Math.atan2(-v.x, -v.z), damp(airborne ? 5 : 12, dt));
    const yawQ = new THREE.Quaternion().setFromAxisAngle(UP, this.facing);

    const targetUp = UP.clone();
    if (swinging) {
      targetUp.lerp(grapple.anchor.clone().sub(player.pos).normalize(), 0.65);
    } else if (hv > 0.5) {
      const lean = airborne ? 0.12 : Math.min(hv / 15, 1) * 0.12;
      targetUp.x += (v.x / hv) * lean;
      targetUp.z += (v.z / hv) * lean;
    }
    targetUp.normalize();
    const desired = new THREE.Quaternion().setFromUnitVectors(UP, targetUp).multiply(yawQ);
    this.group.quaternion.slerp(desired, damp(8, dt));

    // --- Pose targets ----------------------------------------------------------
    const T = {}; // joint -> [x, y, z]
    for (const k in j) T[k] = [0, 0, 0];
    let bob = 0;

    if (swinging) {
      T.spine = [0.12, 0, 0];
      T.chest = [0.05, 0, 0];
      T.shoulderL = [0.35, 0, -0.75];
      T.elbowL = [0.7, 0, 0];
      T.hipL = [0.45, 0, -0.06];
      T.kneeL = [-0.75, 0, 0];
      T.hipR = [-0.15, 0, 0.06];
      T.kneeR = [-1.0, 0, 0];
      T.ankleL = [-0.3, 0, 0];
      T.ankleR = [-0.4, 0, 0];
      T.head = [-0.1, 0, 0];
    } else if (thrusting) {
      T.spine = [-0.05, 0, 0];
      T.shoulderL = [0.15, 0, -0.35];
      T.shoulderR = [0.15, 0, 0.35];
      T.elbowL = [0.55, 0, 0];
      T.elbowR = [0.55, 0, 0];
      T.hipL = [-0.12, 0, -0.04];
      T.hipR = [-0.2, 0, 0.04];
      T.kneeL = [-0.2, 0, 0];
      T.kneeR = [-0.3, 0, 0];
      T.ankleL = [-0.5, 0, 0];
      T.ankleR = [-0.5, 0, 0];
    } else if (airborne) {
      const falling = THREE.MathUtils.clamp(-v.y / 18, 0, 1); // 0 rising .. 1 falling fast
      const arm = 0.7 + falling * 0.7;
      T.shoulderL = [0.2 - falling * 0.4, 0, -arm];
      T.shoulderR = [0.2 - falling * 0.4, 0, arm];
      T.elbowL = [0.5 - falling * 0.2, 0, 0];
      T.elbowR = [0.5 - falling * 0.2, 0, 0];
      T.hipL = [0.9 - falling * 0.6, 0, -0.05 - falling * 0.15];
      T.kneeL = [-1.4 + falling * 0.8, 0, 0];
      T.hipR = [-0.1 + falling * 0.1, 0, 0.05 + falling * 0.15];
      T.kneeR = [-0.7 + falling * 0.2, 0, 0];
      T.ankleL = [-0.3, 0, 0];
      T.ankleR = [-0.4, 0, 0];
      T.spine = [-0.08 + falling * 0.15, 0, 0];
    } else if (hv > 0.4) {
      // Run cycle.
      const run = Math.min(hv / 9, 1.4);
      this.phase += dt * (3 + hv * 0.75);
      const s = Math.sin(this.phase);
      const c = Math.cos(this.phase);
      T.hipL = [s * 0.65 * run, 0, -0.02];
      T.hipR = [-s * 0.65 * run, 0, 0.02];
      T.kneeL = [-run * (0.15 + 1.1 * Math.max(0, c)), 0, 0];
      T.kneeR = [-run * (0.15 + 1.1 * Math.max(0, -c)), 0, 0];
      T.ankleL = [-run * 0.25 * Math.max(0, -s), 0, 0];
      T.ankleR = [-run * 0.25 * Math.max(0, s), 0, 0];
      T.shoulderL = [-s * 0.6 * run, 0, -0.1];
      T.shoulderR = [s * 0.6 * run, 0, 0.1];
      T.elbowL = [0.35 + 0.75 * run, 0, 0];
      T.elbowR = [0.35 + 0.75 * run, 0, 0];
      T.spine = [-0.1 * run, s * 0.08 * run, 0];
      T.chest = [-0.04 * run, -s * 0.18 * run, 0];
      T.head = [0.08 * run, s * 0.1 * run, 0];
      bob = Math.abs(c) * 0.05 * run - 0.035 * run;
    } else {
      // Idle: breathing and a slight weight shift.
      const br = Math.sin(this.time * 1.8);
      T.chest = [br * 0.02, 0, 0];
      T.shoulderL = [0.05, 0, -0.1 - br * 0.02];
      T.shoulderR = [0.05, 0, 0.1 + br * 0.02];
      T.elbowL = [0.15, 0, 0];
      T.elbowR = [0.15, 0, 0];
      T.hipL = [0, 0, -0.04];
      T.hipR = [0, 0, 0.04];
      T.head = [Math.sin(this.time * 0.6) * 0.03, Math.sin(this.time * 0.4) * 0.15, 0];
    }

    // Look up/down with the camera on the ground.
    if (!airborne) T.head[0] += player.pitch * 0.35;

    // Scarf tail streams back with speed.
    const speed = v.length();
    T.scarfTail = [-0.2 - Math.min(speed / 20, 1) * 1.2 - Math.sin(this.time * 14) * 0.08 * Math.min(speed / 10, 1), 0, 0];

    const k = damp(14, dt);
    if (swinging) delete T.shoulderR; // aimed up the rope below instead
    for (const name in T) {
      const r = j[name].rotation;
      const t = T[name];
      r.x += (t[0] - r.x) * k;
      r.y += (t[1] - r.y) * k;
      r.z += (t[2] - r.z) * k;
    }
    this.body.position.y += (-0.9 + bob - this.body.position.y) * damp(20, dt);

    // Swinging: right arm points straight up the rope.
    this.group.updateMatrixWorld(true);
    if (swinging) {
      const shoulderW = j.shoulderR.getWorldPosition(new THREE.Vector3());
      const chestQ = j.chest.getWorldQuaternion(new THREE.Quaternion());
      const local = grapple.anchor.clone().sub(shoulderW).normalize().applyQuaternion(chestQ.invert());
      const aim = new THREE.Quaternion().setFromUnitVectors(DOWN, local);
      j.shoulderR.quaternion.slerp(aim, damp(18, dt));
      j.elbowR.rotation.set(0, 0, 0);
      this.group.updateMatrixWorld(true);
    }

    // Jetpack flames.
    for (const f of this.flames) {
      f.visible = thrusting;
      if (thrusting) f.scale.set(1, 0.75 + Math.random() * 0.5, 1);
    }
    this.jetLight.intensity = thrusting ? 3 + Math.random() * 2 : 0;
  }

  // World position of the right hand (rope origin).
  handPosition(out = new THREE.Vector3()) {
    return this.joints.handR.localToWorld(out.set(0, -0.06, 0));
  }
}

function lerpAngle(a, b, t) {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * t;
}
