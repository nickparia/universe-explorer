// js/starmap.js — the star map. "Deep Field" design.
//
// A full-screen 3D spatial chart: every destination rendered as a
// procedural object (shaded planet, ringed Saturn, wispy nebula, spiral
// galaxy…) floating in a drifting star field. Drag to rotate, scroll to
// zoom through three scale tiers (solar system → interstellar →
// galactic), click an object to see its card, then choose the crossing:
// engage the warp yourself, or hand SOLACE the helm for the slow way.
//
// The renderer lives in starmap-engine.js (Canvas-2D, ported from the
// design handoff); the poetic per-destination metadata (kind, one-liner,
// real light-year distances) in starmap-data.js. Live positions, live
// descriptions, and travel itself come from the running sim.

import { getLandmarks, getDeepSpaceObjects } from './deepspace.js';
import { getBodies } from './bodies.js';
import { warpTo, flyTo, cruiseTo, getCamPos } from './flight.js';
import { emit } from './bus.js';
import { AU } from './constants.js';
import { StarMapView, KM_PER_AU } from './starmap-engine.js';
import { DESTINATIONS } from './starmap-data.js';

// ── State ─────────────────────────────────────────────────────────────
let overlayEl = null;
let canvasWrap = null;
let cardEl = null;
let pillEl = null;
let tierEls = null;       // { 'solar system': {dot, label}, ... }
let view = null;          // StarMapView, alive only while the map is open
let active = false;
let pendingOpen = false;  // M pressed before boot finished building the map
let selected = null;      // merged destination shown on the card

// ── Live-world helpers ────────────────────────────────────────────────
function worldPos(item) {
  if (item.g) return item.g.userData?._worldPos || item.g.position;
  return item.pos || null;
}

function nice(name) {
  return name.toLowerCase();
}

function travelSeconds(d) {
  const pos = d.live && worldPos(d.live);
  if (!pos) return 0;
  const dist = getCamPos().distanceTo(pos);
  return d.warps
    ? Math.max(15, Math.min(30, dist / 2000))
    : Math.max(2, Math.min(6, dist / 6000));
}

// Cruise duration mirror of flight.js — minutes, gently distance-scaled
function cruiseMinutes(d) {
  const pos = d.live && worldPos(d.live);
  if (!pos) return 3;
  const dist = getCamPos().distanceTo(pos);
  const dur = Math.min(300, Math.max(150,
    150 + (Math.log10(Math.max(dist, 10000)) - 5) * 45));
  return Math.max(2, Math.round(dur / 60));
}

// Real light-years for landmarks; live camera distance in AU otherwise —
// the ship is wherever the camera is, not pinned to Earth
function distLabelFor(d) {
  if (d.ship) return 'you are here';
  if (d.ly != null) {
    return d.ly >= 1e6 ? (d.ly / 1e6).toFixed(1) + ' MLY'
      : d.ly >= 1000 ? (d.ly / 1000).toFixed(1) + 'K LY'
      : d.ly.toFixed(0) + ' LY';
  }
  const pos = d.live && worldPos(d.live);
  if (!pos) return '';
  const au = getCamPos().distanceTo(pos) / AU;
  if (au < 0.01) return Math.round(au * KM_PER_AU / 1000) + 'K KM';
  return au < 10 ? au.toFixed(2) + ' AU' : au < 100 ? au.toFixed(1) + ' AU' : au.toFixed(0) + ' AU';
}

// ── Destination data: snapshot layout + live sim merged ──────────────
// The snapshot supplies the designed composition (au/angle/phi layout,
// kind, one-liner, real ly distances); the live sim supplies existence,
// descriptions, positions, and travel.
function buildDestinations() {
  const live = {};
  for (const b of getBodies()) live[b.name] = b;
  for (const lm of getLandmarks()) live[lm.name] = lm;

  const out = [];
  for (const meta of DESTINATIONS) {
    const item = live[meta.name];
    if (!item) continue;
    out.push({
      ...meta,
      ship: false,
      desc: item.desc || meta.desc,
      live: item,
      warps: !!item.tier || !!item.visual, // landmarks warp; bodies fly
    });
  }

  // The black hole is its own deep-space object, not in the snapshot
  const bh = getDeepSpaceObjects().find(o => o.isBlackHole);
  if (bh) {
    out.push({
      name: 'BLACK HOLE', type: 'landmark', kind: 'supermassive black hole',
      color: '#ff8800', au: 16000, angle: 2.8, phi: -0.12,
      short: 'a singularity wrapped in burning light',
      desc: bh.desc, live: bh, ship: false, warps: false,
    });
  }

  // "you are here": the destination nearest the ship right now
  let nearest = null, best = Infinity;
  const cam = getCamPos();
  for (const d of out) {
    const pos = d.live && worldPos(d.live);
    if (!pos) continue;
    const dist = cam.distanceTo(pos);
    if (dist < best) { best = dist; nearest = d; }
  }
  if (nearest) nearest.ship = true;

  return out;
}

// ── Travel ────────────────────────────────────────────────────────────
function goWarp(d) {
  toggleStarMap();
  if (d.warps) warpTo(d.name);
  else flyTo(d.name);
}

function goCruise(d) {
  toggleStarMap();
  cruiseTo(d.name);
}

// ── DOM helpers ───────────────────────────────────────────────────────
function el(tag, css, text) {
  const e = document.createElement(tag);
  if (css) e.style.cssText = css;
  if (text != null) e.textContent = text;
  return e;
}

const BTN_CSS =
  'display:inline-block;margin-top:16px;padding:9px 22px;pointer-events:all;' +
  'font-size:10px;letter-spacing:5px;cursor:pointer;color:rgba(120,180,255,0.9);' +
  'background:rgba(120,180,255,0.06);border:1px solid rgba(120,180,255,0.4);' +
  'transition:all 0.3s;white-space:nowrap;';

function makeButton(label) {
  const b = el('div', BTN_CSS, label);
  b.addEventListener('mouseenter', () => {
    b.style.background = 'rgba(120,180,255,0.12)';
    b.style.boxShadow = '0 0 24px rgba(120,180,255,0.3)';
  });
  b.addEventListener('mouseleave', () => {
    b.style.background = 'rgba(120,180,255,0.06)';
    b.style.boxShadow = 'none';
  });
  return b;
}

// ── Info card ─────────────────────────────────────────────────────────
function showCard(d) {
  selected = d;
  if (!d) { cardEl.style.display = 'none'; return; }

  cardEl.innerHTML = '';
  const name = el('div',
    'font-size:22px;letter-spacing:10px;color:rgba(255,255,255,0.95);font-weight:300;' +
    `text-shadow:0 0 20px ${d.color || '#8fd8ff'},0 1px 6px rgba(0,0,0,0.9);`,
    nice(d.name));
  const meta = el('div',
    'font-size:10px;letter-spacing:6px;color:rgba(120,180,255,0.8);margin-top:6px;' +
    'text-shadow:0 1px 4px rgba(0,0,0,0.8);',
    `${d.kind} · ${distLabelFor(d)}`);
  const divider = el('div',
    'width:40px;height:1px;background:rgba(120,180,255,0.25);margin:12px 0;');
  const desc = el('div',
    'font-size:12px;letter-spacing:1.5px;color:rgba(255,255,255,0.68);line-height:2;' +
    'text-shadow:0 1px 6px rgba(0,0,0,0.9);',
    d.desc);

  cardEl.appendChild(name);
  cardEl.appendChild(meta);
  cardEl.appendChild(divider);
  cardEl.appendChild(desc);

  // The crossing chooser — two verbs, a per-journey choice, never a setting
  if (!d.ship) {
    const row = el('div', 'display:flex;gap:10px;flex-wrap:wrap;align-items:baseline;');
    const warpBtn = makeButton(
      (d.warps ? 'engage warp' : 'fly there') + '  ≈ ' + Math.round(travelSeconds(d)) + 's');
    warpBtn.addEventListener('click', () => goWarp(d));
    const cruiseBtn = makeButton('let solace take you  ≈ ' + cruiseMinutes(d) + ' min');
    cruiseBtn.addEventListener('click', () => goCruise(d));
    row.appendChild(warpBtn);
    row.appendChild(cruiseBtn);
    cardEl.appendChild(row);
  }

  cardEl.style.display = 'block';
  // restart the enter animation
  cardEl.style.animation = 'none';
  void cardEl.offsetWidth;
  cardEl.style.animation = 'sm-fadeUp 0.4s ease-out';
}

// ── Tier ribbon ───────────────────────────────────────────────────────
const TIERS = ['solar system', 'interstellar', 'galactic'];

function setTier(t) {
  for (const name of TIERS) {
    const on = name === t;
    tierEls[name].dot.style.background = on ? '#8fd8ff' : 'rgba(140,180,255,0.25)';
    tierEls[name].dot.style.boxShadow = on ? '0 0 8px #8fd8ff' : 'none';
    tierEls[name].label.style.color = on ? 'rgba(220,235,255,0.9)' : 'rgba(180,210,255,0.35)';
  }
}

// ── Init ──────────────────────────────────────────────────────────────
export function initStarMap() {
  // keyframes for the card + hint animations
  const style = document.createElement('style');
  style.textContent = `
    @keyframes sm-fadeUp{0%{opacity:0;transform:translateY(10px)}100%{opacity:1;transform:translateY(0)}}
    @keyframes sm-hintPulse{0%,100%{opacity:0.3}50%{opacity:0.6}}
  `;
  document.head.appendChild(style);

  overlayEl = el('div',
    'position:fixed;inset:0;z-index:68;overflow:hidden;' +
    'background:radial-gradient(ellipse at 50% 45%, #060a16 0%, #03050c 55%, #010208 100%);' +
    "font-family:'Segoe UI','Helvetica Neue',Arial,sans-serif;font-weight:300;" +
    'color:rgba(255,255,255,0.94);' +
    'opacity:0;pointer-events:none;transition:opacity 0.45s ease;');
  overlayEl.id = 'starchart';

  // The map canvas fills the viewport (canvas itself is created fresh on
  // each open — the engine binds input listeners it never unbinds)
  canvasWrap = el('div', 'position:absolute;inset:0;');
  overlayEl.appendChild(canvasWrap);

  // Vignette
  overlayEl.appendChild(el('div',
    'position:absolute;inset:0;pointer-events:none;' +
    'background:radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.5) 100%);'));

  // Wordmark
  const wordmark = el('div',
    'position:absolute;top:30px;left:50%;transform:translateX(-50%);text-align:center;pointer-events:none;');
  wordmark.appendChild(el('div',
    'font-size:12px;letter-spacing:9px;color:rgba(220,235,255,0.85);' +
    'text-shadow:0 0 24px rgba(120,180,255,0.4),0 1px 8px rgba(0,0,0,0.9);',
    'star map'));
  wordmark.appendChild(el('div',
    'font-size:8px;letter-spacing:4px;margin-top:8px;color:rgba(255,255,255,0.3);',
    'press esc to close'));
  overlayEl.appendChild(wordmark);

  // Tier ribbon
  const ribbon = el('div',
    'position:absolute;bottom:28px;left:50%;transform:translateX(-50%);' +
    'display:flex;gap:30px;align-items:center;');
  tierEls = {};
  TIERS.forEach((name, i) => {
    if (i > 0) ribbon.appendChild(el('div', 'width:26px;height:1px;background:rgba(160,200,255,0.15);'));
    const item = el('div', 'display:flex;align-items:center;gap:9px;cursor:pointer;');
    const dot = el('div',
      'width:5px;height:5px;border-radius:50%;background:rgba(140,180,255,0.25);transition:background 0.3s;');
    const label = el('span',
      'font-size:9px;letter-spacing:4px;color:rgba(180,210,255,0.35);transition:color 0.3s;', name);
    item.appendChild(dot);
    item.appendChild(label);
    item.addEventListener('click', () => { if (view) view.zoomTier(name); });
    ribbon.appendChild(item);
    tierEls[name] = { dot, label };
  });
  overlayEl.appendChild(ribbon);

  // Controls hint
  const hint = el('div',
    'position:absolute;bottom:64px;right:28px;font-size:9px;letter-spacing:3px;' +
    'color:rgba(255,255,255,0.3);text-align:right;line-height:2.1;' +
    'animation:sm-hintPulse 4s ease-in-out infinite;pointer-events:none;');
  hint.innerHTML = 'drag to rotate · scroll to zoom<br>click a light to learn more';
  overlayEl.appendChild(hint);

  // Info card
  cardEl = el('div',
    'position:absolute;bottom:70px;left:32px;max-width:400px;padding:22px 26px;' +
    'pointer-events:none;display:none;' +
    'background:linear-gradient(to right, rgba(5,8,16,0.55), transparent);' +
    'backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);');
  overlayEl.appendChild(cardEl);

  document.body.appendChild(overlayEl);

  // Keyboard: M toggles (not while typing), Escape closes
  window.addEventListener('keydown', (e) => {
    const typing = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA');
    if (e.code === 'KeyM' && !typing) {
      e.preventDefault();
      e.stopPropagation();
      toggleStarMap();
    } else if (e.code === 'Escape' && active) {
      e.preventDefault();
      toggleStarMap();
    }
  });

  // Old left-edge rail tab is superseded
  const railTab = document.getElementById('nav-rail-tab');
  if (railTab) railTab.style.display = 'none';

  // ── Star chart pill — bottom-left, clear of the speed readout ──
  pillEl = el('div');
  pillEl.id = 'dest-pill';
  pillEl.innerHTML = '&#10022;&nbsp;&nbsp;star chart&nbsp;&nbsp;<span style="color:rgba(140,180,255,0.55)">m</span>';
  pillEl.style.cssText = `
    position: fixed; bottom: 24px; left: 24px;
    z-index: 66; padding: 10px 22px;
    background: rgba(8,12,22,0.5);
    border: 1px solid rgba(140,180,255,0.2);
    border-radius: 999px;
    backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
    font-family: 'Segoe UI','Helvetica Neue',Arial,sans-serif; font-weight: 300;
    font-size: 10px; letter-spacing: 4px;
    color: rgba(210,225,255,0.75);
    cursor: pointer; user-select: none;
    transition: opacity 0.4s, border-color 0.25s, background 0.25s;
  `;
  pillEl.addEventListener('mouseenter', () => {
    pillEl.style.borderColor = 'rgba(140,180,255,0.5)';
    pillEl.style.background = 'rgba(20,32,55,0.6)';
  });
  pillEl.addEventListener('mouseleave', () => {
    pillEl.style.borderColor = 'rgba(140,180,255,0.2)';
    pillEl.style.background = 'rgba(8,12,22,0.5)';
  });
  pillEl.addEventListener('click', (e) => { e.stopPropagation(); toggleStarMap(); });
  document.body.appendChild(pillEl);

  // M was pressed while the app was still booting — honor it now
  if (pendingOpen) {
    pendingOpen = false;
    toggleStarMap();
  }
}

// Buffer an M pressed before initStarMap has run (boot takes seconds on a
// cold load and "pressed M, nothing happened" reads as broken)
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyM' && !overlayEl &&
      !(e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA'))) {
    pendingOpen = true;
  }
});

// ── Toggle / state ────────────────────────────────────────────────────
export function toggleStarMap() {
  if (!overlayEl) { pendingOpen = true; return; }
  active = !active;
  emit('starmap:toggled', active);
  if (active) {
    canvasWrap.innerHTML = '';
    const canvas = document.createElement('canvas');
    canvas.style.display = 'block';
    canvasWrap.appendChild(canvas);
    view = new StarMapView(canvas, {
      theme: 'natural',
      autoRotate: true,
      background: true,
      rings: true,
      onSelect: (d) => showCard(d),
      onTier: (t) => setTier(t),
    });
    // Distances come from the live camera, not the snapshot's Earth
    view.distLabel = distLabelFor;
    window.__smView = view; // diagnostics, same spirit as getTransitDebug()
    view.setData(buildDestinations());
    setTier(view.tier());
    showCard(null);
    overlayEl.style.opacity = '1';
    overlayEl.style.pointerEvents = 'auto';
    if (pillEl) pillEl.style.opacity = '0';
  } else {
    if (view) { view.destroy(); view = null; }
    overlayEl.style.opacity = '0';
    overlayEl.style.pointerEvents = 'none';
    if (pillEl) pillEl.style.opacity = '1';
  }
}

export function isStarMapOpen() {
  return active;
}

// Kept for main.js API compatibility — the map runs its own rAF loop.
export function updateStarMap() {}
