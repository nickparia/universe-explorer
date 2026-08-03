// ground/telemetry.js — the suit thinks aloud.
//
// A quiet scrolling feed in the guidance-feed school: the EVA suit
// reports itself while you walk (oxygen, integrity, heater, the
// biomonitor watching your pulse rise when you run), and the rover
// reports itself while you drive (battery, motors, cabin). Routine
// lines murmur on a slow cadence; the world interrupts — a gust, a
// dust devil close aboard, sunset committing the heater, the lamp
// thrown, a survey uplinked. Values drift honestly with what the
// traveler is actually doing, but they never manufacture a crisis:
// this is an instrument being alive, not a survival bar.

import { on } from '../bus.js';

const MONO = "'SF Mono','Cascadia Mono','JetBrains Mono',Menlo,Consolas,'Courier New',monospace";
const AMBER = 'rgba(255,186,100,';
const SCAN =
  '-webkit-mask-image:repeating-linear-gradient(0deg,#000 0 2px,rgba(0,0,0,0.65) 2px 3px),' +
  'linear-gradient(to bottom,transparent 0,#000 30%);' +
  '-webkit-mask-composite:source-in;' +
  'mask-image:repeating-linear-gradient(0deg,#000 0 2px,rgba(0,0,0,0.65) 2px 3px),' +
  'linear-gradient(to bottom,transparent 0,#000 30%);' +
  'mask-composite:intersect;';

let feed = null, header = null, list = null;
let offs = [];            // bus unsubscribes
let lastMode = null;
let lineTimer = 3;        // first routine line lands quickly
let rot = 0;              // rotation index through the routine set
let cool = {};            // event cooldowns by key
let wasNight = null;

// ── The instruments' state — drifts with real behavior ───────────────
const V = {
  o2: 97.2, integ: 100, hr: 64, sbat: 92, scrub: 12,   // the suit
  rbat: 84, motor: 21, cabin: 20.9, bus: 28.4,          // the rover
};

function line(text, bright) {
  if (!list) return;
  const el = document.createElement('div');
  el.textContent = text;
  el.style.cssText =
    'font-size:10px;letter-spacing:1.8px;line-height:1.9;white-space:pre;' +
    (bright
      ? `color:${AMBER}0.88);text-shadow:0 0 8px rgba(255,160,60,0.4),0 1px 3px rgba(0,0,0,0.9);`
      : `color:${AMBER}0.48);text-shadow:0 1px 3px rgba(0,0,0,0.9);`);
  list.appendChild(el);
  while (list.children.length > 8) list.removeChild(list.firstChild);
}

// An event speaks at most once per cooldown window
function event(key, seconds, text) {
  const now = performance.now();
  if (cool[key] && now - cool[key] < seconds * 1000) return;
  cool[key] = now;
  line(text, true);
}

const j = (v, d = 1) => (v + (Math.random() - 0.5) * 0.12).toFixed(d);

export function initTelemetry() {
  feed = document.createElement('div');
  feed.style.cssText =
    `position:fixed;left:22px;top:150px;width:236px;z-index:46;pointer-events:none;` +
    `font-family:${MONO};opacity:0.92;transition:top 0.5s,bottom 0.5s;${SCAN}`;
  header = document.createElement('div');
  header.style.cssText =
    `font-size:9px;letter-spacing:4px;color:${AMBER}0.4);` +
    `border-bottom:1px solid ${AMBER}0.2);padding-bottom:3px;margin-bottom:4px;`;
  header.textContent = 'EVA-1 // SUIT FEED';
  feed.appendChild(header);
  list = document.createElement('div');
  feed.appendChild(list);
  document.body.appendChild(feed);

  lastMode = null; rot = 0; lineTimer = 3; cool = {}; wasNight = null;
  V.o2 = 96.4 + Math.random() * 1.6;
  V.integ = 100; V.hr = 64; V.sbat = 90 + Math.random() * 6;
  V.rbat = 80 + Math.random() * 10;

  // The world interrupts the routine murmur
  offs = [
    on('lamp:switched', ({ on: isOn }) =>
      event('lamp', 1, isOn ? '>> LAMP ON · BEAM NOMINAL' : '>> LAMP OFF · DARK ADAPT')),
    on('stake:planted', ({ n }) =>
      event('stake', 1, `>> SURVEY S${n} UPLINK · 1.0 KM VERIFIED`)),
    on('stake:uprooted', ({ n }) =>
      event('unstake', 1, `>> SURVEY S${n} RECOVERED · CHART HOLDS`)),
  ];
}

export function disposeTelemetry() {
  for (const off of offs) off();
  offs = [];
  if (feed && feed.parentNode) feed.parentNode.removeChild(feed);
  feed = null; header = null; list = null;
}

// The routine reports, in each register. Each entry returns one line.
const SUIT_ROT = [
  () => `O2 PRI ${V.o2.toFixed(1)}% · FLOW NOM`,
  () => `PRESS 0.31 BAR · INTEG ${V.integ.toFixed(0)}%`,
  (s) => `HEATER ${heaterPct(s)}% · CORE 36.${(5 + Math.random() * 3) | 0}°C`,
  () => `BIOMON HR ${Math.round(V.hr)} BPM`,
  () => `CO2 SCRUB ${V.scrub.toFixed(0)}% SAT`,
  () => `BATT ${V.sbat.toFixed(0)}% · ${(38 + Math.random() * 9) | 0} W DRAW`,
  (s) => `EXT ${s.tempC}°C · RAD 0.${(2 + Math.random() * 2) | 0} MSV NOM`,
];
const ROVER_ROT = [
  () => `BATT ${V.rbat.toFixed(0)}% · BUS ${j(V.bus)} V`,
  () => `MOTOR FL ${V.motor.toFixed(0)}°C FR ${(V.motor + 1 + Math.random() * 2).toFixed(0)}°C`,
  () => `CABIN 0.68 BAR · O2 ${j(V.cabin)}%`,
  () => `CHASSIS NOM · SUSP TRAVEL OK`,
  () => `TIRE PRESS NOM ×4`,
  (s) => `EXT ${s.tempC}°C · HULL ΔT NOM`,
];

function heaterPct(s) {
  return Math.round(Math.min(96, Math.max(8, (2 - s.tempC) * 0.72)));
}

export function updateTelemetry(dt, s) {
  if (!feed) return;
  const roving = s.mode === 'rove';

  // The feed docks where the register lives: under the suit readout
  // afoot; stacked above the drive cluster in the cab.
  if (s.mode !== lastMode) {
    lastMode = s.mode;
    header.textContent = roving ? 'MRV-01 // TELEMETRY' : 'EVA-1 // SUIT FEED';
    if (roving) {
      feed.style.top = ''; feed.style.bottom = '238px'; feed.style.left = '26px';
    } else {
      feed.style.bottom = ''; feed.style.top = '150px'; feed.style.left = '22px';
    }
  }

  // ── the instruments drift with what the body is doing ──
  const effort = s.speed * (roving ? 0.02 : 0.35) + (s.run ? 0.8 : 0);
  V.o2 = Math.max(64, V.o2 - dt * (0.004 + effort * 0.004) * (roving ? 0.25 : 1));
  V.sbat = Math.max(40, V.sbat - dt * 0.006);
  V.scrub = Math.min(60, V.scrub + dt * 0.01);
  const hrTarget = roving ? 68 + s.speed * 0.4 : 62 + s.speed * 5 + (s.run ? 24 : 0) + (s.devil || 0) * 18;
  V.hr += (hrTarget - V.hr) * Math.min(1, dt * 0.25);
  if (roving) {
    V.rbat = Math.max(30, V.rbat - dt * (0.003 + s.speed * 0.0011));
    const mT = 21 + s.speed * 1.8 + (s.run ? 9 : 0);
    V.motor += (mT - V.motor) * Math.min(1, dt * 0.1);
  } else {
    V.motor += (21 - V.motor) * Math.min(1, dt * 0.03);
  }
  // Grit wears the shell, imperceptibly — and only in real weather
  if (s.gust > 0.8) V.integ = Math.max(97.2, V.integ - dt * 0.002);

  // ── the world interrupts ──
  if (s.gust > 0.78) {
    event('gust', 45, `>> GUST ${(8 + s.gust * 11).toFixed(0)} M/S · ${roving ? 'TRIM HOLDS' : 'SEAL NOMINAL'}`);
  }
  if ((s.devil || 0) > 0.4) {
    event('devil', 60, '>> PARTICULATE SURGE · VORTEX CLOSE ABOARD');
  }
  const night = s.sunElev < 1.0;
  if (wasNight === null) wasNight = night;
  else if (night !== wasNight) {
    wasNight = night;
    event('sol', 120, night
      ? '>> SUNSET · THERMAL LOAD COMMITTED'
      : '>> SUNRISE · SOLAR TRICKLE RESUMES');
  }
  if (s.nearStake) {
    event('srv', 90, `>> SURVEY S${s.nearStake.n} CARRIER LOCK`);
  }

  // ── the routine murmur, on its slow cadence ──
  lineTimer -= dt;
  if (lineTimer <= 0) {
    lineTimer = 4.5 + Math.random() * 3.5;
    const set = roving ? ROVER_ROT : SUIT_ROT;
    line(set[rot % set.length](s), false);
    rot++;
  }
}
