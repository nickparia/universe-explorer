# Cosmic Landmarks — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand Universe Explorer from a solar system sim to a universe-scale experience with 12 real cosmic landmarks, warp travel, a 3D star map, and per-destination classical music.

**Architecture:** The existing modular architecture (deepspace.js, music.js, flight.js, navigation.js) is extended — not replaced. New landmarks are added to deepspace.js via a landmark registry. A new warp system in flight.js handles long-distance travel. A new starmap.js module provides the 3D navigation overlay. Music zones are expanded per-landmark.

**Tech Stack:** Three.js (r170+), Web Audio API, ES modules, no build step

**Project root for all paths:** `OneDrive - Ace Company BV/Desktop/Claude Code/Universe/`

---

### Task 1: Scale System & Landmark Registry

**Files:**
- Modify: `js/constants.js`
- Modify: `js/deepspace.js`

This task establishes the distance tiers and refactors the landmark system into a clean registry that all other systems can query.

- [ ] **Step 1: Add scale constants**

```js
// constants.js — Shared scale constants
export const AU = 3000;

// Distance tiers for universe scale
// Interstellar landmarks are placed at these multiples of AU
// to maintain visual separation while keeping travel times reasonable
export const INTERSTELLAR_SCALE = 500;   // multiplier for interstellar distances
export const INTERGALACTIC_SCALE = 2000; // multiplier for galaxy-scale distances
```

- [ ] **Step 2: Expand LANDMARK_DEFS in deepspace.js**

Replace the existing 4-entry `LANDMARK_DEFS` array with the full 12-landmark registry. Each entry gets a `tier` field, a `musicTrack` field, and a `visualType` field that determines which renderer builds it.

```js
const LANDMARK_DEFS = [
  // ── Interstellar (Milky Way) ──
  { name: 'PILLARS OF CREATION', tier: 'interstellar',
    dist: 4000, angle: 1.8, elevation: 50,
    size: 500, color: 0xffaa44, visualType: 'pillars',
    musicTrack: 'audio/bach_air.mp3',
    desc: 'Columns of interstellar gas in the Eagle Nebula. 6,500 light-years from Earth.' },

  { name: 'CRAB NEBULA', tier: 'interstellar',
    dist: 5000, angle: 3.5, elevation: -30,
    size: 350, color: 0xff6644, visualType: 'crab',
    musicTrack: 'audio/vivaldi_winter_largo.mp3',
    desc: 'Supernova remnant from 1054 AD. Pulsar at its heart spins 30 times per second.' },

  { name: 'UY SCUTI', tier: 'interstellar',
    dist: 6000, angle: 0.8, elevation: -80,
    size: 800, color: 0xff4422, visualType: 'hypergiant',
    musicTrack: 'audio/barber_adagio.mp3',
    desc: 'Largest known star. 1,700 times the radius of our Sun. If placed at our Sun, it would engulf Jupiter.' },

  { name: 'CARINA NEBULA', tier: 'interstellar',
    dist: 5500, angle: 4.8, elevation: 100,
    size: 600, color: 0x4488dd, visualType: 'carina',
    musicTrack: 'audio/inner_clair_de_lune.mp3',
    desc: 'Cosmic cliffs of gas and dust. Stars emerge from walls of blue and gold. 7,600 light-years away.' },

  { name: 'RING NEBULA', tier: 'interstellar',
    dist: 3500, angle: 2.5, elevation: 150,
    size: 300, color: 0x66aaff, visualType: 'ring',
    musicTrack: 'audio/albinoni_adagio.mp3',
    desc: 'A dying star shed its outer layers into a perfect glowing ring. 2,283 light-years away.' },

  { name: 'HORSEHEAD NEBULA', tier: 'interstellar',
    dist: 4500, angle: 5.5, elevation: -120,
    size: 400, color: 0xcc3333, visualType: 'horsehead',
    musicTrack: 'audio/satie_gymnopedie.mp3',
    desc: 'Dark silhouette against glowing hydrogen. One of the most photographed objects in space. 1,375 light-years.' },

  { name: 'ETA CARINAE', tier: 'interstellar',
    dist: 5800, angle: 1.2, elevation: 60,
    size: 450, color: 0xffcc44, visualType: 'eta_carinae',
    musicTrack: 'audio/grieg_mountain_king.mp3',
    desc: 'A star devouring itself. The Homunculus Nebula — two lobes of gas from a star about to go supernova.' },

  { name: 'MAGNETAR', tier: 'interstellar',
    dist: 3000, angle: 0.3, elevation: -200,
    size: 150, color: 0xaaccff, visualType: 'magnetar',
    musicTrack: 'audio/paganini_caprice24.mp3',
    desc: 'Neutron star with a magnetic field one quadrillion times Earth. A teaspoon weighs a billion tons.' },

  // ── Intergalactic ──
  { name: 'SAGITTARIUS A*', tier: 'intergalactic',
    dist: 8000, angle: 4.0, elevation: -50,
    size: 200, color: 0xff6600, visualType: 'supermassive_bh',
    musicTrack: 'audio/moonlight_sonata.mp3',
    desc: 'Supermassive black hole at the center of the Milky Way. 4 million times the mass of our Sun.' },

  { name: 'ANDROMEDA GALAXY', tier: 'intergalactic',
    dist: 12000, angle: 5.2, elevation: 200,
    size: 1200, color: 0x8899dd, visualType: 'spiral_galaxy',
    musicTrack: 'audio/vivaldi_spring_largo.mp3',
    desc: '2.5 million light-years away. One trillion stars. Approaching us at 110 km/s.' },

  { name: 'SOMBRERO GALAXY', tier: 'intergalactic',
    dist: 14000, angle: 2.0, elevation: 300,
    size: 900, color: 0xddcc88, visualType: 'sombrero_galaxy',
    musicTrack: 'audio/pachelbel_canon.mp3',
    desc: 'Edge-on galaxy with a dramatic dust lane and blazing core. 31 million light-years away.' },

  { name: 'BOOTES VOID', tier: 'intergalactic',
    dist: 18000, angle: 3.2, elevation: -300,
    size: 2000, color: 0x112233, visualType: 'void',
    musicTrack: 'audio/part_spiegel.mp3',
    desc: 'The Great Nothing. 330 million light-years of nearly empty space. Only 60 galaxies where thousands should be.' },
];
```

- [ ] **Step 3: Refactor createLandmarks to use visualType dispatch**

Replace the existing `createLandmarks` function to dispatch to visual renderers based on `visualType`. For now, all landmarks use the existing glow sprite as a placeholder — individual visual renderers are added in Tasks 2-5.

```js
// Visual renderer registry — each visualType maps to a function
// that creates the Three.js objects for that landmark
const VISUAL_RENDERERS = {};

export function registerVisualRenderer(type, fn) {
  VISUAL_RENDERERS[type] = fn;
}

function createLandmarks(scene, textures) {
  for (const def of LANDMARK_DEFS) {
    const x = Math.cos(def.angle) * def.dist * AU;
    const z = Math.sin(def.angle) * def.dist * AU;
    const y = def.elevation || (Math.random() - 0.5) * 200;

    const s = def.size * AU;

    // Create landmark group
    const group = new THREE.Group();
    group.position.set(x, y, z);
    scene.add(group);
    setWorldPos(group, group.position);

    // Dispatch to visual renderer if available, otherwise use default glow
    const renderer = VISUAL_RENDERERS[def.visualType];
    if (renderer) {
      renderer(group, def, textures);
    } else {
      // Default: soft glow sprite (placeholder)
      const glowMat = new THREE.SpriteMaterial({
        map: getNebulaTex(),
        color: def.color || 0xaaccff,
        blending: THREE.AdditiveBlending,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
      });
      const glowSprite = new THREE.Sprite(glowMat);
      glowSprite.scale.set(s * 2.0, s * 2.0, 1);
      group.add(glowSprite);
    }

    // Point light
    const light = new THREE.PointLight(def.color || 0xaaccff, 1.5, s * 3);
    group.add(light);

    landmarks.push({
      name: def.name,
      desc: def.desc,
      anchor: group,
      pos: new THREE.Vector3(x, y, z),
      radius: s * 0.3,
      musicTrack: def.musicTrack,
      tier: def.tier,
      visualType: def.visualType,
    });
  }
}
```

- [ ] **Step 4: Export landmark registry for other modules**

Add a getter so music.js and starmap.js can query landmarks:

```js
export function getLandmarks() { return landmarks; }
```

- [ ] **Step 5: Remove the old Orion Nebula entry**

The original LANDMARK_DEFS had an Orion Nebula entry that's not in the spec. Remove it from the new array (already done in Step 2 — just verify it's not present).

- [ ] **Step 6: Commit**

```bash
git add js/constants.js js/deepspace.js
git commit -m "feat: expand landmark registry to 12 cosmic destinations with visual dispatch system"
```

---

### Task 2: Nebula Visual Renderers (Pillars, Crab, Carina, Horsehead)

**Files:**
- Create: `js/visuals/nebulae.js`
- Modify: `js/deepspace.js` (import and register renderers)

Each nebula gets a custom particle system with unique geometry and color.

- [ ] **Step 1: Create nebulae.js with Pillars of Creation renderer**

The Pillars are tall columnar gas structures. Built from elongated particle distributions with warm amber/brown colors.

```js
// js/visuals/nebulae.js — Procedural nebula renderers
import * as THREE from 'three';

// Shared nebula particle texture
let _nebTex = null;
function getNebulaParticleTex() {
  if (_nebTex) return _nebTex;
  const sz = 64;
  const cv = document.createElement('canvas');
  cv.width = sz; cv.height = sz;
  const ctx = cv.getContext('2d');
  const grd = ctx.createRadialGradient(sz/2, sz/2, 0, sz/2, sz/2, sz/2);
  grd.addColorStop(0, 'rgba(255,255,255,0.5)');
  grd.addColorStop(0.4, 'rgba(255,255,255,0.15)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, sz, sz);
  _nebTex = new THREE.CanvasTexture(cv);
  return _nebTex;
}

// ── Pillars of Creation ──
// Three tall columns of gas, warm amber/brown, stars born at the tips
export function createPillars(group, def) {
  const scale = def.size * 3000; // AU constant inlined for visual sizing

  // Create three pillar columns
  const pillarDefs = [
    { x: -0.2, z: 0, height: 1.0, width: 0.15 },   // left pillar (tallest)
    { x: 0.05, z: 0.1, height: 0.7, width: 0.12 },  // center
    { x: 0.25, z: -0.05, height: 0.5, width: 0.1 },  // right (shortest)
  ];

  for (const p of pillarDefs) {
    const count = 6000;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      // Column distribution — gaussian in x/z, uniform in y
      const yNorm = Math.random();
      const widthAtY = p.width * (1.0 + yNorm * 0.3); // slightly wider at top
      const gx = (gaussRandom() * widthAtY + p.x) * scale;
      const gy = yNorm * p.height * scale;
      const gz = (gaussRandom() * widthAtY * 0.7 + p.z) * scale;

      positions[i * 3] = gx;
      positions[i * 3 + 1] = gy;
      positions[i * 3 + 2] = gz;

      // Color: warm amber base, brighter at tips
      const bright = 0.3 + yNorm * 0.5 + Math.random() * 0.2;
      colors[i * 3] = bright * 0.9;            // R
      colors[i * 3 + 1] = bright * 0.55;       // G — amber
      colors[i * 3 + 2] = bright * 0.2;        // B
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.PointsMaterial({
      vertexColors: true,
      size: scale * 0.03,
      map: getNebulaParticleTex(),
      sizeAttenuation: true,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.15,
      depthWrite: false,
    });

    group.add(new THREE.Points(geom, mat));
  }

  // Star-forming tips — bright points at pillar tops
  for (const p of pillarDefs) {
    const starCount = 8;
    for (let i = 0; i < starCount; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: getNebulaParticleTex(),
        color: 0xffeebb,
        blending: THREE.AdditiveBlending,
        transparent: true,
        opacity: 0.6,
      }));
      const tipY = p.height * scale * (0.85 + Math.random() * 0.15);
      sprite.position.set(
        (p.x + (Math.random() - 0.5) * p.width * 0.5) * scale,
        tipY,
        (p.z + (Math.random() - 0.5) * p.width * 0.5) * scale
      );
      sprite.scale.set(scale * 0.02, scale * 0.02, 1);
      group.add(sprite);
    }
  }
}

// ── Crab Nebula ──
// Rapidly spinning pulsar at center, filamentary gas shell expanding outward
export function createCrabNebula(group, def) {
  const scale = def.size * 3000;

  // Filamentary shell — radial streaks
  const count = 8000;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    // Radial filament distribution
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = (0.3 + Math.random() * 0.7) * scale * 0.5;
    // Stretch along radial direction for filamentary look
    const stretch = 1 + Math.random() * 0.4;

    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta) * stretch;
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);

    // Color: blue-white core fading to orange/red at edges
    const t = r / (scale * 0.5);
    const bright = 0.4 + Math.random() * 0.4;
    colors[i * 3] = bright * (0.4 + t * 0.6);
    colors[i * 3 + 1] = bright * (0.5 - t * 0.3);
    colors[i * 3 + 2] = bright * (1.0 - t * 0.5);
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.PointsMaterial({
    vertexColors: true,
    size: scale * 0.02,
    map: getNebulaParticleTex(),
    sizeAttenuation: true,
    blending: THREE.AdditiveBlending,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
  });

  group.add(new THREE.Points(geom, mat));

  // Pulsar at center — bright pulsing point
  const pulsarMat = new THREE.SpriteMaterial({
    map: getNebulaParticleTex(),
    color: 0xaaddff,
    blending: THREE.AdditiveBlending,
    transparent: true,
    opacity: 0.9,
  });
  const pulsar = new THREE.Sprite(pulsarMat);
  pulsar.scale.set(scale * 0.04, scale * 0.04, 1);
  pulsar.userData._isPulsar = true;
  group.add(pulsar);

  // Pulsar sweep beams — two opposing cones of light
  for (let sign = -1; sign <= 1; sign += 2) {
    const beamCount = 1500;
    const beamPos = new Float32Array(beamCount * 3);
    const beamCol = new Float32Array(beamCount * 3);

    for (let i = 0; i < beamCount; i++) {
      const dist = Math.random() * scale * 0.6;
      const spread = dist * 0.08; // narrow cone
      beamPos[i * 3] = (Math.random() - 0.5) * spread;
      beamPos[i * 3 + 1] = dist * sign;
      beamPos[i * 3 + 2] = (Math.random() - 0.5) * spread;

      const a = 0.5 * (1 - dist / (scale * 0.6));
      beamCol[i * 3] = 0.6 * a;
      beamCol[i * 3 + 1] = 0.8 * a;
      beamCol[i * 3 + 2] = 1.0 * a;
    }

    const bGeom = new THREE.BufferGeometry();
    bGeom.setAttribute('position', new THREE.BufferAttribute(beamPos, 3));
    bGeom.setAttribute('color', new THREE.BufferAttribute(beamCol, 3));

    const bMat = new THREE.PointsMaterial({
      vertexColors: true, size: scale * 0.01,
      map: getNebulaParticleTex(), sizeAttenuation: true,
      blending: THREE.AdditiveBlending, transparent: true,
      opacity: 0.25, depthWrite: false,
    });

    const beam = new THREE.Points(bGeom, bMat);
    beam.userData._isPulsarBeam = true;
    group.add(beam);
  }
}

// ── Carina Nebula ──
// "Cosmic cliffs" — walls of gas with stars emerging, blues and golds
export function createCarinaNebula(group, def) {
  const scale = def.size * 3000;

  // Cliff wall — flat, tall, wide distribution
  const count = 10000;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    const x = (Math.random() - 0.5) * scale * 0.8;
    const y = Math.random() * scale * 0.5;
    const z = gaussRandom() * scale * 0.08; // thin wall

    // Cliff edge — denser at top, wispy below
    const edgeFactor = smoothstep(0.3, 0.7, y / (scale * 0.5));

    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z + (edgeFactor * gaussRandom() * scale * 0.05);

    // Color: deep blue at base, gold at irradiated top
    const bright = 0.3 + Math.random() * 0.4;
    const t = y / (scale * 0.5);
    colors[i * 3] = bright * (0.3 + t * 0.7);      // R increases with height
    colors[i * 3 + 1] = bright * (0.4 + t * 0.4);  // G increases
    colors[i * 3 + 2] = bright * (0.9 - t * 0.4);  // B decreases
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.PointsMaterial({
    vertexColors: true, size: scale * 0.025,
    map: getNebulaParticleTex(), sizeAttenuation: true,
    blending: THREE.AdditiveBlending, transparent: true,
    opacity: 0.12, depthWrite: false,
  });

  group.add(new THREE.Points(geom, mat));

  // Emerging stars along the cliff edge
  for (let i = 0; i < 15; i++) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: getNebulaParticleTex(),
      color: 0xffeedd,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.5 + Math.random() * 0.3,
    }));
    sprite.position.set(
      (Math.random() - 0.5) * scale * 0.6,
      scale * 0.3 + Math.random() * scale * 0.2,
      (Math.random() - 0.5) * scale * 0.05
    );
    sprite.scale.set(scale * 0.015, scale * 0.015, 1);
    group.add(sprite);
  }
}

// ── Horsehead Nebula ──
// Dark silhouette against glowing red hydrogen gas
export function createHorsehead(group, def) {
  const scale = def.size * 3000;

  // Background hydrogen glow — red emission
  const bgCount = 6000;
  const bgPos = new Float32Array(bgCount * 3);
  const bgCol = new Float32Array(bgCount * 3);

  for (let i = 0; i < bgCount; i++) {
    bgPos[i * 3] = (Math.random() - 0.5) * scale * 0.8;
    bgPos[i * 3 + 1] = (Math.random() - 0.5) * scale * 0.6;
    bgPos[i * 3 + 2] = -scale * 0.1 + gaussRandom() * scale * 0.03; // flat backdrop

    const bright = 0.3 + Math.random() * 0.4;
    bgCol[i * 3] = bright * 0.9;
    bgCol[i * 3 + 1] = bright * 0.15;
    bgCol[i * 3 + 2] = bright * 0.1;
  }

  const bgGeom = new THREE.BufferGeometry();
  bgGeom.setAttribute('position', new THREE.BufferAttribute(bgPos, 3));
  bgGeom.setAttribute('color', new THREE.BufferAttribute(bgCol, 3));

  group.add(new THREE.Points(bgGeom, new THREE.PointsMaterial({
    vertexColors: true, size: scale * 0.03,
    map: getNebulaParticleTex(), sizeAttenuation: true,
    blending: THREE.AdditiveBlending, transparent: true,
    opacity: 0.15, depthWrite: false,
  })));

  // Dark horsehead silhouette — dense dark particles that occlude the red
  const headCount = 3000;
  const headPos = new Float32Array(headCount * 3);
  const headCol = new Float32Array(headCount * 3);

  for (let i = 0; i < headCount; i++) {
    // Rough horsehead shape — column with a protrusion
    const y = (Math.random() - 0.3) * scale * 0.35;
    let x;
    if (y > scale * 0.05) {
      // Head part — wider
      x = gaussRandom() * scale * 0.08 + scale * 0.03;
    } else {
      // Neck — narrower
      x = gaussRandom() * scale * 0.04;
    }
    const z = gaussRandom() * scale * 0.04;

    headPos[i * 3] = x;
    headPos[i * 3 + 1] = y;
    headPos[i * 3 + 2] = z;

    // Very dark brown/black
    headCol[i * 3] = 0.03;
    headCol[i * 3 + 1] = 0.02;
    headCol[i * 3 + 2] = 0.01;
  }

  const headGeom = new THREE.BufferGeometry();
  headGeom.setAttribute('position', new THREE.BufferAttribute(headPos, 3));
  headGeom.setAttribute('color', new THREE.BufferAttribute(headCol, 3));

  group.add(new THREE.Points(headGeom, new THREE.PointsMaterial({
    vertexColors: true, size: scale * 0.025,
    map: getNebulaParticleTex(), sizeAttenuation: true,
    blending: THREE.NormalBlending, // NOT additive — dark particles need to occlude
    transparent: true, opacity: 0.7, depthWrite: false,
  })));
}

// ── Helpers ──
function gaussRandom() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v) * 0.3;
}

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
```

- [ ] **Step 2: Register nebula renderers in deepspace.js**

Add imports and registration at the top of deepspace.js:

```js
import { createPillars, createCrabNebula, createCarinaNebula, createHorsehead } from './visuals/nebulae.js';

// After LANDMARK_DEFS, before createDeepSpace:
registerVisualRenderer('pillars', createPillars);
registerVisualRenderer('crab', createCrabNebula);
registerVisualRenderer('carina', createCarinaNebula);
registerVisualRenderer('horsehead', createHorsehead);
```

- [ ] **Step 3: Commit**

```bash
git add js/visuals/nebulae.js js/deepspace.js
git commit -m "feat: add procedural nebula renderers — Pillars, Crab, Carina, Horsehead"
```

---

### Task 3: Stellar Object Renderers (UY Scuti, Ring Nebula, Eta Carinae, Magnetar)

**Files:**
- Create: `js/visuals/stellar.js`
- Modify: `js/deepspace.js` (import and register)

- [ ] **Step 1: Create stellar.js with all four renderers**

```js
// js/visuals/stellar.js — Stellar object renderers
import * as THREE from 'three';

let _glowTex = null;
function getGlowTex() {
  if (_glowTex) return _glowTex;
  const sz = 64;
  const cv = document.createElement('canvas');
  cv.width = sz; cv.height = sz;
  const ctx = cv.getContext('2d');
  const grd = ctx.createRadialGradient(sz/2, sz/2, 0, sz/2, sz/2, sz/2);
  grd.addColorStop(0, 'rgba(255,255,255,0.5)');
  grd.addColorStop(0.4, 'rgba(255,255,255,0.15)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, sz, sz);
  _glowTex = new THREE.CanvasTexture(cv);
  return _glowTex;
}

// ── UY Scuti — largest known star ──
// An incomprehensibly vast red hypergiant sphere
export function createHypergiant(group, def) {
  const scale = def.size * 3000;
  const starRadius = scale * 0.4;

  // The star itself — massive red sphere
  const geo = new THREE.SphereGeometry(starRadius, 64, 64);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xff3311,
    emissive: 0xff2200,
    emissiveIntensity: 0.5,
  });
  const star = new THREE.Mesh(geo, mat);
  group.add(star);

  // Convection surface detail — subtle variation via second transparent layer
  const surfGeo = new THREE.SphereGeometry(starRadius * 1.01, 64, 64);
  const surfMat = new THREE.MeshBasicMaterial({
    color: 0xff6633,
    transparent: true,
    opacity: 0.3,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  group.add(new THREE.Mesh(surfGeo, surfMat));

  // Enormous glow shells
  const glowDefs = [
    { r: starRadius * 1.3, color: 0xff4400, opacity: 0.12 },
    { r: starRadius * 1.8, color: 0xff2200, opacity: 0.06 },
    { r: starRadius * 3.0, color: 0x881100, opacity: 0.025 },
    { r: starRadius * 5.0, color: 0x440800, opacity: 0.01 },
  ];
  for (const g of glowDefs) {
    const gMesh = new THREE.Mesh(
      new THREE.SphereGeometry(g.r, 32, 32),
      new THREE.MeshBasicMaterial({
        color: g.color, transparent: true, opacity: g.opacity,
        blending: THREE.AdditiveBlending, side: THREE.BackSide, depthWrite: false,
      })
    );
    group.add(gMesh);
  }

  // Point light — intense red
  const light = new THREE.PointLight(0xff3300, 5, scale * 6);
  group.add(light);
}

// ── Ring Nebula ──
// Perfect glowing ring of expelled gas, dying star at center
export function createRingNebula(group, def) {
  const scale = def.size * 3000;
  const ringRadius = scale * 0.3;

  // Torus of expelled gas
  const torusCount = 8000;
  const positions = new Float32Array(torusCount * 3);
  const colors = new Float32Array(torusCount * 3);

  for (let i = 0; i < torusCount; i++) {
    const theta = Math.random() * Math.PI * 2; // around the ring
    const phi = Math.random() * Math.PI * 2;   // around the tube
    const tubeR = ringRadius * 0.2 * (0.5 + Math.random() * 0.5);

    const x = (ringRadius + tubeR * Math.cos(phi)) * Math.cos(theta);
    const y = tubeR * Math.sin(phi) * 0.6; // slightly flattened
    const z = (ringRadius + tubeR * Math.cos(phi)) * Math.sin(theta);

    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;

    // Color: blue-green inner edge, red-orange outer
    const distFromCenter = Math.sqrt(x * x + z * z);
    const t = (distFromCenter - ringRadius * 0.7) / (ringRadius * 0.6);
    const bright = 0.3 + Math.random() * 0.4;
    colors[i * 3] = bright * (0.3 + t * 0.5);
    colors[i * 3 + 1] = bright * (0.6 - t * 0.2);
    colors[i * 3 + 2] = bright * (0.9 - t * 0.6);
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  group.add(new THREE.Points(geom, new THREE.PointsMaterial({
    vertexColors: true, size: scale * 0.015,
    map: getGlowTex(), sizeAttenuation: true,
    blending: THREE.AdditiveBlending, transparent: true,
    opacity: 0.2, depthWrite: false,
  })));

  // Dying white dwarf at center
  const dwarf = new THREE.Mesh(
    new THREE.SphereGeometry(ringRadius * 0.02, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0xeeeeff })
  );
  group.add(dwarf);

  const dwarfGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: getGlowTex(), color: 0xaaccff,
    blending: THREE.AdditiveBlending, transparent: true, opacity: 0.6,
  }));
  dwarfGlow.scale.set(ringRadius * 0.15, ringRadius * 0.15, 1);
  group.add(dwarfGlow);
}

// ── Eta Carinae — star devouring itself ──
// Homunculus Nebula: two bipolar lobes of ejected gas
export function createEtaCarinae(group, def) {
  const scale = def.size * 3000;

  // Two lobes — bipolar emission
  for (let sign = -1; sign <= 1; sign += 2) {
    const count = 5000;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      // Lobe shape — paraboloid
      const t = Math.random();
      const r = t * scale * 0.3;
      const theta = Math.random() * Math.PI * 2;
      const spread = r * 0.4 * (0.5 + t);

      positions[i * 3] = Math.cos(theta) * spread;
      positions[i * 3 + 1] = r * sign;
      positions[i * 3 + 2] = Math.sin(theta) * spread;

      // Color: bright yellow-white near star, fading to orange
      const bright = 0.4 + (1 - t) * 0.5;
      colors[i * 3] = bright;
      colors[i * 3 + 1] = bright * (0.8 - t * 0.4);
      colors[i * 3 + 2] = bright * (0.3 - t * 0.2);
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    group.add(new THREE.Points(geom, new THREE.PointsMaterial({
      vertexColors: true, size: scale * 0.02,
      map: getGlowTex(), sizeAttenuation: true,
      blending: THREE.AdditiveBlending, transparent: true,
      opacity: 0.15, depthWrite: false,
    })));
  }

  // Central star — extremely bright
  const centralStar = new THREE.Sprite(new THREE.SpriteMaterial({
    map: getGlowTex(), color: 0xffeedd,
    blending: THREE.AdditiveBlending, transparent: true, opacity: 0.9,
  }));
  centralStar.scale.set(scale * 0.06, scale * 0.06, 1);
  group.add(centralStar);

  // Equatorial disk
  const diskGeo = new THREE.RingGeometry(scale * 0.02, scale * 0.12, 64, 2);
  const diskMat = new THREE.MeshBasicMaterial({
    color: 0xff8844, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, transparent: true,
    opacity: 0.08, depthWrite: false,
  });
  const disk = new THREE.Mesh(diskGeo, diskMat);
  disk.rotation.x = Math.PI / 2;
  group.add(disk);
}

// ── Magnetar / Neutron Star ──
// Tiny ultra-dense star with visible magnetic field lines, pulsing radiation
export function createMagnetar(group, def) {
  const scale = def.size * 3000;
  const starR = scale * 0.01; // tiny

  // The neutron star — small, bright, blue-white
  const star = new THREE.Mesh(
    new THREE.SphereGeometry(starR, 32, 32),
    new THREE.MeshBasicMaterial({ color: 0xddeeff })
  );
  group.add(star);

  // Intense glow
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: getGlowTex(), color: 0x88aaff,
    blending: THREE.AdditiveBlending, transparent: true, opacity: 0.8,
  }));
  glow.scale.set(scale * 0.08, scale * 0.08, 1);
  group.add(glow);

  // Magnetic field lines — dipole curves
  for (let fieldLine = 0; fieldLine < 12; fieldLine++) {
    const linePoints = [];
    const basePhi = (fieldLine / 12) * Math.PI * 2;

    for (let t = -1; t <= 1; t += 0.05) {
      // Dipole field line: r = r0 * cos^2(latitude)
      const lat = t * Math.PI * 0.45;
      const r = scale * 0.15 * Math.cos(lat) * Math.cos(lat);
      const x = r * Math.cos(basePhi) * Math.cos(lat);
      const y = scale * 0.15 * Math.sin(lat);
      const z = r * Math.sin(basePhi) * Math.cos(lat);
      linePoints.push(new THREE.Vector3(x, y, z));
    }

    const lineGeom = new THREE.BufferGeometry().setFromPoints(linePoints);
    const lineMat = new THREE.LineBasicMaterial({
      color: 0x6688ff,
      transparent: true,
      opacity: 0.15,
      blending: THREE.AdditiveBlending,
    });
    group.add(new THREE.Line(lineGeom, lineMat));
  }

  // Radiation pulses — particles along magnetic axis
  for (let sign = -1; sign <= 1; sign += 2) {
    const jetCount = 800;
    const jetPos = new Float32Array(jetCount * 3);
    const jetCol = new Float32Array(jetCount * 3);

    for (let i = 0; i < jetCount; i++) {
      const dist = Math.random() * scale * 0.3;
      const spread = dist * 0.03;
      jetPos[i * 3] = (Math.random() - 0.5) * spread;
      jetPos[i * 3 + 1] = dist * sign;
      jetPos[i * 3 + 2] = (Math.random() - 0.5) * spread;

      const a = 0.6 * (1 - dist / (scale * 0.3));
      jetCol[i * 3] = 0.5 * a;
      jetCol[i * 3 + 1] = 0.6 * a;
      jetCol[i * 3 + 2] = 1.0 * a;
    }

    const jGeom = new THREE.BufferGeometry();
    jGeom.setAttribute('position', new THREE.BufferAttribute(jetPos, 3));
    jGeom.setAttribute('color', new THREE.BufferAttribute(jetCol, 3));

    group.add(new THREE.Points(jGeom, new THREE.PointsMaterial({
      vertexColors: true, size: scale * 0.008,
      map: getGlowTex(), sizeAttenuation: true,
      blending: THREE.AdditiveBlending, transparent: true,
      opacity: 0.3, depthWrite: false,
    })));
  }
}
```

- [ ] **Step 2: Register stellar renderers in deepspace.js**

```js
import { createHypergiant, createRingNebula, createEtaCarinae, createMagnetar } from './visuals/stellar.js';

registerVisualRenderer('hypergiant', createHypergiant);
registerVisualRenderer('ring', createRingNebula);
registerVisualRenderer('eta_carinae', createEtaCarinae);
registerVisualRenderer('magnetar', createMagnetar);
```

- [ ] **Step 3: Commit**

```bash
git add js/visuals/stellar.js js/deepspace.js
git commit -m "feat: add stellar object renderers — UY Scuti, Ring Nebula, Eta Carinae, Magnetar"
```

---

### Task 4: Galaxy & Void Renderers (Sagittarius A*, Andromeda, Sombrero, Bootes Void)

**Files:**
- Create: `js/visuals/galaxies.js`
- Modify: `js/deepspace.js` (import and register)

- [ ] **Step 1: Create galaxies.js**

```js
// js/visuals/galaxies.js — Galaxy and void renderers
import * as THREE from 'three';

let _glowTex = null;
function getGlowTex() {
  if (_glowTex) return _glowTex;
  const sz = 64;
  const cv = document.createElement('canvas');
  cv.width = sz; cv.height = sz;
  const ctx = cv.getContext('2d');
  const grd = ctx.createRadialGradient(sz/2, sz/2, 0, sz/2, sz/2, sz/2);
  grd.addColorStop(0, 'rgba(255,255,255,0.5)');
  grd.addColorStop(0.4, 'rgba(255,255,255,0.15)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, sz, sz);
  _glowTex = new THREE.CanvasTexture(cv);
  return _glowTex;
}

// ── Sagittarius A* — supermassive black hole ──
// Accretion disk with gravitational lensing, relativistic jets
export function createSupermassiveBH(group, def) {
  const scale = def.size * 3000;
  const bhRadius = scale * 0.05;

  // Event horizon
  const horizon = new THREE.Mesh(
    new THREE.SphereGeometry(bhRadius, 64, 64),
    new THREE.MeshBasicMaterial({ color: 0x000000 })
  );
  group.add(horizon);

  // Accretion disk — ring of hot gas
  const diskCount = 12000;
  const diskPos = new Float32Array(diskCount * 3);
  const diskCol = new Float32Array(diskCount * 3);

  for (let i = 0; i < diskCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const radius = bhRadius * 2 + Math.random() * bhRadius * 8;
    const ySpread = (Math.random() - 0.5) * bhRadius * 0.3;

    diskPos[i * 3] = Math.cos(angle) * radius;
    diskPos[i * 3 + 1] = ySpread;
    diskPos[i * 3 + 2] = Math.sin(angle) * radius;

    const t = (radius - bhRadius * 2) / (bhRadius * 8);
    diskCol[i * 3] = 1.0;
    diskCol[i * 3 + 1] = (1.0 - t) * 0.8 + 0.1;
    diskCol[i * 3 + 2] = (1.0 - t) * 0.6;
  }

  const diskGeom = new THREE.BufferGeometry();
  diskGeom.setAttribute('position', new THREE.BufferAttribute(diskPos, 3));
  diskGeom.setAttribute('color', new THREE.BufferAttribute(diskCol, 3));

  const accretion = new THREE.Points(diskGeom, new THREE.PointsMaterial({
    vertexColors: true, size: bhRadius * 0.3,
    map: getGlowTex(), sizeAttenuation: true,
    blending: THREE.AdditiveBlending, transparent: true,
    opacity: 0.7, depthWrite: false,
  }));
  accretion.userData._isAccretion = true;
  group.add(accretion);

  // Relativistic jets
  for (let sign = -1; sign <= 1; sign += 2) {
    const jetCount = 2000;
    const jetPos = new Float32Array(jetCount * 3);
    const jetCol = new Float32Array(jetCount * 3);

    for (let i = 0; i < jetCount; i++) {
      const dist = Math.random() * scale * 0.4;
      const spread = bhRadius * 0.3 + dist * 0.05;
      jetPos[i * 3] = (Math.random() - 0.5) * spread;
      jetPos[i * 3 + 1] = dist * sign;
      jetPos[i * 3 + 2] = (Math.random() - 0.5) * spread;

      const a = 0.6 * (1 - dist / (scale * 0.4));
      jetCol[i * 3] = 0.4 * a;
      jetCol[i * 3 + 1] = 0.5 * a;
      jetCol[i * 3 + 2] = 1.0 * a;
    }

    const jGeom = new THREE.BufferGeometry();
    jGeom.setAttribute('position', new THREE.BufferAttribute(jetPos, 3));
    jGeom.setAttribute('color', new THREE.BufferAttribute(jetCol, 3));

    group.add(new THREE.Points(jGeom, new THREE.PointsMaterial({
      vertexColors: true, size: bhRadius * 0.4,
      map: getGlowTex(), sizeAttenuation: true,
      blending: THREE.AdditiveBlending, transparent: true,
      opacity: 0.2, depthWrite: false,
    })));
  }

  // Glow shells
  for (const g of [
    { r: bhRadius * 4, color: 0xff4400, opacity: 0.06 },
    { r: bhRadius * 8, color: 0xff2200, opacity: 0.02 },
  ]) {
    group.add(new THREE.Mesh(
      new THREE.SphereGeometry(g.r, 32, 32),
      new THREE.MeshBasicMaterial({
        color: g.color, transparent: true, opacity: g.opacity,
        blending: THREE.AdditiveBlending, side: THREE.BackSide, depthWrite: false,
      })
    ));
  }
}

// ── Spiral Galaxy (Andromeda) ──
// Full spiral galaxy with arms, core, dust lanes
export function createSpiralGalaxy(group, def) {
  const scale = def.size * 3000;
  const arms = 4;
  const count = 60000;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    const armIndex = i % arms;
    const armAngle = (armIndex / arms) * Math.PI * 2;
    const t = Math.random();
    const radius = t * scale * 0.4;
    const spiralAngle = armAngle + t * Math.PI * 2.5;
    const spread = radius * 0.08;

    const x = Math.cos(spiralAngle) * radius + (Math.random() - 0.5) * spread;
    const y = (Math.random() - 0.5) * spread * 0.15; // very flat
    const z = Math.sin(spiralAngle) * radius + (Math.random() - 0.5) * spread;

    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;

    // Blueish arms, warm core
    const distFromCenter = Math.sqrt(x * x + z * z) / (scale * 0.4);
    const bright = 0.3 + Math.random() * 0.5;
    colors[i * 3] = bright * (0.7 + distFromCenter * 0.1);
    colors[i * 3 + 1] = bright * (0.75 + distFromCenter * 0.1);
    colors[i * 3 + 2] = bright * (0.85 + distFromCenter * 0.15);
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  // Tilt slightly for dramatic viewing angle
  group.rotation.x = Math.PI * 0.15;
  group.rotation.z = Math.PI * 0.1;

  group.add(new THREE.Points(geom, new THREE.PointsMaterial({
    vertexColors: true, size: scale * 0.004,
    map: getGlowTex(), sizeAttenuation: true,
    blending: THREE.AdditiveBlending, transparent: true,
    opacity: 0.5, depthWrite: false,
  })));

  // Bright galactic core
  const coreGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: getGlowTex(), color: 0xffeedd,
    blending: THREE.AdditiveBlending, transparent: true, opacity: 0.5,
  }));
  coreGlow.scale.set(scale * 0.08, scale * 0.08, 1);
  group.add(coreGlow);
}

// ── Sombrero Galaxy ──
// Edge-on galaxy with dramatic dust lane and bright core
export function createSombreroGalaxy(group, def) {
  const scale = def.size * 3000;

  // Bulge — bright elliptical core
  const bulgeCount = 15000;
  const bulgePos = new Float32Array(bulgeCount * 3);
  const bulgeCol = new Float32Array(bulgeCount * 3);

  for (let i = 0; i < bulgeCount; i++) {
    const r = Math.pow(Math.random(), 0.5) * scale * 0.15;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);

    bulgePos[i * 3] = r * Math.sin(phi) * Math.cos(theta) * 1.5; // elongated
    bulgePos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta) * 0.5;
    bulgePos[i * 3 + 2] = r * Math.cos(phi);

    const bright = 0.5 + Math.random() * 0.4;
    bulgeCol[i * 3] = bright * 0.95;
    bulgeCol[i * 3 + 1] = bright * 0.85;
    bulgeCol[i * 3 + 2] = bright * 0.65;
  }

  const bGeom = new THREE.BufferGeometry();
  bGeom.setAttribute('position', new THREE.BufferAttribute(bulgePos, 3));
  bGeom.setAttribute('color', new THREE.BufferAttribute(bulgeCol, 3));

  group.add(new THREE.Points(bGeom, new THREE.PointsMaterial({
    vertexColors: true, size: scale * 0.006,
    map: getGlowTex(), sizeAttenuation: true,
    blending: THREE.AdditiveBlending, transparent: true,
    opacity: 0.4, depthWrite: false,
  })));

  // Disk — edge-on ring with dust lane
  const diskCount = 20000;
  const diskPos = new Float32Array(diskCount * 3);
  const diskCol = new Float32Array(diskCount * 3);

  for (let i = 0; i < diskCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const radius = scale * 0.1 + Math.random() * scale * 0.3;
    const ySpread = (Math.random() - 0.5) * scale * 0.01;

    diskPos[i * 3] = Math.cos(angle) * radius;
    diskPos[i * 3 + 1] = ySpread;
    diskPos[i * 3 + 2] = Math.sin(angle) * radius;

    const bright = 0.2 + Math.random() * 0.3;
    diskCol[i * 3] = bright * 0.8;
    diskCol[i * 3 + 1] = bright * 0.75;
    diskCol[i * 3 + 2] = bright * 0.6;
  }

  const dGeom = new THREE.BufferGeometry();
  dGeom.setAttribute('position', new THREE.BufferAttribute(diskPos, 3));
  dGeom.setAttribute('color', new THREE.BufferAttribute(diskCol, 3));

  group.add(new THREE.Points(dGeom, new THREE.PointsMaterial({
    vertexColors: true, size: scale * 0.005,
    map: getGlowTex(), sizeAttenuation: true,
    blending: THREE.AdditiveBlending, transparent: true,
    opacity: 0.25, depthWrite: false,
  })));

  // Dark dust lane — normal-blended dark ring
  const dustGeo = new THREE.RingGeometry(scale * 0.12, scale * 0.35, 128, 2);
  const dustMat = new THREE.MeshBasicMaterial({
    color: 0x110800, side: THREE.DoubleSide,
    transparent: true, opacity: 0.4, depthWrite: false,
  });
  const dust = new THREE.Mesh(dustGeo, dustMat);
  dust.rotation.x = Math.PI / 2;
  group.add(dust);
}

// ── Bootes Void ──
// The Great Nothing — near-total absence of stars
export function createBootesVoid(group, def) {
  const scale = def.size * 3000;

  // A few scattered galaxies — 60 where thousands should be
  const galaxyCount = 60;
  for (let i = 0; i < galaxyCount; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = (0.2 + Math.random() * 0.8) * scale * 0.4;

    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: getGlowTex(),
      color: 0x556688,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.08 + Math.random() * 0.06,
    }));
    sprite.position.set(
      r * Math.sin(phi) * Math.cos(theta),
      r * Math.sin(phi) * Math.sin(theta),
      r * Math.cos(phi)
    );
    const s = scale * (0.005 + Math.random() * 0.01);
    sprite.scale.set(s, s, 1);
    group.add(sprite);
  }

  // The boundary shell — faint ring of normal galaxy density at the edge
  // This makes the void feel like a bubble of emptiness
  const shellCount = 3000;
  const shellPos = new Float32Array(shellCount * 3);
  const shellCol = new Float32Array(shellCount * 3);

  for (let i = 0; i < shellCount; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = scale * 0.4 * (0.9 + Math.random() * 0.1); // thin shell at edge

    shellPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    shellPos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    shellPos[i * 3 + 2] = r * Math.cos(phi);

    const bright = 0.1 + Math.random() * 0.15;
    shellCol[i * 3] = bright * 0.6;
    shellCol[i * 3 + 1] = bright * 0.65;
    shellCol[i * 3 + 2] = bright * 0.8;
  }

  const sGeom = new THREE.BufferGeometry();
  sGeom.setAttribute('position', new THREE.BufferAttribute(shellPos, 3));
  sGeom.setAttribute('color', new THREE.BufferAttribute(shellCol, 3));

  group.add(new THREE.Points(sGeom, new THREE.PointsMaterial({
    vertexColors: true, size: scale * 0.008,
    map: getGlowTex(), sizeAttenuation: true,
    blending: THREE.AdditiveBlending, transparent: true,
    opacity: 0.12, depthWrite: false,
  })));
}
```

- [ ] **Step 2: Register galaxy renderers in deepspace.js**

```js
import { createSupermassiveBH, createSpiralGalaxy, createSombreroGalaxy, createBootesVoid } from './visuals/galaxies.js';

registerVisualRenderer('supermassive_bh', createSupermassiveBH);
registerVisualRenderer('spiral_galaxy', createSpiralGalaxy);
registerVisualRenderer('sombrero_galaxy', createSombreroGalaxy);
registerVisualRenderer('void', createBootesVoid);
```

- [ ] **Step 3: Commit**

```bash
git add js/visuals/galaxies.js js/deepspace.js
git commit -m "feat: add galaxy and void renderers — Sagittarius A*, Andromeda, Sombrero, Bootes Void"
```

---

### Task 5: Landmark Animation System

**Files:**
- Modify: `js/deepspace.js`

Landmarks with moving parts (pulsar beams, accretion disks, magnetar pulses) need per-frame updates.

- [ ] **Step 1: Add updateLandmarks function to deepspace.js**

```js
function updateLandmarks(dt) {
  for (const lm of landmarks) {
    const group = lm.anchor;
    for (let i = 0; i < group.children.length; i++) {
      const child = group.children[i];

      // Pulsar beams — rotate around Y axis
      if (child.userData._isPulsarBeam) {
        child.rotation.y += dt * 30; // 30 rad/s — fast spin
      }

      // Pulsar glow — pulsing opacity
      if (child.userData._isPulsar) {
        child.material.opacity = 0.5 + Math.sin(performance.now() * 0.03) * 0.4;
      }

      // Accretion disk — slow rotation
      if (child.userData._isAccretion) {
        child.rotation.y += dt * 0.5;
      }
    }
  }
}
```

- [ ] **Step 2: Call updateLandmarks from updateDeepSpace**

Modify the existing `updateDeepSpace` function:

```js
export function updateDeepSpace(dt, camPos) {
  if (accretionParticles) {
    accretionParticles.rotation.y += dt * 0.5;
  }
  if (accretionDiskMesh) {
    accretionDiskMesh.rotation.z += dt * 0.3;
  }
  updateLandmarks(dt);
}
```

- [ ] **Step 3: Commit**

```bash
git add js/deepspace.js
git commit -m "feat: add landmark animation system — pulsar beams, accretion disks"
```

---

### Task 6: Warp Travel System

**Files:**
- Modify: `js/flight.js`
- Modify: `js/deepspace.js` (import getLandmarks)

The existing fly-to system does 2-6 second flights within the solar system. Warp is a new long-distance mode for interstellar travel with 15-30 second journeys.

- [ ] **Step 1: Add warp travel state to flight.js**

Add after the existing fly-to state variables:

```js
// Warp travel state (long-distance interstellar/intergalactic)
let warpTarget = null;
let warpT = 0;
let warpDuration = 0;
const warpFromP = new THREE.Vector3();
const warpFromQ = new THREE.Quaternion();
const warpTargetP = new THREE.Vector3();
let warpPhase = 'none'; // 'none' | 'accelerating' | 'cruising' | 'decelerating'
```

- [ ] **Step 2: Add warpTo function**

```js
export function warpTo(targetName) {
  // Check landmarks
  const { getLandmarks } = await import('./deepspace.js');
  const landmarks = getLandmarks();
  const landmark = landmarks.find(lm => lm.name === targetName);

  if (!landmark) {
    // Fall back to regular fly-to for solar system bodies
    flyTo(targetName);
    return;
  }

  // Cancel any active modes
  orbitMode = false;
  orbitBody = null;
  returning = false;
  flyTarget = null;

  warpFromP.copy(camPos);
  warpFromQ.copy(camQuat);
  warpTargetP.copy(landmark.pos);

  // Offset arrival position — approach from current direction
  const approachDir = new THREE.Vector3().subVectors(landmark.pos, camPos).normalize();
  const arrivalDist = landmark.radius * 2;
  warpTargetP.addScaledVector(approachDir, -arrivalDist);

  // Duration based on distance: 15-30 seconds
  const dist = camPos.distanceTo(landmark.pos);
  warpDuration = Math.max(15, Math.min(30, dist / 2000));

  warpTarget = { name: targetName, landmark };
  warpT = 0;
  warpPhase = 'accelerating';
  velocity.set(0, 0, 0);
  angularVelocity.set(0, 0, 0);

  setActivePlanet(targetName);
}
```

- [ ] **Step 3: Add warp update logic in updateFlight**

Insert after the existing fly-to block and before the orbit block:

```js
// ── 1a2. Warp travel (interstellar) ──────────────────────────────────────
if (warpTarget) {
  warpT += dt / warpDuration;

  // Cancel warp on manual input
  const anyKey = keys['KeyW'] || keys['KeyS'] || keys['KeyA'] || keys['KeyD'];
  if (anyKey && warpT > 0.1) {
    // Allow canceling after the first moment
    warpTarget = null;
    warpPhase = 'none';
    // Reset FOV
    cam.fov = 70;
    cam.updateProjectionMatrix();
    const streakEl = document.getElementById('warp-streaks');
    if (streakEl) streakEl.style.opacity = 0;
    updateHUD();
    // Don't return — fall through to normal flight
  }

  if (warpTarget) {
    if (warpT >= 1) {
      warpT = 1;
      camPos.copy(warpTargetP);
      warpTarget = null;
      warpPhase = 'none';
      cam.fov = 70;
      cam.updateProjectionMatrix();
      const streakEl = document.getElementById('warp-streaks');
      if (streakEl) streakEl.style.opacity = 0;
      updateHUD();
      return;
    }

    // Three-phase easing: accelerate, cruise, decelerate
    let ease;
    if (warpT < 0.15) {
      // Acceleration phase
      warpPhase = 'accelerating';
      ease = warpT / 0.15;
      ease = ease * ease; // quadratic ease-in
      ease *= 0.15; // scale to 0-0.15
    } else if (warpT < 0.85) {
      // Cruise phase
      warpPhase = 'cruising';
      ease = 0.15 + (warpT - 0.15) * (0.7 / 0.7);
    } else {
      // Deceleration phase
      warpPhase = 'decelerating';
      const t = (warpT - 0.85) / 0.15;
      ease = 0.85 + (1 - (1 - t) * (1 - t)) * 0.15; // quadratic ease-out
    }

    // Interpolate position
    camPos.lerpVectors(warpFromP, warpTargetP, ease);

    // Look toward destination
    _lookMat.lookAt(camPos, warpTargetP, _upVec);
    const targetQuat = new THREE.Quaternion().setFromRotationMatrix(_lookMat);
    const lookEase = Math.min(warpT * 5, 1); // snap to look-at quickly
    camQuat.slerpQuaternions(warpFromQ, targetQuat, lookEase);
    cam.quaternion.copy(camQuat);

    // Speed feeling — varies by phase
    let speedFeeling;
    if (warpPhase === 'accelerating') {
      speedFeeling = warpT / 0.15; // 0 to 1
    } else if (warpPhase === 'cruising') {
      speedFeeling = 1.0;
    } else {
      speedFeeling = 1 - (warpT - 0.85) / 0.15; // 1 to 0
    }

    cam.fov = 70 + speedFeeling * 30; // up to 100 FOV at max warp
    cam.updateProjectionMatrix();

    const streakEl = document.getElementById('warp-streaks');
    if (streakEl) streakEl.style.opacity = speedFeeling * 0.8;

    // HUD notification at arrival
    if (warpT >= 0.95 && warpTarget) {
      showArrivalNotification(warpTarget.name, warpTarget.landmark.desc);
    }

    updateHUD();
    return;
  }
}
```

- [ ] **Step 4: Add arrival notification function**

```js
let _arrivalShown = false;

function showArrivalNotification(name, desc) {
  if (_arrivalShown) return;
  _arrivalShown = true;

  let el = document.getElementById('arrival-notification');
  if (!el) {
    el = document.createElement('div');
    el.id = 'arrival-notification';
    el.style.cssText = `
      position:fixed; top:15%; left:50%; transform:translateX(-50%);
      font-family:'Segoe UI',sans-serif; text-align:center; z-index:50;
      pointer-events:none; opacity:0; transition:opacity 2s;
    `;
    document.body.appendChild(el);
  }

  el.innerHTML = `
    <div style="font-size:9px;letter-spacing:6px;color:rgba(140,180,255,0.5);margin-bottom:8px">ENTERING</div>
    <div style="font-size:22px;letter-spacing:4px;color:rgba(255,255,255,0.9);font-weight:100;margin-bottom:6px">${name}</div>
    <div style="font-size:10px;letter-spacing:1px;color:rgba(255,255,255,0.35);max-width:400px;line-height:1.8">${desc}</div>
  `;
  el.style.opacity = '1';

  setTimeout(() => { el.style.opacity = '0'; _arrivalShown = false; }, 6000);
}
```

- [ ] **Step 5: Export warpTo and isWarping**

```js
export function warpTo(targetName) { /* ... */ }
export function isWarpTraveling() { return !!warpTarget; }
```

- [ ] **Step 6: Commit**

```bash
git add js/flight.js
git commit -m "feat: add interstellar warp travel system — 15-30 sec journeys with cinematic effects"
```

---

### Task 7: Star Map UI

**Files:**
- Create: `js/starmap.js`
- Modify: `js/main.js` (import and wire up)
- Modify: `index.html` (add star map overlay CSS)

The star map is a 3D overlay showing all discoverable landmarks. Press M to toggle. Click a landmark to warp there.

- [ ] **Step 1: Create starmap.js**

```js
// js/starmap.js — 3D star map navigation overlay
import * as THREE from 'three';
import { getLandmarks } from './deepspace.js';
import { warpTo } from './flight.js';
import { AU } from './constants.js';

let mapActive = false;
let mapScene, mapCamera, mapRenderer;
let mapContainer;
let labelEls = []; // { el, landmark, sprite }
let _raycaster, _mouse;
let landmarkSprites = [];

export function isStarMapOpen() { return mapActive; }

export function initStarMap() {
  // Create overlay container
  mapContainer = document.createElement('div');
  mapContainer.id = 'star-map';
  mapContainer.style.cssText = `
    position:fixed; inset:0; z-index:60; display:none;
    background:rgba(0,0,0,0.85); cursor:crosshair;
  `;
  document.body.appendChild(mapContainer);

  // Title
  const title = document.createElement('div');
  title.style.cssText = `
    position:absolute; top:30px; left:50%; transform:translateX(-50%);
    font-family:'Segoe UI',sans-serif; font-size:11px; letter-spacing:6px;
    color:rgba(140,180,255,0.6); pointer-events:none;
  `;
  title.textContent = 'STAR MAP';
  mapContainer.appendChild(title);

  // Close hint
  const hint = document.createElement('div');
  hint.style.cssText = `
    position:absolute; bottom:30px; left:50%; transform:translateX(-50%);
    font-family:'Segoe UI',sans-serif; font-size:9px; letter-spacing:3px;
    color:rgba(255,255,255,0.25); pointer-events:none;
  `;
  hint.textContent = 'PRESS M TO CLOSE · CLICK DESTINATION TO WARP';
  mapContainer.appendChild(hint);

  // Three.js mini scene for the map
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:100%;height:100%;';
  mapContainer.appendChild(canvas);

  mapScene = new THREE.Scene();
  mapCamera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100000);
  mapCamera.position.set(0, 50, 80);
  mapCamera.lookAt(0, 0, 0);

  mapRenderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  mapRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  mapRenderer.setSize(window.innerWidth, window.innerHeight);

  _raycaster = new THREE.Raycaster();
  _raycaster.params.Points.threshold = 3;
  _mouse = new THREE.Vector2();

  // Handle clicks
  canvas.addEventListener('click', onMapClick);

  // Handle mouse orbit
  let isDragging = false;
  let dragX = 0, dragY = 0;
  let orbitAngle = 0, orbitElevation = 0.5;
  let orbitDist = 80;

  canvas.addEventListener('mousedown', (e) => {
    isDragging = true;
    dragX = e.clientX;
    dragY = e.clientY;
  });
  canvas.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    orbitAngle += (e.clientX - dragX) * 0.005;
    orbitElevation = Math.max(-1.2, Math.min(1.2, orbitElevation + (e.clientY - dragY) * 0.005));
    dragX = e.clientX;
    dragY = e.clientY;
    updateMapCamera();
  });
  canvas.addEventListener('mouseup', () => { isDragging = false; });
  canvas.addEventListener('wheel', (e) => {
    orbitDist = Math.max(20, Math.min(200, orbitDist + e.deltaY * 0.05));
    updateMapCamera();
  });

  function updateMapCamera() {
    mapCamera.position.set(
      Math.cos(orbitAngle) * Math.cos(orbitElevation) * orbitDist,
      Math.sin(orbitElevation) * orbitDist,
      Math.sin(orbitAngle) * Math.cos(orbitElevation) * orbitDist
    );
    mapCamera.lookAt(0, 0, 0);
  }

  // M key toggle
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyM') toggleStarMap();
  });

  // Resize
  window.addEventListener('resize', () => {
    if (!mapActive) return;
    mapCamera.aspect = window.innerWidth / window.innerHeight;
    mapCamera.updateProjectionMatrix();
    mapRenderer.setSize(window.innerWidth, window.innerHeight);
  });
}

function buildMap() {
  // Clear previous
  while (mapScene.children.length) mapScene.remove(mapScene.children[0]);
  landmarkSprites = [];
  labelEls.forEach(l => l.el.remove());
  labelEls = [];

  const landmarks = getLandmarks();

  // Normalize positions to fit in the map view
  let maxDist = 0;
  for (const lm of landmarks) {
    const d = lm.pos.length();
    if (d > maxDist) maxDist = d;
  }
  const mapScale = 40 / maxDist; // fit in a 40-unit radius

  // Solar system at center
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    color: 0xffcc44,
    map: makeMapDot(),
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  }));
  sunSprite.scale.set(2, 2, 1);
  mapScene.add(sunSprite);

  // Add label for Sol
  addMapLabel('SOL', new THREE.Vector3(0, 0, 0), 0xffcc44);

  // Landmarks
  for (const lm of landmarks) {
    const pos = lm.pos.clone().multiplyScalar(mapScale);

    const color = lm.tier === 'intergalactic' ? 0x8899dd : 0xaaddff;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      color,
      map: makeMapDot(),
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    }));
    sprite.position.copy(pos);
    sprite.scale.set(1.5, 1.5, 1);
    sprite.userData._landmarkName = lm.name;
    mapScene.add(sprite);
    landmarkSprites.push(sprite);

    // Connection line to center
    const lineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0), pos
    ]);
    const lineMat = new THREE.LineBasicMaterial({
      color, transparent: true, opacity: 0.08,
    });
    mapScene.add(new THREE.Line(lineGeo, lineMat));

    // Label
    addMapLabel(lm.name, pos, color);
  }

  // Ambient light
  mapScene.add(new THREE.AmbientLight(0xffffff, 0.5));
}

function addMapLabel(text, worldPos, color) {
  const el = document.createElement('div');
  el.style.cssText = `
    position:absolute; pointer-events:none;
    font-family:'Segoe UI',sans-serif; font-size:8px;
    letter-spacing:2px; white-space:nowrap;
    color:rgba(${(color >> 16) & 255},${(color >> 8) & 255},${color & 255},0.6);
    text-shadow:0 0 6px rgba(0,0,0,0.8);
  `;
  el.textContent = text;
  mapContainer.appendChild(el);
  labelEls.push({ el, worldPos: worldPos.clone() });
}

function updateLabels() {
  for (const label of labelEls) {
    const projected = label.worldPos.clone().project(mapCamera);
    if (projected.z > 0 && projected.z < 1) {
      const x = (projected.x + 1) / 2 * window.innerWidth;
      const y = (-projected.y + 1) / 2 * window.innerHeight;
      label.el.style.left = (x + 8) + 'px';
      label.el.style.top = (y - 4) + 'px';
      label.el.style.display = 'block';
    } else {
      label.el.style.display = 'none';
    }
  }
}

function onMapClick(e) {
  _mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  _mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
  _raycaster.setFromCamera(_mouse, mapCamera);

  const intersects = _raycaster.intersectObjects(landmarkSprites);
  if (intersects.length > 0) {
    const name = intersects[0].object.userData._landmarkName;
    if (name) {
      toggleStarMap(); // close map
      warpTo(name);    // begin warp
    }
  }
}

function makeMapDot() {
  const sz = 32;
  const cv = document.createElement('canvas');
  cv.width = sz; cv.height = sz;
  const ctx = cv.getContext('2d');
  const grd = ctx.createRadialGradient(sz/2, sz/2, 0, sz/2, sz/2, sz/2);
  grd.addColorStop(0, 'rgba(255,255,255,0.8)');
  grd.addColorStop(0.3, 'rgba(255,255,255,0.4)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, sz, sz);
  return new THREE.CanvasTexture(cv);
}

export function toggleStarMap() {
  mapActive = !mapActive;
  if (mapActive) {
    buildMap();
    mapContainer.style.display = 'block';
  } else {
    mapContainer.style.display = 'none';
  }
}

export function updateStarMap() {
  if (!mapActive) return;
  updateLabels();
  mapRenderer.render(mapScene, mapCamera);
}
```

- [ ] **Step 2: Wire star map into main.js**

Add import:
```js
import { initStarMap, updateStarMap, isStarMapOpen } from './starmap.js';
```

In `boot()`, after `initNavigation(camera)`:
```js
initStarMap();
```

In the `animate()` loop, after `updateNavigation`:
```js
updateStarMap();
```

- [ ] **Step 3: Commit**

```bash
git add js/starmap.js js/main.js
git commit -m "feat: add 3D star map navigation — M key to toggle, click to warp"
```

---

### Task 8: Music System Expansion

**Files:**
- Modify: `js/music.js`
- Modify: `js/deepspace.js` (export landmark data for music)

Expand the zone system so each landmark triggers its own classical track.

- [ ] **Step 1: Add per-landmark music zones**

Replace the existing `ZONES` array in music.js to include landmark-specific zones. The music system needs to import and check landmark positions.

```js
import { getLandmarks } from './deepspace.js';

// Replace the ZONES array with a dynamic zone checker
function detectZone(pos, allBodies) {
  // First check landmark-specific zones
  const landmarks = getLandmarks();
  for (const lm of landmarks) {
    const d = pos.distanceTo(lm.pos);
    if (d < lm.radius * 3) {
      return { name: lm.name, track: lm.musicTrack };
    }
  }

  // Fall through to existing zone checks
  if (distTo(pos, allBodies, 'BLACK HOLE') < 200 * AU) return { name: 'blackhole', track: null };
  if (distTo(pos, allBodies, 'SOL') < 30 * AU) return { name: 'sun', track: null };
  if (nearAny(pos, allBodies, ['JUPITER','SATURN','URANUS','NEPTUNE'], 80 * AU)) return { name: 'giants', track: null };
  if (nearAny(pos, allBodies, ['MERCURY','VENUS','EARTH','MARS','MOON'], 40 * AU)) return { name: 'inner', track: null };

  return { name: 'deep', track: null };
}
```

- [ ] **Step 2: Modify updateMusic to use detectZone**

```js
export function updateMusic(camPos, allBodies) {
  if (!musicStarted || paused) return;

  const now = performance.now();
  const dt = (now - lastFrameTime) / 1000;
  lastFrameTime = now;

  zoneCheckAccum += dt;
  if (zoneCheckAccum < 2) return;
  zoneCheckAccum = 0;

  const zone = detectZone(camPos, allBodies);

  if (zone.name !== currentZone) {
    currentZone = zone.name;
    if (usingSynth) {
      updateSynthZone(currentZone);
    } else if (zone.track) {
      // Landmark-specific track
      crossfadeToTrack(zone.track, zone.name);
    } else {
      // Legacy zone-based track
      crossfadeTo(currentZone);
    }
  }

  // If both channels are silent and we have a zone, start playing
  if (!usingSynth && !audioFailed && currentZone) {
    const a = channelA, b = channelB;
    if (a.paused && b.paused) {
      const zone = detectZone(camPos, allBodies);
      if (zone.track) {
        crossfadeToTrack(zone.track, zone.name);
      } else {
        crossfadeTo(currentZone);
      }
    }
  }
}
```

- [ ] **Step 3: Add crossfadeToTrack function**

```js
function crossfadeToTrack(trackPath, zoneName) {
  if (audioFailed || usingSynth) return;

  fadeOut(getActiveEl());
  activeChannel = activeChannel === 'A' ? 'B' : 'A';
  const next = getActiveEl();

  next.src = trackPath;
  next.load();

  const playPromise = next.play();
  if (playPromise && playPromise.catch) {
    playPromise.catch(err => {
      console.warn('[music] Audio play failed:', err.message);
      failCount++;
      if (failCount >= 2 && !usingSynth) activateSynthFallback();
    });
  }

  fadeIn(next, masterVol);

  if (trackLbl) {
    // Format landmark name nicely
    const label = zoneName.split(' ').map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(' ');
    trackLbl.textContent = label;
  }
}
```

- [ ] **Step 4: Add warp travel music zone**

Add a special check in detectZone for warp state:

```js
import { isWarpTraveling } from './flight.js';

function detectZone(pos, allBodies) {
  // Warp travel overrides all zones
  if (isWarpTraveling()) {
    return { name: 'warp', track: 'audio/bach_chaconne.mp3' };
  }

  // ... rest of zone detection
}
```

- [ ] **Step 5: Commit**

```bash
git add js/music.js
git commit -m "feat: expand music system — per-landmark classical tracks with warp travel music"
```

---

### Task 9: Audio Asset Sourcing

**Files:**
- Modify: audio directory (download new tracks)

Source free public domain classical recordings for landmarks that don't already have tracks.

- [ ] **Step 1: Inventory existing vs needed tracks**

Already have:
- `moonlight_sonata.mp3` — Sagittarius A* ✓
- `inner_clair_de_lune.mp3` — Carina Nebula ✓
- `paganini_caprice24.mp3` — Magnetar ✓
- `bach_chaconne.mp3` — Warp travel ✓

Need to source:
- `bach_air.mp3` — Pillars of Creation (Air on the G String)
- `vivaldi_winter_largo.mp3` — Crab Nebula
- `barber_adagio.mp3` — UY Scuti
- `albinoni_adagio.mp3` — Ring Nebula
- `satie_gymnopedie.mp3` — Horsehead Nebula
- `grieg_mountain_king.mp3` — Eta Carinae
- `vivaldi_spring_largo.mp3` — Andromeda
- `pachelbel_canon.mp3` — Sombrero Galaxy
- `part_spiegel.mp3` — Bootes Void

- [ ] **Step 2: Source and download tracks**

Free public domain sources for classical recordings:
- **Musopen.org** — Creative Commons recordings of classical works
- **IMSLP/Petrucci** — public domain scores and some recordings
- **Free Music Archive** — CC-licensed classical performances
- **Archive.org** — public domain recordings

Download each track, convert to MP3 (128kbps is fine for web), and place in the `audio/` directory. Keep file sizes under 5MB each for reasonable load times.

- [ ] **Step 3: Commit audio files**

```bash
git add audio/
git commit -m "feat: add classical music tracks for all 12 cosmic landmarks"
```

---

### Task 10: Carousel & HUD Updates

**Files:**
- Modify: `js/navigation.js` (add landmark section to carousel)
- Modify: `js/hud.js` (show landmark info cards)

- [ ] **Step 1: Add landmark section to planet carousel**

In `navigation.js`, after the spacecraft section in `createBar()`:

```js
// Landmarks divider
const lmDivider = document.createElement('div');
lmDivider.className = 'pb-divider';
lmDivider.textContent = '|';
barContainer.appendChild(lmDivider);

// Landmark items
const landmarks = getDeepSpaceObjects().filter(o => o.isLandmark);
for (const lm of landmarks) {
  const el = document.createElement('div');
  el.className = 'pb-item pb-landmark';
  el.innerHTML = `<div class="pb-name">${lm.name}</div><div class="pb-dist"></div>`;
  el.addEventListener('click', () => {
    setActivePlanet(lm.name);
    // Use warpTo for landmarks
    import('./flight.js').then(m => m.warpTo(lm.name));
  });
  barContainer.appendChild(el);
  barItems.push({ el, distEl: el.querySelector('.pb-dist'), name: lm.name, bodyRef: lm });
}
```

- [ ] **Step 2: Add landmark info card data to planetconfig.js**

Add info card entries for each landmark so the HUD shows facts and lore when near them.

```js
// In planetconfig.js, add to the config object:
'PILLARS OF CREATION': {
  type: 'Emission Nebula',
  facts: ['6,500 light-years from Earth', 'Part of the Eagle Nebula (M16)', 'Columns are about 5 light-years tall', 'First photographed by Hubble in 1995'],
  lore: 'These towers of gas and dust are stellar nurseries — new stars are being born at their tips. The pillars themselves may have already been destroyed by a supernova, but the light showing their destruction won\'t reach us for another 1,000 years.'
},
// ... (similar entries for all 12 landmarks)
```

- [ ] **Step 3: Update distance display for landmarks**

In `updateBar()`, add light-year display for distant objects:

```js
// For landmark distances, show in light-years
if (item.bodyRef.isLandmark || item.bodyRef.tier) {
  const distLY = dist / (AU * 63241); // 1 LY ≈ 63,241 AU
  if (distLY > 1000000) {
    item.distEl.textContent = (distLY / 1000000).toFixed(1) + 'M LY';
  } else if (distLY > 1000) {
    item.distEl.textContent = (distLY / 1000).toFixed(1) + 'K LY';
  } else {
    item.distEl.textContent = distLY.toFixed(0) + ' LY';
  }
} else {
  // existing AU/km display
}
```

- [ ] **Step 4: Commit**

```bash
git add js/navigation.js js/hud.js js/planetconfig.js
git commit -m "feat: add landmarks to carousel with light-year distances and info cards"
```

---

### Task 11: Integration & Polish

**Files:**
- Modify: `js/main.js`
- Modify: `js/flight.js`
- Modify: `index.html` (arrival notification CSS)

- [ ] **Step 1: Add arrival notification CSS to index.html**

```css
#arrival-notification {
  position: fixed;
  top: 15%;
  left: 50%;
  transform: translateX(-50%);
  text-align: center;
  z-index: 50;
  pointer-events: none;
  opacity: 0;
  transition: opacity 2s;
}
```

- [ ] **Step 2: Add landmark styling to carousel CSS**

```css
.pb-landmark .pb-name {
  color: rgba(140, 180, 255, 0.7);
  font-size: 7px;
}
```

- [ ] **Step 3: Ensure warp disables normal flight controls**

In flight.js `updateFlight`, add star map check:

```js
import { isStarMapOpen } from './starmap.js';

// At the top of updateFlight:
if (isStarMapOpen()) return; // freeze flight when map is open
```

- [ ] **Step 4: Test the full flow**

Open browser, verify:
1. All 12 landmarks appear as glow sprites at minimum
2. Custom visual renderers display correctly for each type
3. M key opens star map showing all landmarks
4. Clicking a landmark in star map initiates warp
5. Warp travel lasts 15-30 seconds with speed effects
6. Arrival notification displays on arrival
7. Music crossfades to landmark-specific track
8. Carousel shows landmarks with light-year distances
9. Returning to solar system crossfades back to zone music

- [ ] **Step 5: Commit**

```bash
git add index.html js/main.js js/flight.js
git commit -m "feat: integrate cosmic landmarks — warp, star map, music, and HUD polish"
```

- [ ] **Step 6: Update STATUS.md**

Add the new landmarks and systems to the status doc, marking Phase 1 items as complete and adding any new bugs discovered during testing.

```bash
git add STATUS.md
git commit -m "docs: update STATUS.md with Phase 1 cosmic landmarks completion"
```
