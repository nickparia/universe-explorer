// blackhole.js — "Gargantua" — Interstellar-style black hole
//
// Instead of a black sphere + particle ring, this renders the black hole the
// way the film did: a camera-facing quad running a per-pixel geodesic
// raymarcher. Photon paths are bent around the singularity, so the thin
// accretion disk is seen BOTH in front of the shadow AND lensed over the top
// and underneath it — the signature Interstellar halo — plus the bright
// photon ring hugging the event horizon and relativistic doppler beaming
// (one side of the disk searing white, the other dim and red).
//
// Drop-in for deepspace.js:
//
//   import { createGargantua, updateGargantua } from './blackhole.js';
//
//   // inside createBlackHole(scene), replacing horizon/disk/glow meshes:
//   createGargantua(blackHoleGroup, 8);      // 8 = event horizon radius (world units)
//
//   // inside updateDeepSpace(dt, camPos):
//   updateGargantua(dt);
//
// Works with the engine's camera-relative rendering: the shader's black-hole
// position uniform is refreshed in onBeforeRender, i.e. AFTER
// applyCameraRelative() has shifted the scene graph for the frame.

import * as THREE from 'three';

const VERT = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
  #include <logdepthbuf_vertex>
}
`;

const FRAG = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>

uniform float uTime;
uniform vec3  uBhPos;     // black hole world position (this frame)
uniform float uRs;        // event horizon radius in world units
uniform mat3  uDiskRot;   // world -> disk frame (disk plane = local y=0)
varying vec3 vWorldPos;

#define RIN   2.35
#define ROUT  9.6
#define STEPS 96

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x),
             mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += vnoise(p) * a; p = p * 2.13 + 7.7; a *= 0.5; }
  return v;
}
vec2 rot2(vec2 p, float a) {
  float c = cos(a), s = sin(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

// Shade one crossing of the (infinitely thin) accretion disk.
void sampleDisk(vec3 pc, vec3 vn, inout vec3 col, inout float T) {
  float rc = length(pc.xz);

  // ── Plunging region — matter torn off the inner edge, spiraling in fast ──
  if (rc < RIN) {
    if (rc < 1.06) return;
    vec2 qi = rot2(pc.xz, uTime * 6.5 * inversesqrt(rc) + rc * 7.0);
    float ni = fbm(qi * 3.2);
    float fall = smoothstep(RIN, 1.15, rc);            // denser toward the horizon
    float di = smoothstep(0.45, 0.85, ni) * (1.0 - fall * 0.55) * 0.5;
    vec3 ci = mix(vec3(1.2, 0.5, 0.14), vec3(0.5, 0.05, 0.0), fall);
    float ai = clamp(di, 0.0, 1.0);
    col += ci * (ai * T) * 0.55;
    T *= (1.0 - ai);
    return;
  }

  float t = (rc - RIN) / (ROUT - RIN);

  // Keplerian differential rotation + static spiral shear -> hot gas streaks
  float sp = 2.2 * inversesqrt(rc * rc * rc);
  vec2 q = rot2(pc.xz, uTime * sp * 2.0 + rc * 2.6);
  float n = 0.55 * fbm(q * 1.6) + 0.45 * fbm(q * 3.4 + 13.1);
  n = n * n * 1.7;

  // Temperature ramp: white-hot inner edge -> orange -> deep ember red rim
  vec3 c = mix(vec3(1.35, 1.16, 0.95), vec3(1.15, 0.52, 0.16), smoothstep(0.0, 0.38, t));
  c = mix(c, vec3(0.45, 0.09, 0.015), smoothstep(0.38, 1.0, t));

  // Gas density — fade at inner and outer edges, modulated by turbulence
  float dens = smoothstep(0.0, 0.10, t) * (1.0 - smoothstep(0.55, 1.0, t));
  dens *= 0.12 + 1.8 * n;

  // ── Violence: flaring hot spots + global surging ──
  float nf = fbm(q * 0.85 - uTime * 0.30);
  float flare = smoothstep(0.68, 0.92, nf);
  float surge = 1.0 + 0.18 * sin(uTime * 0.7) + 0.12 * sin(uTime * 2.3 + 1.7);
  dens += flare * 1.2 * (1.0 - smoothstep(0.45, 0.9, t));
  c *= surge + flare * 1.6;

  // Relativistic doppler beaming — the approaching side flares toward white,
  // the receding side dims and reddens. This is what makes it menacing.
  vec3 tanv = normalize(vec3(-pc.z, 0.0, pc.x));
  float beta = 0.5 * inversesqrt(rc);
  float mu = dot(tanv, vn);                       // >0: receding along the ray
  float dop = pow(clamp(1.0 / (1.0 + beta * mu), 0.4, 2.0), 3.0);
  c *= dop;
  c += vec3(0.22, 0.28, 0.42) * max(0.0, dop - 1.0) * 0.35;   // blue-white flare
  c *= mix(vec3(1.0, 0.5, 0.32), vec3(1.0), clamp(dop, 0.0, 1.0)); // red dimming

  float a = clamp(dens * 0.85, 0.0, 1.0);
  col += c * (a * T) * 0.62;
  T *= (1.0 - a);
}

void main() {
  // Camera ray in disk-local units (event horizon radius = 1)
  vec3 p = uDiskRot * ((cameraPosition - uBhPos) / uRs);
  vec3 v = uDiskRot * normalize(vWorldPos - cameraPosition);

  // Conserved angular momentum for the pseudo-Schwarzschild geodesic
  vec3 lv = cross(p, v);
  float h2 = dot(lv, lv);

  vec3 col = vec3(0.0);
  float T = 1.0;
  float captured = 0.0;

  for (int i = 0; i < STEPS; i++) {
    float r2 = dot(p, p);
    float r = sqrt(r2);
    if (r < 1.0) { captured = 1.0; break; }               // fell past the horizon
    if (r > 26.0 && dot(p, v) > 0.0) break;                // escaped

    float dt = clamp(r * 0.18, 0.05, 1.4);                 // fine steps near the hole
    v += (-1.5 * h2 * dt / (r2 * r2 * r)) * p;             // GR light bending
    vec3 pn = p + v * dt;

    // Thin-disk crossing (sign change of y in disk frame)
    if (pn.y * p.y < 0.0 && T > 0.02) {
      float f = p.y / (p.y - pn.y);
      vec3 pc = mix(p, pn, f);
      float rc = length(pc.xz);
      if (rc > 1.05 && rc < ROUT) sampleDisk(pc, normalize(v), col, T);
    }
    p = pn;
  }

  // Premultiplied alpha: captured rays are opaque (shadow occludes the stars
  // behind it); escaped rays only contribute the disk light they crossed.
  float alpha = max(captured, 1.0 - T);
  gl_FragColor = vec4(col, alpha);

  #include <logdepthbuf_fragment>
}
`;

// ── Module state ──
let _mesh = null;
let _mat = null;
let _time = 0;
const _tmp = new THREE.Vector3();

/**
 * Create the lensed black hole inside an existing group.
 * @param {THREE.Group} group  parent group (positioned by caller)
 * @param {number} rs          event horizon radius in world units
 * @param {object} [opts]      { tiltX, tiltZ } disk plane tilt in radians
 */
export function createGargantua(group, rs = 8, opts = {}) {
  const tiltX = opts.tiltX ?? 0.14;
  const tiltZ = opts.tiltZ ?? 0.05;

  // world -> disk frame = inverse of the disk's orientation
  const rot = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(tiltX, 0, tiltZ));
  const diskRot = new THREE.Matrix3().setFromMatrix4(rot.clone().invert());

  _mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime:    { value: 0 },
      uBhPos:   { value: new THREE.Vector3() },
      uRs:      { value: rs },
      uDiskRot: { value: diskRot },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    premultipliedAlpha: true,   // shader outputs premultiplied color
    depthWrite: false,
    depthTest: true,
  });

  // One camera-facing quad — the raymarcher does everything inside it.
  // 30x the horizon radius comfortably contains disk + lensed halo.
  const geo = new THREE.PlaneGeometry(rs * 30, rs * 30);
  _mesh = new THREE.Mesh(geo, _mat);
  _mesh.renderOrder = 5; // after skybox/stars (they don't write depth)

  // Refresh per-frame AT RENDER TIME — after applyCameraRelative() has
  // shifted the scene, so uBhPos and cameraPosition agree.
  _mesh.onBeforeRender = (renderer, scene, camera) => {
    _mesh.getWorldPosition(_tmp);
    _mat.uniforms.uBhPos.value.copy(_tmp);
    _mesh.quaternion.copy(camera.quaternion);   // billboard
  };

  group.add(_mesh);
  return _mesh;
}

/** Advance the accretion disk animation. Call once per frame with (dt * timeScale). */
export function updateGargantua(dt) {
  _time += dt;
  if (_mat) _mat.uniforms.uTime.value = _time;
}
