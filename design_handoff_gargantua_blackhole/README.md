# Handoff: Gargantua — Interstellar-Style Black Hole

## Overview
Replaces the current black hole in `universe-explorer` (black sphere + particle ring + additive glow shells in `js/deepspace.js`) with a film-accurate gravitationally-lensed black hole: black shadow, thin accretion disk visible in front AND lensed over/under the shadow, photon ring, relativistic doppler beaming (approaching side searing white, receding side dim red), flaring hot spots, and a plunging-matter region spiraling inside the disk's inner edge.

## About the Design Files
`blackhole.js` in this bundle is **production-ready three.js source written specifically for the universe-explorer codebase** — same module style, import conventions, and log-depth/camera-relative compatibility as `js/sun.js` and `js/deepspace.js`. It can be dropped in as-is. `gargantua.html` is a **standalone design reference** showing intended look, camera behavior, and post-processing settings; do not ship it — recreate its tuning values in the existing engine.

## Fidelity
**High-fidelity.** The shader constants, colors, and bloom values were iterated visually against the Interstellar reference. Keep all numeric values unless retuning deliberately.

## Integration into universe-explorer

Target repo: `nickparia/universe-explorer`, branch `main`, under
`OneDrive - Ace Company BV/Desktop/Claude Code/Universe/`.

1. Copy `blackhole.js` into `js/`.
2. In `js/deepspace.js`:
   - Add `import { createGargantua, updateGargantua } from './blackhole.js';`
   - In `createBlackHole(scene)`: keep `blackHoleGroup` creation, its position, `_solarSystemOnly`, `scene.add`, and `setWorldPos`. DELETE the horizon sphere, the 8000-particle disk (`accretionParticles`), the `RingGeometry` disk mesh (`accretionDiskMesh`), and the three glow-shell meshes. Replace with:
     ```js
     createGargantua(blackHoleGroup, 8);   // 8 = event horizon radius, matches existing r: 8
     ```
   - In `updateDeepSpace(dt, camPos)`: remove the `accretionParticles` / `accretionDiskMesh` rotation blocks; add `updateGargantua(dt);` (dt already arrives time-scaled from main.js).
   - The module-level `accretionParticles` / `accretionDiskMesh` variables can be deleted.
3. `getDeepSpaceObjects()` needs no change (`r: 8`, `isBlackHole: true` still correct — the event-horizon flash + `doHome()` logic in `main.js` keeps working).
4. Optionally reuse for Sagittarius A* in `js/visuals/galaxies.js` (`createSupermassiveBH`): replace horizon/disk/glow with `createGargantua(group, def.size * 3000 * 0.05)`. Jets can stay.

### Engine compatibility notes (already handled inside blackhole.js)
- **Camera-relative rendering**: the black hole world-position uniform is refreshed in `mesh.onBeforeRender`, i.e. AFTER `applyCameraRelative()` has shifted the scene for the frame. Do not move this refresh into the update tick.
- **Logarithmic depth buffer**: vertex/fragment shaders include the `logdepthbuf` chunks like `sun.js`.
- **Transparency**: the shader outputs premultiplied alpha; material uses `transparent: true, premultipliedAlpha: true, depthWrite: false`. Escaped rays are transparent (real stars show through); captured rays are opaque black (shadow occludes the skybox). `renderOrder = 5` so it draws after stars, which don't write depth.

## How it works
A single camera-facing quad (billboard, `PlaneGeometry` sized `30 × rs`) raymarches per pixel: photon paths are integrated with the pseudo-Schwarzschild bending term `a = -1.5·h²·p/r⁵` (96 steps, adaptive `dt = clamp(r·0.18, 0.05, 1.4)`), where `h²` is the conserved angular momentum. Rays falling below `r = 1` are captured (opaque black); each crossing of the disk plane (`y` sign change in the disk frame, refined by linear interpolation) samples the disk. All distances are in event-horizon radii.

## Disk shading (fragment shader, values as shipped)
- Stable disk: `RIN = 2.35` to `ROUT = 9.6`.
- Temperature ramp: inner `vec3(1.35, 1.16, 0.95)` → mid `vec3(1.15, 0.52, 0.16)` (blend over t 0→0.38) → outer `vec3(0.45, 0.09, 0.015)` (t 0.38→1).
- Streaks: fbm noise sampled in cartesian disk coords rotated by `uTime · Keplerian(r) · 2 + r·2.6` (static spiral shear makes the streaks; differential rotation animates them). `n = 0.55·fbm(q·1.6) + 0.45·fbm(q·3.4 + 13.1)`, squared ×1.7.
- Density: edge fades `smoothstep(0, .10, t) · (1 − smoothstep(.55, 1, t))`, × `(0.12 + 1.8n)`.
- Doppler beaming: `β = 0.5/√r`, factor `pow(clamp(1/(1+β·μ), 0.4, 2.0), 3)` with blue-white flare added on the approaching side and red dimming on the receding side.
- Violence layer: flaring hot spots `flare = smoothstep(.68, .92, fbm(q·0.85 − t·0.30))` boosting density (+1.2, inner-weighted) and color (×(surge + flare·1.6)); global surge `1 + 0.18·sin(0.7t) + 0.12·sin(2.3t + 1.7)`.
- Plunging region (`1.06 < r < RIN`): fast infalling spiral streaks, color `vec3(1.2,.5,.14)` → `vec3(.5,.05,0)` toward the horizon, emission ×0.55.
- Final emission multiplier per crossing: **0.62** (this is the master brightness knob).
- Disk tilt: `tiltX = 0.14, tiltZ = 0.05` rad (near edge-on reads most like the film).

## Post-processing (preview settings, `gargantua.html`)
- ACES filmic tonemapping, exposure 1.2 (matches `engine.js`).
- UnrealBloomPass **strength 0.18, radius 0.2, threshold 0.92** — the engine's existing pass (0.22/0.2/0.98) is close enough; if the disk doesn't bloom, lower the engine threshold toward 0.92. Do NOT raise strength above ~0.4; the disk washes out into a giant halo (this was iterated).

## Camera / experience behavior (from the preview — port if desired)
- Slow autonomous approach (distance eases toward 19·rs at rate 0.25/s) with drift `az += 0.022·dt`, elevation oscillating 0.05 ± 0.02 rad above the disk plane.
- Low-frequency tremor scaled by proximity: positional `(sin 7.3t·0.5 + sin 13.1t·0.3) · 0.9/dist` on x (similar y), roll `sin(5.1t) · 0.0016 · 30/dist`. In the repo, this belongs in `flight.js` near-BH handling, not the module.
- Preview also has an orange `PointLight(0xff9950, 60, 0, 2)` at the hole so nearby bodies catch disk light — in the repo, add a point light to `blackHoleGroup` if spacecraft/planets should be lit by the disk.

## API
```js
createGargantua(group, rs = 8, { tiltX = 0.14, tiltZ = 0.05 })  // → mesh
updateGargantua(dt)   // advance disk animation; call once per frame with time-scaled dt
```
Module holds singleton state (one black hole), same pattern as `sun.js`. For two instances (deep-space BH + Sagittarius A*), refactor state into a returned handle.

## Assets
None — fully procedural (GLSL noise). No textures required.

## Files
- `blackhole.js` — the module (copy to `js/blackhole.js`)
- `gargantua.html` — standalone reference/preview (import-mapped to three@0.170.0 CDN)
