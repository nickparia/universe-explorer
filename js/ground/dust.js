// ground/dust.js — the air made visible.
//
// A drifting field of fine dust around the camera: the wind's direction
// made legible, brightening in gusts, thickening when the rover runs.
// One Points cloud that wraps around the traveler — the particles are
// never anywhere but near you, because that's the only place air is
// visible anyway.

import * as THREE from 'three';
import { getConfig } from '../perf.js';
import { heightAt } from './site.js';

const RADIUS = 55;       // m — the visible air pocket
const HEIGHT = 14;
const SALT_N = 240;      // saltation grains skimming the ground in gusts
const SALT_R = 85;

let points = null, mat = null;
let velocities = null;
let count = 0;
let gustT = Math.PI * 0.3;
let salt = null, saltMat = null, saltH = null;

function makeSprite() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,225,200,0.8)');
  grad.addColorStop(0.4, 'rgba(230,180,140,0.28)');
  grad.addColorStop(1, 'rgba(220,170,130,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function initDustField(parentGroup, camLocal) {
  count = Math.min(700, (getConfig().descentParticles || 150) * 2.2 | 0);
  const posArr = new Float32Array(count * 3);
  velocities = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    posArr[i * 3] = camLocal.x + (Math.random() * 2 - 1) * RADIUS;
    posArr[i * 3 + 1] = camLocal.y - 4 + Math.random() * HEIGHT;
    posArr[i * 3 + 2] = camLocal.z + (Math.random() * 2 - 1) * RADIUS;
    velocities[i] = 0.6 + Math.random() * 0.9;   // per-grain wind coupling
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
  mat = new THREE.PointsMaterial({
    map: makeSprite(),
    size: 0.26,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.0,
    depthWrite: false,
    color: 0xd8a077,
  });
  points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  parentGroup.add(points);

  // Saltation: sand skimming the ground downwind during gusts — the
  // wind made visible where it actually works, at your boots.
  const sPos = new Float32Array(SALT_N * 3);
  saltH = new Float32Array(SALT_N);
  for (let i = 0; i < SALT_N; i++) {
    sPos[i * 3] = camLocal.x + (Math.random() * 2 - 1) * SALT_R;
    sPos[i * 3 + 2] = camLocal.z + (Math.random() * 2 - 1) * SALT_R;
    saltH[i] = 0.08 + Math.random() * 0.55;
    sPos[i * 3 + 1] = heightAt(sPos[i * 3], sPos[i * 3 + 2]) + saltH[i];
  }
  const sGeo = new THREE.BufferGeometry();
  sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
  saltMat = new THREE.PointsMaterial({
    map: mat.map,
    size: 0.14,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    color: 0xe8c49a,
  });
  salt = new THREE.Points(sGeo, saltMat);
  salt.frustumCulled = false;
  parentGroup.add(salt);
}

export function disposeDustField() {
  if (points) {
    points.geometry.dispose();
    mat.map.dispose();
    mat.dispose();
    if (points.parent) points.parent.remove(points);
  }
  if (salt) {
    salt.geometry.dispose();
    saltMat.dispose();
    if (salt.parent) salt.parent.remove(salt);
  }
  points = null; mat = null; velocities = null;
  salt = null; saltMat = null; saltH = null;
}

/**
 * @returns gust 0..1 — shared with the wind audio so what you hear is
 * what you see.
 */
export function updateDustField(dt, camLocal, roverK) {
  if (!points) return 0;
  // Two incommensurate slow sines make an unrepeating gust envelope
  gustT += dt;
  const gust = Math.max(0, Math.sin(gustT * 0.13) * 0.6 + Math.sin(gustT * 0.047 + 1.7) * 0.4);
  const windSpeed = 2.5 + gust * 9;            // m/s, along the canyon
  const wx = -windSpeed, wz = 0.35 * windSpeed * Math.sin(gustT * 0.021);

  const posAttr = points.geometry.attributes.position;
  const arr = posAttr.array;
  for (let i = 0; i < count; i++) {
    const c = velocities[i];
    arr[i * 3] += wx * c * dt;
    arr[i * 3 + 1] += Math.sin(gustT * 0.9 + i) * 0.25 * dt;
    arr[i * 3 + 2] += wz * c * dt;
    // Wrap into the pocket around the camera
    let dx = arr[i * 3] - camLocal.x;
    let dy = arr[i * 3 + 1] - camLocal.y;
    let dz = arr[i * 3 + 2] - camLocal.z;
    if (dx > RADIUS) arr[i * 3] -= RADIUS * 2; else if (dx < -RADIUS) arr[i * 3] += RADIUS * 2;
    if (dz > RADIUS) arr[i * 3 + 2] -= RADIUS * 2; else if (dz < -RADIUS) arr[i * 3 + 2] += RADIUS * 2;
    if (dy > HEIGHT - 4) arr[i * 3 + 1] -= HEIGHT; else if (dy < -4) arr[i * 3 + 1] += HEIGHT;
  }
  posAttr.needsUpdate = true;

  // Visible in gusts, denser behind wheels
  mat.opacity = 0.05 + gust * 0.20 + roverK * 0.22;

  // Saltation grains: fast, low, downwind — only when the wind works
  if (salt) {
    const gk = Math.max(0, gust - 0.3) / 0.7;
    const sArr = salt.geometry.attributes.position.array;
    const svx = wx * 2.6, svz = wz * 2.6;   // much faster than the motes
    for (let i = 0; i < SALT_N; i++) {
      let x = sArr[i * 3] + svx * dt;
      let z = sArr[i * 3 + 2] + svz * dt;
      const dx = x - camLocal.x, dz = z - camLocal.z;
      if (dx > SALT_R) x -= SALT_R * 2; else if (dx < -SALT_R) x += SALT_R * 2;
      if (dz > SALT_R) z -= SALT_R * 2; else if (dz < -SALT_R) z += SALT_R * 2;
      sArr[i * 3] = x;
      sArr[i * 3 + 2] = z;
      // hop: skim the ground with a light bounce
      sArr[i * 3 + 1] = heightAt(x, z) + saltH[i] * (0.6 + 0.4 * Math.abs(Math.sin(gustT * 2.1 + i)));
    }
    salt.geometry.attributes.position.needsUpdate = true;
    saltMat.opacity = 0.42 * gk;
  }
  return gust;
}
