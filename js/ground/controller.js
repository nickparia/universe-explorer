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

const G_MARS = 3.71;
const EYE_WALK = 1.65;
const EYE_ROVE = 2.15;
const WALK_SPEED = 3.2, WALK_RUN = 7.0;
const ROVE_SPEED = 13.5, ROVE_BOOST = 24;
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
let bobT = 0;
let listeners = [];
let roverLean = 0;

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
  keys = {}; mouseDX = 0; mouseDY = 0; _pendYaw = 0; _pendPitch = 0;

  const canvas = document.getElementById('c');
  addL(window, 'keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
      // An EMPTY terminal line yields to the boots: after talking to
      // Sol the input keeps focus, and without this every W went into
      // the chat — "movement doesn't work." Mid-sentence, typing wins.
      if (!e.target.value && /^(Key[WASDV]|Space|Shift(Left|Right))$/.test(e.code)) {
        e.target.blur();
        if (canvas) canvas.focus();
      } else {
        return;
      }
    }
    keys[e.code] = true;
    if (e.code === 'Space') e.preventDefault();
    if (e.code === 'KeyV') mode = (mode === 'walk') ? 'rove' : 'walk';
  });
  addL(window, 'keyup', (e) => { keys[e.code] = false; });
  addL(canvas, 'mousedown', (e) => { if (e.button === 2) { rightDown = true; canvas.style.cursor = 'none'; } });
  addL(window, 'mouseup', (e) => { if (e.button === 2) { rightDown = false; canvas.style.cursor = ''; } });
  addL(window, 'mousemove', (e) => {
    if (rightDown && !(e.buttons & 2)) { rightDown = false; canvas.style.cursor = ''; return; }
    if (rightDown) { mouseDX += e.movementX; mouseDY += e.movementY; }
  });
  const release = () => { rightDown = false; canvas.style.cursor = ''; mouseDX = 0; mouseDY = 0; for (const k in keys) keys[k] = false; };
  addL(window, 'blur', release);
  addL(document, 'mouseleave', release);
}

export function disposeController() {
  for (const [t, ev, fn] of listeners) t.removeEventListener(ev, fn);
  listeners = [];
  cam = null;
}

export function getLocalPos() { return pos; }
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
  let ax = 0, az = 0;
  if (keys['KeyW']) { ax += _fwd.x; az += _fwd.z; }
  if (keys['KeyS']) { ax -= _fwd.x; az -= _fwd.z; }
  if (keys['KeyD']) { ax += _right.x; az += _right.z; }
  if (keys['KeyA']) { ax -= _right.x; az -= _right.z; }
  const moving = (ax !== 0 || az !== 0);
  if (moving) { const l = Math.hypot(ax, az); ax /= l; az /= l; }

  // Slope resistance: sample the climb ahead; steep ground wins.
  let slopeK = 1;
  if (moving) {
    const probe = roving ? 3.0 : 1.2;
    const hHere = heightAt(pos.x, pos.z);
    const hAhead = heightAt(pos.x + ax * probe, pos.z + az * probe);
    const grade = (hAhead - hHere) / probe;
    const maxGrade = roving ? 0.49 : 0.67;   // ~26° / ~34°
    if (grade > 0) slopeK = THREE.MathUtils.clamp(1 - grade / maxGrade, 0, 1);
    else slopeK = Math.min(1.15, 1 - grade * 0.1); // a little free speed downhill
  }

  // ── Integrate ──
  const tau = moving ? (roving ? 1.1 : 0.35) : (roving ? 0.9 : 0.22);
  const k = 1 - Math.exp(-dt / tau);
  const tx = moving ? ax * top * slopeK : 0;
  const tz = moving ? az * top * slopeK : 0;
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
    vel.y = 0;
    grounded = true;
  }

  // ── Camera compose ──
  bobT += dt * (1 + getGroundSpeed() * 0.9);
  let bob = 0, lean = 0;
  const sp = getGroundSpeed();
  if (grounded && sp > 0.3) {
    if (roving) {
      // The rover reads the rocks: fine height noise becomes shake
      const shake = Math.min(1, sp / ROVE_SPEED);
      bob = (heightAt(pos.x * 3.1, pos.z * 3.1) % 0.13) * 0.16 * shake;
      lean = THREE.MathUtils.clamp(-_pendYaw * 5 * shake, -0.05, 0.05);
    } else {
      bob = Math.sin(bobT * 6.2) * 0.042 * Math.min(1, sp / WALK_RUN);
    }
  }
  roverLean += (lean - roverLean) * (1 - Math.exp(-dt / 0.4));

  _e.set(pitch, yaw, roverLean);
  cam.quaternion.setFromEuler(_e);
  lastEyeY = pos.y + bob;

  return {
    mode,
    grounded,
    speed: sp,
    airborne: !grounded,
    camY: pos.y + bob,
  };
}
