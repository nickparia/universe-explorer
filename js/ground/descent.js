// ground/descent.js — the entry corridor.
//
// Real landers black out inside the plasma sheath — so the cut from
// orbit is not a loading veil, it's physics. You come out of blackout
// twelve kilometers over the canyon, glowing, decelerating, and the
// whole real DEM is below you: walls, floor, inselberg sliding past as
// the glide bleeds off six hundred meters a second. The last kilometer
// slows into the approach, the shelf rises to meet you, and the boots
// take over exactly where the bootfall vista begins. Any key skips.
//
// Lift-off runs the same corridor in reverse: climb, canyon dropping
// away, sky darkening, plasma washing in — and orbit on the far side.

import * as THREE from 'three';

let phase = null;        // 'descend' | 'ascend'
let curve = null;
let T = 0, t = 0;
let doneCb = null;
let plasma = null;
let skipFn = null;
let finalYaw = 0, finalPitch = 0;
const pos = new THREE.Vector3();
const _ahead = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _qGoal = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
let lastSpeed = 0;
let cam = null;

function makePlasma() {
  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;inset:0;pointer-events:none;z-index:340;opacity:1;' +
    'background:radial-gradient(circle at 50% 42%, rgba(255,214,150,0.98) 0%,' +
    'rgba(255,150,60,0.94) 30%, rgba(190,60,12,0.95) 62%, rgba(60,12,3,0.98) 100%);' +
    'transition:none;';
  document.body.appendChild(el);
  return el;
}

export function isDescentActive() { return phase !== null; }
export function getDescentPos() { return pos; }
export function getDescentSpeed() { return lastSpeed; }

/** The way down. endLocal is the bootfall point (site frame). */
export function startDescent(camera, endLocal, yawAtRest, pitchAtRest, onDone) {
  cam = camera;
  phase = 'descend';
  finalYaw = yawAtRest;
  finalPitch = pitchAtRest;
  doneCb = onDone;
  T = 44;
  t = 0;
  // In from the NORTH, high over the plateau — so the canyon is not
  // seen first, it's REVEALED: the rim passes beneath and four
  // kilometers of air open under the glide. The approach heading is
  // already the bootfall heading; control arrives without a swing.
  curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(endLocal.x + 2600, 9800, endLocal.z - 15500),
    new THREE.Vector3(endLocal.x + 1500, 5400, endLocal.z - 7200),
    new THREE.Vector3(endLocal.x + 550, 1900, endLocal.z - 1600),
    new THREE.Vector3(endLocal.x + 120, 330, endLocal.z + 480),
    new THREE.Vector3(endLocal.x, endLocal.y + 1.7, endLocal.z),
  ]);
  pos.copy(curve.getPoint(0));
  plasma = makePlasma();
  armSkip();
}

/** The way up. fromLocal is wherever the traveler stood. */
export function startAscent(camera, fromLocal, onDone) {
  cam = camera;
  phase = 'ascend';
  doneCb = onDone;
  T = 17;
  t = 0;
  // Climb out SOUTH over the canyon void — the floor drops away fast,
  // the far wall slides under, and the sky takes over.
  curve = new THREE.CatmullRomCurve3([
    fromLocal.clone(),
    new THREE.Vector3(fromLocal.x + 700, fromLocal.y + 700, fromLocal.z + 1400),
    new THREE.Vector3(fromLocal.x + 2800, fromLocal.y + 3100, fromLocal.z + 4600),
    new THREE.Vector3(fromLocal.x + 7000, fromLocal.y + 7600, fromLocal.z + 8500),
    new THREE.Vector3(fromLocal.x + 12500, fromLocal.y + 13000, fromLocal.z + 12500),
  ]);
  pos.copy(curve.getPoint(0));
  plasma = makePlasma();
  plasma.style.opacity = '0';
  armSkip();
}

function armSkip() {
  skipFn = (e) => {
    if (e && e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    t = Math.max(t, T - 0.05);
  };
  window.addEventListener('keydown', skipFn);
  window.addEventListener('mousedown', skipFn);
}

function disarmSkip() {
  if (!skipFn) return;
  window.removeEventListener('keydown', skipFn);
  window.removeEventListener('mousedown', skipFn);
  skipFn = null;
}

/** Fade and drop the plasma veil — the exit path calls this last. */
export function fadePlasma(seconds = 1.2) {
  if (!plasma) return;
  plasma.style.transition = `opacity ${seconds}s ease`;
  plasma.style.opacity = '0';
  const el = plasma;
  plasma = null;
  setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, seconds * 1000 + 200);
}

export function disposeDescent() {
  disarmSkip();
  if (plasma && plasma.parentNode) plasma.parentNode.removeChild(plasma);
  plasma = null;
  phase = null;
  curve = null;
  cam = null;
}

/**
 * Drive the corridor. Returns { frac, speed, done } — position is read
 * via getDescentPos(); the camera quaternion is set here.
 */
export function updateDescent(dt) {
  if (!phase || !cam) return null;
  t = Math.min(T, t + dt);
  const u = t / T;
  // Descent bleeds speed: fast early, gentle late. Ascent is a burn.
  const s = phase === 'descend' ? 1 - Math.pow(1 - u, 1.8) : Math.pow(u, 1.75);

  const prev = pos.clone();
  pos.copy(curve.getPoint(s));
  lastSpeed = prev.distanceTo(pos) / Math.max(dt, 1e-3);

  // Shake: violent out of blackout, dying with the deceleration
  const shakeAmp = phase === 'descend'
    ? Math.max(0, 1 - u * 2.6) * 5.5
    : Math.max(0, u - 0.7) * 6;
  if (shakeAmp > 0.01) {
    pos.x += (Math.random() - 0.5) * shakeAmp;
    pos.y += (Math.random() - 0.5) * shakeAmp * 0.6;
    pos.z += (Math.random() - 0.5) * shakeAmp;
  }

  // Look along the path — but lift the gaze toward the horizon: a
  // camera that stares down its own glide slope shows only the ground;
  // the vista lives ahead, not below.
  const sAhead = Math.min(1, s + 0.012);
  _ahead.copy(curve.getPoint(sAhead));
  if (phase === 'descend') _ahead.y += (pos.y - _ahead.y) * 0.62;
  if (phase === 'descend' && u > 0.86) {
    // The last seconds ease the gaze onto the bootfall vista itself —
    // control arrives without a seam.
    const w = (u - 0.86) / 0.14;
    _e.set(finalPitch, finalYaw, 0);
    _qGoal.setFromEuler(_e);
    _m.lookAt(pos, _ahead, THREE.Object3D.DEFAULT_UP);
    _q.setFromRotationMatrix(_m);
    cam.quaternion.slerpQuaternions(_q, _qGoal, w * w * (3 - 2 * w));
  } else {
    _m.lookAt(pos, _ahead, THREE.Object3D.DEFAULT_UP);
    _q.setFromRotationMatrix(_m);
    // ease the camera toward the path direction (no hard snaps on skip)
    cam.quaternion.slerp(_q, 1 - Math.exp(-dt / 0.35));
  }

  // The plasma sheath: blinding out of blackout, gone by a fifth in —
  // and on the way up, washing back in as the sky thins
  if (plasma) {
    if (phase === 'descend') {
      const o = THREE.MathUtils.clamp(1 - u * 5.2, 0, 1);
      plasma.style.opacity = String(o * o);
    } else {
      const o = THREE.MathUtils.clamp((u - 0.78) / 0.2, 0, 1);
      plasma.style.opacity = String(o * o);
    }
  }

  const done = t >= T;
  if (done) {
    disarmSkip();
    const cb = doneCb;
    doneCb = null;
    if (phase === 'descend') { fadePlasma(0.4); phase = null; }
    // ascent keeps its plasma up — the teardown happens behind it
    if (cb) cb();
  }
  return { frac: u, speed: lastSpeed, done };
}
