import * as THREE from 'three';
import { getPointTexture } from './textures.js';
import { setWorldPos } from './engine.js';

import { AU, INTERSTELLAR_SCALE, INTERGALACTIC_SCALE } from './constants.js';
import { LOCATIONS } from './catalog.js';
import { createPillars, createCrabNebula, createCarinaNebula, createHorsehead } from './visuals/nebulae.js';
import { createHypergiant, createRingNebula, createEtaCarinae, createMagnetar } from './visuals/stellar.js';
import { createSupermassiveBH, createSpiralGalaxy, createSombreroGalaxy, createBootesVoid } from './visuals/galaxies.js';

// Landmark data lives in the location catalog — see js/catalog.js

// ── Visual renderer registry ─────────────────────────────────────────
// Maps a catalog entry's `visual` key to a render function: fn(group, def) => void
const VISUAL_RENDERERS = {};

/**
 * Register a custom visual renderer for a catalog `visual` key.
 * @param {string} type - The catalog `visual` key (e.g. 'pillars', 'crab')
 * @param {function} fn - Renderer function receiving (THREE.Group, landmarkDef)
 */
export function registerVisualRenderer(type, fn) {
  VISUAL_RENDERERS[type] = fn;
}

// Register nebula visual renderers
registerVisualRenderer('pillars', createPillars);
registerVisualRenderer('crab', createCrabNebula);
registerVisualRenderer('carina', createCarinaNebula);
registerVisualRenderer('horsehead', createHorsehead);

// Register stellar visual renderers
registerVisualRenderer('hypergiant', createHypergiant);
registerVisualRenderer('ring', createRingNebula);
registerVisualRenderer('eta_carinae', createEtaCarinae);
registerVisualRenderer('magnetar', createMagnetar);

// Register galaxy & void visual renderers
registerVisualRenderer('supermassive_bh', createSupermassiveBH);
registerVisualRenderer('spiral_galaxy', createSpiralGalaxy);
registerVisualRenderer('sombrero_galaxy', createSombreroGalaxy);
registerVisualRenderer('void', createBootesVoid);

// ── Nebula cloud definitions ──────────────────────────────────────────
const NEBULA_CLOUD_DEFS = [
  { pos: [1800, 200, 1200],    color: [0.2, 0.4, 1.0],  size: 300, count: 3000 },
  { pos: [-2200, -100, 3000],  color: [1.0, 0.3, 0.6],  size: 400, count: 4000 },
  { pos: [3500, 500, -1500],   color: [1.0, 0.8, 0.2],  size: 250, count: 2500 },
  { pos: [-1000, 300, -4000],  color: [0.3, 1.0, 0.5],  size: 350, count: 3500 },
  { pos: [5000, -200, 2500],   color: [0.6, 0.2, 1.0],  size: 300, count: 3000 },
  { pos: [-3000, 100, 5500],   color: [0.1, 0.6, 0.9],  size: 450, count: 4500 },
];

// ── Module state ──────────────────────────────────────────────────────
const landmarks = [];
let blackHoleGroup = null;
let accretionParticles = null;
let accretionDiskMesh = null;

// ═══════════════════════════════════════════════════════════════════════
// createDeepSpace
// ═══════════════════════════════════════════════════════════════════════
export function createDeepSpace(scene, textures) {
  createLandmarks(scene, textures);
  // createNebulaClouds(scene) — removed: the big scattered particle clouds
  // were rendering as formless coloured smudges around the solar system
  // and breaking the clean "stars + milky way" look. The named nebula
  // landmarks (Pillars, Carina, etc.) are still available via the carousel.
  createBlackHole(scene);
}

// ── Landmarks ─────────────────────────────────────────────────────────
function createLandmarks(scene, textures) {
  for (const def of LOCATIONS) {
    const scaleUnit = def.tier === 'intergalactic' ? INTERGALACTIC_SCALE : INTERSTELLAR_SCALE;
    const r = def.dist * AU;
    const phi = def.phi || 0; // vertical angle in radians
    const x = Math.cos(def.angle) * Math.cos(phi) * r;
    const y = Math.sin(phi) * r;
    const z = Math.sin(def.angle) * Math.cos(phi) * r;

    const s = def.size * scaleUnit;

    // Create a group for this landmark
    const group = new THREE.Group();
    group.position.set(x, y, z);
    scene.add(group);
    setWorldPos(group, group.position);

    // Attach scaleUnit so renderers can use correct scale
    def._scaleUnit = scaleUnit;

    // Dispatch to custom visual renderer if available, else default glow
    if (VISUAL_RENDERERS[def.visual]) {
      VISUAL_RENDERERS[def.visual](group, def, textures);
    } else {
      // Default: soft glow sprite
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

    // Subtle point light
    const light = new THREE.PointLight(def.color || 0xaaccff, 1.5, s * 3);
    group.add(light);

    landmarks.push({
      id: def.id,
      name: def.name,
      desc: def.desc,
      info: def.info,
      anchor: group,
      pos: new THREE.Vector3(x, y, z),
      radius: s * 0.3,
      music: def.music,
      tier: def.tier,
      visual: def.visual,
    });
  }
}

// ── Public accessor for landmarks ────────────────────────────────────
export function getLandmarks() {
  return landmarks;
}

// ── Luminance-to-alpha helper ─────────────────────────────────────────
// Converts a texture's brightness to alpha so dark backgrounds become transparent
function makeLuminanceAlpha(tex) {
  if (!tex || !tex.image) return null;
  try {
    const img = tex.image;
    const cv = document.createElement('canvas');
    cv.width = img.width; cv.height = img.height;
    const ctx = cv.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, cv.width, cv.height);
    const px = data.data;
    for (let i = 0; i < px.length; i += 4) {
      // Luminance from RGB
      const lum = px[i] * 0.299 + px[i+1] * 0.587 + px[i+2] * 0.114;
      px[i+3] = Math.min(255, lum * 2); // boost so mid-tones stay visible
    }
    ctx.putImageData(data, 0, 0);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.LinearSRGBColorSpace;
    return t;
  } catch (e) {
    return null;
  }
}

// ── Nebula Clouds ─────────────────────────────────────────────────────
// Create a large, soft nebula sprite texture for wispy clouds
let _nebulaTex = null;
function getNebulaTex() {
  if (_nebulaTex) return _nebulaTex;
  const sz = 128;
  const cv = document.createElement('canvas');
  cv.width = sz; cv.height = sz;
  const ctx = cv.getContext('2d');
  const grd = ctx.createRadialGradient(sz/2, sz/2, 0, sz/2, sz/2, sz/2);
  grd.addColorStop(0, 'rgba(255,255,255,0.35)');
  grd.addColorStop(0.3, 'rgba(255,255,255,0.18)');
  grd.addColorStop(0.7, 'rgba(255,255,255,0.05)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, sz, sz);
  _nebulaTex = new THREE.CanvasTexture(cv);
  return _nebulaTex;
}

function createNebulaClouds(scene) {
  for (const def of NEBULA_CLOUD_DEFS) {
    // Use fewer, larger, softer particles for a wispy look
    const count = Math.floor(def.count * 0.15); // much fewer particles
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);

    const cx = def.pos[0] * AU;
    const cy = def.pos[1] * AU;
    const cz = def.pos[2] * AU;
    const spread = def.size * AU;

    for (let i = 0; i < count; i++) {
      // Flattened ellipsoidal distribution (wider than tall)
      const r = Math.pow(Math.random(), 0.3) * spread;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);

      positions[i * 3]     = cx + r * Math.sin(phi) * Math.cos(theta) * 1.5;
      positions[i * 3 + 1] = cy + r * Math.sin(phi) * Math.sin(theta) * 0.3; // flatten Y
      positions[i * 3 + 2] = cz + r * Math.cos(phi) * 1.2;

      const brightness = 0.4 + Math.random() * 0.6;
      colors[i * 3]     = def.color[0] * brightness;
      colors[i * 3 + 1] = def.color[1] * brightness;
      colors[i * 3 + 2] = def.color[2] * brightness;
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.PointsMaterial({
      vertexColors: true,
      size: spread * 0.15,         // large particles
      map: getNebulaTex(),
      sizeAttenuation: true,       // scale with distance
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.12,               // very subtle
      depthWrite: false,
    });

    const points = new THREE.Points(geom, mat);
    points.userData._solarSystemOnly = true;
    scene.add(points);
    setWorldPos(points, new THREE.Vector3(0, 0, 0));
  }
}

// ── Black Hole ────────────────────────────────────────────────────────
function createBlackHole(scene) {
  // A STELLAR-MASS black hole — the Cygnus X-1 archetype, counterpoint
  // to Sgr A*'s supermassive EHT portrait. Black horizon, photon ring,
  // white-hot thin accretion disc with Doppler beaming (the approaching
  // side outshines the receding one), and faint relativistic jets.
  // (The old version was never rescaled — a 40-unit disc tagged
  // _solarSystemOnly, so it was both microscopic AND always hidden.)
  const S = 2000; // horizon radius, world units
  blackHoleGroup = new THREE.Group();
  const bhPos = new THREE.Vector3(
    Math.cos(4.0) * 6000 * AU,
    -100,
    Math.sin(4.0) * 6000 * AU
  );
  blackHoleGroup.position.copy(bhPos);

  // 1. Event horizon — a hole in the world
  blackHoleGroup.add(new THREE.Mesh(
    new THREE.SphereGeometry(S, 64, 64),
    new THREE.MeshBasicMaterial({ color: 0x000000 })
  ));

  // Radial-gradient painter — soft-edged light, never flat ribbons
  const radialTex = (stops) => {
    const cv = document.createElement('canvas');
    cv.width = 512; cv.height = 512;
    const ctx = cv.getContext('2d');
    const g = ctx.createRadialGradient(256, 256, 0, 256, 256, 256);
    for (const [p, c] of stops) g.addColorStop(p, c);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 512);
    return new THREE.CanvasTexture(cv);
  };

  // 2a. Horizon rim glow — gravitationally lensed light hugging the
  // silhouette. A billboard glow centered on the hole, drawn WITH depth
  // testing: the opaque black sphere occludes its middle, leaving only
  // the burning margin around the disc. The iconic edge.
  {
    const rim = new THREE.Sprite(new THREE.SpriteMaterial({
      map: radialTex([
        [0.0, 'rgba(255,235,205,1)'],
        [0.42, 'rgba(255,225,190,0.85)'],
        [0.55, 'rgba(255,170,90,0.30)'],
        [0.75, 'rgba(200,90,30,0.08)'],
        [1.0, 'rgba(0,0,0,0)'],
      ]),
      color: 0xffffff, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true,
    }));
    rim.scale.setScalar(S * 3.1);
    rim.renderOrder = 2;
    blackHoleGroup.add(rim);
  }

  // 2b. Photon ring — a thin brilliant halo at ~2.5 r_s, feathered
  {
    const ringMat = new THREE.MeshBasicMaterial({
      map: radialTex([
        [0.80, 'rgba(255,244,228,0)'],
        [0.885, 'rgba(255,244,228,0)'],
        [0.92, 'rgba(255,248,235,1)'],
        [0.955, 'rgba(255,214,160,0.30)'],
        [1.0, 'rgba(255,190,130,0)'],
      ]),
      side: THREE.DoubleSide, transparent: true,
      opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const ring = new THREE.Mesh(new THREE.PlaneGeometry(S * 5.24, S * 5.24), ringMat);
    ring.rotation.x = Math.PI * 0.28 - Math.PI / 2;
    blackHoleGroup.add(ring);
  }

  // 3. Accretion disc — thin, white-hot inner edge to deep red rim,
  // Doppler-beamed: brightness leans hard to the approaching side
  const diskCount = 14000;
  const diskPositions = new Float32Array(diskCount * 3);
  const diskColors = new Float32Array(diskCount * 3);
  for (let i = 0; i < diskCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const radius = S * (2.7 + Math.pow(Math.random(), 1.6) * 3.8); // 2.7-6.5 S, denser inward
    const ySpread = (Math.random() - 0.5) * S * 0.12;
    diskPositions[i * 3]     = Math.cos(angle) * radius;
    diskPositions[i * 3 + 1] = ySpread;
    diskPositions[i * 3 + 2] = Math.sin(angle) * radius;
    const t = (radius / S - 2.7) / 3.8; // 0 inner -> 1 outer
    // Doppler beaming: one side burns brighter
    const beam = 0.55 + 0.45 * Math.sin(angle);
    const heat = (1 - t);
    diskColors[i * 3]     = (0.75 + heat * 0.25) * (0.5 + beam * 0.7);
    diskColors[i * 3 + 1] = (0.25 + heat * 0.65) * (0.45 + beam * 0.65);
    diskColors[i * 3 + 2] = (0.08 + heat * 0.72) * (0.35 + beam * 0.75);
  }
  const diskGeom = new THREE.BufferGeometry();
  diskGeom.setAttribute('position', new THREE.BufferAttribute(diskPositions, 3));
  diskGeom.setAttribute('color', new THREE.BufferAttribute(diskColors, 3));
  const diskMat = new THREE.PointsMaterial({
    vertexColors: true,
    size: S * 0.045,
    map: getPointTexture(),
    sizeAttenuation: true,
    blending: THREE.AdditiveBlending,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  });
  accretionParticles = new THREE.Points(diskGeom, diskMat);
  accretionParticles.rotation.x = Math.PI * 0.28; // match the ring plane
  blackHoleGroup.add(accretionParticles);

  // 4. Inner disc sheet — continuous hot glow between the particles,
  // white-hot at the inner edge feathering to dark ember at the rim
  {
    const ringMat = new THREE.MeshBasicMaterial({
      map: radialTex([
        [0.0, 'rgba(0,0,0,0)'],
        [0.49, 'rgba(0,0,0,0)'],
        [0.53, 'rgba(255,238,210,0.85)'],
        [0.62, 'rgba(255,150,60,0.42)'],
        [0.82, 'rgba(150,40,10,0.15)'],
        [1.0, 'rgba(60,12,3,0)'],
      ]),
      side: THREE.DoubleSide, transparent: true,
      opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    accretionDiskMesh = new THREE.Mesh(new THREE.PlaneGeometry(S * 10.4, S * 10.4), ringMat);
    accretionDiskMesh.rotation.x = Math.PI * 0.28 - Math.PI / 2;
    blackHoleGroup.add(accretionDiskMesh);
  }

  // 5. Relativistic jets — faint, fast, perpendicular to the disc
  for (const sign of [1, -1]) {
    const jetGeo = new THREE.CylinderGeometry(S * 0.06, S * 0.5, S * 14, 12, 1, true);
    const jetMat = new THREE.MeshBasicMaterial({
      color: 0x86c8ff, transparent: true, opacity: 0.05,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const jet = new THREE.Mesh(jetGeo, jetMat);
    jet.position.y = sign * S * 7.5;
    if (sign < 0) jet.rotation.z = Math.PI;
    jet.rotation.x = Math.PI * 0.28 - Math.PI / 2 + Math.PI / 2; // align to disc normal
    const jetHolder = new THREE.Group();
    jetHolder.rotation.x = Math.PI * 0.28;
    jetHolder.add(jet);
    blackHoleGroup.add(jetHolder);
  }

  // 6. Faint heat shells
  for (const g of [
    { r: S * 4.5, color: 0xff4400, opacity: 0.05 },
    { r: S * 8, color: 0x881800, opacity: 0.02 },
  ]) {
    blackHoleGroup.add(new THREE.Mesh(
      new THREE.SphereGeometry(g.r, 32, 32),
      new THREE.MeshBasicMaterial({
        color: g.color, transparent: true, opacity: g.opacity,
        blending: THREE.AdditiveBlending, side: THREE.BackSide, depthWrite: false,
      })
    ));
  }

  scene.add(blackHoleGroup);
  setWorldPos(blackHoleGroup, blackHoleGroup.position);
}

// ── Landmark animations ──────────────────────────────────────────────
function updateLandmarks(dt) {
  for (const lm of landmarks) {
    const group = lm.anchor;
    for (const child of group.children) {
      // Pulsar beams: fast spin around Y axis
      if (child.userData._isPulsarBeam) {
        child.rotation.y += dt * 30;
      }
      // Pulsar glow: pulsing opacity
      if (child.userData._isPulsar) {
        child.material.opacity = 0.5 + Math.sin(performance.now() * 0.03) * 0.4;
      }
      // Accretion disks: slow Y rotation
      if (child.userData._isAccretion) {
        child.rotation.y += dt * 0.5;
      }
      // Generic animation hook (shader stars, etc.)
      if (child.userData._onUpdate) {
        child.userData._onUpdate(dt, child);
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════
// updateDeepSpace
// ═══════════════════════════════════════════════════════════════════════
export function updateDeepSpace(dt, camPos) {
  if (accretionParticles) {
    accretionParticles.rotation.y += dt * 0.5;
  }
  if (accretionDiskMesh) {
    accretionDiskMesh.rotation.z += dt * 0.3;
  }
  updateLandmarks(dt);
}

// ═══════════════════════════════════════════════════════════════════════
// getDeepSpaceObjects
// ═══════════════════════════════════════════════════════════════════════
export function getDeepSpaceObjects() {
  const objects = [];

  // Landmarks
  for (const lm of landmarks) {
    objects.push({
      name: lm.name,
      desc: lm.desc,
      g: lm.anchor,
      r: lm.radius,
      isLandmark: true,
    });
  }

  // Black hole
  if (blackHoleGroup) {
    objects.push({
      name: 'BLACK HOLE',
      desc: 'Supermassive singularity warping spacetime. Accretion disk superheated to millions of degrees.',
      g: blackHoleGroup,
      r: 2000,
      isBlackHole: true,
    });
  }

  return objects;
}
