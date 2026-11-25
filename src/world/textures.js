import * as THREE from 'three';

// PBR texture sets live in public/textures/<SetId>/{color,normalgl,roughness,metalness}.jpg.
// All sets are CC0 from ambientCG (https://ambientcg.com). See public/textures/CREDITS.md.
const loader = new THREE.TextureLoader();
const BASE = `${import.meta.env.BASE_URL}textures/`;
let anisotropy = 8;

export function setMaxAnisotropy(renderer) {
  anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
}

function load(path, srgb) {
  const t = loader.load(path);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = anisotropy;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Returns material params for a set. `maps` picks which maps to use (all by default).
export function textureSet(id, { maps = ['color', 'normal', 'roughness'], metalness = false } = {}) {
  const p = {};
  const dir = `${BASE}${id}/`;
  if (maps.includes('color')) p.map = load(`${dir}color.jpg`, true);
  if (maps.includes('normal')) p.normalMap = load(`${dir}normalgl.jpg`, false);
  if (maps.includes('roughness')) p.roughnessMap = load(`${dir}roughness.jpg`, false);
  if (metalness) p.metalnessMap = load(`${dir}metalness.jpg`, false);
  return p;
}

// Patch a MeshStandardMaterial so its texture UVs come from world position
// instead of mesh UVs. That keeps textures at real-world scale on any box size.
//   mode 'xz'     : horizontal surfaces (ground, roofs), uv = xz / tile
//   mode 'facade' : vertical walls, uv = (along-wall, height) / (tileX, tileY)
export function useWorldUV(material, mode, tileX, tileY = tileX) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTile = { value: new THREE.Vector2(tileX, tileY) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform vec2 uTile;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        {
          #ifdef USE_INSTANCING
            vec4 wp = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
            vec3 wn = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
          #else
            vec4 wp = modelMatrix * vec4(transformed, 1.0);
            vec3 wn = normalize(mat3(modelMatrix) * objectNormal);
          #endif
          vec2 wuv;
          ${
            mode === 'xz'
              ? 'wuv = vec2(wp.x, -wp.z);'
              : `// Pick the along-wall axis so the texture isn't mirrored on any side.
                 if (abs(wn.x) > abs(wn.z)) wuv = vec2(-wp.z * sign(wn.x), wp.y);
                 else wuv = vec2(wp.x * sign(wn.z), wp.y);`
          }
          wuv /= uTile;
          #ifdef USE_MAP
            vMapUv = wuv;
          #endif
          #ifdef USE_NORMALMAP
            vNormalMapUv = wuv;
          #endif
          #ifdef USE_ROUGHNESSMAP
            vRoughnessMapUv = wuv;
          #endif
          #ifdef USE_METALNESSMAP
            vMetalnessMapUv = wuv;
          #endif
        }`
      );
  };
  // Make sure differently-tiled materials don't share a compiled program.
  material.customProgramCacheKey = () => `worlduv-${mode}-${tileX}-${tileY}`;
  return material;
}
