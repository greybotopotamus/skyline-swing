import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/random.js';
import { textureSet, useWorldUV } from './textures.js';

// Rooftop clutter (parapets, AC units, water towers) and street lamps.
// Everything is instanced. In the playable city, rooftop props are solid.

const ni = (g) => (g.index ? g.toNonIndexed() : g);

export function createRooftops(scene, world, { seed = 77 } = {}) {
  const rand = mulberry32(seed);
  const parapets = [];
  const units = [];
  const towers = [];
  const solid = (min, max) => world.grid.insert({ min, max });

  const all = world.buildings.map((b) => ({ b, core: true })).concat((world.scenery ?? []).map((b) => ({ b, core: false })));
  for (const { b, core } of all) {
    const w = b.max.x - b.min.x;
    const d = b.max.z - b.min.z;
    const y = b.max.y;
    // Glass towers (style 0) get a slim parapet; others a proper wall.
    const ph = b.style === 0 ? 0.5 : 0.9 + rand() * 0.4;
    const t = 0.3;
    const walls = [
      [b.min.x, b.min.z, b.max.x, b.min.z + t],
      [b.min.x, b.max.z - t, b.max.x, b.max.z],
      [b.min.x, b.min.z + t, b.min.x + t, b.max.z - t],
      [b.max.x - t, b.min.z + t, b.max.x, b.max.z - t],
    ];
    for (const [x0, z0, x1, z1] of walls) {
      parapets.push([x0, y, z0, x1, y + ph, z1]);
      if (core) solid(new THREE.Vector3(x0, y, z0), new THREE.Vector3(x1, y + ph, z1));
    }

    if (w < 8 || d < 8) continue;
    // AC / machinery boxes.
    const n = Math.floor(rand() * 4);
    for (let k = 0; k < n; k++) {
      const sx = 1.4 + rand() * 2.2;
      const sz = 1.4 + rand() * 2.2;
      const sy = 1.0 + rand() * 1.4;
      const x = b.min.x + 2 + rand() * Math.max(0.1, w - 4 - sx);
      const z = b.min.z + 2 + rand() * Math.max(0.1, d - 4 - sz);
      units.push([x, y, z, x + sx, y + sy, z + sz]);
      if (core) solid(new THREE.Vector3(x, y, z), new THREE.Vector3(x + sx, y + sy, z + sz));
    }
    // Classic wooden water tower on some mid-rise roofs.
    if (b.style !== 0 && y > 20 && y < 90 && w > 12 && d > 12 && rand() < 0.22) {
      const x = b.min.x + 4 + rand() * (w - 8);
      const z = b.min.z + 4 + rand() * (d - 8);
      towers.push([x, y, z, 0.8 + rand() * 0.4]);
      if (core) solid(new THREE.Vector3(x - 1.7, y, z - 1.7), new THREE.Vector3(x + 1.7, y + 6.5, z + 1.7));
    }
  }

  const m = new THREE.Matrix4();
  const boxGeo = new THREE.BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0.5);
  const fillBoxes = (list, material) => {
    const mesh = new THREE.InstancedMesh(boxGeo, material, list.length);
    list.forEach(([x0, y0, z0, x1, y1, z1], i) => {
      m.makeScale(x1 - x0, y1 - y0, z1 - z0).setPosition(x0, y0, z0);
      mesh.setMatrixAt(i, m);
    });
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  };
  const concrete = useWorldUV(new THREE.MeshStandardMaterial({ ...textureSet('Concrete034'), color: 0xc4beb4 }), 'facade', 4, 2);
  fillBoxes(parapets, concrete);
  fillBoxes(units, new THREE.MeshStandardMaterial({ color: 0xa3a8ad, metalness: 0.6, roughness: 0.45 }));

  if (towers.length) {
    // Tank on four legs with a conical roof.
    const parts = [
      new THREE.CylinderGeometry(1.6, 1.6, 3.2, 16).translate(0, 4.1, 0),
      new THREE.ConeGeometry(1.75, 1.2, 16).translate(0, 6.3, 0),
    ];
    for (const [lx, lz] of [[-1.1, -1.1], [1.1, -1.1], [-1.1, 1.1], [1.1, 1.1]]) {
      parts.push(new THREE.CylinderGeometry(0.09, 0.09, 2.5, 6).translate(lx, 1.25, lz));
    }
    // Hoops around the tank.
    for (const hy of [3.0, 4.1, 5.2]) parts.push(new THREE.TorusGeometry(1.62, 0.04, 4, 20).rotateX(Math.PI / 2).translate(0, hy, 0));
    const geo = mergeGeometries(parts.map(ni), false);
    const wood = new THREE.MeshStandardMaterial({ color: 0x6e4f36, roughness: 0.9 });
    const mesh = new THREE.InstancedMesh(geo, wood, towers.length);
    towers.forEach(([x, y, z, s], i) => {
      m.makeScale(s, s, s).setPosition(x, y, z);
      mesh.setMatrixAt(i, m);
    });
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
  }
  return { parapets: parapets.length, units: units.length, towers: towers.length };
}

export function createStreetLamps(scene, world, { outskirts = true } = {}) {
  const { half, period, road, blocks, outskirts: ring } = world.roadGrid;
  const blockSize = period - road;
  const hr = road / 2;
  const c = (k) => -half + k * period;

  // Lamp built facing +X (arm reaches out over the road in +X).
  const pole = mergeGeometries([
    new THREE.CylinderGeometry(0.07, 0.11, 7, 8).translate(0, 3.5, 0),
    new THREE.CylinderGeometry(0.16, 0.2, 0.5, 8).translate(0, 0.25, 0),
    new THREE.CylinderGeometry(0.045, 0.05, 1.9, 6).rotateZ(Math.PI / 2 - 0.12).translate(0.9, 7.05, 0),
    new THREE.BoxGeometry(0.75, 0.16, 0.32).translate(1.85, 7.12, 0),
  ].map(ni), false);
  const lens = new THREE.BoxGeometry(0.6, 0.03, 0.24).translate(1.85, 7.03, 0);

  const spots = [];
  const r0 = outskirts ? -ring : 0;
  const r1 = outskirts ? blocks + ring : blocks;
  for (let i = r0; i < r1; i++) {
    for (let j = r0; j < r1; j++) {
      const bx = c(i) + hr;
      const bz = c(j) + hr;
      // One lamp mid-way along each side, at the kerb, arm over the road.
      spots.push([bx + 22, bz + 0.45, -Math.PI / 2]); // -z side, arm points -z
      spots.push([bx + blockSize - 0.45, bz + 22, 0]); // +x side, arm points +x
      spots.push([bx + 22, bz + blockSize - 0.45, Math.PI / 2]); // +z side
      spots.push([bx + 0.45, bz + 22, Math.PI]); // -x side
    }
  }
  const metal = new THREE.MeshStandardMaterial({ color: 0x33373c, metalness: 0.7, roughness: 0.45 });
  const poleMesh = new THREE.InstancedMesh(pole, metal, spots.length);
  const lensMesh = new THREE.InstancedMesh(lens, new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.92, 0.75) }), spots.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const one = new THREE.Vector3(1, 1, 1);
  spots.forEach(([x, z, rot], i) => {
    // rotation.y = -rot turns the +X arm toward the road on that side.
    q.setFromAxisAngle(up, -rot);
    m.compose(new THREE.Vector3(x, 0, z), q, one);
    poleMesh.setMatrixAt(i, m);
    lensMesh.setMatrixAt(i, m);
  });
  poleMesh.castShadow = true;
  scene.add(poleMesh, lensMesh);
  return spots.length;
}
