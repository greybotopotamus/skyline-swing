import * as THREE from 'three';
import { textureSet, useWorldUV } from './textures.js';

// Building styles. tile = metres covered by one repeat of the texture
// (estimated from the floors/bays visible in each photo, ~3.5 m per floor).
export const FACADES = [
  { id: 'Facade001', name: 'glass', tileX: 34, tileY: 34, metalness: 0.35, brightness: 1.4 },
  { id: 'Facade006', name: 'grid', tileX: 28, tileY: 28 },
  { id: 'Facade018A', name: 'brick', tileX: 17.5, tileY: 17.5 },
  { id: 'Facade019A', name: 'concrete', tileX: 17.5, tileY: 17.5 },
];

// Materials for a box building, indexed like BoxGeometry's groups:
// [+x, -x, +y (roof), -y (underside), +z, -z].
export function createBuildingMaterials(facade, roofMaterial) {
  const wall = useWorldUV(
    new THREE.MeshStandardMaterial({
      ...textureSet(facade.id, { metalness: true }),
      metalness: facade.metalness ?? 0.6, // scaled by the metalness map: glass reflects, frames don't
      roughness: 1,
      envMapIntensity: 1.3,
    }),
    'facade',
    facade.tileX,
    facade.tileY
  );
  return [wall, wall, roofMaterial, roofMaterial, wall, wall];
}

export function createRoofMaterial() {
  return useWorldUV(new THREE.MeshStandardMaterial({ ...textureSet('Concrete034'), color: 0xb8b4ac }), 'xz', 8, 4); // texture is 2:1
}
