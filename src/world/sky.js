import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

// Sky: a real 360° HDR photo (Kloofendal 48d Partly Cloudy Pure Sky, Poly Haven, CC0)
// used as the visible background and as image-based lighting. The sun light is aimed
// at the sun in the photo, and distance fog uses the photo's horizon colour so far
// buildings fade into the sky. A gradient dome shows until the HDR has loaded.
const SKY_URL = `${import.meta.env.BASE_URL}sky/kloofendal_48d_partly_cloudy_puresky_2k.hdr`;
const SUN_DISTANCE = 300;

export function createSky(scene, renderer) {
  const top = new THREE.Color(0x3d7cc9);
  const horizon = new THREE.Color(0xcfe0ef);

  // Fallback gradient dome while the HDR downloads.
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

  scene.fog = new THREE.Fog(horizon.clone(), 200, 1000);

  const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x4a4438, 0.9);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff0dc, 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const s = sun.shadow.camera;
  s.left = -90; s.right = 90; s.top = 90; s.bottom = -90; s.near = 1; s.far = 700;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.05;
  scene.add(sun, sun.target);

  const sunDir = new THREE.Vector3(160, 260, 100).normalize();

  new HDRLoader().setDataType(THREE.FloatType).load(SKY_URL, (tex) => {
    tex.mapping = THREE.EquirectangularReflectionMapping;
    const info = analyse(tex);
    sunDir.copy(info.sunDir);
    scene.fog.color.copy(info.horizon);

    scene.background = tex;
    scene.backgroundIntensity = 1;
    if (renderer) {
      const pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromEquirectangular(tex).texture;
      pmrem.dispose();
    }
    scene.environmentIntensity = 0.9;
    hemi.intensity = 0.25; // the HDR now provides most of the ambient light
    scene.remove(dome);
  });

  return {
    update(focus, cameraPos) {
      dome.position.copy(cameraPos);
      sun.position.copy(focus).addScaledVector(sunDir, SUN_DISTANCE);
      sun.target.position.copy(focus);
    },
  };
}

// Find the sun (brightest pixel) and the average colour just above the horizon.
// Uses three's equirect convention: u = atan(z, x) / 2π + 0.5, v = asin(y) / π + 0.5,
// and HDRLoader images are flipped so row 0 is the top (v = 1).
function analyse(tex) {
  const { data, width: w, height: h } = tex.image;
  let best = -1;
  let bx = 0;
  let by = 0;
  for (let y = 0; y < h / 2; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const lum = data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
      if (lum > best) { best = lum; bx = x; by = y; }
    }
  }
  const u = (bx + 0.5) / w;
  const v = 1 - (by + 0.5) / h;
  const phi = (u - 0.5) * Math.PI * 2;
  const theta = (v - 0.5) * Math.PI;
  const sunDir = new THREE.Vector3(Math.cos(phi) * Math.cos(theta), Math.sin(theta), Math.sin(phi) * Math.cos(theta));
  if (sunDir.y < 0.2) sunDir.y = 0.2; // keep shadows sensible if the sun is near the horizon
  sunDir.normalize();

  // Average a band a few degrees above the horizon (linear colour, like the fog).
  const horizon = new THREE.Color(0, 0, 0);
  let n = 0;
  const y0 = Math.floor(h * 0.475); // ~1–4.5° above the horizon, where the haze is
  const y1 = Math.floor(h * 0.495);
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < w; x += 4) {
      const i = (y * w + x) * 4;
      horizon.r += data[i]; horizon.g += data[i + 1]; horizon.b += data[i + 2];
      n++;
    }
  }
  horizon.multiplyScalar(1 / n);
  return { sunDir, horizon };
}
