// ground/devils.js — dust devils walking the floor.
//
// Mars's signature weather: slow columns of spun dust wandering the
// canyon, kilometers off or uncomfortably near. Each is a tapered
// open cylinder with scrolling noise for a skin — translucent, sun-
// warmed, alive. Two or three roam at a time; they drift with the
// wind, lean into their own motion, and dissolve back into the air.
// Pass one close and the wind in your ears rises.

import * as THREE from 'three';
import { heightAt, macroSlopeAt, getSite } from './site.js';

const MAX_DEVILS = 3;

let group = null;
let devils = [];   // { mesh, x, z, vx, vz, age, life, h, r }
let seedT = 0;

function makeDevilMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uT: { value: 0 },
      uFade: { value: 0 },
      uSun: { value: new THREE.Vector3(0, 1, 0) },
    },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      varying vec2 vUv;
      uniform float uT, uFade;
      float n2(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 s = f * f * (3.0 - 2.0 * f);
        float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5453);
        float b = fract(sin(dot(i + vec2(1.0, 0.0), vec2(127.1, 311.7))) * 43758.5453);
        float c = fract(sin(dot(i + vec2(0.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
        float d = fract(sin(dot(i + vec2(1.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
        return mix(mix(a, b, s.x), mix(c, d, s.x), s.y);
      }
      void main() {
        // scrolling, rising dust skin
        float n = n2(vec2(vUv.x * 5.0 + uT * 0.12, vUv.y * 3.2 - uT * 0.55));
        n = n * 0.65 + 0.35 * n2(vec2(vUv.x * 11.0 - uT * 0.2, vUv.y * 7.0 - uT * 1.1));
        // soft vertical taper: dense skirt, wispy crown
        float vert = smoothstep(0.0, 0.12, vUv.y) * (1.0 - smoothstep(0.55, 1.0, vUv.y) * 0.85);
        float a = n * vert * 0.30 * uFade;
        vec3 col = vec3(0.76, 0.58, 0.43);
        gl_FragColor = vec4(col, a);
      }
    `,
  });
}

export function initDevils(parentGroup) {
  group = new THREE.Group();
  parentGroup.add(group);
  devils = [];
  seedT = 30;   // first devil rises within half a minute
}

export function disposeDevils() {
  for (const d of devils) {
    d.mesh.geometry.dispose();
    d.mesh.material.dispose();
  }
  if (group && group.parent) group.parent.remove(group);
  group = null;
  devils = [];
}

function spawn(camLocal) {
  const site = getSite();
  // Try a few spots on open, flattish ground 0.7–3.5 km out
  for (let tries = 0; tries < 8; tries++) {
    const ang = Math.random() * Math.PI * 2;
    const dist = 700 + Math.random() * 2800;
    const x = camLocal.x + Math.cos(ang) * dist;
    const z = camLocal.z + Math.sin(ang) * dist;
    if (x < site.minX + 2000 || x > site.maxX - 2000 || z < site.minZ + 2000 || z > site.maxZ - 2000) continue;
    if (macroSlopeAt(x, z) > 0.09) continue;
    const h = 130 + Math.random() * 160;
    const r = 5 + Math.random() * 9;
    const geo = new THREE.CylinderGeometry(r * 2.4, r, h, 14, 8, true);
    const mesh = new THREE.Mesh(geo, makeDevilMaterial());
    mesh.position.set(x, heightAt(x, z) + h / 2, z);
    group.add(mesh);
    // drift westward with the canyon wind, wandering
    const sp = 1.5 + Math.random() * 2.5;
    const wa = Math.PI + (Math.random() - 0.5) * 1.2; // mostly -x
    devils.push({
      mesh, x, z,
      vx: Math.cos(wa) * sp, vz: Math.sin(wa) * sp,
      age: 0, life: 90 + Math.random() * 120, h, r,
    });
    return;
  }
}

/** @returns proximity 0..1 of the nearest devil — feeds the wind's ears */
export function updateDevils(dt, camLocal, weatherK = 0.6) {
  if (!group) return 0;
  // Windy spells breed devils; calm ones starve them
  seedT -= dt * (0.4 + weatherK * 1.3);
  if (seedT <= 0) {
    seedT = 25 + Math.random() * 50;
    const cap = Math.max(1, Math.round(MAX_DEVILS * (0.4 + weatherK)));
    if (devils.length < cap) spawn(camLocal);
  }
  let near = 0;
  for (let i = devils.length - 1; i >= 0; i--) {
    const d = devils[i];
    d.age += dt;
    if (d.age > d.life) {
      d.mesh.geometry.dispose();
      d.mesh.material.dispose();
      group.remove(d.mesh);
      devils.splice(i, 1);
      continue;
    }
    d.x += d.vx * dt;
    d.z += d.vz * dt;
    const ground = heightAt(d.x, d.z);
    d.mesh.position.set(d.x, ground + d.h / 2, d.z);
    // lean gently away from its own motion, spin the skin
    d.mesh.rotation.z = d.vx * 0.02;
    d.mesh.rotation.x = -d.vz * 0.02;
    d.mesh.rotation.y += dt * 1.7;
    const m = d.mesh.material;
    m.uniforms.uT.value += dt;
    const fadeIn = Math.min(1, d.age / 12);
    const fadeOut = Math.min(1, (d.life - d.age) / 15);
    m.uniforms.uFade.value = Math.min(fadeIn, fadeOut);
    const dist = Math.hypot(d.x - camLocal.x, d.z - camLocal.z);
    near = Math.max(near, THREE.MathUtils.clamp(1 - dist / 220, 0, 1) * m.uniforms.uFade.value);
  }
  return near;
}
