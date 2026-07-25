import * as THREE from 'three';

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
export function createSupermassiveBH(group, def) {
  const scale = def.size * 3000;
  const tex = getGlowTex();
  const bhRadius = scale * 0.05;

  // 1. Event horizon — pure black sphere
  const horizonGeo = new THREE.SphereGeometry(bhRadius, 64, 64);
  const horizonMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
  const horizon = new THREE.Mesh(horizonGeo, horizonMat);
  group.add(horizon);

  // 2. Accretion disk — 12000 particles in ring around BH
  const diskCount = 12000;
  const diskPositions = new Float32Array(diskCount * 3);
  const diskColors = new Float32Array(diskCount * 3);

  const innerR = bhRadius * 2;
  const outerR = bhRadius * 10;

  for (let i = 0; i < diskCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const radius = innerR + Math.random() * (outerR - innerR);
    const ySpread = (Math.random() - 0.5) * bhRadius * 0.3;

    diskPositions[i * 3]     = Math.cos(angle) * radius;
    diskPositions[i * 3 + 1] = ySpread;
    diskPositions[i * 3 + 2] = Math.sin(angle) * radius;

    // Color by heat: inner = white-hot, outer = red
    const t = (radius - innerR) / (outerR - innerR); // 0 (inner) to 1 (outer)
    diskColors[i * 3]     = 1.0;
    diskColors[i * 3 + 1] = (1.0 - t) * 0.9 + 0.1;
    diskColors[i * 3 + 2] = (1.0 - t) * 0.7;
  }

  const diskGeom = new THREE.BufferGeometry();
  diskGeom.setAttribute('position', new THREE.BufferAttribute(diskPositions, 3));
  diskGeom.setAttribute('color', new THREE.BufferAttribute(diskColors, 3));

  const diskMat = new THREE.PointsMaterial({
    vertexColors: true,
    size: scale * 0.008,
    map: tex,
    sizeAttenuation: true,
    blending: THREE.AdditiveBlending,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
  });

  const accretion = new THREE.Points(diskGeom, diskMat);
  accretion.userData._isAccretion = true;
  group.add(accretion);

  // 3. Two relativistic jets along Y axis (2000 particles each)
  for (const dir of [1, -1]) {
    const jetCount = 2000;
    const jetPositions = new Float32Array(jetCount * 3);
    const jetColors = new Float32Array(jetCount * 3);

    for (let i = 0; i < jetCount; i++) {
      const t = Math.random(); // 0 = base, 1 = tip
      const dist = t * scale * 0.5;
      const coneRadius = t * bhRadius * 2; // expanding cone

      const angle = Math.random() * Math.PI * 2;
      const rx = Math.cos(angle) * coneRadius * Math.random();
      const rz = Math.sin(angle) * coneRadius * Math.random();

      jetPositions[i * 3]     = rx;
      jetPositions[i * 3 + 1] = dir * dist;
      jetPositions[i * 3 + 2] = rz;

      // Blue tint
      const brightness = 0.5 + Math.random() * 0.5;
      jetColors[i * 3]     = 0.3 * brightness;
      jetColors[i * 3 + 1] = 0.5 * brightness;
      jetColors[i * 3 + 2] = 1.0 * brightness;
    }

    const jetGeom = new THREE.BufferGeometry();
    jetGeom.setAttribute('position', new THREE.BufferAttribute(jetPositions, 3));
    jetGeom.setAttribute('color', new THREE.BufferAttribute(jetColors, 3));

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

  // 4. Glow shells (BackSide spheres)
  const glowDefs = [
    { r: bhRadius * 4, color: 0xff4400, opacity: 0.08 },
    { r: bhRadius * 8, color: 0xff2200, opacity: 0.04 },
  ];

  for (const g of glowDefs) {
    const geo = new THREE.SphereGeometry(g.r, 32, 32);
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
}

// ═══════════════════════════════════════════════════════════════════════
// 2. Andromeda — Spiral Galaxy
// ═══════════════════════════════════════════════════════════════════════
export function createSpiralGalaxy(group, def) {
  const scale = def.size * 3000;
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
export function createSombreroGalaxy(group, def) {
  const scale = def.size * 3000;
  const tex = getGlowTex();

  // 1. Bright elliptical bulge — 15000 particles
  const bulgeCount = 15000;
  const bulgePositions = new Float32Array(bulgeCount * 3);
  const bulgeColors = new Float32Array(bulgeCount * 3);

  for (let i = 0; i < bulgeCount; i++) {
    // Gaussian distribution for bulge shape
    const r = Math.abs(gaussRandom()) * scale * 0.12;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);

    // Elongated in X (1.5x), compressed in Y (0.5x)
    const x = r * Math.sin(phi) * Math.cos(theta) * 1.5;
    const y = r * Math.sin(phi) * Math.sin(theta) * 0.5;
    const z = r * Math.cos(phi);

    bulgePositions[i * 3]     = x;
    bulgePositions[i * 3 + 1] = y;
    bulgePositions[i * 3 + 2] = z;

    // Warm yellow-white
    const brightness = 0.6 + Math.random() * 0.4;
    bulgeColors[i * 3]     = 1.0 * brightness;
    bulgeColors[i * 3 + 1] = 0.9 * brightness;
    bulgeColors[i * 3 + 2] = 0.7 * brightness;
  }

  const bulgeGeom = new THREE.BufferGeometry();
  bulgeGeom.setAttribute('position', new THREE.BufferAttribute(bulgePositions, 3));
  bulgeGeom.setAttribute('color', new THREE.BufferAttribute(bulgeColors, 3));

  const bulgeMat = new THREE.PointsMaterial({
    vertexColors: true,
    size: scale * 0.005,
    map: tex,
    sizeAttenuation: true,
    blending: THREE.AdditiveBlending,
    transparent: true,
    opacity: 0.25,
    depthWrite: false,
  });

  group.add(new THREE.Points(bulgeGeom, bulgeMat));

  // 2. Edge-on disk — 20000 particles in thin ring
  const diskCount = 20000;
  const diskPositions = new Float32Array(diskCount * 3);
  const diskColors = new Float32Array(diskCount * 3);

  for (let i = 0; i < diskCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const radius = scale * 0.1 + Math.random() * scale * 0.25;
    const ySpread = gaussRandom() * scale * 0.005; // very thin

    diskPositions[i * 3]     = Math.cos(angle) * radius;
    diskPositions[i * 3 + 1] = ySpread;
    diskPositions[i * 3 + 2] = Math.sin(angle) * radius;

    // Muted colors
    const brightness = 0.3 + Math.random() * 0.3;
    diskColors[i * 3]     = 0.8 * brightness;
    diskColors[i * 3 + 1] = 0.7 * brightness;
    diskColors[i * 3 + 2] = 0.5 * brightness;
  }

  const diskGeom = new THREE.BufferGeometry();
  diskGeom.setAttribute('position', new THREE.BufferAttribute(diskPositions, 3));
  diskGeom.setAttribute('color', new THREE.BufferAttribute(diskColors, 3));

  const diskMat = new THREE.PointsMaterial({
    vertexColors: true,
    size: scale * 0.004,
    map: tex,
    sizeAttenuation: true,
    blending: THREE.AdditiveBlending,
    transparent: true,
    opacity: 0.15,
    depthWrite: false,
  });

  group.add(new THREE.Points(diskGeom, diskMat));

  // 3. Dark dust lane — RingGeometry
  const dustInnerR = scale * 0.12;
  const dustOuterR = scale * 0.3;
  const ringGeo = new THREE.RingGeometry(dustInnerR, dustOuterR, 128, 4);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0x110800,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
  });
  const dustLane = new THREE.Mesh(ringGeo, ringMat);
  // Rotate horizontal (align with disk plane)
  dustLane.rotation.x = Math.PI * 0.5;
  group.add(dustLane);
}

// ═══════════════════════════════════════════════════════════════════════
// 4. Bootes Void
// ───────────────────────────────────────────────────────────────────────
// The real Bootes Void is a 330 Mly-wide underdense region. The sense we
// want the player to feel is: "I'm inside a bubble of emptiness with a
// distant wall of galaxies surrounding me." Previously this rendered as
// one thin shell of grey points + a handful of near-invisible sprites.
// The redesign:
//   • Three nested shells at different radii → the boundary reads as a
//     thick wall with depth when the player turns their head.
//   • Shell galaxies are actual colored sprites (warm core, cool arm
//     tinting, varied scale) rather than uniform points, so they look
//     like galaxies and not a particle cloud.
//   • A very sparse set of faint galaxies drifts inside the void —
//     enough to give parallax reference without filling the space.
//   • A large dim inner glow sphere subtly darkens the interior,
//     reinforcing the "emptiness" mood without going fully black.
// ═══════════════════════════════════════════════════════════════════════
export function createBootesVoid(group, def) {
  const scale = def.size * 3000;
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
