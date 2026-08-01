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
import { getSite, heightAt, normalAt, macroSlopeAt, cavityAt } from './site.js';
import { hashTint } from './palette.js';

const RES = 32;                 // quads per chunk side
const SPLIT_K = 1.35;           // split while size > dist × K
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

  // Lambert, not Standard: PBR grazing-angle Fresnel put a wet sheen
  // on sunward crest lines at low sun — bright contour-following
  // filaments on bone-dry dust. Diffuse-only is the truthful BRDF here.
  material = new THREE.MeshLambertMaterial({
    map: site.albedo,
    vertexColors: true,
    // DoubleSide for the skirts' sake — a culled skirt is a see-through
    // seam from the wrong angle, and the overdraw cost here is small.
    side: THREE.DoubleSide,
  });
  // Near-field grain: vertex density can never carry sub-meter texture,
  // so the last 200 m to the eye gets a world-anchored detail noise
  // (two octaves, fading with view distance so the far field keeps the
  // photograph's color). Chunk positions are site-local and static —
  // the grain never swims under camera-relative rendering.
  const detailTex = makeDetailTexture();
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uDetail = { value: detailTex };
    shader.uniforms.uNow = { value: 0 };
    material.userData.shader = shader;
    // Geomorph: every refined chunk carries the coarse height/normal it
    // replaced and blends to its own over ~0.8 s from first showing —
    // detail ARRIVES instead of popping.
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>',
        '#include <common>\nvarying vec2 vSitePos;\nvarying float vViewZ;' +
        '\nattribute float aCoarseY;\nattribute vec3 aCoarseNrm;\nattribute float aBirth;\nuniform float uNow;')
      .replace('#include <beginnormal_vertex>',
        '#include <beginnormal_vertex>\nfloat mf = clamp((uNow - aBirth) / 0.8, 0.0, 1.0);\nmf = mf * mf * (3.0 - 2.0 * mf);\nobjectNormal = normalize(mix(aCoarseNrm, objectNormal, mf));')
      .replace('#include <begin_vertex>',
        '#include <begin_vertex>\ntransformed.y = mix(aCoarseY, transformed.y, mf);')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvSitePos = position.xz;\nvViewZ = -mvPosition.z;');
    shader.uniforms.uRamp = { value: makePaletteRamp() };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uDetail;\nuniform sampler2D uRamp;\nvarying vec2 vSitePos;\nvarying float vViewZ;')
      .replace('#include <map_fragment>', '#include <map_fragment>\n{\n  float dn = texture2D(uDetail, vSitePos / 2.6).r * 0.62 + texture2D(uDetail, vSitePos / 17.0).r * 0.38;\n  float dfade = exp(-vViewZ / 220.0);\n  diffuseColor.rgb *= mix(1.0, 0.72 + 0.54 * dn, dfade);\n}')
      .replace('#include <opaque_fragment>',
        '#include <opaque_fragment>\n{\n  float lum = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));\n' +
        '  vec3 graded = texture2D(uRamp, vec2(clamp(pow(lum, 0.85), 0.004, 0.996), 0.5)).rgb;\n' +
        '  gl_FragColor.rgb = mix(gl_FragColor.rgb, graded, 0.55);\n}');
  };

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

// The palette ramp — the WoW trick: shading is remapped through ONE
// hand-authored gradient, so every pixel of the ground lives in the
// same painting. Shadows cool toward violet-maroon, midtones burn
// sienna, highlights warm to peach-gold.
export function makePaletteRamp() {
  const stops = [
    [0.00, 0x1a0d12],   // deepest shade: cool maroon-violet
    [0.18, 0x3a1c1a],
    [0.38, 0x6b3524],   // burnt sienna body
    [0.58, 0x9c5a33],
    [0.78, 0xd18a52],   // sun-warmed dust
    [0.92, 0xf0b87e],
    [1.00, 0xffe0b0],   // rim light gold
  ];
  const c = document.createElement('canvas');
  c.width = 256; c.height = 1;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 256, 0);
  for (const [t, hex] of stops) grad.addColorStop(t, '#' + hex.toString(16).padStart(6, '0'));
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 1);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

// Tileable two-tone grain: value noise + rock speckle, generated once.
function makeDetailTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  const h = (x, y) => {
    let n = ((x * 374761393 + y * 668265263) | 0);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      // torus-wrapped value noise at two scales for tileability
      let v = 0;
      for (const sc of [8, 32]) {
        const fx = (x / S) * sc, fy = (y / S) * sc;
        const ix = Math.floor(fx), iy = Math.floor(fy);
        const tx = fx - ix, ty = fy - iy;
        const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
        const w = (a, b) => ((a % sc) + sc) % sc * 1000 + ((b % sc) + sc) % sc;
        const n00 = h(w(ix, iy), sc), n10 = h(w(ix + 1, iy), sc);
        const n01 = h(w(ix, iy + 1), sc), n11 = h(w(ix + 1, iy + 1), sc);
        v += (n00 + (n10 - n00) * sx) * (1 - sy) + (n01 + (n11 - n01) * sx) * sy;
      }
      v *= 0.5;
      // wind ripples: crests run north-south (the canyon wind is E-W),
      // wandering with the grain noise — sub-meter at close range and,
      // via the coarser sample scale, reading as mega-ripples farther out
      const warp = v * 2.4;
      const ripple = Math.pow(Math.sin((x / S) * Math.PI * 2 * 3 + warp) * 0.5 + 0.5, 1.6);
      v = v * 0.72 + ripple * 0.28;
      // sparse dark pebbles
      if (h(x * 7 + 3, y * 13 + 1) > 0.985) v *= 0.55;
      const b = Math.round(90 + v * 165);
      const i = (y * S + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
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

  const nowS = performance.now() / 1000;
  if (material && material.userData.shader) material.userData.shader.uniforms.uNow.value = nowS;

  // Swap visibility: mark-and-sweep against last frame
  for (const { mesh } of cache.values()) mesh.visible = false;
  for (const key of visible) {
    const e = cache.get(key);
    if (e) {
      if (!e.mesh.visible && !e.everShown) {
        // birth stamp on first showing — the morph starts when the
        // eyes first see it, not when the worker built it
        const b = e.mesh.geometry.attributes.aBirth;
        if (b) { b.array.fill(nowS); b.needsUpdate = true; }
        e.everShown = true;
      }
      e.mesh.visible = true;
      e.lastUsed = frame;
    }
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
  const coarseY = new Float32Array(total);
  const coarseN = new Float32Array(total * 3);
  const birth = new Float32Array(total);   // stamped on first showing
  const minLambdaC = minLambda * 2;        // what the parent carried

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
      // Half-step epsilon: full-step normals average away the wall's
      // fluted spurs at distance — the relief that sells the scale.
      normalAt(x, z, Math.max(step * 0.5, 1.5), minLambda, n);
      nrm[vi * 3] = n.x; nrm[vi * 3 + 1] = n.y; nrm[vi * 3 + 2] = n.z;
      coarseY[vi] = d === 0 ? y : heightAt(x, z, minLambdaC);
      if (d === 0) {
        coarseN[vi * 3] = n.x; coarseN[vi * 3 + 1] = n.y; coarseN[vi * 3 + 2] = n.z;
      } else {
        normalAt(x, z, Math.max(step, 3), minLambdaC, n);
        coarseN[vi * 3] = n.x; coarseN[vi * 3 + 1] = n.y; coarseN[vi * 3 + 2] = n.z;
      }
      // Site-global UV into the Viking albedo
      uv[vi * 2] = (x - site.minX) / spanX;
      uv[vi * 2 + 1] = 1 - (z - site.minZ) / spanZ;
      // Hand tint: darker debris on steep ground, faint speckle —
      // then the painter's pass: hollows shade down, crests pick up
      const t = hashTint(x, z, macroSlopeAt(x, z), y);
      const cav = cavityAt(x, z, Math.max(step * 1.5, 4), minLambda);
      const ao = 1 - Math.max(0, cav) * 0.34 + Math.max(0, -cav) * 0.18;
      col[vi * 3] = t[0] * ao; col[vi * 3 + 1] = t[1] * ao; col[vi * 3 + 2] = t[2] * ao;
    }
  }

  // Skirts as outward-sloped APRONS: a vertical curtain can't seal the
  // wedge cracks that open ABOVE a fine edge against a coarse
  // neighbor's straight edge — backlit by a low sun they sparkled as
  // bright dash strings along every LOD ring. Leaning the flap outward
  // by half a cell closes the seam from both sides.
  const apron = step * 0.55;
  const edges = [];
  const edgeDir = [];   // outward xz direction per skirt vertex
  for (let ix = 0; ix < side; ix++) { edges.push(ix); edgeDir.push([0, -1]); }                     // north row
  for (let ix = 0; ix < side; ix++) { edges.push((side - 1) * side + ix); edgeDir.push([0, 1]); }  // south row
  for (let jz = 0; jz < side; jz++) { edges.push(jz * side); edgeDir.push([-1, 0]); }              // west col
  for (let jz = 0; jz < side; jz++) { edges.push(jz * side + side - 1); edgeDir.push([1, 0]); }    // east col
  for (let k = 0; k < skirtCount; k++) {
    const src = edges[k], dst = gridCount + k;
    const ox = pos[src * 3] + edgeDir[k][0] * apron;
    const oz = pos[src * 3 + 2] + edgeDir[k][1] * apron;
    pos[dst * 3] = ox;
    pos[dst * 3 + 1] = pos[src * 3 + 1] - skirtDrop;
    pos[dst * 3 + 2] = oz;
    // Shade the flap like the ground BEYOND the edge — a flap lit as
    // "up-facing" on a backlit slope reads as a bright dash string.
    normalAt(ox, oz, Math.max(step * 0.5, 1.5), minLambda, n);
    nrm[dst * 3] = n.x; nrm[dst * 3 + 1] = n.y; nrm[dst * 3 + 2] = n.z;
    coarseY[dst] = pos[dst * 3 + 1];
    coarseN[dst * 3] = n.x; coarseN[dst * 3 + 1] = n.y; coarseN[dst * 3 + 2] = n.z;
    uv[dst * 2] = (ox - site.minX) / spanX;
    uv[dst * 2 + 1] = 1 - (oz - site.minZ) / spanZ;
    const t = hashTint(ox, oz, macroSlopeAt(ox, oz), pos[src * 3 + 1]);
    col[dst * 3] = t[0]; col[dst * 3 + 1] = t[1]; col[dst * 3 + 2] = t[2];
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
  geo.setAttribute('aCoarseY', new THREE.BufferAttribute(coarseY, 1));
  geo.setAttribute('aCoarseNrm', new THREE.BufferAttribute(coarseN, 3));
  geo.setAttribute('aBirth', new THREE.BufferAttribute(birth, 1));
  geo.setIndex(idx);
  geo.computeBoundingSphere();

  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = true;
  mesh.visible = false;
  root.add(mesh);
  cache.set(key, { mesh, lastUsed: frame, depth: d });
}
