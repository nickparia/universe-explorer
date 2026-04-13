// sun.js — Animated solar surface shader + prominences
import * as THREE from 'three';

// ═══════════════════════════════════════════════════════════════
// Solar Surface Shader — churning plasma with convection cells
// ═══════════════════════════════════════════════════════════════

const SunVS = /* glsl */`
varying vec3 vNormal;
varying vec3 vPosition;
varying vec2 vUv;
uniform float time;

vec3 mod289(vec3 x) { return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 perm(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }

float snoise(vec3 p) {
  vec3 a = floor(p);
  vec3 d = p - a;
  d = d * d * (3.0 - 2.0 * d);
  vec4 b = a.xxyy + vec4(0.0, 1.0, 0.0, 1.0);
  vec4 k1 = perm(b.xyxy);
  vec4 k2 = perm(k1.xyxy + b.zzww);
  vec4 c = k2 + a.zzzz;
  vec4 k3 = perm(c);
  vec4 k4 = perm(c + 1.0);
  vec4 o1 = fract(k3 * (1.0/41.0));
  vec4 o2 = fract(k4 * (1.0/41.0));
  vec4 o3 = o2 * d.z + o1 * (1.0 - d.z);
  vec2 o4 = o3.yw * d.x + o3.xz * (1.0 - d.x);
  return o4.y * d.y + o4.x * (1.0 - d.y);
}

void main() {
  vNormal = normalize(normalMatrix * normal);
  vUv = uv;

  vec3 pos = position;
  float displacement = snoise(normal * 2.5 + time * 0.12) * 0.04;
  displacement += snoise(normal * 5.0 - time * 0.18) * 0.02;
  pos += normal * displacement * length(position);

  vPosition = pos;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

const SunFS = /* glsl */`
varying vec3 vNormal;
varying vec3 vPosition;
varying vec2 vUv;
uniform float time;

// Better noise using sin-based hash — produces full 0-1 range
float hash(vec3 p) {
  p = fract(p * vec3(443.897, 441.423, 437.195));
  p += dot(p, p.yzx + 19.19);
  return fract((p.x + p.y) * p.z);
}

float noise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);

  return mix(
    mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
        mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
        mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
    f.z
  );
}

float fbm(vec3 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += noise(p) * a;
    p = p * 2.1 + vec3(0.3);
    a *= 0.5;
  }
  return v;
}

void main() {
  // Use object-space position for noise — consistent regardless of view
  vec3 n = normalize(vPosition);

  // Layer 1: large slow convection cells
  float n1 = fbm(n * 3.0 + time * 0.12);

  // Layer 2: medium turbulence, different direction
  float n2 = fbm(n * 6.0 - time * 0.18 + 50.0);

  // Domain warp — makes it look organic and churning
  float warped = fbm(n * 4.0 + vec3(n1, n2, n1) * 2.0 + time * 0.06);

  // Combine with strong contrast stretch
  float t = n1 * 0.35 + warped * 0.45 + n2 * 0.2;
  // Force full 0-1 range
  t = smoothstep(0.2, 0.8, t);

  // Color ramp: dark red → orange → yellow → white
  vec3 c1 = vec3(0.5, 0.05, 0.0);   // dark red
  vec3 c2 = vec3(0.9, 0.2, 0.0);    // deep orange
  vec3 c3 = vec3(1.0, 0.55, 0.05);  // orange
  vec3 c4 = vec3(1.0, 0.85, 0.3);   // yellow
  vec3 c5 = vec3(1.0, 0.98, 0.85);  // white-hot

  vec3 color;
  if (t < 0.25) {
    color = mix(c1, c2, t / 0.25);
  } else if (t < 0.5) {
    color = mix(c2, c3, (t - 0.25) / 0.25);
  } else if (t < 0.75) {
    color = mix(c3, c4, (t - 0.5) / 0.25);
  } else {
    color = mix(c4, c5, (t - 0.75) / 0.25);
  }

  // Small-scale granulation
  float gran = noise(n * 18.0 + time * 0.3);
  color += vec3(0.15, 0.08, 0.0) * smoothstep(0.4, 0.6, gran);

  // Brightness — the sun should be BRIGHT
  color *= 2.2;

  gl_FragColor = vec4(color, 1.0);
}
`;

// ═══════════════════════════════════════════════════════════════
// Solar Prominences — wispy sprite-based arcs of glowing plasma
// ═══════════════════════════════════════════════════════════════

const MAX_PROMINENCES = 4;
const SPRITES_PER_ARC = 24;

// Generate a soft radial gradient texture for sprites
function makeGlowTexture() {
  const size = 64;
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.15, 'rgba(255,200,100,0.8)');
  g.addColorStop(0.4, 'rgba(255,120,30,0.3)');
  g.addColorStop(1, 'rgba(255,60,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(cv);
  return t;
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
    this.arcPoints = [];
  }

  spawn(parent) {
    this.active = true;
    this.life = 0;
    this.duration = 15 + Math.random() * 25;

    // Random base point on sun surface
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const base = new THREE.Vector3(
      Math.sin(phi) * Math.cos(theta),
      Math.sin(phi) * Math.sin(theta),
      Math.cos(phi)
    ).normalize();

    // Random tangent for arc plane
    const rand = new THREE.Vector3(Math.random()-0.5, Math.random()-0.5, Math.random()-0.5).normalize();
    const tangent = new THREE.Vector3().crossVectors(base, rand).normalize();

    const height = 30 + Math.random() * 80;
    const spread = 0.1 + Math.random() * 0.25;

    // Remove old sprites
    this._remove(parent);

    // Create sprites along arc
    this.arcPoints = [];
    const tex = getGlowTex();

    for (let i = 0; i < SPRITES_PER_ARC; i++) {
      const t = i / (SPRITES_PER_ARC - 1);
      const arcAngle = (t - 0.5) * spread;
      const arcHeight = Math.sin(t * Math.PI) * height;
      const radial = this.sunRadius + arcHeight;

      const dir = base.clone().applyAxisAngle(tangent, arcAngle).normalize();
      const pos = dir.multiplyScalar(radial);
      this.arcPoints.push(pos.clone());

      // Size varies — bigger at peak, smaller at base
      const peakT = Math.sin(t * Math.PI);
      const spriteSize = 15 + peakT * 40;

      // Color — white-hot at base, orange-red at peak
      const r = 1.0;
      const g = 0.8 - peakT * 0.5;
      const b = 0.4 - peakT * 0.35;

      const mat = new THREE.SpriteMaterial({
        map: tex,
        color: new THREE.Color(r, g, b),
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });

      const sprite = new THREE.Sprite(mat);
      sprite.position.copy(pos);
      sprite.scale.setScalar(spriteSize);
      sprite._baseOpacity = 0.4 + peakT * 0.3;
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

    // Fade in/out
    const fadeIn = Math.min(this.life / 5, 1);
    const fadeOut = Math.min((this.duration - this.life) / 5, 1);
    const fade = fadeIn * fadeOut;

    for (const s of this.sprites) {
      s.material.opacity = s._baseOpacity * fade;
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════

let sunMaterial = null;
let prominences = [];
let prominenceTimer = 0;
let _sunGroup = null;
let _sunRadius = 800;

/**
 * Create the animated sun material and prominence system.
 * @param {number} sunRadius
 * @param {THREE.Group} sunGroup — add prominences to this group
 * @returns {THREE.ShaderMaterial} — use this as the sun mesh material
 */
export function createSunShader(sunRadius, sunGroup) {
  _sunGroup = sunGroup;
  _sunRadius = sunRadius;

  // Use MeshBasicMaterial with onBeforeCompile to inject plasma noise.
  // This ensures logarithmic depth buffer works correctly (ShaderMaterial doesn't).
  const timeUniform = { value: 0 };

  sunMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
  sunMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.time = timeUniform;

    // Inject time uniform and noise into vertex shader
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
       uniform float time;
       varying vec3 vObjPos;`
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       vObjPos = position;`
    );

    // Replace fragment shader color output with plasma noise
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
       uniform float time;
       varying vec3 vObjPos;

       float sunHash(vec3 p) {
         p = fract(p * vec3(443.897, 441.423, 437.195));
         p += dot(p, p.yzx + 19.19);
         return fract((p.x + p.y) * p.z);
       }
       float sunNoise(vec3 p) {
         vec3 i = floor(p); vec3 f = fract(p);
         f = f * f * (3.0 - 2.0 * f);
         return mix(
           mix(mix(sunHash(i), sunHash(i+vec3(1,0,0)), f.x),
               mix(sunHash(i+vec3(0,1,0)), sunHash(i+vec3(1,1,0)), f.x), f.y),
           mix(mix(sunHash(i+vec3(0,0,1)), sunHash(i+vec3(1,0,1)), f.x),
               mix(sunHash(i+vec3(0,1,1)), sunHash(i+vec3(1,1,1)), f.x), f.y), f.z);
       }
       float sunFbm(vec3 p) {
         float v=0.0, a=0.5;
         for(int i=0;i<5;i++){v+=sunNoise(p)*a; p=p*2.1+0.3; a*=0.5;}
         return v;
       }`
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      'vec4 diffuseColor = vec4( diffuse, opacity );',
      `vec3 n = normalize(vObjPos);
       float sn1 = sunFbm(n*3.0 + time*0.12);
       float sn2 = sunFbm(n*6.0 - time*0.18 + 50.0);
       float sw = sunFbm(n*4.0 + vec3(sn1,sn2,sn1)*2.0 + time*0.06);
       float st = sn1*0.35 + sw*0.45 + sn2*0.2;
       st = smoothstep(0.2, 0.8, st);

       // Darker color ramp so plasma variation is visible through bloom
       vec3 sc1=vec3(0.3,0.02,0.0);   // very dark red
       vec3 sc2=vec3(0.6,0.1,0.0);    // dark orange
       vec3 sc3=vec3(0.85,0.35,0.02); // orange
       vec3 sc4=vec3(0.95,0.65,0.12); // yellow-orange
       vec3 sc5=vec3(1.0,0.9,0.5);    // bright yellow (NOT white)
       vec3 sunCol;
       if(st<0.25) sunCol=mix(sc1,sc2,st/0.25);
       else if(st<0.5) sunCol=mix(sc2,sc3,(st-0.25)/0.25);
       else if(st<0.75) sunCol=mix(sc3,sc4,(st-0.5)/0.25);
       else sunCol=mix(sc4,sc5,(st-0.75)/0.25);
       sunCol += vec3(0.1,0.05,0.0)*smoothstep(0.4,0.6,sunNoise(n*18.0+time*0.3));
       // Lower brightness so bloom doesn't wash everything white
       sunCol *= 1.1;

       vec4 diffuseColor = vec4(sunCol, opacity);`
    );
  };
  sunMaterial._timeUniform = timeUniform;

  // Create prominences
  for (let i = 0; i < MAX_PROMINENCES; i++) {
    prominences.push(new Prominence(sunRadius));
  }

  // Spawn initial prominences staggered
  for (let i = 0; i < 2; i++) {
    prominences[i].spawn(sunGroup);
    prominences[i].life = Math.random() * 8;
  }

  return sunMaterial;
}

/**
 * Update sun animation. Call every frame.
 * @param {number} dt — delta time in seconds
 * @param {number} elapsed — total elapsed time
 */
export function updateSun(dt, elapsed) {
  if (sunMaterial && sunMaterial._timeUniform) {
    sunMaterial._timeUniform.value = elapsed;
  }

  // Update prominences
  prominenceTimer += dt;
  let activeCount = 0;

  for (let i = 0; i < prominences.length; i++) {
    prominences[i].update(dt, _sunGroup);
    if (prominences[i].active) activeCount++;
  }

  // Spawn new prominences periodically
  if (prominenceTimer > 6 && activeCount < MAX_PROMINENCES) {
    prominenceTimer = 0;
    for (let i = 0; i < prominences.length; i++) {
      if (!prominences[i].active) {
        prominences[i].spawn(_sunGroup);
        break;
      }
    }
  }
}
