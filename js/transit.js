// transit.js — route furniture: the things that pass the window.
//
// Between the dust shell (near) and the landmarks (far) the corridor is
// empty across four orders of magnitude, so even a curved, well-paced
// warp reads as motion through nothing. This module seeds ephemeral
// sights along the route while the drive is engaged: faint wisps of
// interstellar cirrus that flow past (sometimes right over the
// canopy). All of
// it spawns ahead, dies behind, and never exists while you're parked —
// a river, not a theme park.

import * as THREE from 'three';
import { setWorldPos } from './engine.js';

let scene = null;
const wisps = [];   // { sprite, pos, size, life }
let _wispTex = null;
const _prevCam = new THREE.Vector3();
let _hasPrev = false;
const _dir = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _lat = new THREE.Vector3();

const MAX_WISPS = 8;

// ── Space weather ────────────────────────────────────────────────────
// Long crossings pass through weather: every minute or so the ship hits
// a squall — a dense flurry of cirrus streaming past for ten-odd
// seconds — then breaks back into clear void.
// The rhythm (clear → squall → clear) is what keeps a four-minute
// cruise alive; uniform density would fade into wallpaper.
let travelTime = 0;      // accumulated seconds of active travel
let stormUntil = -1;     // travelTime at which the current squall ends
let nextStormAt = 45 + Math.random() * 50;
const STORM_WISPS = 10;

// ── Nebula banks ─────────────────────────────────────────────────────
// The set pieces between squalls: every minute or so a coherent bank of
// large, tinted cirrus — rust, teal, violet — streams past close to the
// canopy over ten-odd seconds. Clouds out the train window: the thing
// that makes an empty crossing read as MOVING, not as a starfield with
// occasional pixels. The first bank comes early, so the departure flows
// straight into scenery.
let nextBankAt = 18 + Math.random() * 14;
let _wasActive = false;
const BANK_PALETTES = [
  [0xc98a5a, 0xb0704a, 0xd9a06a], // rust — a nebula shoulder
  [0x5aa8a0, 0x4a8898, 0x78c0b0], // teal — ionized shell
  [0x8a7ac8, 0x6a5aa8, 0xa090d8], // violet — dusty lane
];

function spawnBank(camPos, speed) {
  const palette = BANK_PALETTES[Math.floor(Math.random() * BANK_PALETTES.length)];
  // One shared side so the bank passes as a single coherent mass
  _lat.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
    .addScaledVector(_dir, -_lat.dot(_dir)).normalize();
  const count = 2 + Math.floor(Math.random() * 2);
  const baseAhead = speed * 5;
  const passDist = baseAhead * (0.06 + Math.random() * 0.06);
  for (let i = 0; i < count; i++) {
    const mat = new THREE.SpriteMaterial({
      map: _wispTex,
      color: palette[Math.floor(Math.random() * palette.length)],
      transparent: true, opacity: 0,
      rotation: Math.random() * Math.PI,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const sprite = new THREE.Sprite(mat);
    // Staggered along the direction of travel so the bank streams by
    const lookahead = baseAhead + speed * (i * 1.3 + Math.random() * 0.8);
    const pos = new THREE.Vector3().copy(camPos)
      .addScaledVector(_dir, lookahead)
      .addScaledVector(_lat, passDist * (0.85 + Math.random() * 0.4));
    const size = passDist * (1.2 + Math.random() * 0.9);
    sprite.scale.set(size, size * (0.35 + Math.random() * 0.3), 1);
    scene.add(sprite);
    setWorldPos(sprite, pos);
    wisps.push({ sprite, pos, size, target: 0.06 + Math.random() * 0.07 });
  }
}

function makeWispTex() {
  const W = 256, H = 128;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  // Elongated soft cloud: overlapping radial blobs along the long axis.
  // Core alpha matters more than sprite opacity: at 0.16 the whole layer
  // multiplied out to ~4% pixel brightness — present but imperceptible.
  for (let i = 0; i < 7; i++) {
    const x = W * (0.18 + 0.64 * (i / 6)) + (Math.random() - 0.5) * 18;
    const y = H * 0.5 + (Math.random() - 0.5) * H * 0.3;
    const r = H * (0.22 + Math.random() * 0.22);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.28)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.14)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  const t = new THREE.CanvasTexture(cv);
  return t;
}

// (The travel "glint" — a bright cross-ray flare that swept the window —
// is gone: it read as a lens-flare game artifact, not a thing in space.)

const WISP_TINTS = [
  0x8fb0d8, 0x9fb8e0, 0xb0a8d8, // pale blues / violets
  0x8fb0d8, 0x9fb8e0,           // (blues weighted)
  0xd8b890,                     // rare warm
];

export function initTransit(sceneRef) {
  scene = sceneRef;
  _wispTex = makeWispTex();
}

// Diagnostics — what the weather layer thinks is happening this frame
const _dbg = { active: false, speed: 0, feelWarp: 0, wisps: 0, inStorm: false };
export function getTransitDebug() { return _dbg; }

function spawnWisp(camPos, speed, stormBoost) {
  const mat = new THREE.SpriteMaterial({
    map: _wispTex,
    color: WISP_TINTS[Math.floor(Math.random() * WISP_TINTS.length)],
    transparent: true, opacity: 0,
    rotation: Math.random() * Math.PI,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const sprite = new THREE.Sprite(mat);
  // Ahead along travel, offset laterally — a few pass very close
  const lookahead = speed * (2.5 + Math.random() * 3.5);
  _lat.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
    .addScaledVector(_dir, -_lat.dot(_dir)).normalize();
  const latDist = lookahead * (0.04 + Math.pow(Math.random(), 2.2) * 0.35);
  const pos = new THREE.Vector3().copy(camPos)
    .addScaledVector(_dir, lookahead)
    .addScaledVector(_lat, latDist);
  // Sized to its passing distance so every wisp reads at a similar,
  // gentle angular scale — none dominate, none vanish
  const size = Math.max(latDist * 1.0, lookahead * 0.07);
  sprite.scale.set(size, size * (0.35 + Math.random() * 0.3), 1);
  scene.add(sprite);
  setWorldPos(sprite, pos);
  wisps.push({ sprite, pos, size, target: (0.07 + Math.random() * 0.09) * (stormBoost ? 1.15 : 1) });
}

/**
 * @param {number} dt
 * @param {THREE.Vector3} camPos
 * @param {Object} feel — from flight.getSpeedFeel(); active during warp only
 */
export function updateTransit(dt, camPos, feel) {
  if (!scene) return;
  if (!_hasPrev) { _prevCam.copy(camPos); _hasPrev = true; return; }
  _tmp.copy(camPos).sub(_prevCam);
  const step = _tmp.length();
  _prevCam.copy(camPos);
  const speed = step / Math.max(dt, 1 / 240);
  const active = (feel.warp || 0) > 0.25 && speed > 1000;
  if (step > 0.001) _dir.copy(_tmp).multiplyScalar(1 / step);

  // Weather clock — squalls only develop while the drive is working
  if (active && !_wasActive) {
    // A journey just began: its first bank comes early, proof of motion
    nextBankAt = travelTime + 15 + Math.random() * 12;
  }
  _wasActive = active;
  if (active) {
    travelTime += dt;
    if (travelTime >= nextStormAt && travelTime >= stormUntil) {
      stormUntil = travelTime + 6 + Math.random() * 5;
      nextStormAt = stormUntil + 90 + Math.random() * 70;
    }
  }
  const inStorm = active && travelTime < stormUntil;
  _dbg.active = active; _dbg.speed = Math.round(speed);
  _dbg.feelWarp = +(feel.warp || 0).toFixed(2);
  _dbg.wisps = wisps.length; _dbg.inStorm = inStorm;
  _dbg.travelTime = Math.round(travelTime);
  _dbg.nextBankAt = Math.round(nextBankAt);
  _dbg.nextStormAt = Math.round(nextStormAt);

  // Spawn while the drive is working — hard in a squall, sparse in clear void
  const cap = inStorm ? STORM_WISPS : MAX_WISPS;
  const rate = inStorm ? 3 : 1.4;
  if (active && wisps.length < cap && Math.random() < dt * rate) {
    spawnWisp(camPos, speed, inStorm);
  }
  // Nebula banks pass in the clear stretches, between squalls
  if (active && !inStorm && travelTime >= nextBankAt) {
    spawnBank(camPos, speed);
    nextBankAt = travelTime + 130 + Math.random() * 80;
  }
  // Update / cull
  for (let i = wisps.length - 1; i >= 0; i--) {
    const w = wisps[i];
    const behind = _tmp.copy(w.pos).sub(camPos).dot(_dir);
    // Fade in ahead, out once passed; die well behind or when parked
    const fadeK = 1 - Math.exp(-dt / 0.9);
    const want = (!active || behind < -w.size * 2) ? 0 : w.target;
    w.sprite.material.opacity += (want - w.sprite.material.opacity) * fadeK;
    if ((behind < -w.size * 3 || !active) && w.sprite.material.opacity < 0.004) {
      scene.remove(w.sprite);
      w.sprite.material.dispose();
      wisps.splice(i, 1);
    }
  }
}
