// autopilot.js — the hands-free helm. Leave the ship alone for a while
// and SOLACE quietly takes over: composed drifting in orbit, then a real
// voyage somewhere new, arrival, a long dwell, onward. One continuous
// camera, no cuts, no mode UI — the ship simply has a competent computer.
// Any input returns the helm instantly, mid-move.

import { on, emit } from './bus.js';
import { getLandmarks } from './deepspace.js';
import {
  warpTo, isOrbiting, isWarpTraveling, getOrbitBodyName,
  setAutoCinema, isIntroPlaying,
} from './flight.js';

const IDLE_ENGAGE = 100;        // s of stillness before SOLACE takes the helm
const DWELL_MIN = 150;          // s in orbit before moving on
const DWELL_VAR = 170;

const PLANET_POOL = ['SATURN', 'JUPITER', 'NEPTUNE', 'URANUS', 'EARTH', 'MARS', 'PLUTO', 'BLACK HOLE'];

let idle = 0;
let engaged = false;
let dwell = 0;
let driftGrace = 0;
let chartOpen = false;
const history = [];
let wakeLock = null;

async function requestWake() {
  try {
    if (navigator.wakeLock) wakeLock = await navigator.wakeLock.request('screen');
  } catch (e) { /* second screens sleep; we tried */ }
}
function releaseWake() {
  try { if (wakeLock) { wakeLock.release(); wakeLock = null; } } catch (e) {}
}

function engage() {
  engaged = true;
  setAutoCinema(true);
  emit('autopilot:engaged');
  requestWake();
  if (isOrbiting()) {
    dwell = DWELL_MIN + Math.random() * DWELL_VAR;
  } else {
    planNext();
  }
}

function release() {
  if (!engaged) return;
  engaged = false;
  setAutoCinema(false);
  emit('autopilot:released');
  releaseWake();
}

function planNext() {
  const names = getLandmarks().map((l) => l.name).concat(PLANET_POOL);
  const here = getOrbitBodyName();
  const pool = names.filter((n) => n !== here && !history.includes(n));
  if (pool.length === 0) { history.length = 0; return; }
  const next = pool[Math.floor(Math.random() * pool.length)];
  history.push(next);
  if (history.length > 5) history.shift();
  driftGrace = 15; // if the warp doesn't take, replan
  warpTo(next);
}

function onInput() {
  idle = 0;
  if (engaged) release();
}

export function initAutopilot() {
  for (const ev of ['keydown', 'mousedown', 'wheel', 'mousemove', 'touchstart']) {
    window.addEventListener(ev, onInput, { passive: true });
  }
  on('starmap:toggled', (open) => { chartOpen = open; });
  on('orbit:enter', () => {
    if (engaged) {
      dwell = DWELL_MIN + Math.random() * DWELL_VAR;
      setAutoCinema(true); // rebase the cinema orbit around the new body
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (engaged && document.visibilityState === 'visible') requestWake();
  });
}

export function updateAutopilot(dt) {
  if (isIntroPlaying() || chartOpen) { idle = 0; return; }

  if (!engaged) {
    idle += dt;
    if (idle > IDLE_ENGAGE) engage();
    return;
  }

  if (isWarpTraveling()) { driftGrace = 12; return; }
  if (isOrbiting()) {
    dwell -= dt;
    if (dwell <= 0) planNext();
    return;
  }
  // Adrift between states (cancelled arrival, edge cases): give the
  // world a moment, then set a new course.
  driftGrace -= dt;
  if (driftGrace <= 0) planNext();
}

export function isAutopilotEngaged() { return engaged; }
