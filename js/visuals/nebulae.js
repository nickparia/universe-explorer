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
 * 2.5D layer factory — split a NASA photo into depth-layer textures.
 * recipes: array of { kind, ...params }:
 *   'full'   the whole photo (alpha 255 everywhere before feathering)
 *   'bright' luminance above params.lumLo (bulges, cores)
 *   'cool'   blueness + high luminance (blue gas, synchrotron glow)
 *   'warm'   warmth ((r+g)/2 - b) — gold/orange filaments and dust rims
 *   'dark'   pixels darker than their blurred neighborhood (dust columns)
 * Common params: floorSub (subtract a sky floor from RGB — kills mosaic
 * tile seams under additive blending). All layers are edge-feathered.
 * Processing is capped at maxDim px so huge mosaics can't hitch boot.
 */
export function makePhotoLayers(tex, recipes, maxDim = 2200) {
  if (!tex || !tex.image) return null;
  try {
    const img = tex.image;
    const k = Math.min(1, maxDim / Math.max(img.width, img.height));
    const W = Math.round(img.width * k), H = Math.round(img.height * k);

    // Blurred copy = neighborhood brightness (for 'dark' mattes)
    let blurPx = null;
    if (recipes.some(r => r.kind === 'dark')) {
      const bcv = document.createElement('canvas');
      bcv.width = W; bcv.height = H;
      const bctx = bcv.getContext('2d');
      bctx.filter = `blur(${Math.round(W / 55)}px)`;
      bctx.drawImage(img, 0, 0, W, H);
      blurPx = bctx.getImageData(0, 0, W, H).data;
    }

    const out = [];
    for (const recipe of recipes) {
      const cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      const ctx = cv.getContext('2d');
      ctx.drawImage(img, 0, 0, W, H);
      const data = ctx.getImageData(0, 0, W, H);
      const px = data.data;
      const floor = recipe.floorSub || 0;
      const lumLo = recipe.lumLo ?? 110;

      for (let i = 0; i < px.length; i += 4) {
        if (floor) {
          px[i]     = Math.max(0, px[i] - floor);
          px[i + 1] = Math.max(0, px[i + 1] - floor);
          px[i + 2] = Math.max(0, px[i + 2] - floor);
        }
        const r = px[i], g = px[i + 1], b = px[i + 2];
        const lum = r * 0.299 + g * 0.587 + b * 0.114;
        let a = 255;
        if (recipe.kind === 'bright') {
          a = Math.max(0, lum - lumLo) * 2.2;
        } else if (recipe.kind === 'cool') {
          const blueness = Math.max(0, b - Math.max(r, g) * 0.6);
          a = blueness * 2.2 + Math.max(0, lum - lumLo) * 1.4;
        } else if (recipe.kind === 'warm') {
          a = Math.max(0, (r + g) / 2 - b * 0.85) * 2.4;
        } else if (recipe.kind === 'dark') {
          const nLum = blurPx[i] * 0.299 + blurPx[i + 1] * 0.587 + blurPx[i + 2] * 0.114;
          const darkness = Math.max(0, nLum - lum - 6) * 2.6;
          a = Math.min(235, darkness * Math.min(1, nLum / 70));
        }
        px[i + 3] = Math.min(255, a);
      }

      // Elliptical edge feather — no photo ever ends at a rectangle
      const cx = W / 2, cy = H / 2;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const dx = (x - cx) / cx, dy = (y - cy) / cy;
          const d = Math.sqrt(dx * dx + dy * dy);
          const t = Math.max(0, Math.min(1, (d - 0.42) / 0.55));
          const f = 1 - t * t * (3 - 2 * t);
          const i = (y * W + x) * 4;
          px[i + 3] = Math.round(px[i + 3] * f);
        }
      }

      ctx.putImageData(data, 0, 0);
      const t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      out.push(t);
    }
    return out;
  } catch (e) {
    return null;
  }
}

/** Shared: add a stack of depth-layered photo sprites to a group */
export function addPhotoLayerStack(group, layers, spec, width, aspect) {
  for (let i = 0; i < layers.length; i++) {
    const sp = spec[i];
    const mat = new THREE.SpriteMaterial({
      map: layers[i], transparent: true, opacity: sp.opacity,
      blending: sp.normal ? THREE.NormalBlending : THREE.AdditiveBlending,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(width * sp.scale, width * aspect * sp.scale, 1);
    sprite.position.z = sp.z;
    sprite.renderOrder = sp.order;
    group.add(sprite);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 1. Pillars of Creation
// ═══════════════════════════════════════════════════════════════════════
export function createPillars(group, def, textures) {
  // JWST's 2022 NIRCam portrait — the definitive Pillars — in 2.5D.
  // Scale strategy (the two laws): stars are the reference points, so a
  // deep corridor of stars threads through and IN FRONT of the columns
  // along the approach axis; and nothing ends like a lightswitch — long
  // feather, far-reaching wisps, and the distance fade lives in main.js
  // (visible out to 16 radii).
  const s = def.size * (def._scaleUnit || 500);
  const tex = getNebulaParticleTex();

  const jwst = textures && textures.landmarkPillarsJwst;
  const hubble = textures && textures.landmarkPillars;

  if (jwst && jwst.image) {
    // JWST palette: the columns themselves are bright rusty-gold (warm
    // matte, front), indigo-blue nebular glow behind (cool matte), the
    // full frame as deep field. Portrait aspect — the towers TOWER.
    const layers = makePhotoLayers(jwst, [
      { kind: 'full' },
      { kind: 'cool', lumLo: 120 },
      { kind: 'warm' },
    ]);
    if (layers) {
      const ASPECT = 2000 / 1155; // portrait
      addPhotoLayerStack(group, layers, [
        { z: -s * 0.34, scale: 1.30, opacity: 0.55, order: 2 }, // deep field
        { z: -s * 0.08, scale: 1.02, opacity: 0.9, order: 3 },  // blue glow
        { z:  s * 0.22, scale: 0.9, opacity: 1.0, order: 4 },   // golden columns
      ], s * 1.05, ASPECT);
    }
  } else if (hubble && hubble.image) {
    const layers = makePhotoLayers(hubble, [
      { kind: 'full' },
      { kind: 'cool', lumLo: 90 },
      { kind: 'dark' },
    ]);
    if (layers) {
      addPhotoLayerStack(group, layers, [
        { z: -s * 0.34, scale: 1.30, opacity: 0.62, order: 2 },
        { z: -s * 0.06, scale: 1.02, opacity: 0.95, order: 3 },
        { z:  s * 0.24, scale: 0.86, opacity: 1.0, order: 4, normal: true },
      ], s * 1.6, 3045 / 3249);
    }
  }

  // ── Extended environment — the Eagle complex continues far beyond ──
  {
    const count = 170;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = s * (1.0 + Math.random() * 2.0);
      const a = Math.random() * Math.PI * 2;
      positions[i * 3]     = Math.cos(a) * r;
      positions[i * 3 + 1] = gaussRandom() * s * 1.0;
      positions[i * 3 + 2] = Math.sin(a) * r * 0.7 - s * 0.3;
      const warm = Math.random() < 0.4;
      const b = 0.045 + Math.random() * 0.07;
      colors[i * 3]     = b * (warm ? 1.0 : 0.45);
      colors[i * 3 + 1] = b * (warm ? 0.7 : 0.55);
      colors[i * 3 + 2] = b * (warm ? 0.4 : 1.0);
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      vertexColors: true, map: tex, size: s * 0.85, sizeAttenuation: true,
      blending: THREE.AdditiveBlending, transparent: true, opacity: 0.15,
      depthWrite: false,
    });
    const pts = new THREE.Points(geom, mat);
    pts.renderOrder = 1;
    group.add(pts);
  }

  // ── Reference-point stars: a deep corridor threading the approach ──
  // Denser near the object, thinning along +z toward arriving travelers;
  // stars stream PAST you on the way in and hang IN FRONT of the columns
  // at arrival — the eye's yardstick for how big the towers are.
  {
    const count = 1500;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const corridor = Math.random() < 0.4;
      let z;
      if (corridor) {
        z = s * (0.3 + Math.random() * 2.2); // between traveler and towers
      } else {
        z = gaussRandom() * s * 0.7;         // in and around the complex
      }
      const spread = 1.0 + Math.max(0, z / s) * 0.55; // corridor widens near you
      positions[i * 3]     = (Math.random() - 0.5) * s * 2.4 * spread;
      positions[i * 3 + 1] = (Math.random() - 0.5) * s * 2.6 * spread;
      positions[i * 3 + 2] = z;
      const warm = Math.random() < 0.75;
      const b = 0.14 + Math.random() * 0.5;
      colors[i * 3]     = b * (warm ? 1.0 : 0.78);
      colors[i * 3 + 1] = b * (warm ? 0.8 : 0.86);
      colors[i * 3 + 2] = b * (warm ? 0.5 : 1.0);
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      vertexColors: true, map: tex, size: s * 0.01, sizeAttenuation: true,
      blending: THREE.AdditiveBlending, transparent: true, opacity: 0.85,
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
export function createCrabNebula(group, def, textures) {
  // Hubble's Crab in 2.5D: the ghost-blue synchrotron heart behind, the
  // gold-green filament web in front — the cage visibly surrounding the
  // glow. A pulsar spark at the center; sparse Taurus field stars around.
  const s = def.size * (def._scaleUnit || 500);
  const tex = getNebulaParticleTex();

  const layers = textures && textures.landmarkCrab
    ? makePhotoLayers(textures.landmarkCrab, [
        { kind: 'full' },
        { kind: 'cool', lumLo: 165 },
        { kind: 'warm' },
      ])
    : null;

  if (layers) {
    addPhotoLayerStack(group, layers, [
      { z: -s * 0.30, scale: 1.26, opacity: 0.5, order: 2 },
      { z: -s * 0.08, scale: 1.0, opacity: 0.95, order: 3 },
      { z:  s * 0.20, scale: 0.9, opacity: 1.0, order: 4 },
    ], s * 1.5, 1.0);
  }

  // ── The pulsar — a hard spark with a soft breath around it ──
  {
    const core = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, color: 0xdfe9ff, blending: THREE.AdditiveBlending,
      transparent: true, opacity: 0.95, depthWrite: false,
    }));
    core.scale.set(s * 0.02, s * 0.02, 1);
    core.position.z = s * 0.1;
    core.renderOrder = 5;
    group.add(core);
    const breath = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, color: 0x8fb8ff, blending: THREE.AdditiveBlending,
      transparent: true, opacity: 0.3, depthWrite: false,
    }));
    breath.scale.set(s * 0.09, s * 0.09, 1);
    breath.position.z = s * 0.1;
    breath.renderOrder = 5;
    group.add(breath);
  }

  // ── Environment: faint expanding wisps beyond the visible shell ──
  {
    const count = 90;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = s * (0.9 + Math.random() * 1.1);
      const a = Math.random() * Math.PI * 2;
      const y = gaussRandom() * s * 0.55;
      positions[i * 3]     = Math.cos(a) * r;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = Math.sin(a) * r * 0.6 - s * 0.15;
      const warm = Math.random() < 0.5;
      const b = 0.04 + Math.random() * 0.06;
      colors[i * 3]     = b * (warm ? 1.0 : 0.5);
      colors[i * 3 + 1] = b * (warm ? 0.75 : 0.75);
      colors[i * 3 + 2] = b * (warm ? 0.4 : 1.0);
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      vertexColors: true, map: tex, size: s * 0.7, sizeAttenuation: true,
      blending: THREE.AdditiveBlending, transparent: true, opacity: 0.12,
      depthWrite: false,
    });
    const pts = new THREE.Points(geom, mat);
    pts.renderOrder = 1;
    group.add(pts);
  }

  // ── Taurus field stars in true depth ──
  {
    const count = 320;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3]     = (Math.random() - 0.5) * s * 2.6;
      positions[i * 3 + 1] = (Math.random() - 0.5) * s * 2.2;
      positions[i * 3 + 2] = gaussRandom() * s * 0.7;
      const warm = Math.random() < 0.4;
      const b = 0.15 + Math.random() * 0.45;
      colors[i * 3]     = b * (warm ? 1.0 : 0.8);
      colors[i * 3 + 1] = b * (warm ? 0.82 : 0.88);
      colors[i * 3 + 2] = b * (warm ? 0.55 : 1.0);
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
