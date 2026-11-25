import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Procedural vehicles. Each type is a set of merged geometries, one per material
// "part", so every car of a type renders with one draw call per part.
// Local space: front of the vehicle is +Z, ground at y = 0, centred on x and z.
export const PARTS = ['paint', 'glass', 'rubber', 'trim', 'head', 'tail'];

const ni = (g) => (g.index ? g.toNonIndexed() : g);

// Extrude a side silhouette ([z, y] points) across the vehicle's width.
function profile(points, width, bevel = 0.06) {
  const shape = new THREE.Shape(points.map(([z, y]) => new THREE.Vector2(z, y)));
  const depth = width - 2 * bevel;
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 4,
  });
  g.translate(0, 0, -depth / 2);
  g.rotateY(-Math.PI / 2); // silhouette length -> +Z, extrusion -> X
  return g;
}

function box(w, h, d, x, y, z) {
  return ni(new THREE.BoxGeometry(w, h, d).translate(x, y, z));
}

function wheels(r, track, zs, width = 0.24) {
  const tyres = [];
  const rims = [];
  for (const z of zs) {
    for (const sx of [-1, 1]) {
      tyres.push(ni(new THREE.CylinderGeometry(r, r, width, 18).rotateZ(Math.PI / 2).translate(sx * track, r, z)));
      rims.push(ni(new THREE.CylinderGeometry(r * 0.58, r * 0.58, width + 0.02, 12).rotateZ(Math.PI / 2).translate(sx * track, r, z)));
    }
  }
  return { tyres, rims };
}

function lights(w, y, zFront, zRear, size = [0.34, 0.12]) {
  const head = [];
  const tail = [];
  for (const sx of [-1, 1]) {
    head.push(box(size[0], size[1], 0.06, sx * (w / 2 - 0.3), y, zFront));
    tail.push(box(size[0] + 0.06, size[1], 0.06, sx * (w / 2 - 0.28), y + 0.05, zRear));
  }
  return { head, tail };
}

function car({ L, W, body, cabin, roofZ, roofLen, roofY, wheelR, wheelZ, lightY, extraHead = [] }) {
  const hl = L / 2;
  const w = wheels(wheelR, W / 2 - 0.14, wheelZ);
  const l = lights(W, lightY, hl + 0.03, -hl - 0.04);
  return {
    paint: [profile(body, W), box(W - 0.22, 0.06, roofLen, 0, roofY, roofZ)],
    glass: [profile(cabin, W - 0.16, 0.04)],
    rubber: [...w.tyres, box(W - 0.1, 0.16, 0.12, 0, 0.42, hl), box(W - 0.1, 0.16, 0.12, 0, 0.42, -hl)],
    trim: w.rims,
    head: [...l.head, ...extraHead],
    tail: l.tail,
  };
}

const sedan = () =>
  car({
    L: 4.6, W: 1.85,
    body: [[-2.3, 0.32], [2.3, 0.32], [2.32, 0.62], [2.1, 0.82], [0.95, 0.95], [-1.9, 0.98], [-2.3, 0.86], [-2.34, 0.5]],
    cabin: [[0.95, 0.92], [0.15, 1.4], [-1.05, 1.4], [-1.86, 0.95]],
    roofZ: -0.45, roofLen: 1.15, roofY: 1.42,
    wheelR: 0.34, wheelZ: [1.42, -1.42], lightY: 0.72,
  });

export const CAR_TYPES = {
  sedan: {
    weight: 0.4, len: 4.6, wid: 1.9, hgt: 1.45,
    colors: [0xe8e8e8, 0x1b1c1f, 0x9ea3a8, 0x5b6066, 0x1f3556, 0x8b1a1a, 0x4a1f24, 0xc9bfa8, 0x24402f],
    build: sedan,
  },
  hatch: {
    weight: 0.25, len: 4.0, wid: 1.8, hgt: 1.48,
    colors: [0xf0f0ee, 0xb52a1e, 0x2d5c8a, 0x9ea3a8, 0x23262a, 0xd9c36a, 0x3f6e4a],
    build: () =>
      car({
        L: 4.0, W: 1.8,
        body: [[-2.0, 0.32], [2.0, 0.32], [2.02, 0.62], [1.8, 0.82], [0.8, 0.95], [-1.85, 0.98], [-2.0, 0.82], [-2.04, 0.5]],
        cabin: [[0.8, 0.92], [0.05, 1.42], [-1.6, 1.42], [-1.92, 0.96]],
        roofZ: -0.78, roofLen: 1.62, roofY: 1.44,
        wheelR: 0.33, wheelZ: [1.25, -1.25], lightY: 0.74,
      }),
  },
  suv: {
    weight: 0.22, len: 4.8, wid: 2.0, hgt: 1.85,
    colors: [0x1b1c1f, 0xe8e8e8, 0x5b6066, 0x2a3442, 0x6b5a45, 0x7a1d1d, 0x9ea3a8],
    build: () =>
      car({
        L: 4.8, W: 2.0,
        body: [[-2.4, 0.45], [2.4, 0.45], [2.42, 0.88], [2.25, 1.06], [1.1, 1.15], [-2.35, 1.18], [-2.42, 0.62]],
        cabin: [[1.1, 1.12], [0.5, 1.78], [-2.1, 1.78], [-2.3, 1.15]],
        roofZ: -0.8, roofLen: 2.6, roofY: 1.8,
        wheelR: 0.4, wheelZ: [1.5, -1.5], lightY: 0.92,
      }),
  },
  taxi: {
    weight: 0.08, len: 4.6, wid: 1.9, hgt: 1.65,
    colors: [0xf2b705],
    build: () => {
      const p = sedan();
      p.head.push(box(0.6, 0.2, 0.26, 0, 1.55, -0.4)); // roof sign
      return p;
    },
  },
  bus: {
    weight: 0.05, len: 11, wid: 2.55, hgt: 3.1,
    colors: [0xb3261e, 0x1f4f8a, 0xe8e4d8, 0x2f6b3a],
    build: () => {
      const hl = 5.5;
      const W = 2.55;
      const w = wheels(0.5, W / 2 - 0.2, [3.6, -3.4], 0.3);
      const l = lights(W, 0.75, hl + 0.06, -hl - 0.07, [0.4, 0.18]);
      return {
        paint: [profile([[-hl, 0.35], [hl, 0.35], [hl, 2.95], [hl - 0.25, 3.1], [-hl + 0.2, 3.1], [-hl, 2.95]], W, 0.1)],
        glass: [
          box(W + 0.04, 0.95, 2 * hl - 1.6, 0, 2.05, -0.3), // side window band
          box(W - 0.3, 1.5, 0.06, 0, 1.95, hl + 0.06), // windscreen
          box(W - 0.5, 0.8, 0.06, 0, 2.3, -hl - 0.06), // rear window
        ],
        rubber: [...w.tyres, box(W, 0.25, 0.15, 0, 0.45, hl + 0.05), box(W, 0.25, 0.15, 0, 0.45, -hl - 0.05)],
        trim: w.rims,
        head: [...l.head, box(1.6, 0.25, 0.05, 0, 2.85, hl + 0.07)], // destination sign
        tail: l.tail,
      };
    },
  },
};

// Build merged geometry per part for a type.
export function buildTypeGeometry(type) {
  const parts = CAR_TYPES[type].build();
  const out = {};
  for (const p of PARTS) {
    const list = parts[p];
    if (list && list.length) {
      const merged = mergeGeometries(list.map(ni), false);
      merged.computeBoundingSphere();
      out[p] = merged;
    }
  }
  return out;
}

export function createCarMaterials() {
  return {
    paint: new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0.45, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x12171d, metalness: 0.9, roughness: 0.06 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x18191b, roughness: 0.9 }),
    trim: new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 0.9, roughness: 0.25 }),
    head: new THREE.MeshBasicMaterial({ color: 0xfff4dc }),
    tail: new THREE.MeshBasicMaterial({ color: 0xffffff }), // tinted per car (brake lights)
  };
}
