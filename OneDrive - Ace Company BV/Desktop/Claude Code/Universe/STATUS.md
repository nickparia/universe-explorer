# Universe Explorer — Status

## Current State
Live at: https://universe-explorer-8k.netlify.app
Repo: https://github.com/nickparia/universe-explorer

## What's Working
- 8K textured planets (Sun, Mercury through Pluto) with correct axial tilts
- Fiery sun shader with ridged plasma, eruptions, limb darkening
- Coronal mass ejections (particle-based solar flares)
- 14 moons across 5 planets (Mars, Jupiter, Saturn, Uranus, Neptune)
- 6 spacecraft with NASA glTF 3D models (Voyager 1/2, New Horizons, JWST, Hubble, ISS)
- Distance-adaptive beacon glows on spacecraft (visible from far, fade when close)
- Wispy motion trails behind deep-space probes (Voyager 1/2, New Horizons)
- Planet carousel with scrollable nav bar + spacecraft section
- Fly-to autopilot with speed feeling (FOV widening + blue edge vignette)
- Orbit mode (auto-enters on arrival, any movement exits)
- Time control ([ / ] keys, 0.1x to 1000x)
- Info cards with facts and lore for all planets, moons, spacecraft
- Symphonic music system with zone-based tracks
- Deep space objects (black hole, nebulae, landmarks)
- 12 cosmic landmarks with procedural visuals (nebulae, stellar objects, galaxies, voids)
- Warp travel system (15-30 sec interstellar journeys)
- 3D star map (M key) with click-to-warp navigation
- Per-landmark classical music with crossfading
- Landmark info cards and carousel integration
- Asteroid belt + Kuiper belt particle systems (12K particles)
- Comets with trails
- Auto-start loading screen (no Launch button needed)
- Lensflare occlusion (hidden when planet blocks the Sun)

## Known Bugs / Outstanding Fixes
- [x] Spacecraft beacon dark circles — fixed with distance-adaptive glow
- [x] Spacecraft trails not visible — fixed with wispy wake sprites
- [x] H key unreliable — fixed, now cancels fly-to/orbit mode first
- [x] ISS orbit speed too fast — slowed to ~6 min per orbit
- [x] Kuiper belt not visible — increased to 12K brighter particles
- [x] Info card mismatches — no auto-switch during fly-to
- [x] JWST inside Earth — repositioned to L2 (200 units past Earth)
- [x] Music button unclickable — moved below carousel, z-index fix
- [x] Earth cloud glitch (white arc) — lensflare occlusion + cloud layer fixes
- [x] Gravity pull/bouncing — removed (black hole only), spacecraft collision disabled

## Solar System Roadmap (Current Focus)
- [ ] Planet surface detail — enhanced terrain when close to rocky planets
- [ ] Aurora borealis visible from Earth orbit (partially implemented)

## Milky Way Expansion (Phase 1 — Partially Complete)
- [x] Cosmic landmarks — 12 interstellar destinations with procedural visuals
- [x] Warp travel — interstellar journeys with speed feeling and particle effects
- [x] 3D star map — M key toggle, click-to-warp, camera orbit controls
- [x] Per-landmark music — classical tracks with crossfade system
- [x] Nebulae — Orion, Eagle (Pillars of Creation), Carina as procedural volumetric visuals
- [~] Nearby star systems — Alpha Centauri, Sirius, Betelgeuse (as landmarks, not full systems)
- [~] Stellar types — neutron stars, black holes (as landmarks with procedural visuals)
- [ ] Zoom out transition — seamless scale shift from solar system to galactic view
- [ ] Exoplanet systems — Trappist-1, Kepler-452 with hypothetical planet visuals
- [ ] Milky Way spiral arms — flyable galactic structure with dust lanes

## Deep Universe (Future)
- [ ] Andromeda galaxy
- [ ] Galaxy clusters (Virgo, Coma)
- [ ] Cosmic web — large-scale filament structure
- [ ] Quasars
- [ ] CMB — cosmic microwave background at the edge

## Phase 2 — The Ship (Next)
- [ ] First-person cockpit with HUD overlay
- [ ] Ship systems (shields, fuel, navigation computer)
- [ ] Ship customization and upgrades
- [ ] See design spec for full details

## Experience Features (Future)
- [ ] Guided tours — narrated journeys
- [ ] Scale comparisons — overlay showing relative sizes
- [ ] Timeline mode — watch solar system form
- [ ] VR mode — WebXR support
- [ ] Pause/photo mode
- [ ] Quality settings toggle
- [ ] Sound design — thrust hum, warp whoosh, ambient tones
