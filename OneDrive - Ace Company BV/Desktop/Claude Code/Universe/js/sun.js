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

// ── Noise ──
float hash3(vec3 p) {
  p = fract(p * vec3(443.897, 441.423, 437.195));
  p += dot(p, p.yzx + 19.19);
  return fract((p.x + p.y) * p.z);
}

float noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash3(i), hash3(i + vec3(1,0,0)), f.x),
        mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x),
        mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y), f.z);
}

float fbm(vec3 p, int oct) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 7; i++) {
    if (i >= oct) break;
    v += noise3(p) * a;
    p = p * 2.1 + 0.31;
    a *= 0.47;
  }
  return v;
}

void main() {
  vec3 n = normalize(vPos);

  // ═══ LIMB DARKENING ═══
  float NdV = max(dot(vNorm, vViewDir), 0.0);
  float limb = 0.3 + 0.7 * pow(NdV, 0.38);
  float limbMask = smoothstep(0.0, 0.1, NdV);

  // ═══ CHURNING PLASMA — all turbulence, no geometric patterns ═══
  // Layer 1: slow, large-scale convection currents
  float slow1 = fbm(n * 2.0 + time * 0.09, 5);
  float slow2 = fbm(n * 2.3 - time * 0.07 + 40.0, 5);

  // Layer 2: medium turbulence — the "boiling" look
  float mid1 = fbm(n * 4.0 + time * 0.14 + 20.0, 5);
  float mid2 = fbm(n * 5.0 - time * 0.11 + 70.0, 4);

  // Layer 3: fast, fine-scale turbulence — the "alive" shimmer
  float fast1 = fbm(n * 9.0 + time * 0.25, 4);
  float fast2 = fbm(n * 12.0 - time * 0.2 + 90.0, 3);

  // ═══ HEAVY DOMAIN WARPING — the secret to organic chaos ═══
  // Warp coordinates using noise to create swirling, unpredictable flow
  vec3 warpedPos = n * 3.5 + vec3(slow1, slow2, slow1 * 0.7) * 3.5;
  float plasma1 = fbm(warpedPos + time * 0.05, 7);

  // Second warp pass — warp the already-warped result
  vec3 warpedPos2 = n * 5.0 + vec3(plasma1, mid1, mid2) * 2.8 - time * 0.06;
  float plasma2 = fbm(warpedPos2, 6);

  // Third warp — creates those beautiful swirling tendrils
  vec3 warpedPos3 = n * 7.0 + vec3(plasma2, plasma1, slow2) * 2.0 + time * 0.08;
  float plasma3 = fbm(warpedPos3, 5);

  // ═══ ERUPTION HOTSPOTS — pulsing bright regions ═══
  float hotspot1 = fbm(n * 1.2 + time * 0.015, 3);
  float hotspot2 = fbm(n * 1.8 - time * 0.02 + 60.0, 3);
  float eruption = smoothstep(0.58, 0.72, hotspot1) * smoothstep(0.52, 0.68, hotspot2);
  // Pulsing intensity
  eruption *= 0.7 + 0.3 * sin(time * 0.8 + hotspot1 * 12.0);

  // ═══ DARK FILAMENTS — cooler channels cutting through ═══
  float filament = fbm(n * 3.0 + vec3(slow2, slow1, mid1) * 4.0 + time * 0.03, 6);
  float darkChannel = 1.0 - smoothstep(0.42, 0.52, filament) * (1.0 - smoothstep(0.52, 0.58, filament)) * 0.7;

  // ═══ COMBINE — layered chaos ═══
  float intensity = plasma1 * 0.3 + plasma2 * 0.25 + plasma3 * 0.15
                  + mid1 * 0.15 + fast1 * 0.08 + fast2 * 0.07;
  // Apply dark filaments
  intensity *= darkChannel;
  // Extreme contrast stretch — deep darks to brilliant brights
  intensity = smoothstep(0.08, 0.92, intensity);
  // Eruption boost
  intensity = clamp(intensity + eruption * 0.35, 0.0, 1.0);

  // ═══ SDO COLOR RAMP — extreme dynamic range ═══
  vec3 col;
  if (intensity < 0.1) {
    // Near-black to deep crimson — sunspot-dark regions
    col = mix(vec3(0.06, 0.005, 0.0), vec3(0.22, 0.03, 0.0), intensity / 0.1);
  } else if (intensity < 0.25) {
    // Deep red — quiet chromosphere
    col = mix(vec3(0.22, 0.03, 0.0), vec3(0.50, 0.10, 0.01), (intensity - 0.1) / 0.15);
  } else if (intensity < 0.45) {
    // Burnt orange — typical surface
    col = mix(vec3(0.50, 0.10, 0.01), vec3(0.78, 0.28, 0.02), (intensity - 0.25) / 0.2);
  } else if (intensity < 0.65) {
    // Amber-orange — warm convection
    col = mix(vec3(0.78, 0.28, 0.02), vec3(0.92, 0.48, 0.06), (intensity - 0.45) / 0.2);
  } else if (intensity < 0.82) {
    // Golden — active regions
    col = mix(vec3(0.92, 0.48, 0.06), vec3(1.0, 0.68, 0.15), (intensity - 0.65) / 0.17);
  } else {
    // Brilliant white-gold — eruption peaks
    col = mix(vec3(1.0, 0.68, 0.15), vec3(1.0, 0.88, 0.45), (intensity - 0.82) / 0.18);
  }

  // Eruption regions push toward searing white
  col = mix(col, vec3(1.0, 0.9, 0.5), eruption * 0.5);

  // Fine shimmer — adds high-frequency "heat haze" life
  float shimmer = fast1 * 0.08 + fast2 * 0.06;
  col += vec3(shimmer * 0.5, shimmer * 0.25, shimmer * 0.05);

  // ═══ LIMB EFFECTS ═══
  col *= limb;
  col *= limbMask;

  // Chromosphere glow at extreme limb
  float limbGlow = smoothstep(0.01, 0.05, NdV) * (1.0 - smoothstep(0.05, 0.14, NdV));
  col += vec3(0.8, 0.3, 0.05) * limbGlow * 0.25;

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
