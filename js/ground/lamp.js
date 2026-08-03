// ground/lamp.js — the suit knows when to light the way, and the
// traveler owns the switch.
//
// As the sun dies the helmet lamp fades itself in, and the rover
// brings proper headlights — but L is a real switch: flip the lamp off
// to stand in the dark under the stars, or force it on in a shadowed
// gully at noon. The override holds until the next landfall; the auto
// circuit resumes fresh each visit. The beam follows the gaze (it's
// mounted on the helmet), pooling on the ground ahead — enough to walk
// by, never enough to flatten the night.

import * as THREE from 'three';

let spot = null, fill = null;
let level = 0;         // smoothed 0..1 lamp engagement
let override = null;   // null = auto circuit; true/false = the switch
let autoWant = 0;      // what the auto circuit would do right now

const _fwd = new THREE.Vector3();
const _aim = new THREE.Vector3();

export function initLamp(parentGroup) {
  // Decay near 1: the physical inverse-square (1.2+) starved the pool
  // before it reached the ground — these are HARD beams, not mood.
  spot = new THREE.SpotLight(0xfff2dc, 0, 90, THREE.MathUtils.degToRad(34), 0.45, 1.0);
  parentGroup.add(spot);
  parentGroup.add(spot.target);
  // A whisper of near fill so the ground at your feet isn't a void
  fill = new THREE.PointLight(0xffe8c8, 0, 14, 1.8);
  parentGroup.add(fill);
  level = 0;
  override = null;
  autoWant = 0;
}

export function disposeLamp() {
  spot = null; fill = null; level = 0; override = null; autoWant = 0;
}

/** The switch: flips whatever the lamp is currently doing. Returns the
 *  new state so the caller can speak it. */
export function toggleLamp() {
  const effOn = override !== null ? override : autoWant > 0.5;
  override = !effOn;
  return override;
}

export function isLampOn() { return level > 0.35; }

/**
 * @param sunElevDeg current sun elevation
 * @param camLocal   eye position, site frame
 * @param camQuat    camera orientation
 * @param roving     wheels or boots
 */
export function updateLamp(dt, sunElevDeg, camLocal, camQuat, roving) {
  if (!spot) return;
  // The auto circuit switches the lamp as civil light fails, with
  // hysteresis built into the smoothing — no flicker at the threshold.
  // The traveler's switch, once thrown, overrides it entirely.
  autoWant = THREE.MathUtils.smoothstep(-sunElevDeg, -2, 1.5); // on below ~+1.5°
  const want = override === null ? autoWant : (override ? 1 : 0);
  level += (want - level) * (1 - Math.exp(-dt / 1.8));

  _fwd.set(0, 0, -1).applyQuaternion(camQuat);
  spot.position.copy(camLocal);
  // Aim down-range: the pool of light lands ahead on the ground
  _aim.copy(camLocal).addScaledVector(_fwd, roving ? 40 : 22);
  _aim.y -= roving ? 6 : 5;
  spot.target.position.copy(_aim);

  if (roving) {
    // A proper headlight bar: the pool ahead is unmistakably YOURS,
    // carved out of the night, hot at the center.
    spot.intensity = 1500 * level;
    spot.angle = THREE.MathUtils.degToRad(40);
    spot.penumbra = 0.5;
    spot.distance = 220;
  } else {
    spot.intensity = 480 * level;
    spot.angle = THREE.MathUtils.degToRad(30);
    spot.penumbra = 0.45;
    spot.distance = 120;
  }
  fill.position.copy(camLocal).addScaledVector(_fwd, 2.5);
  fill.position.y -= 1.0;
  fill.intensity = (roving ? 16 : 9) * level;
  fill.distance = roving ? 24 : 16;
}
