// ground/site.js — the real ground under your boots.
//
// Loads a baked groundside site (see tools/mars-dem/): a genuine
// HRSC/MOLA elevation grid plus Viking color for the same window of
// Mars. Exposes ONE height function used by both the terrain mesher and
// the walk collision — the land you see is exactly the land you stand
// on, per Pillar 5 of docs/LOOP.md. Everything below the DEM's 200 m
// grid is synthesized micro-relief: deterministic, tuned by hand, and
// derived FROM the real macro shape (debris grows on real slopes) — the
// signature of the place stays NASA's.
//
// Local frame: origin at the landing point, x = east, z = south,
// y = up, in meters, elevation relative to the landing elevation.

import * as THREE from 'three';

let site = null; // { meta, dem (Float32Array), cols, rows, ... }

// ── Deterministic 2D value noise ─────────────────────────────────────
function hash2(ix, iz) {
  let h = (ix * 374761393 + iz * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return (a + (b - a) * sx) * (1 - sz) + (c + (d - c) * sx) * sz;
}

// Ridged variant — sharp crests for rocky wall texture
function rnoise(x, z) {
  return 1 - Math.abs(vnoise(x, z) * 2 - 1);
}

// ── Load ─────────────────────────────────────────────────────────────

export async function loadSite() {
  if (site) return site;
  const base = 'locations/mars-valles/';
  const meta = await (await fetch(base + 'site_v2.json')).json();
  const buf = await (await fetch(base + meta.files.dem)).arrayBuffer();
  const raw = new Int16Array(buf);
  const dem = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) dem[i] = raw[i];

  // The HiRISE layer: real ONE-METER elevation for the patch around
  // the bootfall — NASA's stereo terrain where the boots actually
  // stand. Everything outside it falls back to the 200 m blend.
  let hi = null;
  if (meta.files.hidem) {
    const hbuf = await (await fetch(base + meta.files.hidem)).arrayBuffer();
    const hraw = new Int16Array(hbuf);
    const h = meta.hires;
    const hdem = new Float32Array(hraw.length);
    // stored as decimeters relative to hires.elevBase to keep int16
    for (let i = 0; i < hraw.length; i++) hdem[i] = h.elevBase + hraw[i] * 0.1;
    hi = {
      dem: hdem, cols: h.cols, rows: h.rows,
      x0: h.x0, z0: h.z0, mpp: h.mPerPx,
      x1: h.x0 + (h.cols - 1) * h.mPerPx,
      z1: h.z0 + (h.rows - 1) * h.mPerPx,
      feather: 220,
    };
  }

  const albedo = await new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(base + meta.files.albedo, resolve, undefined, reject);
  });
  albedo.colorSpace = THREE.SRGBColorSpace;
  albedo.wrapS = albedo.wrapT = THREE.ClampToEdgeWrapping;
  albedo.anisotropy = 4;

  const g = meta.grid;
  const [lpx, lpy] = meta.landing.px;
  site = {
    meta,
    dem,
    hi,
    albedo,
    cols: g.cols,
    rows: g.rows,
    dx: g.mPerPxEW,
    dz: g.mPerPxNS,
    landingElev: meta.landing.elev,
    lpx, lpy,
    // local-frame bounds (meters from the landing point)
    minX: -lpx * g.mPerPxEW,
    maxX: (g.cols - 1 - lpx) * g.mPerPxEW,
    minZ: -lpy * g.mPerPxNS,
    maxZ: (g.rows - 1 - lpy) * g.mPerPxNS,
  };
  return site;
}

export function getSite() { return site; }

// ── Elevation ────────────────────────────────────────────────────────

// Bilinear sample of the real DEM, local frame, meters. Clamps at the
// site edge — the last kilometers vanish under haze before you reach it.
function demAt(x, z) {
  const s = site;
  let cx = s.lpx + x / s.dx;
  let cz = s.lpy + z / s.dz;
  if (cx < 0) cx = 0; else if (cx > s.cols - 1.001) cx = s.cols - 1.001;
  if (cz < 0) cz = 0; else if (cz > s.rows - 1.001) cz = s.rows - 1.001;
  const ix = Math.floor(cx), iz = Math.floor(cz);
  const fx = cx - ix, fz = cz - iz;
  const i0 = iz * s.cols + ix;
  const a = s.dem[i0], b = s.dem[i0 + 1];
  const c = s.dem[i0 + s.cols], d = s.dem[i0 + s.cols + 1];
  return (a + (b - a) * fx) * (1 - fz) + (c + (d - c) * fx) * fz
    - s.landingElev;
}

// Macro slope (rise/run) from the DEM alone — drives micro-relief
// character and the material tint. Cheap central difference at grid scale.
export function macroSlopeAt(x, z) {
  const e = 200;
  const gx = (demAt(x + e, z) - demAt(x - e, z)) / (2 * e);
  const gz = (demAt(x, z + e) - demAt(x, z - e)) / (2 * e);
  return Math.hypot(gx, gz);
}

// Micro-relief octaves: [wavelength m, amplitude m, ridged?]
// The floor gets ripples and rubble; real slopes grow rocky ridging so
// the interpolated 200 m walls read as stone instead of rubber.
const FLOOR_OCTAVES = [
  [140, 1.6, false],
  [46, 0.85, false],
  [11, 0.45, false],
  [2.7, 0.16, false],
  [1.1, 0.05, false],
];
const SLOPE_OCTAVES = [
  [120, 6.0, true],
  [34, 2.2, true],
  [8, 0.5, false],
];

// Bilinear over the HiRISE patch; returns weight 0 outside, feathered
// at the rectangle edge so the 1 m world blends into the 200 m one.
// (Nodata wedges were pre-blended into the layer at bake time.)
function hiAt(x, z) {
  const hi = site.hi;
  if (!hi) return { h: 0, w: 0 };
  const ex = Math.min(x - hi.x0, hi.x1 - x);
  const ez = Math.min(z - hi.z0, hi.z1 - z);
  if (ex <= 0 || ez <= 0) return { h: 0, w: 0 };
  const w = Math.min(1, Math.min(ex, ez) / hi.feather);
  let cx = (x - hi.x0) / hi.mpp;
  let cz = (z - hi.z0) / hi.mpp;
  if (cx > hi.cols - 1.001) cx = hi.cols - 1.001;
  if (cz > hi.rows - 1.001) cz = hi.rows - 1.001;
  const ix = Math.floor(cx), iz = Math.floor(cz);
  const fx = cx - ix, fz = cz - iz;
  const i0 = iz * hi.cols + ix;
  const a = hi.dem[i0], b = hi.dem[i0 + 1];
  const c = hi.dem[i0 + hi.cols], d = hi.dem[i0 + hi.cols + 1];
  const h = (a + (b - a) * fx) * (1 - fz) + (c + (d - c) * fx) * fz
    - site.landingElev;
  return { h, w };
}

/**
 * The height function. minLambda gates octaves for LOD meshing (skip
 * detail finer than ~2 vertex spacings); pass 0 for collision truth.
 */
export function heightAt(x, z, minLambda = 0) {
  let h = demAt(x, z);
  // Where NASA measured the ground at one meter, NASA wins — and the
  // synthetic octaves stand down for every wavelength the real data
  // already carries.
  let hiW = 0;
  if (site.hi) {
    const s = hiAt(x, z);
    if (s.w > 0) { h = h * (1 - s.w) + s.h * s.w; hiW = s.w; }
  }
  const slope = macroSlopeAt(x, z);
  const sK = Math.min(1, slope * 2.2);        // 0 on the floor, 1 on walls
  // Domain warp: sample the octaves through a slowly wandering
  // distortion so ripples meander like wind-worked ground instead of
  // repeating on a lattice — unwarped value noise reads as CG.
  const wx = x + 48 * (vnoise(x / 230, z / 230) - 0.5) * 2;
  const wz = z + 48 * (vnoise((x + 911) / 230, (z - 347) / 230) - 0.5) * 2;
  // Octaves fade smoothly toward the LOD cutoff instead of hard-
  // stopping: a hard break gave adjacent LOD rings meter-scale height
  // steps that read as dark dash artifacts along every seam.
  for (const [lam, amp, ridged] of FLOOR_OCTAVES) {
    const k = lodFade(lam, minLambda) * (lam > 3.5 ? 1 - hiW * 0.9 : 1);
    if (k <= 0) continue;
    const n = vnoise(wx / lam, wz / lam);
    h += (n - 0.5) * 2 * amp * k * (1 - sK * 0.55);
  }
  for (const [lam, amp, ridged] of SLOPE_OCTAVES) {
    const k = lodFade(lam, minLambda) * (lam > 3.5 ? 1 - hiW * 0.9 : 1);
    if (k <= 0) continue;
    const n = ridged ? rnoise(wx / lam, wz / lam) : vnoise(wx / lam, wz / lam);
    h += (ridged ? (n - 0.62) : (n - 0.5) * 2) * amp * k * sK;
  }
  return h;
}

function lodFade(lam, minLambda) {
  if (minLambda <= 0) return 1;
  return Math.max(0, Math.min(1, lam / minLambda - 1));
}

/** Surface normal by central difference, consistent across chunk seams. */
export function normalAt(x, z, eps = 2.0, minLambda = 0, out = null) {
  const hx0 = heightAt(x - eps, z, minLambda);
  const hx1 = heightAt(x + eps, z, minLambda);
  const hz0 = heightAt(x, z - eps, minLambda);
  const hz1 = heightAt(x, z + eps, minLambda);
  const n = out || new THREE.Vector3();
  n.set(hx0 - hx1, 2 * eps, hz0 - hz1).normalize();
  return n;
}
