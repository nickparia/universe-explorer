// ground/map.js — the suit's chart.
//
// Drawn from the site's own elevation data — a real topographic map of
// a real place, in the ship's amber phosphor. A small chart rides the
// top-right of the visor; M unfolds the full sheet (the same key that
// opens the star chart aboard — on the ground, the chart shows the
// ground). Player arrow, the landing pad, the HiRISE survey patch,
// a graticule in kilometers.
//
// THE SURVEY LAW governs what the chart shows: the orbital pass chose
// the site, but the chart only KNOWS verified ground — the ring the
// lander imaged on the way down, and the circle around every stake
// planted. Everything else is withheld under the fog: a grid over
// darkness, waiting. Each stake carries its own radius (st.r), so the
// instruments to come — site drones, the relay mesh — will open wider
// circles without rewriting the ones already earned.

import * as THREE from 'three';
import { getSite } from './site.js';
import { getStakes, getSurveyRadius } from './stakes.js';

// What the lander verified on the descent corridor: a ring of imaged
// ground around the pad, yours before the first bootprint.
const PAD_REVEAL = 800;   // m

let fogCache = { mini: null, sheet: null };
let hatchSrc = null;

// The unknown is a TEXTURE, not an absence: dark chart-stock crossed
// with faint diagonal hatching — the cartographer's "no data here yet".
function hatchCanvas() {
  if (hatchSrc) return hatchSrc;
  hatchSrc = document.createElement('canvas');
  hatchSrc.width = hatchSrc.height = 7;
  const g = hatchSrc.getContext('2d');
  g.strokeStyle = 'rgba(255,186,100,0.09)';
  g.lineWidth = 1;
  g.beginPath(); g.moveTo(-1, 8); g.lineTo(8, -1); g.stroke();
  return hatchSrc;
}

/** Lay the fog over everything drawn so far, then punch the verified
 *  circles out of it. The reading must be BINARY at a glance: surveyed
 *  ground carries the full relief; unsurveyed ground carries none —
 *  only hatched chart-stock. A short soft rim marks the confidence
 *  boundary; the survey rings drawn after this ink it precisely. */
function fogOver(ctx, W, H, circles, slot) {
  let fc = fogCache[slot];
  if (!fc) fc = fogCache[slot] = document.createElement('canvas');
  if (fc.width !== W || fc.height !== H) { fc.width = W; fc.height = H; }
  const f = fc.getContext('2d');
  f.globalCompositeOperation = 'source-over';
  f.clearRect(0, 0, W, H);
  f.fillStyle = '#070402';             // opaque — the relief does NOT bleed through
  f.fillRect(0, 0, W, H);
  f.fillStyle = f.createPattern(hatchCanvas(), 'repeat');
  f.fillRect(0, 0, W, H);
  f.globalCompositeOperation = 'destination-out';
  for (const c of circles) {
    if (c.r < 1) continue;
    const g = f.createRadialGradient(c.x, c.y, c.r * 0.9, c.x, c.y, c.r);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    f.fillStyle = g;
    f.beginPath(); f.arc(c.x, c.y, c.r, 0, Math.PI * 2); f.fill();
  }
  ctx.drawImage(fc, 0, 0);
}

const MONO = "'SF Mono','Cascadia Mono','JetBrains Mono',Menlo,Consolas,'Courier New',monospace";

let baseCanvas = null;      // prerendered amber hillshade of the site
let mini = null, mctx = null;
let sheet = null, sheetCanvas = null, sctx = null;
let sheetOpen = false;
let keyFn = null;
const MINI = 172;           // px
const MINI_SPAN = 9000;     // m across the small chart

// The sheet is a VIEWPORT onto the site, not a fixed print: drag to
// pan, scroll to zoom on the cursor. The view survives closing the
// sheet (you come back to where you were reading) and resets each
// landfall.
let view = null;            // { cx, cz (world m), mPerPx }
let dragging = null;        // { mx, my, cx, cz }
let lastLocal = { x: 0, z: 0 };
let lastHeading = 0;

function renderBase() {
  const site = getSite();
  const { cols, rows } = site;
  const W = cols * 2, H = rows * 2;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const img = g.createImageData(W, H);
  const dem = site.dem;
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < dem.length; i++) { if (dem[i] < mn) mn = dem[i]; if (dem[i] > mx) mx = dem[i]; }
  for (let y = 0; y < H; y++) {
    const r = Math.min(rows - 1.001, y / 2);
    const iz = Math.floor(r), fz = r - iz;
    for (let x = 0; x < W; x++) {
      const cc = Math.min(cols - 1.001, x / 2);
      const ix = Math.floor(cc), fx = cc - ix;
      const i0 = iz * cols + ix;
      const e = (dem[i0] * (1 - fx) + dem[i0 + 1] * fx) * (1 - fz) +
                (dem[i0 + cols] * (1 - fx) + dem[i0 + cols + 1] * fx) * fz;
      // hillshade from the west (the site's own light)
      const eR = dem[Math.min(dem.length - 1, i0 + 1)];
      const eD = dem[Math.min(dem.length - 1, i0 + cols)];
      const hs = THREE.MathUtils.clamp(0.55 + (e - eR) * 0.0035 - (e - eD) * 0.0012, 0.1, 1);
      const t = (e - mn) / (mx - mn);
      // amber ramp: deep floor dark umber → high rim pale gold
      const rr = (30 + t * 205) * hs;
      const gg = (18 + t * 130) * hs;
      const bb = (10 + t * 62) * hs;
      const k = (y * W + x) * 4;
      img.data[k] = rr; img.data[k + 1] = gg; img.data[k + 2] = bb; img.data[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

function worldToBase(x, z) {
  const site = getSite();
  return {
    x: ((x - site.minX) / (site.maxX - site.minX)) * baseCanvas.width,
    y: ((z - site.minZ) / (site.maxZ - site.minZ)) * baseCanvas.height,
    sx: baseCanvas.width / (site.maxX - site.minX),   // px per meter
  };
}

export function initGroundMap() {
  baseCanvas = renderBase();

  mini = document.createElement('canvas');
  mini.width = MINI * 2; mini.height = MINI * 2;
  mini.style.cssText =
    `position:fixed;top:16px;right:18px;width:${MINI}px;height:${MINI}px;z-index:46;` +
    'border-radius:50%;pointer-events:none;' +
    `box-shadow:0 0 0 1px rgba(255,186,100,0.28), 0 0 18px rgba(0,0,0,0.55);`;
  document.body.appendChild(mini);
  mctx = mini.getContext('2d');

  // The full sheet — a navigable viewport, not a fixed print
  sheet = document.createElement('div');
  sheet.style.cssText =
    'position:fixed;inset:0;z-index:200;display:none;align-items:center;justify-content:center;' +
    'flex-direction:column;background:rgba(4,2,1,0.82);backdrop-filter:blur(3px);';
  sheetCanvas = document.createElement('canvas');
  sheetCanvas.style.cssText =
    'display:block;cursor:grab;' +
    'box-shadow:0 0 0 1px rgba(255,186,100,0.3), 0 0 40px rgba(0,0,0,0.8);';
  sheet.appendChild(sheetCanvas);
  const cap = document.createElement('div');
  cap.style.cssText =
    `font-family:${MONO};font-size:11.5px;letter-spacing:4px;color:rgba(255,186,100,0.7);` +
    'text-align:center;margin-top:10px;text-shadow:0 1px 3px rgba(0,0,0,0.9);';
  cap.textContent = 'COPRATES CHASMA · SURVEYED GROUND ONLY · DRAG PAN · SCROLL ZOOM · M CLOSE';
  sheet.appendChild(cap);
  document.body.appendChild(sheet);

  // The chart owns its pointer: nothing beneath it may fly, pick, or walk
  for (const ev of ['mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu']) {
    sheet.addEventListener(ev, (e) => e.stopPropagation());
  }
  sheetCanvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!view) return;
    const k = sheetCanvas.width / sheetCanvas.clientWidth;
    const mx = e.offsetX * k, my = e.offsetY * k;
    // Anchor the world under the cursor while the scale changes
    const wx = view.cx + (mx - sheetCanvas.width / 2) * view.mPerPx;
    const wz = view.cz + (my - sheetCanvas.height / 2) * view.mPerPx;
    // Delta-proportional: a flick of the wheel moves the scale in
    // earnest, a trackpad's fine scroll glides it
    const z = Math.exp(THREE.MathUtils.clamp(e.deltaY, -420, 420) * 0.0028);
    view.mPerPx = THREE.MathUtils.clamp(view.mPerPx * z, view.minMPerPx, view.maxMPerPx);
    view.cx = wx - (mx - sheetCanvas.width / 2) * view.mPerPx;
    view.cz = wz - (my - sheetCanvas.height / 2) * view.mPerPx;
    clampView();
    renderSheet();
  }, { passive: false });
  // Pointer capture: the drag follows the hand even off the window's
  // edge, and ALWAYS hears the release — no stuck pans.
  sheetCanvas.addEventListener('pointerdown', (e) => {
    if (!view || e.button !== 0) return;
    try { sheetCanvas.setPointerCapture(e.pointerId); } catch (err) { /* fine */ }
    dragging = { mx: e.clientX, my: e.clientY, cx: view.cx, cz: view.cz };
    sheetCanvas.style.cursor = 'grabbing';
  });
  sheetCanvas.addEventListener('pointermove', onSheetDrag);
  sheetCanvas.addEventListener('pointerup', onSheetDrop);
  sheetCanvas.addEventListener('pointercancel', onSheetDrop);
  window.addEventListener('blur', onSheetDrop);

  keyFn = (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    if (e.code === 'KeyM') {
      // On the ground, the chart key shows the ground — the star
      // chart stays aboard. Capture phase beats the starmap listener.
      e.stopImmediatePropagation();
      e.preventDefault();
      sheetOpen = !sheetOpen;
      sheet.style.display = sheetOpen ? 'flex' : 'none';
      if (sheetOpen) { sizeSheet(); if (!view) fitView(); renderSheet(); }
    } else if (e.code === 'Escape' && sheetOpen) {
      // Closing the chart CONSUMES the key — the ship systems menu
      // (bubble phase) must not also hear it, and in browser
      // fullscreen the exit this Esc causes must not read as a menu
      // request either.
      e.stopPropagation();
      window.__solaceEscClaimed = performance.now();
      sheetOpen = false;
      sheet.style.display = 'none';
    }
  };
  window.addEventListener('keydown', keyFn, true);
}

function onSheetDrag(e) {
  if (!dragging || !sheetOpen || !view) return;
  const k = sheetCanvas.width / sheetCanvas.clientWidth;
  view.cx = dragging.cx - (e.clientX - dragging.mx) * k * view.mPerPx;
  view.cz = dragging.cz - (e.clientY - dragging.my) * k * view.mPerPx;
  clampView();
  renderSheet();
}

function onSheetDrop() {
  if (!dragging) return;
  dragging = null;
  if (sheetCanvas) sheetCanvas.style.cursor = 'grab';
}

function sizeSheet() {
  const cw = Math.round(window.innerWidth * 0.82);
  const ch = Math.round(window.innerHeight * 0.78);
  sheetCanvas.style.width = cw + 'px';
  sheetCanvas.style.height = ch + 'px';
  if (sheetCanvas.width !== cw * 2) sheetCanvas.width = cw * 2;
  if (sheetCanvas.height !== ch * 2) sheetCanvas.height = ch * 2;
}

/** Open on the whole site; remember how far in the reader may go. */
function fitView() {
  const site = getSite();
  const fit = Math.max(
    (site.maxX - site.minX) / sheetCanvas.width,
    (site.maxZ - site.minZ) / sheetCanvas.height
  );
  view = {
    cx: (site.minX + site.maxX) / 2,
    cz: (site.minZ + site.maxZ) / 2,
    mPerPx: fit,
    maxMPerPx: fit,
    // Deep enough that one survey circle can fill the glass — the
    // coarse relief goes soft down here, but the chart ink (rings,
    // grid, marks) stays crisp, and reading YOUR ground is the point.
    minMPerPx: 4,
  };
}

function clampView() {
  const site = getSite();
  view.cx = THREE.MathUtils.clamp(view.cx, site.minX, site.maxX);
  view.cz = THREE.MathUtils.clamp(view.cz, site.minZ, site.maxZ);
}

export function disposeGroundMap() {
  window.removeEventListener('keydown', keyFn, true);
  window.removeEventListener('blur', onSheetDrop);
  for (const el of [mini, sheet]) if (el && el.parentNode) el.parentNode.removeChild(el);
  mini = null; mctx = null; sheet = null; sheetCanvas = null; sctx = null;
  baseCanvas = null; sheetOpen = false;
  fogCache = { mini: null, sheet: null };
  view = null; dragging = null;
}

function drawPlayer(ctx, x, y, heading, scale = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(heading * Math.PI / 180);
  ctx.fillStyle = 'rgba(255,210,140,0.95)';
  ctx.beginPath();
  ctx.moveTo(0, -7 * scale);
  ctx.lineTo(5 * scale, 6 * scale);
  ctx.lineTo(0, 3 * scale);
  ctx.lineTo(-5 * scale, 6 * scale);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

let miniTimer = 0;

/** The chart docks: a visor corner instrument afoot, a bezeled nav
 *  screen in the cab — the surface owns the information. */
export function setMapMount(roving) {
  if (!mini) return;
  // Projection in every gait — only the perch changes with the mode
  mini.style.borderRadius = '50%';
  mini.style.boxShadow = '0 0 0 1px rgba(255,186,100,0.28), 0 0 18px rgba(0,0,0,0.55)';
  if (roving) {
    mini.style.top = '';
    mini.style.bottom = '236px';
    mini.style.right = '26px';
  } else {
    mini.style.bottom = '';
    mini.style.top = '16px';
    mini.style.right = '18px';
  }
}

export function updateGroundMap(dt, local, heading) {
  if (!mctx) return;
  miniTimer -= dt;
  if (miniTimer > 0 && !sheetOpen) return;
  miniTimer = 0.2;

  // ── minimap: north-up window around the traveler ──
  const b = worldToBase(local.x, local.z);
  const spanPx = MINI_SPAN * b.sx;
  const S = MINI * 2;
  mctx.clearRect(0, 0, S, S);
  mctx.save();
  mctx.beginPath();
  mctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
  mctx.clip();
  mctx.imageSmoothingEnabled = true;
  mctx.drawImage(baseCanvas, b.x - spanPx / 2, b.y - spanPx / 2, spanPx, spanPx, 0, 0, S, S);
  // the faintest phosphor glass — surveyed relief must READ
  mctx.fillStyle = 'rgba(10,5,2,0.12)';
  mctx.fillRect(0, 0, S, S);
  const pxPerM = (S / spanPx) * b.sx;
  // the fog: only verified ground shows through
  {
    const pv = worldToBase(0, 0);
    const circles = [{
      x: S / 2 + (pv.x - b.x) * (S / spanPx),
      y: S / 2 + (pv.y - b.y) * (S / spanPx),
      r: PAD_REVEAL * pxPerM,
    }];
    for (const st of getStakes()) {
      const sb = worldToBase(st.x, st.z);
      circles.push({
        x: S / 2 + (sb.x - b.x) * (S / spanPx),
        y: S / 2 + (sb.y - b.y) * (S / spanPx),
        r: (st.r || getSurveyRadius()) * pxPerM,
      });
    }
    fogOver(mctx, S, S, circles, 'mini');
  }
  // surveyed ground: verified circles glow faintly on the glass
  for (const st of getStakes()) {
    const sb = worldToBase(st.x, st.z);
    const sx = S / 2 + (sb.x - b.x) * (S / spanPx);
    const sy = S / 2 + (sb.y - b.y) * (S / spanPx);
    const rr = (st.r || getSurveyRadius()) * pxPerM;
    mctx.fillStyle = 'rgba(255,186,100,0.07)';
    mctx.beginPath(); mctx.arc(sx, sy, rr, 0, Math.PI * 2); mctx.fill();
    mctx.strokeStyle = 'rgba(255,186,100,0.35)';
    mctx.lineWidth = 1;
    mctx.beginPath(); mctx.arc(sx, sy, rr, 0, Math.PI * 2); mctx.stroke();
    mctx.fillStyle = 'rgba(255,196,120,0.9)';
    mctx.fillRect(sx - 1.5, sy - 1.5, 3, 3);
  }
  // the pad
  const pad = worldToBase(0, 0);
  const px = S / 2 + (pad.x - b.x) * (S / spanPx);
  const py = S / 2 + (pad.y - b.y) * (S / spanPx);
  mctx.strokeStyle = 'rgba(255,186,100,0.85)';
  mctx.lineWidth = 1.5;
  mctx.strokeRect(px - 4, py - 4, 8, 8);
  drawPlayer(mctx, S / 2, S / 2, heading, 1.4);
  // north tick (retina canvas: 22px ink reads as 11px)
  mctx.fillStyle = 'rgba(255,186,100,0.8)';
  mctx.font = `bold 22px ${MONO}`;
  mctx.textAlign = 'center';
  mctx.fillText('N', S / 2, 26);
  mctx.restore();

  // ── the sheet, when unfolded: refresh on the same cadence so the
  //    player arrow walks across it ──
  lastLocal.x = local.x; lastLocal.z = local.z; lastHeading = heading;
  if (sheetOpen && sheetCanvas && view) renderSheet();
}

/** Draw the sheet through the view transform — the world rectangle the
 *  viewport currently covers, sampled from the prerendered hillshade,
 *  fogged, then annotated in screen space (ink stays crisp at any zoom). */
function renderSheet() {
  if (!sheetCanvas || !view || !baseCanvas) return;
  const W = sheetCanvas.width, H = sheetCanvas.height;
  sctx = sheetCanvas.getContext('2d');
  const site = getSite();
  const toX = (wx) => (wx - view.cx) / view.mPerPx + W / 2;
  const toY = (wz) => (wz - view.cz) / view.mPerPx + H / 2;

  // Chart-stock beneath everything (the viewport may look past the
  // site's edge), then the visible slice of the relief
  sctx.fillStyle = '#070402';
  sctx.fillRect(0, 0, W, H);
  const basePxPerMX = baseCanvas.width / (site.maxX - site.minX);
  const basePxPerMY = baseCanvas.height / (site.maxZ - site.minZ);
  const wx0 = view.cx - (W / 2) * view.mPerPx;
  const wz0 = view.cz - (H / 2) * view.mPerPx;
  sctx.imageSmoothingEnabled = true;
  sctx.drawImage(
    baseCanvas,
    (wx0 - site.minX) * basePxPerMX, (wz0 - site.minZ) * basePxPerMY,
    W * view.mPerPx * basePxPerMX, H * view.mPerPx * basePxPerMY,
    0, 0, W, H
  );

  // The fog — the grid and every annotation are chart ink, drawn over
  // darkness and verified ground alike
  {
    const circles = [{ x: toX(0), y: toY(0), r: PAD_REVEAL / view.mPerPx }];
    for (const st of getStakes()) {
      circles.push({ x: toX(st.x), y: toY(st.z), r: (st.r || getSurveyRadius()) / view.mPerPx });
    }
    fogOver(sctx, W, H, circles, 'sheet');
  }

  // NOTE on sizes: the canvas is retina — 2 device px per CSS px — so
  // every ink dimension here is DOUBLE what the eye should read.
  // 20px font ≈ 10px on screen; anything smaller is decoration.

  // graticule every 10 km
  sctx.strokeStyle = 'rgba(255,186,100,0.14)';
  sctx.fillStyle = 'rgba(255,186,100,0.4)';
  sctx.font = `20px ${MONO}`;
  sctx.lineWidth = 2;
  for (let m = Math.ceil(wx0 / 10000) * 10000; m < wx0 + W * view.mPerPx; m += 10000) {
    const gx = toX(m);
    sctx.beginPath(); sctx.moveTo(gx, 0); sctx.lineTo(gx, H); sctx.stroke();
  }
  for (let m = Math.ceil(wz0 / 10000) * 10000; m < wz0 + H * view.mPerPx; m += 10000) {
    const gy = toY(m);
    sctx.beginPath(); sctx.moveTo(0, gy); sctx.lineTo(W, gy); sctx.stroke();
  }

  // the descent-imagery ring around the pad — why this ground is known
  sctx.strokeStyle = 'rgba(255,186,100,0.3)';
  sctx.lineWidth = 2;
  sctx.setLineDash([6, 8]);
  sctx.beginPath(); sctx.arc(toX(0), toY(0), PAD_REVEAL / view.mPerPx, 0, Math.PI * 2); sctx.stroke();
  sctx.setLineDash([]);

  // HiRISE survey patch outline
  if (site.hi) {
    sctx.strokeStyle = 'rgba(180,220,255,0.35)';
    sctx.lineWidth = 2;
    sctx.setLineDash([12, 10]);
    sctx.strokeRect(toX(site.hi.x0), toY(site.hi.z0),
      (site.hi.x1 - site.hi.x0) / view.mPerPx, (site.hi.z1 - site.hi.z0) / view.mPerPx);
    sctx.setLineDash([]);
    sctx.fillStyle = 'rgba(180,220,255,0.5)';
    sctx.fillText('1M SURVEY', toX(site.hi.x0) + 8, toY(site.hi.z0) - 10);
  }

  // surveyed ground: the verified circles, inked crisply
  for (const st of getStakes()) {
    const sx = toX(st.x), sy = toY(st.z);
    const rPx = (st.r || getSurveyRadius()) / view.mPerPx;
    sctx.fillStyle = 'rgba(255,186,100,0.06)';
    sctx.beginPath(); sctx.arc(sx, sy, rPx, 0, Math.PI * 2); sctx.fill();
    sctx.strokeStyle = 'rgba(255,186,100,0.55)';
    sctx.lineWidth = 3;
    sctx.beginPath(); sctx.arc(sx, sy, rPx, 0, Math.PI * 2); sctx.stroke();
    sctx.fillStyle = 'rgba(255,206,130,0.95)';
    sctx.save(); sctx.translate(sx, sy); sctx.rotate(Math.PI / 4); sctx.fillRect(-5, -5, 10, 10); sctx.restore();
    sctx.fillStyle = 'rgba(255,186,100,0.8)';
    sctx.fillText('S' + st.n, sx + 13, sy + 7);
    // At PLANNING zoom the chart yields its quiet data: the readings
    // that decide where machines belong. Never an arrow — the player
    // who cross-reads three circles earns the good site themselves.
    if (view.mPerPx < 12 && st.readings) {
      sctx.fillStyle = 'rgba(255,186,100,0.5)';
      sctx.fillText(
        'FE ' + st.readings.feox + ' · SUN ' + st.readings.sunHours + ' · SLOPE ' + st.readings.slopePct + '%',
        sx + 13, sy + 32);
    }
  }

  // pad + player
  sctx.strokeStyle = 'rgba(255,186,100,0.9)';
  sctx.lineWidth = 3;
  sctx.strokeRect(toX(0) - 8, toY(0) - 8, 16, 16);
  sctx.fillStyle = 'rgba(255,186,100,0.7)';
  sctx.fillText('PAD', toX(0) + 14, toY(0) + 7);
  drawPlayer(sctx, toX(lastLocal.x), toY(lastLocal.z), lastHeading, 2.8);

  // adaptive scale bar: a tidy length that stays readable at any zoom
  const NICE = [500, 1000, 2000, 5000, 10000, 20000, 50000];
  let meters = NICE[NICE.length - 1];
  for (const n of NICE) { if (n / view.mPerPx >= 230) { meters = n; break; } }
  const bar = meters / view.mPerPx;
  sctx.strokeStyle = 'rgba(255,186,100,0.7)';
  sctx.lineWidth = 4;
  sctx.beginPath();
  sctx.moveTo(28, H - 30);
  sctx.lineTo(28 + bar, H - 30);
  sctx.stroke();
  sctx.fillText(meters >= 1000 ? (meters / 1000) + ' KM' : meters + ' M', 28, H - 44);
}

export function isMapOpen() { return sheetOpen; }
