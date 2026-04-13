import * as THREE from 'three';
import { getPointTexture } from './textures.js';
import { setWorldPos } from './engine.js';

import { AU } from './constants.js';

// ── Landmark definitions ──────────────────────────────────────────────
const LANDMARK_DEFS = [
  { name: 'ORION NEBULA',        texKey: 'landmarkOrion',    dist: 2500, angle: 0.3,  size: 400, color: 0x6688ff,
    desc: 'Stellar nursery 1,344 light-years away. Over 700 stars forming.' },
  { name: 'PILLARS OF CREATION', texKey: 'landmarkPillars',  dist: 4000, angle: 1.8,  size: 500, color: 0xffaa44,
    desc: 'Columns of interstellar gas in the Eagle Nebula. 6,500 light-years distant.' },
  { name: 'CRAB NEBULA',         texKey: 'landmarkCrab',     dist: 5000, angle: 3.5,  size: 350, color: 0xff6644,
    desc: 'Supernova remnant from 1054 AD. Pulsar at its heart spins 30x per second.' },
  { name: 'ANDROMEDA GALAXY',    texKey: 'landmarkAndromeda', dist: 8000, angle: 5.2,  size: 800, color: 0x8899dd,
    desc: '2.5 million light-years away. One trillion stars. Approaching us at 110 km/s.' },
];

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
  createNebulaClouds(scene);
  createBlackHole(scene);
}

// ── Landmarks ─────────────────────────────────────────────────────────
function createLandmarks(scene, textures) {
  for (const def of LANDMARK_DEFS) {
    const x = Math.cos(def.angle) * def.dist * AU;
    const z = Math.sin(def.angle) * def.dist * AU;
    const y = (Math.random() - 0.5) * 200;

    const tex = textures[def.texKey];
    const s = def.size * AU;

    // Soft glow background sprite (always visible from far)
    const glowMat = new THREE.SpriteMaterial({
      map: getNebulaTex(),
      color: def.color || 0xaaccff,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
    });
    const glowSprite = new THREE.Sprite(glowMat);
    glowSprite.position.set(x, y, z);
    glowSprite.scale.set(s * 2.0, s * 2.0, 1); // larger for backdrop visibility
    scene.add(glowSprite);
    setWorldPos(glowSprite, glowSprite.position);

    // NOTE: NASA texture sprites removed — JPGs without alpha channels
    // create visible rectangular edges. The procedural glow sprites above
    // provide a cleaner look at all distances.

    // Subtle point light
    const light = new THREE.PointLight(def.color || 0xaaccff, 1.5, s * 3);
    light.position.set(x, y, z);
    scene.add(light);
    setWorldPos(light, light.position);

    // Position anchor for HUD/gravity lookups
    const anchor = new THREE.Object3D();
    anchor.position.set(x, y, z);
    scene.add(anchor);
    setWorldPos(anchor, anchor.position);

    landmarks.push({
      name: def.name,
      desc: def.desc,
      anchor,
      pos: new THREE.Vector3(x, y, z),
      radius: s * 0.3,
    });
  }
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
    scene.add(points);
    setWorldPos(points, new THREE.Vector3(0, 0, 0));
  }
}

// ── Black Hole ────────────────────────────────────────────────────────
function createBlackHole(scene) {
  blackHoleGroup = new THREE.Group();
  const bhPos = new THREE.Vector3(
    Math.cos(4.0) * 6000 * AU,
    -100,
    Math.sin(4.0) * 6000 * AU
  );
  blackHoleGroup.position.copy(bhPos);

  // 1. Event horizon — pure black sphere
  const horizonGeo = new THREE.SphereGeometry(8, 64, 64);
  const horizonMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
  const horizon = new THREE.Mesh(horizonGeo, horizonMat);
  blackHoleGroup.add(horizon);

  // 2. Accretion disk particles
  const diskCount = 8000;
  const diskPositions = new Float32Array(diskCount * 3);
  const diskColors = new Float32Array(diskCount * 3);

  for (let i = 0; i < diskCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const radius = 12 + Math.random() * 28; // 12–40
    const ySpread = (Math.random() - 0.5) * 4; // +-2

    diskPositions[i * 3]     = Math.cos(angle) * radius;
    diskPositions[i * 3 + 1] = ySpread;
    diskPositions[i * 3 + 2] = Math.sin(angle) * radius;

    // Color by heat: inner = white/orange, outer = red/dark
    const t = (radius - 12) / 28; // 0 (inner) to 1 (outer)
    diskColors[i * 3]     = 1.0;                       // R stays high
    diskColors[i * 3 + 1] = (1.0 - t) * 0.8 + 0.1;    // G fades out
    diskColors[i * 3 + 2] = (1.0 - t) * 0.6;           // B fades out
  }

  const diskGeom = new THREE.BufferGeometry();
  diskGeom.setAttribute('position', new THREE.BufferAttribute(diskPositions, 3));
  diskGeom.setAttribute('color', new THREE.BufferAttribute(diskColors, 3));

  const diskMat = new THREE.PointsMaterial({
    vertexColors: true,
    size: 2,
    map: getPointTexture(),
    sizeAttenuation: true,
    blending: THREE.AdditiveBlending,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  });

  accretionParticles = new THREE.Points(diskGeom, diskMat);
  blackHoleGroup.add(accretionParticles);

  // 3. Disk mesh (ring)
  const ringGeo = new THREE.RingGeometry(12, 40, 128, 4);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xff6600,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
  });
  accretionDiskMesh = new THREE.Mesh(ringGeo, ringMat);
  accretionDiskMesh.rotation.x = Math.PI * 0.25; // ~45 degrees
  blackHoleGroup.add(accretionDiskMesh);

  // 4. Glow shells
  const glowDefs = [
    { r: 20, color: 0xff4400, opacity: 0.08 },
    { r: 35, color: 0xff2200, opacity: 0.03 },
    { r: 60, color: 0x440000, opacity: 0.015 },
  ];

  for (const g of glowDefs) {
    const geo = new THREE.SphereGeometry(g.r, 32, 32);
    const mat = new THREE.MeshBasicMaterial({
      color: g.color,
      transparent: true,
      opacity: g.opacity,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    blackHoleGroup.add(mesh);
  }

  scene.add(blackHoleGroup);
  setWorldPos(blackHoleGroup, blackHoleGroup.position);
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
      r: 8,
      isBlackHole: true,
    });
  }

  return objects;
}
