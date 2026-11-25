import * as THREE from 'three';
import { mulberry32 } from '../core/random.js';
import { SpatialGrid, raycastBoxes } from '../physics/collision.js';
import { FACADES, createBuildingMaterials, createRoofMaterial } from './buildingMaterial.js';
import { textureSet, useWorldUV } from './textures.js';

// Subtle per-building tints multiplied over the facade photos.
const TINTS = [0xffffff, 0xf2ece2, 0xe6ebf0, 0xfff6ea, 0xe9e9e9, 0xf5efe8];

// Pick a facade style: glass/grid towers downtown, brick/concrete lower down.
function pickFacade(rand, h) {
  const r = rand();
  if (h > 70) return r < 0.55 ? 0 : r < 0.85 ? 1 : 3;
  if (h > 35) return r < 0.25 ? 0 : r < 0.5 ? 1 : r < 0.75 ? 3 : 2;
  return r < 0.15 ? 1 : r < 0.6 ? 2 : 3;
}

// Procedural city: a grid of blocks separated by roads, each block split into
// 1–4 lots. Buildings get taller toward the centre. Every building is an AABB
// collider and a valid grapple target.
//
// Environments share this return shape so new ones (canyon, docks, forest...)
// can be dropped in: { buildings, grid, spawn, spawnYaw, raycast(), dispose() }.
export function createCity(scene, { seed = 1337, blocks = 10, blockSize = 44, road = 14, outskirts = 5 } = {}) {
  const coreRand = mulberry32(seed);
  const coreStyleRand = mulberry32(seed ^ 0x9e3779b9); // styles/tints use their own stream, separate from the layout
  const period = blockSize + road;
  const half = (blocks * period) / 2;
  const buildings = []; // playable: solid + grappleable
  const scenery = []; // outskirts ring: visual only, keeps the skyline going to the horizon
  const slabs = [];
  // Separate random streams for the outskirts so the playable city layout never changes.
  const outRand = mulberry32(seed ^ 0x51ed270b);
  const outStyleRand = mulberry32(seed ^ 0x2545f491);

  for (let i = -outskirts; i < blocks + outskirts; i++) {
    for (let j = -outskirts; j < blocks + outskirts; j++) {
      const core = i >= 0 && i < blocks && j >= 0 && j < blocks;
      const rand = core ? coreRand : outRand;
      const styleRand = core ? coreStyleRand : outStyleRand;
      const target = core ? buildings : scenery;
      const addBuilding = (x0, z0, x1, z1, y0, y1, color, style) => {
        target.push({ min: new THREE.Vector3(x0, y0, z0), max: new THREE.Vector3(x1, y1, z1), color, style });
      };
      const bx = -half + i * period + road / 2;
      const bz = -half + j * period + road / 2;
      const cx = bx + blockSize / 2;
      const cz = bz + blockSize / 2;
      const dist = Math.hypot(cx, cz);
      const park = dist > 60 && rand() < 0.08;
      slabs.push({ x: cx, z: cz, park });
      if (park) continue;

      const maxH = 28 + 170 * Math.exp(-((dist / 170) ** 2));
      const inset = 3;
      const gap = 4;
      const inner = blockSize - inset * 2;

      const r = rand();
      const sx = 0.35 + rand() * 0.3;
      const sz = 0.35 + rand() * 0.3;
      let lots;
      if (r < 0.25) lots = [[0, 0, 1, 1]];
      else if (r < 0.5) lots = [[0, 0, sx, 1], [sx, 0, 1, 1]];
      else if (r < 0.7) lots = [[0, 0, 1, sz], [0, sz, 1, 1]];
      else lots = [[0, 0, sx, sz], [sx, 0, 1, sz], [0, sz, sx, 1], [sx, sz, 1, 1]];

      for (const [fx0, fz0, fx1, fz1] of lots) {
        const x0 = bx + inset + fx0 * inner + (fx0 > 0 ? gap / 2 : 0);
        const x1 = bx + inset + fx1 * inner - (fx1 < 1 ? gap / 2 : 0);
        const z0 = bz + inset + fz0 * inner + (fz0 > 0 ? gap / 2 : 0);
        const z1 = bz + inset + fz1 * inner - (fz1 < 1 ? gap / 2 : 0);
        let h = maxH * (0.3 + 0.7 * rand());
        if (rand() < 0.05) h *= 1.5;
        h = Math.max(10.5, Math.round(h / 3.5) * 3.5);
        if (core) rand(); // the original city drew a colour here; keep the draw so the layout stays the same
        const color = TINTS[Math.floor(styleRand() * TINTS.length)];
        const style = pickFacade(styleRand, h);
        addBuilding(x0, z0, x1, z1, 0, h, color, style);

        // Setback tier on some tall towers.
        if (h > 60 && rand() < 0.5) {
          const shrinkX = (x1 - x0) * (0.15 + rand() * 0.15);
          const shrinkZ = (z1 - z0) * (0.15 + rand() * 0.15);
          const tier = Math.round((h * (0.25 + rand() * 0.3)) / 3.5) * 3.5;
          addBuilding(x0 + shrinkX, z0 + shrinkZ, x1 - shrinkX, z1 - shrinkZ, h, h + tier, color, style);
        }
      }
    }
  }

  // --- Meshes ---------------------------------------------------------------
  const objects = [];

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const c = new THREE.Color();

  // One instanced mesh per facade style; BoxGeometry groups give walls and roof separate materials.
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  boxGeo.translate(0, 0.5, 0); // origin at the base
  const roofMat = createRoofMaterial();
  FACADES.forEach((facade, styleIdx) => {
    const list = buildings.concat(scenery).filter((b) => b.style === styleIdx);
    if (!list.length) return;
    const mesh = new THREE.InstancedMesh(boxGeo, createBuildingMaterials(facade, roofMat), list.length);
    list.forEach((b, idx) => {
      const size = b.max.clone().sub(b.min);
      m.compose(new THREE.Vector3((b.min.x + b.max.x) / 2, b.min.y, (b.min.z + b.max.z) / 2), q, size);
      mesh.setMatrixAt(idx, m);
      mesh.setColorAt(idx, c.setHex(b.color).multiplyScalar(facade.brightness ?? 1));
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    objects.push(mesh);
  });

  // Sidewalk paving and park grass (visual only — thin enough to walk over).
  const slabGeo = new THREE.BoxGeometry(blockSize, 0.12, blockSize);
  slabGeo.translate(0, 0.06, 0);
  const slabKinds = [
    { park: false, mat: useWorldUV(new THREE.MeshStandardMaterial({ ...textureSet('PavingStones128'), color: 0xd8d4cc }), 'xz', 3) },
    { park: true, mat: useWorldUV(new THREE.MeshStandardMaterial({ ...textureSet('Grass004') }), 'xz', 4) },
  ];
  for (const kind of slabKinds) {
    const list = slabs.filter((s) => s.park === kind.park);
    if (!list.length) continue;
    const mesh = new THREE.InstancedMesh(slabGeo, kind.mat, list.length);
    list.forEach((s, idx) => {
      m.makeTranslation(s.x, 0, s.z);
      mesh.setMatrixAt(idx, m);
    });
    mesh.receiveShadow = true;
    objects.push(mesh);
  }

  // Roads: asphalt everywhere under the blocks.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(6000, 6000),
    useWorldUV(new THREE.MeshStandardMaterial({ ...textureSet('Asphalt033'), color: 0xd0d0d0 }), 'xz', 5)
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  objects.push(ground);

  for (const o of objects) scene.add(o);

  const grid = new SpatialGrid(24);
  for (const b of buildings) grid.insert(b);

  return {
    name: 'City',
    buildings,
    grid,
    // Road layout: road centre lines are at -half + k * period, for k = 0..blocks
    // (plus the outskirts ring beyond that), each `road` metres wide.
    roadGrid: { half, period, road, blocks, outskirts },
    dynamic: [], // moving solid boxes (cars), filled in by the traffic system
    // Spawn at the central intersection, looking down an avenue.
    spawn: new THREE.Vector3(0, 1, 0),
    spawnYaw: 0,
    raycast(origin, dir, maxDist, includeGround = false) {
      return raycastBoxes(origin, dir, maxDist, buildings, includeGround);
    },
    dispose() {
      for (const o of objects) {
        scene.remove(o);
        o.geometry.dispose();
        for (const mat of [].concat(o.material)) mat.dispose();
      }
    },
  };
}
