// ground/map.js — the suit's chart.
//
// Drawn from the site's own elevation data — a real topographic map of
// a real place, in the ship's amber phosphor. A small chart rides the
// top-right of the visor; M unfolds the full sheet (the same key that
// opens the star chart aboard — on the ground, the chart shows the
// ground). Player arrow, the landing pad, the HiRISE survey patch,
// a graticule in kilometers. No fog of war — the ship surveyed this
// site from orbit; that's how you chose it.

import * as THREE from 'three';
import { getSite } from './site.js';
import { getStakes, getSurveyRadius } from './stakes.js';

const MONO = "'SF Mono','Cascadia Mono','JetBrains Mono',Menlo,Consolas,'Courier New',monospace";

let baseCanvas = null;      // prerendered amber hillshade of the site
let mini = null, mctx = null;
let sheet = null, sheetCanvas = null, sctx = null;
let sheetOpen = false;
let keyFn = null;
const MINI = 172;           // px
const MINI_SPAN = 9000;     // m across the small chart

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

  // The full sheet
  sheet = document.createElement('div');
  sheet.style.cssText =
    'position:fixed;inset:0;z-index:200;display:none;align-items:center;justify-content:center;' +
    'background:rgba(4,2,1,0.82);backdrop-filter:blur(3px);';
  const inner = document.createElement('div');
  inner.style.cssText = 'position:relative;';
  sheetCanvas = document.createElement('canvas');
  sheetCanvas.style.cssText =
    'max-width:82vw;max-height:82vh;display:block;' +
    'box-shadow:0 0 0 1px rgba(255,186,100,0.3), 0 0 40px rgba(0,0,0,0.8);';
  inner.appendChild(sheetCanvas);
  const cap = document.createElement('div');
  cap.style.cssText =
    `font-family:${MONO};font-size:10px;letter-spacing:4px;color:rgba(255,186,100,0.6);` +
    'text-align:center;margin-top:10px;';
  cap.textContent = 'COPRATES CHASMA · SITE CHART · M CLOSE';
  inner.appendChild(cap);
  sheet.appendChild(inner);
  document.body.appendChild(sheet);

  keyFn = (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    if (e.code === 'KeyM') {
      // On the ground, the chart key shows the ground — the star
      // chart stays aboard. Capture phase beats the starmap listener.
      e.stopImmediatePropagation();
      e.preventDefault();
      sheetOpen = !sheetOpen;
      sheet.style.display = sheetOpen ? 'flex' : 'none';
    } else if (e.code === 'Escape' && sheetOpen) {
      sheetOpen = false;
      sheet.style.display = 'none';
    }
  };
  window.addEventListener('keydown', keyFn, true);
}

export function disposeGroundMap() {
  window.removeEventListener('keydown', keyFn, true);
  for (const el of [mini, sheet]) if (el && el.parentNode) el.parentNode.removeChild(el);
  mini = null; mctx = null; sheet = null; sheetCanvas = null; sctx = null;
  baseCanvas = null; sheetOpen = false;
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
  if (roving) {
    mini.style.top = '';
    mini.style.bottom = '128px';
    mini.style.right = '30px';
    mini.style.borderRadius = '10px';
    mini.style.boxShadow =
      '0 0 0 5px rgba(26,22,18,0.95), 0 0 0 7px rgba(210,195,165,0.4), 0 6px 18px rgba(0,0,0,0.6)';
  } else {
    mini.style.bottom = '';
    mini.style.top = '16px';
    mini.style.right = '18px';
    mini.style.borderRadius = '50%';
    mini.style.boxShadow = '0 0 0 1px rgba(255,186,100,0.28), 0 0 18px rgba(0,0,0,0.55)';
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
  // dark phosphor glass over it
  mctx.fillStyle = 'rgba(10,5,2,0.25)';
  mctx.fillRect(0, 0, S, S);
  // surveyed ground: verified circles glow faintly on the glass
  const pxPerM = (S / spanPx) * b.sx;
  for (const st of getStakes()) {
    const sb = worldToBase(st.x, st.z);
    const sx = S / 2 + (sb.x - b.x) * (S / spanPx);
    const sy = S / 2 + (sb.y - b.y) * (S / spanPx);
    const rr = getSurveyRadius() * pxPerM;
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
  // north tick
  mctx.fillStyle = 'rgba(255,186,100,0.8)';
  mctx.font = `bold 13px ${MONO}`;
  mctx.textAlign = 'center';
  mctx.fillText('N', S / 2, 18);
  mctx.restore();

  // ── the sheet, when unfolded ──
  if (sheetOpen && sheetCanvas) {
    if (sheetCanvas.width !== baseCanvas.width) {
      sheetCanvas.width = baseCanvas.width;
      sheetCanvas.height = baseCanvas.height;
    }
    sctx = sheetCanvas.getContext('2d');
    sctx.drawImage(baseCanvas, 0, 0);
    // graticule every 10 km
    const site = getSite();
    sctx.strokeStyle = 'rgba(255,186,100,0.14)';
    sctx.fillStyle = 'rgba(255,186,100,0.4)';
    sctx.font = `10px ${MONO}`;
    sctx.lineWidth = 1;
    const mPerPxX = (site.maxX - site.minX) / baseCanvas.width;
    for (let km = Math.ceil(site.minX / 10000) * 10; km * 1 < site.maxX; km += 10000) {
      const gx = (km - site.minX) / mPerPxX;
      sctx.beginPath(); sctx.moveTo(gx, 0); sctx.lineTo(gx, baseCanvas.height); sctx.stroke();
    }
    const mPerPxY = (site.maxZ - site.minZ) / baseCanvas.height;
    for (let km = Math.ceil(site.minZ / 10000) * 10; km < site.maxZ; km += 10000) {
      const gy = (km - site.minZ) / mPerPxY;
      sctx.beginPath(); sctx.moveTo(0, gy); sctx.lineTo(baseCanvas.width, gy); sctx.stroke();
    }
    // HiRISE survey patch outline
    if (site.hi) {
      const a = worldToBase(site.hi.x0, site.hi.z0);
      const b2 = worldToBase(site.hi.x1, site.hi.z1);
      sctx.strokeStyle = 'rgba(180,220,255,0.35)';
      sctx.setLineDash([6, 5]);
      sctx.strokeRect(a.x, a.y, b2.x - a.x, b2.y - a.y);
      sctx.setLineDash([]);
      sctx.fillStyle = 'rgba(180,220,255,0.5)';
      sctx.fillText('1M SURVEY', a.x + 4, a.y - 5);
    }
    // surveyed ground on the sheet
    const rPx = getSurveyRadius() / mPerPxX;
    for (const st of getStakes()) {
      const sp = worldToBase(st.x, st.z);
      sctx.fillStyle = 'rgba(255,186,100,0.08)';
      sctx.beginPath(); sctx.arc(sp.x, sp.y, rPx, 0, Math.PI * 2); sctx.fill();
      sctx.strokeStyle = 'rgba(255,186,100,0.4)';
      sctx.lineWidth = 1;
      sctx.beginPath(); sctx.arc(sp.x, sp.y, rPx, 0, Math.PI * 2); sctx.stroke();
      sctx.fillStyle = 'rgba(255,206,130,0.95)';
      sctx.save(); sctx.translate(sp.x, sp.y); sctx.rotate(Math.PI / 4); sctx.fillRect(-2.5, -2.5, 5, 5); sctx.restore();
      sctx.fillStyle = 'rgba(255,186,100,0.75)';
      sctx.fillText('S' + st.n, sp.x + 7, sp.y + 4);
    }
    // pad + player
    const pd = worldToBase(0, 0);
    sctx.strokeStyle = 'rgba(255,186,100,0.9)';
    sctx.strokeRect(pd.x - 5, pd.y - 5, 10, 10);
    sctx.fillStyle = 'rgba(255,186,100,0.7)';
    sctx.fillText('PAD', pd.x + 8, pd.y + 4);
    const pp = worldToBase(local.x, local.z);
    drawPlayer(sctx, pp.x, pp.y, heading, 1.2);
    // scale bar: 20 km
    const bar = 20000 / mPerPxX;
    sctx.strokeStyle = 'rgba(255,186,100,0.7)';
    sctx.lineWidth = 2;
    sctx.beginPath();
    sctx.moveTo(24, baseCanvas.height - 20);
    sctx.lineTo(24 + bar, baseCanvas.height - 20);
    sctx.stroke();
    sctx.fillText('20 KM', 24, baseCanvas.height - 28);
  }
}

export function isMapOpen() { return sheetOpen; }
