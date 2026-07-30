// ground/terrain.js — chunked quadtree LOD over the real DEM.
//
// CPU-built heightfield chunks (33×33 verts + skirts) selected by
// distance: a node splits while it is larger than its distance to the
// camera. A node only hands over to its children once all four are
// built, so there is never a hole — you refine into detail, you never
// watch it pop into existence over a void. Normals come from the shared
// height function by central difference, so lighting is seamless across
// chunk boundaries regardless of LOD.

import * as THREE from 'three';
import { getConfig } from '../perf.js';
import { getSite, heightAt, normalAt, macroSlopeAt } from './site.js';
import { hashTint } from './palette.js';

const RES = 32;                 // quads per chunk side
const SPLIT_K = 1.15;           // split while size > dist × K
const CACHE_CAP = 420;          // built geometries kept around
const MAX_DEPTH = { high: 11, medium: 10, low: 9 };

let root = null;                // THREE.Group (the site root)
let material = null;
let cache = new Map();          // key → { mesh, lastUsed }
let buildQueue = [];            // node descriptors awaiting geometry
let queued = new Set();
let frame = 0;
let sizeRoot = 0, cx0 = 0, cz0 = 0;

export function initTerrain(parentGroup) {
  const site = getSite();
  // Root square covers the whole site, centered on the site's middle
  const w = site.maxX - site.minX, h = site.maxZ - site.minZ;
  sizeRoot = Math.max(w, h);
  cx0 = (site.minX + site.maxX) / 2;
  cz0 = (site.minZ + site.maxZ) / 2;

  material = new THREE.MeshStandardMaterial({
    map: site.albedo,
    vertexColors: true,
    roughness: 1.0,
    metalness: 0.0,
    // DoubleSide for the skirts' sake — a culled skirt is a see-through
    // seam from the wrong angle, and the overdraw cost here is small.
    side: THREE.DoubleSide,
  });

  root = new THREE.Group();
  parentGroup.add(root);

  // The root chunk is built synchronously — there is always ground.
  ensureBuilt(nodeKey(0, 0, 0), { d: 0, i: 0, j: 0 }, true);
}

export function disposeTerrain() {
  for (const { mesh } of cache.values()) {
    mesh.geometry.dispose();
    if (mesh.parent) mesh.parent.remove(mesh);
  }
  cache.clear();
  buildQueue = [];
  queued.clear();
  if (material) { material.dispose(); material = null; }
  root = null;
}

function nodeKey(d, i, j) { return d + '_' + i + '_' + j; }

function nodeGeom(d, i, j) {
  const size = sizeRoot / (1 << d);
  const x = cx0 - sizeRoot / 2 + (i + 0.5) * size;
  const z = cz0 - sizeRoot / 2 + (j + 0.5) * size;
  return { size, x, z };
}

// ── Selection ────────────────────────────────────────────────────────

/**
 * Walk the quadtree each frame: decide the wanted refinement, show the
 * deepest BUILT ancestor of every wanted leaf, queue what's missing.
 */
export function updateTerrain(camLocal) {
  if (!root) return;
  frame++;
  const maxDepth = MAX_DEPTH[currentTier()] ?? 10;
  const visible = [];
  selectNode(0, 0, 0, camLocal, maxDepth, visible);

  // Swap visibility: mark-and-sweep against last frame
  for (const { mesh } of cache.values()) mesh.visible = false;
  for (const key of visible) {
    const e = cache.get(key);
    if (e) { e.mesh.visible = true; e.lastUsed = frame; }
  }

  // Build a few queued chunks per frame, nearest first
  const budget = (getConfig().chunksPerFrame || 2);
  if (buildQueue.length) {
    buildQueue.sort((a, b) => a.prio - b.prio);
    for (let n = 0; n < budget && buildQueue.length; n++) {
      const job = buildQueue.shift();
      queued.delete(job.key);
      ensureBuilt(job.key, job, false);
    }
  }

  // Evict least-recently-used invisible chunks beyond the cap
  if (cache.size > CACHE_CAP) {
    const entries = [...cache.entries()]
      .filter(([, e]) => !e.mesh.visible && e.depth > 0)
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    let over = cache.size - CACHE_CAP;
    for (const [key, e] of entries) {
      if (over-- <= 0) break;
      e.mesh.geometry.dispose();
      root.remove(e.mesh);
      cache.delete(key);
    }
  }
}

export function debugTerrain() {
  let vis = 0;
  for (const e of cache.values()) if (e.mesh.visible) vis++;
  return { cache: cache.size, queue: buildQueue.length, visible: vis, tier: currentTier() };
}

function currentTier() {
  const cfg = getConfig();
  return cfg.terrainMaxDepth >= 15 ? 'high' : cfg.terrainMaxDepth >= 12 ? 'medium' : 'low';
}

function selectNode(d, i, j, cam, maxDepth, visible) {
  const { size, x, z } = nodeGeom(d, i, j);
  // Distance from camera to the node's footprint (closest point, 2.5D)
  const dx = Math.max(Math.abs(cam.x - x) - size / 2, 0);
  const dz = Math.max(Math.abs(cam.z - z) - size / 2, 0);
  const dist = Math.hypot(dx, dz, cam.y * 0.35);

  const wantSplit = d < maxDepth && size > dist * SPLIT_K;
  if (wantSplit) {
    // Children may only take over once ALL FOUR are built
    const kids = [[2 * i, 2 * j], [2 * i + 1, 2 * j], [2 * i, 2 * j + 1], [2 * i + 1, 2 * j + 1]];
    let ready = true;
    for (const [ci, cj] of kids) {
      if (!cache.has(nodeKey(d + 1, ci, cj))) {
        requestBuild(d + 1, ci, cj, dist);
        ready = false;
      }
    }
    if (ready) {
      for (const [ci, cj] of kids) selectNode(d + 1, ci, cj, cam, maxDepth, visible);
      return;
    }
  }
  const key = nodeKey(d, i, j);
  if (cache.has(key)) {
    visible.push(key);
  } else {
    requestBuild(d, i, j, dist);
    // A missing non-root node means its parent stays visible via the
    // caller's ready-gate — nothing to do here.
  }
}

function requestBuild(d, i, j, prio) {
  const key = nodeKey(d, i, j);
  if (cache.has(key) || queued.has(key)) return;
  queued.add(key);
  buildQueue.push({ key, d, i, j, prio });
}

// ── Chunk geometry ───────────────────────────────────────────────────

function ensureBuilt(key, { d, i, j }, sync) {
  if (cache.has(key)) return;
  const { size, x: cx, z: cz } = nodeGeom(d, i, j);
  const site = getSite();
  const step = size / RES;
  const minLambda = step * 2;        // don't alias detail finer than the mesh
  const half = size / 2;
  // Clamped hard: a skirt scaled to a 100 km root chunk is a 2 km deep
  // curtain slicing through the canyon floor at LOD boundaries.
  const skirtDrop = Math.min(45, Math.max(1.5, size * 0.02));

  const side = RES + 1;
  const gridCount = side * side;
  const skirtCount = side * 4;
  const total = gridCount + skirtCount;

  const pos = new Float32Array(total * 3);
  const nrm = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  const col = new Float32Array(total * 3);

  const spanX = site.maxX - site.minX;
  const spanZ = site.maxZ - site.minZ;
  const n = new THREE.Vector3();

  for (let jz = 0; jz < side; jz++) {
    for (let ix = 0; ix < side; ix++) {
      const vi = jz * side + ix;
      const x = cx - half + ix * step;
      const z = cz - half + jz * step;
      const y = heightAt(x, z, minLambda);
      pos[vi * 3] = x; pos[vi * 3 + 1] = y; pos[vi * 3 + 2] = z;
      normalAt(x, z, Math.max(step, 2), minLambda, n);
      nrm[vi * 3] = n.x; nrm[vi * 3 + 1] = n.y; nrm[vi * 3 + 2] = n.z;
      // Site-global UV into the Viking albedo
      uv[vi * 2] = (x - site.minX) / spanX;
      uv[vi * 2 + 1] = 1 - (z - site.minZ) / spanZ;
      // Hand tint: darker debris on steep ground, faint speckle
      const t = hashTint(x, z, macroSlopeAt(x, z));
      col[vi * 3] = t[0]; col[vi * 3 + 1] = t[1]; col[vi * 3 + 2] = t[2];
    }
  }

  // Skirts: copy each edge vertex, dropped down — hides LOD seams
  const edges = [];
  for (let ix = 0; ix < side; ix++) edges.push(ix);                    // north row
  for (let ix = 0; ix < side; ix++) edges.push((side - 1) * side + ix); // south row
  for (let jz = 0; jz < side; jz++) edges.push(jz * side);              // west col
  for (let jz = 0; jz < side; jz++) edges.push(jz * side + side - 1);   // east col
  for (let k = 0; k < skirtCount; k++) {
    const src = edges[k], dst = gridCount + k;
    pos[dst * 3] = pos[src * 3];
    pos[dst * 3 + 1] = pos[src * 3 + 1] - skirtDrop;
    pos[dst * 3 + 2] = pos[src * 3 + 2];
    nrm[dst * 3] = nrm[src * 3]; nrm[dst * 3 + 1] = nrm[src * 3 + 1]; nrm[dst * 3 + 2] = nrm[src * 3 + 2];
    uv[dst * 2] = uv[src * 2]; uv[dst * 2 + 1] = uv[src * 2 + 1];
    col[dst * 3] = col[src * 3]; col[dst * 3 + 1] = col[src * 3 + 1]; col[dst * 3 + 2] = col[src * 3 + 2];
  }

  const idx = [];
  for (let jz = 0; jz < RES; jz++) {
    for (let ix = 0; ix < RES; ix++) {
      const a = jz * side + ix, b = a + 1, c = a + side, dd = c + 1;
      idx.push(a, c, b, b, c, dd);
    }
  }
  // Skirt quads (edge vertex k ↔ skirt vertex gridCount+k, consecutive pairs)
  const seg = (base, sA, sB, flip) => {
    const a = edges[sA], b = edges[sB], a2 = gridCount + sA, b2 = gridCount + sB;
    if (flip) idx.push(a, b, a2, b, b2, a2);
    else idx.push(a, a2, b, b, a2, b2);
  };
  for (let k = 0; k < side - 1; k++) seg(0, k, k + 1, false);                       // north
  for (let k = 0; k < side - 1; k++) seg(0, side + k, side + k + 1, true);          // south
  for (let k = 0; k < side - 1; k++) seg(0, 2 * side + k, 2 * side + k + 1, true);  // west
  for (let k = 0; k < side - 1; k++) seg(0, 3 * side + k, 3 * side + k + 1, false); // east

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeBoundingSphere();

  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = true;
  mesh.visible = false;
  root.add(mesh);
  cache.set(key, { mesh, lastUsed: frame, depth: d });
}
