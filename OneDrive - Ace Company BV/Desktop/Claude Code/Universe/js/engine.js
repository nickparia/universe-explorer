// ── engine.js ── Rendering engine, post-processing, skybox, and particle stars
import * as THREE from 'three';
import { getPointTexture } from './textures.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// ── Module state ──
let scene, camera, renderer, composer;
let sunLight;
let distortionPass, filmGrainPass;

// Camera-relative rendering offset — the player's logical world position
const sceneOffset = new THREE.Vector3();

export function getSceneOffset() { return sceneOffset; }

// ═══════════════════════════════════════════════════════════════
// Custom Shaders
// ═══════════════════════════════════════════════════════════════

const VignetteShader = {
  uniforms: {
    tDiffuse: { value: null },
    offset:   { value: 1.0 },
    darkness: { value: 0.6 }
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float offset;
    uniform float darkness;
    varying vec2 vUv;
    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      vec2 uv = (vUv - 0.5) * vec2(offset);
      color.rgb *= 1.0 - dot(uv, uv) * darkness;
      gl_FragColor = color;
    }
  `
};

const FilmGrainShader = {
  uniforms: {
    tDiffuse:   { value: null },
    time:       { value: 0.0 },
    intensity:  { value: 0.03 }
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float time;
    uniform float intensity;
    varying vec2 vUv;

    float rand(vec2 co) {
      return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      float n = rand(vUv + time) * intensity;
      color.rgb += n - intensity * 0.5;
      gl_FragColor = color;
    }
  `
};

const DistortionShader = {
  uniforms: {
    tDiffuse:     { value: null },
    bhScreenPos:  { value: new THREE.Vector2(0.5, 0.5) },
    bhStrength:   { value: 0.0 }
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec2 bhScreenPos;
    uniform float bhStrength;
    varying vec2 vUv;

    void main() {
      if (bhStrength > 0.0) {
        vec2 dir = vUv - bhScreenPos;
        float dist = length(dir);
        if (dist > 0.01) {
          float pull = bhStrength / (dist * dist * 80.0 + 1.0);
          vec2 offset = -normalize(dir) * pull * 0.08;
          gl_FragColor = texture2D(tDiffuse, vUv + offset);
        } else {
          gl_FragColor = texture2D(tDiffuse, vUv);
        }
      } else {
        gl_FragColor = texture2D(tDiffuse, vUv);
      }
    }
  `
};

// ═══════════════════════════════════════════════════════════════
// initEngine
// ═══════════════════════════════════════════════════════════════

export function initEngine() {
  const canvas = document.getElementById('c');

  // ── Renderer ──
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
    logarithmicDepthBuffer: true
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.8;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  // ── Scene ──
  scene = new THREE.Scene();

  // ── Camera ──
  camera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    0.1,
    100000000
  );

  // ── Lights ──
  // No distance decay — all planets get equal brightness on the sunward side.
  // Light still radiates FROM the Sun position, so each planet gets correct
  // sun-side / dark-side shading. Just no dimming with distance.
  sunLight = new THREE.PointLight(0xfff8e8, 3.0);
  sunLight.decay = 0;
  scene.add(sunLight);
  setWorldPos(sunLight, sunLight.position);

  // Subtle ambient so dark sides aren't pitch black
  const ambient = new THREE.AmbientLight(0x202030, 0.2);
  scene.add(ambient);
  setWorldPos(ambient, ambient.position);

  // Hemisphere light — warm from above, cool from below
  const hemi = new THREE.HemisphereLight(0x444433, 0x111122, 0.15);
  scene.add(hemi);
  setWorldPos(hemi, hemi.position);

  // ── Post-processing composer ──
  composer = new EffectComposer(renderer);

  // 1) Render pass
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  // 2) Bloom
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.35,  // strength — gentle glow
    0.5,   // radius — wide, soft
    0.85   // threshold
  );
  composer.addPass(bloomPass);

  // 3) Output pass (required in r170 as final pass)
  const outputPass = new OutputPass();
  composer.addPass(outputPass);

  // Custom shader passes disabled for now — bloom + output is sufficient
  distortionPass = null;
  filmGrainPass = null;

  // ── Resize handler ──
  window.addEventListener('resize', () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    composer.setSize(w, h);
  });

  return { scene, camera, composer, renderer };
}

// ═══════════════════════════════════════════════════════════════
// Accessors
// ═══════════════════════════════════════════════════════════════

export function getScene()          { return scene; }
export function getCamera()         { return camera; }
export function getSunLight()       { return sunLight; }
export function getDistortionPass() { return distortionPass; }

export function updateFilmGrain(time) {
  if (filmGrainPass) {
    filmGrainPass.uniforms.time.value = time;
  }
}

// ═══════════════════════════════════════════════════════════════
// Skybox
// ═══════════════════════════════════════════════════════════════

let _skyboxMat = null;
export function createSkybox(starmapTexture) {
  const geo = new THREE.SphereGeometry(5000000, 64, 64);
  const mat = new THREE.MeshBasicMaterial({
    map: starmapTexture,
    side: THREE.BackSide,
    depthWrite: false,
    transparent: true,
    opacity: 1.0,
  });
  _skyboxMat = mat;
  const skybox = new THREE.Mesh(geo, mat);
  scene.add(skybox);
  return skybox;
}

// ═══════════════════════════════════════════════════════════════
// Particle Stars
// ═══════════════════════════════════════════════════════════════

const STAR_COLORS = [
  [1, 0.88, 0.72],
  [0.72, 0.80, 1],
  [1, 0.62, 0.32],
  [0.94, 1, 0.90],
  [1, 1, 0.58],
  [0.85, 0.90, 1]
];

function makeStarLayer(count, minR, maxR, size, opacity) {
  const positions = new Float32Array(count * 3);
  const colors    = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    // Uniform sphere distribution
    const theta = Math.random() * Math.PI * 2;
    const phi   = Math.acos(2 * Math.random() - 1);
    const r     = minR + Math.random() * (maxR - minR);

    const x = r * Math.sin(phi) * Math.cos(theta);
    const y = r * Math.sin(phi) * Math.sin(theta);
    const z = r * Math.cos(phi);

    positions[i * 3]     = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;

    const c = STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)];
    colors[i * 3]     = c[0];
    colors[i * 3 + 1] = c[1];
    colors[i * 3 + 2] = c[2];
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color',    new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.PointsMaterial({
    size,
    map: getPointTexture(),
    vertexColors: true,
    sizeAttenuation: false,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
    opacity
  });

  return new THREE.Points(geo, mat);
}

function makeMilkyWay() {
  const count = 120000;
  const arms  = 4;
  const positions = new Float32Array(count * 3);
  const colors    = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    const armIndex  = i % arms;
    const armAngle  = (armIndex / arms) * Math.PI * 2;

    const t = Math.random();
    const radius = 2000 + t * 600000;
    const spiralAngle = armAngle + t * Math.PI * 3.5;

    const spread = radius * 0.12;
    const ox = (Math.random() - 0.5) * spread;
    const oy = (Math.random() - 0.5) * spread * 0.06;
    const oz = (Math.random() - 0.5) * spread;

    const x = Math.cos(spiralAngle) * radius + ox;
    const y = oy;
    const z = Math.sin(spiralAngle) * radius + oz;

    positions[i * 3]     = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;

    const bright = 0.5 + Math.random() * 0.5;
    colors[i * 3]     = bright * 0.85;
    colors[i * 3 + 1] = bright * 0.88;
    colors[i * 3 + 2] = bright;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color',    new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.PointsMaterial({
    size: 0.8,
    map: getPointTexture(),
    vertexColors: true,
    sizeAttenuation: false,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
    opacity: 0.55
  });

  return new THREE.Points(geo, mat);
}

// ── Star field state (for opacity fading, e.g. Bootes Void) ──
let _starGroup = null;
const _starBaseOpacities = []; // stores { material, baseOpacity } for each star child
let _starTargetOpacity = 1.0;
let _starCurrentOpacity = 1.0;

export function createStars() {
  const group = new THREE.Group();
  group.renderOrder = -10; // render before all planets

  // Layer 1: main star field
  group.add(makeStarLayer(30000, 4000, 150000, 1.4, 1.0));

  // Layer 2: distant stars
  group.add(makeStarLayer(12000, 150000, 800000, 0.8, 0.5));

  // Layer 3: nearby bright stars (but far enough to not overlap planets)
  group.add(makeStarLayer(2500, 2000, 8000, 3.5, 0.9));

  // Milky Way band
  group.add(makeMilkyWay());

  // Galactic core glow
  const coreGeo = new THREE.SphereGeometry(8000, 32, 32);
  const coreMat = new THREE.MeshBasicMaterial({
    color: 0xffeedd,
    transparent: true,
    opacity: 0.04,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.BackSide,
  });
  const core = new THREE.Mesh(coreGeo, coreMat);
  group.add(core);

  // Brighter inner core
  const innerCoreGeo = new THREE.SphereGeometry(3000, 32, 32);
  const innerCoreMat = new THREE.MeshBasicMaterial({
    color: 0xffddaa,
    transparent: true,
    opacity: 0.07,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.BackSide,
  });
  const innerCore = new THREE.Mesh(innerCoreGeo, innerCoreMat);
  group.add(innerCore);

  scene.add(group);

  // Store references for opacity control
  _starGroup = group;
  for (const child of group.children) {
    if (child.material) {
      _starBaseOpacities.push({ material: child.material, baseOpacity: child.material.opacity });
    }
  }

  return group;
}

/**
 * Set the target opacity multiplier for the star field (0-1).
 * Smoothly lerped each frame via updateStarFieldOpacity().
 */
export function setStarFieldOpacity(opacity) {
  _starTargetOpacity = Math.max(0, Math.min(1, opacity));
}

/**
 * Lerp star field opacity toward target each frame.
 * Call once per frame from the render loop.
 */
export function updateStarFieldOpacity(dt) {
  if (!_starGroup || _starBaseOpacities.length === 0) return;

  // Smooth lerp toward target
  const lerpSpeed = 1.5; // opacity units per second
  if (Math.abs(_starCurrentOpacity - _starTargetOpacity) < 0.001) {
    _starCurrentOpacity = _starTargetOpacity;
  } else {
    _starCurrentOpacity += (_starTargetOpacity - _starCurrentOpacity) * Math.min(1, lerpSpeed * dt);
  }

  // Apply to all star layer materials
  for (const entry of _starBaseOpacities) {
    entry.material.opacity = entry.baseOpacity * _starCurrentOpacity;
  }
  // Also fade the skybox texture
  if (_skyboxMat) {
    _skyboxMat.opacity = _starCurrentOpacity;
  }
}

// ═══════════════════════════════════════════════════════════════
// Camera-Relative Rendering
// ═══════════════════════════════════════════════════════════════

/**
 * Shift all scene root children so the camera is effectively at origin.
 * Call once per frame BEFORE rendering.
 * @param {THREE.Vector3} logicalCamPos — the player's true world position
 */
export function applyCameraRelative(logicalCamPos) {
  sceneOffset.copy(logicalCamPos);
  camera.position.set(0, 0, 0);

  // Offset all direct children of scene
  for (let i = 0; i < scene.children.length; i++) {
    const obj = scene.children[i];
    if (obj === camera) continue;
    if (obj.userData._worldPos) {
      obj.position.copy(obj.userData._worldPos).sub(sceneOffset);
    }
  }
}

/**
 * Store an object's true world position for camera-relative offsetting.
 * Call when placing objects in the scene or updating their position.
 */
export function setWorldPos(obj, pos) {
  if (!obj.userData._worldPos) {
    obj.userData._worldPos = new THREE.Vector3();
  }
  obj.userData._worldPos.copy(pos);
  obj.position.copy(pos);
}
