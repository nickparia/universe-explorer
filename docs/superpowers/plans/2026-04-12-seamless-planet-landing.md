# Seamless Planet Landing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add seamless No Man's Sky-style planetary descent, surface landing, and gas giant atmospheric dives to Universe Explorer — all in one continuous Three.js scene with zero loading screens.

**Architecture:** Single-scene continuous scale approach. Camera-relative rendering eliminates precision issues. Quadtree cube-sphere terrain generates detail on demand via Web Workers. Rayleigh/Mie atmosphere shader produces physically correct skies. Performance tiers auto-detected and scaled at runtime.

**Tech Stack:** Three.js r170 (ES modules from CDN), Web Workers, custom GLSL shaders, procedural noise.

---

## Phase Overview

This plan is split into 7 phases. Each phase produces a working, testable build:

1. **Prerequisite Fixes** — fix dark planets, enhance galaxy feel
2. **Engine Foundation** — logarithmic depth, camera-relative rendering, GPU benchmark, altitude tracking
3. **Planet Scale & Config** — scale up planets/orbits, per-planet terrain+atmosphere data
4. **Terrain System** — cube-sphere quadtree, procedural noise, Web Worker chunk streaming
5. **Atmosphere System** — scattering shader, clouds, cinematic entry effects
6. **Gas Giant Dives** — volumetric descent phases, HUD warnings, crush depth ejection
7. **Landing Mechanics** — settle/liftoff, surface HUD, Return Home from surface

---

## Phase 1: Prerequisite Fixes

### Task 1.1: Fix Dark Planets (Lighting)

**Files:**
- Modify: `js/engine.js:146-151` (light setup)
- Modify: `js/main.js:111-113` (sun flicker range)

- [ ] **Step 1: Fix sun PointLight decay**

In `js/engine.js`, replace the light setup (lines 146-151):

```js
// ── Lights ──
sunLight = new THREE.PointLight(0xfff8e8, 5.0);
scene.add(sunLight);

const ambient = new THREE.AmbientLight(0x111122, 2.0);
scene.add(ambient);
```

with:

```js
// ── Lights ──
sunLight = new THREE.PointLight(0xfff8e8, 3.0);
sunLight.decay = 1;  // linear falloff — visible at distance but still fades
scene.add(sunLight);

const ambient = new THREE.AmbientLight(0x334466, 0.8);
scene.add(ambient);

// Hemisphere light for natural fill — sky blue above, ground brown below
const hemi = new THREE.HemisphereLight(0x4466aa, 0x332211, 0.5);
scene.add(hemi);
```

- [ ] **Step 2: Adjust sun flicker range in main.js**

In `js/main.js`, replace the sun light flicker (line 112):

```js
sunLight.intensity = 4.8 + Math.sin(elapsed * 6.2) * 0.4 + Math.sin(elapsed * 2.7) * 0.15;
```

with:

```js
sunLight.intensity = 3.0 + Math.sin(elapsed * 6.2) * 0.3 + Math.sin(elapsed * 2.7) * 0.1;
```

- [ ] **Step 3: Test visually**

Run: `python -m http.server 8080` and open `localhost:8080`.
Expected: All planets visible with natural lighting. Inner planets well-lit, outer planets dimmer but clearly visible. Ambient fill prevents anything from being pitch black.

- [ ] **Step 4: Commit**

```bash
git add js/engine.js js/main.js
git commit -m "fix: lighting — linear decay sun, hemisphere fill, brighter ambient"
```

---

### Task 1.2: Enhance Galaxy Feel

**Files:**
- Modify: `js/engine.js:275-346` (makeMilkyWay, createStars)
- Modify: `js/deepspace.js:19-26` (nebula cloud defs)

- [ ] **Step 1: Make Milky Way band more prominent**

In `js/engine.js`, replace the `makeMilkyWay` function (lines 275-327):

```js
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
```

- [ ] **Step 2: Add galactic core glow**

In `js/engine.js`, inside `createStars()` after the `group.add(makeMilkyWay())` line (line 342), add:

```js
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
```

- [ ] **Step 3: Increase nearby bright star count**

In `js/engine.js`, inside `createStars()` replace the three `makeStarLayer` calls (lines 333-339):

```js
  // Layer 1: main star field
  group.add(makeStarLayer(30000, 4000, 150000, 1.4, 1.0));

  // Layer 2: distant stars
  group.add(makeStarLayer(12000, 150000, 800000, 0.8, 0.5));

  // Layer 3: nearby bright stars (navigation reference)
  group.add(makeStarLayer(2500, 400, 3000, 3.5, 0.9));
```

- [ ] **Step 4: Test visually**

Run: `python -m http.server 8080` and open `localhost:8080`.
Expected: Milky Way band clearly visible as a luminous band across the sky. Faint galactic core glow in the center. More stars visible overall. Space feels like a galaxy, not empty void.

- [ ] **Step 5: Commit**

```bash
git add js/engine.js
git commit -m "feat: enhanced galaxy feel — denser Milky Way, galactic core glow, more stars"
```

---

## Phase 2: Engine Foundation

### Task 2.1: Logarithmic Depth Buffer

**Files:**
- Modify: `js/engine.js:122-132` (renderer setup)

- [ ] **Step 1: Enable logarithmic depth buffer**

In `js/engine.js`, replace the renderer creation (lines 122-132):

```js
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
```

- [ ] **Step 2: Adjust camera near/far planes**

In `js/engine.js`, replace the camera creation (lines 138-142):

```js
  camera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    0.1,
    100000000
  );
```

- [ ] **Step 3: Test visually**

Run server and verify: no z-fighting on planets, Sun glow shells render correctly, distant skybox still visible. Fly close to a planet and verify no clipping artifacts.

- [ ] **Step 4: Commit**

```bash
git add js/engine.js
git commit -m "feat: logarithmic depth buffer for space-to-surface scale range"
```

---

### Task 2.2: Camera-Relative Rendering

**Files:**
- Modify: `js/engine.js` (add camera-relative update export)
- Modify: `js/main.js` (apply camera-relative offset in render loop)
- Modify: `js/flight.js` (expose logical camera position separate from Three.js camera)

- [ ] **Step 1: Add scene offset tracking to engine.js**

In `js/engine.js`, after the module state declarations (after line 11), add:

```js
// Camera-relative rendering offset
const sceneOffset = new THREE.Vector3();

export function getSceneOffset() { return sceneOffset; }
```

Add a new exported function at the bottom of engine.js (before the closing):

```js
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

  scene.traverse((obj) => {
    if (obj === scene || obj === camera) return;
    // Only offset root-level objects (children of scene)
    if (obj.parent === scene && obj.userData._worldPos) {
      obj.position.copy(obj.userData._worldPos).sub(sceneOffset);
    }
  });
}

/**
 * Store an object's true world position for camera-relative offsetting.
 * Call when placing objects in the scene.
 */
export function setWorldPos(obj, pos) {
  if (!obj.userData._worldPos) {
    obj.userData._worldPos = new THREE.Vector3();
  }
  obj.userData._worldPos.copy(pos);
  obj.position.copy(pos);
}
```

- [ ] **Step 2: Tag existing objects with world positions in bodies.js**

In `js/bodies.js`, add import at the top:

```js
import { setWorldPos } from './engine.js';
```

In `createSolarSystem`, after `scene.add(sunGroup)` (line 119), add:

```js
  setWorldPos(sunGroup, sunGroup.position);
```

In the `defs.forEach` loop, replace the line `group.position.set(...)` (line 229) pattern. After each `scene.add(group)` for non-moon planets, add a `setWorldPos` call. Specifically replace lines 227-233:

```js
    if (def.moonOrbit) {
      moonRef = entry;
      scene.add(group);
      setWorldPos(group, group.position);
    } else {
      const pos = new THREE.Vector3(
        Math.cos(angle) * def.orb * AU, 0, Math.sin(angle) * def.orb * AU
      );
      group.position.copy(pos);
      scene.add(group);
      setWorldPos(group, pos);
    }
```

In `updateBodies`, when updating planet positions (line 434-438), update world pos too:

```js
    p.g.position.set(
      Math.cos(p.angle) * p.orb * AU,
      0,
      Math.sin(p.angle) * p.orb * AU
    );
    if (p.g.userData._worldPos) p.g.userData._worldPos.copy(p.g.position);
```

And for Moon (lines 457-460):

```js
    moonRef.g.position.set(
      ex + Math.cos(moonAngle) * moonDist,
      0,
      ez + Math.sin(moonAngle) * moonDist
    );
    if (moonRef.g.userData._worldPos) moonRef.g.userData._worldPos.copy(moonRef.g.position);
```

- [ ] **Step 3: Apply camera-relative rendering in main loop**

In `js/main.js`, add `applyCameraRelative` to imports (line 4):

```js
import { initEngine, getSunLight, getDistortionPass, updateFilmGrain, createSkybox, createStars, applyCameraRelative } from './engine.js';
```

In the `animate()` function, just before `renderer.render(scene, camera)` (line 150), add:

```js
      // Camera-relative rendering — shift world so camera is at origin
      applyCameraRelative(getCamPos());
```

- [ ] **Step 4: Update flight.js camera application**

In `js/flight.js`, the camera position/quaternion updates (lines 310-314) need to set position to origin since camera-relative rendering handles it. Replace:

```js
    cam.position.copy(camPos);
    cam.quaternion.copy(camQuat);
```

with:

```js
    // Position is handled by camera-relative rendering in main loop
    // Camera stays at origin; we just set orientation
    cam.quaternion.copy(camQuat);
```

Also replace the return-home camera update (lines 196-197):

```js
        cam.position.copy(camPos);
        cam.quaternion.copy(camQuat);
```

with:

```js
        cam.quaternion.copy(camQuat);
```

- [ ] **Step 5: Test visually**

Run server. Expected: Scene looks identical to before. Planets orbit, flight works, HUD shows correct distances. The change is invisible — it's a precision infrastructure upgrade. Fly very far from the Sun (use warp) and verify no jittering or visual artifacts.

- [ ] **Step 6: Commit**

```bash
git add js/engine.js js/bodies.js js/main.js js/flight.js
git commit -m "feat: camera-relative rendering for float32 precision at any distance"
```

---

### Task 2.3: GPU Performance Benchmark

**Files:**
- Create: `js/perf.js`
- Modify: `js/main.js` (run benchmark during boot)

- [ ] **Step 1: Create perf.js**

Create `js/perf.js`:

```js
// perf.js — GPU performance tier detection
import * as THREE from 'three';

/**
 * Performance tier: 'high', 'medium', or 'low'.
 * Determined at startup by rendering a test scene.
 */
let tier = 'medium'; // default until benchmark runs

/**
 * Tier-dependent configuration values.
 */
const TIER_CONFIG = {
  high: {
    terrainMaxDepth: 15,
    chunkGrid: 33,
    atmosphereQuality: 'full',      // full Rayleigh/Mie
    cloudLayers: 3,
    descentParticles: 500,
    cameraShake: 1.0,
    noiseOctaves: 8,
    shadows: 'soft',
    chunksPerFrame: 3,
  },
  medium: {
    terrainMaxDepth: 12,
    chunkGrid: 17,
    atmosphereQuality: 'simple',    // 2-color lerp
    cloudLayers: 2,
    descentParticles: 150,
    cameraShake: 0.5,
    noiseOctaves: 5,
    shadows: 'hard',
    chunksPerFrame: 2,
  },
  low: {
    terrainMaxDepth: 9,
    chunkGrid: 9,
    atmosphereQuality: 'minimal',   // flat gradient
    cloudLayers: 1,
    descentParticles: 50,
    cameraShake: 0,
    noiseOctaves: 3,
    shadows: 'none',
    chunksPerFrame: 1,
  },
};

/**
 * Run a GPU benchmark by rendering a test scene and measuring frame time.
 * @param {THREE.WebGLRenderer} renderer
 * @returns {string} 'high' | 'medium' | 'low'
 */
export function runBenchmark(renderer) {
  const testScene = new THREE.Scene();
  const testCam = new THREE.PerspectiveCamera(70, 1, 0.1, 1000);
  testCam.position.set(0, 0, 50);

  // Test geometry: 64x64 subdivided sphere (similar to a terrain chunk)
  const geo = new THREE.SphereGeometry(10, 64, 64);
  const mat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.5 });
  testScene.add(new THREE.Mesh(geo, mat));
  testScene.add(new THREE.PointLight(0xffffff, 3));
  testScene.add(new THREE.AmbientLight(0x333333, 1));

  // Warm up
  renderer.setSize(256, 256);
  renderer.render(testScene, testCam);
  renderer.render(testScene, testCam);

  // Benchmark: average of 5 frames
  const times = [];
  for (let i = 0; i < 5; i++) {
    const start = performance.now();
    renderer.render(testScene, testCam);
    // Force GPU sync by reading a pixel
    const gl = renderer.getContext();
    const buf = new Uint8Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    times.push(performance.now() - start);
  }

  // Restore renderer size
  renderer.setSize(window.innerWidth, window.innerHeight);

  // Clean up
  geo.dispose();
  mat.dispose();

  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  console.log(`[perf] GPU benchmark: ${avg.toFixed(1)}ms avg (${times.map(t => t.toFixed(1)).join(', ')})`);

  if (avg < 8) {
    tier = 'high';
  } else if (avg < 20) {
    tier = 'medium';
  } else {
    tier = 'low';
  }

  console.log(`[perf] Detected tier: ${tier}`);
  return tier;
}

/**
 * Get the current performance tier.
 */
export function getTier() { return tier; }

/**
 * Get config for the current tier.
 */
export function getConfig() { return TIER_CONFIG[tier]; }

/**
 * Manually override the tier (user settings).
 */
export function setTier(newTier) {
  if (TIER_CONFIG[newTier]) {
    tier = newTier;
    console.log(`[perf] Tier manually set to: ${tier}`);
  }
}

/**
 * Runtime adaptation: call each frame with the frame time in ms.
 * If performance drops below 30fps for 2+ seconds, drops one tier.
 */
let slowFrameAccum = 0;

export function adaptTier(frameTimeMs) {
  if (frameTimeMs > 33) {
    slowFrameAccum += frameTimeMs / 1000;
    if (slowFrameAccum > 2) {
      if (tier === 'high') {
        tier = 'medium';
        console.log('[perf] Adaptive drop: high → medium');
      } else if (tier === 'medium') {
        tier = 'low';
        console.log('[perf] Adaptive drop: medium → low');
      }
      slowFrameAccum = 0;
    }
  } else {
    slowFrameAccum = Math.max(0, slowFrameAccum - frameTimeMs / 1000);
  }
}
```

- [ ] **Step 2: Run benchmark during boot in main.js**

In `js/main.js`, add import:

```js
import { runBenchmark, getTier, getConfig, adaptTier } from './perf.js';
```

In the `boot()` function, after `const { scene, camera, composer, renderer } = initEngine();` (line 24), add:

```js
  // 2b. GPU performance benchmark
  const perfTier = runBenchmark(renderer);
  console.log(`[boot] Performance tier: ${perfTier}`, getConfig());
```

In the `animate()` function, after the `const dt` calculation (line 86), add:

```js
      // Adaptive performance
      adaptTier(now - lastTime);
```

Note: `now - lastTime` is the raw frame time in ms (before the dt clamping).

- [ ] **Step 3: Test in console**

Run server, open browser console. Expected: see `[perf] GPU benchmark: Xms avg (...)` and `[perf] Detected tier: high/medium/low` and `[boot] Performance tier: ...` with config object.

- [ ] **Step 4: Commit**

```bash
git add js/perf.js js/main.js
git commit -m "feat: GPU benchmark and adaptive performance tiers"
```

---

### Task 2.4: Altitude Tracking System

**Files:**
- Create: `js/altitude.js`
- Modify: `js/main.js` (integrate altitude updates)

- [ ] **Step 1: Create altitude.js**

Create `js/altitude.js`:

```js
// altitude.js — Continuous altitude tracking above nearest planet surface
import * as THREE from 'three';

const _vec = new THREE.Vector3();

/**
 * @typedef {Object} AltitudeState
 * @property {string|null} nearestBody — name of nearest body
 * @property {number} distToCenter — distance from camera to body center
 * @property {number} bodyRadius — radius of the body
 * @property {number} altitude — height above surface (distToCenter - bodyRadius)
 * @property {number} altitudeNorm — altitude / bodyRadius (1.0 = one radius above surface)
 * @property {boolean} isGasGiant — true if nearest body is a gas giant
 * @property {boolean} hasAtmosphere — true if body has an atmosphere
 * @property {Object|null} body — reference to the nearest body object
 */

/** @type {AltitudeState} */
const state = {
  nearestBody: null,
  distToCenter: Infinity,
  bodyRadius: 0,
  altitude: Infinity,
  altitudeNorm: Infinity,
  isGasGiant: false,
  hasAtmosphere: false,
  body: null,
};

const GAS_GIANTS = ['JUPITER', 'SATURN', 'URANUS', 'NEPTUNE'];
const ATMOSPHERE_BODIES = ['VENUS', 'EARTH', 'MARS', 'JUPITER', 'SATURN', 'URANUS', 'NEPTUNE'];

/**
 * Update altitude state. Call every frame.
 * @param {THREE.Vector3} camPos — player world position
 * @param {Array} allBodies — array of { name, g, r, ... }
 */
export function updateAltitude(camPos, allBodies) {
  let nearest = null;
  let minDist = Infinity;

  for (let i = 0; i < allBodies.length; i++) {
    const b = allBodies[i];
    if (!b.g || !b.r) continue;
    const d = camPos.distanceTo(b.g.position);
    // Use surface distance for comparison (closer to surface = more relevant)
    const surfDist = d - b.r;
    if (surfDist < minDist) {
      minDist = surfDist;
      nearest = b;
      state.distToCenter = d;
    }
  }

  if (nearest) {
    state.nearestBody = nearest.name;
    state.bodyRadius = nearest.r;
    state.altitude = Math.max(0, state.distToCenter - nearest.r);
    state.altitudeNorm = state.altitude / nearest.r;
    state.isGasGiant = GAS_GIANTS.indexOf(nearest.name) !== -1;
    state.hasAtmosphere = ATMOSPHERE_BODIES.indexOf(nearest.name) !== -1;
    state.body = nearest;
  } else {
    state.nearestBody = null;
    state.distToCenter = Infinity;
    state.bodyRadius = 0;
    state.altitude = Infinity;
    state.altitudeNorm = Infinity;
    state.isGasGiant = false;
    state.hasAtmosphere = false;
    state.body = null;
  }
}

/**
 * Get current altitude state. Read-only reference — do not mutate.
 * @returns {AltitudeState}
 */
export function getAltitude() {
  return state;
}
```

- [ ] **Step 2: Integrate into main loop**

In `js/main.js`, add import:

```js
import { updateAltitude, getAltitude } from './altitude.js';
```

In the `animate()` function, after `updateFlight(dt, allBodies)` (line 99), add:

```js
      // Update altitude tracking
      updateAltitude(getCamPos(), allBodies);
```

- [ ] **Step 3: Test in console**

In the browser console, after launching, run:
```js
// Import is module-scoped, but we can verify via HUD or add temp logging
```

Add a temporary `console.log` in the animate loop after `updateAltitude`:
```js
if (Math.random() < 0.005) console.log('[altitude]', getAltitude().nearestBody, getAltitude().altitude.toFixed(1), 'alt-norm:', getAltitude().altitudeNorm.toFixed(2));
```

Expected: Console shows nearest body name and altitude decreasing as you fly toward a planet. Remove the temp log after testing.

- [ ] **Step 4: Commit**

```bash
git add js/altitude.js js/main.js
git commit -m "feat: altitude tracking system — nearest body, surface distance, atmosphere detection"
```

---

## Phase 3: Planet Scale & Configuration

### Task 3.1: Scale Up Planets and Orbits

**Files:**
- Modify: `js/bodies.js:5` (AU constant)
- Modify: `js/bodies.js:138-178` (planet defs — radii)
- Modify: `js/hud.js:3` (AU constant)
- Modify: `js/music.js:3` (AU constant)
- Modify: `js/deepspace.js:4` (AU constant)
- Modify: `js/flight.js:4-11` (speed/range constants)

- [ ] **Step 1: Create shared constants module**

Create `js/constants.js`:

```js
// constants.js — Shared scale constants
// AU = scene units per astronomical unit
// Scaled 20x from original (55 → 1100) to match 20x larger planet radii
export const AU = 1100;
```

- [ ] **Step 2: Update bodies.js to use shared AU and scaled radii**

In `js/bodies.js`, replace `const AU = 55;` (line 5) with:

```js
import { AU } from './constants.js';
```

Replace the planet defs array (lines 138-178). Each radius is scaled ~20x from original:

```js
  const defs = [
    { name: 'MERCURY', desc: 'Smallest planet. Cratered surface, extreme temperature swings of 600°C.',
      r: 8, orb: .387, spd: 4.15, atmC: null,
      mat: new THREE.MeshStandardMaterial({ map: textures.mercury, roughness: .95, metalness: .05 }) },

    { name: 'VENUS', desc: 'Hottest planet at 465°C. Thick sulphuric acid cloud cover.',
      r: 19, orb: .723, spd: 1.62, atmC: [22, 0xffcc55, .62, 4.2],
      mat: new THREE.MeshStandardMaterial({ map: textures.venus, roughness: .8, metalness: 0 }) },

    { name: 'EARTH', desc: 'Our home. 71% ocean. City lights visible on the dark side.',
      r: 20, orb: 1.0, spd: 1.0, atmC: [23, 0x55aaff, .52, 4.0], clouds: true,
      mat: earthMat },

    { name: 'MOON', desc: "Earth's only natural satellite. Tidally locked, 384,400 km away.",
      r: 5.4, orb: 1.0, spd: 1.0, moonOrbit: true, atmC: null,
      mat: new THREE.MeshStandardMaterial({ map: textures.moon, roughness: .95, metalness: 0 }) },

    { name: 'MARS', desc: 'The Red Planet. Valles Marineris — 4,000 km canyon. Polar ice caps.',
      r: 11, orb: 1.524, spd: .531, atmC: [12, 0xff7755, .32, 7],
      mat: new THREE.MeshStandardMaterial({ map: textures.mars, roughness: .92, metalness: 0 }) },

    { name: 'JUPITER', desc: 'Largest planet. Great Red Spot — a storm for centuries.',
      r: 110, orb: 5.203, spd: .084, atmC: [115, 0xddaa55, .36, 5],
      mat: new THREE.MeshStandardMaterial({ map: textures.jupiter, roughness: .4, metalness: 0 }) },

    { name: 'SATURN', desc: 'Ring system spans 280,000 km yet averages ~10m thick.',
      r: 92, orb: 9.537, spd: .034, atmC: [96, 0xeedd88, .32, 5.5], rings: true,
      mat: new THREE.MeshStandardMaterial({ map: textures.saturn, roughness: .4, metalness: 0 }) },

    { name: 'URANUS', desc: 'Ice giant tilted 98°. Rotates on its side.',
      r: 42, orb: 19.19, spd: .012, atmC: [46, 0x99eeff, .5, 3.8],
      mat: new THREE.MeshStandardMaterial({ map: textures.uranus, roughness: .25, metalness: .12 }) },

    { name: 'NEPTUNE', desc: 'Windiest world. Storms reach 2,100 km/h. 165-year orbit.',
      r: 40, orb: 30.07, spd: .006, atmC: [44, 0x3366ff, .54, 4.2],
      mat: new THREE.MeshStandardMaterial({ map: textures.neptune, roughness: .25, metalness: .12 }) },

    { name: 'PLUTO', desc: 'Dwarf planet with a heart-shaped nitrogen glacier. 248-year orbit.',
      r: 3.6, orb: 39.48, spd: .004, atmC: null,
      mat: new THREE.MeshStandardMaterial({ map: textures.pluto, roughness: .9, metalness: 0 }) },
  ];
```

- [ ] **Step 3: Update Sun radius**

In `js/bodies.js`, update the Sun sphere geometry (line 102-104):

```js
  sunMesh = new THREE.Mesh(
    new THREE.SphereGeometry(100, 64, 64),
    new THREE.MeshBasicMaterial({ map: textures.sun })
  );
```

Update glow shells (lines 109-115) to scale with new Sun radius of 100:

```js
  [[114,0xffbb44,.22],[140,0xff8800,.085],[200,0xff5500,.036],[320,0xff3300,.014],[560,0xff9900,.005],[1000,0xffcc00,.002]]
    .forEach(([r, c, a]) =>
      sunGroup.add(new THREE.Mesh(
        new THREE.SphereGeometry(r, 32, 32),
        new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: a, blending: THREE.AdditiveBlending, depthWrite: false })
      ))
    );

  sunGroup.add(mkAtm(136, 0xff8800, .62, 3.8));
  sunGroup.add(mkAtm(180, 0xff5500, .46, 5.5));
```

Update the Sun body entry (line 121):

```js
  bodies.push({ name: 'SUN', desc: 'Our star. 4.6 billion years old, 1.4 million km diameter. 99.86% of the solar system mass.', g: sunGroup, r: 100 });
```

- [ ] **Step 4: Update Moon orbit distance**

In `js/bodies.js`, update Moon orbit distance in `updateBodies` (line 454):

```js
    const moonDist = 80;  // scaled from 4.0 with 20x planet scale
```

- [ ] **Step 5: Update dwarf planet radii**

In `js/bodies.js`, update `buildDwarfPlanets` (lines 259-280):

```js
  const dwarfs = [
    { name: 'CERES', desc: 'Largest object in the asteroid belt. Dwarf planet, 940 km diameter.',
      r: 1.6, orb: 2.77, color: 0x888888, spd: 0.18 },
    { name: 'ERIS', desc: 'Most massive dwarf planet. Icy surface, 96 AU aphelion.',
      r: 3, orb: 67.7, color: 0xccddee, spd: 0.0016 },
  ];
```

- [ ] **Step 6: Update asteroid/Kuiper belt scales**

In `buildAsteroidBelt`, update y-spread (line 363):

```js
    const ySpread = (Math.random() - 0.5) * 30;  // scaled from 1.5
```

And particle size (line 378):

```js
    size: 1.3, map: getPointTexture(), vertexColors: true, sizeAttenuation: true,
```

In `buildKuiperBelt`, update y-spread (line 399):

```js
    const ySpread = (Math.random() - 0.5) * 60;  // scaled from 3.0
```

And particle size (line 412):

```js
    size: 0.8, map: getPointTexture(), vertexColors: true, sizeAttenuation: true,
```

- [ ] **Step 7: Update all modules using AU constant**

In `js/hud.js`, replace `const AU = 55;` (line 3) with:

```js
import { AU } from './constants.js';
```

In `js/music.js`, replace `const AU = 55;` (line 3) with:

```js
import { AU } from './constants.js';
```

In `js/deepspace.js`, replace `const AU = 55;` (line 4) with:

```js
import { AU } from './constants.js';
```

- [ ] **Step 8: Update flight constants for new scale**

In `js/flight.js`, add import and update constants (lines 1-11):

```js
import * as THREE from 'three';
import { AU } from './constants.js';

// ── Constants ────────────────────────────────────────────────────────────────
const THRUST_ACCEL       = 40;       // scaled 20x from 2.0
const WARP_MULTIPLIER    = 25;
const LINEAR_DAMPING     = 0.035;
const ANGULAR_DAMPING    = 0.08;
const MAX_BASE_SPEED     = 2400;     // scaled 20x from 120
const MOUSE_SENS         = 0.002;
const ROLL_ACCEL         = 1.5;
const GRAVITY_RANGE_MULT = 5;
const BH_GRAVITY_RANGE_MULT = 50;
```

Update home position (lines 15-16):

```js
const homePos  = new THREE.Vector3(0, 1200, 4400);  // scaled 20x
const homeQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.27, 0, 0));
```

Update the home-button distance threshold in `updateHUD` (line 330):

```js
    elHomeBtn.style.display = camPos.length() > 7000 ? 'block' : 'none';
```

- [ ] **Step 9: Update comet scales in bodies.js**

In `buildComets`, update the comet defs (lines 289-293):

```js
  const cometDefs = [
    { a: 360, b: 120, cx: -280, spd: 0.035, tilt: 0.3 },
    { a: 560, b: 200, cx: -400, spd: 0.02, tilt: -0.15 },
    { a: 800, b: 280, cx: -600, spd: 0.012, tilt: 0.45 },
  ];
```

Update comet head size (line 299):

```js
      new THREE.SphereGeometry(1, 16, 16),
```

Update comet glow size (line 303):

```js
      new THREE.SphereGeometry(5, 16, 16),
```

Update trail particle size (line 333):

```js
      size: 1.6, map: getPointTexture(), vertexColors: true, sizeAttenuation: true,
```

- [ ] **Step 10: Test visually**

Run server. Expected: Planets are dramatically larger. Flying toward Earth, it fills the view and feels massive. Jupiter is enormous. Orbits are proportionally wider. Flight speed feels the same as before (scaled proportionally). All HUD readouts still work.

- [ ] **Step 11: Commit**

```bash
git add js/constants.js js/bodies.js js/hud.js js/music.js js/deepspace.js js/flight.js
git commit -m "feat: 20x planet scale with shared AU constant, proportional flight speeds"
```

---

### Task 3.2: Per-Planet Terrain & Atmosphere Configuration Data

**Files:**
- Create: `js/planetconfig.js`

- [ ] **Step 1: Create planet configuration data**

Create `js/planetconfig.js`:

```js
// planetconfig.js — Per-planet terrain, atmosphere, and surface configuration
// Used by terrain system, atmosphere renderer, gas giant dive, and HUD

/**
 * @typedef {Object} TerrainConfig
 * @property {string} type — 'rocky' | 'gas' | 'ice' | 'none'
 * @property {number} heightScale — max terrain height in scene units
 * @property {number} craterDensity — 0-1, how many craters
 * @property {number} roughness — fractal roughness 0-1
 * @property {string[]} biomes — terrain biome types
 * @property {Object[]} macroFeatures — large-scale features (canyons, basins, volcanoes)
 */

/**
 * @typedef {Object} AtmosphereConfig
 * @property {boolean} hasAtmosphere
 * @property {number} density — relative to Earth (1.0)
 * @property {number} scaleHeight — in scene units (relative to planet radius)
 * @property {number[]} rayleighCoeff — [r, g, b] scattering coefficients
 * @property {number[]} mieCoeff — Mie scattering coefficient
 * @property {number} mieG — Mie scattering direction (-1 to 1)
 * @property {string} skyTint — hex color for simplified atmosphere
 * @property {Object[]} cloudLayers — altitude bands for clouds
 * @property {string} particleType — 'dust' | 'rain' | 'ice' | 'ash' | 'none'
 */

/**
 * @typedef {Object} GasGiantConfig
 * @property {number} crushDepthNorm — altitudeNorm at which ejection triggers
 * @property {string} bandColor1 — primary band color hex
 * @property {string} bandColor2 — secondary band color hex
 * @property {number} windIntensity — 0-1, drives horizontal camera shake
 * @property {boolean} lightning — whether lightning flashes occur
 * @property {string} desc — description for deep atmosphere phase
 */

export const PLANET_CONFIGS = {
  SUN: {
    terrain: { type: 'none' },
    atmosphere: { hasAtmosphere: false },
  },

  MERCURY: {
    terrain: {
      type: 'rocky',
      heightScale: 0.8,
      craterDensity: 0.9,
      roughness: 0.7,
      biomes: ['crater_field', 'smooth_plains', 'scarps'],
      macroFeatures: [
        { name: 'Caloris Basin', type: 'depression', lat: 30, lon: 170, radius: 0.15, depth: 0.6 },
      ],
    },
    atmosphere: { hasAtmosphere: false },
    surface: {
      skyColor: null, // black sky
      sunAppSize: 2.5, // relative to Earth's sun
      temperature: { day: 430, night: -180, unit: '°C' },
      pressure: 0,
    },
  },

  VENUS: {
    terrain: {
      type: 'rocky',
      heightScale: 0.5,
      craterDensity: 0.2,
      roughness: 0.4,
      biomes: ['volcanic_plains', 'shield_volcano', 'tessera'],
      macroFeatures: [
        { name: 'Maat Mons', type: 'volcano', lat: 0.5, lon: 194, radius: 0.05, height: 0.8 },
      ],
    },
    atmosphere: {
      hasAtmosphere: true,
      density: 90,
      scaleHeight: 0.04, // relative to radius
      rayleighCoeff: [0.8, 0.5, 0.1],
      mieCoeff: [0.02],
      mieG: 0.76,
      skyTint: '#cc9933',
      cloudLayers: [
        { altNorm: 0.15, thickness: 0.05, opacity: 0.95, color: '#ddaa44' }, // sulfuric acid deck
      ],
      particleType: 'ash',
      visibility: 0.05, // fraction of normal (very low)
    },
    surface: {
      skyColor: '#aa7722',
      sunAppSize: 0.9,
      temperature: { value: 465, unit: '°C' },
      pressure: 92, // atm
      surfaceGlow: '#331100', // faint heat glow
    },
  },

  EARTH: {
    terrain: {
      type: 'rocky',
      heightScale: 1.0,
      craterDensity: 0.01,
      roughness: 0.5,
      biomes: ['ocean', 'mountain', 'plains', 'desert', 'ice_cap'],
      macroFeatures: [],
      oceanLevel: 0.4, // fraction of height range that is ocean
    },
    atmosphere: {
      hasAtmosphere: true,
      density: 1.0,
      scaleHeight: 0.042, // ~8.5km / 200km radius in scene
      rayleighCoeff: [5.5e-6, 13.0e-6, 22.4e-6],
      mieCoeff: [21e-6],
      mieG: 0.758,
      skyTint: '#4488cc',
      cloudLayers: [
        { altNorm: 0.01, thickness: 0.005, opacity: 0.6, color: '#ffffff' },  // cumulus ~2km
        { altNorm: 0.05, thickness: 0.01, opacity: 0.3, color: '#eeeeff' },   // cirrus ~10km
      ],
      particleType: 'rain',
    },
    surface: {
      skyColor: '#6699cc',
      sunAppSize: 1.0,
      temperature: { value: 15, unit: '°C' },
      pressure: 1.0,
    },
  },

  MOON: {
    terrain: {
      type: 'rocky',
      heightScale: 0.6,
      craterDensity: 0.85,
      roughness: 0.65,
      biomes: ['highland', 'mare', 'crater_field'],
      macroFeatures: [],
    },
    atmosphere: { hasAtmosphere: false },
    surface: {
      skyColor: null,
      sunAppSize: 1.0,
      temperature: { day: 127, night: -173, unit: '°C' },
      pressure: 0,
      earthVisible: true,
    },
  },

  MARS: {
    terrain: {
      type: 'rocky',
      heightScale: 1.2,
      craterDensity: 0.4,
      roughness: 0.6,
      biomes: ['red_desert', 'canyon', 'crater_field', 'polar_ice'],
      macroFeatures: [
        { name: 'Valles Marineris', type: 'canyon', lat: -14, lon: -70, radius: 0.2, depth: 1.0 },
        { name: 'Olympus Mons', type: 'volcano', lat: 18, lon: -134, radius: 0.08, height: 1.5 },
      ],
    },
    atmosphere: {
      hasAtmosphere: true,
      density: 0.006,
      scaleHeight: 0.1, // ~11km / 110km scene radius... proportionally thicker
      rayleighCoeff: [19.918e-6, 13.57e-6, 5.75e-6], // inverted from Earth — blue sunsets
      mieCoeff: [40e-6], // dusty
      mieG: 0.65,
      skyTint: '#bb8855',
      cloudLayers: [
        { altNorm: 0.03, thickness: 0.02, opacity: 0.15, color: '#ddccaa' }, // thin dust
      ],
      particleType: 'dust',
    },
    surface: {
      skyColor: '#bb8855',
      sunAppSize: 0.65,
      temperature: { value: -63, unit: '°C' },
      pressure: 0.006,
      dustDevils: true,
    },
  },

  JUPITER: {
    terrain: { type: 'gas' },
    atmosphere: {
      hasAtmosphere: true,
      density: 1000, // effectively infinite
      scaleHeight: 0.02,
      rayleighCoeff: [3.0e-6, 5.0e-6, 8.0e-6],
      mieCoeff: [50e-6],
      mieG: 0.8,
      skyTint: '#aa8844',
      cloudLayers: [
        { altNorm: 0.3, thickness: 0.1, opacity: 0.7, color: '#ddaa66' },
        { altNorm: 0.15, thickness: 0.08, opacity: 0.85, color: '#aa7744' },
      ],
      particleType: 'none',
    },
    gasGiant: {
      crushDepthNorm: 0.15,
      bandColor1: '#cc9955',
      bandColor2: '#884422',
      windIntensity: 0.6,
      lightning: true,
      desc: 'Hydrogen ocean beneath. Pressure exceeds 1 million atmospheres.',
    },
  },

  SATURN: {
    terrain: { type: 'gas' },
    atmosphere: {
      hasAtmosphere: true,
      density: 500,
      scaleHeight: 0.025,
      rayleighCoeff: [4.0e-6, 6.0e-6, 7.0e-6],
      mieCoeff: [30e-6],
      mieG: 0.75,
      skyTint: '#ccaa66',
      cloudLayers: [
        { altNorm: 0.25, thickness: 0.1, opacity: 0.5, color: '#eedd88' },
      ],
      particleType: 'none',
    },
    gasGiant: {
      crushDepthNorm: 0.18,
      bandColor1: '#eedd88',
      bandColor2: '#aa9955',
      windIntensity: 0.4,
      lightning: false,
      desc: 'Metallic hydrogen mantle. Ring shadows dance across the clouds.',
    },
  },

  URANUS: {
    terrain: { type: 'gas' },
    atmosphere: {
      hasAtmosphere: true,
      density: 200,
      scaleHeight: 0.03,
      rayleighCoeff: [2.0e-6, 8.0e-6, 12.0e-6],
      mieCoeff: [15e-6],
      mieG: 0.7,
      skyTint: '#88ccdd',
      cloudLayers: [
        { altNorm: 0.2, thickness: 0.08, opacity: 0.4, color: '#99ddee' },
      ],
      particleType: 'ice',
    },
    gasGiant: {
      crushDepthNorm: 0.2,
      bandColor1: '#88ccdd',
      bandColor2: '#5599aa',
      windIntensity: 0.3,
      lightning: false,
      desc: 'Water-ammonia ocean. 98° axial tilt creates extreme seasons.',
    },
  },

  NEPTUNE: {
    terrain: { type: 'gas' },
    atmosphere: {
      hasAtmosphere: true,
      density: 300,
      scaleHeight: 0.025,
      rayleighCoeff: [1.0e-6, 4.0e-6, 15.0e-6],
      mieCoeff: [20e-6],
      mieG: 0.72,
      skyTint: '#3355aa',
      cloudLayers: [
        { altNorm: 0.22, thickness: 0.1, opacity: 0.6, color: '#4466bb' },
      ],
      particleType: 'none',
    },
    gasGiant: {
      crushDepthNorm: 0.18,
      bandColor1: '#3355aa',
      bandColor2: '#222266',
      windIntensity: 1.0, // fastest winds in solar system
      lightning: true,
      desc: 'Supersonic methane winds. Diamond rain in the deep interior.',
    },
  },

  PLUTO: {
    terrain: {
      type: 'ice',
      heightScale: 0.3,
      craterDensity: 0.15,
      roughness: 0.3,
      biomes: ['nitrogen_ice', 'ice_mountains'],
      macroFeatures: [
        { name: 'Sputnik Planitia', type: 'basin', lat: 25, lon: -175, radius: 0.12, depth: 0.1 },
      ],
    },
    atmosphere: {
      hasAtmosphere: true,
      density: 0.00001,
      scaleHeight: 0.15,
      rayleighCoeff: [1.0e-6, 1.5e-6, 2.0e-6],
      mieCoeff: [5e-6],
      mieG: 0.6,
      skyTint: '#111118',
      cloudLayers: [],
      particleType: 'none',
      visibility: 0.8,
    },
    surface: {
      skyColor: '#0a0a12',
      sunAppSize: 0.04,
      temperature: { value: -230, unit: '°C' },
      pressure: 0.00001,
    },
  },
};

/**
 * Get config for a planet by name.
 * @param {string} name — planet name in uppercase (e.g. 'EARTH')
 * @returns {Object|null}
 */
export function getPlanetConfig(name) {
  return PLANET_CONFIGS[name] || null;
}
```

- [ ] **Step 2: Test import**

Add a temporary import in `main.js` to verify the module loads:

```js
import { getPlanetConfig } from './planetconfig.js';
```

And in boot(), add: `console.log('[config] Earth:', getPlanetConfig('EARTH'));`

Expected: config object logged with terrain, atmosphere, and surface sections. Remove temp log after verification.

- [ ] **Step 3: Commit**

```bash
git add js/planetconfig.js js/constants.js
git commit -m "feat: per-planet terrain, atmosphere, and surface config data"
```

---

## Phase 4: Terrain System

### Task 4.1: Procedural Noise Module

**Files:**
- Create: `js/terrain/noise.js`

- [ ] **Step 1: Create noise.js with fractal noise and planet modifiers**

Create `js/terrain/noise.js`:

```js
// terrain/noise.js — Procedural noise for terrain generation
// Runs in both main thread and Web Worker (pure math, no DOM/Three.js)

/**
 * Simple hash-based pseudo-random. Deterministic for same inputs.
 */
function hash2(x, y) {
  let v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return v - Math.floor(v);
}

function hash3(x, y, z) {
  let v = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return v - Math.floor(v);
}

/**
 * Smooth noise 2D with cubic interpolation.
 */
function smoothNoise2(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  return hash2(xi, yi) * (1 - u) * (1 - v)
       + hash2(xi + 1, yi) * u * (1 - v)
       + hash2(xi, yi + 1) * (1 - u) * v
       + hash2(xi + 1, yi + 1) * u * v;
}

/**
 * Smooth noise 3D — for sphere-mapped terrain (avoids polar pinching).
 */
function smoothNoise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const w = zf * zf * (3 - 2 * zf);

  const a = hash3(xi, yi, zi) * (1 - u) * (1 - v) * (1 - w);
  const b = hash3(xi + 1, yi, zi) * u * (1 - v) * (1 - w);
  const c = hash3(xi, yi + 1, zi) * (1 - u) * v * (1 - w);
  const d = hash3(xi + 1, yi + 1, zi) * u * v * (1 - w);
  const e = hash3(xi, yi, zi + 1) * (1 - u) * (1 - v) * w;
  const f = hash3(xi + 1, yi, zi + 1) * u * (1 - v) * w;
  const g = hash3(xi, yi + 1, zi + 1) * (1 - u) * v * w;
  const h = hash3(xi + 1, yi + 1, zi + 1) * u * v * w;

  return a + b + c + d + e + f + g + h;
}

/**
 * Fractal Brownian Motion — 3D (for sphere surfaces).
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {number} octaves
 * @param {number} lacunarity — frequency multiplier per octave (default 2.0)
 * @param {number} persistence — amplitude multiplier per octave (default 0.5)
 * @returns {number} 0-1 range
 */
export function fbm3(x, y, z, octaves, lacunarity = 2.0, persistence = 0.5) {
  let value = 0, amplitude = 1, frequency = 1, maxAmp = 0;
  for (let i = 0; i < octaves; i++) {
    value += smoothNoise3(x * frequency, y * frequency, z * frequency) * amplitude;
    maxAmp += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }
  return value / maxAmp;
}

/**
 * Ridged multifractal noise — creates mountain ridges and canyon walls.
 */
export function ridged3(x, y, z, octaves, lacunarity = 2.0, persistence = 0.5) {
  let value = 0, amplitude = 1, frequency = 1, maxAmp = 0, prev = 1;
  for (let i = 0; i < octaves; i++) {
    let n = smoothNoise3(x * frequency, y * frequency, z * frequency);
    n = 1 - Math.abs(n * 2 - 1); // ridge transform
    n = n * n * prev;             // sharpen ridges
    prev = n;
    value += n * amplitude;
    maxAmp += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }
  return value / maxAmp;
}

/**
 * Crater function — creates a single impact crater.
 * @param {number} dist — normalized distance from crater center (0 = center, 1 = rim)
 * @param {number} rimHeight — height of the raised rim
 * @param {number} floorDepth — depth of the crater floor
 * @returns {number} height offset
 */
export function craterProfile(dist, rimHeight = 0.3, floorDepth = 0.8) {
  if (dist > 1.5) return 0;
  if (dist < 0.8) {
    // Floor — flat with slight bowl
    return -floorDepth * (1 - (dist / 0.8) * (dist / 0.8) * 0.3);
  }
  if (dist < 1.0) {
    // Rim rise
    const t = (dist - 0.8) / 0.2;
    return -floorDepth * (1 - t) + rimHeight * t;
  }
  // Outer slope
  const t = (dist - 1.0) / 0.5;
  return rimHeight * (1 - t * t);
}

/**
 * Generate terrain height for a point on a planet's surface.
 * @param {number} nx — normalized sphere x (-1 to 1)
 * @param {number} ny — normalized sphere y (-1 to 1)
 * @param {number} nz — normalized sphere z (-1 to 1)
 * @param {Object} terrainConfig — from planetconfig.js
 * @param {number} octaves — noise octaves (from perf tier)
 * @returns {number} height value (0-1 range, scaled by terrainConfig.heightScale)
 */
export function getTerrainHeight(nx, ny, nz, terrainConfig, octaves = 8) {
  if (!terrainConfig || terrainConfig.type === 'gas' || terrainConfig.type === 'none') {
    return 0;
  }

  const scale = 3.0; // base noise frequency
  let h = 0;

  // Base terrain from fbm
  h = fbm3(nx * scale, ny * scale, nz * scale, octaves);

  // Add ridged noise for mountains (weighted by roughness)
  const ridgeWeight = terrainConfig.roughness || 0.5;
  const ridge = ridged3(nx * scale * 0.8, ny * scale * 0.8, nz * scale * 0.8, Math.max(3, octaves - 2));
  h = h * (1 - ridgeWeight * 0.5) + ridge * ridgeWeight * 0.5;

  // Craters (for rocky bodies)
  if (terrainConfig.craterDensity > 0) {
    const craterContrib = applyCraters(nx, ny, nz, terrainConfig.craterDensity);
    h += craterContrib * 0.3;
  }

  // Ocean level clamping (e.g. Earth)
  if (terrainConfig.oceanLevel !== undefined) {
    h = Math.max(h, terrainConfig.oceanLevel);
  }

  return h * (terrainConfig.heightScale || 1.0);
}

/**
 * Apply procedural craters based on density.
 */
function applyCraters(nx, ny, nz, density) {
  let contribution = 0;
  // Generate a grid of potential crater centers
  const gridScale = 8;
  const gx = Math.floor(nx * gridScale);
  const gy = Math.floor(ny * gridScale);
  const gz = Math.floor(nz * gridScale);

  // Check 3x3x3 neighborhood
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        const cx = gx + dx, cy = gy + dy, cz = gz + dz;
        // Deterministic random: should this cell have a crater?
        const rnd = hash3(cx * 7.3, cy * 13.1, cz * 17.9);
        if (rnd > density) continue;

        // Crater center (jittered within cell)
        const jx = (cx + hash3(cx, cy, cz)) / gridScale;
        const jy = (cy + hash3(cy, cz, cx)) / gridScale;
        const jz = (cz + hash3(cz, cx, cy)) / gridScale;

        // Distance to crater center on unit sphere
        const dist = Math.sqrt(
          (nx - jx) * (nx - jx) +
          (ny - jy) * (ny - jy) +
          (nz - jz) * (nz - jz)
        );

        // Crater size varies
        const craterRadius = (0.02 + hash3(cx * 3.1, cy * 5.3, cz * 7.7) * 0.06);
        const normDist = dist / craterRadius;

        contribution += craterProfile(normDist, 0.2, 0.5) * craterRadius * 5;
      }
    }
  }

  return contribution;
}
```

- [ ] **Step 2: Verify module loads**

Add temp import in main.js: `import { fbm3, getTerrainHeight } from './terrain/noise.js';`
And: `console.log('[noise] test fbm3:', fbm3(1, 2, 3, 6));`

Expected: A number between 0 and 1. Remove temp log.

- [ ] **Step 3: Commit**

```bash
git add js/terrain/noise.js
git commit -m "feat: procedural noise module — fbm, ridged multifractal, craters"
```

---

### Task 4.2: Cube-Sphere Chunk Mesh Generation

**Files:**
- Create: `js/terrain/chunk.js`

- [ ] **Step 1: Create chunk.js**

Create `js/terrain/chunk.js`:

```js
// terrain/chunk.js — Generate a single terrain chunk mesh for a cube-sphere face
import * as THREE from 'three';
import { getTerrainHeight } from './noise.js';

const _normal = new THREE.Vector3();

/**
 * Map a cube face coordinate to a unit sphere point.
 * @param {number} face — 0-5 (PX, NX, PY, NY, PZ, NZ)
 * @param {number} u — 0-1 within face
 * @param {number} v — 0-1 within face
 * @returns {THREE.Vector3}
 */
export function cubeToSphere(face, u, v, out) {
  // Map u,v from [0,1] to [-1,1]
  const x2 = u * 2 - 1;
  const y2 = v * 2 - 1;

  let x, y, z;
  switch (face) {
    case 0: x =  1; y = y2; z = -x2; break; // +X
    case 1: x = -1; y = y2; z =  x2; break; // -X
    case 2: x = x2; y =  1; z = -y2; break; // +Y
    case 3: x = x2; y = -1; z =  y2; break; // -Y
    case 4: x = x2; y = y2; z =  1;  break; // +Z
    case 5: x =-x2; y = y2; z = -1;  break; // -Z
  }

  // Normalize to sphere
  const len = Math.sqrt(x * x + y * y + z * z);
  out.set(x / len, y / len, z / len);
  return out;
}

/**
 * Build a terrain chunk mesh.
 *
 * @param {number} face — cube face 0-5
 * @param {number} uMin — start U on face (0-1)
 * @param {number} vMin — start V on face (0-1)
 * @param {number} uMax — end U on face (0-1)
 * @param {number} vMax — end V on face (0-1)
 * @param {number} gridSize — vertices per side (e.g. 33)
 * @param {number} planetRadius — in scene units
 * @param {Object} terrainConfig — from planetconfig.js
 * @param {number} octaves — noise octaves (perf tier)
 * @returns {{ geometry: THREE.BufferGeometry, center: THREE.Vector3 }}
 */
export function buildChunkGeometry(face, uMin, vMin, uMax, vMax, gridSize, planetRadius, terrainConfig, octaves) {
  const vertCount = gridSize * gridSize;
  const positions = new Float32Array(vertCount * 3);
  const normals   = new Float32Array(vertCount * 3);
  const uvs       = new Float32Array(vertCount * 2);

  const sphere = new THREE.Vector3();
  const center = new THREE.Vector3();

  const uStep = (uMax - uMin) / (gridSize - 1);
  const vStep = (vMax - vMin) / (gridSize - 1);

  // Generate vertex positions
  for (let iy = 0; iy < gridSize; iy++) {
    for (let ix = 0; ix < gridSize; ix++) {
      const idx = iy * gridSize + ix;
      const u = uMin + ix * uStep;
      const v = vMin + iy * vStep;

      cubeToSphere(face, u, v, sphere);

      // Terrain height
      const h = getTerrainHeight(sphere.x, sphere.y, sphere.z, terrainConfig, octaves);
      const r = planetRadius + h * planetRadius * 0.02; // height as fraction of radius

      positions[idx * 3]     = sphere.x * r;
      positions[idx * 3 + 1] = sphere.y * r;
      positions[idx * 3 + 2] = sphere.z * r;

      uvs[idx * 2]     = ix / (gridSize - 1);
      uvs[idx * 2 + 1] = iy / (gridSize - 1);

      center.x += positions[idx * 3];
      center.y += positions[idx * 3 + 1];
      center.z += positions[idx * 3 + 2];
    }
  }

  center.divideScalar(vertCount);

  // Generate triangle indices
  const quads = (gridSize - 1) * (gridSize - 1);
  const indices = new Uint32Array(quads * 6);
  let triIdx = 0;
  for (let iy = 0; iy < gridSize - 1; iy++) {
    for (let ix = 0; ix < gridSize - 1; ix++) {
      const a = iy * gridSize + ix;
      const b = a + 1;
      const c = a + gridSize;
      const d = c + 1;
      indices[triIdx++] = a; indices[triIdx++] = c; indices[triIdx++] = b;
      indices[triIdx++] = b; indices[triIdx++] = c; indices[triIdx++] = d;
    }
  }

  // Compute normals from cross products
  // Initialize to zero
  for (let i = 0; i < normals.length; i++) normals[i] = 0;

  const pA = new THREE.Vector3(), pB = new THREE.Vector3(), pC = new THREE.Vector3();
  const cb = new THREE.Vector3(), ab = new THREE.Vector3();

  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i], ib = indices[i + 1], ic = indices[i + 2];
    pA.fromArray(positions, ia * 3);
    pB.fromArray(positions, ib * 3);
    pC.fromArray(positions, ic * 3);

    cb.subVectors(pC, pB);
    ab.subVectors(pA, pB);
    cb.cross(ab);

    normals[ia * 3]     += cb.x; normals[ia * 3 + 1] += cb.y; normals[ia * 3 + 2] += cb.z;
    normals[ib * 3]     += cb.x; normals[ib * 3 + 1] += cb.y; normals[ib * 3 + 2] += cb.z;
    normals[ic * 3]     += cb.x; normals[ic * 3 + 1] += cb.y; normals[ic * 3 + 2] += cb.z;
  }

  // Normalize
  for (let i = 0; i < vertCount; i++) {
    _normal.set(normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]).normalize();
    normals[i * 3] = _normal.x;
    normals[i * 3 + 1] = _normal.y;
    normals[i * 3 + 2] = _normal.z;
  }

  // Skirt geometry — extend edges downward to hide seams
  const skirtVerts = (gridSize * 4 - 4); // perimeter vertices
  const skirtPositions = new Float32Array((vertCount + skirtVerts) * 3);
  const skirtNormals   = new Float32Array((vertCount + skirtVerts) * 3);
  const skirtUvs       = new Float32Array((vertCount + skirtVerts) * 2);

  // Copy existing data
  skirtPositions.set(positions);
  skirtNormals.set(normals);
  skirtUvs.set(uvs);

  const skirtDrop = planetRadius * 0.005; // drop skirt slightly below surface
  let skirtIdx = vertCount;
  const skirtIndices = [];

  // Helper: add skirt vertex for edge vertex at idx
  function addSkirtVert(idx) {
    const sx = positions[idx * 3];
    const sy = positions[idx * 3 + 1];
    const sz = positions[idx * 3 + 2];
    // Move toward planet center
    _normal.set(sx, sy, sz).normalize();
    skirtPositions[skirtIdx * 3]     = sx - _normal.x * skirtDrop;
    skirtPositions[skirtIdx * 3 + 1] = sy - _normal.y * skirtDrop;
    skirtPositions[skirtIdx * 3 + 2] = sz - _normal.z * skirtDrop;
    skirtNormals[skirtIdx * 3]     = normals[idx * 3];
    skirtNormals[skirtIdx * 3 + 1] = normals[idx * 3 + 1];
    skirtNormals[skirtIdx * 3 + 2] = normals[idx * 3 + 2];
    skirtUvs[skirtIdx * 2]     = uvs[idx * 2];
    skirtUvs[skirtIdx * 2 + 1] = uvs[idx * 2 + 1];
    return skirtIdx++;
  }

  // Bottom edge (iy=0)
  for (let ix = 0; ix < gridSize - 1; ix++) {
    const a = ix, b = ix + 1;
    const sa = addSkirtVert(a), sb = addSkirtVert(b);
    // Note: sb was just created but we need consistent ordering
    // Actually we re-create for each quad to keep it simple
  }

  // For simplicity, rebuild skirt with proper triangle winding
  skirtIdx = vertCount;
  const edgeIndices = [];

  // Collect edge vertex indices (in order)
  const edges = [
    // Bottom: iy=0, ix 0..gridSize-1
    Array.from({length: gridSize}, (_, i) => i),
    // Right: ix=gridSize-1, iy 0..gridSize-1
    Array.from({length: gridSize}, (_, i) => i * gridSize + (gridSize - 1)),
    // Top: iy=gridSize-1, ix gridSize-1..0
    Array.from({length: gridSize}, (_, i) => (gridSize - 1) * gridSize + (gridSize - 1 - i)),
    // Left: ix=0, iy gridSize-1..0
    Array.from({length: gridSize}, (_, i) => (gridSize - 1 - i) * gridSize),
  ];

  for (const edge of edges) {
    for (let i = 0; i < edge.length - 1; i++) {
      const a = edge[i], b = edge[i + 1];
      const sa = addSkirtVert(a);
      const sb = addSkirtVert(b);
      skirtIndices.push(a, sa, b);
      skirtIndices.push(b, sa, sb);
    }
  }

  // Combine indices
  const allIndices = new Uint32Array(indices.length + skirtIndices.length);
  allIndices.set(indices);
  allIndices.set(skirtIndices, indices.length);

  // Build geometry
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(skirtPositions.slice(0, skirtIdx * 3), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(skirtNormals.slice(0, skirtIdx * 3), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(skirtUvs.slice(0, skirtIdx * 2), 2));
  geo.setIndex(new THREE.BufferAttribute(allIndices, 1));

  return { geometry: geo, center };
}
```

- [ ] **Step 2: Test chunk generation**

Add temp test in main.js after boot:

```js
import { buildChunkGeometry } from './terrain/chunk.js';
import { getPlanetConfig } from './planetconfig.js';

// In boot(), after scene setup:
const testChunk = buildChunkGeometry(0, 0, 0, 1, 1, 17, 20, getPlanetConfig('EARTH').terrain, 5);
const testMat = new THREE.MeshStandardMaterial({ color: 0x44aa44, wireframe: true });
const testMesh = new THREE.Mesh(testChunk.geometry, testMat);
scene.add(testMesh);
console.log('[chunk] Test chunk generated, verts:', testChunk.geometry.attributes.position.count);
```

Expected: A curved terrain patch visible near origin. Remove temp code after verification.

- [ ] **Step 3: Commit**

```bash
git add js/terrain/chunk.js
git commit -m "feat: cube-sphere terrain chunk generation with skirt geometry"
```

---

### Task 4.3: Quadtree Manager

**Files:**
- Create: `js/terrain/quadtree.js`

- [ ] **Step 1: Create quadtree.js**

Create `js/terrain/quadtree.js`:

```js
// terrain/quadtree.js — Quadtree LOD manager for cube-sphere terrain
import * as THREE from 'three';
import { buildChunkGeometry } from './chunk.js';
import { getConfig } from '../perf.js';

/**
 * A quadtree node representing one terrain chunk on one face of the cube-sphere.
 */
class QuadNode {
  constructor(face, uMin, vMin, uMax, vMax, depth) {
    this.face = face;
    this.uMin = uMin;
    this.vMin = vMin;
    this.uMax = uMax;
    this.vMax = vMax;
    this.depth = depth;
    this.children = null;  // null = leaf, array of 4 = split
    this.mesh = null;
    this.center = new THREE.Vector3();
    this.size = 0; // approximate world-space size of this chunk
  }
}

/**
 * Manages the full quadtree for one planet.
 */
export class TerrainQuadtree {
  /**
   * @param {THREE.Scene} scene
   * @param {number} planetRadius — scene units
   * @param {THREE.Vector3} planetWorldPos — planet center in world space
   * @param {Object} terrainConfig — from planetconfig.js
   * @param {THREE.Material} material — shared terrain material
   */
  constructor(scene, planetRadius, planetWorldPos, terrainConfig, material) {
    this.scene = scene;
    this.planetRadius = planetRadius;
    this.planetWorldPos = planetWorldPos;
    this.terrainConfig = terrainConfig;
    this.material = material;
    this.group = new THREE.Group();
    this.scene.add(this.group);

    // Root nodes: 6 faces
    this.roots = [];
    for (let face = 0; face < 6; face++) {
      this.roots.push(new QuadNode(face, 0, 0, 1, 1, 0));
    }

    // Chunk recycling pool
    this.meshPool = [];
    this.activeChunks = 0;
  }

  /**
   * Update the quadtree: split/merge nodes based on camera distance.
   * @param {THREE.Vector3} camWorldPos — camera world position
   */
  update(camWorldPos) {
    const config = getConfig();
    const maxDepth = config.terrainMaxDepth;
    const gridSize = config.chunkGrid;
    const octaves = config.noiseOctaves;

    // Camera position relative to planet center
    const camLocal = camWorldPos.clone().sub(this.planetWorldPos);

    let chunksGenerated = 0;
    const maxChunksPerFrame = config.chunksPerFrame;

    for (const root of this.roots) {
      chunksGenerated += this._updateNode(
        root, camLocal, maxDepth, gridSize, octaves, maxChunksPerFrame - chunksGenerated
      );
    }
  }

  /**
   * Recursively update a quadtree node.
   * Returns number of chunks generated this frame.
   */
  _updateNode(node, camLocal, maxDepth, gridSize, octaves, budget) {
    if (budget <= 0) return 0;

    // Compute node center on sphere surface
    const uMid = (node.uMin + node.uMax) / 2;
    const vMid = (node.vMin + node.vMax) / 2;

    // Approximate center by cube-to-sphere mapping
    const cx = uMid * 2 - 1, cy = vMid * 2 - 1;
    // Simplified — just use the face center direction scaled by radius
    this._cubeToSphere(node.face, uMid, vMid, node.center);
    node.center.multiplyScalar(this.planetRadius);

    // Approximate chunk size in world space
    node.size = this.planetRadius * Math.PI / (3 * Math.pow(2, node.depth));

    // Distance from camera to chunk center
    const dist = camLocal.distanceTo(node.center);

    // Screen-space error metric: split if chunk appears large on screen
    const screenSize = node.size / Math.max(dist, 0.001);
    const splitThreshold = 1.2; // tunable

    const shouldSplit = screenSize > splitThreshold && node.depth < maxDepth;

    if (shouldSplit) {
      // Split into 4 children
      if (!node.children) {
        node.children = this._createChildren(node);
        // Remove this node's mesh (parent chunk)
        this._removeMesh(node);
      }
      let generated = 0;
      for (const child of node.children) {
        generated += this._updateNode(child, camLocal, maxDepth, gridSize, octaves, budget - generated);
      }
      return generated;
    } else {
      // Merge: remove children, show this node
      if (node.children) {
        this._removeChildren(node);
        node.children = null;
      }

      // Ensure this node has a mesh
      if (!node.mesh) {
        const { geometry, center } = buildChunkGeometry(
          node.face, node.uMin, node.vMin, node.uMax, node.vMax,
          gridSize, this.planetRadius, this.terrainConfig, octaves
        );
        node.mesh = this._getMesh(geometry);
        node.mesh.position.copy(this.planetWorldPos);
        this.group.add(node.mesh);
        return 1;
      }

      return 0;
    }
  }

  _createChildren(parent) {
    const uMid = (parent.uMin + parent.uMax) / 2;
    const vMid = (parent.vMin + parent.vMax) / 2;
    const d = parent.depth + 1;
    return [
      new QuadNode(parent.face, parent.uMin, parent.vMin, uMid, vMid, d),
      new QuadNode(parent.face, uMid, parent.vMin, parent.uMax, vMid, d),
      new QuadNode(parent.face, parent.uMin, vMid, uMid, parent.vMax, d),
      new QuadNode(parent.face, uMid, vMid, parent.uMax, parent.vMax, d),
    ];
  }

  _removeChildren(node) {
    if (!node.children) return;
    for (const child of node.children) {
      this._removeChildren(child);
      this._removeMesh(child);
      child.children = null;
    }
  }

  _removeMesh(node) {
    if (node.mesh) {
      this.group.remove(node.mesh);
      // Recycle mesh and geometry
      node.mesh.geometry.dispose();
      this.meshPool.push(node.mesh);
      node.mesh = null;
    }
  }

  _getMesh(geometry) {
    if (this.meshPool.length > 0) {
      const mesh = this.meshPool.pop();
      mesh.geometry = geometry;
      return mesh;
    }
    return new THREE.Mesh(geometry, this.material);
  }

  _cubeToSphere(face, u, v, out) {
    const x2 = u * 2 - 1, y2 = v * 2 - 1;
    let x, y, z;
    switch (face) {
      case 0: x =  1; y = y2; z = -x2; break;
      case 1: x = -1; y = y2; z =  x2; break;
      case 2: x = x2; y =  1; z = -y2; break;
      case 3: x = x2; y = -1; z =  y2; break;
      case 4: x = x2; y = y2; z =  1;  break;
      case 5: x =-x2; y = y2; z = -1;  break;
    }
    const len = Math.sqrt(x * x + y * y + z * z);
    out.set(x / len, y / len, z / len);
  }

  /**
   * Dispose all meshes and remove from scene.
   */
  dispose() {
    for (const root of this.roots) {
      this._removeChildren(root);
      this._removeMesh(root);
    }
    this.scene.remove(this.group);
    this.meshPool.length = 0;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add js/terrain/quadtree.js
git commit -m "feat: quadtree LOD manager — split/merge, mesh pooling, screen-space error"
```

---

### Task 4.4: Integrate Terrain with Main Loop

**Files:**
- Modify: `js/main.js`
- Create: `js/terrain/manager.js`

- [ ] **Step 1: Create terrain manager**

Create `js/terrain/manager.js`:

```js
// terrain/manager.js — Manages terrain quadtrees for all nearby planets
import * as THREE from 'three';
import { TerrainQuadtree } from './quadtree.js';
import { getPlanetConfig } from '../planetconfig.js';
import { getAltitude } from '../altitude.js';

const TERRAIN_ACTIVATE_DIST = 5; // altitudeNorm — activate terrain when within 5x radius

let activeQuadtree = null;
let activeBody = null;

const terrainMaterial = new THREE.MeshStandardMaterial({
  color: 0x888888,
  roughness: 0.85,
  metalness: 0,
  flatShading: false,
});

/**
 * Update terrain system. Call every frame.
 * @param {THREE.Scene} scene
 * @param {THREE.Vector3} camWorldPos
 */
export function updateTerrain(scene, camWorldPos) {
  const alt = getAltitude();

  // Check if we should activate/deactivate terrain
  if (alt.altitudeNorm < TERRAIN_ACTIVATE_DIST && alt.body) {
    const config = getPlanetConfig(alt.nearestBody);
    if (!config || !config.terrain || config.terrain.type === 'gas' || config.terrain.type === 'none') {
      // Gas giant or no terrain — deactivate if active
      if (activeQuadtree) {
        activeQuadtree.dispose();
        activeQuadtree = null;
        activeBody = null;
      }
      return;
    }

    // Activate terrain for this body if not already
    if (activeBody !== alt.nearestBody) {
      if (activeQuadtree) {
        activeQuadtree.dispose();
      }

      // Set material color from planet texture (approximate)
      terrainMaterial.color.setHex(getTerrainColor(alt.nearestBody));

      activeQuadtree = new TerrainQuadtree(
        scene,
        alt.bodyRadius,
        alt.body.g.position.clone(),
        config.terrain,
        terrainMaterial
      );
      activeBody = alt.nearestBody;
      console.log(`[terrain] Activated terrain for ${alt.nearestBody}`);
    }

    // Update planet position (it orbits)
    if (activeQuadtree) {
      activeQuadtree.planetWorldPos.copy(alt.body.g.position);
      activeQuadtree.group.position.set(0, 0, 0); // group is in world space
      activeQuadtree.update(camWorldPos);
    }
  } else {
    // Too far — deactivate
    if (activeQuadtree) {
      activeQuadtree.dispose();
      activeQuadtree = null;
      activeBody = null;
      console.log('[terrain] Deactivated terrain (too far)');
    }
  }
}

/**
 * Get approximate terrain base color per planet.
 */
function getTerrainColor(name) {
  const colors = {
    MERCURY: 0x888077,
    VENUS: 0x886633,
    EARTH: 0x446633,
    MOON: 0x777766,
    MARS: 0x993322,
    PLUTO: 0xbbaa99,
    CERES: 0x777777,
    ERIS: 0xaabbcc,
  };
  return colors[name] || 0x888888;
}

/**
 * Check if terrain is currently active.
 */
export function isTerrainActive() {
  return activeQuadtree !== null;
}

/**
 * Get the active planet name (for HUD).
 */
export function getTerrainPlanet() {
  return activeBody;
}
```

- [ ] **Step 2: Integrate into main loop**

In `js/main.js`, add import:

```js
import { updateTerrain } from './terrain/manager.js';
```

In the `animate()` function, after `updateAltitude(getCamPos(), allBodies)`, add:

```js
      // Update terrain LOD
      updateTerrain(scene, getCamPos());
```

- [ ] **Step 3: Test by flying toward Earth**

Run server. Fly toward Earth. Expected: When within ~5x Earth's radius, terrain chunks start appearing as a textured sphere surface with displacement. As you get closer, chunks subdivide and more detail appears. Flying away merges chunks back. Console shows `[terrain] Activated terrain for EARTH` and `[terrain] Deactivated terrain (too far)`.

- [ ] **Step 4: Commit**

```bash
git add js/terrain/manager.js js/main.js
git commit -m "feat: terrain manager — activates quadtree LOD on planet approach"
```

---

## Phase 5: Atmosphere System

### Task 5.1: Rayleigh/Mie Scattering Sky Dome

**Files:**
- Create: `js/atmosphere/scatter.js`

- [ ] **Step 1: Create scattering shader and sky dome**

Create `js/atmosphere/scatter.js`:

```js
// atmosphere/scatter.js — Rayleigh/Mie atmospheric scattering sky dome
import * as THREE from 'three';
import { getAltitude } from '../altitude.js';
import { getPlanetConfig } from '../planetconfig.js';
import { getConfig } from '../perf.js';

// ── Scattering shader ────────────────────────────────────────────────

const AtmosphereVS = /* glsl */`
varying vec3 vWorldPos;
varying vec3 vSunDir;
uniform vec3 sunWorldPos;

void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  vSunDir = normalize(sunWorldPos);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const AtmosphereFS = /* glsl */`
uniform vec3 planetCenter;
uniform float planetRadius;
uniform float atmosphereRadius;
uniform vec3 rayleighCoeff;
uniform float mieCoeff;
uniform float mieG;
uniform float density;
uniform float camAltitude;
varying vec3 vWorldPos;
varying vec3 vSunDir;

#define PI 3.14159265359
#define NUM_SAMPLES 8
#define NUM_LIGHT_SAMPLES 4

// Rayleigh phase function
float rayleighPhase(float cosTheta) {
  return 0.75 * (1.0 + cosTheta * cosTheta);
}

// Mie phase function (Henyey-Greenstein)
float miePhase(float cosTheta, float g) {
  float g2 = g * g;
  float denom = 1.0 + g2 - 2.0 * g * cosTheta;
  return (1.0 - g2) / (4.0 * PI * pow(denom, 1.5));
}

void main() {
  vec3 viewDir = normalize(vWorldPos - cameraPosition);
  float cosTheta = dot(viewDir, vSunDir);

  // Simple altitude-based atmospheric density
  float viewAlt = length(cameraPosition - planetCenter) - planetRadius;
  float atmoThickness = atmosphereRadius - planetRadius;
  float densityFalloff = exp(-viewAlt / (atmoThickness * 0.3)) * density;

  // Rayleigh + Mie contribution
  vec3 rayleigh = rayleighCoeff * rayleighPhase(cosTheta) * densityFalloff * 20.0;
  float mie = mieCoeff * miePhase(cosTheta, mieG) * densityFalloff * 10.0;

  vec3 color = rayleigh + vec3(mie);

  // Sun disk
  float sunDot = max(dot(viewDir, vSunDir), 0.0);
  float sunDisk = smoothstep(0.9997, 0.9999, sunDot);
  color += vec3(1.0, 0.95, 0.8) * sunDisk * 5.0;

  // Horizon glow
  float horizonDot = abs(dot(viewDir, normalize(cameraPosition - planetCenter)));
  float horizonGlow = pow(1.0 - horizonDot, 4.0) * densityFalloff * 0.5;
  color += rayleighCoeff * horizonGlow * 8.0;

  // Clamp and output
  float alpha = clamp(length(color) * 2.0, 0.0, 1.0);
  gl_FragColor = vec4(color, alpha);
}
`;

// ── Simplified atmosphere (medium/low tier) ──────────────────────────

const SimpleAtmoFS = /* glsl */`
uniform vec3 skyTint;
uniform float density;
uniform float camAltitude;
uniform float atmosphereRadius;
uniform float planetRadius;
varying vec3 vWorldPos;
varying vec3 vSunDir;

void main() {
  vec3 viewDir = normalize(vWorldPos - cameraPosition);
  float viewAlt = length(cameraPosition - vec3(0.0)) - planetRadius;
  float atmoThickness = atmosphereRadius - planetRadius;
  float t = clamp(1.0 - viewAlt / atmoThickness, 0.0, 1.0);

  // Lerp between sky color and black based on altitude
  vec3 color = skyTint * t * density;

  // Sunset tint near horizon
  float horizonDot = abs(dot(viewDir, vec3(0.0, 1.0, 0.0)));
  color += vec3(0.8, 0.3, 0.1) * pow(1.0 - horizonDot, 3.0) * t * 0.5;

  float alpha = clamp(t * density * 2.0, 0.0, 0.95);
  gl_FragColor = vec4(color, alpha);
}
`;

// ── Sky dome manager ─────────────────────────────────────────────────

let skyDome = null;
let skyMaterial = null;
let activePlanet = null;

/**
 * Create or update the atmospheric sky dome.
 * Called each frame when inside an atmosphere.
 */
export function updateAtmosphere(scene, camPos, sunPos) {
  const alt = getAltitude();

  if (!alt.hasAtmosphere || alt.altitudeNorm > 5) {
    // Not in atmosphere — hide sky dome
    if (skyDome) {
      skyDome.visible = false;
    }
    activePlanet = null;
    return;
  }

  const config = getPlanetConfig(alt.nearestBody);
  if (!config || !config.atmosphere || !config.atmosphere.hasAtmosphere) {
    if (skyDome) skyDome.visible = false;
    return;
  }

  const atmo = config.atmosphere;
  const perfConfig = getConfig();

  // Create sky dome if needed
  if (!skyDome) {
    const geo = new THREE.SphereGeometry(1, 32, 32);

    skyMaterial = new THREE.ShaderMaterial({
      uniforms: {
        planetCenter:    { value: new THREE.Vector3() },
        planetRadius:    { value: 1 },
        atmosphereRadius:{ value: 1.1 },
        sunWorldPos:     { value: new THREE.Vector3(0, 0, 0) },
        rayleighCoeff:   { value: new THREE.Vector3(5.5e-6, 13.0e-6, 22.4e-6) },
        mieCoeff:        { value: 21e-6 },
        mieG:            { value: 0.758 },
        density:         { value: 1.0 },
        camAltitude:     { value: 100 },
        skyTint:         { value: new THREE.Color(0x4488cc) },
      },
      vertexShader: AtmosphereVS,
      fragmentShader: perfConfig.atmosphereQuality === 'full' ? AtmosphereFS : SimpleAtmoFS,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    skyDome = new THREE.Mesh(geo, skyMaterial);
    scene.add(skyDome);
  }

  // Update sky dome to surround camera
  const atmoRadius = alt.bodyRadius * (1 + (atmo.scaleHeight || 0.05) * 10);
  skyDome.scale.setScalar(atmoRadius * 2);
  skyDome.position.copy(camPos); // dome follows camera
  skyDome.visible = true;

  // Update uniforms
  const u = skyMaterial.uniforms;
  u.planetCenter.value.copy(alt.body.g.position);
  u.planetRadius.value = alt.bodyRadius;
  u.atmosphereRadius.value = atmoRadius;
  u.sunWorldPos.value.copy(sunPos || new THREE.Vector3(0, 0, 0));
  u.density.value = Math.min(atmo.density, 10); // clamp for visual sanity

  if (perfConfig.atmosphereQuality === 'full') {
    u.rayleighCoeff.value.set(
      atmo.rayleighCoeff[0],
      atmo.rayleighCoeff[1],
      atmo.rayleighCoeff[2]
    );
    u.mieCoeff.value = atmo.mieCoeff[0];
    u.mieG.value = atmo.mieG;
  } else {
    u.skyTint.value.set(atmo.skyTint || '#4488cc');
  }

  u.camAltitude.value = alt.altitude;

  // Fade in/out based on altitude
  const fadeStart = 5; // altitudeNorm where atmosphere starts appearing
  const fadeFull = 1;  // altitudeNorm where atmosphere is full strength
  const fade = 1 - Math.max(0, Math.min(1, (alt.altitudeNorm - fadeFull) / (fadeStart - fadeFull)));
  skyMaterial.opacity = fade;

  activePlanet = alt.nearestBody;
}
```

- [ ] **Step 2: Integrate into main loop**

In `js/main.js`, add import:

```js
import { updateAtmosphere } from './atmosphere/scatter.js';
```

In the `animate()` function, after `updateTerrain(scene, getCamPos())`, add:

```js
      // Update atmosphere
      updateAtmosphere(scene, getCamPos(), new THREE.Vector3(0, 0, 0)); // Sun at origin
```

- [ ] **Step 3: Test by flying toward Earth**

Expected: As you approach Earth (within ~5x radius), a blue atmospheric haze fades in. Sky color transitions from black to blue. Getting closer intensifies the atmosphere. Mars should show butterscotch, Venus yellow-orange.

- [ ] **Step 4: Commit**

```bash
git add js/atmosphere/scatter.js js/main.js
git commit -m "feat: Rayleigh/Mie atmospheric scattering with per-planet parameters"
```

---

### Task 5.2: Atmospheric Entry Effects

**Files:**
- Create: `js/atmosphere/effects.js`
- Modify: `index.html` (add re-entry glow overlay CSS)
- Modify: `js/main.js` (integrate effects)

- [ ] **Step 1: Create effects.js**

Create `js/atmosphere/effects.js`:

```js
// atmosphere/effects.js — Re-entry glow, camera shake, descent particles
import * as THREE from 'three';
import { getAltitude } from '../altitude.js';
import { getPlanetConfig } from '../planetconfig.js';
import { getConfig } from '../perf.js';

// ── Module state ─────────────────────────────────────────────────────

let glowOverlay = null;
let shakeOffset = new THREE.Vector3();
let particles = null;
let particleGroup = null;

/**
 * Initialize atmosphere effects. Call once.
 */
export function initAtmoEffects() {
  // Re-entry glow overlay (DOM element)
  glowOverlay = document.getElementById('reentry-glow');
}

/**
 * Update atmosphere entry effects. Call every frame.
 * @param {number} dt — delta time
 * @param {THREE.Vector3} camPos
 * @param {THREE.Vector3} velocity — player velocity vector
 * @param {THREE.Camera} camera — to apply shake
 * @param {THREE.Scene} scene
 */
export function updateAtmoEffects(dt, camPos, velocity, camera, scene) {
  const alt = getAltitude();
  const speed = velocity.length();
  const perfConfig = getConfig();

  // ── Re-entry glow ──────────────────────────────────────────────
  if (glowOverlay) {
    if (alt.hasAtmosphere && alt.altitudeNorm < 3 && speed > 50) {
      const config = getPlanetConfig(alt.nearestBody);
      const density = config?.atmosphere?.density || 1;
      const intensity = Math.min(1, (speed / 200) * Math.min(density, 5) * (1 - alt.altitudeNorm / 3));
      glowOverlay.style.opacity = intensity * 0.6;
    } else {
      glowOverlay.style.opacity = 0;
    }
  }

  // ── Camera shake ───────────────────────────────────────────────
  const shakeMultiplier = perfConfig.cameraShake;
  if (alt.hasAtmosphere && alt.altitudeNorm < 2 && speed > 30 && shakeMultiplier > 0) {
    const config = getPlanetConfig(alt.nearestBody);
    const density = Math.min(config?.atmosphere?.density || 1, 10);
    const shakeIntensity = (speed / 300) * density * (1 - alt.altitudeNorm / 2) * 0.003 * shakeMultiplier;

    shakeOffset.set(
      (Math.random() - 0.5) * shakeIntensity,
      (Math.random() - 0.5) * shakeIntensity,
      (Math.random() - 0.5) * shakeIntensity * 0.3
    );
    // Apply as angular offset
    camera.rotateX(shakeOffset.x);
    camera.rotateY(shakeOffset.y);
  }
}
```

- [ ] **Step 2: Add re-entry glow overlay to index.html**

In `index.html`, after the `#horizon-flash` div (line 228), add:

```html
<div id="reentry-glow"></div>
```

In the CSS (inside `<style>`), add:

```css
#reentry-glow{position:fixed;inset:0;pointer-events:none;z-index:6;opacity:0;
  transition:opacity 0.2s;
  background:radial-gradient(ellipse at center, transparent 40%, rgba(255,120,20,0.4) 70%, rgba(255,60,10,0.7) 100%)}
```

- [ ] **Step 3: Integrate into main loop**

In `js/main.js`, add imports:

```js
import { initAtmoEffects, updateAtmoEffects } from './atmosphere/effects.js';
```

In `boot()`, after `initHud()`:

```js
  initAtmoEffects();
```

In `animate()`, after `updateAtmosphere(...)`:

```js
      // Atmospheric entry effects (glow, shake, particles)
      updateAtmoEffects(dt, getCamPos(), getVelocity(), camera, scene);
```

Also import `getVelocity` from flight.js:

```js
import { initFlight, updateFlight, getCamPos, getSpeed, getVelocity, doHome } from './flight.js';
```

Note: `getVelocity` already exists in `flight.js` (line 358) but isn't imported yet.

- [ ] **Step 4: Test**

Fly toward Earth at warp speed. Expected: Screen edges glow orange/red during high-speed atmospheric entry. Camera shakes proportional to speed and atmosphere density.

- [ ] **Step 5: Commit**

```bash
git add js/atmosphere/effects.js index.html js/main.js
git commit -m "feat: atmospheric entry effects — re-entry glow, camera shake"
```

---

## Phase 6: Gas Giant Dives

### Task 6.1: Gas Giant Dive System

**Files:**
- Create: `js/atmosphere/gasgiant.js`
- Modify: `js/hud.js` (add pressure/hull stress HUD)
- Modify: `index.html` (add HUD elements)
- Modify: `js/main.js` (integrate)

- [ ] **Step 1: Create gasgiant.js**

Create `js/atmosphere/gasgiant.js`:

```js
// atmosphere/gasgiant.js — Gas giant atmospheric dive phases, HUD warnings, crush depth ejection
import { getAltitude } from '../altitude.js';
import { getPlanetConfig } from '../planetconfig.js';
import { doHome } from '../flight.js';

// ── State ────────────────────────────────────────────────────────────
let divePhase = 'none'; // 'none' | 'upper' | 'cloud' | 'deep' | 'crush' | 'ejecting'
let hullStress = 0;
let ejecting = false;
let ejectTimer = 0;
let hudElements = null;

// ── HUD bindings ─────────────────────────────────────────────────────
export function initGasGiantHud() {
  hudElements = {
    pressure: document.getElementById('atmo-pressure'),
    temperature: document.getElementById('atmo-temperature'),
    hullStress: document.getElementById('hull-stress'),
    hullBar: document.getElementById('hull-bar'),
    warning: document.getElementById('atmo-warning'),
  };
}

// ── Update ───────────────────────────────────────────────────────────

/**
 * Update gas giant dive state. Returns true if currently in a gas giant.
 * @param {number} dt
 * @param {THREE.Vector3} camPos
 * @param {Object} velocity — flight velocity vector (mutated for ejection)
 * @returns {{ inDive: boolean, phase: string, hullStress: number, fogDensity: number, fogColor: string }}
 */
export function updateGasGiantDive(dt, camPos, velocity) {
  const alt = getAltitude();

  if (!alt.isGasGiant || alt.altitudeNorm > 1.5) {
    // Not in a gas giant
    if (divePhase !== 'none') {
      divePhase = 'none';
      hullStress = 0;
      ejecting = false;
      hideHud();
    }
    return { inDive: false, phase: 'none', hullStress: 0, fogDensity: 0, fogColor: '#000' };
  }

  const config = getPlanetConfig(alt.nearestBody);
  const gg = config?.gasGiant;
  if (!gg) return { inDive: false, phase: 'none', hullStress: 0, fogDensity: 0, fogColor: '#000' };

  // ── Determine phase from altitude ──────────────────────────────
  const an = alt.altitudeNorm;
  let newPhase = 'upper';
  if (an < gg.crushDepthNorm) newPhase = 'crush';
  else if (an < 0.3) newPhase = 'deep';
  else if (an < 0.6) newPhase = 'cloud';
  else if (an < 1.0) newPhase = 'upper';

  // ── Handle ejection ────────────────────────────────────────────
  if (ejecting) {
    ejectTimer += dt;
    if (ejectTimer > 5) {
      ejecting = false;
      ejectTimer = 0;
    }
    // Ejection thrust — push player outward from planet center
    const dir = camPos.clone().sub(alt.body.g.position).normalize();
    velocity.addScaledVector(dir, 300 * dt);

    updateHud('ejecting', 100, alt.nearestBody, gg);
    return { inDive: true, phase: 'ejecting', hullStress: 100, fogDensity: 0.5, fogColor: gg.bandColor1 };
  }

  // ── Crush depth trigger ────────────────────────────────────────
  if (newPhase === 'crush' && !ejecting) {
    ejecting = true;
    ejectTimer = 0;
    // Flash
    const flash = document.getElementById('horizon-flash');
    if (flash) {
      flash.style.transition = 'opacity 0.2s';
      flash.style.opacity = '1';
      setTimeout(() => { flash.style.transition = 'opacity 1.5s'; flash.style.opacity = '0'; }, 200);
    }
    newPhase = 'crush';
  }

  divePhase = newPhase;

  // ── Hull stress calculation ────────────────────────────────────
  const stressTarget =
    divePhase === 'crush' ? 100 :
    divePhase === 'deep' ? 30 + (1 - an / 0.3) * 60 :
    divePhase === 'cloud' ? 5 + (1 - an / 0.6) * 20 :
    0;
  hullStress += (stressTarget - hullStress) * dt * 2;

  // ── Fog density ────────────────────────────────────────────────
  const fogDensity =
    divePhase === 'crush' ? 0.95 :
    divePhase === 'deep' ? 0.4 + (1 - an / 0.3) * 0.5 :
    divePhase === 'cloud' ? 0.1 + (1 - an / 0.6) * 0.3 :
    0;

  updateHud(divePhase, hullStress, alt.nearestBody, gg);

  return {
    inDive: true,
    phase: divePhase,
    hullStress,
    fogDensity,
    fogColor: gg.bandColor1,
  };
}

// ── HUD helpers ──────────────────────────────────────────────────────

function updateHud(phase, stress, planet, gg) {
  if (!hudElements) return;

  if (hudElements.pressure) {
    hudElements.pressure.style.display = 'block';
    const pressureVal = phase === 'upper' ? '1.2' :
      phase === 'cloud' ? (10 + stress * 2).toFixed(0) :
      phase === 'deep' ? (100 + stress * 100).toFixed(0) :
      '∞';
    hudElements.pressure.textContent = `PRESSURE: ${pressureVal} ATM`;
  }

  if (hudElements.temperature) {
    hudElements.temperature.style.display = 'block';
    const tempVal = phase === 'upper' ? '-110' :
      phase === 'cloud' ? (20 + stress * 5).toFixed(0) :
      phase === 'deep' ? (200 + stress * 30).toFixed(0) :
      '∞';
    hudElements.temperature.textContent = `TEMP: ${tempVal}°C`;
  }

  if (hudElements.hullStress) {
    hudElements.hullStress.style.display = 'block';
    hudElements.hullStress.textContent = `HULL STRESS: ${Math.round(stress)}%`;
    hudElements.hullStress.style.color =
      stress > 80 ? 'rgba(255,60,40,0.9)' :
      stress > 40 ? 'rgba(255,180,60,0.8)' :
      'rgba(255,255,255,0.4)';
  }

  if (hudElements.hullBar) {
    hudElements.hullBar.style.width = Math.min(100, stress) + '%';
    hudElements.hullBar.style.background =
      stress > 80 ? 'rgba(255,60,40,0.8)' :
      stress > 40 ? 'rgba(255,180,60,0.7)' :
      'rgba(120,180,255,0.5)';
  }

  if (hudElements.warning) {
    if (phase === 'ejecting') {
      hudElements.warning.style.display = 'block';
      hudElements.warning.textContent = '⚠ SYSTEMS RECOVERING';
      hudElements.warning.style.color = 'rgba(255,180,60,0.8)';
    } else if (phase === 'deep' || phase === 'crush') {
      hudElements.warning.style.display = 'block';
      hudElements.warning.textContent = '⚠ DANGER — EXTREME PRESSURE';
      hudElements.warning.style.color = 'rgba(255,60,40,0.9)';
    } else {
      hudElements.warning.style.display = 'none';
    }
  }
}

function hideHud() {
  if (!hudElements) return;
  if (hudElements.pressure) hudElements.pressure.style.display = 'none';
  if (hudElements.temperature) hudElements.temperature.style.display = 'none';
  if (hudElements.hullStress) hudElements.hullStress.style.display = 'none';
  if (hudElements.warning) hudElements.warning.style.display = 'none';
}
```

- [ ] **Step 2: Add HUD elements to index.html**

In `index.html`, inside the `#hud` div, after `#boost-wrap` (line 208), add:

```html
  <div id="atmo-hud" style="position:absolute;bottom:60px;left:20px;font-size:7px;letter-spacing:2px;color:rgba(255,255,255,0.4)">
    <div id="atmo-pressure" style="display:none"></div>
    <div id="atmo-temperature" style="display:none;margin-top:3px"></div>
    <div id="hull-stress" style="display:none;margin-top:3px"></div>
    <div style="width:70px;height:2px;background:rgba(255,255,255,0.06);margin-top:4px;overflow:hidden">
      <div id="hull-bar" style="height:100%;width:0%;transition:width 0.3s,background 0.3s"></div>
    </div>
    <div id="atmo-warning" style="display:none;margin-top:6px;font-size:8px;letter-spacing:3px"></div>
  </div>
```

- [ ] **Step 3: Integrate into main loop**

In `js/main.js`, add imports:

```js
import { initGasGiantHud, updateGasGiantDive } from './atmosphere/gasgiant.js';
```

In `boot()`, after `initAtmoEffects()`:

```js
  initGasGiantHud();
```

In `animate()`, after atmosphere effects:

```js
      // Gas giant dive system
      const diveState = updateGasGiantDive(dt, getCamPos(), velocity);
```

Note: need to get `velocity` reference. Import from flight.js is already `getVelocity()` — but gas giant needs to mutate it for ejection. Change the import to get the actual vector:

The `getVelocity()` function in flight.js returns the actual velocity vector reference (not a copy), so `updateGasGiantDive` can call `velocity.addScaledVector(...)` on the result of `getVelocity()`. Update the call:

```js
      const diveState = updateGasGiantDive(dt, getCamPos(), getVelocity());
```

- [ ] **Step 4: Test by flying into Jupiter**

Fly toward Jupiter at warp speed. Expected: HUD pressure/temperature/hull stress gauges appear. Cloud layers visible. Deeper = more fog and stress. At crush depth, screen flashes and you're ejected upward.

- [ ] **Step 5: Commit**

```bash
git add js/atmosphere/gasgiant.js index.html js/main.js
git commit -m "feat: gas giant atmospheric dive — phases, hull stress, crush depth ejection"
```

---

## Phase 7: Landing Mechanics

### Task 7.1: Landing Dampening and Settle

**Files:**
- Modify: `js/flight.js` (add landing altitude check and settle)

- [ ] **Step 1: Add landing mechanics to flight.js**

In `js/flight.js`, add import:

```js
import { getAltitude } from './altitude.js';
```

In `updateFlight`, after the speed cap section (after line 307) and before applying velocity to position (line 310), add:

```js
    // ── 10b. Landing mechanics ──────────────────────────────────────
    const alt = getAltitude();
    if (alt.body && alt.altitude < 50 && !alt.isGasGiant && alt.altitudeNorm < 1) {
      // Approaching surface — dampen vertical speed
      const toCenter = _dir.copy(alt.body.g.position).sub(camPos).normalize();
      const verticalSpeed = velocity.dot(toCenter);

      if (alt.altitude < 5 && Math.abs(verticalSpeed) < 5 && !thrusting) {
        // Settle — zero velocity, lock altitude
        velocity.set(0, 0, 0);
        // Push position to exactly surface + 3 units
        const surfaceNormal = camPos.clone().sub(alt.body.g.position).normalize();
        const targetAlt = alt.bodyRadius + 3;
        camPos.copy(alt.body.g.position).addScaledVector(surfaceNormal, targetAlt);
      } else if (alt.altitude < 50) {
        // Gentle dampening on approach
        const dampFactor = 1 - (1 - alt.altitude / 50) * 0.3 * dt;
        // Dampen only the component toward the planet
        if (verticalSpeed > 0) { // moving toward planet
          const reduction = toCenter.clone().multiplyScalar(verticalSpeed * (1 - dampFactor));
          velocity.sub(reduction);
        }
      }
    }
```

- [ ] **Step 2: Test landing**

Fly slowly toward Earth's surface. Expected: Below 50m, descent speed softens. Below 5m at low speed, you settle and stop. Pressing W or Space lifts off normally.

- [ ] **Step 3: Commit**

```bash
git add js/flight.js
git commit -m "feat: landing mechanics — gentle approach dampening and surface settle"
```

---

### Task 7.2: Surface HUD

**Files:**
- Modify: `js/hud.js` (add surface info display)
- Modify: `index.html` (add surface HUD elements)

- [ ] **Step 1: Add surface HUD elements to index.html**

In `index.html`, inside the `#hud` div, after the `#atmo-hud` div, add:

```html
  <div id="surface-hud" style="position:absolute;top:18px;left:18px;font-size:7px;letter-spacing:2px;color:rgba(255,255,255,0.3);display:none">
    <div id="surface-planet" style="font-size:9px;letter-spacing:4px;color:rgba(120,180,255,0.6)"></div>
    <div id="surface-alt" style="margin-top:4px"></div>
    <div id="surface-coords" style="margin-top:2px"></div>
    <div id="surface-temp" style="margin-top:2px"></div>
    <div id="surface-pressure" style="margin-top:2px"></div>
  </div>
```

- [ ] **Step 2: Update hud.js with surface info**

In `js/hud.js`, add imports:

```js
import { getAltitude } from './altitude.js';
import { getPlanetConfig } from './planetconfig.js';
```

Add surface HUD element references in `initHud()`:

```js
  surfaceHud     = document.getElementById('surface-hud');
  surfacePlanet  = document.getElementById('surface-planet');
  surfaceAlt     = document.getElementById('surface-alt');
  surfaceCoords  = document.getElementById('surface-coords');
  surfaceTemp    = document.getElementById('surface-temp');
  surfacePressure = document.getElementById('surface-pressure');
```

Add module-level vars:

```js
let surfaceHud, surfacePlanet, surfaceAlt, surfaceCoords, surfaceTemp, surfacePressure;
```

In `updateHud`, after the existing body description panel section, add:

```js
  /* 5. Surface HUD (when near a planet surface) ---------------------- */
  const alt = getAltitude();
  if (surfaceHud && alt.body && alt.altitudeNorm < 0.5 && !alt.isGasGiant) {
    surfaceHud.style.display = 'block';

    if (surfacePlanet) surfacePlanet.textContent = alt.nearestBody;

    if (surfaceAlt) {
      const altKm = (alt.altitude * 1.496e8 / AU * alt.bodyRadius).toFixed(0);
      surfaceAlt.textContent = `ALT: ${alt.altitude.toFixed(1)} u · ${altKm} km`;
    }

    // Approximate lat/lon from position relative to planet center
    if (surfaceCoords && alt.body.g) {
      const rel = camPos.clone().sub(alt.body.g.position).normalize();
      const lat = Math.asin(rel.y) * (180 / Math.PI);
      const lon = Math.atan2(rel.z, rel.x) * (180 / Math.PI);
      surfaceCoords.textContent = `${lat.toFixed(1)}° ${lat >= 0 ? 'N' : 'S'} · ${Math.abs(lon).toFixed(1)}° ${lon >= 0 ? 'E' : 'W'}`;
    }

    const config = getPlanetConfig(alt.nearestBody);
    if (config?.surface) {
      if (surfaceTemp) {
        const t = config.surface.temperature;
        const tempStr = t.day !== undefined ? `${t.day}/${t.night}` : `${t.value}`;
        surfaceTemp.textContent = `TEMP: ${tempStr} ${t.unit}`;
      }
      if (surfacePressure) {
        surfacePressure.textContent = `PRESSURE: ${config.surface.pressure} ATM`;
      }
    }
  } else if (surfaceHud) {
    surfaceHud.style.display = 'none';
  }
```

- [ ] **Step 3: Test**

Land on Earth. Expected: Surface HUD shows planet name, altitude, lat/lon, temperature, and pressure.

- [ ] **Step 4: Commit**

```bash
git add js/hud.js index.html
git commit -m "feat: surface HUD — planet name, altitude, coordinates, temperature, pressure"
```

---

### Task 7.3: Return Home from Surface

**Files:**
- Modify: `js/flight.js` (update doHome to handle surface departure)

- [ ] **Step 1: Update doHome for surface scenarios**

In `js/flight.js`, replace the `doHome` function:

```js
export function doHome() {
    // If near a planet surface, first thrust upward before warping home
    const alt = getAltitude ? getAltitude() : null;

    if (alt && alt.body && alt.altitudeNorm < 2) {
      // First ascend: push away from planet
      const surfaceNormal = camPos.clone().sub(alt.body.g.position).normalize();
      velocity.copy(surfaceNormal).multiplyScalar(80); // strong upward thrust

      // Delay the home animation until we've cleared the atmosphere
      setTimeout(() => {
        retFromP.copy(camPos);
        retFromQ.copy(camQuat);
        returning = true;
        retT = 0;
        velocity.set(0, 0, 0);
        angularVelocity.set(0, 0, 0);
      }, 2000);
    } else {
      retFromP.copy(camPos);
      retFromQ.copy(camQuat);
      returning = true;
      retT = 0;
      velocity.set(0, 0, 0);
      angularVelocity.set(0, 0, 0);
    }

    if (elHomeBtn) elHomeBtn.style.display = 'none';
}
```

Add import of getAltitude at the top of flight.js if not already there (from Task 7.1):

```js
import { getAltitude } from './altitude.js';
```

- [ ] **Step 2: Test**

Land on Mars. Press H. Expected: Ship thrusts upward from surface, clears atmosphere over ~2 seconds, then performs the existing smooth warp-home animation.

- [ ] **Step 3: Commit**

```bash
git add js/flight.js
git commit -m "feat: Return Home from planet surface — ascend then warp"
```

---

## Final Integration Test

After all phases are complete:

- [ ] **Full flight test**: Launch → fly to Earth → descend through atmosphere → land → look around → lift off → fly to Mars → land → Return Home
- [ ] **Gas giant test**: Fly to Jupiter → descend into clouds → hit crush depth → get ejected → recover
- [ ] **Airless body test**: Fly to Moon → no atmosphere transition → land on surface → see black sky with stars
- [ ] **Performance test**: Check console for tier detection, verify no frame drops below 30fps during descent
- [ ] **Galaxy test**: Look around from starting position → Milky Way band visible, galactic core glow, space feels galactic
