// ground/controller.js — boots and wheels.
//
// First-person ground movement at real Mars gravity (3.71 m/s²), in
// the site's local frame (meters; origin at the landing point). Two
// gaits, both the same hands as the ship: WASD moves, right-drag looks
// (same sensitivity, same flight-sim Y as the helm), Shift pushes,
// Space hops — a low-g hop that hangs a beat longer than Earth lets
// you expect. V swaps boots for wheels: the rover is faster, springier,
// and reads the ground through its suspension.
//
// Collision IS the height function — the exact land the mesher builds.

import * as THREE from 'three';
import { heightAt } from './site.js';
import { getLookInvert } from '../lookpref.js';
import { stepCrunch, setRoverBed } from '../soundscape.js';

const G_MARS = 3.71;
const EYE_WALK = 1.65;
const EYE_ROVE = 2.6;
const WALK_SPEED = 4.2, WALK_RUN = 8.5;
const ROVE_SPEED = 18, ROVE_BOOST = 34;
const JUMP_V = 3.4;
const MOUSE_SENS = 0.0022;      // the helm's own hand
const TAU_LOOK = 0.07;
const MAX_PITCH = THREE.MathUtils.degToRad(86);

let cam = null;
let keys = {};
let rightDown = false;
let mouseDX = 0, mouseDY = 0;
let _pendYaw = 0, _pendPitch = 0;
let yaw = 0, pitch = 0;
let pos = new THREE.Vector3();
let vel = new THREE.Vector3();
let mode = 'walk';
let grounded = true;
let listeners = [];
let roverLean = 0;

// ── The feel state ──
let vehYaw = 0;            // the rover's own heading — A/D steer it
let stridePh = 0;          // stride phase; footfalls at each half-cycle
let landDip = 0, landVel = 0;   // knee-compression spring after airtime
let impact = 0;            // touchdown speed captured by the physics
let accelPitch = 0;        // rover: nose lifts on throttle, dips on brake
let slopeRoll = 0;         // cross-slope lean, walk and rover
let prevFwdSpeed = 0;
let fovBase = 0;
let visX = 0, visZ = 0;    // lateral bob offset (visual only, not physics)

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');

function addL(target, ev, fn, opts) {
  target.addEventListener(ev, fn, opts);
  listeners.push([target, ev, fn]);
}

export function initController(camera, spawn, faceYaw, facePitch = 0) {
  cam = camera;
  pos.copy(spawn);
  pos.y = heightAt(spawn.x, spawn.z) + EYE_WALK;
  yaw = faceYaw; pitch = facePitch;
  vel.set(0, 0, 0);
  mode = 'walk';
  grounded = true;
  keys = {}; mouseDX = 0; mouseDY = 0; _pendYaw = 0; _pendPitch = 0;
  stridePh = 0; landDip = 0; landVel = 0; impact = 0;
  accelPitch = 0; slopeRoll = 0; prevFwdSpeed = 0; visX = 0; visZ = 0;
  fovBase = camera.fov;

  const canvas = document.getElementById('c');
  addL(window, 'keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
      // An EMPTY terminal line yields to the boots: after talking to
      // Sol the input keeps focus, and without this every W went into
      // the chat — "movement doesn't work." Mid-sentence, typing wins.
      if (!e.target.value && /^(Key[WASDV]|Space|Shift(Left|Right)|Arrow)/.test(e.code)) {
        e.target.blur();
        if (canvas) canvas.focus();
      } else {
        return;
      }
    }
    // macOS: while Cmd is held other keys' keyups are swallowed — a
    // screenshot chord left Shift stuck down. Chorded keys don't move.
    if (e.metaKey && !e.code.startsWith('Meta')) return;
    keys[e.code] = true;
    if (typeof window !== 'undefined') {   // debug echo, last four
      const c = window.__ctlKeys = window.__ctlKeys || [];
      if (c[c.length - 1] !== e.code) c.push(e.code);
      if (c.length > 4) c.shift();
      window.__ctlKey = c.join(',');
    }
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    if (e.code === 'KeyV') {
      mode = (mode === 'walk') ? 'rove' : 'walk';
      if (mode === 'rove') vehYaw = yaw;   // mount facing where you look
    }
  });
  addL(window, 'keyup', (e) => {
    keys[e.code] = false;
    if (e.code.startsWith('Meta')) for (const k in keys) keys[k] = false;
  });
  // Pointer Lock while looking: the cursor is captured, deltas flow
  // forever, and no screen edge can interrupt a pan mid-arc.
  addL(canvas, 'mousedown', (e) => {
    if (e.button === 2) {
      rightDown = true;
      canvas.style.cursor = 'none';
      try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (err) { /* fallback: raw deltas */ }
    }
  });
  addL(window, 'mouseup', (e) => {
    if (e.button === 2) {
      rightDown = false;
      canvas.style.cursor = '';
      if (document.pointerLockElement === canvas && document.exitPointerLock) document.exitPointerLock();
    }
  });
  addL(document, 'pointerlockchange', () => {
    // Lock torn down externally (Esc) — end the look cleanly
    if (!document.pointerLockElement && rightDown) { rightDown = false; canvas.style.cursor = ''; }
  });
  addL(window, 'mousemove', (e) => {
    const locked = document.pointerLockElement === canvas;
    if (rightDown && !locked && !(e.buttons & 2)) { rightDown = false; canvas.style.cursor = ''; return; }
    if (rightDown) { mouseDX += e.movementX; mouseDY += e.movementY; }
  });
  const release = () => { rightDown = false; canvas.style.cursor = ''; mouseDX = 0; mouseDY = 0; for (const k in keys) keys[k] = false;
    if (typeof window !== 'undefined') window.__relCount = (window.__relCount || 0) + 1; };
  addL(window, 'blur', release);
  addL(document, 'mouseleave', release);
}

export function disposeController() {
  for (const [t, ev, fn] of listeners) t.removeEventListener(ev, fn);
  listeners = [];
  if (cam && fovBase) { cam.fov = fovBase; cam.updateProjectionMatrix(); }
  cam = null;
}

/** Lateral bob offset — visual sway only, never part of the physics. */
export function getVisOffset() { return { x: visX, z: visZ }; }

export function getLocalPos() { return pos; }
export function getHeldKeys() { return Object.keys(keys).filter((k) => keys[k]).join('+') || '-'; }
export function getMode() { return mode; }
export function getGroundSpeed() { return Math.hypot(vel.x, vel.z); }

// The eye's rendered height: physics height plus the current bob —
// what the camera should actually use.
let lastEyeY = 0;
export function getEyeY() { return lastEyeY || pos.y; }

export function updateController(dt) {
  if (!cam) return null;

  // ── Look — the helm's smoothing, no roll ──
  _pendYaw += -mouseDX * MOUSE_SENS;
  // One ship, one Y — the shared preference (ask Sol to flip it)
  _pendPitch += (getLookInvert() ? 1 : -1) * mouseDY * MOUSE_SENS;
  mouseDX = 0; mouseDY = 0;
  const lk = 1 - Math.exp(-dt / TAU_LOOK);
  yaw += _pendYaw * lk; _pendYaw *= (1 - lk);
  pitch += _pendPitch * lk; _pendPitch *= (1 - lk);
  pitch = THREE.MathUtils.clamp(pitch, -MAX_PITCH, MAX_PITCH);

  // ── Intent ──
  const roving = mode === 'rove';
  const run = !!(keys['ShiftLeft'] || keys['ShiftRight']);
  const top = roving ? (run ? ROVE_BOOST : ROVE_SPEED) : (run ? WALK_RUN : WALK_SPEED);
  _fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw));
  _right.set(Math.cos(yaw), 0, -Math.sin(yaw));
  let ax = 0, az = 0, moving = false, mag = 1, steer = 0, throttle = 0;
  if (roving) {
    // A VEHICLE, not fast boots: W/S throttle along the rover's own
    // heading, A/D steer it (sharper with speed, like real wheels),
    // and the camera free-looks over the top.
    throttle = ((keys['KeyW'] || keys['ArrowUp']) ? 1 : 0) + ((keys['KeyS'] || keys['ArrowDown']) ? -0.45 : 0);
    steer = ((keys['KeyA'] || keys['ArrowLeft']) ? 1 : 0) - ((keys['KeyD'] || keys['ArrowRight']) ? 1 : 0);
    const sp0 = Math.hypot(vel.x, vel.z);
    vehYaw += steer * 1.35 * Math.min(1, 0.22 + sp0 / 9) * dt;
    if (throttle !== 0) {
      const sgn = Math.sign(throttle);
      ax = -Math.sin(vehYaw) * sgn;
      az = -Math.cos(vehYaw) * sgn;
      mag = Math.abs(throttle);
      moving = true;
    }
    // Driving forward, hands off the mouse: the gaze drifts home to
    // the direction of travel — free look is a glance, not a divorce.
    if (!rightDown && throttle > 0) {
      const dyaw = ((vehYaw - yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      yaw += dyaw * (1 - Math.exp(-dt / 2.0));
    }
  } else {
    if (keys['KeyW'] || keys['ArrowUp']) { ax += _fwd.x; az += _fwd.z; }
    if (keys['KeyS'] || keys['ArrowDown']) { ax -= _fwd.x; az -= _fwd.z; }
    if (keys['KeyD'] || keys['ArrowRight']) { ax += _right.x; az += _right.z; }
    if (keys['KeyA'] || keys['ArrowLeft']) { ax -= _right.x; az -= _right.z; }
    moving = (ax !== 0 || az !== 0);
    if (moving) { const l = Math.hypot(ax, az); ax /= l; az /= l; }
  }

  // Slope resistance: sample the climb ahead; steep ground wins.
  let slopeK = 1;
  if (moving) {
    const probe = roving ? 3.0 : 1.2;
    const hHere = heightAt(pos.x, pos.z);
    const hAhead = heightAt(pos.x + ax * probe, pos.z + az * probe);
    const grade = (hAhead - hHere) / probe;
    const maxGrade = roving ? 0.49 : 0.67;   // ~26° / ~34°
    if (grade > 0) slopeK = THREE.MathUtils.clamp(1 - grade / maxGrade, 0, 1);
    else slopeK = Math.min(1.2, 1 - grade * 0.14); // downhill pays
  }

  // ── Integrate ──
  // A touch of weight in the ramps; the rover coasts like a machine.
  const tau = moving ? (roving ? 1.25 : 0.42) : (roving ? 1.5 : 0.28);
  const k = 1 - Math.exp(-dt / tau);
  const tx = moving ? ax * top * mag * slopeK : 0;
  const tz = moving ? az * top * mag * slopeK : 0;
  if (grounded) {
    vel.x += (tx - vel.x) * k;
    vel.z += (tz - vel.z) * k;
  } // airborne: ballistic — you steer before you leap

  const groundY = heightAt(pos.x, pos.z);
  const eyeTarget = roving ? EYE_ROVE : EYE_WALK;

  if (grounded) {
    if (!roving && keys['Space']) {
      vel.y = JUMP_V;
      grounded = false;
    } else {
      vel.y = 0;
    }
  }
  if (!grounded) vel.y -= G_MARS * dt;

  pos.x += vel.x * dt;
  pos.z += vel.z * dt;
  pos.y += vel.y * dt;

  const floorY = heightAt(pos.x, pos.z);
  const standY = floorY + eyeTarget;
  if (grounded) {
    // Suspension: the eye follows the ground through a spring — walking
    // absorbs the heightfield's texture, the rover breathes over it.
    const tauEye = roving ? 0.22 : 0.09;
    pos.y += (standY - pos.y) * (1 - Math.exp(-dt / tauEye));
    if (standY - pos.y > 0.9) grounded = false; // walked off an edge
  } else if (pos.y <= standY) {
    pos.y = standY;
    impact = Math.max(impact, -vel.y);   // touchdown speed for the knees
    vel.y = 0;
    grounded = true;
  }

  // ── Camera compose — the feel ──────────────────────────────────────
  const sp = getGroundSpeed();
  const spK = Math.min(1, sp / (roving ? ROVE_SPEED : WALK_RUN));
  const ke = (t) => 1 - Math.exp(-dt / t);   // easing helper

  // Landing: the knees take it. Impact charges a stiff, well-damped
  // spring; the eye dips and recovers in a quarter second.
  if (impact > 0.4) {
    landVel -= Math.min(2.4, impact) * 0.16;
    stepCrunch(Math.min(1.3, impact * 0.35), true);
  }
  impact = 0;
  landVel += (-90 * landDip - 14 * landVel) * dt;
  landDip = THREE.MathUtils.clamp(landDip + landVel * dt, -0.24, 0.1);

  let bobY = 0, bobLat = 0, walkRoll = 0;
  if (!roving && grounded && sp > 0.35) {
    // Stride-locked bob: vertical beats twice per cycle (each footfall),
    // sway once — the classic figure-8 — and the crunch lands exactly
    // on the beat. Stride quickens with pace.
    const strideHz = 1.25 + 1.05 * spK;
    const prev = stridePh;
    stridePh += dt * Math.PI * 2 * strideHz;
    if (Math.floor(stridePh / Math.PI) !== Math.floor(prev / Math.PI)) {
      stepCrunch(0.45 + 0.6 * spK, false);
    }
    const w = 0.35 + 0.65 * spK;
    bobY = Math.sin(stridePh * 2) * 0.020 * w;
    bobLat = Math.sin(stridePh) * 0.013 * w;
    walkRoll = Math.sin(stridePh) * 0.007 * spK;
  } else if (!roving) {
    stridePh = 0;
  }

  // Cross-slope lean: the body reads the camber of the ground
  {
    const hl = heightAt(pos.x - _right.x * 1.5, pos.z - _right.z * 1.5);
    const hr = heightAt(pos.x + _right.x * 1.5, pos.z + _right.z * 1.5);
    const camber = THREE.MathUtils.clamp((hl - hr) / 3.0, -0.35, 0.35);
    const rollT = camber * (roving ? 0.16 : 0.07) * (0.3 + 0.7 * spK);
    slopeRoll += (rollT - slopeRoll) * ke(0.45);
  }

  let lean = 0;
  if (roving) {
    // The machine has a body: nose lifts under throttle, dips under
    // braking; it leans into turns; the motor sings with the wheels.
    const fwdSpeed = vel.x * _fwd.x + vel.z * _fwd.z;
    const a = (fwdSpeed - prevFwdSpeed) / Math.max(dt, 1e-3);
    prevFwdSpeed = fwdSpeed;
    const pitchT = THREE.MathUtils.clamp(-a * 0.006, -0.05, 0.035);
    accelPitch += (pitchT - accelPitch) * ke(0.4);
    // Lean into the steer, harder with speed — motorcycle physics
    lean = steer * 0.06 * (0.3 + 0.7 * spK);
    setRoverBed(grounded ? 0.15 + 0.85 * spK : 0.1);
  } else {
    accelPitch += (0 - accelPitch) * ke(0.3);
    prevFwdSpeed = 0;
    setRoverBed(0);
  }
  roverLean += (lean - roverLean) * ke(0.35);

  // Speed widens the eye — subtle at a run, real at rover boost
  const fovT = fovBase + (roving ? 3.0 + 6.0 * spK : 2.2 * spK * (run ? 1 : 0));
  cam.fov += (fovT - cam.fov) * ke(0.45);
  cam.updateProjectionMatrix();

  _e.set(pitch + accelPitch, yaw, roverLean + walkRoll + slopeRoll);
  cam.quaternion.setFromEuler(_e);
  lastEyeY = pos.y + bobY + landDip;
  visX = _right.x * bobLat;
  visZ = _right.z * bobLat;

  return {
    mode,
    grounded,
    speed: sp,
    airborne: !grounded,
    camY: lastEyeY,
  };
}
