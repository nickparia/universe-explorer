// dust.js — motion-parallax dust field.
//
// In empty space nothing passes you, so speed is invisible. This keeps a
// sparse shell of faint particles around the camera; their relative stream
// is what reads as velocity. The trick that makes it work at EVERY scale:
// the shell radius is proportional to the distance to the nearest object
// (same signal as the speed governor), so near a moon the dust is metres
// away and between galaxies it is light-years away — but the apparent
// streaming rate stays honest, because allowed speed scales the same way.
//
// Two render layers share one particle set:
//   - Points: soft round motes (radial-gradient sprite, per-particle tint)
//   - LineSegments: motion streaks — each particle smears into a fading
//     trail along the travel direction as you push the speed ceiling.
// The layers crossfade on the speed ratio: drifting shows motes, cruising
// hard shows streaks. Particles live as offsets in a unit cube around the
// camera and wrap toroidally; world position = camera + offset × shellR,
// so rescaling the shell never pops particles — they just breathe outward.

import * as THREE from 'three';
import { setWorldPos } from './engine.js';
import { getPointTexture } from './textures.js';

const COUNT = 480;
const SHELL_MIN = 30;        // units — near-surface scale
const SHELL_MAX = 400000;    // units — intergalactic scale
const SHELL_FACTOR = 0.55;   // shell radius = factor × gap to nearest object
const STREAK_TIME = 0.05;    // s — streak length = velocity × this
const STREAK_MAX_FRAC = 0.3; // streak length cap as fraction of shell radius

let points = null;
let streaks = null;
let matP = null;
let matL = null;
let posP = null;             // Float32Array — mote positions
let posL = null;             // Float32Array — streak segment endpoints
const offsets = [];          // unit-cube offsets, the source of truth
let shellR = 200;
const _shift = new THREE.Vector3();
const _streakVec = new THREE.Vector3();
const _prevCam = new THREE.Vector3();
let _hasPrev = false;

export function initDust(scene) {
  const colorsP = new Float32Array(COUNT * 3);
  const colorsL = new Float32Array(COUNT * 2 * 3);

  for (let i = 0; i < COUNT; i++) {
    offsets.push(new THREE.Vector3(
      Math.random() - 0.5,
      Math.random() - 0.5,
      Math.random() - 0.5
    ));

    // Subtle tint variation — mostly ice-blue/white, a few warm motes,
    // varied brightness so the field doesn't read as a uniform grid.
    const warm = Math.random() < 0.12;
    const b = 0.35 + Math.random() * 0.65;
    const r = (warm ? 1.0 : 0.72 + Math.random() * 0.2) * b;
    const g = (warm ? 0.82 : 0.82 + Math.random() * 0.12) * b;
    const bl = (warm ? 0.6 : 1.0) * b;
    colorsP[i * 3] = r; colorsP[i * 3 + 1] = g; colorsP[i * 3 + 2] = bl;

    // Streak head carries the tint, tail fades to near-black so each
    // segment renders as a comet-like trail under additive blending.
    colorsL[i * 6] = r; colorsL[i * 6 + 1] = g; colorsL[i * 6 + 2] = bl;
    colorsL[i * 6 + 3] = r * 0.05; colorsL[i * 6 + 4] = g * 0.05; colorsL[i * 6 + 5] = bl * 0.05;
  }

  const geoP = new THREE.BufferGeometry();
  posP = new Float32Array(COUNT * 3);
  geoP.setAttribute('position', new THREE.BufferAttribute(posP, 3));
  geoP.setAttribute('color', new THREE.BufferAttribute(colorsP, 3));

  matP = new THREE.PointsMaterial({
    map: getPointTexture(),
    vertexColors: true,
    size: 1,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  points = new THREE.Points(geoP, matP);
  points.frustumCulled = false;
  points.renderOrder = 5;
  scene.add(points);
  setWorldPos(points, new THREE.Vector3());

  const geoL = new THREE.BufferGeometry();
  posL = new Float32Array(COUNT * 2 * 3);
  geoL.setAttribute('position', new THREE.BufferAttribute(posL, 3));
  geoL.setAttribute('color', new THREE.BufferAttribute(colorsL, 3));

  matL = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  streaks = new THREE.LineSegments(geoL, matL);
  streaks.frustumCulled = false;
  streaks.renderOrder = 5;
  scene.add(streaks);
  setWorldPos(streaks, new THREE.Vector3());
}

function wrap01(v) {
  // wrap a unit-cube coordinate into [-0.5, 0.5)
  return v - Math.floor(v + 0.5);
}

/**
 * @param {number} dt
 * @param {THREE.Vector3} camPos — logical camera position
 * @param {THREE.Vector3} velocity — units/second
 * @param {Object} feel — { ratio, govDist, free } from flight.getSpeedFeel()
 */
export function updateDust(dt, camPos, velocity, feel) {
  if (!points) return;

  // Motion comes from the camera's actual frame-to-frame displacement, so
  // dust streams identically in free flight, fly-to, and warp — scripted
  // travel moves the camera without touching `velocity`.
  if (!_hasPrev) { _prevCam.copy(camPos); _hasPrev = true; }
  const dtSafe = Math.max(dt, 1 / 240);
  _shift.copy(camPos).sub(_prevCam); // world units moved this frame
  _prevCam.copy(camPos);

  // Shell tracks the local scale, smoothed so scale changes breathe
  const targetR = Math.min(SHELL_MAX, Math.max(SHELL_MIN, feel.govDist * SHELL_FACTOR));
  shellR += (targetR - shellR) * (1 - Math.exp(-dt / 0.8));

  // Streak vector: how far a particle smears this frame, in world units,
  // opposite to travel. Capped so streaks never span the whole shell.
  _streakVec.copy(_shift).multiplyScalar(-STREAK_TIME / dtSafe);
  const maxLen = shellR * STREAK_MAX_FRAC;
  if (_streakVec.lengthSq() > maxLen * maxLen) _streakVec.setLength(maxLen);

  // Stream particles opposite to travel (in unit-cube space)
  _shift.multiplyScalar(1 / shellR);
  for (let i = 0; i < COUNT; i++) {
    const o = offsets[i];
    o.x = wrap01(o.x - _shift.x);
    o.y = wrap01(o.y - _shift.y);
    o.z = wrap01(o.z - _shift.z);
    const x = o.x * shellR, y = o.y * shellR, z = o.z * shellR;
    posP[i * 3] = x; posP[i * 3 + 1] = y; posP[i * 3 + 2] = z;
    posL[i * 6] = x; posL[i * 6 + 1] = y; posL[i * 6 + 2] = z;
    posL[i * 6 + 3] = x + _streakVec.x;
    posL[i * 6 + 4] = y + _streakVec.y;
    posL[i * 6 + 5] = z + _streakVec.z;
  }
  points.geometry.attributes.position.needsUpdate = true;
  streaks.geometry.attributes.position.needsUpdate = true;
  setWorldPos(points, camPos);
  setWorldPos(streaks, camPos);

  // Visible in free flight (scaled by how hard you push the ceiling) and
  // during warp (the 3D dust stream IS the tunnel).
  const drive = feel.free ? feel.ratio : (feel.warp ? 0.55 + feel.warp * 0.65 : 0);
  const t = Math.max(0, Math.min(1, (drive - 0.15) / 0.85));
  const base = t * t * (3 - 2 * t) * 0.55;

  // Crossfade motes → streaks as apparent speed rises
  const sb = Math.max(0, Math.min(1, (drive - 0.45) / 0.45));
  const streakBlend = sb * sb * (3 - 2 * sb);
  const targetP = base * (1 - streakBlend * 0.65);
  const targetL = base * streakBlend;
  matP.opacity += (targetP - matP.opacity) * (1 - Math.exp(-dt / 0.3));
  matL.opacity += (targetL - matL.opacity) * (1 - Math.exp(-dt / 0.3));
  matP.size = shellR * 0.006;
}
