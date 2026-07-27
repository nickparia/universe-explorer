import * as THREE from 'three';
import { makePhotoLayers, addPhotoLayerStack } from './nebulae.js';

// ═══════════════════════════════════════════════════════════════════════
// Shared helpers
// ═══════════════════════════════════════════════════════════════════════

/** Gaussian random number (Box-Muller transform) */
function gaussRandom() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

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

// ═══════════════════════════════════════════════════════════════════════
// 1. Sagittarius A* — Supermassive Black Hole
// ═══════════════════════════════════════════════════════════════════════
export function createSupermassiveBH(group, def, textures) {
  // The Event Horizon Telescope's actual photograph of Sagittarius A*
  // (2022 — credit EHT Collaboration): humanity's real image of our own
  // black hole, floating amid the densest star swarm in the galaxy.
  const s = def.size * (def._scaleUnit || 500);

  const layers = textures && textures.landmarkSgra
    ? makePhotoLayers(textures.landmarkSgra, [
        { kind: 'full' },
        { kind: 'bright', lumLo: 60 },
      ])
    : null;
  if (layers) {
    addPhotoLayerStack(group, layers, [
      { z: -s * 0.05, scale: 1.0, opacity: 0.9, order: 3 },
      { z:  s * 0.06, scale: 0.99, opacity: 0.85, order: 4 }, // ring glow lifts forward
    ], s * 0.85, 1.0);
  }

  // The galactic-center swarm: thousands of stars crowding the hole,
  // denser toward the center — nowhere else in the galaxy looks like this
  {
    const tex2 = getGlowTex();
    const count = 2600;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      // Power-law clustering toward the center, hollow at the photo core
      const r = s * (0.55 + Math.pow(Math.random(), 1.7) * 2.2);
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta) * 0.6;
      positions[i * 3 + 2] = r * Math.cos(phi);
      const warm = Math.random() < 0.8; // old red-gold population
      const b = 0.18 + Math.random() * 0.5;
      colors[i * 3]     = b * (warm ? 1.0 : 0.8);
      colors[i * 3 + 1] = b * (warm ? 0.75 : 0.85);
      colors[i * 3 + 2] = b * (warm ? 0.45 : 1.0);
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      vertexColors: true, map: tex2, size: s * 0.012, sizeAttenuation: true,
      blending: THREE.AdditiveBlending, transparent: true, opacity: 0.85,
      depthWrite: false,
    });
    const pts = new THREE.Points(geom, mat);
    pts.renderOrder = 5;
    group.add(pts);
  }

  // Faint amber haze — the glow of the crowded core
  {
    const tex2 = getGlowTex();
    const count = 90;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = s * (0.8 + Math.random() * 1.6);
      const a = Math.random() * Math.PI * 2;
      positions[i * 3]     = Math.cos(a) * r;
      positions[i * 3 + 1] = gaussRandom2() * s * 0.4;
      positions[i * 3 + 2] = Math.sin(a) * r * 0.7;
      const b = 0.05 + Math.random() * 0.06;
      colors[i * 3] = b; colors[i * 3 + 1] = b * 0.7; colors[i * 3 + 2] = b * 0.42;
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      vertexColors: true, map: tex2, size: s * 0.7, sizeAttenuation: true,
      blending: THREE.AdditiveBlending, transparent: true, opacity: 0.13,
      depthWrite: false,
    });
    const pts = new THREE.Points(geom, mat);
    pts.renderOrder = 1;
    group.add(pts);
  }
}

function gaussRandom2() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

export function createSpiralGalaxy(group, def, textures) {
  // Andromeda from the real NASA mosaic (GALEX UV survey), in 2.5D.
  // floorSub removes the mosaic's circular tile seams — near-black sky
  // level steps vanish once the floor is subtracted and the layers blend
  // additively. Bulge floats ahead of the ring plane for parallax.
  const sP = def.size * (def._scaleUnit || 500);
  const layers = textures && textures.landmarkAndromeda
    ? makePhotoLayers(textures.landmarkAndromeda, [
        { kind: 'full', floorSub: 30 },
        { kind: 'cool', floorSub: 30, lumLo: 150 },
        { kind: 'bright', floorSub: 30, lumLo: 105 },
      ])
    : null;

  if (layers) {
    addPhotoLayerStack(group, layers, [
      { z: -sP * 0.30, scale: 1.28, opacity: 0.55, order: 2 }, // whole field
      { z: -sP * 0.04, scale: 1.0, opacity: 0.95, order: 3 },  // blue star-forming rings
      { z:  sP * 0.14, scale: 0.94, opacity: 0.9, order: 4 },  // golden bulge + bright knots
    ], sP * 1.7, 1.0);

    // Vast faint halo — a galaxy doesn't end where its photo does
    {
      const tex2 = (() => {
        const sz = 64;
        const cv = document.createElement('canvas');
        cv.width = sz; cv.height = sz;
        const ctx = cv.getContext('2d');
        const grd = ctx.createRadialGradient(sz/2, sz/2, 0, sz/2, sz/2, sz/2);
        grd.addColorStop(0, 'rgba(255,255,255,1)');
        grd.addColorStop(0.5, 'rgba(255,255,255,0.25)');
        grd.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = grd;
        ctx.fillRect(0, 0, sz, sz);
        return new THREE.CanvasTexture(cv);
      })();
      const count = 110;
      const positions = new Float32Array(count * 3);
      const colors = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        // Elongated along the disk's diagonal (photo axis ~45deg)
        const along = gaussRandom() * sP * 1.3;
        const across = gaussRandom() * sP * 0.5;
        positions[i * 3]     = (along - across) * 0.707;
        positions[i * 3 + 1] = (along + across) * 0.707 * 0.55;
        positions[i * 3 + 2] = gaussRandom() * sP * 0.25 - sP * 0.1;
        const b = 0.035 + Math.random() * 0.05;
        colors[i * 3]     = b * 0.95;
        colors[i * 3 + 1] = b * 0.9;
        colors[i * 3 + 2] = b * 1.0;
      }
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      const mat = new THREE.PointsMaterial({
        vertexColors: true, map: tex2, size: sP * 0.6, sizeAttenuation: true,
        blending: THREE.AdditiveBlending, transparent: true, opacity: 0.14,
        depthWrite: false,
      });
      const pts = new THREE.Points(geom, mat);
      pts.renderOrder = 1;
      group.add(pts);
    }
    return;
  }

  // ── Procedural fallback (no photo available) ──
  createSpiralGalaxyProcedural(group, def);
}

function createSpiralGalaxyProcedural(group, def) {
  const scale = def.size * (def._scaleUnit || 500);
  const tex = getGlowTex();

  const armCount = 4;
  const totalParticles = 60000;
  const particlesPerArm = totalParticles / armCount;

  const positions = new Float32Array(totalParticles * 3);
  const colors = new Float32Array(totalParticles * 3);

  for (let arm = 0; arm < armCount; arm++) {
    const armAngle = (arm / armCount) * Math.PI * 2;

    for (let i = 0; i < particlesPerArm; i++) {
      const idx = arm * particlesPerArm + i;
      const t = Math.random(); // 0 = center, 1 = outer edge
      const radius = t * scale * 0.4;

      // Spiral winding: armAngle + t * PI * 2.5
      const angle = armAngle + t * Math.PI * 2.5;

      // Spread perpendicular to arm
      const spread = radius * 0.08;
      const offsetX = gaussRandom() * spread;
      const offsetZ = gaussRandom() * spread;

      const x = Math.cos(angle) * radius + offsetX;
      const z = Math.sin(angle) * radius + offsetZ;
      // Very flat: y spread * 0.15
      const y = gaussRandom() * spread * 0.15;

      positions[idx * 3]     = x;
      positions[idx * 3 + 1] = y;
      positions[idx * 3 + 2] = z;

      // Color: blueish arms, warm core
      const coreFrac = 1.0 - t; // 1 at center, 0 at edge
      const brightness = 0.4 + Math.random() * 0.4;

      // Arms are blue-white, core is warm yellow
      colors[idx * 3]     = (0.5 + coreFrac * 0.5) * brightness;
      colors[idx * 3 + 1] = (0.5 + coreFrac * 0.3) * brightness;
      colors[idx * 3 + 2] = (0.8 - coreFrac * 0.3) * brightness;
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.PointsMaterial({
    vertexColors: true,
    size: scale * 0.004,
    map: tex,
    sizeAttenuation: true,
    blending: THREE.AdditiveBlending,
    transparent: true,
    opacity: 0.2,
    depthWrite: false,
  });

  group.add(new THREE.Points(geom, mat));

  // Slight tilt for realism
  group.rotation.x = Math.PI * 0.15;
  group.rotation.z = Math.PI * 0.1;

  // Bright galactic core glow sprite
  const coreMat = new THREE.SpriteMaterial({
    map: tex,
    color: 0xffeedd,
    blending: THREE.AdditiveBlending,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
  });
  const coreSprite = new THREE.Sprite(coreMat);
  coreSprite.scale.set(scale * 0.08, scale * 0.08, 1);
  group.add(coreSprite);
}

// ═══════════════════════════════════════════════════════════════════════
// 3. Sombrero Galaxy
// ═══════════════════════════════════════════════════════════════════════
export function createSombreroGalaxy(group, def, textures) {
  // Hubble's M104 (credit NASA/Hubble Heritage): the wide-brimmed galaxy.
  // The luminous halo and disk glow behind; the iconic dust-lane brim is
  // extracted by local contrast and floats IN FRONT with normal blending,
  // genuinely occluding the glow — the hat has a brim in 3D.
  const s = def.size * (def._scaleUnit || 500);

  const layers = textures && textures.landmarkSombrero
    ? makePhotoLayers(textures.landmarkSombrero, [
        { kind: 'full' },
        { kind: 'bright', lumLo: 95 },
        { kind: 'dark' },
      ])
    : null;
  if (layers) {
    addPhotoLayerStack(group, layers, [
      { z: -s * 0.26, scale: 1.24, opacity: 0.55, order: 2 },
      { z: -s * 0.04, scale: 1.0, opacity: 0.9, order: 3 },              // halo glow
      { z:  s * 0.12, scale: 0.97, opacity: 0.95, order: 4, normal: true }, // dust brim
    ], s * 1.7, 6429 / 11472);
  }

  // Field stars in true depth
  {
    const tex2 = getGlowTex();
    const count = 500;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3]     = (Math.random() - 0.5) * s * 2.6;
      positions[i * 3 + 1] = (Math.random() - 0.5) * s * 2.6;
      positions[i * 3 + 2] = (Math.random() * 2 - 1) * s * 0.9;
      const warm = Math.random() < 0.4;
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

export function createBootesVoid(group, def) {
  const scale = def.size * (def._scaleUnit || 500);
  const tex = getGlowTex();

  const shellOuter = scale * 0.42;

  // ── 1. Inner darkening sphere ──────────────────────────────────────
  // Very faint cool-tinted BackSide sphere; subtly desaturates the view
  // toward screen center when the camera is inside, selling the void.
  const voidGeo = new THREE.SphereGeometry(shellOuter * 0.9, 48, 48);
  const voidMat = new THREE.MeshBasicMaterial({
    color: 0x060814,
    side: THREE.BackSide,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  group.add(new THREE.Mesh(voidGeo, voidMat));

  // ── 2. Sparse interior galaxies ────────────────────────────────────
  // Enough to give parallax motion cues, but dim and few so the void
  // still reads as empty.
  const innerCount = 35;
  for (let i = 0; i < innerCount; i++) {
    // Bias toward the outer half of the interior so center stays darker
    const rFrac = 0.25 + Math.pow(Math.random(), 0.6) * 0.55;
    const r = shellOuter * rFrac;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);

    const mat = new THREE.SpriteMaterial({
      map: tex,
      // Cool dim galaxies — mostly blue-grey with a hint of warm
      color: Math.random() < 0.25 ? 0x88aabb : 0x4a5a70,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.18 + Math.random() * 0.12,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.position.set(
      r * Math.sin(phi) * Math.cos(theta),
      r * Math.sin(phi) * Math.sin(theta),
      r * Math.cos(phi)
    );
    const s = scale * (0.006 + Math.random() * 0.008);
    sprite.scale.set(s, s, 1);
    group.add(sprite);
  }

  // ── 3. Boundary wall — 3 concentric layers for depth ──────────────
  // Each layer uses colored sprite galaxies with size & color variety,
  // so the "wall" has thickness and visible individual galaxies rather
  // than reading as a uniform particle ring.
  const shellLayers = [
    { radius: shellOuter * 0.93, count: 180, sizeMul: 1.0, opacity: 0.55 },
    { radius: shellOuter * 1.00, count: 260, sizeMul: 1.15, opacity: 0.70 },
    { radius: shellOuter * 1.10, count: 150, sizeMul: 0.85, opacity: 0.40 },
  ];

  // Galaxy color palette — warm cores, cool spirals, occasional red giants
  const PALETTE = [
    0xfff0d8, 0xffe6b8, 0xddc8a0,  // warm yellow-white (elliptical galaxy bulges)
    0xb8c8ff, 0xa0b8e0, 0xc8d8ff,  // cool blue (spiral arms)
    0xffccaa, 0xffb890,             // reddish (distant / dusty)
    0xe8e8e8, 0xc8c8d0,             // neutral white
  ];

  for (const layer of shellLayers) {
    for (let i = 0; i < layer.count; i++) {
      // Jitter radial position within the layer for thickness
      const r = layer.radius * (0.97 + Math.random() * 0.06);
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);

      const mat = new THREE.SpriteMaterial({
        map: tex,
        color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
        blending: THREE.AdditiveBlending,
        transparent: true,
        // Individual galaxies vary in brightness
        opacity: layer.opacity * (0.5 + Math.random() * 0.5),
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.position.set(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.sin(phi) * Math.sin(theta),
        r * Math.cos(phi)
      );
      // Galaxies vary: most small, occasional larger nearby one
      const sizeRoll = Math.random();
      const base = sizeRoll < 0.05 ? 0.022 : (sizeRoll < 0.25 ? 0.012 : 0.006);
      const s = scale * base * layer.sizeMul * (0.7 + Math.random() * 0.6);
      sprite.scale.set(s, s, 1);
      group.add(sprite);
    }
  }

  // ── 4. Faint outer halo — soft glow suggesting denser space beyond
  const haloMat = new THREE.SpriteMaterial({
    map: tex,
    color: 0x5566aa,
    blending: THREE.AdditiveBlending,
    transparent: true,
    opacity: 0.08,
    depthWrite: false,
  });
  const halo = new THREE.Sprite(haloMat);
  halo.scale.set(shellOuter * 3, shellOuter * 3, 1);
  group.add(halo);
}
