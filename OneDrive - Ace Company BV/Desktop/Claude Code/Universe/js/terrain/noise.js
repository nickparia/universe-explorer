// terrain/noise.js — Procedural noise for terrain generation
// Runs in both main thread and Web Worker (pure math, no DOM/Three.js)

/**
 * Simple hash-based pseudo-random. Deterministic for same inputs.
 */
function hash2(x, y) {
  let v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return v - Math.floor(v);
}

function hash3(x, y, z) {
  let v = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return v - Math.floor(v);
}

/**
 * Smooth noise 2D with cubic interpolation.
 */
function smoothNoise2(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  return hash2(xi, yi) * (1 - u) * (1 - v)
       + hash2(xi + 1, yi) * u * (1 - v)
       + hash2(xi, yi + 1) * (1 - u) * v
       + hash2(xi + 1, yi + 1) * u * v;
}

/**
 * Smooth noise 3D — for sphere-mapped terrain (avoids polar pinching).
 */
function smoothNoise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const w = zf * zf * (3 - 2 * zf);

  const a = hash3(xi, yi, zi) * (1 - u) * (1 - v) * (1 - w);
  const b = hash3(xi + 1, yi, zi) * u * (1 - v) * (1 - w);
  const c = hash3(xi, yi + 1, zi) * (1 - u) * v * (1 - w);
  const d = hash3(xi + 1, yi + 1, zi) * u * v * (1 - w);
  const e = hash3(xi, yi, zi + 1) * (1 - u) * (1 - v) * w;
  const f = hash3(xi + 1, yi, zi + 1) * u * (1 - v) * w;
  const g = hash3(xi, yi + 1, zi + 1) * (1 - u) * v * w;
  const h = hash3(xi + 1, yi + 1, zi + 1) * u * v * w;

  return a + b + c + d + e + f + g + h;
}

/**
 * Fractal Brownian Motion — 3D (for sphere surfaces).
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {number} octaves
 * @param {number} lacunarity — frequency multiplier per octave (default 2.0)
 * @param {number} persistence — amplitude multiplier per octave (default 0.5)
 * @returns {number} 0-1 range
 */
export function fbm3(x, y, z, octaves, lacunarity = 2.0, persistence = 0.5) {
  let value = 0, amplitude = 1, frequency = 1, maxAmp = 0;
  for (let i = 0; i < octaves; i++) {
    value += smoothNoise3(x * frequency, y * frequency, z * frequency) * amplitude;
    maxAmp += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }
  return value / maxAmp;
}

/**
 * Ridged multifractal noise — creates mountain ridges and canyon walls.
 */
export function ridged3(x, y, z, octaves, lacunarity = 2.0, persistence = 0.5) {
  let value = 0, amplitude = 1, frequency = 1, maxAmp = 0, prev = 1;
  for (let i = 0; i < octaves; i++) {
    let n = smoothNoise3(x * frequency, y * frequency, z * frequency);
    n = 1 - Math.abs(n * 2 - 1); // ridge transform
    n = n * n * prev;             // sharpen ridges
    prev = n;
    value += n * amplitude;
    maxAmp += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }
  return value / maxAmp;
}

/**
 * Crater function — creates a single impact crater.
 * @param {number} dist — normalized distance from crater center (0 = center, 1 = rim)
 * @param {number} rimHeight — height of the raised rim
 * @param {number} floorDepth — depth of the crater floor
 * @returns {number} height offset
 */
export function craterProfile(dist, rimHeight = 0.3, floorDepth = 0.8) {
  if (dist > 1.5) return 0;
  if (dist < 0.8) {
    // Floor — flat with slight bowl
    return -floorDepth * (1 - (dist / 0.8) * (dist / 0.8) * 0.3);
  }
  if (dist < 1.0) {
    // Rim rise
    const t = (dist - 0.8) / 0.2;
    return -floorDepth * (1 - t) + rimHeight * t;
  }
  // Outer slope
  const t = (dist - 1.0) / 0.5;
  return rimHeight * (1 - t * t);
}

/**
 * Generate terrain height for a point on a planet's surface.
 * @param {number} nx — normalized sphere x (-1 to 1)
 * @param {number} ny — normalized sphere y (-1 to 1)
 * @param {number} nz — normalized sphere z (-1 to 1)
 * @param {Object} terrainConfig — from planetconfig.js
 * @param {number} octaves — noise octaves (from perf tier)
 * @returns {number} height value (0-1 range, scaled by terrainConfig.heightScale)
 */
export function getTerrainHeight(nx, ny, nz, terrainConfig, octaves = 8) {
  if (!terrainConfig || terrainConfig.type === 'gas' || terrainConfig.type === 'none') {
    return 0;
  }

  const scale = 3.0; // base noise frequency
  let h = 0;

  // Base terrain from fbm
  h = fbm3(nx * scale, ny * scale, nz * scale, octaves);

  // Add ridged noise for mountains (weighted by roughness)
  const ridgeWeight = terrainConfig.roughness || 0.5;
  const ridge = ridged3(nx * scale * 0.8, ny * scale * 0.8, nz * scale * 0.8, Math.max(3, octaves - 2));
  h = h * (1 - ridgeWeight * 0.5) + ridge * ridgeWeight * 0.5;

  // Craters (for rocky bodies)
  if (terrainConfig.craterDensity > 0) {
    const craterContrib = applyCraters(nx, ny, nz, terrainConfig.craterDensity);
    h += craterContrib * 0.3;
  }

  // Ocean level clamping (e.g. Earth)
  if (terrainConfig.oceanLevel !== undefined) {
    h = Math.max(h, terrainConfig.oceanLevel);
  }

  return h * (terrainConfig.heightScale || 1.0);
}

/**
 * Apply procedural craters based on density.
 */
function applyCraters(nx, ny, nz, density) {
  let contribution = 0;
  // Generate a grid of potential crater centers
  const gridScale = 8;
  const gx = Math.floor(nx * gridScale);
  const gy = Math.floor(ny * gridScale);
  const gz = Math.floor(nz * gridScale);

  // Check 3x3x3 neighborhood
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        const cx = gx + dx, cy = gy + dy, cz = gz + dz;
        // Deterministic random: should this cell have a crater?
        const rnd = hash3(cx * 7.3, cy * 13.1, cz * 17.9);
        if (rnd > density) continue;

        // Crater center (jittered within cell)
        const jx = (cx + hash3(cx, cy, cz)) / gridScale;
        const jy = (cy + hash3(cy, cz, cx)) / gridScale;
        const jz = (cz + hash3(cz, cx, cy)) / gridScale;

        // Distance to crater center on unit sphere
        const dist = Math.sqrt(
          (nx - jx) * (nx - jx) +
          (ny - jy) * (ny - jy) +
          (nz - jz) * (nz - jz)
        );

        // Crater size varies
        const craterRadius = (0.02 + hash3(cx * 3.1, cy * 5.3, cz * 7.7) * 0.06);
        const normDist = dist / craterRadius;

        contribution += craterProfile(normDist, 0.2, 0.5) * craterRadius * 5;
      }
    }
  }

  return contribution;
}
