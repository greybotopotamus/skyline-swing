import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/random.js';

// Procedural trees. Each species is two merged geometries (trunk + branches,
// and a crown of crossed leaf "cards" with alpha-tested leaf texture), drawn
// with one InstancedMesh each, so thousands of trees cost a handful of draw
// calls. Crown normals point away from the crown centre so the foliage shades
// like a rounded mass rather than flat cards. Leaves sway in the wind.
//
// Street trees line every sidewalk; parks get clusters of bigger trees.

// --- Textures (painted on canvases at startup) ---------------------------------

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function leafTexture() {
  const S = 512;
  const [c, x] = canvas(S, S);
  const rand = mulberry32(42);
  // Leaves scattered densely in the middle, sparser toward the edge, so each card
  // reads as a leafy clump with a ragged outline.
  for (let i = 0; i < 650; i++) {
    const a = rand() * Math.PI * 2;
    const r = Math.pow(rand(), 0.7) * S * 0.47;
    const px = S / 2 + Math.cos(a) * r;
    const py = S / 2 + Math.sin(a) * r;
    const len = 18 + rand() * 16;
    const shade = 0.55 + rand() * 0.45;
    const g = Math.floor(150 * shade + 40);
    x.save();
    x.translate(px, py);
    x.rotate(rand() * Math.PI * 2);
    const grad = x.createLinearGradient(-len / 2, 0, len / 2, 0);
    grad.addColorStop(0, `rgb(${Math.floor(g * 0.55)},${g},${Math.floor(g * 0.35)})`);
    grad.addColorStop(1, `rgb(${Math.floor(g * 0.75)},${Math.min(255, g + 30)},${Math.floor(g * 0.45)})`);
    x.fillStyle = grad;
    x.beginPath();
    x.ellipse(0, 0, len / 2, len / 5, 0, 0, Math.PI * 2);
    x.fill();
    x.strokeStyle = `rgba(30,50,20,0.45)`;
    x.lineWidth = 1;
    x.beginPath();
    x.moveTo(-len / 2, 0);
    x.lineTo(len / 2, 0);
    x.stroke();
    x.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// Bark colour + a normal map derived from the same height field.
function barkTextures() {
  const W = 256;
  const H = 512;
  const rand = mulberry32(7);
  const height = new Float32Array(W * H);
  // Vertical furrows with noise: sum of a few stretched sine/noise layers.
  const cols = Array.from({ length: 24 }, () => ({ x: rand() * W, w: 3 + rand() * 7, d: 0.4 + rand() * 0.6 }));
  for (let y = 0; y < H; y++) {
    for (let xx = 0; xx < W; xx++) {
      let h = 0.5;
      for (const c of cols) {
        const dx = Math.abs(((xx - c.x + W * 1.5 + Math.sin(y * 0.03 + c.x) * 6) % W) - W / 2);
        h -= Math.exp(-((dx - W / 2 + c.w) ** 2) / (c.w * c.w)) * c.d * 0.25;
      }
      h += (rand() - 0.5) * 0.12;
      height[y * W + xx] = h;
    }
  }
  const [cc, cx] = canvas(W, H);
  const [nc, nx] = canvas(W, H);
  const col = cx.createImageData(W, H);
  const nor = nx.createImageData(W, H);
  const at = (xx, y) => height[((y + H) % H) * W + ((xx + W) % W)];
  for (let y = 0; y < H; y++) {
    for (let xx = 0; xx < W; xx++) {
      const i = (y * W + xx) * 4;
      const h = at(xx, y);
      const v = Math.max(0, Math.min(1, h));
      col.data[i] = 70 + v * 70;
      col.data[i + 1] = 55 + v * 55;
      col.data[i + 2] = 42 + v * 40;
      col.data[i + 3] = 255;
      const dx = (at(xx + 1, y) - at(xx - 1, y)) * 4;
      const dy = (at(xx, y + 1) - at(xx, y - 1)) * 4;
      const len = Math.hypot(dx, dy, 1);
      nor.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      nor.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      nor.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      nor.data[i + 3] = 255;
    }
  }
  cx.putImageData(col, 0, 0);
  nx.putImageData(nor, 0, 0);
  const map = new THREE.CanvasTexture(cc);
  map.colorSpace = THREE.SRGBColorSpace;
  const normalMap = new THREE.CanvasTexture(nc);
  for (const t of [map, normalMap]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(2, 3);
  }
  return { map, normalMap };
}

// --- Geometry ------------------------------------------------------------------

const SPECIES = {
  // Rounded street tree (plane/linden-like).
  street: { trunkH: 3.6, trunkR: 0.17, crownY: 5.6, rx: 2.5, ry: 2.3, cards: 46, card: 2.3, branches: 4 },
  // Taller oval tree.
  oval: { trunkH: 4.2, trunkR: 0.19, crownY: 7.0, rx: 2.1, ry: 3.4, cards: 52, card: 2.4, branches: 4 },
  // Big spreading park tree (oak-like).
  oak: { trunkH: 3.4, trunkR: 0.34, crownY: 6.4, rx: 4.0, ry: 3.0, cards: 80, card: 2.9, branches: 6 },
};

function trunkGeometry(sp, rand) {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(sp.trunkR * 0.6, sp.trunkR, sp.crownY - 0.4, 8, 4).translate(0, (sp.crownY - 0.4) / 2, 0);
  // Slight lean/bend so trunks aren't perfectly straight.
  const pos = trunk.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    pos.setX(i, pos.getX(i) + Math.sin(y * 0.45) * 0.08);
  }
  // Root flare.
  parts.push(trunk, new THREE.CylinderGeometry(sp.trunkR, sp.trunkR * 1.6, 0.35, 8).translate(0, 0.17, 0));
  // Main branches reaching up into the crown.
  for (let b = 0; b < sp.branches; b++) {
    const a = (b / sp.branches) * Math.PI * 2 + rand() * 0.6;
    const len = sp.rx * (0.7 + rand() * 0.3);
    const br = new THREE.CylinderGeometry(sp.trunkR * 0.18, sp.trunkR * 0.42, len, 6).translate(0, len / 2, 0);
    br.rotateZ(-(0.7 + rand() * 0.35));
    br.rotateY(a);
    br.translate(0, sp.trunkH * (0.8 + rand() * 0.25), 0);
    parts.push(br);
  }
  const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)), false);
  g.computeVertexNormals();
  return g;
}

function crownGeometry(sp, rand) {
  const cards = [];
  const center = new THREE.Vector3(0, sp.crownY, 0);
  const tmp = new THREE.Vector3();
  for (let i = 0; i < sp.cards; i++) {
    // Point inside the crown ellipsoid, biased toward the surface (leaves live on the outside).
    const u = rand() * 2 - 1;
    const th = rand() * Math.PI * 2;
    const rr = Math.pow(rand(), 0.35);
    const s = Math.sqrt(1 - u * u);
    const p = new THREE.Vector3(Math.cos(th) * s * sp.rx * rr, u * sp.ry * rr, Math.sin(th) * s * sp.rx * rr).add(center);
    const size = sp.card * (0.75 + rand() * 0.5);
    const g = new THREE.PlaneGeometry(size, size);
    g.rotateX(rand() * Math.PI);
    g.rotateY(rand() * Math.PI);
    g.rotateZ(rand() * Math.PI);
    g.translate(p.x, p.y, p.z);
    // Normals: blend the card's own normal toward "away from crown centre".
    const nrm = g.attributes.normal;
    const ps = g.attributes.position;
    for (let k = 0; k < nrm.count; k++) {
      tmp.set(ps.getX(k), ps.getY(k), ps.getZ(k)).sub(center);
      tmp.y *= sp.rx / sp.ry;
      tmp.normalize();
      nrm.setXYZ(k, tmp.x, tmp.y, tmp.z);
    }
    cards.push(g.toNonIndexed());
  }
  return mergeGeometries(cards, false);
}

// Wind: sway foliage by height above the trunk, phase-shifted per tree.
function addWind(material, uniforms) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          #ifdef USE_INSTANCING
            vec3 ip = instanceMatrix[3].xyz;
          #else
            vec3 ip = vec3(0.0);
          #endif
          float h = max(0.0, position.y - 2.5);
          float sway = sin(uTime * 1.3 + ip.x * 0.21 + ip.z * 0.17) * 0.05
                     + sin(uTime * 2.9 + position.x * 1.7 + position.z * 1.3 + ip.x) * 0.03;
          transformed.x += sway * h * 0.35;
          transformed.z += sway * h * 0.22;
          transformed.y += sin(uTime * 3.7 + position.x * 2.3 + ip.z) * 0.02 * h * 0.2;
        }`
      );
  };
  material.customProgramCacheKey = () => 'tree-wind';
}

// --- Placement -----------------------------------------------------------------

export function createTrees(scene, world, { seed = 2024, outskirts = true } = {}) {
  const { half, period, road, blocks, outskirts: ring } = world.roadGrid;
  const rand = mulberry32(seed);
  const blockSize = period - road;
  const hr = road / 2;
  const c = (k) => -half + k * period;
  const placements = { street: [], oval: [], oak: [] };
  const parks = world.parks ?? [];
  const isPark = (i, j) => parks.some((p) => p.i === i && p.j === j);

  const r0 = outskirts ? -ring : 0;
  const r1 = outskirts ? blocks + ring : blocks;
  for (let i = r0; i < r1; i++) {
    for (let j = r0; j < r1; j++) {
      const core = i >= 0 && i < blocks && j >= 0 && j < blocks;
      const bx = c(i) + hr;
      const bz = c(j) + hr;
      // Street trees along each side, 0.9 m from the kerb, clear of the corners.
      const spots = [7.5, 15, 29, 36.5];
      const density = core ? 1 : 0.55;
      for (const side of [0, 1, 2, 3]) {
        for (const s of spots) {
          if (rand() > density) continue;
          const t = s + (rand() - 0.5) * 1.5;
          let x;
          let z;
          if (side === 0) { x = bx + t; z = bz + 0.9; }
          else if (side === 1) { x = bx + blockSize - 0.9; z = bz + t; }
          else if (side === 2) { x = bx + t; z = bz + blockSize - 0.9; }
          else { x = bx + 0.9; z = bz + t; }
          placements[rand() < 0.7 ? 'street' : 'oval'].push({ x, z, s: 0.85 + rand() * 0.3, core });
        }
      }
      // Parks: a loose grove of big trees.
      if (isPark(i, j)) {
        const n = 9 + Math.floor(rand() * 6);
        for (let k = 0; k < n; k++) {
          const x = bx + 6 + rand() * (blockSize - 12);
          const z = bz + 6 + rand() * (blockSize - 12);
          placements[rand() < 0.65 ? 'oak' : 'oval'].push({ x, z, s: 0.8 + rand() * 0.45, core });
        }
      }
    }
  }

  const bark = barkTextures();
  const leaf = leafTexture();
  const uniforms = { uTime: { value: 0 } };
  const barkMat = new THREE.MeshStandardMaterial({ ...bark, roughness: 0.95 });
  // alphaToCoverage turns the hard alpha-test edge into a smooth one using MSAA.
  const leafMat = new THREE.MeshStandardMaterial({ map: leaf, alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.8, metalness: 0 });
  addWind(leafMat, uniforms);
  const leafDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: leaf, alphaTest: 0.5 });

  const greens = [0x5f7a3a, 0x4f6c33, 0x6b8442, 0x4a6838, 0x748b45, 0x5c7448, 0x80894a, 0x8a7d45];
  const meshes = [];
  const foliage = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const col = new THREE.Color();

  for (const [name, list] of Object.entries(placements)) {
    if (!list.length) continue;
    const sp = SPECIES[name];
    const trunk = new THREE.InstancedMesh(trunkGeometry(sp, rand), barkMat, list.length);
    const crown = new THREE.InstancedMesh(crownGeometry(sp, rand), leafMat, list.length);
    crown.customDepthMaterial = leafDepth;
    list.forEach((p, idx) => {
      q.setFromAxisAngle(up, rand() * Math.PI * 2);
      m.compose(new THREE.Vector3(p.x, 0, p.z), q, new THREE.Vector3(p.s, p.s * (0.9 + rand() * 0.2), p.s));
      trunk.setMatrixAt(idx, m);
      crown.setMatrixAt(idx, m);
      crown.setColorAt(idx, col.setHex(greens[Math.floor(rand() * greens.length)]).multiplyScalar(0.95));
      // Trunks in the playable city are solid.
      if (p.core) {
        const rr = sp.trunkR * p.s + 0.05;
        world.grid.insert({ min: new THREE.Vector3(p.x - rr, 0, p.z - rr), max: new THREE.Vector3(p.x + rr, sp.crownY * 0.6 * p.s, p.z + rr) });
      }
    });
    for (const mesh of [trunk, crown]) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
      meshes.push(mesh);
    }
    foliage.push(crown);
  }

  const count = Object.values(placements).reduce((s, l) => s + l.length, 0);
  return {
    count,
    foliage, // hidden during the AO normal pass (alpha cards would read as solid quads)
    update(time) {
      uniforms.uTime.value = time;
    },
  };
}
