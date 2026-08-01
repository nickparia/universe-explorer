// ground/rocks.js — the ground's own furniture.
//
// An instanced field of stones streaming around the traveler: mostly
// fist-to-knee sized, a scatter of boulders, denser where debris
// gathers at the foot of slopes. Rocks are what make ground read as
// GROUND — optic flow when you move, parallax at every step, a scale
// anchor against a canyon whose real landmarks are kilometers away.
// Deterministic per tile: the same stone is always in the same place.

import * as THREE from 'three';
import { heightAt, macroSlopeAt } from './site.js';
import { makePaletteRamp } from './terrain.js';

const TILE = 48;             // m — placement tile
const RADIUS_TILES = 8;      // stream small rocks within ~380 m
const BOULDER_TILES = 26;    // the big ones live ~1.2 km out — no pop
const MAX_ROCKS = 2600;
const MAX_BOULDERS = 420;

let mesh = null;
let bmesh = null;
let curTX = null, curTZ = null;
const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _c = new THREE.Color();

function h32(a, b, c) {
  let h = (a * 374761393 + b * 668265263 + c * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function makeRockGeometry() {
  // Fractured, not tumbled: displacement quantized to a few levels
  // carves flat facets, and flat shading keeps the edges hard —
  // basaltic float rock, the kind every rover image is littered with.
  let g = new THREE.IcosahedronGeometry(1, 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const hraw = h32((x * 97) | 0, (y * 89) | 0, (z * 83) | 0);
    const k = 0.78 + 0.36 * (Math.floor(hraw * 4) / 3);
    p.setXYZ(i, x * k, y * k * 0.8, z * k);
  }
  g = g.toNonIndexed();
  g.computeVertexNormals();   // non-indexed → true flat facets
  return g;
}

export function initRocks(parentGroup) {
  const geo = makeRockGeometry();
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  // Props live inside the same painting: the terrain's palette ramp
  // grades the stones too, so ground and rock never disagree.
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRamp = { value: makePaletteRamp() };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uRamp;')
      .replace('#include <opaque_fragment>',
        '#include <opaque_fragment>\n{\n  float lum = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));\n' +
        '  vec3 graded = texture2D(uRamp, vec2(clamp(pow(lum, 0.85), 0.004, 0.996), 0.5)).rgb;\n' +
        '  gl_FragColor.rgb = mix(gl_FragColor.rgb, graded, 0.5);\n}');
  };
  mesh = new THREE.InstancedMesh(geo, mat, MAX_ROCKS);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  parentGroup.add(mesh);
  bmesh = new THREE.InstancedMesh(geo, mat, MAX_BOULDERS);
  bmesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  bmesh.frustumCulled = false;
  parentGroup.add(bmesh);
  curTX = null; curTZ = null;
}

export function disposeRocks() {
  if (mesh) {
    mesh.geometry.dispose();
    mesh.material.dispose();
    if (mesh.parent) mesh.parent.remove(mesh);
  }
  if (bmesh && bmesh.parent) bmesh.parent.remove(bmesh);
  mesh = null;
  bmesh = null;
}

// One deterministic placement stream per tile; small stones go to the
// near mesh, boulders (u ≥ 0.985) to the far one — same hashes, so a
// boulder seen from 1.2 km is the same boulder you park beside.
function placeTile(gx, gz, target, isBoulderPass, n, cap) {
  const cx = (gx + 0.5) * TILE, cz = (gz + 0.5) * TILE;
  const slope = macroSlopeAt(cx, cz);
  const cluster = Math.pow(0.25 + 1.55 * h32(gx >> 2, gz >> 2, 99), 1.6);
  const density = (5 + Math.min(9, slope * 24) * (1 - Math.min(1, Math.max(0, slope - 0.4) * 3))) * cluster;
  const count = Math.floor(density * (0.35 + 1.3 * h32(gx, gz, 7)));
  for (let i = 0; i < count && n < cap; i++) {
    const rx = (gx + h32(gx, gz, i * 3 + 1)) * TILE;
    const rz = (gz + h32(gx, gz, i * 3 + 2)) * TILE;
    const u = h32(gx, gz, i * 3 + 3);
    const boulder = u >= 0.985;
    if (boulder !== isBoulderPass) continue;
    // The landing pad stays clean — nobody sets down in a boulder
    if (rx * rx + rz * rz < 24 * 24) continue;
    const s = u < 0.86 ? 0.12 + u * 0.5 : u < 0.985 ? 0.6 + (u - 0.86) * 6 : 2.2 + (u - 0.985) * 160;
    const y = heightAt(rx, rz) + s * 0.22;
    _p.set(rx, y, rz);
    _e.set(h32(gx, gz, i + 11) * Math.PI, h32(gx, gz, i + 13) * Math.PI * 2, h32(gx, gz, i + 17) * Math.PI);
    _q.setFromEuler(_e);
    _s.set(s * (0.75 + h32(gx, gz, i + 19) * 0.6), s * (0.6 + h32(gx, gz, i + 23) * 0.5), s * (0.75 + h32(gx, gz, i + 29) * 0.6));
    _m.compose(_p, _q, _s);
    target.setMatrixAt(n, _m);
    const v = 0.55 + h32(gx, gz, i + 31) * 0.45;
    const dark = h32(gx, gz, i + 37) < 0.18 ? 0.5 : 1;
    _c.setRGB(0.20 * v * dark, 0.145 * v * dark, 0.112 * v * dark);
    target.setColorAt(n, _c);
    n++;
  }
  return n;
}

export function updateRocks(camLocal) {
  if (!mesh) return;
  const tx = Math.floor(camLocal.x / TILE);
  const tz = Math.floor(camLocal.z / TILE);
  if (tx === curTX && tz === curTZ) return;
  curTX = tx; curTZ = tz;

  let n = 0;
  for (let dz = -RADIUS_TILES; dz <= RADIUS_TILES && n < MAX_ROCKS; dz++) {
    for (let dx = -RADIUS_TILES; dx <= RADIUS_TILES && n < MAX_ROCKS; dx++) {
      if (dx * dx + dz * dz > RADIUS_TILES * RADIUS_TILES) continue;
      n = placeTile(tx + dx, tz + dz, mesh, false, n, MAX_ROCKS);
    }
  }
  _m.makeScale(0, 0, 0);
  for (let i = n; i < MAX_ROCKS; i++) mesh.setMatrixAt(i, _m);
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  let b = 0;
  for (let dz = -BOULDER_TILES; dz <= BOULDER_TILES && b < MAX_BOULDERS; dz++) {
    for (let dx = -BOULDER_TILES; dx <= BOULDER_TILES && b < MAX_BOULDERS; dx++) {
      if (dx * dx + dz * dz > BOULDER_TILES * BOULDER_TILES) continue;
      b = placeTile(tx + dx, tz + dz, bmesh, true, b, MAX_BOULDERS);
    }
  }
  _m.makeScale(0, 0, 0);
  for (let i = b; i < MAX_BOULDERS; i++) bmesh.setMatrixAt(i, _m);
  bmesh.instanceMatrix.needsUpdate = true;
  if (bmesh.instanceColor) bmesh.instanceColor.needsUpdate = true;
}
