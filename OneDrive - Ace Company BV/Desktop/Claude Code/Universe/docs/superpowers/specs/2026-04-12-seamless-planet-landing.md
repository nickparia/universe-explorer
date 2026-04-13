# Seamless Planet Landing — Design Spec

## Vision

No Man's Sky-style seamless planetary descent for Universe Explorer. Fly from space, through atmosphere layers, down to procedural terrain, land, look around, and take off — all in one continuous camera with zero loading screens or transitions. Every planet feels unique, scientifically grounded, and awe-inspiring.

## Guiding Principle

Maximum immersion. The player should never feel a "seam" between space and surface. The entire experience is altitude-driven and bidirectional — flying down and flying up use the same systems in reverse.

---

## 1. Scale & Coordinate System

### Planet Scale
- Planets scaled up significantly for visual impact. Earth radius ~20 units, Jupiter ~200.
- AU constant increases proportionally (currently 55, will scale to ~1100 to maintain orbital ratios with 20x planet size increase).
- Planets dominate the player's view on approach, creating genuine sense of scale.
- Flight speeds, warp multiplier, and gravity ranges scale with the new AU to preserve the existing travel feel.

### Camera-Relative Rendering
- Camera stays at world origin. All objects are repositioned relative to the camera each frame.
- Eliminates floating-point precision loss at large distances from origin.
- Three.js objects updated by subtracting camera position from their world positions each frame.

### Logarithmic Depth Buffer
- `renderer.logarithmicDepthBuffer = true`
- Renders objects from 0.1 units to 10,000,000 units without z-fighting.
- Essential for the space-to-surface scale range in a single scene.

### Altitude Tracking
- New system continuously calculates player height above nearest planet's surface (not center).
- Drives the entire LOD system, atmosphere transitions, terrain generation, and HUD.

---

## 2. Terrain LOD System

### Cube-Sphere Quadtree
- Planet sphere divided into 6 faces (cube-sphere projection — cube inflated to sphere).
- Each face is the root of a quadtree.
- Each quadtree node is a terrain chunk: a mesh grid covering a patch of planet surface.
- **Split rule**: camera-relative screen-space error. If a chunk covers more than N pixels, it splits into 4 children. Children merge back when the camera moves away.
- **Max depth by quality tier**: High=15 levels (~1-2m detail), Medium=12, Low=9.

### Terrain Generation Per Chunk
1. **Base heightmap**: sample the planet's 8K texture to determine region type (ocean, mountain, desert, crater field).
2. **Procedural noise layers**: 6-8 octaves of fractal noise with parameters driven by region type. Mars craters use different noise than Earth mountains.
3. **Planet-specific modifiers**: Valles Marineris, ocean floors, volcanic cones — authored as signed-distance functions blended into the noise.
4. **Normal computation**: calculated from the heightmap for correct lighting at every detail level.

### Chunk Streaming
- Generation runs in a **Web Worker** — main thread never stalls.
- Priority queue orders chunks by camera distance and screen-space error.
- Each frame, 1-3 chunks generated/uploaded (tier-dependent).
- System stays ~2 seconds ahead of camera during descent.
- Off-screen and distant chunks recycled (geometry buffers reused, not GC'd).

### Seam Stitching
- Adjacent chunks at different LOD levels create cracks.
- Solved by **skirt geometry** — each chunk extends short vertical walls along edges to hide gaps.

---

## 3. Atmosphere Rendering

### Rayleigh/Mie Scattering Shader
- Runs on a sky dome mesh surrounding the camera when inside a planet's atmosphere zone.
- Inputs: sun direction, camera altitude, per-planet atmosphere parameters.
- Produces physically correct sky colors, sunsets, and horizon glow automatically.

### Per-Planet Atmosphere Parameters

| Planet | Composition | Sky Color | Density | Scale Height | Notes |
|--------|------------|-----------|---------|-------------|-------|
| Earth | N₂/O₂ | Blue → orange sunset | 1.0 | 8.5 km | Baseline reference |
| Mars | CO₂ | Butterscotch, blue sunsets | 0.006 | 11 km | Thin, dust-scattered |
| Venus | CO₂/H₂SO₄ | Yellow-orange murk | 90x Earth | 16 km | Extremely dense, low visibility |
| Moon | None | — | — | — | Stars visible from surface |
| Mercury | None | — | — | — | Stars visible from surface |
| Pluto | Trace N₂ | Near-black | Negligible | — | Nearly airless |

- For gas giants, the scattering shader transitions into volumetric fog — thickening cloud with increasing opacity and color shift.

### Atmospheric Entry Effects (Cinematic Layer)
- **Re-entry glow**: screen edges get orange/red thermal glow when descending above a speed threshold. Intensity = speed × atmosphere density. Venus entry is violent; Mars is gentle. Works on ascent too.
- **Cloud layers**: 2-3 distinct altitude bands per planet. Particle planes or noise-displaced sheets. Player physically punches through them.
  - Earth: cumulus at ~2km, cirrus at ~10km
  - Venus: impenetrable sulfuric acid deck
- **Particles**: dust (Mars), ice crystals (outer moons), rain (Earth oceans), volcanic ash (Venus). Spawn around camera based on altitude/region, streak past based on velocity.
- **Camera shake**: scales with speed × density. Heavy on Venus, light on Mars, violent during gas giant dives.
- **Sound cues**: wind building with density, hull stress at high speed, muffled silence on airless bodies.

### Altitude Transition Zones

| Altitude | What Happens |
|----------|-------------|
| >5x radius | Space view, planet is a sphere |
| 3-5x radius | Atmosphere rim glow visible, sky dome begins blending in |
| 1-3x radius | Sky color established, stars fading, first cloud layer visible |
| 0.5-1x radius | Full atmosphere, clouds around you, terrain chunks loading |
| <0.5x radius | Surface detail, ground-level weather, horizon curvature |

---

## 4. Gas Giant Atmospheric Dives

No solid surface — a unique descent experience escalating to dramatic ejection.

### Descent Phases

| Phase | Altitude | Experience |
|-------|----------|------------|
| Upper atmosphere | >0.8x radius | Clear view of cloud bands, wind streaks. Serene. |
| Cloud deck | 0.5-0.8x | Inside the bands. Massive cloud formations. Lightning flashes. |
| Deep atmosphere | 0.2-0.5x | Visibility drops. Colors deepen. HUD pressure warnings — "HULL STRESS 40%... 65%..." Temperature climbs. Shake intensifies. |
| Crush zone | <0.2x | Near-zero visibility. HUD glitching — static, flickering. Screen distortion shader. Hull stress 100%. |
| Ejection | At crush depth | Screen flash. Emergency thrust fires — thrown back up through layers at high speed. "SYSTEMS RECOVERING" fades as you reach space. |

### Per-Giant Character
- **Jupiter**: tan/brown/red bands, Great Red Spot as a massive vortex. Intense lightning. Deepest crush depth.
- **Saturn**: softer gold/cream bands, serene upper atmosphere. Ring shadow visible from inside.
- **Uranus**: blue-green haze, eerie quiet. Tilted light from 98° axial tilt. Cold.
- **Neptune**: deep blue methane. Fastest winds in the solar system — extreme horizontal camera shake. Dark storms.

### HUD Elements (All Atmospheres)
- Pressure gauge (appears on entry)
- Temperature readout
- Hull stress percentage (cosmetic — sells the danger)
- On gas giants, these escalate to critical and trigger ejection

---

## 5. Planet Surface Experience

### Surface Rendering
- Max-subdivision terrain chunks provide ~1-2 meter resolution.
- **Ground textures**: procedurally blended by altitude, slope, latitude. Rocky on steep slopes, sand/dust on flats, ice at poles. Derived from planet color palette.
- **Horizon curvature**: visible and correct. Smaller bodies (Moon, Mercury) have noticeably tighter horizons.

### Per-Planet Surface Character

| Planet | Terrain | Unique Features | Sky |
|--------|---------|----------------|-----|
| Mercury | Heavy cratering, scarps, smooth plains | Caloris Basin as macro depression, extreme shadow contrast | Black sky, huge Sun, visible stars |
| Venus | Volcanic plains, shield volcanoes, tessera highlands | Maat Mons visible peak, faint orange surface glow from heat, ~1km visibility | Yellow-orange murk, diffuse sun glow, no shadows |
| Earth | Oceans, mountains, plains, deserts | Ocean reflects sky with wave normals, green tint in vegetation, ice caps | Blue sky, clouds, correct sunsets |
| Moon | Highland/mare contrast, heavy cratering | Fine craters at close range, Earth visible in sky, long sharp shadows | Black sky, Earth sprite, stars |
| Mars | Red desert, canyons, craters, polar ice | Valles Marineris canyon system, Olympus Mons shield volcano, dust devil particles | Butterscotch sky, blue sunsets, thin haze |
| Pluto | Nitrogen ice plains, rugged ice mountains | Sputnik Planitia smooth heart-shaped basin, extreme darkness | Near-black sky, tiny Sun, stars |

### Airless Bodies (Mercury, Moon, Pluto)
- No atmosphere transition — space directly to surface.
- Stars visible at all times.
- Razor-sharp shadows, no ambient scattering.
- Sun rendered as harsh point light, size adjusted by distance.

### Landing Mechanics
- Below ~50m altitude, vertical speed auto-dampens slightly (gentle assist, not forced).
- Below ~5m at low velocity, player "settles" — velocity zeros, camera locks to fixed height above terrain.
- Full 360° cockpit look with mouse.
- Any thrust key lifts off and returns to normal flight.
- HUD shows: planet name, lat/lon coordinates, altitude, surface temperature, atmospheric pressure.

### Departure
- Thrust up to lift off — same controls as flight, no special launch mode.
- Atmosphere layers play in reverse (altitude-driven, bidirectional).
- Terrain LOD unloads — chunks merge back up the quadtree as altitude increases.
- Planet returns to textured sphere by 3-5x radius.
- Re-entry glow works on ascent too at sufficient speed.
- H key (Return Home) works from surface — triggers animated ascent, then warp home.

---

## 6. Performance Tiers & GPU Detection

### Benchmark Detection
- At startup, render a test frame: 64x64 terrain chunk + noise shader + atmosphere pass.
- Classify by frame time:
  - **High** (<8ms): Dedicated GPU (RTX 2060+, M1 Pro+)
  - **Medium** (8-20ms): Integrated (Intel Iris, M1/M2 base)
  - **Low** (>20ms): Older integrated, mobile browsers

### Feature Scaling

| Feature | High | Medium | Low |
|---------|------|--------|-----|
| Quadtree max depth | 15 levels | 12 levels | 9 levels |
| Chunk grid size | 33x33 | 17x17 | 9x9 |
| Atmosphere shader | Full Rayleigh/Mie | Simplified 2-color lerp | Flat gradient |
| Cloud layers | 3 particle planes | 2 sprite layers | 1 color band |
| Descent particles | 500+ | 150 | 50 |
| Camera shake | Full | Reduced | Off |
| Noise octaves | 8 | 5 | 3 |
| Shadows | Soft | Hard | None |
| Chunks per frame | 3 | 2 | 1 |

### User Override
- Settings gear on HUD for manual Low/Medium/High selection.
- Auto-detected tier is default, never locked.

### Runtime Adaptation
- If frame time exceeds 33ms (below 30fps) for 2+ seconds during descent, system temporarily drops one tier until performance recovers.

---

## 7. Prerequisite Fixes

These existing issues should be resolved before or alongside the landing system:

### Dark Planets (Lighting)
- `sunLight.decay` set to 0 or 1 (currently default 2 — inverse-square kills light at distance).
- Ambient light brightened from `0x111122` intensity 2.0 to warmer, brighter values.
- Ensures planets are visible before we add terrain to them.

### Galaxy Feel
- Milky Way band made more prominent (more particles, higher opacity).
- Galactic core glow added.
- Scattered nearby "star systems" as navigation points.
- These changes complement the landing system by making the space between planets feel rich.

---

## 8. File Architecture Changes

```
js/
├── engine.js         ← + logarithmic depth buffer, camera-relative rendering, GPU benchmark
├── flight.js         ← + altitude tracking, landing dampening, settle mechanics
├── bodies.js         ← + scaled planet sizes, per-planet terrain/atmosphere configs
├── terrain/
│   ├── quadtree.js   ← quadtree split/merge logic, frustum culling
│   ├── chunk.js      ← chunk mesh generation, skirt geometry, buffer recycling
│   ├── noise.js      ← fractal noise, planet-specific modifiers (runs in worker too)
│   └── worker.js     ← Web Worker for off-thread terrain generation
├── atmosphere/
│   ├── scatter.js    ← Rayleigh/Mie scattering shader and sky dome
│   ├── clouds.js     ← cloud layer generation and rendering
│   ├── effects.js    ← re-entry glow, particles, camera shake
│   └── gasgiant.js   ← gas giant dive phases, HUD warnings, ejection
├── deepspace.js      ← existing + galaxy enhancements
├── music.js          ← existing + atmosphere/surface sound cues
├── hud.js            ← + pressure, temperature, hull stress, lat/lon, altitude
└── textures.js       ← existing (no changes needed)
```

---

## 9. Future: Ground Exploration (Phase 2)

Architecture is designed to support later addition of:
- First-person walking mode (exit ship on surface)
- Points of interest (geological features, structures)
- Interaction system for surface objects

The terrain system, atmosphere rendering, and altitude tracking all support this without rearchitecting. The main additions would be a character controller and POI placement system.
