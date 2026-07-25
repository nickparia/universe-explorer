import * as THREE from 'three';

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
  const scale = def.size * 3000;
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
export function createRingNebula(group, def) {
  const scale = def.size * 3000;
  const tex = getGlowTex();

  const ringRadius = scale * 0.3;
  const tubeRadius = ringRadius * 0.2;

  // Torus of 8000 particles
  const count = 8000;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    // Torus parametric
    const theta = Math.random() * Math.PI * 2; // around the ring
    const phi = Math.random() * Math.PI * 2;   // around the tube

    // Add some gaussian noise to tube radius for organic feel
    const r = tubeRadius * (1 + gaussRandom() * 0.15);

    const x = (ringRadius + r * Math.cos(phi)) * Math.cos(theta);
    const y = r * Math.sin(phi) * 0.6; // flattened y
    const z = (ringRadius + r * Math.cos(phi)) * Math.sin(theta);

    positions[i * 3]     = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;

    // Color gradient: blue-green inner edge to red-orange outer
    // Inner edge = small phi offset from center, outer = large phi offset
    const distFromCenter = Math.sqrt(x * x + z * z);
    const t = (distFromCenter - (ringRadius - tubeRadius)) / (2 * tubeRadius);
    const clamped = Math.max(0, Math.min(1, t));

    const brightness = 0.5 + Math.random() * 0.5;
    colors[i * 3]     = (0.1 + clamped * 0.9) * brightness;   // R: low inner, high outer
    colors[i * 3 + 1] = (0.8 - clamped * 0.5) * brightness;   // G: high inner, moderate outer
    colors[i * 3 + 2] = (0.9 - clamped * 0.7) * brightness;   // B: high inner, low outer
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.PointsMaterial({
    vertexColors: true,
    size: scale * 0.012,
    map: tex,
    sizeAttenuation: true,
    blending: THREE.AdditiveBlending,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
  });

  group.add(new THREE.Points(geom, mat));

  // Dying white dwarf at center: small sphere + bright glow sprite
  const dwarfGeo = new THREE.SphereGeometry(scale * 0.02, 16, 16);
  const dwarfMat = new THREE.MeshBasicMaterial({ color: 0xeeeeff });
  group.add(new THREE.Mesh(dwarfGeo, dwarfMat));

  const spriteMat = new THREE.SpriteMaterial({
    map: tex,
    color: 0xccddff,
    blending: THREE.AdditiveBlending,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(spriteMat);
  sprite.scale.set(scale * 0.06, scale * 0.06, 1);
  group.add(sprite);
}

// ═══════════════════════════════════════════════════════════════════════
// 3. Eta Carinae — Bipolar homunculus nebula
// ═══════════════════════════════════════════════════════════════════════
export function createEtaCarinae(group, def) {
  const scale = def.size * 3000;
  const tex = getGlowTex();

  // Two bipolar lobes (5000 particles each, one +Y, one -Y)
  for (const dir of [1, -1]) {
    const lobeCount = 5000;
    const positions = new Float32Array(lobeCount * 3);
    const colors = new Float32Array(lobeCount * 3);

    for (let i = 0; i < lobeCount; i++) {
      // Paraboloid shape: x,z expand outward as y increases
      const t = Math.random(); // 0 = center, 1 = far end of lobe
      const yDist = t * scale * 0.4;

      // Paraboloid radius expands with sqrt(t)
      const maxRadius = scale * 0.2 * Math.sqrt(t);
      const angle = Math.random() * Math.PI * 2;
      const r = maxRadius * Math.pow(Math.random(), 0.5);

      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;
      const y = dir * yDist;

      positions[i * 3]     = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;

      // Color: bright yellow-white near star fading to orange at tips
      const brightness = 0.5 + Math.random() * 0.5;
      colors[i * 3]     = (1.0 - t * 0.2) * brightness;        // R stays high
      colors[i * 3 + 1] = (0.9 - t * 0.5) * brightness;        // G fades
      colors[i * 3 + 2] = (0.6 - t * 0.5) * brightness;        // B fades more
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.PointsMaterial({
      vertexColors: true,
      size: scale * 0.012,
      map: tex,
      sizeAttenuation: true,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.15,
      depthWrite: false,
    });

    group.add(new THREE.Points(geom, mat));
  }

  // Bright central star sprite
  const starMat = new THREE.SpriteMaterial({
    map: tex,
    color: 0xffffcc,
    blending: THREE.AdditiveBlending,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
  });
  const star = new THREE.Sprite(starMat);
  star.scale.set(scale * 0.05, scale * 0.05, 1);
  group.add(star);

  // Thin equatorial disk
  const diskGeo = new THREE.RingGeometry(scale * 0.02, scale * 0.25, 64, 1);
  const diskMat = new THREE.MeshBasicMaterial({
    color: 0xff8844,
    transparent: true,
    opacity: 0.08,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const disk = new THREE.Mesh(diskGeo, diskMat);
  disk.rotation.x = Math.PI / 2; // rotate to horizontal (XZ plane)
  group.add(disk);
}

// ═══════════════════════════════════════════════════════════════════════
// 4. Magnetar — Neutron star with extreme magnetic field
// ═══════════════════════════════════════════════════════════════════════
export function createMagnetar(group, def) {
  const scale = def.size * 3000;
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
