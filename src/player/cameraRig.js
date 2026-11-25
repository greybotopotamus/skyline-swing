import * as THREE from 'three';
import { raycastBoxes } from '../physics/collision.js';

const EYE_HEIGHT = 0.7;
const THIRD_DISTANCE = 6;
const SHOULDER = 0.6;
const BASE_FOV = 75;

// Handles first/third person views. Third person pulls in when a building
// would block the view.
export class CameraRig {
  constructor(camera, world) {
    this.camera = camera;
    this.world = world;
    this.mode = 'third';
    this.dist = THIRD_DISTANCE;
    this.dir = new THREE.Vector3(0, 0, -1);
    // Distance from the camera to the player along the view ray. Grapple aiming
    // skips anything closer than this so it never latches onto stuff behind you.
    this.aimStart = 0;
  }

  toggle() {
    this.mode = this.mode === 'third' ? 'first' : 'third';
  }

  update(dt, player) {
    const cp = Math.cos(player.pitch);
    this.dir.set(-Math.sin(player.yaw) * cp, Math.sin(player.pitch), -Math.cos(player.yaw) * cp);

    if (this.mode === 'first') {
      this.camera.position.copy(player.pos).y += EYE_HEIGHT;
      this.aimStart = 0;
    } else {
      const target = player.pos.clone();
      target.y += 1.1;
      target.addScaledVector(player.right, SHOULDER);
      const back = this.dir.clone().negate();
      const hit = raycastBoxes(target, back, THIRD_DISTANCE, this.world.buildings, true);
      const want = hit ? Math.max(0.5, hit.distance - 0.3) : THIRD_DISTANCE;
      // Snap in fast (avoid clipping), ease out slowly.
      this.dist = want < this.dist ? want : this.dist + (want - this.dist) * Math.min(1, dt * 4);
      this.camera.position.copy(target).addScaledVector(back, this.dist);
      this.aimStart = this.dist;
    }

    this.camera.lookAt(this.camera.position.clone().add(this.dir));

    const speed = player.vel.length();
    const fov = BASE_FOV + Math.min(25, Math.max(0, speed - 12) * 0.5);
    this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 4);
    this.camera.updateProjectionMatrix();
  }
}
