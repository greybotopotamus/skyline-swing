import * as THREE from 'three';
import { mulberry32 } from '../core/random.js';
import { SpatialGrid, raycastBoxes } from '../physics/collision.js';
import { createBuildingMaterial } from './buildingMaterial.js';

const PALETTE = [0xb8b2a7, 0x9aa3ab, 0xc9c1b3, 0x7d8790, 0xa89f94, 0x8e9aa6, 0xd6d0c4, 0x6f7780, 0xb39a85];

// Procedural city: a grid of blocks separated by roads, each block split into
// 1–4 lots. Buildings get taller toward the centre. Every building is an AABB
// collider and a valid grapple target.
//
// Environments share this return shape so new ones (canyon, docks, forest...)
// can be dropped in: { buildings, grid, spawn, spawnYaw, raycast(), dispose() }.
export function createCity(scene, { seed = 1337, blocks = 10, blockSize = 44, road = 14 } = {}) {
  const rand = mulberry32(seed);
  const period = blockSize + road;
  const half = (blocks * period) / 2;
  const buildings = [];
  const slabs = [];

  const addBuilding = (x0, z0, x1, z1, y0, y1, color) => {
    buildings.push({ min: new THREE.Vector3(x0, y0, z0), max: new THREE.Vector3(x1, y1, z1), color });
  };

  for (let i = 0; i < blocks; i++) {
    for (let j = 0; j < blocks; j++) {
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
        const color = PALETTE[Math.floor(rand() * PALETTE.length)];
        addBuilding(x0, z0, x1, z1, 0, h, color);

        // Setback tier on some tall towers.
        if (h > 60 && rand() < 0.5) {
          const shrinkX = (x1 - x0) * (0.15 + rand() * 0.15);
          const shrinkZ = (z1 - z0) * (0.15 + rand() * 0.15);
          const tier = Math.round((h * (0.25 + rand() * 0.3)) / 3.5) * 3.5;
          addBuilding(x0 + shrinkX, z0 + shrinkZ, x1 - shrinkX, z1 - shrinkZ, h, h + tier, color);
        }
      }
    }
  }

  // --- Meshes ---------------------------------------------------------------
  const objects = [];

  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  boxGeo.translate(0, 0.5, 0); // origin at the base
  const bMesh = new THREE.InstancedMesh(boxGeo, createBuildingMaterial(), buildings.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const c = new THREE.Color();
  buildings.forEach((b, idx) => {
    const size = b.max.clone().sub(b.min);
    m.compose(new THREE.Vector3((b.min.x + b.max.x) / 2, b.min.y, (b.min.z + b.max.z) / 2), q, size);
    bMesh.setMatrixAt(idx, m);
    bMesh.setColorAt(idx, c.setHex(b.color));
  });
  bMesh.castShadow = true;
  bMesh.receiveShadow = true;
  objects.push(bMesh);

  // Sidewalks / parks (visual only — thin enough to walk over).
  const slabGeo = new THREE.BoxGeometry(blockSize, 0.12, blockSize);
  slabGeo.translate(0, 0.06, 0);
  const slabMesh = new THREE.InstancedMesh(slabGeo, new THREE.MeshStandardMaterial({ roughness: 0.95 }), slabs.length);
  slabs.forEach((s, idx) => {
    m.makeTranslation(s.x, 0, s.z);
    slabMesh.setMatrixAt(idx, m);
    slabMesh.setColorAt(idx, c.setHex(s.park ? 0x4f7a3a : 0x8d8d88));
  });
  slabMesh.receiveShadow = true;
  objects.push(slabMesh);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(6000, 6000),
    new THREE.MeshStandardMaterial({ color: 0x55585e, roughness: 1 })
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
        o.material.dispose();
      }
    },
  };
}
