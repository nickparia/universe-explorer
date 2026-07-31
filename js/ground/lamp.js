// ground/lamp.js — the suit knows when to light the way.
//
// No toggle, no keybind: as the sun dies the helmet lamp fades itself
// in, and the rover brings proper headlights. The beam follows the
// gaze (it's mounted on the helmet), pooling on the ground ahead —
// enough to walk by, never enough to flatten the night. The stars stay
// the brighter show.

import * as THREE from 'three';

let spot = null, fill = null;
let level = 0;   // smoothed 0..1 lamp engagement

const _fwd = new THREE.Vector3();
const _aim = new THREE.Vector3();

export function initLamp(parentGroup) {
  spot = new THREE.SpotLight(0xfff2dc, 0, 90, THREE.MathUtils.degToRad(34), 0.55, 1.2);
  parentGroup.add(spot);
  parentGroup.add(spot.target);
  // A whisper of near fill so the ground at your feet isn't a void
  fill = new THREE.PointLight(0xffe8c8, 0, 14, 1.8);
  parentGroup.add(fill);
  level = 0;
}

export function disposeLamp() {
  spot = null; fill = null; level = 0;
}

/**
 * @param sunElevDeg current sun elevation
 * @param camLocal   eye position, site frame
 * @param camQuat    camera orientation
 * @param roving     wheels or boots
 */
export function updateLamp(dt, sunElevDeg, camLocal, camQuat, roving) {
  if (!spot) return;
  // The suit switches the lamp as civil light fails, with hysteresis
  // built into the smoothing — no flicker at the threshold.
  const want = THREE.MathUtils.smoothstep(-sunElevDeg, -2, 1.5); // on below ~+1.5°
  level += (want - level) * (1 - Math.exp(-dt / 1.8));

  _fwd.set(0, 0, -1).applyQuaternion(camQuat);
  spot.position.copy(camLocal);
  // Aim down-range: the pool of light lands ahead on the ground
  _aim.copy(camLocal).addScaledVector(_fwd, roving ? 40 : 22);
  _aim.y -= roving ? 6 : 5;
  spot.target.position.copy(_aim);

  if (roving) {
    spot.intensity = 270 * level;      // physical falloff (decay 1.2) needs punch
    spot.angle = THREE.MathUtils.degToRad(44);
    spot.distance = 160;
  } else {
    spot.intensity = 120 * level;
    spot.angle = THREE.MathUtils.degToRad(32);
    spot.distance = 80;
  }
  fill.position.copy(camLocal).addScaledVector(_fwd, 2.5);
  fill.position.y -= 1.0;
  fill.intensity = 3.5 * level;
}
