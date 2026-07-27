// ── engine.js ── Rendering engine, post-processing, skybox, and particle stars
import * as THREE from 'three';
import { getPointTexture } from './textures.js';
import { GALACTIC_CENTER as _GC } from './constants.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Three.js Vector3 form of the galactic center offset.
export const GALACTIC_CENTER = new THREE.Vector3(_GC[0], _GC[1], _GC[2]);

// ── Module state ──
let scene, camera, renderer, composer;
let sunLight;

// Camera-relative rendering offset — the player's logical world position
const sceneOffset = new THREE.Vector3();

export function getSceneOffset() { return sceneOffset; }

// Base camera FOV — three.js FOV is VERTICAL, so on wide windows the
// horizontal field balloons and rectilinear projection stretches spheres
// near the screen edges into eggs. We therefore cap the HORIZONTAL field
// and derive the vertical FOV from the aspect ratio: wide monitors get a
// tighter lens, narrow windows keep the classic feel. Live ESM binding —
// flight.js formulas (BASE_FOV + speed widening) pick changes up each
// frame. Recomputed on resize.
export let BASE_FOV = 62;
const V_FOV_MAX = 62;   // never wider than the original vertical field
const H_FOV_MAX = 82;   // degrees — edge distortion stays acceptable

function computeBaseFov() {
  const aspect = window.innerWidth / Math.max(window.innerHeight, 1);
  const hRad = (H_FOV_MAX * Math.PI) / 180;
  const vDeg = (2 * Math.atan(Math.tan(hRad / 2) / aspect) * 180) / Math.PI;
  BASE_FOV = Math.min(V_FOV_MAX, vDeg);
}
computeBaseFov();

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
  // Lower exposure so bright additive particles (galaxy arms, etc.)
  // don't blow out after tonemap + bloom. The Sun is still emissive
  // enough to look bright on its own.
  renderer.toneMappingExposure = 1.2;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  // ── Scene ──
  scene = new THREE.Scene();

  // ── Camera ──
  camera = new THREE.PerspectiveCamera(
    BASE_FOV,
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

  // Ambient fill — stronger than before so backlit small bodies aren't
  // pure-black silhouettes against the Sun (previously they read as
  // harsh black squares/dots when transiting in front of the Sun from
  // the camera's POV).
  const ambient = new THREE.AmbientLight(0x3a4052, 0.45);
  scene.add(ambient);
  setWorldPos(ambient, ambient.position);

  // Hemisphere light — warm from above (galactic plane), cool from below
  const hemi = new THREE.HemisphereLight(0x5a5240, 0x181828, 0.28);
  scene.add(hemi);
  setWorldPos(hemi, hemi.position);

  // ── Post-processing composer ──
  // Using default render target — the HalfFloat + MSAA combination was
  // breaking the custom sun shader (it rendered a black square at small
  // angular sizes). The "red square" distant-planet aliasing is
  // addressed by higher ambient light + per-body visibility handling
  // instead.
  composer = new EffectComposer(renderer);

  // 1) Render pass
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  // 2) Bloom — restrained. High threshold means only genuinely hot
  // pixels (Sun surface, core nucleus) bloom, not every galaxy-arm
  // particle. Tight radius keeps the glow near its source.
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.22,  // strength
    0.2,   // radius
    0.98   // threshold
  );
  composer.addPass(bloomPass);

  // 3) Output pass (required in r170 as final pass)
  const outputPass = new OutputPass();
  composer.addPass(outputPass);

  // ── Resize handler ──
  window.addEventListener('resize', () => {
    computeBaseFov();
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
  mat.color.setScalar(1.22); // lift the panorama out of murk
  _skyboxMat = mat;
  const skybox = new THREE.Mesh(geo, mat);
  _skyboxMesh = skybox;
  scene.add(skybox);
  return skybox;
}

let _skyboxMesh = null;
let _farStarLayer = null;
let _farSkyGroup = null;

/**
 * The vibe of crossing space: during warp the entire firmament glides —
 * one slow, coherent rotation of the background sky (skybox + distant
 * star layer together). k is 0..1 warp intensity; at full cruise the sky
 * turns ~1.1 deg/s. Zero when not warping — the heavens hold still.
 */
export function updateSkyDrift(dt, k) {
  if (!k || k <= 0) return;
  const rate = 0.019 * k;
  if (_skyboxMesh) {
    _skyboxMesh.rotation.y += dt * rate;
    _skyboxMesh.rotation.x += dt * rate * 0.22;
  }
  if (_farSkyGroup) {
    _farSkyGroup.rotation.y += dt * rate;
    _farSkyGroup.rotation.x += dt * rate * 0.22;
  }
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

/** Soft-glow sprite texture for sky haze */
let _hazeTex = null;
function getHazeTex() {
  if (_hazeTex) return _hazeTex;
  const sz = 128;
  const cv = document.createElement('canvas');
  cv.width = sz; cv.height = sz;
  const ctx = cv.getContext('2d');
  const grd = ctx.createRadialGradient(sz/2, sz/2, 0, sz/2, sz/2, sz/2);
  grd.addColorStop(0, 'rgba(255,255,255,0.7)');
  grd.addColorStop(0.45, 'rgba(255,255,255,0.22)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, sz, sz);
  _hazeTex = new THREE.CanvasTexture(cv);
  return _hazeTex;
}

/** Random point on a sphere at radius r */
function spherePoint(r) {
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);
  return [
    r * Math.sin(phi) * Math.cos(theta),
    r * Math.sin(phi) * Math.sin(theta),
    r * Math.cos(phi),
  ];
}

/**
 * Colored nebulosity regions on the deep sky: six region anchors, each
 * with its own hue, haze gathered gaussian-tight around them — coherent
 * colored neighborhoods like the real sky, not uniform confetti.
 */
function makeDeepSkyNebulosity() {
  const REGIONS = [
    { hue: [0.36, 0.52, 0.85] },  // cold blue
    { hue: [0.75, 0.45, 0.65] },  // dusty magenta
    { hue: [0.85, 0.62, 0.38] },  // amber
    { hue: [0.35, 0.68, 0.62] },  // teal
    { hue: [0.55, 0.42, 0.8] },   // violet
    { hue: [0.8, 0.5, 0.45] },    // rose-brown
  ].map(rg => ({ ...rg, center: spherePoint(650000), spread: 90000 + Math.random() * 140000 }));

  const count = 240;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const rg = REGIONS[i % REGIONS.length];
    const gx = (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
    const gy = (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
    const gz = (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
    positions[i * 3]     = rg.center[0] + gx * rg.spread;
    positions[i * 3 + 1] = rg.center[1] + gy * rg.spread;
    positions[i * 3 + 2] = rg.center[2] + gz * rg.spread;
    const b = 0.35 + Math.random() * 0.65;
    colors[i * 3]     = rg.hue[0] * b;
    colors[i * 3 + 1] = rg.hue[1] * b;
    colors[i * 3 + 2] = rg.hue[2] * b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    size: 300,
    map: getHazeTex(),
    vertexColors: true,
    sizeAttenuation: false,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
    opacity: 0.05,
  });
  return new THREE.Points(geo, mat);
}

/** A few hundred vividly colored bright stars — jewels among the salt */
function makeJewelStars(count) {
  const JEWELS = [
    [0.55, 0.65, 1.0],   // blue giant
    [1.0, 0.82, 0.45],   // gold
    [1.0, 0.55, 0.35],   // red-orange giant
    [0.7, 0.95, 0.95],   // teal-white
    [1.0, 0.7, 0.85],    // rose
  ];
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const [x, y, z] = spherePoint(200000 + Math.random() * 500000);
    positions[i * 3] = x; positions[i * 3 + 1] = y; positions[i * 3 + 2] = z;
    const c = JEWELS[Math.floor(Math.random() * JEWELS.length)];
    const b = 0.7 + Math.random() * 0.3;
    colors[i * 3] = c[0] * b; colors[i * 3 + 1] = c[1] * b; colors[i * 3 + 2] = c[2] * b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    size: 3.4,
    map: getPointTexture(),
    vertexColors: true,
    sizeAttenuation: false,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
    opacity: 0.9,
  });
  return new THREE.Points(geo, mat);
}

/** A tight star cluster — a landmark knot in the sky */
function makeSkyCluster() {
  const count = 50 + Math.floor(Math.random() * 45);
  const center = spherePoint(300000 + Math.random() * 350000);
  const spread = 7000 + Math.random() * 12000;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const warmCluster = Math.random() < 0.35;
  for (let i = 0; i < count; i++) {
    const gx = (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
    const gy = (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
    const gz = (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
    positions[i * 3]     = center[0] + gx * spread;
    positions[i * 3 + 1] = center[1] + gy * spread;
    positions[i * 3 + 2] = center[2] + gz * spread;
    const b = 0.5 + Math.random() * 0.5;
    colors[i * 3]     = b * (warmCluster ? 1.0 : 0.8);
    colors[i * 3 + 1] = b * (warmCluster ? 0.85 : 0.88);
    colors[i * 3 + 2] = b * (warmCluster ? 0.6 : 1.0);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    size: 1.6,
    map: getPointTexture(),
    vertexColors: true,
    sizeAttenuation: false,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
    opacity: 0.85,
  });
  return new THREE.Points(geo, mat);
}

function makeDriftGlows(count, half) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const palettes = [
    [0.45, 0.55, 0.9], [0.85, 0.6, 0.4], [0.6, 0.45, 0.85],
    [0.4, 0.7, 0.75], [0.9, 0.75, 0.55],
  ];
  for (let i = 0; i < count; i++) {
    positions[i * 3]     = (Math.random() * 2 - 1) * half;
    positions[i * 3 + 1] = (Math.random() * 2 - 1) * half;
    positions[i * 3 + 2] = (Math.random() * 2 - 1) * half;
    const c = palettes[Math.floor(Math.random() * palettes.length)];
    const b = 0.5 + Math.random() * 0.5;
    colors[i * 3] = c[0] * b; colors[i * 3 + 1] = c[1] * b; colors[i * 3 + 2] = c[2] * b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    size: 900000,               // world units — soft giants, shrink with distance
    map: getPointTexture(),
    vertexColors: true,
    sizeAttenuation: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
    opacity: 0.12,
  });
  const pts = new THREE.Points(geo, mat);
  _localStarBuckets.push({ positions, geo, half, count });
  return pts;
}

function makeLocalStarVolume(count, half, size, opacity, isNear = false) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3]     = (Math.random() * 2 - 1) * half;
    positions[i * 3 + 1] = (Math.random() * 2 - 1) * half;
    positions[i * 3 + 2] = (Math.random() * 2 - 1) * half;
    const c = STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)];
    const b = 0.55 + Math.random() * 0.45; // brightness variance
    colors[i * 3]     = c[0] * b;
    colors[i * 3 + 1] = c[1] * b;
    colors[i * 3 + 2] = c[2] * b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    size,
    map: getPointTexture(),
    vertexColors: true,
    sizeAttenuation: false,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
    opacity,
  });
  const pts = new THREE.Points(geo, mat);
  _localStarBuckets.push({ positions, geo, half, count, isNear, material: mat });
  return pts;
}

let _warpK = 0;
/** 0..1 — during warp the small near volumes fade out (pure shimmer at
 *  those speeds) while the big shells and drift glows carry the motion. */
export function setWarpStarMode(k) {
  _warpK = Math.max(0, Math.min(1, k));
}

/**
 * True stellar parallax: positions are offsets from the camera; keeping a
 * star's offset fixed while the camera moves would drag it along, so we
 * subtract the camera's displacement — the star stays put in WORLD space —
 * and wrap it to the far side of the volume when it falls too far behind.
 * Call once per frame.
 */
export function updateStarParallax(camPos) {
  if (!_spHasPrev) { _spPrevCam.copy(camPos); _spHasPrev = true; return; }
  const dx = camPos.x - _spPrevCam.x;
  const dy = camPos.y - _spPrevCam.y;
  const dz = camPos.z - _spPrevCam.z;
  _spPrevCam.copy(camPos);
  const magSq = dx * dx + dy * dy + dz * dz;
  if (magSq < 0.25) return; // stationary — skip the work

  for (const b of _localStarBuckets) {
    const p = b.positions;
    const span = b.half * 2;
    for (let i = 0; i < b.count; i++) {
      let x = p[i * 3]     - dx;
      let y = p[i * 3 + 1] - dy;
      let z = p[i * 3 + 2] - dz;
      if (x >  b.half) x -= span; else if (x < -b.half) x += span;
      if (y >  b.half) y -= span; else if (y < -b.half) y += span;
      if (z >  b.half) z -= span; else if (z < -b.half) z += span;
      p[i * 3] = x; p[i * 3 + 1] = y; p[i * 3 + 2] = z;
    }
    b.geo.attributes.position.needsUpdate = true;
  }
}

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

// ── Milky Way particle galaxy ───────────────────────────────────────
// Three layers: (1) dense star particles in spiral arms with dust-lane
// gaps, (2) halo of scattered old stars around the bulge, (3) bright
// central bulge. The whole thing is tilted so the Sun's neighborhood
// (near origin) sits slightly above the plane, matching our real-world
// offset from the galactic midplane.
function makeMilkyWay() {
  const group = new THREE.Group();

  // ── Spiral arm disk (main component) ──────────────────────────────
  const count = 220000;
  const arms  = 4;
  const positions = new Float32Array(count * 3);
  const colors    = new Float32Array(count * 3);

  let written = 0;
  let attempts = 0;
  while (written < count && attempts < count * 3) {
    attempts++;
    const armIndex  = Math.floor(Math.random() * arms);
    const armAngle  = (armIndex / arms) * Math.PI * 2;

    // Biased radial distribution — more particles toward the core
    const t = Math.pow(Math.random(), 0.7);
    const radius = 4000 + t * 620000;

    // Tighter spiral winding in the inner disk
    const spiralAngle = armAngle + t * Math.PI * 3.2;

    // Angular spread narrows in the middle of each arm (creates dust-lane gaps)
    const jitter = (Math.random() - 0.5) * 0.35;
    // Skip particles in the "dust lane" — low-density band on the inner edge of each arm
    if (Math.abs(jitter) < 0.06 && Math.random() < 0.75) continue;

    const angle = spiralAngle + jitter;
    const thickness = radius * (0.025 + Math.random() * 0.035); // thin disk
    const armSpread = radius * 0.07;

    const x = Math.cos(angle) * radius + (Math.random() - 0.5) * armSpread;
    const y = (Math.random() - 0.5) * thickness;
    const z = Math.sin(angle) * radius + (Math.random() - 0.5) * armSpread;

    positions[written * 3]     = x;
    positions[written * 3 + 1] = y;
    positions[written * 3 + 2] = z;

    // ── Stellar color population, biased by radial position ──
    // Real galaxies show a clear gradient: warm yellow-orange bulge (old
    // red giants dominate), cool blue-white arms (young O/B stars), and
    // pink H-II regions where new stars are forming. Additive blending
    // will stack these — so we bias each particle toward a saturated
    // color rather than near-white, otherwise everything collapses to
    // grey in dense regions.
    const coreFrac = 1 - t;             // 1 at core, 0 at outer edge
    const bright = 0.5 + Math.random() * 0.5;
    const roll = Math.random();
    let cr, cg, cb;

    if (roll < 0.04 && t > 0.3) {
      // H-II emission region — pink/red, clustered in arms (not core)
      cr = 1.0;  cg = 0.35 + Math.random() * 0.15;  cb = 0.45 + Math.random() * 0.15;
    } else if (roll < 0.18 && t > 0.4) {
      // Young blue O/B star — outer arms
      const b = 0.7 + Math.random() * 0.3;
      cr = 0.45 * b;  cg = 0.65 * b;  cb = 1.0 * b;
    } else if (coreFrac > 0.55) {
      // Old stellar population in bulge — warm amber/orange
      cr = (0.95 + Math.random() * 0.05) * bright;
      cg = (0.7 + Math.random() * 0.1) * bright;
      cb = (0.4 + Math.random() * 0.15) * bright;
    } else if (roll < 0.65) {
      // Main-sequence population in disk — creamy yellow-white
      cr = (0.9 + Math.random() * 0.1) * bright;
      cg = (0.85 + Math.random() * 0.1) * bright;
      cb = (0.7 + Math.random() * 0.15) * bright;
    } else if (roll < 0.85) {
      // Cool blue-white arm stars
      cr = (0.65 + Math.random() * 0.15) * bright;
      cg = (0.75 + Math.random() * 0.15) * bright;
      cb = (0.95 + Math.random() * 0.05) * bright;
    } else {
      // Dust-reddened / obscured — warm brown, dim
      const dim = 0.35 + Math.random() * 0.25;
      cr = 0.8 * dim;  cg = 0.5 * dim;  cb = 0.3 * dim;
    }

    colors[written * 3]     = cr;
    colors[written * 3 + 1] = cg;
    colors[written * 3 + 2] = cb;
    written++;
  }

  const trimPositions = positions.slice(0, written * 3);
  const trimColors = colors.slice(0, written * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(trimPositions, 3));
  geo.setAttribute('color',    new THREE.BufferAttribute(trimColors, 3));

  const mat = new THREE.PointsMaterial({
    // Pixel-sized particles — large enough to read from ~2M units at
    // intro start. Opacity is intentionally moderate so overlapping
    // particles don't saturate to pure white — individual stellar
    // colors survive the additive stacking.
    size: 4.0,
    map: getPointTexture(),
    vertexColors: true,
    sizeAttenuation: false,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
    opacity: 0.62
  });

  group.add(new THREE.Points(geo, mat));

  // ── Halo / old stellar population (elliptical) ────────────────────
  const haloCount = 35000;
  const haloPos = new Float32Array(haloCount * 3);
  const haloCol = new Float32Array(haloCount * 3);
  for (let i = 0; i < haloCount; i++) {
    // Gaussian radial — most hug the bulge, few in the halo
    const u = Math.random(), v = Math.random();
    const r = Math.abs(Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)) * 90000;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    // Flattened ellipsoid — wider than tall
    haloPos[i*3    ] = r * Math.sin(phi) * Math.cos(theta) * 1.3;
    haloPos[i*3 + 1] = r * Math.sin(phi) * Math.sin(theta) * 0.55;
    haloPos[i*3 + 2] = r * Math.cos(phi) * 1.3;
    // Halo is dominated by old red giants — warm amber-orange
    const b = 0.35 + Math.random() * 0.45;
    haloCol[i*3    ] = b * 1.0;
    haloCol[i*3 + 1] = b * 0.72;
    haloCol[i*3 + 2] = b * 0.42;
  }
  const haloGeo = new THREE.BufferGeometry();
  haloGeo.setAttribute('position', new THREE.BufferAttribute(haloPos, 3));
  haloGeo.setAttribute('color',    new THREE.BufferAttribute(haloCol, 3));
  const haloMat = new THREE.PointsMaterial({
    size: 2.2, map: getPointTexture(), vertexColors: true,
    sizeAttenuation: false, blending: THREE.AdditiveBlending,
    depthWrite: false, transparent: true, opacity: 0.8
  });
  group.add(new THREE.Points(haloGeo, haloMat));

  // No tilt here — tilt is applied by a parent group so this inner group
  // can spin around the galactic axis cleanly (see createStars).
  return group;
}

// ── Star field state (for opacity fading, e.g. Bootes Void) ──
let _starGroup = null;
const _starBaseOpacities = []; // stores { material, baseOpacity } for each star child
const _localStarBuckets = [];  // wrapping local-star volumes (true parallax)
const _spPrevCam = new THREE.Vector3();
let _spHasPrev = false;
let _starTargetOpacity = 1.0;
let _starCurrentOpacity = 1.0;

// Milky Way group — separate sub-group so we can rotate the galaxy slowly
// and keep it offset from the Sun's position.
let _milkyWayGroup = null;
// Track base opacities of every Milky Way material so setMilkyWayOpacity
// can scale them uniformly.
const _milkyWayMats = []; // { material, baseOpacity }

export function createStars() {
  const group = new THREE.Group();
  group.renderOrder = -10; // render before all planets

  // Layers 1+3 are now LOCAL star volumes with true parallax: stars hold
  // fixed world positions inside a cube that wraps around the camera
  // (dust-field technique at stellar scale). At cruising speeds the drift
  // is imperceptible — physically honest — but at warp the near field
  // sweeps past while distant layers crawl. Layer 2 stays camera-locked:
  // the truly distant sky.
  group.add(makeLocalStarVolume(9000, 170000, 1.5, 0.95, true));
  group.add(makeLocalStarVolume(2400, 120000, 3.2, 0.85, true));
  // Warp-scale parallax shells: stars at millions of units — a gentle
  // sweep at cruise, motionless sky below warp speeds.
  group.add(makeLocalStarVolume(3000, 3500000, 1.8, 0.8));
  group.add(makeLocalStarVolume(1400, 10000000, 2.6, 0.75));

  // Passers-by: rare, LARGE, soft glows (distant nebulae) with true size
  // attenuation — during a cruise one drifts past every few seconds, big
  // and dim and unhurried. Depth you can feel, not more dots.
  group.add(makeDriftGlows(30, 22000000));

  // The deep sky is a place, not a salt-scatter: the far backdrop gets
  // colored nebulosity regions, vivid jewel stars, and a few tight
  // clusters — landmarks that make the warp sky-glide legible. All of it
  // lives in one group so it drifts coherently with the skybox.
  _farSkyGroup = new THREE.Group();
  _farStarLayer = makeStarLayer(14000, 180000, 800000, 0.8, 0.5);
  _farSkyGroup.add(_farStarLayer);
  _farSkyGroup.add(makeDeepSkyNebulosity());
  _farSkyGroup.add(makeJewelStars(320));
  for (let c = 0; c < 9; c++) _farSkyGroup.add(makeSkyCluster());
  group.add(_farSkyGroup);

  // Milky Way galaxy — three nested groups:
  //   mwOuter    → positioned at the galactic center (camera-relative)
  //   mwTilted   → applies the axial tilt relative to the world
  //   mwRotator  → spins around the galaxy's own axis (this is what we
  //                animate each frame via updateMilkyWayRotation)
  // Added as a DIRECT scene child with _worldPos so camera-relative
  // rendering correctly repositions it each frame — that's what lets the
  // galaxy grow as the camera flies in during the intro.
  const mwOuter  = new THREE.Group();
  const mwTilted = new THREE.Group();
  mwTilted.rotation.x = 0.08;
  mwTilted.rotation.z = 0.04;
  const mwRotator = new THREE.Group();

  mwRotator.add(makeMilkyWay());

  // Galactic core bulge — shells are children of the rotator so they
  // stay locked to the galactic frame (they're symmetric, so the spin
  // itself is invisible, but that's the correct parent).
  // Subtle nested shells — together they read as a soft bright nucleus
  // rather than a searchlight. Opacities are intentionally low because
  // additive blending stacks them and the bloom post-pass amplifies the
  // brightest pixels further.
  const coreShells = [
    { r: 140000, color: 0xffe4a8, opacity: 0.018 },  // far halo haze
    { r: 80000,  color: 0xffe8b8, opacity: 0.035 },  // outer haze
    { r: 40000,  color: 0xffddaa, opacity: 0.06  },  // mid
    { r: 18000,  color: 0xffeecc, opacity: 0.10  },  // bright bulge
    { r: 7000,   color: 0xfff3d8, opacity: 0.18  },  // hot center
  ];
  for (const s of coreShells) {
    const geo = new THREE.SphereGeometry(s.r, 40, 40);
    const mat = new THREE.MeshBasicMaterial({
      color: s.color,
      transparent: true,
      opacity: s.opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.BackSide,
    });
    mwRotator.add(new THREE.Mesh(geo, mat));
  }

  mwTilted.add(mwRotator);
  mwOuter.add(mwTilted);
  _milkyWayGroup = mwRotator;       // this is what spins
  scene.add(mwOuter);
  setWorldPos(mwOuter, GALACTIC_CENTER);

  // Record every MW material's base opacity so we can fade the whole
  // galaxy uniformly during the intro arrival.
  mwOuter.traverse((o) => {
    if (o.material && o.material.opacity !== undefined) {
      _milkyWayMats.push({ material: o.material, baseOpacity: o.material.opacity });
    }
  });

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
 * Fade the 3D particle galaxy as a whole (0-1 multiplier on base opacities).
 * Used during intro arrival so the galaxy reads as the skybox-wrapped
 * starfield from inside the Sun's neighbourhood, rather than a distinct
 * spiral object off in the distance.
 */
export function setMilkyWayOpacity(opacity) {
  const m = Math.max(0, Math.min(1, opacity));
  for (const entry of _milkyWayMats) {
    entry.material.opacity = entry.baseOpacity * m;
  }
}

/**
 * Set the skybox opacity directly (0-1). Independent of the star field
 * opacity — used to fade the equirectangular Milky Way band image during
 * the intro, so the 3D particle galaxy isn't fighting it for visibility.
 */
export function setSkyboxOpacity(opacity) {
  if (_skyboxMat) _skyboxMat.opacity = Math.max(0, Math.min(1, opacity));
}

/**
 * Slowly rotate the Milky Way around its own galactic axis. Purely cosmetic
 * — about one full revolution every ~10 minutes at 1x time scale, scaled by
 * the passed multiplier. Call once per frame.
 * @param {number} dt  seconds
 * @param {number} [mult=1] optional speed multiplier
 */
export function updateMilkyWayRotation(dt, mult = 1) {
  if (!_milkyWayGroup) return;
  // ~0.01 rad/s * mult — subtle but visible, cinematic
  _milkyWayGroup.rotation.y += dt * 0.01 * mult;
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

  // Smooth lerp toward target — fast enough to complete during warp approach
  const lerpSpeed = 3.0;
  if (Math.abs(_starCurrentOpacity - _starTargetOpacity) < 0.005) {
    _starCurrentOpacity = _starTargetOpacity;
  } else {
    _starCurrentOpacity += (_starTargetOpacity - _starCurrentOpacity) * Math.min(1, lerpSpeed * dt);
  }

  // Apply to all star layer materials
  for (const entry of _starBaseOpacities) {
    entry.material.opacity = entry.baseOpacity * _starCurrentOpacity;
  }
  // Near volumes are shimmer-noise at warp speed — fade them with warp
  for (const b of _localStarBuckets) {
    if (b.isNear && b.material) {
      b.material.opacity *= (1 - 0.9 * _warpK);
    }
  }
  // The skybox is controlled separately via setSkyboxOpacity so the intro
  // can fade it without affecting the star particle layers.
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
