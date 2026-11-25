import * as THREE from 'three';

// Placeholder character built from primitives. Swap for a rigged glTF later.
export class PlayerModel {
  constructor(scene) {
    this.group = new THREE.Group();
    this.facing = 0;

    const suit = new THREE.MeshStandardMaterial({ color: 0x2b5d8a, roughness: 0.6 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x22262c, roughness: 0.5, metalness: 0.4 });
    const visor = new THREE.MeshStandardMaterial({ color: 0x4ff0c8, emissive: 0x2aa88a, roughness: 0.2 });

    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.8, 6, 12), suit);
    body.position.y = -0.1;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), suit);
    head.position.y = 0.62;
    const eyes = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.06), visor);
    eyes.position.set(0, 0.65, -0.19);
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.25), dark);
    pack.position.set(0, 0.1, 0.36);

    this.flames = [];
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xffa03c, transparent: true, opacity: 0.9 });
    for (const x of [-0.14, 0.14]) {
      const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.14, 10), dark);
      nozzle.position.set(x, -0.27, 0.38);
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.6, 10), flameMat);
      flame.rotation.x = Math.PI; // point down
      flame.position.set(x, -0.64, 0.38);
      flame.visible = false;
      this.flames.push(flame);
      this.group.add(nozzle, flame);
    }

    for (const m of [body, head, eyes, pack]) this.group.add(m);
    this.group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    scene.add(this.group);
  }

  update(dt, player, { thrusting, visible }) {
    this.group.visible = visible;
    this.group.position.copy(player.pos);

    // Face the camera yaw, smoothed.
    let diff = player.yaw - this.facing;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.facing += diff * Math.min(1, dt * 12);
    this.group.rotation.y = this.facing;

    for (const f of this.flames) {
      f.visible = thrusting;
      if (thrusting) f.scale.set(1, 0.8 + Math.random() * 0.5, 1);
    }
  }

  // Approximate world position of the right hand (rope origin).
  handPosition(out = new THREE.Vector3()) {
    out.set(0.4, 0.35, -0.1).applyAxisAngle(THREE.Object3D.DEFAULT_UP, this.facing);
    return out.add(this.group.position);
  }
}
