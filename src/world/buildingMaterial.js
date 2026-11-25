import * as THREE from 'three';

// MeshStandardMaterial patched to draw a procedural window grid from world
// position, so any building size gets correctly-scaled windows with no textures.
export function createBuildingMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0.05 });

  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vBWorldPos;
        varying vec3 vBWorldNormal;`
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        #ifdef USE_INSTANCING
          vBWorldPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
          vBWorldNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
        #else
          vBWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vBWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
        #endif`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vBWorldPos;
        varying vec3 vBWorldNormal;
        float bHash(vec2 p) {
          vec3 p3 = fract(vec3(p.xyx) * 0.1031);
          p3 += dot(p3, p3.yzx + 33.33);
          return fract((p3.x + p3.y) * p3.z);
        }`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec3 bN = abs(vBWorldNormal);
        float bWall = step(bN.y, 0.5);
        vec2 bG = bN.x > bN.z ? vBWorldPos.zy : vBWorldPos.xy;
        vec2 bCellSize = vec2(3.0, 3.5);
        vec2 bCell = fract(bG / bCellSize);
        float bWin = step(0.18, bCell.x) * step(bCell.x, 0.82) * step(0.28, bCell.y) * step(bCell.y, 0.86);
        bWin *= bWall * step(4.0, vBWorldPos.y);
        float bLit = step(0.72, bHash(floor(bG / bCellSize) + floor(vBWorldPos.xz * 0.01)));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.22, 0.30), bWin * 0.85);
        // Darker band at street level.
        diffuseColor.rgb *= mix(0.55, 1.0, step(4.0, vBWorldPos.y) + (1.0 - bWall));`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.18, bWin);`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += bWin * bLit * vec3(1.0, 0.82, 0.55) * 0.35;`
      );
  };

  return mat;
}
