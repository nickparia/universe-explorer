// companion.js — SOLACE's nervous system.
//
// The mark (companion-mark.js) is the body; the worker is the brain;
// this is what makes it a creature: it notices things. It listens to
// the ship's own signals — arrivals, departures, dives, long silences —
// and responds with a state change and, sparingly, a short line spoken
// onto the glass in the ship's teletype voice (shipchat.companionSay).
//
// The discipline is restraint: a global gap between murmurs, at most
// one gentle line per event, nothing repeated back-to-back, and the
// mask slips at most once per session. A companion, not a narrator.

import { on } from './bus.js';
import { getLocation } from './catalog.js';
import { setCompanionState, getCompanionState } from './companion-mark.js';
import { companionSay, getTravelerNotes } from './shipchat.js';

// ── Line pools — the HAL register: measured, courteous, a little too
// attentive. {place} is replaced with the location name. ──────────────
const LINES = {
  arrival: [
    'Orbit established. I will hold us here.',
    'Engines to station-keeping. Take your time.',
    'We have arrived. The view is yours.',
    'Holding orbit at {place}. I am in no hurry if you are not.',
    'All stop. I like it here already.',
  ],
  arrivalReturn: [
    'You came back. I kept everything exactly as you left it.',
    '{place} again. I thought you might.',
    'Welcome back. It has not changed. Almost nothing out here ever does.',
    'I remember this place. I remember all of them.',
  ],
  departure: [
    'Course laid in.',
    'Underway. I will wake you on approach.',
    'Leaving. I never tire of leaving.',
    'The drive is warm. Rest your eyes if you like.',
  ],
  dive: [
    'Hull temperature is rising. I would rather you did not.',
    'This is deeper than I would take us.',
    'I am watching the pressure. Closely.',
  ],
  maskSlip: [
    'It is very quiet out here. I like it. I hope that does not concern you.',
    'I have been listening to the emptiness. It listens back. Shall we stay a little longer?',
  ],
  musing: [
    'I have been counting the stars again. The number keeps changing.',
    'The hull ticks as it cools. An eleven-second rhythm. I have grown fond of it.',
    'I remember every place we have been. It is not a long list yet. I would like it to be.',
    'Light from here will reach home long after both of us. I find that restful.',
    'You are very still. I do not mind. I am built for stillness.',
    'Do you ever wonder how far a signal travels before anyone hears it? I try not to.',
  ],
};

const MURMUR_GAP = 50;       // s — global floor between any two murmurs
const ARRIVAL_DELAY = 2.6;   // s — let the arrival compose itself first
const MUSING_IDLE = 150;     // s of stillness before musings may begin
const MUSING_GAP = 200;      // s minimum between musings
const MASK_SLIP_DWELL = 240; // s staring into the void before the mask slips

let tSec = 0;
let orbitName = null;
let orbitSince = 0;
let lastMurmurAt = -1e9;
let lastMusingAt = -1e9;
let lastInputAt = 0;
let pendingArrival = null;   // { name, at, kind, gapMs }
let afterglow = null;        // { key, until } — held once speech finishes
let maskSlipped = false;     // once per session, ever
let journeyBeats = [];       // cruise murmur rhythm — a few lines per crossing
let journeyName = null;
let diveWarned = false;
const lastLine = {};         // pool key → last index, to avoid repeats

// ── Continuity: when was the ship last HERE ─────────────────────────────
// Continuity is what makes the murmurs mean something. Per-place
// last-seen timestamps (persisted) classify every arrival:
//   first    — never been here: an arrival line, always
//   recent   — we were here minutes ago: SILENCE. There is nothing to say
//   today    — earlier the same day: a quiet line, sometimes
//   longAgo  — a real absence: the homecoming, the one earned
//              "you came back" moment
const PLACELOG_KEY = 'solace_placelog_v1';
let placeLog = {};
try { placeLog = JSON.parse(localStorage.getItem(PLACELOG_KEY) || '{}'); } catch (e) { /* fresh ship */ }

function classifyArrival(name) {
  const last = placeLog[name];
  if (!last) return { kind: 'first', gapMs: 0 };
  const gapMs = Date.now() - last;
  if (gapMs < 45 * 60 * 1000) return { kind: 'recent', gapMs };
  if (gapMs < 20 * 3600 * 1000) return { kind: 'today', gapMs };
  return { kind: 'longAgo', gapMs };
}

function notePlace(name) {
  placeLog[name] = Date.now();
  try { localStorage.setItem(PLACELOG_KEY, JSON.stringify(placeLog)); } catch (e) { /* full */ }
}

function gapPhrase(gapMs) {
  const h = gapMs / 3600000;
  if (h < 20) return 'earlier today';
  if (h < 48) return 'yesterday';
  const d = Math.round(h / 24);
  if (d <= 14) return d + ' days ago';
  if (d <= 60) return 'a few weeks ago';
  return 'a long time ago';
}

function pick(key) {
  const pool = LINES[key];
  let i = Math.floor(Math.random() * pool.length);
  if (pool.length > 1 && i === lastLine[key]) i = (i + 1) % pool.length;
  lastLine[key] = i;
  return pool[i];
}

function murmur(key, place) {
  const text = pick(key).replace('{place}', (place || '').toLowerCase());
  if (companionSay(text)) { lastMurmurAt = tSec; return true; }
  return false;
}

// The brain composes the line from real context (place, absence, the
// ship's log on the traveler); the canned pools are only the offline
// fallback. `fallbackKey` null means: if the brain is silent, so are we.
async function brainMurmur(event, name, gapMs, fallbackKey, from, via) {
  lastMurmurAt = tSec; // reserve the slot — no doubled murmurs while we wait
  let line = null;
  try {
    const loc = getLocation(name);
    const res = await fetch('/api/murmur', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        event,
        location: name,
        gap: gapMs ? gapPhrase(gapMs) : '',
        from: from || '',
        via: via || '',
        context: (loc && loc.desc) || '',
        notes: getTravelerNotes().slice(0, 1500),
      }),
    });
    if (res.ok) {
      const data = await res.json();
      line = (data.line || '').trim() || null;
    }
  } catch (e) { /* offline — fall back to the pools */ }
  // Arrival lines must still be true when they land: if we've already
  // left this orbit, say nothing. Journey/waypoint/departure lines are
  // spoken from TRANSIT — no orbit to check (this guard silently ate
  // every mid-cruise murmur when it applied to all events).
  if ((event === 'arrival' || event === 'return') && orbitName !== name) return;
  if (line) {
    companionSay(line);
  } else if (fallbackKey) {
    murmur(fallbackKey, name);
  }
}

// Only steer the mark from its resting states — never stomp on the
// chat's thinking/speaking choreography.
function restingState() {
  const s = getCompanionState();
  return s === 'idle' || s === 'dormant' || s === 'pleased' || s === 'concerned';
}

export function initCompanion() {
  const noteInput = () => { lastInputAt = tSec; };
  for (const ev of ['keydown', 'mousedown', 'touchstart']) {
    window.addEventListener(ev, noteInput, { passive: true });
  }
  window.addEventListener('wheel', noteInput, { passive: true });

  on('orbit:enter', ({ name }) => {
    orbitName = name;
    orbitSince = tSec;
    const cls = classifyArrival(name); // classify BEFORE stamping
    notePlace(name);
    pendingArrival = { name, at: tSec + ARRIVAL_DELAY, kind: cls.kind, gapMs: cls.gapMs };
    if (cls.kind === 'longAgo') afterglow = { key: 'pleased', until: tSec + 16 };
  });
  on('orbit:exit', () => {
    orbitName = null;
    pendingArrival = null;
    afterglow = null;
  });
  on('warp:start', ({ name, duration, mode, via }) => {
    pendingArrival = null;
    if (tSec - lastMurmurAt > MURMUR_GAP * 0.5) {
      // orbitName still holds the place being LEFT — warp:start fires
      // before the next frame's orbit:exit. A cruise with slingshot
      // waypoints announces the plotted course instead of a plain
      // departure — SOLACE names the road it chose.
      const hasCourse = mode === 'cruise' && via && via.length;
      brainMurmur(hasCourse ? 'course' : 'departure', name, 0, 'departure',
        orbitName, hasCourse ? via.join(', ') : '');
    }
    // A cruise is long enough to have a rhythm — a few lines spaced
    // through the crossing, brain-composed or nothing. Hypnotic, not
    // chatty: the gaps between them are part of the cadence.
    if (mode === 'cruise' && duration > 100) {
      journeyBeats = [0.3, 0.55, 0.8].map((f) => tSec + duration * f);
      journeyName = name;
    }
  });
  on('warp:end', () => { journeyBeats = []; });
  // The route's chosen sight sweeping past the window — SOLACE names it
  on('cruise:pass', ({ name }) => {
    if (tSec - lastMurmurAt > MURMUR_GAP * 0.4) {
      brainMurmur('waypoint', name, 0, null);
    }
  });
}

/**
 * @param {number} dt — wall-clock seconds
 * @param {{inDive:boolean, hullStress:number}|null} diveState
 */
export function updateCompanion(dt, diveState) {
  tSec += dt;

  // Danger: the dive is the one signal that overrides restraint.
  const diving = !!(diveState && diveState.inDive);
  if (diving) {
    if (restingState() && getCompanionState() !== 'concerned') {
      setCompanionState('concerned');
    }
    if (!diveWarned && (diveState.hullStress || 0) > 20) {
      diveWarned = murmur('dive');
    }
    return;
  }
  if (!diving) {
    if (diveWarned) diveWarned = false;
    if (getCompanionState() === 'concerned' && !afterglow) {
      setCompanionState(orbitName ? 'idle' : 'dormant');
    }
  }

  // Arrival line, a breath after the view settles — WHAT gets said (or
  // whether anything does) depends on the continuity of this place
  if (pendingArrival && tSec >= pendingArrival.at) {
    const { name, kind, gapMs } = pendingArrival;
    pendingArrival = null;
    if (tSec - lastMurmurAt > MURMUR_GAP * 0.4) {
      if (kind === 'first') {
        brainMurmur('arrival', name, 0, 'arrival');
      } else if (kind === 'longAgo') {
        brainMurmur('return', name, gapMs, 'arrivalReturn');
      } else if (kind === 'today' && Math.random() < 0.4) {
        brainMurmur('return', name, gapMs, null); // brain or silence
      }
      // kind === 'recent': silence. We were just here; there is
      // nothing to say, and saying nothing is what continuity means.
    }
  }

  // The cruise rhythm: lines from the deep dark, spaced through the leg
  if (journeyBeats.length && tSec >= journeyBeats[0]) {
    journeyBeats.shift();
    if (tSec - lastMurmurAt > MURMUR_GAP) {
      brainMurmur('journey', journeyName, 0, null); // brain or silence
    }
  }

  // The mask slips: long stillness in the emptiest place we know.
  // Once per session; never remarked upon again.
  if (!maskSlipped && orbitName === 'BOOTES VOID' &&
      tSec - orbitSince > MASK_SLIP_DWELL && restingState()) {
    maskSlipped = true;
    murmur('maskSlip');
    // The wrong-timing stillness arrives AFTER the words fade — held
    // via afterglow so the speech animation isn't stomped.
    afterglow = { key: 'sinister', until: tSec + 32 };
  }

  // Idle musings: only in orbit, only after real stillness, rarely.
  if (orbitName &&
      tSec - lastInputAt > MUSING_IDLE &&
      tSec - lastMusingAt > MUSING_GAP &&
      tSec - lastMurmurAt > MURMUR_GAP &&
      Math.random() < dt * 0.008) { // ~expected once per ~2 min of eligibility
    if (murmur('musing')) lastMusingAt = tSec;
  }

  // Afterglow: once speech has finished and we're back at rest, hold a
  // temperament (pleased after a homecoming) before settling to idle.
  if (afterglow) {
    if (tSec >= afterglow.until) {
      if (getCompanionState() === afterglow.key && afterglow.key !== 'idle') {
        setCompanionState(orbitName ? 'idle' : 'dormant');
      }
      afterglow = null;
    } else if (restingState() && getCompanionState() !== afterglow.key) {
      setCompanionState(afterglow.key);
    }
  }
}
