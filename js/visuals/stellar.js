import * as THREE from 'three';
import { makePhotoLayers, addPhotoLayerStack } from './nebulae.js';
import { getPointTexture } from '../textures.js';

// ═══════════════════════════════════════════════════════════════════════
// Shared helpers
// ═══════════════════════════════════════════════════════════════════════

/** Cached 64px radial glow particle texture */
let _glowTex = null;
function getGlowTex() {
  if (_glowTex) return _glowTex;
  const sz = 64;
  const cv = document.createElement('canvas');
  cv.width = sz; cv.height = sz;
  const ctx = cv.getContext('2d');
  const grd = ctx.createRadialGradient(sz / 2, sz / 2, 0, sz / 2, sz / 2, sz / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1.0)');
  grd.addColorStop(0.3, 'rgba(255,255,255,0.5)');
  grd.addColorStop(0.7, 'rgba(255,255,255,0.1)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, sz, sz);
  _glowTex = new THREE.CanvasTexture(cv);
  return _glowTex;
}

/** Gaussian random number (Box-Muller transform) */
function gaussRandom() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

// ═══════════════════════════════════════════════════════════════════════
// 1. UY Scuti — Hypergiant star
// ═══════════════════════════════════════════════════════════════════════
export function createHypergiant(group, def) {
  // UY Scuti — a red hypergiant ~1700x the Sun's radius. No telescope
  // resolves its disc, so the accuracy source is what ALMA/VLT imaging
  // shows of Betelgeuse: a boiling surface with only a handful of
  // continent-sized convection cells, deep limb darkening, semi-regular
  // pulsation, and a vast dusty envelope shed by mass loss. Rendered as
  // an animated shader star — the only honest depiction is motion.
  const scale = def.size * (def._scaleUnit || 500);
  const starRadius = scale * 0.3;

  const starMat = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 } },
    vertexShader: `
      varying vec3 vN; varying vec3 vView;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalMatrix * normal;
        vView = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float time;
      varying vec3 vN; varying vec3 vView;
      float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float noise(vec3 x) { vec3 i = floor(x), f = fract(x);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
                       mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                       mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z); }
      float fbm(vec3 p) { float v = 0.0, a = 0.55;
        for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.07 + 11.3; a *= 0.5; }
        return v; }
      void main() {
        vec3 n = normalize(vN);
        float t = time * 0.03;
        // Domain-warped fbm: a few huge cells churning slowly — the
        // granulation scale that makes a hypergiant NOT look like a sun
        vec3 q = n * 2.6 + vec3(0.0, t * 0.6, t);
        vec3 warp = vec3(fbm(q + vec3(3.1)), fbm(q + vec3(7.7)), fbm(q + vec3(1.3)));
        float cells = fbm(q * 1.6 + warp * 1.9 - t * 0.5);
        cells = cells * cells * 1.6;
        vec3 c1 = vec3(0.24, 0.045, 0.012);  // maroon shadow lanes
        vec3 c2 = vec3(0.62, 0.13, 0.03);    // deep red
        vec3 c3 = vec3(0.97, 0.42, 0.10);    // bright granule orange
        vec3 c4 = vec3(1.0, 0.82, 0.45);     // rare hotspot
        vec3 col = mix(c1, c2, smoothstep(0.15, 0.55, cells));
        col = mix(col, c3, smoothstep(0.55, 0.85, cells));
        col = mix(col, c4, smoothstep(0.88, 1.05, cells));
        // Deep limb darkening + rim reddening — cool molecular edge
        float mu = clamp(dot(n, normalize(vView)), 0.0, 1.0);
        col *= pow(mu, 0.85) * 1.12 + 0.05;
        col = mix(vec3(col.r * 0.85, col.g * 0.35, col.b * 0.2), col,
                  smoothstep(0.0, 0.35, mu));
        // Semi-regular variable: two incommensurate slow pulsations
        col *= 1.0 + 0.05 * sin(time * 0.11) + 0.04 * sin(time * 0.031 + 1.7);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const star = new THREE.Mesh(new THREE.SphereGeometry(starRadius, 64, 64), starMat);
  star.userData._onUpdate = (dt, mesh) => {
    mesh.material.uniforms.time.value += dt;
    mesh.rotation.y += dt * 0.006; // hypergiants rotate over years, not minutes
  };
  group.add(star);

  // Chromosphere + detached molecular shell (BackSide = soft interior glow)
  for (const sh of [
    { radiusMul: 1.14, color: 0xff3a08, opacity: 0.16 },
    { radiusMul: 1.6,  color: 0xa81f04, opacity: 0.05 },
  ]) {
    const mat = new THREE.MeshBasicMaterial({
      color: sh.color, transparent: true, opacity: sh.opacity,
      blending: THREE.AdditiveBlending, side: THREE.BackSide, depthWrite: false,
    });
    group.add(new THREE.Mesh(new THREE.SphereGeometry(starRadius * sh.radiusMul, 40, 40), mat));
  }

  // Dusty mass-loss envelope: nested glow sprites, the outermost offset —
  // hypergiants shed asymmetrically (VY CMa's plumes), never in neat shells
  const mkGlow = (sizeMul, color, opacity, ox, oy) => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: getGlowTex(), color, transparent: true, opacity,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    sp.scale.setScalar(starRadius * sizeMul);
    sp.position.set(ox * starRadius, oy * starRadius, 0);
    group.add(sp);
  };
  mkGlow(3.4, 0xff5512, 0.30, 0, 0);       // inner radiance
  mkGlow(6.5, 0xc02a06, 0.12, 0, 0);       // warm envelope
  mkGlow(11.0, 0x701403, 0.06, 0.9, 0.35); // offset dust plume
  mkGlow(16.0, 0x400b02, 0.03, -0.5, -0.2); // far cold dust

  // Reference stars threading the Scutum field — scale needs witnesses
  {
    const count = 520;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3]     = (Math.random() - 0.5) * scale * 3.0;
      positions[i * 3 + 1] = (Math.random() - 0.5) * scale * 3.0;
      positions[i * 3 + 2] = (Math.random() * 2 - 1) * scale * 1.2;
      const warm = Math.random() < 0.55; // Scutum is a rich warm starfield
      const b = 0.14 + Math.random() * 0.5;
      colors[i * 3]     = (warm ? 1.0 : 0.75) * b;
      colors[i * 3 + 1] = (warm ? 0.78 : 0.85) * b;
      colors[i * 3 + 2] = (warm ? 0.55 : 1.0) * b;
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      size: 1.6, map: getPointTexture(), vertexColors: true,
      sizeAttenuation: false, blending: THREE.AdditiveBlending,
      transparent: true, opacity: 0.85, depthWrite: false,
    });
    group.add(new THREE.Points(geom, mat));
  }

  // Deep red light on anything nearby
  const light = new THREE.PointLight(0xff3300, 4, scale * 6);
  group.add(light);
}

// ═══════════════════════════════════════════════════════════════════════
// 2. Ring Nebula — Planetary nebula with dying white dwarf
// ═══════════════════════════════════════════════════════════════════════
export function createRingNebula(group, def, textures) {
  // Hubble's M57 (credit NASA/ESA/Hubble Heritage): the smoke-ring of a
  // dead sun — amber shell in front, blue-green heart behind, and the
  // scorching white dwarf as a hard spark at the center.
  const s = def.size * (def._scaleUnit || 500);

  const layers = textures && textures.landmarkRing
    ? makePhotoLayers(textures.landmarkRing, [
        { kind: 'full' },
        { kind: 'full', blurPx: 12 }, // star-free twin, SAME geometry — the
                                      // far identity; resolve = sharpen in
                                      // place, never a positional crossfade
        { kind: 'cool', lumLo: 150 },
        { kind: 'warm' },
      ])
    : null;
  if (layers) {
    addPhotoLayerStack(group, layers, [
      { z: -s * 0.26, scale: 1.2, opacity: 0.5, order: 2 },
      { z: -s * 0.26, scale: 1.2, opacity: 0.4, order: 2 },
      { z: -s * 0.06, scale: 1.0, opacity: 0.9, order: 3 },
      { z:  s * 0.16, scale: 0.98, opacity: 1.0, order: 4 },
    ], s * 1.25, 1.0);
  }

  // The white dwarf — smaller than Earth, hotter than almost anything
  {
    const core = new THREE.Sprite(new THREE.SpriteMaterial({
      map: getGlowTex(), color: 0xe8f2ff, blending: THREE.AdditiveBlending,
      transparent: true, opacity: 0.95, depthWrite: false,
    }));
    core.scale.set(s * 0.016, s * 0.016, 1);
    core.position.z = s * 0.05;
    core.renderOrder = 5;
    group.add(core);
  }

  // Field stars in true depth
  {
    const tex2 = getGlowTex();
    const count = 420;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3]     = (Math.random() - 0.5) * s * 2.4;
      positions[i * 3 + 1] = (Math.random() - 0.5) * s * 2.4;
      positions[i * 3 + 2] = (Math.random() * 2 - 1) * s * 0.9;
      const warm = Math.random() < 0.45;
      const b = 0.15 + Math.random() * 0.5;
      colors[i * 3]     = b * (warm ? 1.0 : 0.78);
      colors[i * 3 + 1] = b * (warm ? 0.8 : 0.86);
      colors[i * 3 + 2] = b * (warm ? 0.5 : 1.0);
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      vertexColors: true, map: tex2, size: s * 0.011, sizeAttenuation: true,
      blending: THREE.AdditiveBlending, transparent: true, opacity: 0.8,
      depthWrite: false,
    });
    const pts = new THREE.Points(geom, mat);
    pts.renderOrder = 6;
    group.add(pts);
  }
}

export function createEtaCarinae(group, def, textures) {
  // Hubble's Homunculus in ultraviolet (2019 — credit NASA/ESA/STScI):
  // two blast-lobes of a star tearing itself apart, magenta shrapnel
  // skirt behind, the blinding binary at the waist.
  const s = def.size * (def._scaleUnit || 500);

  const layers = textures && textures.landmarkEtaCar
    ? makePhotoLayers(textures.landmarkEtaCar, [
        { kind: 'full' },
        { kind: 'cool', lumLo: 150 },
        { kind: 'bright', lumLo: 135 },
      ])
    : null;
  if (layers) {
    addPhotoLayerStack(group, layers, [
      { z: -s * 0.28, scale: 1.24, opacity: 0.55, order: 2 },
      { z: -s * 0.05, scale: 1.0, opacity: 0.85, order: 3 },
      { z:  s * 0.16, scale: 0.94, opacity: 1.0, order: 4 },
    ], s * 1.35, 1805 / 1779);
  }

  // The doomed binary — a hard spark at the waist of the lobes
  {
    const core = new THREE.Sprite(new THREE.SpriteMaterial({
      map: getGlowTex(), color: 0xfff2e0, blending: THREE.AdditiveBlending,
      transparent: true, opacity: 0.9, depthWrite: false,
    }));
    core.scale.set(s * 0.022, s * 0.022, 1);
    core.position.z = s * 0.1;
    core.renderOrder = 5;
    group.add(core);
  }

  // Field stars in true depth
  {
    const tex2 = getGlowTex();
    const count = 600;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3]     = (Math.random() - 0.5) * s * 2.5;
      positions[i * 3 + 1] = (Math.random() - 0.5) * s * 2.5;
      positions[i * 3 + 2] = (Math.random() * 2 - 1) * s * 0.9;
      const warm = Math.random() < 0.6;
      const b = 0.15 + Math.random() * 0.5;
      colors[i * 3]     = b * (warm ? 1.0 : 0.78);
      colors[i * 3 + 1] = b * (warm ? 0.8 : 0.86);
      colors[i * 3 + 2] = b * (warm ? 0.5 : 1.0);
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      vertexColors: true, map: tex2, size: s * 0.011, sizeAttenuation: true,
      blending: THREE.AdditiveBlending, transparent: true, opacity: 0.8,
      depthWrite: false,
    });
    const pts = new THREE.Points(geom, mat);
    pts.renderOrder = 6;
    group.add(pts);
  }
}

export function createMagnetar(group, def) {
  const scale = def.size * (def._scaleUnit || 500);
  const tex = getGlowTex();

  // Tiny neutron star sphere
  const nsRadius = scale * 0.01;
  const nsGeo = new THREE.SphereGeometry(nsRadius, 16, 16);
  const nsMat = new THREE.MeshBasicMaterial({ color: 0xddeeff });
  group.add(new THREE.Mesh(nsGeo, nsMat));

  // Bright glow sprite
  const glowMat = new THREE.SpriteMaterial({
    map: tex,
    color: 0x88aaff,
    blending: THREE.AdditiveBlending,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  });
  const glow = new THREE.Sprite(glowMat);
  glow.scale.set(scale * 0.04, scale * 0.04, 1);
  group.add(glow);

  // 12 magnetic field lines as THREE.Line objects — dipole curves
  const r0 = scale * 0.15; // max dipole extent
  const fieldLineCount = 12;

  for (let f = 0; f < fieldLineCount; f++) {
    const azimuth = (f / fieldLineCount) * Math.PI * 2;
    const points = [];
    const steps = 64;

    for (let s = 0; s <= steps; s++) {
      // Latitude from -PI/2 (south pole) to PI/2 (north pole)
      const lat = -Math.PI / 2 + (s / steps) * Math.PI;
      // Dipole field line: r = r0 * cos²(latitude)
      const cosLat = Math.cos(lat);
      const r = r0 * cosLat * cosLat;

      const x = r * Math.cos(lat) * Math.cos(azimuth);
      const y = r * Math.sin(lat);
      const z = r * Math.cos(lat) * Math.sin(azimuth);

      points.push(new THREE.Vector3(x, y, z));
    }

    const lineGeom = new THREE.BufferGeometry().setFromPoints(points);
    const lineMat = new THREE.LineBasicMaterial({
      color: 0x6688ff,
      transparent: true,
      opacity: 0.15,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    group.add(new THREE.Line(lineGeom, lineMat));
  }

  // Two radiation jets along Y axis (800 particles each, narrow cone, blue tint)
  for (const dir of [1, -1]) {
    const jetCount = 800;
    const positions = new Float32Array(jetCount * 3);
    const colors = new Float32Array(jetCount * 3);

    for (let i = 0; i < jetCount; i++) {
      const t = Math.random(); // 0 = star, 1 = far tip
      const dist = t * scale * 0.5;
      const coneRadius = t * scale * 0.015; // very narrow cone

      const angle = Math.random() * Math.PI * 2;
      const rx = Math.cos(angle) * coneRadius * Math.abs(gaussRandom()) * 0.3;
      const rz = Math.sin(angle) * coneRadius * Math.abs(gaussRandom()) * 0.3;

      positions[i * 3]     = rx;
      positions[i * 3 + 1] = dir * dist;
      positions[i * 3 + 2] = rz;

      // Blue tint, fading with distance
      const brightness = (1 - t * 0.5) * (0.5 + Math.random() * 0.5);
      colors[i * 3]     = 0.3 * brightness;
      colors[i * 3 + 1] = 0.5 * brightness;
      colors[i * 3 + 2] = 1.0 * brightness;
    }

    const jetGeom = new THREE.BufferGeometry();
    jetGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    jetGeom.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const jetMat = new THREE.PointsMaterial({
      vertexColors: true,
      size: scale * 0.006,
      map: tex,
      sizeAttenuation: true,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.25,
      depthWrite: false,
    });

    group.add(new THREE.Points(jetGeom, jetMat));
  }
}
