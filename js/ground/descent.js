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

// ── Retro plume — the engines answer the ground ──
const SMOKE_N = 280;
let smoke = null, smokeMat = null;
let smokeVel = null, smokeLife = null;

function makeSmokeSprite() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(235,225,212,0.85)');
  grad.addColorStop(0.5, 'rgba(210,195,180,0.35)');
  grad.addColorStop(1, 'rgba(200,185,170,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function initSmoke(parentGroup) {
  const posArr = new Float32Array(SMOKE_N * 3).fill(-99999);
  smokeVel = new Float32Array(SMOKE_N * 3);
  smokeLife = new Float32Array(SMOKE_N);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
  smokeMat = new THREE.PointsMaterial({
    map: makeSmokeSprite(), size: 2.6, sizeAttenuation: true,
    transparent: true, opacity: 0.5, depthWrite: false, color: 0xd8cfc4,
  });
  smoke = new THREE.Points(geo, smokeMat);
  smoke.frustumCulled = false;
  parentGroup.add(smoke);
}

function disposeSmoke() {
  if (smoke) {
    smoke.geometry.dispose();
    smokeMat.map.dispose();
    smokeMat.dispose();
    if (smoke.parent) smoke.parent.remove(smoke);
  }
  smoke = null; smokeMat = null; smokeVel = null; smokeLife = null;
}

let _spawnAcc = 0;
function updateSmoke(dt, intensity, burst = 0) {
  if (!smoke) return;
  const arr = smoke.geometry.attributes.position.array;
  // age and drift
  for (let i = 0; i < SMOKE_N; i++) {
    if (smokeLife[i] <= 0) continue;
    smokeLife[i] -= dt;
    if (smokeLife[i] <= 0) { arr[i * 3 + 1] = -99999; continue; }
    arr[i * 3] += smokeVel[i * 3] * dt;
    arr[i * 3 + 1] += smokeVel[i * 3 + 1] * dt;
    arr[i * 3 + 2] += smokeVel[i * 3 + 2] * dt;
    smokeVel[i * 3 + 1] += 2.2 * dt;   // hot exhaust buoyancy
  }
  _spawnAcc += dt * (intensity * 150) + burst;
  let n = Math.floor(_spawnAcc);
  _spawnAcc -= n;
  for (let i = 0; i < SMOKE_N && n > 0; i++) {
    if (smokeLife[i] > 0) continue;
    n--;
    smokeLife[i] = 0.9 + Math.random() * 0.9;
    const a = Math.random() * Math.PI * 2;
    const r = burst > 0 ? 2 + Math.random() * 6 : 1 + Math.random() * 2.5;
    arr[i * 3] = pos.x + Math.cos(a) * r;
    arr[i * 3 + 1] = pos.y - 4 - Math.random() * 3;
    arr[i * 3 + 2] = pos.z + Math.sin(a) * r;
    smokeVel[i * 3] = Math.cos(a) * (burst > 0 ? 8 + Math.random() * 8 : 2 + Math.random() * 3);
    smokeVel[i * 3 + 1] = burst > 0 ? 2 + Math.random() * 4 : 5 + Math.random() * 9;
    smokeVel[i * 3 + 2] = Math.sin(a) * (burst > 0 ? 8 + Math.random() * 8 : 2 + Math.random() * 3);
  }
  smoke.geometry.attributes.position.needsUpdate = true;
}

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

// After touchdown the blast keeps settling while the boots take over —
// the ground mode ticks this from its active state; it self-disposes.
let _smokeDecay = 0;
export function tickSmoke(dt) {
  if (_smokeDecay <= 0 || !smoke) return;
  updateSmoke(dt, 0);
  _smokeDecay -= dt;
  if (_smokeDecay <= 0) disposeSmoke();
}
export function getDescentPos() { return pos; }
export function getDescentSpeed() { return lastSpeed; }

/** The way down. endLocal is the bootfall point (site frame). */
export function startDescent(camera, parentGroup, endLocal, yawAtRest, pitchAtRest, onDone) {
  cam = camera;
  initSmoke(parentGroup);
  phase = 'descend';
  finalYaw = yawAtRest;
  finalPitch = pitchAtRest;
  doneCb = onDone;
  T = 11;
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
export function startAscent(camera, parentGroup, fromLocal, onDone) {
  cam = camera;
  initSmoke(parentGroup);
  phase = 'ascend';
  doneCb = onDone;
  T = 8;
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
  disposeSmoke();
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

  // The engines answer the ground: retro plume building through the
  // braking, a dust-and-steam blast at the pad; the climb burns early.
  if (phase === 'descend') {
    updateSmoke(dt, THREE.MathUtils.smoothstep(u, 0.45, 0.85) * (0.4 + 0.6 * u));
  } else {
    updateSmoke(dt, Math.max(0, 1 - u * 2.2));
  }

  const done = t >= T;
  if (done) {
    disarmSkip();
    const cb = doneCb;
    doneCb = null;
    if (phase === 'descend') {
      updateSmoke(dt, 0, 90);   // touchdown blast
      fadePlasma(0.4);
      phase = null;
      _smokeDecay = 3.0;        // the blast settles behind the bootfall
    }
    // ascent keeps its plasma up — the teardown happens behind it
    if (cb) cb();
  }
  return { frac: u, speed: lastSpeed, done };
}
