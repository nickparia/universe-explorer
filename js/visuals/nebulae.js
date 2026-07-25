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

/** Standard smoothstep */
function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Cached 64px radial glow particle texture */
let _nebulaParticleTex = null;
function getNebulaParticleTex() {
  if (_nebulaParticleTex) return _nebulaParticleTex;
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
  _nebulaParticleTex = new THREE.CanvasTexture(cv);
  return _nebulaParticleTex;
}

// ═══════════════════════════════════════════════════════════════════════
// 1. Pillars of Creation
// ═══════════════════════════════════════════════════════════════════════
export function createPillars(group, def) {
  const scale = def.size * 3000;
  const tex = getNebulaParticleTex();

  // Three pillars: left (tallest), center, right (shortest)
  const pillarDefs = [
    { xOff: -0.25, height: 1.0, width: 0.12 },
    { xOff:  0.0,  height: 0.75, width: 0.10 },
    { xOff:  0.22, height: 0.55, width: 0.09 },
  ];

  for (const pDef of pillarDefs) {
    const count = 6000;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      // Gaussian distribution in x/z for columnar shape
      const x = pDef.xOff * scale + gaussRandom() * pDef.width * scale;
      const z = gaussRandom() * pDef.width * scale;
      // Uniform y distribution along pillar height
      const y = Math.random() * pDef.height * scale;

      positions[i * 3]     = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;

      // Warm amber/brown palette with brighter tips
      const heightFrac = y / (pDef.height * scale);
      const tipBrightness = smoothstep(0.7, 1.0, heightFrac);
      const base = 0.3 + Math.random() * 0.3 + tipBrightness * 0.4;

      colors[i * 3]     = base;                  // R dominant
      colors[i * 3 + 1] = base * 0.55;           // G ~0.55 of R
      colors[i * 3 + 2] = base * 0.2;            // B ~0.2 of R
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.PointsMaterial({
      vertexColors: true,
      size: scale * 0.02,
      map: tex,
      sizeAttenuation: true,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.15,
      depthWrite: false,
    });

    group.add(new THREE.Points(geom, mat));

    // Bright star sprites at pillar tips (star-forming regions)
    const tipStarCount = 5;
    for (let s = 0; s < tipStarCount; s++) {
      const starMat = new THREE.SpriteMaterial({
        map: tex,
        color: 0xffffcc,
        blending: THREE.AdditiveBlending,
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
      });
      const star = new THREE.Sprite(starMat);
      const sx = pDef.xOff * scale + (Math.random() - 0.5) * pDef.width * scale * 0.5;
      const sy = pDef.height * scale * (0.9 + Math.random() * 0.1);
      const sz = (Math.random() - 0.5) * pDef.width * scale * 0.5;
      star.position.set(sx, sy, sz);
      star.scale.set(scale * 0.03, scale * 0.03, 1);
      group.add(star);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 2. Crab Nebula
// ═══════════════════════════════════════════════════════════════════════
export function createCrabNebula(group, def) {
  const scale = def.size * 3000;
  const tex = getNebulaParticleTex();

  // Spherical shell of filamentary particles
  const shellCount = 8000;
  const positions = new Float32Array(shellCount * 3);
  const colors = new Float32Array(shellCount * 3);

  for (let i = 0; i < shellCount; i++) {
    // Shell distribution: radius between 0.3 and 0.5 of scale
    const r = (0.3 + Math.random() * 0.2) * scale;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);

    const x = r * Math.sin(phi) * Math.cos(theta);
    const y = r * Math.sin(phi) * Math.sin(theta);
    const z = r * Math.cos(phi);

    positions[i * 3]     = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;

    // Color gradient: blue-white at center fading to orange/red at edges
    const dist = r / (0.5 * scale); // 0.6 (inner) to 1.0 (outer)
    const t = smoothstep(0.6, 1.0, dist);

    colors[i * 3]     = 0.4 + t * 0.6;          // R: rises toward edges
    colors[i * 3 + 1] = 0.5 + (1 - t) * 0.4;   // G: higher at center
    colors[i * 3 + 2] = 0.8 * (1 - t) + 0.2;   // B: high at center, fades
  }

  const shellGeom = new THREE.BufferGeometry();
  shellGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  shellGeom.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const shellMat = new THREE.PointsMaterial({
    vertexColors: true,
    size: scale * 0.015,
    map: tex,
    sizeAttenuation: true,
    blending: THREE.AdditiveBlending,
    transparent: true,
    opacity: 0.15,
    depthWrite: false,
  });

  group.add(new THREE.Points(shellGeom, shellMat));

  // Pulsar at center
  const pulsarMat = new THREE.SpriteMaterial({
    map: tex,
    color: 0xccddff,
    blending: THREE.AdditiveBlending,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  });
  const pulsar = new THREE.Sprite(pulsarMat);
  pulsar.scale.set(scale * 0.04, scale * 0.04, 1);
  pulsar.userData._isPulsar = true;
  group.add(pulsar);

  // Two opposing particle beam jets along Y axis
  for (const dir of [1, -1]) {
    const beamCount = 1500;
    const beamPositions = new Float32Array(beamCount * 3);
    const beamColors = new Float32Array(beamCount * 3);

    for (let i = 0; i < beamCount; i++) {
      // Narrow cone along Y axis
      const t = Math.random(); // 0 = center, 1 = tip
      const dist = t * scale * 0.6;
      const coneRadius = t * scale * 0.03; // narrow cone

      const angle = Math.random() * Math.PI * 2;
      const rx = Math.cos(angle) * coneRadius * gaussRandom() * 0.3;
      const rz = Math.sin(angle) * coneRadius * gaussRandom() * 0.3;

      beamPositions[i * 3]     = rx;
      beamPositions[i * 3 + 1] = dir * dist;
      beamPositions[i * 3 + 2] = rz;

      // Blue tint
      const brightness = 0.5 + Math.random() * 0.5;
      beamColors[i * 3]     = 0.3 * brightness;
      beamColors[i * 3 + 1] = 0.5 * brightness;
      beamColors[i * 3 + 2] = 1.0 * brightness;
    }

    const beamGeom = new THREE.BufferGeometry();
    beamGeom.setAttribute('position', new THREE.BufferAttribute(beamPositions, 3));
    beamGeom.setAttribute('color', new THREE.BufferAttribute(beamColors, 3));

    const beamMat = new THREE.PointsMaterial({
      vertexColors: true,
      size: scale * 0.008,
      map: tex,
      sizeAttenuation: true,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
    });

    const beam = new THREE.Points(beamGeom, beamMat);
    beam.userData._isPulsarBeam = true;
    group.add(beam);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 3. Carina Nebula
// ═══════════════════════════════════════════════════════════════════════
export function createCarinaNebula(group, def) {
  const scale = def.size * 3000;
  const tex = getNebulaParticleTex();

  // "Cosmic cliffs" — wide in X, tall in Y, thin in Z
  const count = 10000;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    const x = (Math.random() - 0.5) * scale * 0.8;     // wide in X
    const y = Math.random() * scale * 0.5;              // tall in Y
    const z = gaussRandom() * scale * 0.03;             // thin in Z (gaussian)

    positions[i * 3]     = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;

    // Color: deep blue at base transitioning to gold at irradiated top
    const heightFrac = y / (scale * 0.5);
    const t = smoothstep(0.0, 1.0, heightFrac);

    const brightness = 0.4 + Math.random() * 0.3;
    colors[i * 3]     = (0.1 + t * 0.9) * brightness;   // R: low at base, high at top
    colors[i * 3 + 1] = (0.2 + t * 0.6) * brightness;   // G: moderate
    colors[i * 3 + 2] = (0.8 - t * 0.5) * brightness;   // B: high at base, lower at top
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

  // Bright star sprites along the cliff edge (top)
  for (let s = 0; s < 15; s++) {
    const starMat = new THREE.SpriteMaterial({
      map: tex,
      color: 0xffffff,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    const star = new THREE.Sprite(starMat);
    const sx = (Math.random() - 0.5) * scale * 0.7;
    const sy = scale * 0.5 * (0.85 + Math.random() * 0.15); // near the top
    const sz = gaussRandom() * scale * 0.02;
    star.position.set(sx, sy, sz);
    star.scale.set(scale * 0.025, scale * 0.025, 1);
    group.add(star);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 4. Horsehead Nebula
// ═══════════════════════════════════════════════════════════════════════
export function createHorsehead(group, def) {
  const scale = def.size * 3000;
  const tex = getNebulaParticleTex();

  // Background: red hydrogen emission glow (flat backdrop)
  const bgCount = 6000;
  const bgPositions = new Float32Array(bgCount * 3);
  const bgColors = new Float32Array(bgCount * 3);

  for (let i = 0; i < bgCount; i++) {
    const x = (Math.random() - 0.5) * scale * 0.7;
    const y = (Math.random() - 0.3) * scale * 0.6;
    const z = -scale * 0.05 + gaussRandom() * scale * 0.02; // flat behind

    bgPositions[i * 3]     = x;
    bgPositions[i * 3 + 1] = y;
    bgPositions[i * 3 + 2] = z;

    // Red hydrogen emission
    const brightness = 0.5 + Math.random() * 0.5;
    bgColors[i * 3]     = 0.9 * brightness;
    bgColors[i * 3 + 1] = 0.15 * brightness;
    bgColors[i * 3 + 2] = 0.1 * brightness;
  }

  const bgGeom = new THREE.BufferGeometry();
  bgGeom.setAttribute('position', new THREE.BufferAttribute(bgPositions, 3));
  bgGeom.setAttribute('color', new THREE.BufferAttribute(bgColors, 3));

  const bgMat = new THREE.PointsMaterial({
    vertexColors: true,
    size: scale * 0.015,
    map: tex,
    sizeAttenuation: true,
    blending: THREE.AdditiveBlending,
    transparent: true,
    opacity: 0.15,
    depthWrite: false,
  });

  group.add(new THREE.Points(bgGeom, bgMat));

  // Foreground: dark horsehead silhouette
  const fgCount = 3000;
  const fgPositions = new Float32Array(fgCount * 3);
  const fgColors = new Float32Array(fgCount * 3);

  for (let i = 0; i < fgCount; i++) {
    // Column/neck shape (narrow) with wider head protrusion at top
    const t = Math.random(); // 0 = bottom, 1 = top
    const y = (t - 0.3) * scale * 0.5;

    // Neck is narrow, head region (t > 0.7) is wider and shifted
    let xWidth, xOffset;
    if (t > 0.7) {
      // Head region — wider, shifted to the right
      const headT = (t - 0.7) / 0.3; // 0 to 1 within head
      xWidth = scale * 0.08 * (1 + headT * 0.8);
      xOffset = scale * 0.04 * headT;
    } else {
      // Neck/column — narrow
      xWidth = scale * 0.04;
      xOffset = 0;
    }

    const x = xOffset + gaussRandom() * xWidth;
    const z = scale * 0.01 + gaussRandom() * scale * 0.015; // slightly in front of background

    fgPositions[i * 3]     = x;
    fgPositions[i * 3 + 1] = y;
    fgPositions[i * 3 + 2] = z;

    // Very dark brown/black colors
    fgColors[i * 3]     = 0.03;
    fgColors[i * 3 + 1] = 0.02;
    fgColors[i * 3 + 2] = 0.01;
  }

  const fgGeom = new THREE.BufferGeometry();
  fgGeom.setAttribute('position', new THREE.BufferAttribute(fgPositions, 3));
  fgGeom.setAttribute('color', new THREE.BufferAttribute(fgColors, 3));

  const fgMat = new THREE.PointsMaterial({
    vertexColors: true,
    size: scale * 0.018,
    map: tex,
    sizeAttenuation: true,
    blending: THREE.NormalBlending, // NOT additive — dark particles occlude the red background
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  });

  group.add(new THREE.Points(fgGeom, fgMat));
}
