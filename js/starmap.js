// js/starmap.js — the star chart.
//
// A zoomable, pannable radial chart — a ship instrument, not a menu. The
// world stays visible behind light glass; scroll zooms toward the cursor,
// drag pans, click travels. The chart is semantic: zoomed out you see the
// solar system as a cluster inside the landmark shells; zoom in and the
// planets spread, then each planet's moons fade in around it. Built to
// absorb growth — new tiers (galaxies, exoplanet systems) become new
// layers with their own zoom bands.
//
// Layout is schematic (rings by rank, not scale) but angles are TRUE:
// planets sit at their live orbital azimuths, landmarks at their real
// catalog azimuths. Search covers everything; Enter travels to the top
// match. M toggles, Esc closes.

import { getLandmarks, getDeepSpaceObjects } from './deepspace.js';
import { getBodies } from './bodies.js';
import { warpTo, flyTo, getCamPos } from './flight.js';
import { emit } from './bus.js';
import { AU } from './constants.js';
import { getVisited } from './session.js';

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

// Which planet each moon belongs to — moons orbit their planet's chart dot
const MOON_HOST = {
  MOON: 'EARTH',
  PHOBOS: 'MARS', DEIMOS: 'MARS',
  IO: 'JUPITER', EUROPA: 'JUPITER', GANYMEDE: 'JUPITER', CALLISTO: 'JUPITER',
  TITAN: 'SATURN', ENCELADUS: 'SATURN', MIMAS: 'SATURN',
  TITANIA: 'URANUS', OBERON: 'URANUS',
  TRITON: 'NEPTUNE',
};

// Chart layout (base viewBox units)
const VIEW = 565;
const BASE_W = VIEW * 2;
const RING_MIN = 68;
const RING_MAX = 300;
const R_INTERSTELLAR = 375;
const R_INTERGALACTIC = 462;
const MOON_RING = 22;          // moons orbit this far from their planet dot
const MOON_MIN_SCALE = 2.1;    // zoom-in factor at which moons appear
const ZOOM_MIN = 0.55;         // can zoom out well past the full chart
const ZOOM_MAX = 9;            // deep enough that a planet + moons fill view

// ── State ─────────────────────────────────────────────────────────────
let overlayEl = null;
let svgEl = null;
let searchEl = null;
let resultsEl = null;
let tooltipEl = null;
let pillEl = null;
let active = false;
let pendingOpen = false;  // M pressed before boot finished building the map
let nodes = [];           // chart nodes with base metrics for counter-scaling
let allDest = [];         // every travelable destination (search index)

// Camera over the chart
const view = { cx: 0, cy: 0, w: BASE_W };
let panning = false;
let panMoved = false;
let panStart = null;

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
  // Light glass — the world stays visible behind the instrument
  overlayEl.style.cssText = `
    position: fixed; inset: 0; z-index: 68;
    background: radial-gradient(ellipse at center, rgba(3,5,11,0.62) 0%, rgba(1,3,7,0.9) 100%);
    backdrop-filter: blur(5px); -webkit-backdrop-filter: blur(5px);
    font-family: 'Segoe UI','Helvetica Neue',Arial,sans-serif; font-weight: 300;
    color: rgba(255,255,255,0.94);
    opacity: 0; pointer-events: none;
    transition: opacity 0.45s ease;
    overflow: hidden;
  `;

  // ── The chart fills the overlay; UI floats over it ──
  svgEl = svg('svg', { viewBox: `${-VIEW} ${-VIEW} ${BASE_W} ${BASE_W}` });
  svgEl.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;cursor:grab;';
  overlayEl.appendChild(svgEl);

  // ── Search, floating top-center ──
  const header = document.createElement('div');
  header.style.cssText = `
    position: absolute; top: 26px; left: 50%; transform: translateX(-50%);
    width: 320px; max-width: 84vw; z-index: 2;
  `;
  searchEl = document.createElement('input');
  searchEl.type = 'text';
  searchEl.placeholder = 'where to?';
  searchEl.style.cssText = `
    width: 100%; box-sizing: border-box;
    padding: 9px 16px;
    background: rgba(8,12,22,0.55);
    border: 1px solid rgba(140,180,255,0.22);
    border-radius: 999px; outline: none;
    color: rgba(255,255,255,0.9);
    text-align: center;
    font-size: 12px; letter-spacing: 3px;
    font-family: inherit; font-weight: 300;
    backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
    transition: border-color 0.2s;
  `;
  searchEl.addEventListener('focus', () => { searchEl.style.borderColor = 'rgba(140,180,255,0.55)'; });
  searchEl.addEventListener('blur', () => { searchEl.style.borderColor = 'rgba(140,180,255,0.22)'; });
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

  resultsEl = document.createElement('div');
  resultsEl.style.cssText = `
    margin-top: 8px; border-radius: 4px; overflow: hidden;
    background: rgba(8,12,22,0.88);
    border: 1px solid rgba(140,180,255,0.15);
    backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
    display: none;
  `;
  header.appendChild(resultsEl);
  overlayEl.appendChild(header);

  // ── Footer hint ──
  const foot = document.createElement('div');
  foot.style.cssText = `
    position: absolute; bottom: 18px; left: 50%; transform: translateX(-50%);
    font-size: 9px; letter-spacing: 3px; color: rgba(255,255,255,0.32);
    pointer-events: none; white-space: nowrap;
  `;
  foot.textContent = 'scroll to zoom · drag to pan · click a destination to travel · esc closes';
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

  // ── Zoom & pan ──
  svgEl.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = svgEl.getBoundingClientRect();
    // xMidYMid meet: the square viewBox maps onto the centered square of
    // side min(width, height)
    const side = Math.min(rect.width, rect.height);
    const px = (e.clientX - rect.left - rect.width / 2) / side;   // -0.5..0.5
    const py = (e.clientY - rect.top - rect.height / 2) / side;
    const mx = view.cx + px * view.w;
    const my = view.cy + py * view.w;
    const factor = Math.exp(e.deltaY * 0.0016);
    const newW = Math.max(BASE_W / ZOOM_MAX, Math.min(BASE_W / ZOOM_MIN, view.w * factor));
    view.cx = mx - (mx - view.cx) * (newW / view.w);
    view.cy = my - (my - view.cy) * (newW / view.w);
    view.w = newW;
    applyViewTransform();
  }, { passive: false });

  svgEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    panning = true;
    panMoved = false;
    panStart = { x: e.clientX, y: e.clientY, cx: view.cx, cy: view.cy };
    // NOTE: no setPointerCapture — capture redirects the click event to the
    // svg itself and destination dots never receive it.
  });
  svgEl.addEventListener('pointermove', (e) => {
    if (!panning) return;
    const dx = e.clientX - panStart.x;
    const dy = e.clientY - panStart.y;
    if (Math.abs(dx) + Math.abs(dy) > 5) panMoved = true;
    if (panMoved) {
      const rect = svgEl.getBoundingClientRect();
      const side = Math.min(rect.width, rect.height);
      view.cx = panStart.cx - (dx / side) * view.w;
      view.cy = panStart.cy - (dy / side) * view.w;
      applyViewTransform();
      svgEl.style.cursor = 'grabbing';
    }
  });
  svgEl.addEventListener('pointerup', () => {
    panning = false;
    svgEl.style.cursor = 'grab';
    // panMoved is read by click handlers this tick; clear it just after
    setTimeout(() => { panMoved = false; }, 0);
  });

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

// ── View transform: zoom/pan + semantic scaling ───────────────────────
function applyViewTransform() {
  svgEl.setAttribute('viewBox', `${view.cx - view.w / 2} ${view.cy - view.w / 2} ${view.w} ${view.w}`);
  const scale = BASE_W / view.w; // 1 = default, >1 zoomed in

  // Counter-scale: keep dots/labels near-constant screen size, with a
  // gentle growth as you dive so zooming still feels like approaching
  const geom = 1 / Math.pow(scale, 0.72);

  for (const n of nodes) {
    if (n.core) {
      if (n.core.tagName === 'circle') n.core.setAttribute('r', n.baseR * geom);
      else {
        const r = n.baseR * geom;
        n.core.setAttribute('x', n.x - r);
        n.core.setAttribute('y', n.y - r);
        n.core.setAttribute('width', r * 2);
        n.core.setAttribute('height', r * 2);
      }
    }
    if (n.halo) n.halo.setAttribute('r', n.baseR * 2.1 * geom);
    if (n.hit) n.hit.setAttribute('r', Math.max(n.baseR * 2.6, 15) * geom);
    if (n.label) n.label.setAttribute('font-size', n.baseFont * geom);

    // Semantic visibility: moons fade in past their zoom band
    if (n.minScale) {
      const vis = Math.max(0, Math.min(1, (scale - n.minScale) / 0.6));
      n.el.style.opacity = n.filtered ? Math.min(vis, 0.12) : vis;
      n.el.style.pointerEvents = vis > 0.3 ? 'auto' : 'none';
    }
  }
}

// ── Chart construction ────────────────────────────────────────────────
function buildChart() {
  svgEl.innerHTML = '';
  nodes = [];
  allDest = [];
  view.cx = 0; view.cy = 0; view.w = BASE_W;

  const bodies = getBodies();
  const landmarks = getLandmarks().map(l => ({ ...l, isLandmark: true }));
  const deep = getDeepSpaceObjects();
  const byName = {};
  for (const b of bodies) byName[b.name] = b;

  allDest = bodies.concat(landmarks);
  const bh = deep.find(o => o.isBlackHole);
  if (bh) allDest.push({ ...bh, isLandmark: false });

  const defs = svg('defs', {});
  defs.innerHTML = `<filter id="glow" x="-200%" y="-200%" width="500%" height="500%">
    <feGaussianBlur stdDeviation="4" result="b"/>
    <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>`;
  svgEl.appendChild(defs);

  // ── System regions: bordered + tinted, drawn under everything ──
  addShell(RING_MAX + 28, 'solar system', {
    solid: true,
    fill: 'rgba(120,170,255,0.035)',
  });
  addShell(R_INTERSTELLAR, 'the milky way', {
    band: 'rgba(140,180,255,0.05)',
    bandWidth: 64,
  });
  addShell(R_INTERGALACTIC, 'deep space', {});

  // ── Rings + planets: schematic radii, true angles ──
  const planets = PLANETISH.map(n => byName[n]).filter(Boolean)
    .map(b => ({ b, au: worldPos(b).length() / AU }))
    .sort((p, q) => p.au - q.au);

  const ringOf = [];
  const planetChartPos = {};   // name -> {x, y} for moon placement
  planets.forEach((p, i) => {
    const R = planets.length === 1 ? RING_MIN
      : RING_MIN + (i * (RING_MAX - RING_MIN)) / (planets.length - 1);
    ringOf.push({ au: p.au, R });

    svgEl.appendChild(svg('circle', {
      cx: 0, cy: 0, r: R, fill: 'none',
      stroke: 'rgba(140,180,255,0.09)', 'stroke-width': 1,
      'vector-effect': 'non-scaling-stroke',
    }));
    const pos = worldPos(p.b);
    const a = Math.atan2(pos.z, pos.x);
    const x = Math.cos(a) * R, y = Math.sin(a) * R;
    planetChartPos[p.b.name] = { x, y };
    addDot(p.b, x, y, 7, { label: true });
  });

  // ── Sun at center ──
  const sun = byName['SUN'];
  if (sun) {
    const n = addDot(sun, 0, 0, 11, { label: false });
    if (n.core) n.core.setAttribute('filter', 'url(#glow)');
  }

  // ── Moons: orbit their planet's dot, visible once zoomed in ──
  for (const moonName in MOON_HOST) {
    const moon = byName[moonName];
    const host = planetChartPos[MOON_HOST[moonName]];
    if (!moon || !host) continue;
    const siblings = Object.keys(MOON_HOST).filter(m => MOON_HOST[m] === MOON_HOST[moonName] && byName[m]);
    const idx = siblings.indexOf(moonName);
    const a = (idx / Math.max(siblings.length, 1)) * Math.PI * 2 - Math.PI / 2;
    const x = host.x + Math.cos(a) * MOON_RING;
    const y = host.y + Math.sin(a) * MOON_RING;
    addDot(moon, x, y, 3, { label: true, minScale: MOON_MIN_SCALE, font: 7 });
  }

  // ── Craft: diamonds; labels suppressed when parked at a planet ──
  const placed = Object.values(planetChartPos).slice();
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

  const outerPlaced = [];
  function addOuter(item, ring) {
    const pos = worldPos(item);
    const a = Math.atan2(pos.z, pos.x);
    let R = ring;
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

  applyViewTransform();
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

function addShell(R, label, opts = {}) {
  // Region tint: a filled disc (solar system) or a wide band (milky way)
  if (opts.fill) {
    svgEl.appendChild(svg('circle', { cx: 0, cy: 0, r: R, fill: opts.fill }));
  }
  if (opts.band) {
    svgEl.appendChild(svg('circle', {
      cx: 0, cy: 0, r: R, fill: 'none',
      stroke: opts.band, 'stroke-width': opts.bandWidth || 60,
    }));
  }
  svgEl.appendChild(svg('circle', {
    cx: 0, cy: 0, r: R, fill: 'none',
    stroke: opts.solid ? 'rgba(150,195,255,0.28)' : 'rgba(140,180,255,0.16)',
    'stroke-width': 1,
    'stroke-dasharray': opts.solid ? 'none' : '2 7',
    'vector-effect': 'non-scaling-stroke',
  }));
  const lx = -R * 0.7071, ly = -R * 0.7071;
  const t = svg('text', {
    x: lx - 10, y: ly - 10, 'text-anchor': 'end',
    fill: 'rgba(160,200,255,0.4)',
    'font-size': 11,
    style: 'letter-spacing:6px;',
  });
  t.textContent = label;
  svgEl.appendChild(t);
  nodes.push({ el: t, label: t, baseFont: 11, baseR: 0, x: lx, y: ly, search: ' ' });
}

function addDot(item, x, y, r, opts = {}) {
  const color = colorFor(item);
  const visited = getVisited().has(item.name);
  const g = svg('g', { style: 'cursor:pointer;' });

  // The voyage log, drawn: places you've orbited carry a warm ring —
  // the chart slowly becomes yours.
  if (visited) {
    g.appendChild(svg('circle', {
      cx: x, cy: y, r: r * 1.9, fill: 'none',
      stroke: 'rgba(255,215,160,0.35)', 'stroke-width': 1,
      'vector-effect': 'non-scaling-stroke',
    }));
  }

  const hit = svg('circle', { cx: x, cy: y, r: Math.max(r * 2.6, 15), fill: 'transparent' });
  g.appendChild(hit);

  const halo = svg('circle', { cx: x, cy: y, r: r * 2.1, fill: color, opacity: visited ? 0.24 : 0.14 });
  g.appendChild(halo);

  let core;
  if (opts.diamond) {
    core = svg('rect', {
      x: x - r, y: y - r, width: r * 2, height: r * 2,
      fill: color, transform: `rotate(45 ${x} ${y})`,
    });
  } else {
    core = svg('circle', { cx: x, cy: y, r, fill: color });
  }
  g.appendChild(core);

  const baseFont = opts.font || (opts.outer ? 10 : 9.5);
  let labelEl = null;
  if (opts.label) {
    const len = Math.hypot(x, y) || 1;
    const lx = opts.outer ? x + (x / len) * 16 : x;
    const ly = opts.outer ? y + (y / len) * 16 + 3 : y + r + 13;
    labelEl = svg('text', {
      x: lx, y: ly,
      'text-anchor': opts.outer ? (lx > 6 ? 'start' : lx < -6 ? 'end' : 'middle') : 'middle',
      fill: 'rgba(220,232,255,0.6)',
      'font-size': baseFont,
      style: 'letter-spacing:2px;pointer-events:none;',
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
  g.addEventListener('click', () => {
    if (panMoved) return; // that was a drag, not a selection
    goTo(item);
  });

  svgEl.appendChild(g);
  const node = {
    el: g, core, halo, hit, label: labelEl,
    x, y, baseR: r, baseFont,
    minScale: opts.minScale || 0,
    filtered: false,
    name: item.name,
    search: (item.name + ' ' + descFor(item)).toLowerCase(),
  };
  nodes.push(node);
  if (node.minScale) { g.style.opacity = 0; g.style.pointerEvents = 'none'; }
  return node;
}

// ── Search ────────────────────────────────────────────────────────────
function applyFilter(q) {
  const query = q.trim().toLowerCase();

  for (const n of nodes) {
    if (!n.core) continue; // shell labels ignore filtering
    n.filtered = !!query && !n.search.includes(query);
    if (!n.minScale) {
      n.el.style.transition = 'opacity 0.25s';
      n.el.style.opacity = n.filtered ? '0.12' : '1';
    }
  }
  applyViewTransform(); // re-resolve zoom-gated visibility under the filter

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
  if (!overlayEl) { pendingOpen = true; return; }
  active = !active;
  emit('starmap:toggled', active);
  if (active) {
    buildChart();
    searchEl.value = '';
    applyFilter('');
    overlayEl.style.opacity = '1';
    overlayEl.style.pointerEvents = 'auto';
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
