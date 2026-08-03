// session.js — the ship remembers.
//
// Two responsibilities, one storage:
//   Resume — your pose (and orbit, if any) is saved continuously; next
//   visit puts you back exactly where you were instead of replaying the
//   opening. A place you return to, not an app that restarts.
//   Voyage log — every location you've orbited is quietly recorded. No
//   points, no announcements: the star chart shows visited places warmer,
//   and the ship computer knows where you've been.

import { on } from './bus.js';
import { NEWHIRE_SIM } from './crew.js';
import { getCamPos, getCamQuat, getOrbitBodyName, getSpeedFeel, isOrbiting } from './flight.js';

const KEY = 'solace_session_v1';
const OPENING_AGAIN_AFTER_DAYS = 21; // long absence earns the title shot again

let state = null; // { pose, visited: {name: firstSeenTs}, savedAt }

function load() {
  if (state) return state;
  try {
    state = JSON.parse(localStorage.getItem(KEY)) || {};
  } catch (e) {
    state = {};
  }
  if (!state.visited) state.visited = {};
  return state;
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) { /* storage full or blocked — the ship forgets, gracefully */ }
}

/**
 * Returns a saved pose to resume into, or null if this visit should play
 * the full opening (first visit, or a long absence).
 */
export function getResumePose() {
  const s = load();
  if (!s.pose || !s.savedAt) return null;
  const days = (Date.now() - s.savedAt) / 86400000;
  if (days > OPENING_AGAIN_AFTER_DAYS) return null;
  const p = s.pose;
  if (![p.px, p.py, p.pz, p.qx, p.qy, p.qz, p.qw].every(Number.isFinite)) return null;
  return p;
}

export function getVisited() {
  return new Set(Object.keys(load().visited));
}

function savePose() {
  // The ?newhire simulation must not leave footprints: its wanderings
  // never overwrite the machine's real resume pose.
  if (NEWHIRE_SIM) return;
  const feel = getSpeedFeel();
  // Only save stable states — free flight or orbit. Mid-warp/fly-to poses
  // are transient; resuming into one would strand you between places.
  if (!feel.free && !isOrbiting()) return;
  const p = getCamPos();
  const q = getCamQuat();
  state.pose = {
    px: p.x, py: p.y, pz: p.z,
    qx: q.x, qy: q.y, qz: q.z, qw: q.w,
    orbit: getOrbitBodyName(),
  };
  state.savedAt = Date.now();
  persist();
}

export function initSession() {
  load();

  on('orbit:enter', ({ name }) => {
    if (!name) return;
    if (!state.visited[name]) {
      state.visited[name] = Date.now();
      persist();
    }
  });

  setInterval(savePose, 5000);
  window.addEventListener('pagehide', savePose);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') savePose();
  });
}
