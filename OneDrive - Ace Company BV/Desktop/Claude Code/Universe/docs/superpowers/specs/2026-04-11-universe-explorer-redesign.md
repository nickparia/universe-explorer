# Universe Explorer — Major Redesign Spec

## Vision

A browser-based 3D space exploration experience that evokes majesty, terror, and beauty. The player flies through a rich universe with cinematic physics, real NASA textures, classical music that reacts to where they are, and post-processing effects that make every moment feel alive.

## Guiding Principle

When in doubt, choose the option that creates the most awe-inspiring, peaceful, yet sublime experience. The player should feel the scale of the universe, the loneliness of deep space, the warmth of familiar planets, and the terror of a black hole.

---

## 1. Flight Physics — Cinematic Assisted Model

### Velocity & Acceleration
- Player has a persistent `velocity` vector (THREE.Vector3), starting at zero.
- Thrust keys (W/S/A/D/Space/C) apply **acceleration** in the camera-relative direction, not instant position changes.
- Base thrust acceleration: ~2.0 units/s^2, tuned to feel responsive but weighty.
- Maximum base speed soft-capped at ~120 units/s (scales with context).

### Dampening
- When no thrust keys are pressed, velocity decays by ~3-5% per frame (exponential decay).
- The player drifts but gradually slows — feels like assisted flight, not Newtonian.
- Dampening is constant regardless of speed.

### Warp Drive
- Shift multiplies acceleration by 25x and raises the speed cap proportionally.
- Warp has a boost energy bar that depletes over ~5 seconds and recharges over ~8 seconds.
- Visual feedback: warp indicator on HUD, subtle star-streak effect.

### Angular Momentum
- Pitch/yaw (right-click drag) and roll (Q/E) apply angular acceleration to an angular velocity vector.
- Angular velocity dampens when no input is applied (~8% per frame).
- Creates a heavy, ship-like feel — turns have momentum and settle smoothly.

### Gravitational Influence
- Bodies exert gravitational pull within ~5x their visual radius.
- Pull strength follows inverse-square falloff but capped to prevent instant capture.
- The black hole has much stronger gravity with a larger influence radius (~50x).
- Gravity adds to velocity each frame — creates organic curved flight paths near bodies.

### Input
- **Right-click drag**: mouse look (pitch/yaw). Cursor hidden while dragging.
- **Left-click**: no action (prevents accidental look).
- **W/S**: thrust forward/backward.
- **A/D**: strafe left/right.
- **Space/C**: up/down.
- **Q/E**: roll.
- **Shift**: warp drive.
- **H**: return home (animated transition).
- Touch controls preserved for mobile.

### Scale Architecture
- Use AU as the base unit for solar system distances.
- Deep space objects placed at thousands of AU.
- The coordinate system and warp multiplier are designed to accommodate future intergalactic distances without rewrite — just extend the warp tiers.

---

## 2. Visual Content

### Solar System (Complete)
- **Sun**: textured sphere with additive glow shells, atmospheric shader, pulsing light intensity.
- **Mercury**: surface texture (download missing 8k_mercury.jpg).
- **Venus**: surface + atmosphere texture overlay.
- **Earth**: day map, night map (emissive city lights), cloud layer (rotating), normal map (fix .tif to .jpg), specular/roughness map.
- **Moon**: orbits Earth, tidally locked, surface texture.
- **Mars**: surface + normal map.
- **Jupiter**: surface texture, Great Red Spot visible.
- **Saturn**: surface + ring system with alpha transparency.
- **Uranus**: surface, tilted 98 degrees.
- **Neptune**: surface texture.
- **Pluto**: surface texture (download from Solar System Scope).
- **Dwarf planets** (Ceres, Eris): small bodies with procedural textures placed at appropriate orbits.

### Additional Solar System Objects
- **Comets**: 2-3 comets on long elliptical orbits with particle trail tails (glowing, fading particles behind them).
- **ISS**: small glowing dot orbiting Earth with a label. Not a full 3D model.
- **Asteroid belt**: denser than current, with some larger individual asteroid meshes mixed in.
- **Kuiper belt**: sparse particle field beyond Neptune.

### Deep Space Landmarks
Placed at extreme distances (2000-8000 AU) as large textured billboards using real NASA/Hubble public domain images:
- **Orion Nebula** (~2500 AU from sun)
- **Pillars of Creation** (~4000 AU)
- **Crab Nebula** (~5000 AU)
- **Andromeda Galaxy** (~8000 AU)
- Each has a name label visible from far away, acting as a navigation beacon.
- As the player approaches, the billboard grows from a point of light to a massive, awe-inspiring image filling the view.

### Nebula Clouds
- Semi-transparent colored particle volumes scattered in deep space.
- Player can fly through them — particles surround the camera.
- Subtle color tinting of nearby space (additive blending).
- 5-8 nebula clouds of varying colors (blue, pink, gold, green).

### Black Hole
- Placed ~6000 AU from the sun in an isolated region.
- **Accretion disk**: ring of swirling hot particles (orange/white) with rotation animation.
- **Gravitational lensing**: shader that distorts the background starfield around the black hole (screen-space distortion).
- **Strong gravity**: influence radius ~50x the visual size, pulls the player in with increasing force.
- **Too-close trigger**: if the player crosses the event horizon, trigger a dramatic visual distortion and animated "return home" sequence. They survive but feel the terror.

### Skybox
- Replace particle starfield with NASA Deep Star Maps equirectangular texture (real Gaia star data).
- Keep some bright particle stars layered on top for nearby sparkle.
- Milky Way band visible across the sky.

### Post-Processing (EffectComposer)
- **UnrealBloomPass**: glow on sun, stars, nebulae, accretion disk. Threshold ~0.8, strength ~1.5, radius ~0.4.
- **Vignette**: subtle darkening at screen edges for cinematic framing.
- **Film grain**: very low intensity (~0.03) for organic texture.
- **Distortion shader**: active only near black hole, warps UVs in screen space.

---

## 3. Music System

### Zone-Based Context Detection
The universe is divided into emotional zones based on the player's distance from key landmarks:

| Zone | Trigger | Mood |
|------|---------|------|
| Solar Corona | Distance to sun < 30 AU-units | Awe, danger, power |
| Inner Planets | Near Mercury/Venus/Earth/Mars | Wonder, warmth, familiarity |
| Gas Giants | Near Jupiter/Saturn/Uranus/Neptune | Scale, majesty, grandeur |
| Deep Space | Beyond Neptune, not near any landmark | Solitude, mystery, vastness |
| Nebula/Landmark | Near any deep space landmark | Beauty, transcendence |
| Black Hole | Near black hole | Terror, sublime, intensity |

### Music Selection Per Zone

| Zone | Pieces |
|------|--------|
| Solar Corona | Strauss — Also sprach Zarathustra; Holst — Mars |
| Inner Planets | Debussy — Clair de Lune; Beethoven — Moonlight Sonata mvt 1 |
| Gas Giants | Holst — Jupiter; Dvorak — New World Symphony (Largo) |
| Deep Space | Satie — Gymnopedie No. 1; Debussy — Reverie |
| Nebula/Landmark | Bach — Air on G String; Debussy — Arabesque No. 1 |
| Black Hole | Barber — Adagio for Strings; Grieg — In the Hall of the Mountain King |

### Implementation
- Source 10-12 public domain recordings from Wikimedia Commons and Internet Archive (OGG/MP3 with CORS headers).
- Download audio files locally into `audio/` directory for reliable playback.
- Two HTML5 Audio elements that crossfade between each other (3-5 second fade).
- Zone detection runs every ~2 seconds — checks player position against zone boundaries.
- When zone changes, the current track fades out while the new zone's track fades in.
- If the zone hasn't changed and a track ends, pick the next track from that zone's playlist.
- Volume control via existing HUD slider applies to master gain.
- Pause/resume button preserved.

### Fallback
- The existing procedural Web Audio synthesizer remains as fallback if audio files fail to load.
- It plays during the loading screen before real music is available.

---

## 4. File Architecture

```
Universe/
├── index.html          ← HTML shell, CSS, boot/loading logic
├── js/
│   ├── engine.js       ← renderer, post-processing, scene graph, skybox, animate loop
│   ├── flight.js       ← velocity physics, input handling (right-click look), gravity
│   ├── bodies.js       ← all celestial body definitions, creation, orbital mechanics
│   ├── deepspace.js    ← nebula clouds, black hole, deep space landmarks, billboards
│   ├── music.js        ← audio loader, zone detection, crossfader, fallback synth
│   └── textures.js     ← texture definitions, loader with fallbacks, procedural generators
├── textures/           ← planet/star/nebula textures (JPG/PNG)
├── audio/              ← classical music files (MP3/OGG)
└── docs/               ← this spec
```

### Dependencies (all CDN, no build tools)
- Three.js r160+ (core + EffectComposer + passes) from cdn.jsdelivr.net or unpkg
- No npm, no bundler, no framework. Plain ES modules via `<script type="module">`.

### Three.js Upgrade
- Current r128 → r160+.
- Required for: proper UnrealBloomPass, OutputPass, updated tone mapping.
- Import style: ES module imports from CDN.

---

## 5. Future Extensibility

- **Intergalactic travel**: the AU-based coordinate system and warp tiers can be extended with higher warp levels (warp 2 = 1000x, warp 3 = 100000x) for galaxy-scale distances.
- **More landmarks**: adding new deep space objects is just adding entries to a data array in deepspace.js.
- **More music zones**: zone detection is data-driven — new zones are just new entries in a config.
- **Multiplayer**: the flight model is deterministic from inputs, making it straightforward to sync later if desired.
