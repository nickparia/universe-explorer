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

// Base camera FOV — kept narrower than a wide first-person FOV to reduce
// perspective stretching on spheres at screen edges. Speed/warp effects
// temporarily widen this in flight.js.
export const BASE_FOV = 62;

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

  // Layer 1: main star field
  group.add(makeStarLayer(30000, 4000, 150000, 1.4, 1.0));

  // Layer 2: distant stars
  group.add(makeStarLayer(12000, 150000, 800000, 0.8, 0.5));

  // Layer 3: nearby bright stars (but far enough to not overlap planets)
  group.add(makeStarLayer(2500, 2000, 8000, 3.5, 0.9));

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
