import * as THREE from 'three';

// Gradient sky dome + sun/ambient lighting. The sun's shadow camera follows the
// player so we get crisp shadows nearby without a huge shadow map.
export function createSky(scene, renderer) {
  const top = new THREE.Color(0x3d7cc9);
  const horizon = new THREE.Color(0xcfe0ef);
  const groundTone = new THREE.Color(0x4d4a46);

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(2500, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { top: { value: top }, horizon: { value: horizon }, groundTone: { value: groundTone } },
      vertexShader: `varying vec3 vDir;
        void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 groundTone; varying vec3 vDir;
        void main() {
          float h = clamp(vDir.y, 0.0, 1.0);
          vec3 c = mix(horizon, top, pow(h, 0.55));
          c = mix(c, groundTone, smoothstep(0.0, -0.15, vDir.y)); // below the horizon (seen in reflections)
          gl_FragColor = vec4(c, 1.0);
        }`,
    })
  );
  dome.renderOrder = -1;
  scene.add(dome);

  scene.fog = new THREE.Fog(horizon, 180, 900);

  // Image-based lighting: the sky becomes an environment map, so glass and
  // other glossy surfaces reflect it and shadows aren't flat.
  if (renderer) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(dome.geometry, dome.material));
    scene.environment = pmrem.fromScene(envScene, 0, 1, 5000).texture;
    scene.environmentIntensity = 0.8;
    pmrem.dispose();
  }

  const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x4a4438, 0.5);
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
