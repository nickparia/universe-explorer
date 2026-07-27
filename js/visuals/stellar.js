import * as THREE from 'three';
import { makePhotoLayers, addPhotoLayerStack } from './nebulae.js';

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
  const scale = def.size * (def._scaleUnit || 500);
  const starRadius = scale * 0.4;

  // Main red star sphere
  const starGeo = new THREE.SphereGeometry(starRadius, 48, 48);
  const starMat = new THREE.MeshBasicMaterial({ color: 0xff3311 });
  const star = new THREE.Mesh(starGeo, starMat);
  group.add(star);

  // Transparent additive overlay sphere for surface variation
  const overlayGeo = new THREE.SphereGeometry(starRadius * 1.05, 48, 48);
  const overlayMat = new THREE.MeshBasicMaterial({
    color: 0xff6633,
    transparent: true,
    opacity: 0.3,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const overlay = new THREE.Mesh(overlayGeo, overlayMat);
  group.add(overlay);

  // 4 concentric glow shells (BackSide)
  const glowDefs = [
    { radiusMul: 1.3, color: 0xff4400, opacity: 0.12 },
    { radiusMul: 2.0, color: 0xcc3300, opacity: 0.06 },
    { radiusMul: 3.2, color: 0x881100, opacity: 0.025 },
    { radiusMul: 5.0, color: 0x440800, opacity: 0.01 },
  ];

  for (const g of glowDefs) {
    const geo = new THREE.SphereGeometry(starRadius * g.radiusMul, 32, 32);
    const mat = new THREE.MeshBasicMaterial({
      color: g.color,
      transparent: true,
      opacity: g.opacity,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      depthWrite: false,
    });
    group.add(new THREE.Mesh(geo, mat));
  }

  // Red point light
  const light = new THREE.PointLight(0xff3300, 5, scale * 6);
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
