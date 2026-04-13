// sun.js — Animated solar surface shader + prominences
// Inspired by NASA SDO observations
import * as THREE from 'three';

// ═══════════════════════════════════════════════════════════════
// Solar Prominences
// ═══════════════════════════════════════════════════════════════

const MAX_PROMINENCES = 5;
const SPRITES_PER_ARC = 28;

function makeGlowTexture() {
  const size = 64;
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.1, 'rgba(255,200,100,0.85)');
  g.addColorStop(0.3, 'rgba(255,120,40,0.35)');
  g.addColorStop(0.6, 'rgba(255,60,10,0.08)');
  g.addColorStop(1, 'rgba(255,30,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(cv);
}

let _glowTex = null;
function getGlowTex() {
  if (!_glowTex) _glowTex = makeGlowTexture();
  return _glowTex;
}

class Prominence {
  constructor(sunRadius) {
    this.sunRadius = sunRadius;
    this.active = false;
    this.life = 0;
    this.duration = 0;
    this.sprites = [];
  }

  spawn(parent) {
    this.active = true;
    this.life = 0;
    this.duration = 18 + Math.random() * 30;

    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const base = new THREE.Vector3(
      Math.sin(phi) * Math.cos(theta),
      Math.sin(phi) * Math.sin(theta),
      Math.cos(phi)
    ).normalize();

    const rand = new THREE.Vector3(Math.random()-0.5, Math.random()-0.5, Math.random()-0.5).normalize();
    const tangent = new THREE.Vector3().crossVectors(base, rand).normalize();

    const height = 40 + Math.random() * 100;
    const spread = 0.08 + Math.random() * 0.2;

    this._remove(parent);

    const tex = getGlowTex();
    for (let i = 0; i < SPRITES_PER_ARC; i++) {
      const t = i / (SPRITES_PER_ARC - 1);
      const arcAngle = (t - 0.5) * spread;
      const arcHeight = Math.sin(t * Math.PI) * height;
      const radial = this.sunRadius + arcHeight;

      const dir = base.clone().applyAxisAngle(tangent, arcAngle).normalize();
      const pos = dir.multiplyScalar(radial);

      const peakT = Math.sin(t * Math.PI);
      const spriteSize = 12 + peakT * 45;

      const mat = new THREE.SpriteMaterial({
        map: tex,
        color: new THREE.Color(1.0, 0.6 - peakT * 0.35, 0.2 - peakT * 0.15),
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });

      const sprite = new THREE.Sprite(mat);
      sprite.position.copy(pos);
      sprite.scale.setScalar(spriteSize);
      sprite._baseOpacity = 0.3 + peakT * 0.3;
      parent.add(sprite);
      this.sprites.push(sprite);
    }
  }

  _remove(parent) {
    for (const s of this.sprites) {
      parent.remove(s);
      s.material.dispose();
    }
    this.sprites = [];
  }

  update(dt, parent) {
    if (!this.active) return;
    this.life += dt;

    if (this.life > this.duration) {
      this.active = false;
      this._remove(parent);
      return;
    }

    const fadeIn = Math.min(this.life / 4, 1);
    const fadeOut = Math.min((this.duration - this.life) / 5, 1);
    const fade = fadeIn * fadeOut;

    for (const s of this.sprites) {
      s.material.opacity = s._baseOpacity * fade;
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// Sun Surface Shader (GLSL)
// ═══════════════════════════════════════════════════════════════

const SunVertexShader = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>

varying vec3 vPos;
varying vec3 vNorm;
varying vec3 vViewDir;

void main() {
  vPos = position;
  vNorm = normalize(normalMatrix * normal);
  vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
  vViewDir = normalize(-mvPos.xyz);

  gl_Position = projectionMatrix * mvPos;

  #include <logdepthbuf_vertex>
}
`;

const SunFragmentShader = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>

uniform float time;
varying vec3 vPos;
varying vec3 vNorm;
varying vec3 vViewDir;

// ── Noise primitives ──
float h3(vec3 p) {
  p = fract(p * vec3(443.897, 441.423, 437.195));
  p += dot(p, p.yzx + 19.19);
  return fract((p.x + p.y) * p.z);
}

float n3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(h3(i), h3(i+vec3(1,0,0)), f.x),
        mix(h3(i+vec3(0,1,0)), h3(i+vec3(1,1,0)), f.x), f.y),
    mix(mix(h3(i+vec3(0,0,1)), h3(i+vec3(1,0,1)), f.x),
        mix(h3(i+vec3(0,1,1)), h3(i+vec3(1,1,1)), f.x), f.y), f.z);
}

// Standard smooth FBM
float fbm(vec3 p, int oct) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 7; i++) {
    if (i >= oct) break;
    v += n3(p) * a;
    p = p * 2.1 + 0.31;
    a *= 0.47;
  }
  return v;
}

// RIDGED FBM — creates sharp, flame-like ridges and tendrils
float ridged(vec3 p, int oct) {
  float v = 0.0, a = 0.5, prev = 1.0;
  for (int i = 0; i < 7; i++) {
    if (i >= oct) break;
    float n = 1.0 - abs(n3(p) * 2.0 - 1.0);  // ridge: sharp peaks
    n = n * n;                                   // sharpen further
    n *= prev;                                   // weight by previous octave
    prev = n;
    v += n * a;
    p = p * 2.15 + 0.28;
    a *= 0.52;
  }
  return v;
}

void main() {
  vec3 n = normalize(vPos);

  // ═══ LIMB DARKENING ═══
  float NdV = max(dot(vNorm, vViewDir), 0.0);
  float limb = 0.25 + 0.75 * pow(NdV, 0.35);
  float limbMask = smoothstep(0.0, 0.08, NdV);

  // ═══ FIRE LAYER 1: Large roiling plasma (slow, massive) ═══
  float s1 = fbm(n * 2.0 + time * 0.08, 5);
  float s2 = fbm(n * 2.5 - time * 0.06 + 40.0, 5);

  // ═══ FIRE LAYER 2: Ridged flame structures (the "fire" look) ═══
  // Domain warp with slow layer, then ridged noise for sharp flame edges
  vec3 firePos = n * 4.0 + vec3(s1, s2, s1 * 0.8) * 3.0;
  float flame1 = ridged(firePos + time * 0.12, 6);

  // Second fire pass — different scale, opposite flow
  vec3 firePos2 = n * 6.0 + vec3(s2, flame1, s1) * 2.5 - time * 0.09;
  float flame2 = ridged(firePos2, 5);

  // ═══ FIRE LAYER 3: Outward-flowing tendrils ═══
  // Animate outward from surface (radial flow = multiply n by growing time)
  vec3 radialFlow = n * (3.0 + time * 0.15);
  float tendrils = ridged(radialFlow + vec3(s1, s2, flame1) * 2.0, 5);

  // ═══ FIRE LAYER 4: Rapid flicker (heat shimmer) ═══
  float flicker1 = n3(n * 15.0 + time * 1.2);
  float flicker2 = n3(n * 20.0 - time * 0.9 + 50.0);
  float heatShimmer = flicker1 * 0.6 + flicker2 * 0.4;

  // ═══ ERUPTIONS — intense bright pulses ═══
  float erupt = fbm(n * 1.5 + time * 0.02, 3);
  float eruptMask = smoothstep(0.56, 0.70, erupt);
  eruptMask *= 0.6 + 0.4 * sin(time * 1.2 + erupt * 15.0);

  // ═══ DARK CHASMS — deep cracks in the fire ═══
  float chasm = ridged(n * 3.5 + vec3(s2, s1, flame2) * 3.5 + time * 0.04, 5);
  float darkCrack = smoothstep(0.3, 0.5, chasm);

  // ═══ COMBINE — fire-dominated intensity ═══
  float intensity = flame1 * 0.30       // sharp ridged fire (dominant)
                  + flame2 * 0.20       // secondary fire layer
                  + tendrils * 0.15     // outward-flowing tendrils
                  + s1 * 0.15           // slow underlying glow
                  + heatShimmer * 0.10  // rapid flicker
                  + darkCrack * 0.10;   // dark structure

  // Hard contrast — push darks darker, brights brighter
  intensity = smoothstep(0.05, 0.85, intensity);
  // Power curve for more dramatic contrast
  intensity = pow(intensity, 0.85);
  // Eruption boost
  intensity = clamp(intensity + eruptMask * 0.4, 0.0, 1.0);

  // ═══ INFERNO COLOR RAMP ═══
  // Near-black → deep red → fiery orange → incandescent yellow → searing white
  vec3 col;
  if (intensity < 0.08) {
    col = mix(vec3(0.04, 0.002, 0.0), vec3(0.18, 0.015, 0.0), intensity / 0.08);
  } else if (intensity < 0.22) {
    col = mix(vec3(0.18, 0.015, 0.0), vec3(0.55, 0.06, 0.0), (intensity - 0.08) / 0.14);
  } else if (intensity < 0.40) {
    col = mix(vec3(0.55, 0.06, 0.0), vec3(0.85, 0.20, 0.01), (intensity - 0.22) / 0.18);
  } else if (intensity < 0.58) {
    col = mix(vec3(0.85, 0.20, 0.01), vec3(0.95, 0.45, 0.04), (intensity - 0.40) / 0.18);
  } else if (intensity < 0.76) {
    col = mix(vec3(0.95, 0.45, 0.04), vec3(1.0, 0.70, 0.12), (intensity - 0.58) / 0.18);
  } else if (intensity < 0.90) {
    col = mix(vec3(1.0, 0.70, 0.12), vec3(1.0, 0.88, 0.38), (intensity - 0.76) / 0.14);
  } else {
    col = mix(vec3(1.0, 0.88, 0.38), vec3(1.0, 0.97, 0.72), (intensity - 0.90) / 0.10);
  }

  // Eruptions push toward searing white-hot
  col = mix(col, vec3(1.0, 0.95, 0.7), eruptMask * 0.6);

  // Heat shimmer — rapid fine brightness variation
  col += vec3(0.12, 0.05, 0.01) * (heatShimmer - 0.5) * 0.4;

  // ═══ LIMB EFFECTS ═══
  col *= limb;
  col *= limbMask;

  // Chromosphere: bright orange-red ring at the extreme edge
  float limbGlow = smoothstep(0.01, 0.06, NdV) * (1.0 - smoothstep(0.06, 0.16, NdV));
  col += vec3(1.0, 0.35, 0.05) * limbGlow * 0.3;

  gl_FragColor = vec4(col, 1.0);

  #include <logdepthbuf_fragment>
}
`;

// ═══════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════

let sunMaterial = null;
let prominences = [];
let prominenceTimer = 0;
let _sunGroup = null;
let _sunRadius = 800;

export function createSunShader(sunRadius, sunGroup) {
  _sunGroup = sunGroup;
  _sunRadius = sunRadius;

  sunMaterial = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 }
    },
    vertexShader: SunVertexShader,
    fragmentShader: SunFragmentShader,
    // Required for logarithmic depth buffer compatibility
    depthWrite: true,
    depthTest: true,
  });

  // Enable log depth buffer support
  sunMaterial.onBeforeCompile = (shader) => {
    // Three.js injects logarithmicDepthBuffer support via onBeforeCompile
    // for ShaderMaterial when the renderer has it enabled
  };

  for (let i = 0; i < MAX_PROMINENCES; i++) {
    prominences.push(new Prominence(sunRadius));
  }

  for (let i = 0; i < 3; i++) {
    prominences[i].spawn(sunGroup);
    prominences[i].life = Math.random() * 10;
  }

  return sunMaterial;
}

export function updateSun(dt, elapsed) {
  if (sunMaterial) {
    sunMaterial.uniforms.time.value = elapsed;
  }

  prominenceTimer += dt;
  let activeCount = 0;

  for (let i = 0; i < prominences.length; i++) {
    prominences[i].update(dt, _sunGroup);
    if (prominences[i].active) activeCount++;
  }

  if (prominenceTimer > 5 && activeCount < MAX_PROMINENCES) {
    prominenceTimer = 0;
    for (let i = 0; i < prominences.length; i++) {
      if (!prominences[i].active) {
        prominences[i].spawn(_sunGroup);
        break;
      }
    }
  }
}
