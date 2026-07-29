// fieldnotes.js — ambient narration while orbiting.
//
// Instead of a static info card, the location's facts and lore drip in one
// line at a time with documentary pacing: fade in, hold, fade out, silence,
// next. Orbiting longer keeps revealing more. Content comes straight from
// the catalog (deep-space locations) or planetconfig (planets, moons,
// spacecraft) — adding notes to a location is a data change, not code.

import { on } from './bus.js';
import { getLocation } from './catalog.js';
import { getPlanetConfig } from './planetconfig.js';

const FIRST_DELAY = 4500;   // ms after arriving before the first note
const FADE = 1800;          // ms fade in/out (matches CSS transition)
const HOLD = 12000;         // ms a note stays readable
const GAP = 6000;           // ms of silence between notes

let el = null;
let deck = [];
let idx = 0;
let timers = [];

export function initFieldNotes() {
  el = document.createElement('div');
  el.id = 'field-notes';
  el.style.cssText =
    'position:fixed;top:12%;left:50%;transform:translateX(-50%);z-index:40;' +
    'max-width:560px;width:80vw;text-align:center;pointer-events:none;' +
    "font-family:'Segoe UI','Helvetica Neue',Arial,sans-serif;font-weight:300;" +
    'font-size:12px;letter-spacing:2.5px;line-height:2.1;' +
    'color:rgba(205,225,255,0.6);text-shadow:0 0 2px rgba(0,0,0,0.85),0 0 2px rgba(0,0,0,0.85),0 1px 3px rgba(0,0,0,0.95),0 0 14px rgba(0,0,0,0.6);' +
    `opacity:0;transition:opacity ${FADE}ms ease;`;
  document.body.appendChild(el);

  on('orbit:enter', ({ name }) => start(name));
  on('orbit:exit', stop);

  // Helm whispers — their own element so they never fight the deck
  const helmEl = document.createElement('div');
  helmEl.style.cssText = el.style.cssText;
  helmEl.style.top = 'auto';
  helmEl.style.bottom = '10%';
  helmEl.style.fontSize = '11px';
  document.body.appendChild(helmEl);
  let helmTimer = null;
  const whisper = (text) => {
    helmEl.textContent = text;
    helmEl.style.opacity = '1';
    if (helmTimer) clearTimeout(helmTimer);
    helmTimer = setTimeout(() => { helmEl.style.opacity = '0'; }, 5000);
  };
  on('autopilot:engaged', () => whisper('\u2014 solace has the helm \u2014'));
  on('autopilot:released', () => whisper('\u2014 helm yours \u2014'));
  // The plotted course, stated as the ship's log would: quiet fact
  on('warp:start', ({ mode, via }) => {
    if (mode === 'cruise' && via && via.length) {
      whisper('\u2014 course laid in \u00b7 via ' + via.join(' \u00b7 ').toLowerCase() + ' \u2014');
    }
  });
}

function buildDeck(name) {
  const lines = [];
  const loc = getLocation(name);
  const cfg = getPlanetConfig(name);
  const info = (loc && loc.info) || (cfg && cfg.info) || null;
  if (info) {
    if (info.type) lines.push(info.type.toLowerCase());
    if (info.facts) for (const f of info.facts) lines.push(f);
    if (info.lore) lines.push(info.lore);
  } else if (loc && loc.desc) {
    lines.push(loc.desc);
  }
  return lines;
}

function start(name) {
  stop();
  deck = buildDeck(name);
  idx = 0;
  if (deck.length === 0) return;
  timers.push(setTimeout(showNext, FIRST_DELAY));
}

function showNext() {
  if (deck.length === 0) return;
  el.textContent = deck[idx % deck.length];
  idx++;
  el.style.opacity = '1';
  timers.push(setTimeout(() => {
    el.style.opacity = '0';
    timers.push(setTimeout(showNext, FADE + GAP));
  }, FADE + HOLD));
}

function stop() {
  for (const t of timers) clearTimeout(t);
  timers = [];
  deck = [];
  if (el) el.style.opacity = '0';
}
