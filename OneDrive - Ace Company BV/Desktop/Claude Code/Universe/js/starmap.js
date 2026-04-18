// js/starmap.js — Navigation catalog overlay (replaces the old 3D map)
//
// A clean, browseable, sectioned list of every destination in the
// universe. No spatial rendering, no overlapping labels — just a
// scannable catalog with names, short descriptions, and distances.
// Sections: Start Here → Planets → Moons → Spacecraft → Landmarks.
// Designed for the "chill Solace" aesthetic: quiet, readable, calm.

import { getLandmarks, getDeepSpaceObjects } from './deepspace.js';
import { getBodies } from './bodies.js';
import { warpTo, flyTo } from './flight.js';
import { AU } from './constants.js';

// ── Destination metadata ────────────────────────────────────────────────
// Body colors and one-line descriptions for the catalog. Anything not
// listed here falls back to a grey dot and the body's own description.
const BODY_META = {
  SUN:      { color: '#ffdd66', desc: 'our star — where all this begins' },
  MERCURY:  { color: '#b0a090', desc: 'the smallest planet, scarred by craters' },
  VENUS:    { color: '#d9b56a', desc: 'shrouded in permanent clouds' },
  EARTH:    { color: '#4a9cff', desc: 'our pale blue dot' },
  MOON:     { color: '#cccccc', desc: 'earth\u2019s tidally-locked companion' },
  MARS:     { color: '#c15a3b', desc: 'the red planet' },
  JUPITER:  { color: '#d9a566', desc: 'gas giant king of the solar system' },
  SATURN:   { color: '#e8cc88', desc: 'crowned by an icy ring system' },
  URANUS:   { color: '#88cce0', desc: 'tilted on its side — an ice giant' },
  NEPTUNE:  { color: '#4466d0', desc: 'the farthest ice giant, wind-torn' },
  PLUTO:    { color: '#b0a090', desc: 'distant dwarf, heart of ice' },
  CERES:    { color: '#888888', desc: 'largest body in the asteroid belt' },
  ERIS:     { color: '#ccddee', desc: 'icy dwarf planet at the edge' },
};

const CRAFT_NAMES = new Set(['ISS','HUBBLE','JWST','NEW HORIZONS','VOYAGER 1','VOYAGER 2']);
const MOON_NAMES = new Set([
  'MOON','PHOBOS','DEIMOS','IO','EUROPA','GANYMEDE','CALLISTO',
  'TITAN','ENCELADUS','MIMAS','TITANIA','OBERON','TRITON',
]);

const CRAFT_META = {
  'VOYAGER 1':    { color: '#ffeedd', desc: 'humanity\u2019s furthest emissary, 1977' },
  'VOYAGER 2':    { color: '#ffeedd', desc: 'only spacecraft to visit all four gas giants' },
  'NEW HORIZONS': { color: '#ddddff', desc: 'first visit to pluto, 2015' },
  'JWST':         { color: '#ffdd66', desc: 'infrared eye on the early universe' },
  'HUBBLE':       { color: '#ccddff', desc: 'deep-field pioneer, since 1990' },
  'ISS':          { color: '#ffffff', desc: 'our home in low earth orbit' },
};

// "Start Here" picks — a curated handful for first-time users
const START_HERE = ['EARTH', 'SUN', 'SATURN', 'JUPITER'];

// ── State ─────────────────────────────────────────────────────────────
let overlayEl = null;
let listEl = null;
let active = false;

// ── Init ──────────────────────────────────────────────────────────────
export function initStarMap() {
  // The catalog lives in a left-side drawer (not a full-screen overlay)
  // so the scene stays visible behind it. Slides in/out from the edge.
  overlayEl = document.createElement('div');
  overlayEl.id = 'catalog';
  overlayEl.style.cssText = `
    position: fixed;
    top: 0; bottom: 0;
    left: 0;
    width: 420px;
    max-width: 90vw;
    z-index: 68;
    background: rgba(8,10,18,0.88);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    border-right: 1px solid rgba(160,200,255,0.15);
    box-shadow: 4px 0 40px rgba(0,0,0,0.55);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    font-family: 'Segoe UI','Helvetica Neue',Arial,sans-serif;
    font-weight: 300;
    color: rgba(255,255,255,0.94);
    transform: translateX(-100%);
    transition: transform 0.42s cubic-bezier(0.22, 0.8, 0.3, 1);
  `;

  // Header (fixed at top of drawer)
  const header = document.createElement('div');
  header.style.cssText = `
    flex-shrink: 0;
    padding: 26px 28px 18px;
    border-bottom: 1px solid rgba(255,255,255,0.06);
    position: relative;
  `;
  header.innerHTML = `
    <div style="font-size:11px;letter-spacing:7px;color:rgba(200,220,255,0.75);
         text-shadow:0 1px 6px rgba(0,0,0,0.9)">destinations</div>
    <div style="font-size:9px;letter-spacing:3px;margin-top:6px;
         color:rgba(255,255,255,0.35)">press esc to close</div>
  `;
  // Close button (X) in the header
  const closeBtn = document.createElement('div');
  closeBtn.innerHTML = '&times;';
  closeBtn.style.cssText = `
    position: absolute; top: 22px; right: 22px;
    width: 28px; height: 28px;
    display: flex; align-items: center; justify-content: center;
    font-size: 22px; line-height: 1;
    color: rgba(255,255,255,0.45);
    cursor: pointer;
    transition: color 0.2s;
    border-radius: 50%;
  `;
  closeBtn.addEventListener('mouseenter', () => {
    closeBtn.style.color = 'rgba(255,255,255,0.95)';
    closeBtn.style.background = 'rgba(255,255,255,0.06)';
  });
  closeBtn.addEventListener('mouseleave', () => {
    closeBtn.style.color = 'rgba(255,255,255,0.45)';
    closeBtn.style.background = 'transparent';
  });
  closeBtn.addEventListener('click', () => toggleStarMap());
  header.appendChild(closeBtn);
  overlayEl.appendChild(header);

  // Scrollable list body
  const scrollWrap = document.createElement('div');
  scrollWrap.style.cssText = `
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 16px 20px 60px;
  `;
  // Custom scrollbar styling (webkit only, but gracefully no-ops elsewhere)
  scrollWrap.style.scrollbarWidth = 'thin';
  scrollWrap.style.scrollbarColor = 'rgba(160,200,255,0.25) transparent';

  listEl = document.createElement('div');
  scrollWrap.appendChild(listEl);
  overlayEl.appendChild(scrollWrap);

  document.body.appendChild(overlayEl);

  // Keyboard: M toggles, Escape closes
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyM') {
      e.preventDefault();
      e.stopPropagation();
      toggleStarMap();
    } else if (e.code === 'Escape' && active) {
      e.preventDefault();
      toggleStarMap();
    }
  });
}

// ── Building the list ─────────────────────────────────────────────────
function buildList() {
  listEl.innerHTML = '';

  const bodies = getBodies();
  const landmarks = getLandmarks();
  const byName = {};
  for (const b of bodies) byName[b.name] = b;

  // ── Start Here ──
  addSection('★ start here', START_HERE.map(n => byName[n]).filter(Boolean), { featured: true });

  // ── Planets (+ Sun up top, explicit order) ──
  const planetOrder = ['SUN','MERCURY','VENUS','EARTH','MARS','JUPITER','SATURN','URANUS','NEPTUNE','PLUTO'];
  addSection('planets', planetOrder.map(n => byName[n]).filter(Boolean));

  // ── Dwarf planets ──
  const dwarfs = ['CERES','ERIS'].map(n => byName[n]).filter(Boolean);
  if (dwarfs.length) addSection('dwarf planets', dwarfs);

  // ── Moons ──
  const moons = bodies.filter(b => MOON_NAMES.has(b.name));
  if (moons.length) addSection('moons', moons);

  // ── Spacecraft ──
  const craft = bodies.filter(b => CRAFT_NAMES.has(b.name));
  if (craft.length) addSection('spacecraft', craft);

  // ── Stellar landmarks (nebulae, stars, magnetars) ──
  const stellar = landmarks.filter(l => l.tier === 'interstellar');
  if (stellar.length) addSection('nebulae & stars', stellar, { isLandmark: true });

  // ── Galactic landmarks (galaxies, voids, supermassive BHs) ──
  const galactic = landmarks.filter(l => l.tier === 'intergalactic');
  if (galactic.length) addSection('galaxies & voids', galactic, { isLandmark: true });
}

function addSection(title, items, opts = {}) {
  if (!items || items.length === 0) return;

  const section = document.createElement('div');
  section.style.cssText = 'margin: 38px 0 10px;';

  const titleEl = document.createElement('div');
  titleEl.textContent = title;
  titleEl.style.cssText = `
    font-size: 10px; letter-spacing: 5px;
    color: ${opts.featured ? 'rgba(255,220,120,0.7)' : 'rgba(160,200,255,0.55)'};
    padding-bottom: 14px; margin-bottom: 6px;
    border-bottom: 1px solid rgba(255,255,255,0.06);
    text-shadow: 0 1px 4px rgba(0,0,0,0.9);
  `;
  section.appendChild(titleEl);

  for (const item of items) {
    section.appendChild(buildRow(item, opts));
  }

  listEl.appendChild(section);
}

function buildRow(item, opts = {}) {
  const isLandmark = !!opts.isLandmark || !!item.isLandmark;
  const name = item.name;

  // Friendly name: "Voyager 1" not "VOYAGER 1"
  const nice = name.split(' ').map(p => p.charAt(0) + p.slice(1).toLowerCase()).join(' ');

  // Pick color + description from our metadata, then fall back
  let color = '#9bb8dd';
  let desc = item.desc || '';
  if (BODY_META[name]) { color = BODY_META[name].color; desc = BODY_META[name].desc; }
  else if (CRAFT_META[name]) { color = CRAFT_META[name].color; desc = CRAFT_META[name].desc; }
  else if (isLandmark) { color = item.tier === 'intergalactic' ? '#b0d4ff' : '#7a9fc8'; }
  // Trim long landmark descriptions to one line's worth
  if (desc && desc.length > 90) desc = desc.slice(0, 87).replace(/\s+\S*$/, '') + '…';

  const row = document.createElement('div');
  row.style.cssText = `
    display: flex; align-items: center; gap: 18px;
    padding: 14px 14px;
    cursor: pointer;
    border-radius: 2px;
    transition: background 0.15s, padding-left 0.15s;
  `;
  row.addEventListener('mouseenter', () => {
    row.style.background = 'rgba(120,180,255,0.08)';
    row.style.paddingLeft = '22px';
  });
  row.addEventListener('mouseleave', () => {
    row.style.background = 'transparent';
    row.style.paddingLeft = '14px';
  });
  row.addEventListener('click', () => onSelect(item, isLandmark));

  // Colored dot (glowing)
  const dot = document.createElement('div');
  dot.style.cssText = `
    width: 12px; height: 12px; border-radius: 50%;
    background: ${color};
    box-shadow: 0 0 14px ${color}, 0 0 4px ${color};
    flex-shrink: 0;
  `;
  row.appendChild(dot);

  // Name + description
  const info = document.createElement('div');
  info.style.cssText = 'flex: 1; min-width: 0;';
  info.innerHTML = `
    <div style="font-size:15px;letter-spacing:3px;color:rgba(255,255,255,0.94);
         text-shadow:0 1px 3px rgba(0,0,0,0.9)">${nice.toLowerCase()}</div>
    ${desc ? `<div style="font-size:10px;letter-spacing:1.5px;margin-top:4px;
         color:rgba(200,220,255,0.42);overflow:hidden;text-overflow:ellipsis;
         white-space:nowrap">${desc}</div>` : ''}
  `;
  row.appendChild(info);

  // Distance (computed live when the catalog opens — good enough)
  const distEl = document.createElement('div');
  distEl.style.cssText = `
    font-size: 10px; letter-spacing: 2px;
    color: rgba(160,200,255,0.55);
    white-space: nowrap; flex-shrink: 0;
  `;
  distEl.textContent = formatDistance(item);
  row.appendChild(distEl);

  return row;
}

function formatDistance(item) {
  // Get the body's world position
  let pos;
  if (item.g) {
    pos = item.g.userData?._worldPos || item.g.position;
  } else if (item.pos) {
    pos = item.pos;
  } else {
    return '';
  }
  const auDist = pos.length() / AU;
  if (auDist < 0.01) return Math.round(pos.length() * 50) + ' K km';
  if (auDist < 1) return auDist.toFixed(2) + ' AU';
  if (auDist < 1000) return auDist.toFixed(auDist < 10 ? 1 : 0) + ' AU';
  const ly = auDist / 63241;
  if (ly < 1000) return ly.toFixed(ly < 10 ? 1 : 0) + ' LY';
  return (ly / 1e6).toFixed(1) + ' MLY';
}

function onSelect(item, isLandmark) {
  toggleStarMap(); // close
  if (isLandmark || item.isLandmark) {
    warpTo(item.name);
  } else {
    flyTo(item.name);
  }
}

// ── Toggle / state ────────────────────────────────────────────────────
export function toggleStarMap() {
  active = !active;
  if (active) {
    buildList();
    // Slide in from the left edge
    requestAnimationFrame(() => {
      overlayEl.style.transform = 'translateX(0)';
    });
    // Hide the tab label while open (the drawer replaces its purpose)
    const tab = document.getElementById('nav-rail-tab');
    if (tab) tab.style.opacity = '0';
  } else {
    overlayEl.style.transform = 'translateX(-100%)';
    const tab = document.getElementById('nav-rail-tab');
    if (tab) tab.style.opacity = '1';
  }
}

export function isStarMapOpen() {
  return active;
}

// Star map no longer renders a 3D scene, but main.js still calls this
// each frame. Keep a no-op for API compatibility.
export function updateStarMap() {}
