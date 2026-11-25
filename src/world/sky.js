import * as THREE from 'three';

// Gradient sky dome + sun/ambient lighting. The sun's shadow camera follows the
// player so we get crisp shadows nearby without a huge shadow map.
export function createSky(scene) {
  const top = new THREE.Color(0x3d7cc9);
  const horizon = new THREE.Color(0xcfe0ef);

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(2500, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { top: { value: top }, horizon: { value: horizon } },
      vertexShader: `varying vec3 vDir;
        void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 top; uniform vec3 horizon; varying vec3 vDir;
        void main() { float h = clamp(vDir.y, 0.0, 1.0); gl_FragColor = vec4(mix(horizon, top, pow(h, 0.55)), 1.0); }`,
    })
  );
  dome.renderOrder = -1;
  scene.add(dome);

  scene.fog = new THREE.Fog(horizon, 180, 900);

  const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x4a4438, 1.3);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xffe6c4, 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const s = sun.shadow.camera;
  s.left = -90; s.right = 90; s.top = 90; s.bottom = -90; s.near = 1; s.far = 600;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.05;
  scene.add(sun, sun.target);

  const sunOffset = new THREE.Vector3(160, 260, 100);

  return {
    update(focus, cameraPos) {
      dome.position.copy(cameraPos);
      sun.position.copy(focus).add(sunOffset);
      sun.target.position.copy(focus);
    },
  };
}
