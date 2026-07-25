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
// Particles live as offsets in a unit cube around the camera and wrap
// toroidally; world position = camera + offset × shellRadius. Rescaling the
// shell therefore never pops particles — they just breathe outward.

import * as THREE from 'three';
import { setWorldPos } from './engine.js';

const COUNT = 480;
const SHELL_MIN = 30;        // units — near-surface scale
const SHELL_MAX = 400000;    // units — intergalactic scale
const SHELL_FACTOR = 0.55;   // shell radius = factor × gap to nearest object

let points = null;
let mat = null;
let positions = null;        // Float32Array written to the geometry
const offsets = [];          // unit-cube offsets, the source of truth
let shellR = 200;
const _shift = new THREE.Vector3();

export function initDust(scene) {
  for (let i = 0; i < COUNT; i++) {
    offsets.push(new THREE.Vector3(
      Math.random() - 0.5,
      Math.random() - 0.5,
      Math.random() - 0.5
    ));
  }

  const geo = new THREE.BufferGeometry();
  positions = new Float32Array(COUNT * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  mat = new THREE.PointsMaterial({
    color: 0xaaccee,
    size: 1,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 5;
  scene.add(points);
  setWorldPos(points, new THREE.Vector3());
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

  // Shell tracks the local scale, smoothed so scale changes breathe
  const targetR = Math.min(SHELL_MAX, Math.max(SHELL_MIN, feel.govDist * SHELL_FACTOR));
  shellR += (targetR - shellR) * (1 - Math.exp(-dt / 0.8));

  // Stream particles opposite to travel (in unit-cube space)
  _shift.copy(velocity).multiplyScalar(dt / shellR);
  for (let i = 0; i < COUNT; i++) {
    const o = offsets[i];
    o.x = wrap01(o.x - _shift.x);
    o.y = wrap01(o.y - _shift.y);
    o.z = wrap01(o.z - _shift.z);
    positions[i * 3]     = o.x * shellR;
    positions[i * 3 + 1] = o.y * shellR;
    positions[i * 3 + 2] = o.z * shellR;
  }
  points.geometry.attributes.position.needsUpdate = true;
  setWorldPos(points, camPos);

  // Visible only in free flight and only when meaningfully moving relative
  // to the local scale. Scripted travel (warp/fly-to) has its own effects.
  const t = Math.max(0, Math.min(1, (feel.ratio - 0.15) / 0.85));
  const targetOpacity = feel.free ? t * t * (3 - 2 * t) * 0.5 : 0;
  mat.opacity += (targetOpacity - mat.opacity) * (1 - Math.exp(-dt / 0.3));
  mat.size = shellR * 0.007;
}
