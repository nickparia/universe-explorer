// js/starmap.js — the star map. "Navigator" design (second handoff).
//
// A two-pane navigator: the destination catalog on the left — grouped
// by section, poetic one-liners, live distances — and the full 3D
// spatial chart on the right. Hovering a row lights the object in
// space; clicking a row (or an object in the map) selects it, flies
// the map camera to it, and raises a selection bar with the full
// description and the crossing chooser: engage the warp yourself, or
// hand SOLACE the helm for the slow way (both verbs — a per-journey
// choice, never a setting).
//
// The renderer lives in starmap-engine.js (Canvas-2D, ported verbatim
// from the handoff); poetic metadata (kind, one-liner, real light-year
// distances) in starmap-data.js. Live positions, live descriptions,
// and travel itself come from the running sim.

import { getLandmarks, getDeepSpaceObjects } from './deepspace.js';
import { getBodies } from './bodies.js';
import { warpTo, flyTo, cruiseTo, getCamPos } from './flight.js';
import { emit } from './bus.js';
import { AU } from './constants.js';
import { StarMapView, KM_PER_AU } from './starmap-engine.js';
import { DESTINATIONS, SECTIONS } from './starmap-data.js';

// ── State ─────────────────────────────────────────────────────────────
let overlayEl = null;
let canvasWrap = null;
let listEl = null;        // the scrolling catalog
let selBarEl = null;      // selection bar, bottom of the viewport
let tierEl = null;        // live tier word in the wordmark subtitle
let pillEl = null;
let view = null;          // StarMapView, alive only while the map is open
let active = false;
let pendingOpen = false;  // M pressed before boot finished building the map
let selected = null;
let rowEls = {};          // name -> row element (hover/selected styling)

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
  'padding:9px 22px;flex-shrink:0;font-size:10px;letter-spacing:5px;' +
  'cursor:pointer;color:rgba(120,180,255,0.9);background:rgba(120,180,255,0.06);' +
  'border:1px solid rgba(120,180,255,0.4);transition:all 0.3s;white-space:nowrap;';

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

// ── Selection (bar + row highlight, list↔map two-way) ────────────────
function styleRow(name, state) {
  const r = rowEls[name];
  if (!r) return;
  r.style.background = state === 'sel' ? 'rgba(120,180,255,0.10)'
    : state === 'hov' ? 'rgba(120,180,255,0.06)' : 'transparent';
  r.style.borderLeftColor = state === 'sel' ? 'rgba(120,180,255,0.7)' : 'transparent';
}

function showSelection(d) {
  if (selected && (!d || d.name !== selected.name)) styleRow(selected.name, null);
  selected = d;
  if (!d) { selBarEl.style.display = 'none'; return; }
  styleRow(d.name, 'sel');

  // Bring the row into view if the catalog has it scrolled away
  const r = rowEls[d.name];
  if (r && listEl) {
    const top = r.offsetTop - listEl.offsetTop;
    if (top < listEl.scrollTop || top > listEl.scrollTop + listEl.clientHeight - 60) {
      listEl.scrollTop = top - listEl.clientHeight / 2;
    }
  }

  selBarEl.innerHTML = '';
  selBarEl.appendChild(el('div',
    'width:12px;height:12px;border-radius:50%;flex-shrink:0;' +
    `background:${d.color};box-shadow:0 0 16px ${d.color};`));
  const mid = el('div', 'flex:1;min-width:0;');
  const nameRow = el('div', 'display:flex;align-items:baseline;gap:14px;');
  nameRow.appendChild(el('span',
    'font-size:16px;letter-spacing:6px;color:rgba(255,255,255,0.95);', nice(d.name)));
  nameRow.appendChild(el('span',
    'font-size:9px;letter-spacing:4px;color:rgba(120,180,255,0.75);', d.kind || ''));
  mid.appendChild(nameRow);
  mid.appendChild(el('div',
    'font-size:10px;letter-spacing:1.5px;margin-top:5px;color:rgba(255,255,255,0.5);' +
    'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;', d.desc || d.short || ''));
  selBarEl.appendChild(mid);
  selBarEl.appendChild(el('div',
    'font-size:10px;letter-spacing:2px;color:rgba(160,200,255,0.7);white-space:nowrap;',
    distLabelFor(d).toLowerCase()));

  // The crossing chooser — two verbs, a per-journey choice
  if (!d.ship) {
    const warpBtn = makeButton(
      (d.warps ? 'engage warp' : 'fly there') + ' ≈ ' + Math.round(travelSeconds(d)) + 's');
    warpBtn.addEventListener('click', () => goWarp(d));
    selBarEl.appendChild(warpBtn);
    const cruiseBtn = makeButton('let solace take you ≈ ' + cruiseMinutes(d) + ' min');
    cruiseBtn.addEventListener('click', () => goCruise(d));
    selBarEl.appendChild(cruiseBtn);
  }

  selBarEl.style.display = 'flex';
  selBarEl.style.animation = 'none';
  void selBarEl.offsetWidth;
  selBarEl.style.animation = 'sm-fadeUp 0.3s ease-out';
}

// ── The catalog (left pane) ───────────────────────────────────────────
function buildList(dests) {
  listEl.innerHTML = '';
  rowEls = {};
  const byName = {};
  for (const d of dests) byName[d.name] = d;

  // The black hole rides with the galaxies
  const sections = SECTIONS.map((s) =>
    s.title === 'galaxies & voids'
      ? { ...s, names: [...s.names, 'BLACK HOLE'] }
      : s);

  for (const sec of sections) {
    const items = sec.names.map((n) => byName[n]).filter(Boolean);
    if (!items.length) continue;
    const wrap = el('div', 'margin:28px 0 6px;');
    wrap.appendChild(el('div',
      'font-size:10px;letter-spacing:5px;padding-bottom:12px;margin-bottom:4px;' +
      'border-bottom:1px solid rgba(255,255,255,0.06);' +
      `color:${sec.featured ? 'rgba(255,220,120,0.7)' : 'rgba(160,200,255,0.55)'};`,
      sec.title));
    for (const d of items) {
      const row = el('div',
        'display:flex;align-items:center;gap:16px;padding:11px 12px;cursor:pointer;' +
        'border-radius:2px;border-left:2px solid transparent;' +
        'transition:background 0.15s,border-color 0.15s;');
      row.appendChild(el('div',
        'width:10px;height:10px;border-radius:50%;flex-shrink:0;' +
        `background:${d.color};box-shadow:0 0 12px ${d.color};`));
      const mid = el('div', 'flex:1;min-width:0;');
      mid.appendChild(el('div',
        'font-size:13px;letter-spacing:3px;color:rgba(255,255,255,0.92);', nice(d.name)));
      mid.appendChild(el('div',
        'font-size:9px;letter-spacing:1.2px;margin-top:3px;color:rgba(200,220,255,0.4);' +
        'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;', d.short || ''));
      row.appendChild(mid);
      row.appendChild(el('div',
        'font-size:9px;letter-spacing:1.5px;color:rgba(160,200,255,0.55);' +
        'white-space:nowrap;flex-shrink:0;', distLabelFor(d).toLowerCase()));

      row.addEventListener('mouseenter', () => {
        if (view) view.highlight(d.name);
        if (!selected || selected.name !== d.name) styleRow(d.name, 'hov');
      });
      row.addEventListener('mouseleave', () => {
        if (view) view.highlight(null);
        if (!selected || selected.name !== d.name) styleRow(d.name, null);
      });
      row.addEventListener('click', () => {
        if (!view) return;
        showSelection(view.select(d.name));
      });

      // Only the first appearance of a name owns the styled row ref
      // (EARTH etc. appear in both "start here" and their own section)
      if (!rowEls[d.name]) rowEls[d.name] = row;
      wrap.appendChild(row);
    }
    listEl.appendChild(wrap);
  }
}

// ── Init ──────────────────────────────────────────────────────────────
export function initStarMap() {
  const style = document.createElement('style');
  style.textContent = `
    @keyframes sm-fadeUp{0%{opacity:0;transform:translateY(8px)}100%{opacity:1;transform:translateY(0)}}
    #sm-list::-webkit-scrollbar{width:6px}
    #sm-list::-webkit-scrollbar-thumb{background:rgba(160,200,255,0.25);border-radius:3px}
  `;
  document.head.appendChild(style);

  overlayEl = el('div',
    'position:fixed;inset:0;z-index:68;overflow:hidden;background:#04060c;' +
    'display:grid;grid-template-columns:380px 1fr;' +
    "font-family:'Segoe UI','Helvetica Neue',Arial,sans-serif;font-weight:300;" +
    'color:rgba(255,255,255,0.94);' +
    'opacity:0;pointer-events:none;transition:opacity 0.45s ease;');
  overlayEl.id = 'starchart';

  // ── Left: the catalog ──
  const left = el('div',
    'display:flex;flex-direction:column;overflow:hidden;' +
    'background:rgba(8,10,18,0.92);border-right:1px solid rgba(160,200,255,0.15);' +
    'box-shadow:4px 0 40px rgba(0,0,0,0.55);');
  const header = el('div',
    'flex-shrink:0;padding:26px 28px 18px;border-bottom:1px solid rgba(255,255,255,0.06);');
  header.appendChild(el('div',
    'font-size:11px;letter-spacing:7px;color:rgba(200,220,255,0.75);', 'destinations'));
  header.appendChild(el('div',
    'font-size:9px;letter-spacing:3px;margin-top:6px;color:rgba(255,255,255,0.35);',
    'click to target · distances from your position'));
  left.appendChild(header);
  listEl = el('div',
    'flex:1;overflow-y:auto;overflow-x:hidden;padding:10px 16px 60px;' +
    'scrollbar-width:thin;scrollbar-color:rgba(160,200,255,0.25) transparent;');
  listEl.id = 'sm-list';
  left.appendChild(listEl);
  overlayEl.appendChild(left);

  // ── Right: the map viewport ──
  const right = el('div',
    'position:relative;overflow:hidden;' +
    'background:radial-gradient(ellipse at 50% 45%, #070b16 0%, #03050c 60%, #010208 100%);');
  canvasWrap = el('div', 'position:absolute;inset:0;');
  right.appendChild(canvasWrap);

  const wordmark = el('div', 'position:absolute;top:24px;left:28px;pointer-events:none;');
  wordmark.appendChild(el('div',
    'font-size:12px;letter-spacing:8px;color:rgba(220,235,255,0.85);' +
    'text-shadow:0 0 20px rgba(120,180,255,0.4);', 'star map'));
  const sub = el('div',
    'font-size:9px;letter-spacing:3px;margin-top:7px;color:rgba(180,210,255,0.35);');
  tierEl = el('span', '', 'solar system');
  sub.appendChild(tierEl);
  sub.appendChild(document.createTextNode(' view · drag to rotate · scroll to zoom · esc closes'));
  wordmark.appendChild(sub);
  right.appendChild(wordmark);

  selBarEl = el('div',
    'position:absolute;left:28px;right:28px;bottom:22px;display:none;' +
    'align-items:center;gap:22px;padding:16px 22px;' +
    'background:rgba(8,12,20,0.7);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);' +
    'border:1px solid rgba(160,200,255,0.18);');
  right.appendChild(selBarEl);
  overlayEl.appendChild(right);

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
    // Fresh canvas per open — the engine binds listeners it never unbinds
    canvasWrap.innerHTML = '';
    const canvas = document.createElement('canvas');
    canvas.style.display = 'block';
    canvasWrap.appendChild(canvas);
    view = new StarMapView(canvas, {
      theme: 'natural',
      autoRotate: true,
      background: true,
      rings: true,
      onSelect: (d) => showSelection(d),
      onTier: (t) => { if (tierEl) tierEl.textContent = t; },
    });
    // Distances come from the live camera, not the snapshot's Earth
    view.distLabel = distLabelFor;
    window.__smView = view; // diagnostics
    const dests = buildDestinations();
    view.setData(dests);
    buildList(dests);
    if (tierEl) tierEl.textContent = view.tier();
    selected = null;
    selBarEl.style.display = 'none';
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
