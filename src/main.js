import * as THREE from 'three';
import { Input } from './core/input.js';
import { createCity } from './world/city.js';
import { createSky } from './world/sky.js';
import { Player } from './player/player.js';
import { PlayerModel } from './player/model.js';
import { CameraRig } from './player/cameraRig.js';
import { Grapple } from './gadgets/grapple.js';
import { Jetpack } from './gadgets/jetpack.js';
import { Hud } from './ui/hud.js';

const STEP = 1 / 120; // fixed physics step
const MOUSE_SENS = 0.0022;
const KEY_TURN = 14; // arrow-key turn speed, in "mouse pixels" per frame

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 5000);

const sky = createSky(scene);
const world = createCity(scene);
const input = new Input(canvas);
const player = new Player(world);
const model = new PlayerModel(scene);
const rig = new CameraRig(camera, world);
const grapple = new Grapple(scene);
const jetpack = new Jetpack();
// Order matters: forces first, rope constraint last.
const gadgets = [jetpack, grapple];
const hud = new Hud();

const overlay = document.getElementById('overlay');
const lockHint = document.getElementById('lock-hint');
overlay.addEventListener('click', () => input.start());
input.onPlayingChange = (playing) => {
  overlay.classList.toggle('hidden', playing);
  if (!playing) grapple.release(player, false);
};

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const aimDir = new THREE.Vector3();
const aimOrigin = new THREE.Vector3();
const hand = new THREE.Vector3();

function computeAim() {
  camera.getWorldDirection(aimDir);
  aimOrigin.copy(camera.position).addScaledVector(aimDir, rig.aimStart);
  return world.raycast(aimOrigin, aimDir, grapple.range);
}

function handleInput() {
  const active = input.playing;
  lockHint.classList.toggle('hidden', !active || input.locked);
  if (active) {
    // Arrow keys also turn the camera (handy when the mouse can't be captured).
    const turn = (input.down('ArrowLeft') ? -1 : 0) + (input.down('ArrowRight') ? 1 : 0);
    const tilt = (input.down('ArrowUp') ? -1 : 0) + (input.down('ArrowDown') ? 1 : 0);
    player.yaw -= (input.dx + turn * KEY_TURN) * MOUSE_SENS;
    player.pitch = THREE.MathUtils.clamp(player.pitch - (input.dy + tilt * KEY_TURN * 0.6) * MOUSE_SENS, -1.5, 1.5);
    if (input.justPressed('KeyV')) rig.toggle();
    if (input.justPressed('KeyR')) {
      grapple.release(player, false);
      player.respawn();
    }
  }

  const f = player.forward;
  const r = player.right;
  player.wish.set(0, 0, 0);
  if (active) {
    if (input.down('KeyW')) player.wish.add(f);
    if (input.down('KeyS')) player.wish.sub(f);
    if (input.down('KeyD')) player.wish.add(r);
    if (input.down('KeyA')) player.wish.sub(r);
    if (player.wish.lengthSq() > 1) player.wish.normalize();
    player.sprint = input.down('ShiftLeft') || input.down('ShiftRight');
    if (input.justPressed('Space') && player.onGround) player.jumpQueued = true;
  }

  const aim = computeAim();
  grapple.handleInput(input, player, aim);
  jetpack.handleInput(input, player);
  return aim;
}

const clock = new THREE.Clock();
let acc = 0;

function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);

  const aim = handleInput();

  acc += dt;
  while (acc >= STEP) {
    player.step(STEP, gadgets);
    acc -= STEP;
  }

  rig.update(dt, player);
  model.update(dt, player, { thrusting: jetpack.thrusting, visible: rig.mode === 'third', grapple });

  if (rig.mode === 'third') model.handPosition(hand);
  else hand.copy(camera.position).addScaledVector(player.right, 0.3).add(new THREE.Vector3(0, -0.35, 0));
  grapple.updateVisual(hand);

  sky.update(player.pos, camera.position);
  hud.update({ player, jetpack, rig, canGrapple: !!aim });

  input.endFrame();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

// Handy for debugging from the browser console.
window.game = { THREE, scene, camera, renderer, world, player, rig, grapple, jetpack, input };
