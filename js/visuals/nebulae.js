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

function getSoftTex() { return getNebulaParticleTex(); }

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
      // blurPx: compute this matte from a blurred source — field stars
      // (a few px wide) dissolve while diffuse nebulosity survives, so
      // the layer is star-free. Used for distant-identity layers.
      if (recipe.blurPx) ctx.filter = `blur(${recipe.blurPx}px)`;
      ctx.drawImage(img, 0, 0, W, H);
      ctx.filter = 'none';
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
      t.userData._recipeKind = recipe.kind;
      t.userData._context = !!recipe.context;
      t.userData._blurred = !!recipe.blurPx;
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
    // The 'full' layer carries the photograph's own background starfield —
    // context that must dissolve at range (see the landmark loop in main).
    mat.userData._contextPhoto =
      !!(layers[i].userData &&
         !layers[i].userData._blurred &&
         (layers[i].userData._recipeKind === 'full' || layers[i].userData._context));
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(width * sp.scale, width * aspect * sp.scale, 1);
    sprite.position.z = sp.z;
    sprite.renderOrder = sp.order;
    group.add(sprite);
  }
}

/**
 * The greater complex — an outskirts shroud shared by the photo
 * landmarks. A photograph that ends where its feather ends reads as
 * pasted on the void; real nebulae sit inside the cloud they condensed
 * from. Two scales of environment beyond the frame: giant whisper-dim
 * wisps out to many radii (the parent cloud), and a sparse grain of
 * dust motes threading the whole volume — the parallax that connects
 * the last leg of an approach to the place itself. Both are Points, so
 * the context resolve in main.js breathes them in on approach like a
 * telescope closing in. Doctrine: dim additive only (never bright
 * enough to bloom), gaussian shells — nothing ends like a lightswitch.
 */
export function addOutskirtsShroud(group, s, opts = {}) {
  const {
    warm = [1.0, 0.7, 0.4],
    cool = [0.45, 0.55, 1.0],
    warmFrac = 0.5,
    flat = 0.55,   // vertical squash — complexes sprawl wider than tall
    reach = 7,     // wisp shell outer edge, in radii
  } = opts;
  const tex = getNebulaParticleTex();

  const shell = (count, rLo, rHi, inward, squash) => {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = s * (rLo + Math.pow(Math.random(), inward) * (rHi - rLo));
      let x = gaussRandom(), y = gaussRandom(), z = gaussRandom();
      const n = Math.hypot(x, y, z) || 1;
      positions[i * 3]     = (x / n) * r;
      positions[i * 3 + 1] = (y / n) * r * squash;
      positions[i * 3 + 2] = (z / n) * r;
    }
    return { positions, colors };
  };
  const tint = (colors, i, b) => {
    const c = Math.random() < warmFrac ? warm : cool;
    colors[i * 3] = b * c[0]; colors[i * 3 + 1] = b * c[1]; colors[i * 3 + 2] = b * c[2];
  };
  const points = (buf, size, opacity, order) => {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(buf.positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(buf.colors, 3));
    const mat = new THREE.PointsMaterial({
      vertexColors: true, map: tex, size, sizeAttenuation: true,
      blending: THREE.AdditiveBlending, transparent: true, opacity,
      depthWrite: false,
    });
    const pts = new THREE.Points(geom, mat);
    pts.renderOrder = order;
    pts.userData._shroud = true;
    group.add(pts);
  };

  // Parent-cloud wisps: whisper-dim, far beyond the photo. Many SMALL
  // wisps, never few large ones — a big soft sprite crossed up close
  // reads as a bokeh smudge hanging in the void, while small overlapping
  // wisps melt into continuous nebulosity.
  {
    const buf = shell(240, 2.0, reach, 1.5, flat);
    for (let i = 0; i < 240; i++) tint(buf.colors, i, 0.028 + Math.random() * 0.045);
    points(buf, s * 0.9, 0.055, 0);
  }
  // Dust motes: sparse grains through the whole volume — what streams
  // past the glass on the way in
  {
    const buf = shell(420, 1.3, reach + 2, 1.3, Math.min(1, flat * 1.5));
    for (let i = 0; i < 420; i++) tint(buf.colors, i, 0.05 + Math.random() * 0.1);
    points(buf, s * 0.02, 0.5, 5);
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
      { kind: 'cool', lumLo: 120, context: true }, // JWST field: star-dense
      { kind: 'warm', context: true },             // sharp columns — resolve on approach
      { kind: 'warm', blurPx: 12 },                // star-free far identity
    ]);
    if (layers) {
      const ASPECT = 2000 / 1155; // portrait
      addPhotoLayerStack(group, layers, [
        { z: -s * 0.34, scale: 1.30, opacity: 0.55, order: 2 }, // deep field
        { z: -s * 0.08, scale: 1.02, opacity: 0.9, order: 3 },  // blue glow
        { z:  s * 0.22, scale: 0.9, opacity: 0.8, order: 4 },   // golden columns
        { z:  s * 0.20, scale: 0.9, opacity: 0.5, order: 4 },   // their distant glow
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

  // ── The greater Eagle — outskirts far beyond the towers ──
  addOutskirtsShroud(group, s, {
    warm: [1.0, 0.7, 0.4], cool: [0.45, 0.55, 1.0], warmFrac: 0.4, reach: 8,
  });

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

  // ── The greater remnant — thinning ejecta far beyond the shell ──
  addOutskirtsShroud(group, s, {
    warm: [1.0, 0.75, 0.4], cool: [0.5, 0.75, 1.0], reach: 6,
  });

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
export function createCarinaNebula(group, def, textures) {
  // JWST's Cosmic Cliffs (NIRCam, 2022 — credit NASA/ESA/CSA/STScI): the
  // amber mountain range of NGC 3324 under a blue mist sky, in 2.5D.
  const s = def.size * (def._scaleUnit || 500);
  const tex = getNebulaParticleTex();

  const layers = textures && textures.landmarkCarina
    ? makePhotoLayers(textures.landmarkCarina, [
        { kind: 'full' },
        { kind: 'cool', lumLo: 130, context: true }, // JWST cliffs: star-dense
        { kind: 'warm', context: true },             // sharp cliffs — resolve on approach
        { kind: 'warm', blurPx: 12 },                // star-free far identity
      ])
    : null;
  if (layers) {
    addPhotoLayerStack(group, layers, [
      { z: -s * 0.32, scale: 1.28, opacity: 0.55, order: 2 },  // deep field
      { z: -s * 0.06, scale: 1.0, opacity: 0.9, order: 3 },    // blue mist
      { z:  s * 0.2, scale: 0.9, opacity: 0.8, order: 4 },     // the cliffs
      { z:  s * 0.18, scale: 0.9, opacity: 0.5, order: 4 },    // their distant glow
    ], s * 1.9, 8441 / 14575); // wide landscape — a mountain range in space
  }

  // Environment wisps: the greater Carina complex
  {
    const count = 150;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = s * (1.0 + Math.random() * 1.9);
      const a = Math.random() * Math.PI * 2;
      positions[i * 3]     = Math.cos(a) * r;
      positions[i * 3 + 1] = gaussRandom() * s * 0.8;
      positions[i * 3 + 2] = Math.sin(a) * r * 0.6 - s * 0.25;
      const warm = Math.random() < 0.55;
      const b = 0.045 + Math.random() * 0.065;
      colors[i * 3]     = b * (warm ? 1.0 : 0.45);
      colors[i * 3 + 1] = b * (warm ? 0.65 : 0.6);
      colors[i * 3 + 2] = b * (warm ? 0.38 : 1.0);
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      vertexColors: true, map: tex, size: s * 0.8, sizeAttenuation: true,
      blending: THREE.AdditiveBlending, transparent: true, opacity: 0.14,
      depthWrite: false,
    });
    const pts = new THREE.Points(geom, mat);
    pts.renderOrder = 1;
    group.add(pts);
  }

  // The greater Carina complex — outskirts sprawling past the cliffs
  addOutskirtsShroud(group, s, {
    warm: [1.0, 0.65, 0.38], cool: [0.45, 0.6, 1.0], warmFrac: 0.55, reach: 8, flat: 0.45,
  });

  // Star corridor — Carina is one of the richest star fields in the sky
  {
    const count = 1300;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const corridor = Math.random() < 0.4;
      const z = corridor ? s * (0.3 + Math.random() * 2.0) : gaussRandom() * s * 0.65;
      positions[i * 3]     = (Math.random() - 0.5) * s * 2.6;
      positions[i * 3 + 1] = (Math.random() - 0.5) * s * 2.0;
      positions[i * 3 + 2] = z;
      const warm = Math.random() < 0.6;
      const b = 0.15 + Math.random() * 0.5;
      colors[i * 3]     = b * (warm ? 1.0 : 0.75);
      colors[i * 3 + 1] = b * (warm ? 0.82 : 0.85);
      colors[i * 3 + 2] = b * (warm ? 0.55 : 1.0);
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

export function createHorsehead(group, def, textures) {
  // Hubble's infrared Horsehead (2013 — credit NASA/ESA/Hubble Heritage):
  // the dark tower rendered luminous rose against a deep blue sky, riding
  // a sea of mist. Layers: sky behind, mist middle, the head in front.
  const s = def.size * (def._scaleUnit || 500);
  const tex = getNebulaParticleTex();

  const layers = textures && textures.landmarkHorsehead
    ? makePhotoLayers(textures.landmarkHorsehead, [
        { kind: 'full' },
        { kind: 'cool', lumLo: 140, context: true }, // Orion IR field: star-dense
        { kind: 'warm', context: true },             // sharp — resolves on approach
        { kind: 'warm', blurPx: 12 },                // star-free — the distant identity
      ])
    : null;
  if (layers) {
    addPhotoLayerStack(group, layers, [
      { z: -s * 0.3, scale: 1.26, opacity: 0.55, order: 2 },
      { z: -s * 0.05, scale: 1.0, opacity: 0.85, order: 3 },
      { z:  s * 0.2, scale: 0.92, opacity: 0.8, order: 4 },
      { z:  s * 0.18, scale: 0.92, opacity: 0.5, order: 4 },
    ], s * 1.5, 2826 / 2704);
  }

  // The greater Orion B cloud — the sea the head rides on continues
  addOutskirtsShroud(group, s, {
    warm: [1.0, 0.6, 0.45], cool: [0.5, 0.65, 1.0], reach: 6,
  });

  // Reference-star volume threading the scene in true depth
  {
    const count = 700;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3]     = (Math.random() - 0.5) * s * 2.4;
      positions[i * 3 + 1] = (Math.random() - 0.5) * s * 2.4;
      positions[i * 3 + 2] = (Math.random() * 2 - 1) * s * 0.9;
      const warm = Math.random() < 0.5;
      const b = 0.15 + Math.random() * 0.5;
      colors[i * 3]     = b * (warm ? 1.0 : 0.78);
      colors[i * 3 + 1] = b * (warm ? 0.8 : 0.86);
      colors[i * 3 + 2] = b * (warm ? 0.5 : 1.0);
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      vertexColors: true, map: getSoftTex(), size: s * 0.011, sizeAttenuation: true,
      blending: THREE.AdditiveBlending, transparent: true, opacity: 0.8,
      depthWrite: false,
    });
    const pts = new THREE.Points(geom, mat);
    pts.renderOrder = 5;
    group.add(pts);
  }
}

