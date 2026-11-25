import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';

// Post-processing and graphics quality.
//   High:   ambient occlusion (GTAO), bloom, 4x MSAA, colour grading, 4096 shadows
//   Medium: bloom, 4x MSAA, colour grading, 2048 shadows
//   Low:    FXAA, colour grading, 1024 shadows, capped pixel ratio
// Starts on High and steps down automatically if the frame rate is too low.

export const QUALITY = ['Low', 'Medium', 'High'];

// Gentle filmic grade: a little contrast and saturation, warm highlights, vignette.
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uVignette: { value: 0.22 } },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uVignette; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, 1.08);                       // saturation
      col = (col - 0.5) * 1.05 + 0.5;                      // contrast
      col *= mix(vec3(0.98, 0.99, 1.03), vec3(1.03, 1.0, 0.96), smoothstep(0.3, 0.9, l)); // cool shadows, warm highlights
      vec2 d = vUv - 0.5;
      col *= 1.0 - uVignette * smoothstep(0.25, 0.85, dot(d, d) * 2.2);
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
    }`,
};

export class PostFX {
  constructor(renderer, scene, camera, { sun, hideForAO = [] } = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.sun = sun;
    this.hideForAO = hideForAO;
    this.level = 2;
    this._fpsFrames = 0;
    this._fpsTime = 0;
    this._autoDone = false;
    this.onChange = null;
    this._build();
  }

  _build() {
    const r = this.renderer;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const high = this.level === 2;
    const low = this.level === 0;

    r.setPixelRatio(Math.min(window.devicePixelRatio, low ? 1 : 2));
    r.toneMappingExposure = 1.0;
    if (this.sun) {
      const size = [1024, 2048, 4096][this.level];
      const ext = [70, 90, 120][this.level];
      const s = this.sun.shadow;
      if (s.mapSize.x !== size) {
        s.mapSize.set(size, size);
        s.map?.dispose();
        s.map = null;
      }
      s.camera.left = s.camera.bottom = -ext;
      s.camera.right = s.camera.top = ext;
      s.camera.updateProjectionMatrix();
    }

    this.composer?.dispose();
    const pr = r.getPixelRatio();
    const target = new THREE.WebGLRenderTarget(w * pr, h * pr, { type: THREE.HalfFloatType, samples: low ? 0 : 4 });
    const composer = new EffectComposer(r, target);
    composer.setPixelRatio(pr);
    composer.setSize(w, h);
    composer.addPass(new RenderPass(this.scene, this.camera));

    if (high) {
      const ao = new GTAOPass(this.scene, this.camera, w, h);
      ao.output = GTAOPass.OUTPUT.Default;
      ao.blendIntensity = 0.85;
      ao.updateGtaoMaterial({ radius: 1.2, distanceExponent: 1.5, thickness: 2, scale: 1.0, distanceFallOff: 1 });
      ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6 });
      // Alpha-tested leaf cards would show up as solid squares in the AO normal pass.
      const render = ao.render.bind(ao);
      ao.render = (...args) => {
        for (const o of this.hideForAO) o.visible = false;
        render(...args);
        for (const o of this.hideForAO) o.visible = true;
      };
      composer.addPass(ao);
    }
    if (!low) composer.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 0.32, 0.45, 0.92));
    composer.addPass(new OutputPass());
    composer.addPass(new ShaderPass(GradeShader));
    if (low) composer.addPass(new FXAAPass());
    this.composer = composer;
  }

  setLevel(level) {
    level = Math.max(0, Math.min(2, level));
    if (level === this.level) return;
    this.level = level;
    this._build();
    this.onChange?.(QUALITY[level]);
  }

  cycle() {
    this.setLevel((this.level + 2) % 3); // High -> Medium -> Low -> High
  }

  resize() {
    this._build();
  }

  render(dt) {
    this.composer.render(dt);
    // Auto-adjust once, a few seconds into play.
    if (!this._autoDone) {
      this._fpsFrames++;
      this._fpsTime += dt;
      if (this._fpsTime > 4) {
        const fps = this._fpsFrames / this._fpsTime;
        if (fps < 40 && this.level > 0) this.setLevel(this.level - 1);
        else this._autoDone = true;
        this._fpsFrames = 0;
        this._fpsTime = 0;
        if (this.level === 0) this._autoDone = true;
      }
    }
  }
}
