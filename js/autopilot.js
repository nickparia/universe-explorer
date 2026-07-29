// autopilot.js — the hands-free helm. Leave the ship alone for a while
// and SOLACE quietly takes over: composed drifting in orbit, then a real
// voyage somewhere new, arrival, a long dwell, onward. One continuous
// camera, no cuts, no mode UI — the ship simply has a competent computer.
// Any input returns the helm instantly, mid-move.

import { on, emit } from './bus.js';
import { getLandmarks } from './deepspace.js';
import {
  cruiseTo, isOrbiting, isWarpTraveling, isFlyingTo, getOrbitBodyName,
  setAutoCinema, isIntroPlaying,
} from './flight.js';

const IDLE_ENGAGE = 100;        // s of stillness before SOLACE takes the helm

// Hidden flight recorder — `__helmLog` in the console shows exactly why
// the helm engaged, released, or planned. Ring buffer, 60 entries.
const LOG = [];
function hlog(msg) {
  LOG.push(`${(performance.now() / 1000).toFixed(1)}s ${msg}`);
  if (LOG.length > 60) LOG.shift();
}
if (typeof window !== 'undefined') window.__helmLog = LOG;
const DWELL_MIN = 110;          // s in orbit before moving on
const DWELL_VAR = 130;

const PLANET_POOL = ['SATURN', 'JUPITER', 'NEPTUNE', 'URANUS', 'EARTH', 'MARS', 'PLUTO', 'BLACK HOLE'];

// Boot grace is SHORT: a freshly loaded page with no input isn't an
// active pilot to protect — the ship should come alive in ~30s. The
// full 100s window applies only after deliberate input.
let idle = IDLE_ENGAGE - 30;
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
  hlog(`ENGAGE (orbiting=${isOrbiting()} body=${getOrbitBodyName() || '-'})`);
  engaged = true;
  setAutoCinema(true);
  emit('autopilot:engaged');
  requestWake();
  if (isOrbiting()) {
    // You've already been looking at this place for the whole idle
    // wait — the first departure comes quickly, so taking the helm is
    // something you can SEE happen.
    dwell = 20 + Math.random() * 25;
  } else {
    planNext();
  }
}

function release(cause) {
  if (!engaged) return;
  hlog(`RELEASE ${cause || '?'}`);
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
  driftGrace = 15; // if the cruise doesn't take, replan
  hlog(`DEPART -> ${next}`);
  // Speed follows intent: when SOLACE has the helm, the ship CRUISES —
  // the slow crossing is the passive experience. Deliberate chart
  // navigation keeps the fast warp.
  cruiseTo(next);
  hlog(`warp active=${isWarpTraveling()}`);
}

// Asymmetric input rules — the fix for 'it never engages with a human
// at the desk'. A resting finger on a Magic Mouse/trackpad emits micro
// wheel events; sensors jitter; Chrome fires phantom mousemoves under a
// stationary cursor. So: ENGAGEMENT is only blocked by inputs that
// actually DO something in the app (keys, clicks, button-held drags —
// bare mouse movement and wheel are no-ops in the main view anyway).
// RELEASE stays hair-trigger: any sign of a human returns the helm.
function deliberateInput(cause) {
  idle = 0;
  if (engaged) release(cause || 'deliberate');
}
function presenceInput(cause) {
  if (engaged) {
    // A nudge hands back the helm, but if no deliberate input follows,
    // SOLACE resumes in ~30s — a desk bump shouldn't cost the full wait.
    idle = IDLE_ENGAGE - 30;
    release(cause || 'presence');
  }
}

export function initAutopilot() {
  for (const ev of ['keydown', 'mousedown', 'touchstart']) {
    window.addEventListener(ev, (e) => deliberateInput(`${ev}:${e.code || e.button || ''}`), { passive: true });
  }
  // Release requires UNMISTAKABLE intent. A Magic Mouse with a finger
  // resting on it emits micro wheel events continuously; sensors drift a
  // few px. If those release the helm, autopilot lives in a 'tries to
  // move, freezes, tries again' loop and never completes a dwell.
  window.addEventListener('wheel', (e) => {
    const mag = Math.abs(e.deltaY) + Math.abs(e.deltaX);
    if (mag > 60) presenceInput(`wheel:${Math.round(mag)}`);
  }, { passive: true });
  let lmx = null, lmy = null;
  window.addEventListener('mousemove', (e) => {
    const d = lmx !== null ? Math.hypot(e.clientX - lmx, e.clientY - lmy) : 0;
    lmx = e.clientX; lmy = e.clientY;
    if (d < 4) return;
    // Movement with a button held is active flying (look-drag) —
    // deliberate. Bare movement releases only on a real flick.
    if (e.buttons) deliberateInput(`drag:${Math.round(d)}px`);
    else if (d > 25) presenceInput(`mousemove:${Math.round(d)}px`);
  }, { passive: true });
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
  if (isIntroPlaying() || chartOpen) { idle = Math.min(idle, IDLE_ENGAGE - 30); return; }

  if (!engaged) {
    // A journey the traveler chose IS engagement. Watching a cruise
    // hands-off for minutes must never summon the autopilot to reroute
    // it — that was the "SOLACE took the helm mid-crossing" bug.
    if (isWarpTraveling() || isFlyingTo()) { idle = 0; return; }
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
