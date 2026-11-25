import * as THREE from 'three';

// Painted road markings for the street grid: double yellow centre lines, dashed
// white lane dividers, zebra crosswalks and stop lines at every intersection.
// Everything is one instanced flat quad per colour, so thousands of markings
// cost two draw calls.
//
// Lanes: each road is 14 m wide with two lanes per direction (right-hand traffic).
export function createRoadMarkings(scene, { half, period, road, blocks, outskirts }) {
  const white = [];
  const yellow = [];
  const c = (k) => -half + k * period;
  const hr = road / 2;

  // Push a rectangle given in road-local coords: `along` the road axis and
  // `lat` (lateral offset from the centre line).
  const rect = (list, axis, line, along0, along1, lat0, lat1) => {
    const a = (along0 + along1) / 2;
    const l = (lat0 + lat1) / 2;
    const la = Math.abs(along1 - along0);
    const ll = Math.abs(lat1 - lat0);
    if (axis === 'x') list.push([a, c(line) + l, la, ll]);
    else list.push([c(line) + l, a, ll, la]);
  };

  const k0 = -outskirts;
  const k1 = blocks + outskirts;
  for (const axis of ['x', 'z']) {
    for (let line = k0; line <= k1; line++) {
      for (let k = k0; k < k1; k++) {
        const s0 = c(k) + hr; // segment start (edge of intersection k)
        const s1 = c(k + 1) - hr; // segment end (edge of intersection k+1)

        // Crosswalks: 3 m deep, stripes across the whole road.
        for (const [a0, a1] of [[s0 + 0.6, s0 + 3.6], [s1 - 3.6, s1 - 0.6]]) {
          for (let lat = -hr + 0.7; lat < hr - 0.4; lat += 1.2) rect(white, axis, line, a0, a1, lat, lat + 0.6);
        }

        // Stop lines on the inbound half of each approach.
        // Traffic heading toward -axis drives on the negative-lateral side for x roads
        // and the positive side for z roads (right-hand traffic).
        const inboundAtStart = axis === 'x' ? [-hr + 0.3, -0.3] : [0.3, hr - 0.3];
        const inboundAtEnd = axis === 'x' ? [0.3, hr - 0.3] : [-hr + 0.3, -0.3];
        rect(white, axis, line, s0 + 4.0, s0 + 4.45, ...inboundAtStart);
        rect(white, axis, line, s1 - 4.45, s1 - 4.0, ...inboundAtEnd);

        // Double yellow centre line.
        rect(yellow, axis, line, s0 + 4.6, s1 - 4.6, -0.22, -0.1);
        rect(yellow, axis, line, s0 + 4.6, s1 - 4.6, 0.1, 0.22);

        // Dashed lane dividers between the two lanes of each direction.
        for (let a = s0 + 6; a + 3 < s1 - 5; a += 9) {
          rect(white, axis, line, a, a + 3, -3.56, -3.44);
          rect(white, axis, line, a, a + 3, 3.44, 3.56);
        }
      }
    }
  }

  const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const make = (list, color) => {
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.75,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    const m = new THREE.Matrix4();
    list.forEach(([x, z, sx, sz], i) => {
      m.makeScale(sx, 1, sz).setPosition(x, 0.015, z);
      mesh.setMatrixAt(i, m);
    });
    mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  };

  return [make(white, 0xd9d9d4), make(yellow, 0xd8a52a)];
}
