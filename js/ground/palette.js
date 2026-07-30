// ground/palette.js — the hand-signed color language of the ground.
//
// The Viking mosaic carries the real large-scale color; these tints are
// the composition pass on top — debris shadow on steep ground, a faint
// mineral speckle, dust brightening on the flats. Multiplied against
// the albedo texture by vertexColors, so everything here is relative:
// 1.0 means "trust the photograph".

function h2(ix, iz) {
  let h = (ix * 668265263 + iz * 374761393) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const out = [1, 1, 1];

/** Per-vertex tint [r,g,b] from position + macro slope. */
export function hashTint(x, z, slope) {
  const sK = Math.min(1, slope * 2.0);
  // Steep ground: darker, slightly cooler — exposed rock under debris
  let v = 1.0 - sK * 0.28;
  // Mineral speckle at ~7 m so close ground isn't airbrushed
  const sp = h2(Math.floor(x / 7), Math.floor(z / 7));
  v *= 0.88 + 0.24 * sp;
  // Flats catch bright dust
  v *= 1.0 + (1 - sK) * 0.06;
  out[0] = v;
  out[1] = v * (1 - sK * 0.06);
  out[2] = v * (1 - sK * 0.10);
  return out;
}
