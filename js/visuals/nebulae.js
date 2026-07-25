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


/**
 * 2.5D layer factory: split a NASA photo into depth layers so the object
 * has real internal parallax instead of reading as one flat picture.
 *  - base:  the full photo, edge-feathered (rendered additively, far)
 *  - glow:  bright/blue nebulosity matte (additive, middle)
 *  - dark:  dark-structure matte — pixels darker than their local
 *           neighborhood, i.e. dust columns against glow (rendered with
 *           NORMAL blending so it truly occludes what lies behind)
 */
function makePhotoLayers(tex) {
  if (!tex || !tex.image) return null;
  try {
    const img = tex.image;
    const W = img.width, H = img.height;

    const draw = () => {
      const cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      const ctx = cv.getContext('2d');
      ctx.drawImage(img, 0, 0);
      return { cv, ctx };
    };

    // Blurred copy = local neighborhood brightness
    const blur = document.createElement('canvas');
    blur.width = W; blur.height = H;
    const bctx = blur.getContext('2d');
    bctx.filter = `blur(${Math.round(W / 55)}px)`;
    bctx.drawImage(img, 0, 0);
    const blurPx = bctx.getImageData(0, 0, W, H).data;

    const feather = (px) => {
      const cx = W / 2, cy = H / 2;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const dx = (x - cx) / cx, dy = (y - cy) / cy;
          const d = Math.sqrt(dx * dx + dy * dy);
          const t = Math.max(0, Math.min(1, (d - 0.5) / 0.47));
          const f = 1 - t * t * (3 - 2 * t);
          const i = (y * W + x) * 4;
          px[i + 3] = Math.round(px[i + 3] * f);
        }
      }
    };

    const finish = (cv, ctx, data) => {
      ctx.putImageData(data, 0, 0);
      const t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };

    // ── base: full photo, feathered ──
    const b = draw();
    const bData = b.ctx.getImageData(0, 0, W, H);
    for (let i = 0; i < bData.data.length; i += 4) bData.data[i + 3] = 255;
    feather(bData.data);
    const baseTex = finish(b.cv, b.ctx, bData);

    // ── glow: bright + blue nebulosity ──
    const g = draw();
    const gData = g.ctx.getImageData(0, 0, W, H);
    {
      const px = gData.data;
      for (let i = 0; i < px.length; i += 4) {
        const lum = px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
        const blueness = Math.max(0, px[i + 2] - Math.max(px[i], px[i + 1]) * 0.6);
        px[i + 3] = Math.min(255, blueness * 2.2 + Math.max(0, lum - 90) * 1.4);
      }
      feather(px);
    }
    const glowTex = finish(g.cv, g.ctx, gData);

    // ── dark: structure darker than its neighborhood (the columns) ──
    const d = draw();
    const dData = d.ctx.getImageData(0, 0, W, H);
    {
      const px = dData.data;
      for (let i = 0; i < px.length; i += 4) {
        const lum = px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
        const nLum = blurPx[i] * 0.299 + blurPx[i + 1] * 0.587 + blurPx[i + 2] * 0.114;
        // Opaque where markedly darker than surroundings AND surroundings glow
        const darkness = Math.max(0, nLum - lum - 6) * 2.6;
        const context = Math.min(1, nLum / 70);
        px[i + 3] = Math.min(235, darkness * context);
      }
      feather(px);
    }
    const darkTex = finish(d.cv, d.ctx, dData);

    return { baseTex, glowTex, darkTex };
  } catch (e) {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 1. Pillars of Creation
// ═══════════════════════════════════════════════════════════════════════
export function createPillars(group, def, textures) {
  // Hubble's near-infrared Pillars as a 2.5D object inside an extended
  // environment: three depth-separated layers of the real photograph
  // (deep field, blue gas, occluding dark columns) so the structure has
  // internal parallax — plus vast faint wisps continuing the Eagle
  // Nebula complex far beyond the photo, so the region never "ends".
  const s = def.size * (def._scaleUnit || 500);
  const tex = getNebulaParticleTex();
  const ASPECT = 3045 / 3249;

  const layers = textures && textures.landmarkPillars
    ? makePhotoLayers(textures.landmarkPillars)
    : null;

  if (layers) {
    const addLayer = (map, z, scale, opacity, blending, order) => {
      const mat = new THREE.SpriteMaterial({
        map, transparent: true, opacity, blending, depthWrite: false,
      });
      const sp = new THREE.Sprite(mat);
      sp.scale.set(s * 1.6 * scale, s * 1.6 * ASPECT * scale, 1);
      sp.position.z = z;
      sp.renderOrder = order;
      group.add(sp);
      return sp;
    };
    // Far field, larger and behind
    addLayer(layers.baseTex, -s * 0.34, 1.3, 0.62, THREE.AdditiveBlending, 2);
    // Nebular gas at the heart
    addLayer(layers.glowTex, -s * 0.06, 1.02, 0.95, THREE.AdditiveBlending, 3);
    // The columns — occluding, in front
    addLayer(layers.darkTex, s * 0.24, 0.86, 1.0, THREE.NormalBlending, 4);
  }

  // ── Extended environment — the complex continues beyond the frame ──
  {
    const count = 130;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = s * (1.1 + Math.random() * 1.9);
      const a = Math.random() * Math.PI * 2;
      positions[i * 3]     = Math.cos(a) * r;
      positions[i * 3 + 1] = gaussRandom() * s * 0.9;
      positions[i * 3 + 2] = Math.sin(a) * r * 0.7 - s * 0.3;
      const warm = Math.random() < 0.3;
      const b = 0.05 + Math.random() * 0.075;
      colors[i * 3]     = b * (warm ? 1.0 : 0.5);
      colors[i * 3 + 1] = b * (warm ? 0.72 : 0.62);
      colors[i * 3 + 2] = b * (warm ? 0.45 : 1.0);
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      vertexColors: true, map: tex, size: s * 0.85, sizeAttenuation: true,
      blending: THREE.AdditiveBlending, transparent: true, opacity: 0.16,
      depthWrite: false,
    });
    const pts = new THREE.Points(geom, mat);
    pts.renderOrder = 1;
    group.add(pts);
  }

  // ── Parallax star volume threading through all layers ──
  {
    const count = 900;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const depth = gaussRandom() * s * 0.7;
      positions[i * 3]     = (Math.random() - 0.5) * s * 2.6;
      positions[i * 3 + 1] = (Math.random() - 0.5) * s * 2.2;
      positions[i * 3 + 2] = depth;
      const warm = Math.random() < 0.8;
      const b = 0.15 + Math.random() * 0.5;
      colors[i * 3]     = b * (warm ? 1.0 : 0.75);
      colors[i * 3 + 1] = b * (warm ? 0.8 : 0.85);
      colors[i * 3 + 2] = b * (warm ? 0.5 : 1.0);
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      vertexColors: true, map: tex, size: s * 0.011, sizeAttenuation: true,
      blending: THREE.AdditiveBlending, transparent: true, opacity: 0.8,
      depthWrite: false,
    });
    const pts = new THREE.Points(geom, mat);
    pts.renderOrder = 5;
    group.add(pts);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 2. Crab Nebula
// ═══════════════════════════════════════════════════════════════════════
export function createCrabNebula(group, def) {
  const scale = def.size * (def._scaleUnit || 500);
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
  const scale = def.size * (def._scaleUnit || 500);
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
  const scale = def.size * (def._scaleUnit || 500);
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
