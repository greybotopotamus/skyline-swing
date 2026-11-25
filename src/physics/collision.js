// Axis-aligned box helpers. A "box" is { min: Vector3, max: Vector3 }.

// Uniform grid over the XZ plane for fast "which boxes are near me" queries.
export class SpatialGrid {
  constructor(cellSize = 24) {
    this.cell = cellSize;
    this.cells = new Map();
    this.stamp = 0;
  }

  _key(ix, iz) {
    return `${ix},${iz}`;
  }

  insert(box) {
    box._stamp = 0;
    const c = this.cell;
    for (let ix = Math.floor(box.min.x / c); ix <= Math.floor(box.max.x / c); ix++) {
      for (let iz = Math.floor(box.min.z / c); iz <= Math.floor(box.max.z / c); iz++) {
        const k = this._key(ix, iz);
        let list = this.cells.get(k);
        if (!list) this.cells.set(k, (list = []));
        list.push(box);
      }
    }
  }

  query(minX, minZ, maxX, maxZ, out = []) {
    out.length = 0;
    const stamp = ++this.stamp;
    const c = this.cell;
    for (let ix = Math.floor(minX / c); ix <= Math.floor(maxX / c); ix++) {
      for (let iz = Math.floor(minZ / c); iz <= Math.floor(maxZ / c); iz++) {
        const list = this.cells.get(this._key(ix, iz));
        if (!list) continue;
        for (const b of list) {
          if (b._stamp !== stamp) {
            b._stamp = stamp;
            out.push(b);
          }
        }
      }
    }
    return out;
  }
}

const AXES = ['x', 'y', 'z'];

// Ray vs list of boxes (slab test). Returns the nearest hit or null.
// Rays starting inside a box ignore that box.
export function raycastBoxes(origin, dir, maxDist, boxes, includeGround = false) {
  let best = maxDist;
  let hit = null;

  for (const box of boxes) {
    let tmin = 0;
    let tmax = best;
    let axis = -1;
    let ok = true;
    for (let i = 0; i < 3; i++) {
      const a = AXES[i];
      const o = origin[a];
      const d = dir[a];
      if (Math.abs(d) < 1e-9) {
        if (o < box.min[a] || o > box.max[a]) { ok = false; break; }
        continue;
      }
      const inv = 1 / d;
      let t1 = (box.min[a] - o) * inv;
      let t2 = (box.max[a] - o) * inv;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      if (t1 > tmin) { tmin = t1; axis = i; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) { ok = false; break; }
    }
    if (!ok || axis < 0 || tmin <= 0 || tmin >= best) continue;
    best = tmin;
    const normal = { x: 0, y: 0, z: 0 };
    normal[AXES[axis]] = dir[AXES[axis]] > 0 ? -1 : 1;
    hit = { distance: tmin, box, normal };
  }

  if (includeGround && dir.y < -1e-6) {
    const t = -origin.y / dir.y;
    if (t > 0 && t < best) {
      best = t;
      hit = { distance: t, box: null, normal: { x: 0, y: 1, z: 0 } };
    }
  }

  if (hit) {
    hit.point = origin.clone().addScaledVector(dir, hit.distance);
  }
  return hit;
}
