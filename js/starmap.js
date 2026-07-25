// js/starmap.js — the star chart.
//
// A full-screen radial nav chart, drawn top-down like a ship's plotting
// table: the Sun at center, planets on schematic orbit rings at their TRUE
// current orbital angles (the chart is live, not a diagram), spacecraft as
// diamonds between them, and two outer shells for deep-space locations —
// the Milky Way ring (interstellar tier) and the Deep Space ring
// (intergalactic tier), positioned at their real catalog azimuths.
//
// Interactions: hover a dot for name + travel time, click to travel (the
// warp is the transition — the chart closes itself). Search at the top
// covers EVERYTHING including moons that aren't drawn on the chart; Enter
// travels to the top match. M toggles, Esc closes.

import { getLandmarks, getDeepSpaceObjects } from './deepspace.js';
import { getBodies } from './bodies.js';
import { warpTo, flyTo, getCamPos } from './flight.js';
import { emit } from './bus.js';
import { AU } from './constants.js';

const SVGNS = 'http://www.w3.org/2000/svg';

// ── Destination metadata (colors + one-liners) ────────────────────────
const BODY_META = {
  SUN:      { color: '#ffdd66', desc: 'our star — where all this begins' },
  MERCURY:  { color: '#b0a090', desc: 'the smallest planet, scarred by craters' },
  VENUS:    { color: '#d9b56a', desc: 'shrouded in permanent clouds' },
  EARTH:    { color: '#4a9cff', desc: 'our pale blue dot' },
  MOON:     { color: '#cccccc', desc: 'earth’s tidally-locked companion' },
  MARS:     { color: '#c15a3b', desc: 'the red planet' },
  JUPITER:  { color: '#d9a566', desc: 'gas giant king of the solar system' },
  SATURN:   { color: '#e8cc88', desc: 'crowned by an icy ring system' },
  URANUS:   { color: '#88cce0', desc: 'tilted on its side — an ice giant' },
  NEPTUNE:  { color: '#4466d0', desc: 'the farthest ice giant, wind-torn' },
  PLUTO:    { color: '#b0a090', desc: 'distant dwarf, heart of ice' },
  CERES:    { color: '#888888', desc: 'largest body in the asteroid belt' },
  ERIS:     { color: '#ccddee', desc: 'icy dwarf planet at the edge' },
};

const CRAFT_META = {
  'VOYAGER 1':    { color: '#ffeedd', desc: 'humanity’s furthest emissary, 1977' },
  'VOYAGER 2':    { color: '#ffeedd', desc: 'only spacecraft to visit all four gas giants' },
  'NEW HORIZONS': { color: '#ddddff', desc: 'first visit to pluto, 2015' },
  'JWST':         { color: '#ffdd66', desc: 'infrared eye on the early universe' },
  'HUBBLE':       { color: '#ccddff', desc: 'deep-field pioneer, since 1990' },
  'ISS':          { color: '#ffffff', desc: 'our home in low earth orbit' },
};

const PLANETISH = ['MERCURY','VENUS','EARTH','MARS','CERES','JUPITER','SATURN','URANUS','NEPTUNE','PLUTO','ERIS'];
const CRAFT_NAMES = new Set(Object.keys(CRAFT_META));

// Chart layout (viewBox units)
const VIEW = 565;
const RING_MIN = 68;
const RING_MAX = 300;
const R_INTERSTELLAR = 375;
const R_INTERGALACTIC = 462;

// ── State ─────────────────────────────────────────────────────────────
let overlayEl = null;
let svgEl = null;
let searchEl = null;
let resultsEl = null;
let tooltipEl = null;
let pillEl = null;
let active = false;
let chartNodes = [];   // { el, name, search }
let allDest = [];      // every travelable destination incl. moons

// ── Helpers ───────────────────────────────────────────────────────────
function worldPos(item) {
  if (item.g) return item.g.userData?._worldPos || item.g.position;
  return item.pos || null;
}

function nice(name) {
  return name.toLowerCase();
}

function travelSeconds(item) {
  const pos = worldPos(item);
  if (!pos) return 0;
  const dist = getCamPos().distanceTo(pos);
  return item.isLandmark
    ? Math.max(15, Math.min(30, dist / 2000))
    : Math.max(2, Math.min(6, dist / 6000));
}

function descFor(item) {
  if (BODY_META[item.name]) return BODY_META[item.name].desc;
  if (CRAFT_META[item.name]) return CRAFT_META[item.name].desc;
  return (item.desc || '').toLowerCase();
}

function colorFor(item) {
  if (BODY_META[item.name]) return BODY_META[item.name].color;
  if (CRAFT_META[item.name]) return CRAFT_META[item.name].color;
  if (item.isBlackHole) return '#ff8850';
  if (item.tier === 'intergalactic') return '#b0d4ff';
  return '#7a9fc8';
}

function goTo(item) {
  toggleStarMap();
  if (item.isLandmark) warpTo(item.name);
  else flyTo(item.name);
}

function svg(tag, attrs) {
  const el = document.createElementNS(SVGNS, tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  return el;
}

// ── Init ──────────────────────────────────────────────────────────────
export function initStarMap() {
  overlayEl = document.createElement('div');
  overlayEl.id = 'starchart';
  overlayEl.style.cssText = `
    position: fixed; inset: 0; z-index: 68;
    background: radial-gradient(ellipse at center, rgba(6,9,18,0.72) 0%, rgba(2,4,9,0.92) 100%);
    backdrop-filter: blur(7px); -webkit-backdrop-filter: blur(7px);
    display: flex; flex-direction: column; align-items: center;
    font-family: 'Segoe UI','Helvetica Neue',Arial,sans-serif; font-weight: 300;
    color: rgba(255,255,255,0.94);
    opacity: 0; pointer-events: none;
    transition: opacity 0.45s ease;
  `;

  // ── Header: title + search ──
  const header = document.createElement('div');
  header.style.cssText = 'flex-shrink:0;text-align:center;padding-top:34px;width:340px;max-width:86vw;position:relative;z-index:2;';
  header.innerHTML = `
    <div style="font-size:11px;letter-spacing:8px;color:rgba(200,220,255,0.7);
         text-shadow:0 1px 6px rgba(0,0,0,0.9)">star chart</div>
  `;
  searchEl = document.createElement('input');
  searchEl.type = 'text';
  searchEl.placeholder = 'where to?';
  searchEl.style.cssText = `
    width: 100%; box-sizing: border-box;
    margin-top: 14px; padding: 10px 16px;
    background: rgba(255,255,255,0.045);
    border: 1px solid rgba(140,180,255,0.2);
    border-radius: 999px; outline: none;
    color: rgba(255,255,255,0.9);
    text-align: center;
    font-size: 13px; letter-spacing: 3px;
    font-family: inherit; font-weight: 300;
    transition: border-color 0.2s;
  `;
  searchEl.addEventListener('focus', () => { searchEl.style.borderColor = 'rgba(140,180,255,0.55)'; });
  searchEl.addEventListener('blur', () => { searchEl.style.borderColor = 'rgba(140,180,255,0.2)'; });
  searchEl.addEventListener('input', () => applyFilter(searchEl.value));
  searchEl.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      const first = resultsEl.querySelector('[data-result]');
      if (first) first.click();
    } else if (e.key === 'Escape' && searchEl.value) {
      searchEl.value = '';
      applyFilter('');
      e.stopPropagation();
    }
  });
  header.appendChild(searchEl);

  // Search results dropdown (covers moons etc. that aren't charted)
  resultsEl = document.createElement('div');
  resultsEl.style.cssText = `
    position: absolute; left: 0; right: 0; top: 100%;
    margin-top: 8px; border-radius: 4px; overflow: hidden;
    background: rgba(8,12,22,0.92);
    border: 1px solid rgba(140,180,255,0.15);
    backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
    display: none; text-align: left;
  `;
  header.appendChild(resultsEl);
  overlayEl.appendChild(header);

  // ── The chart ──
  const chartWrap = document.createElement('div');
  chartWrap.style.cssText = 'flex:1;width:100%;display:flex;align-items:center;justify-content:center;min-height:0;padding:8px 0 4px;';
  svgEl = svg('svg', { viewBox: `${-VIEW} ${-VIEW} ${VIEW * 2} ${VIEW * 2}` });
  svgEl.style.cssText = 'height:100%;max-width:96vw;display:block;';
  chartWrap.appendChild(svgEl);
  overlayEl.appendChild(chartWrap);

  // ── Footer hint ──
  const foot = document.createElement('div');
  foot.style.cssText = 'flex-shrink:0;padding-bottom:20px;font-size:9px;letter-spacing:3px;color:rgba(255,255,255,0.3);';
  foot.textContent = 'click a destination to travel · esc closes';
  overlayEl.appendChild(foot);

  document.body.appendChild(overlayEl);

  // Tooltip (follows cursor)
  tooltipEl = document.createElement('div');
  tooltipEl.style.cssText = `
    position: fixed; z-index: 70; pointer-events: none;
    padding: 8px 14px; border-radius: 3px;
    background: rgba(8,12,22,0.92);
    border: 1px solid rgba(140,180,255,0.25);
    font-family: 'Segoe UI',sans-serif; font-weight: 300;
    font-size: 12px; letter-spacing: 2px; color: rgba(255,255,255,0.92);
    opacity: 0; transition: opacity 0.15s; white-space: nowrap;
  `;
  document.body.appendChild(tooltipEl);

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
  pillEl = document.createElement('div');
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
}

// ── Chart construction ────────────────────────────────────────────────
function buildChart() {
  svgEl.innerHTML = '';
  chartNodes = [];
  allDest = [];

  const bodies = getBodies();
  const landmarks = getLandmarks().map(l => ({ ...l, isLandmark: true }));
  const deep = getDeepSpaceObjects();
  const byName = {};
  for (const b of bodies) byName[b.name] = b;

  // Every travelable destination goes in the search index
  allDest = bodies.concat(landmarks);
  const bh = deep.find(o => o.isBlackHole);
  if (bh) allDest.push({ ...bh, isLandmark: false });

  // Soft glow filter for the sun
  const defs = svg('defs', {});
  defs.innerHTML = `<filter id="glow" x="-200%" y="-200%" width="500%" height="500%">
    <feGaussianBlur stdDeviation="4" result="b"/>
    <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>`;
  svgEl.appendChild(defs);

  // ── Rings + planets: schematic radii, true angles ──
  const planets = PLANETISH.map(n => byName[n]).filter(Boolean)
    .map(b => ({ b, au: worldPos(b).length() / AU }))
    .sort((p, q) => p.au - q.au);

  const ringOf = [];  // [{au, R}] for craft interpolation
  planets.forEach((p, i) => {
    const R = planets.length === 1 ? RING_MIN
      : RING_MIN + (i * (RING_MAX - RING_MIN)) / (planets.length - 1);
    ringOf.push({ au: p.au, R });

    svgEl.appendChild(svg('circle', {
      cx: 0, cy: 0, r: R, fill: 'none',
      stroke: 'rgba(140,180,255,0.09)', 'stroke-width': 1,
    }));
    const pos = worldPos(p.b);
    const a = Math.atan2(pos.z, pos.x);
    addDot(p.b, Math.cos(a) * R, Math.sin(a) * R, 7, { label: true });
  });

  // ── Sun at center ──
  const sun = byName['SUN'];
  if (sun) {
    const g = addDot(sun, 0, 0, 11, { label: false });
    const core = g.querySelector('[data-core]');
    if (core) core.setAttribute('filter', 'url(#glow)');
  }

  // ── Craft: diamonds, radius log-interpolated between planet rings.
  // Craft parked at a planet (ISS, Hubble, JWST at Earth) land on the same
  // chart point as their host — skip their labels (hover names them) and
  // fan the dots slightly so each stays clickable.
  const placed = [];
  for (const node of chartNodes) {
    const m = node.el.querySelector('[data-core]');
    if (m && m.tagName === 'circle') placed.push({ x: +m.getAttribute('cx'), y: +m.getAttribute('cy') });
  }
  let fan = 0;
  for (const name of CRAFT_NAMES) {
    const b = byName[name];
    if (!b) continue;
    const pos = worldPos(b);
    const au = Math.max(pos.length() / AU, 0.02);
    const R = craftRadius(au, ringOf);
    const a = Math.atan2(pos.z, pos.x);
    let x = Math.cos(a) * R, y = Math.sin(a) * R;
    const crowded = placed.some(pt => Math.hypot(pt.x - x, pt.y - y) < 34);
    if (crowded) {
      fan++;
      x += Math.cos(a + fan * 2.1) * 14;
      y += Math.sin(a + fan * 2.1) * 14;
    }
    addDot(b, x, y, 4.5, { label: !crowded, diamond: true });
    placed.push({ x, y });
  }

  // ── Outer shells: the Milky Way + Deep Space ──
  addShell(R_INTERSTELLAR, 'the milky way');
  addShell(R_INTERGALACTIC, 'deep space');

  const outerPlaced = [];
  function addOuter(item, ring) {
    const pos = worldPos(item);
    const a = Math.atan2(pos.z, pos.x);
    let R = ring;
    // Nudge outward until clear of neighbors on the same shell
    while (outerPlaced.some(pt => Math.hypot(pt.x - Math.cos(a) * R, pt.y - Math.sin(a) * R) < 46)) {
      R += 30;
    }
    const x = Math.cos(a) * R, y = Math.sin(a) * R;
    outerPlaced.push({ x, y });
    addDot(item, x, y, 5.5, { label: true, outer: true });
  }
  for (const lm of landmarks) {
    addOuter(lm, lm.tier === 'intergalactic' ? R_INTERGALACTIC : R_INTERSTELLAR);
  }
  if (bh) addOuter(bh, R_INTERGALACTIC);
}

function craftRadius(au, rings) {
  if (rings.length === 0) return RING_MIN;
  if (au <= rings[0].au) return Math.max(40, rings[0].R - 14);
  for (let i = 0; i < rings.length - 1; i++) {
    if (au <= rings[i + 1].au) {
      const t = (Math.log(au) - Math.log(rings[i].au)) /
                (Math.log(rings[i + 1].au) - Math.log(rings[i].au));
      return rings[i].R + t * (rings[i + 1].R - rings[i].R);
    }
  }
  return Math.min(RING_MAX + 34, rings[rings.length - 1].R + 22);
}

function addShell(R, label) {
  svgEl.appendChild(svg('circle', {
    cx: 0, cy: 0, r: R, fill: 'none',
    stroke: 'rgba(140,180,255,0.13)', 'stroke-width': 1,
    'stroke-dasharray': '2 7',
  }));
  const lx = -R * 0.7071, ly = -R * 0.7071;
  const t = svg('text', {
    x: lx - 10, y: ly - 10, 'text-anchor': 'end',
    fill: 'rgba(160,200,255,0.4)',
    style: 'font-size:11px;letter-spacing:6px;',
  });
  t.textContent = label;
  svgEl.appendChild(t);
}

function addDot(item, x, y, r, opts = {}) {
  const color = colorFor(item);
  const g = svg('g', { style: 'cursor:pointer;' });

  // Generous invisible hit area
  g.appendChild(svg('circle', { cx: x, cy: y, r: Math.max(r * 2.6, 15), fill: 'transparent' }));

  // Halo + core
  const halo = svg('circle', { cx: x, cy: y, r: r * 2.1, fill: color, opacity: 0.14 });
  g.appendChild(halo);
  let core;
  if (opts.diamond) {
    core = svg('rect', {
      x: x - r, y: y - r, width: r * 2, height: r * 2,
      fill: color, transform: `rotate(45 ${x} ${y})`, 'data-core': '1',
    });
  } else {
    core = svg('circle', { cx: x, cy: y, r, fill: color, 'data-core': '1' });
  }
  g.appendChild(core);

  // Label
  let labelEl = null;
  if (opts.label) {
    const len = Math.hypot(x, y) || 1;
    const lx = opts.outer ? x + (x / len) * 16 : x;
    const ly = opts.outer ? y + (y / len) * 16 + 3 : y + r + 13;
    labelEl = svg('text', {
      x: lx, y: ly,
      'text-anchor': opts.outer ? (lx > 6 ? 'start' : lx < -6 ? 'end' : 'middle') : 'middle',
      fill: 'rgba(220,232,255,0.6)',
      style: `font-size:${opts.outer ? 10 : 9.5}px;letter-spacing:2px;pointer-events:none;`,
    });
    labelEl.textContent = nice(item.name);
    g.appendChild(labelEl);
  }

  g.addEventListener('mouseenter', () => {
    halo.setAttribute('opacity', '0.35');
    if (labelEl) labelEl.setAttribute('fill', 'rgba(255,255,255,0.95)');
    tooltipEl.innerHTML = `${nice(item.name)}<span style="color:rgba(140,180,255,0.6);margin-left:12px">&asymp; ${Math.round(travelSeconds(item))}s journey</span>`;
    tooltipEl.style.opacity = '1';
  });
  g.addEventListener('mousemove', (e) => {
    tooltipEl.style.left = (e.clientX + 16) + 'px';
    tooltipEl.style.top = (e.clientY - 10) + 'px';
  });
  g.addEventListener('mouseleave', () => {
    halo.setAttribute('opacity', '0.14');
    if (labelEl) labelEl.setAttribute('fill', 'rgba(220,232,255,0.6)');
    tooltipEl.style.opacity = '0';
  });
  g.addEventListener('click', () => goTo(item));

  svgEl.appendChild(g);
  chartNodes.push({ el: g, name: item.name, search: (item.name + ' ' + descFor(item)).toLowerCase() });
  return g;
}

// ── Search ────────────────────────────────────────────────────────────
function applyFilter(q) {
  const query = q.trim().toLowerCase();

  // Dim chart dots that don't match
  for (const n of chartNodes) {
    n.el.style.transition = 'opacity 0.25s';
    n.el.style.opacity = !query || n.search.includes(query) ? '1' : '0.12';
  }

  // Dropdown results (covers moons and anything not on the chart)
  resultsEl.innerHTML = '';
  if (!query) { resultsEl.style.display = 'none'; return; }

  const matches = allDest
    .filter(d => (d.name + ' ' + descFor(d)).toLowerCase().includes(query))
    .slice(0, 6);
  if (matches.length === 0) { resultsEl.style.display = 'none'; return; }

  for (const m of matches) {
    const row = document.createElement('div');
    row.dataset.result = '1';
    row.style.cssText = `
      display:flex;justify-content:space-between;align-items:baseline;gap:14px;
      padding:10px 16px;cursor:pointer;font-size:12px;letter-spacing:2px;
      color:rgba(255,255,255,0.85);transition:background 0.15s;
    `;
    row.innerHTML = `<span>${nice(m.name)}</span>
      <span style="font-size:9px;color:rgba(140,180,255,0.55)">&asymp; ${Math.round(travelSeconds(m))}s</span>`;
    row.addEventListener('mouseenter', () => { row.style.background = 'rgba(120,180,255,0.1)'; });
    row.addEventListener('mouseleave', () => { row.style.background = 'transparent'; });
    row.addEventListener('click', () => goTo(m));
    resultsEl.appendChild(row);
  }
  resultsEl.style.display = 'block';
}

// ── Toggle / state ────────────────────────────────────────────────────
export function toggleStarMap() {
  active = !active;
  emit('starmap:toggled', active);
  if (active) {
    buildChart();
    searchEl.value = '';
    applyFilter('');
    overlayEl.style.opacity = '1';
    overlayEl.style.pointerEvents = 'auto';
    requestAnimationFrame(() => searchEl.focus());
    if (pillEl) pillEl.style.opacity = '0';
  } else {
    overlayEl.style.opacity = '0';
    overlayEl.style.pointerEvents = 'none';
    searchEl.blur();
    tooltipEl.style.opacity = '0';
    if (pillEl) pillEl.style.opacity = '1';
  }
}

export function isStarMapOpen() {
  return active;
}

// Kept for main.js API compatibility — the chart is DOM/SVG, nothing to tick.
export function updateStarMap() {}
