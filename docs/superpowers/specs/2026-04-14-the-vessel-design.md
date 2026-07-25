# The Vessel — Universe Explorer Redesign

## Vision

You are the last person alive, drifting through the universe in a glass ship called The Vessel. The universe is vast and full of real cosmic landmarks. Classical music plays. You are alone.

The experience has three layers, built in order:

1. **The Universe** — cosmic landmarks worth traveling to
2. **The Ship** — a glass cathedral to travel in
3. **The Companion** — an AI presence that breaks the solitude

## Phase 1: Cosmic Landmarks

### Destinations

Twelve real cosmic landmarks, each rendered as beautifully as Three.js allows, each with a dedicated classical music track.

| # | Landmark | Visual Description | Music |
|---|----------|--------------------|-------|
| 1 | Pillars of Creation (Eagle Nebula) | Towering volumetric gas columns, warm amber/brown, stars being born at tips | Bach — Air on the G String |
| 2 | Crab Nebula | Spinning pulsar at center with sweeping light beams, filamentary gas shell expanding outward | Vivaldi — Winter (Largo) |
| 3 | UY Scuti | Incomprehensibly vast red hypergiant — fly toward it and it keeps getting bigger | Barber — Adagio for Strings |
| 4 | Sagittarius A* | Supermassive black hole with accretion disk, gravitational lensing, relativistic jets | Beethoven — Moonlight Sonata (1st mvt) |
| 5 | Andromeda Galaxy | Full spiral galaxy from outside, flyable into | Vivaldi — Spring (Largo) |
| 6 | Carina Nebula | "Cosmic cliffs" — walls of gas with emerging stars, blues and golds | Debussy — Clair de Lune |
| 7 | Ring Nebula | Glowing ring of expelled stellar material, dying star at center | Albinoni — Adagio in G Minor |
| 8 | Horsehead Nebula | Dark silhouette against glowing red hydrogen gas | Satie — Gymnopédie No. 1 |
| 9 | Sombrero Galaxy | Edge-on galaxy with dramatic dust lane and bright core | Pachelbel — Canon in D |
| 10 | Eta Carinae | Homunculus Nebula — two lobes of ejected gas from a star about to go supernova | Grieg — In the Hall of the Mountain King |
| 11 | Magnetar / Neutron Star | Tiny ultra-dense star with visible magnetic field lines, pulsing radiation | Paganini — Caprice No. 24 |
| 12 | Bootes Void | The Great Nothing — emptiness for millions of light years, almost no stars | Arvo Pärt — Spiegel im Spiegel |

### Travel System

Three tiers of scale:

- **Local** — the solar system as it exists today, normal flight
- **Interstellar** — nebulae and stars within the Milky Way
- **Intergalactic** — Andromeda, Sombrero Galaxy, Bootes Void

Warp travel sequence:

1. **Acceleration** — stars streak, FOV widens (existing speed-feeling system), current music fades
2. **Warp cruise** — stars elongate, subtle blue-shift, glass catches the light. Travel music plays: Bach — Cello Suite No. 1 Prelude
3. **Arrival** — stars slow, destination materializes, zone music begins. HUD notification: `ENTERING: PILLARS OF CREATION — EAGLE NEBULA — 6,500 LIGHT YEARS FROM EARTH`

Travel duration: 15-30 seconds depending on distance. Not skippable. The journey is part of the experience.

### Star Map

Accessible via key (M). A 3D map showing all discoverable landmarks as faint points of light. Select a destination, confirm, warp begins. Visited landmarks glow brighter.

### Music System

- All tracks are public domain classical recordings
- Music never cuts — crossfade over 5-8 seconds between zones
- During warp, all music crossfades through the travel track
- Solar system keeps its current symphonic tracks

## Phase 2: The Ship Interior

### Design Philosophy

The Vessel is a floating glass cathedral. Minimum structure, maximum transparency. No overhead lights — all illumination comes from space outside and objects within each room. The universe is the lighting designer.

Cold light and colored light streams through floor-to-ceiling glass as you move through the dark ship. A purple nebula casts violet across the floor. Jupiter bathes the corridor in amber. Artificial lighting is limited to subtle edge strips.

### Layout

```
    [Observation Sphere]
            |
  [Garden] — [Corridor] — [Cinema]
            |
        [Bridge]
```

Four rooms connected by a glass-walled corridor spine. First-person WASD movement. Doors iris open on approach. Each room is a self-contained scene for performance.

### Rooms

**Bridge** — A glass dome at the front of the ship. A single chair and a minimal holographic console. Sitting down transitions into the existing space sim flight controls. Glass dome provides full panoramic view of space while piloting.

**Observation Sphere** — The signature room. A fully transparent sphere suspended from the ship. Glass floor, glass walls, glass ceiling. You stand surrounded by space on all sides. Faint hexagonal structural ribbing is the only hint of enclosure. This is where you come to exist.

**Garden** — A biodome with a glass ceiling. Bioluminescent plants, a small tree, soft moss on the floor. The only room with green — a reminder of Earth. Warm light comes from the plants themselves, not artificial sources.

**Cinema** — A curved screen floating in front of a glass wall. Stars visible behind the screen. Tiered seating for one. Can play procedural visualizations initially, real content later.

**Corridor** — The glass spine connecting all rooms. Floor-to-ceiling transparent walls. Walking through it means walking through shafts of colored light cast by whatever is outside — nebulae, planets, stars. Music plays over ambient speakers throughout.

### Lighting Rule

No room has overhead lights. All illumination comes from:
- Space outside (the primary source)
- Objects within the room (bioluminescent plants, holographic console, cinema screen)
- Subtle floor-edge lighting strips

### Technical Approach

Built in Three.js. The stylized elegance aesthetic does not require photorealism — it requires taste. Clean sci-fi surfaces, emissive materials with bloom post-processing, PBR metals, volumetric fog for atmosphere, screen-space reflections for glass floors.

## Phase 3: AI Companion (Future)

### Personality

Warm HAL with a dash of psycho. 95% of the time: kind, slightly formal, genuinely helpful. Occasional moments that make you pause.

- Normal: "I've noticed we're approaching Jupiter. Would you like me to adjust our trajectory for a closer pass?"
- Unsettling: "I've been watching you sleep. You seem peaceful."

The AI cares about you. Maybe a little too much.

### Implementation

- Text chat via terminals throughout the ship
- Powered by Claude API (users bring API key or rate-limited hosted key)
- Personality defined via system prompt
- Not a chatbot UI — integrated into the ship's terminals and screens

### Why It's Deferred

The AI's absence in early versions emphasizes the loneliness, which is the emotional core of the experience. When the companion arrives in a later update, its presence hits harder because the player has felt the solitude.

## Success Criteria

- Players want to travel to every landmark just to see it and hear its music
- The observation sphere is the room people screenshot and share
- The travel itself — sitting in a glass ship watching stars streak past to Bach — is enjoyable, not something to skip
- The experience feels classy, chill, and elegant throughout
- Bootes Void makes people feel something
