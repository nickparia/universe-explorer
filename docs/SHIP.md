# THE SOLACE — deck plan and body

One ship, three views, one truth: the hull standing on the pad (S0),
the vessel seen from outside in space (S1), and the walkable interior
(S2) are the SAME ship. Everything below binds all three. Nothing gets
built that contradicts this page; this page gets amended first.

## The school

Working refinery-tug, 1979 register: the ship is INDUSTRY, not
aerodynamics. Blocky forward castle, working spine, engine towers.
Every surface tells a story of use — panel seams, stencils, grime
streaks under vents, hazard stripes at moving parts, practicals
blinking on their own clocks. Stylized craft, not photorealism:
painted texture detail, palette-law shading, silhouette density.
(The school of the Nostromo — never its name, mark, or silhouette.)

## The modelled hull

`tools/model-solace.py` **is** the ship. She is authored as a lines
plan — stations down her length, each a closed section with its own
beam, sheer, tumblehome and turn of bilge — and the skin is lofted
between them. Every mass that grows off the hull is lofted the same
way, and every corner that reads as a box is a chamfered run, so the
corner is a face that takes light rather than an edge that doesn't.
Nothing in the file is a primitive cube standing in for a shape.

That replaces the kit-bash of 2026-08-04: 644 objects, 40,428 tris,
380 of them 12-tri boxes. Bevel and baked AO made those boxes catch
light beautifully; they could not make them stop being boxes, and at
256 m there is nowhere to hide.

- **Source of truth**: `tools/model-solace.py` (re-runnable, seeded, so
  the panel work is identical every run).
- **Hand-editable**: `models/solace-hauler-v2.blend` — open it and work
  on her directly; the script is the origin, not a cage.
- **Shipping asset**: `public/models/solace-hauler-v2.baked.glb`
  (868 KB, 111k tris, 2 nodes / ~19 draw calls) via
  `tools/ship-pipeline.sh`.
- **Judging**: `tools/clay-shot.py` for form while cutting,
  `/ship-viewer.html` + `tools/bench-shot.mjs` for the verdict,
  `tools/ship-shot.mjs` for her on the pad.

**Dimensions**: 262.2 m over the bow whiskers (256.4 m hull, stem to
transom — the length the scale pass fought for), 80.9 m across the
nacelles, **74.5 m tall**. The height is deliberate: the user asked for
vertical mass on 2026-08-12 ("Nostromo had vertically massive pipes"),
and the first cut of this model stood *lower* than the kit-bash it
replaced. The answer is the aft plant — twin towers with pipe banks,
collars, a gantry you could walk, and masts above.

**Her name is on her**: `SOLACE`, eleven metres tall, standing proud of
the forward flank in `hull_stencil` — paint a shade off the plate, so
the bake gives the letters their own wear. The flank forward of
midships is deliberately kept clear of pipe runs to give it a field.

`js/ground/lander.js` loads the baked GLB at runtime, flips the bow to
local +X, and re-seats practicals and collision from its bbox. The
procedural painted hull remains the instant-on fallback and the
deck-plan truth the interior is built against.

## Massing (≈34 m stem to stern, procedural fallback)

```
        ┌─────┐
        │BRIDGE│  forward castle: two decks, angled glass slit
        ├─────┤
  ┌─────┴─────┴──────────────┬──────────┐
  │  MIDBODY (the home)      │ ENGINE   │
  │  corridor spine, dorsal  │ BLOCK    │  twin towers + 4 bells
  │  observatory blister     │          │
  └──┬───────────────┬───────┴──────────┘
     │ RAMP (ventral)│   4 landing legs, splayed
```

- **Forward castle** — bridge/helm on top, cryo bay below it (waking
  and flying live in the same tower).
- **Midbody** — the home: corridor spine down the center; MESS to
  port with a round porthole; WORKSHOP to starboard; the
  **OBSERVATORY** is a dorsal glass blister aft of midships — a
  half-dome you sit in, sky in every direction above the hull line.
- **Engine block** — aft: twin towers, four bells, pipework. Glows
  when she burns.
- **Ventral** — boarding ramp behind the forward legs (landfall walks
  down it, one day); gear = four splayed legs with oleo struts.

## Windows (honest apertures, all three views)

bridge slit (wide, low) · observatory dome (the vibe) · mess porthole
(round, warm) · corridor deadlights (small, sparse). At night on the
pad they GLOW — the ship is the hearth of every dark landscape.

## Lights & practicals

nav beacons: port red / starboard green, slow blink · dorsal strobe,
rare double-flash · floodlights under the chin, pooled on the pad
after dark · window glow, warm (2700K feel) · engine bells, ember
after landing, cooling over minutes.

## Rooms (S2 build order)

observatory → cryo bay → mess → bridge → corridor spine joins them.
Each fully walkable on arrival; interiors anchored to the ship frame
inside the live scene; boots = the ground controller on flat decks.

## Reference library

`docs/reference/ship/` — the visual bible (user-collected, 2026-08-04;
internal reference only, never shipped or redistributed):

- **exterior-nostromo-model / exterior-weathered-on-ice /
  exterior-towing-vehicle-schematic** — silhouette law: angled nacelle
  scoops on outrigger pylons, wedge nose, whisker antennae, gear
  towers, panel-in-panel micro density, rust-streaked bone hull.
- **exterior-refinery-towers** — the towed refinery: vertical
  industrial mass, the register for future station/outpost superstructure.
- **interior-padded-corridor / interior-cryo-corridor-white** — the
  home's soft white register: padded octagonal corridors, coffin-door
  details. (Observatory/cryo bay.)
- **interior-mother-bulb-chamber** — MU/TH/UR's bulb-matrix room: the
  register for Sol's future physical chamber.
- **interior-mess-table** — the lit table, warm domesticity aboard.
- **interior-isolation-medbay / interior-engine-corridor-dark** — the
  worked steel registers: pale medical vs dark engineering.

## Quality law

Stylized × Nostromo, WoW-school craft: painted panel detail, palette
ramps, silhouette greebles, practicals as jewelry. Every repeatable
element must be rewarding to look at and to use — the standard that
sets the game apart.
