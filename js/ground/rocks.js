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

const TILE = 48;             // m — placement tile
const RADIUS_TILES = 8;      // stream rocks within ~380 m
const MAX_ROCKS = 2600;

let mesh = null;
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
  const g = new THREE.IcosahedronGeometry(1, 2);
  const p = g.attributes.position;
  // Crumple the sphere into a stone — displace along the normal by a
  // hash of the vertex direction so shared vertices stay welded.
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 0.8 + 0.34 * h32((x * 97) | 0, (y * 89) | 0, (z * 83) | 0);
    p.setXYZ(i, x * k, y * k * 0.78, z * k);   // squat, sat-in-dust
  }
  g.computeVertexNormals();
  return g;
}

export function initRocks(parentGroup) {
  const geo = makeRockGeometry();
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  mesh = new THREE.InstancedMesh(geo, mat, MAX_ROCKS);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  parentGroup.add(mesh);
  curTX = null; curTZ = null;
}

export function disposeRocks() {
  if (mesh) {
    mesh.geometry.dispose();
    mesh.material.dispose();
    if (mesh.parent) mesh.parent.remove(mesh);
  }
  mesh = null;
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
      const gx = tx + dx, gz = tz + dz;
      const cx = (gx + 0.5) * TILE, cz = (gz + 0.5) * TILE;
      // Debris gathers where the ground works: more stones on and
      // under slopes, a sparse scatter on the open floor.
      const slope = macroSlopeAt(cx, cz);
      const density = 5 + Math.min(9, slope * 24) * (1 - Math.min(1, Math.max(0, slope - 0.4) * 3));
      const count = Math.floor(density * (0.35 + 1.3 * h32(gx, gz, 7)));
      for (let i = 0; i < count && n < MAX_ROCKS; i++) {
        const rx = (gx + h32(gx, gz, i * 3 + 1)) * TILE;
        const rz = (gz + h32(gx, gz, i * 3 + 2)) * TILE;
        const u = h32(gx, gz, i * 3 + 3);
        // Power-law sizes: mostly small, rare boulders
        const s = u < 0.86 ? 0.12 + u * 0.5 : u < 0.985 ? 0.6 + (u - 0.86) * 6 : 2.2 + (u - 0.985) * 160;
        const y = heightAt(rx, rz) + s * 0.22;
        _p.set(rx, y, rz);
        _e.set(h32(gx, gz, i + 11) * Math.PI, h32(gx, gz, i + 13) * Math.PI * 2, h32(gx, gz, i + 17) * Math.PI);
        _q.setFromEuler(_e);
        _s.set(s * (0.75 + h32(gx, gz, i + 19) * 0.6), s * (0.6 + h32(gx, gz, i + 23) * 0.5), s * (0.75 + h32(gx, gz, i + 29) * 0.6));
        _m.compose(_p, _q, _s);
        mesh.setMatrixAt(n, _m);
        // Warm stone shades, a few darker basaltics
        const v = 0.55 + h32(gx, gz, i + 31) * 0.45;
        const dark = h32(gx, gz, i + 37) < 0.18 ? 0.5 : 1;
        _c.setRGB(0.20 * v * dark, 0.145 * v * dark, 0.112 * v * dark);
        mesh.setColorAt(n, _c);
        n++;
      }
    }
  }
  // Park the unused instances at zero scale
  _m.makeScale(0, 0, 0);
  for (let i = n; i < MAX_ROCKS; i++) mesh.setMatrixAt(i, _m);
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}
