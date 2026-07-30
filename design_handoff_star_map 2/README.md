# Handoff: Star Map Redesign — "Navigator" (universe-explorer)

## Overview
Redesign of the star map (M key) in **nickparia/universe-explorer**. It replaces the current flat catalog drawer (`js/starmap.js`) with a two-pane navigator: the familiar destination catalog on the left (elevated visually, grouped by section, with live distances), and a full interactive 3D spatial map on the right. Hovering a list row highlights the object in space; clicking a row (or an object in the map) selects it, flies the camera to it, and shows a selection bar with the full description and a fly/warp action.

**Chosen direction: `starmap-c-navigator.dc.html` (Navigator).** Two alternates (`starmap-a-holo-bridge`, `starmap-b-deep-field`) are included for reference only.

## About the Design Files
The files in this bundle are **design references created in HTML** — working prototypes showing the intended look and behavior, not production code to copy directly. The task is to **recreate this design inside universe-explorer's existing environment**: vanilla ES-module JavaScript, no framework, three.js r170 already loaded. The prototype's renderer is Canvas-2D; in the real app implement it either as a Canvas-2D overlay (cheapest, matches the prototype 1:1) or inside the existing three.js scene as its own overlay scene/camera — developer's choice. The prototype files use a small custom component wrapper (`.dc.html`); ignore the wrapper, the markup/styles/logic inside are the spec.

**`starmap-engine.js` and `starmap-data.js` are plain, dependency-free ES modules and can be ported nearly verbatim** — they contain the entire renderer (projection, input, picking, procedural sprites) and the destination catalog.

## Fidelity
**High-fidelity.** Colors, typography, spacing, letter-spacing, and interaction behavior are final and match the app's existing "Solace" aesthetic (quiet, thin, letter-spaced, dark blue-tinted). Recreate pixel-perfectly.

## Integration with the existing codebase
- Replace the body of `js/starmap.js` (keep its public API: `initStarMap`, `toggleStarMap`, `isStarMapOpen`, `updateStarMap`) so `main.js` needs no changes.
- M toggles the map; Escape closes it (same as today).
- Destination data should come from the live `getBodies()` / `getLandmarks()` instead of the static `starmap-data.js` snapshot. The snapshot's extra per-destination fields you must merge in: `kind` (type badge), `short` (poetic one-liner), `ly` (real light-year distance for landmarks — the old map showed game-scaled "0.1 LY" values; the redesign shows real ones).
- On select + "fly there" / "engage warp": call `flyTo(name)` for bodies, `warpTo(name)` for landmarks (from `js/flight.js`), then close the map — same contract as the current `onSelect`.
- Ship position for the "distance" readout: in the prototype it is fixed at Earth; in the app use the real camera position.

## Layout
Full-screen overlay, CSS grid `380px 1fr`, height 100vh, background `#04060c`.

### Left pane — destination catalog
Background `rgba(8,10,18,0.92)`, right border `1px solid rgba(160,200,255,0.15)`, shadow `4px 0 40px rgba(0,0,0,0.55)`. Font: `'Segoe UI','Helvetica Neue',Arial,sans-serif`, weight 300.

1. **Header** (fixed) — padding 26px 28px 18px, bottom border `rgba(255,255,255,0.06)`. Title "destinations": 11px, letter-spacing 7px, `rgba(200,220,255,0.75)`. Subtitle "click to target · distances from your position": 9px, letter-spacing 3px, `rgba(255,255,255,0.35)`, margin-top 6px.
2. **Scroll area** — thin scrollbar (`rgba(160,200,255,0.25)` thumb, 6px), padding 10px 16px 60px.
3. **Sections** — same grouping as today's drawer (★ start here, planets, dwarf planets, moons, spacecraft, nebulae & stars, galaxies & voids). Section title: 10px, letter-spacing 5px, `rgba(160,200,255,0.55)` (featured "★ start here" gets `rgba(255,220,120,0.7)`), 12px padding-bottom, hairline bottom border, 28px top margin.
4. **Rows** — flex, gap 16px, padding 11px 12px, 2px transparent left border, cursor pointer.
   - 10px color dot with `box-shadow: 0 0 12px <color>`.
   - Name (lowercase): 13px, letter-spacing 3px, `rgba(255,255,255,0.92)`.
   - Poetic one-liner (`short`): 9px, letter-spacing 1.2px, `rgba(200,220,255,0.4)`, single-line ellipsis.
   - Distance (right-aligned): 9px, letter-spacing 1.5px, `rgba(160,200,255,0.55)`.
   - Hover: background `rgba(120,180,255,0.06)` AND the object highlights in the map (pulse ring + label).
   - Selected: background `rgba(120,180,255,0.10)`, left border `rgba(120,180,255,0.7)`.
   - Click: selects + flies the map camera to the object.

### Right pane — the map viewport
Background `radial-gradient(ellipse at 50% 45%, #070b16 0%, #03050c 60%, #010208 100%)`, canvas fills the pane.

1. **Wordmark** — top-left (24px, 28px). "star map": 12px, letter-spacing 8px, `rgba(220,235,255,0.85)`, glow text-shadow. Below: "`<tier>` view · drag to rotate · scroll to zoom": 9px, letter-spacing 3px, `rgba(180,210,255,0.35)` — the tier word updates live with zoom (solar system / interstellar / galactic).
2. **Selection bar** (on select) — pinned to the bottom of the viewport (28px side margins, 22px bottom), flex row, gap 22px, padding 16px 22px, background `rgba(8,12,20,0.7)` + 10px backdrop blur, border `1px solid rgba(160,200,255,0.18)`, enter animation fade+8px rise 0.3s ease-out. Contents left→right:
   - 12px color dot, `box-shadow: 0 0 16px <color>`.
   - Name (16px, letter-spacing 6px, `rgba(255,255,255,0.95)`) with `kind` badge beside it (9px, letter-spacing 4px, `rgba(120,180,255,0.75)`); full `desc` below (10px, letter-spacing 1.5px, `rgba(255,255,255,0.5)`, single-line ellipsis).
   - Distance: 10px, letter-spacing 2px, `rgba(160,200,255,0.7)`.
   - Button: "fly there" (bodies) / "engage warp" (landmarks). 10px, letter-spacing 5px, padding 9px 22px, color `rgba(120,180,255,0.9)`, background `rgba(120,180,255,0.06)`, border `1px solid rgba(120,180,255,0.4)`; hover: background `rgba(120,180,255,0.12)`, `box-shadow 0 0 24px rgba(120,180,255,0.3)`. (Matches the app's existing `#start-btn` style.)

## Renderer spec (`starmap-engine.js` — port as-is)
- **Layout**: destinations placed on a log-scaled radial layout: `radius = log10(1 + au*8) * 90` world units; `y = sin(phi) * radius * 0.45` (flattened). Moons/near-Earth craft offset ~7–17 units around their parent. Landmarks use the game's `dist` values (3000–18000 "AU") which land them on outer shells at radius ~396–464.
- **Camera**: orbit around origin. Focal length 620, perspective divide, near-cull z<30. Start yaw 0.9, pitch 0.5, distance 300. Pitch clamped 0.06–1.35 rad.
- **Input**: pointer-drag rotates (yaw += dx·0.005, pitch += dy·0.004); wheel zooms `targetDist *= exp(deltaY·0.0012)`, clamped 110–1600, eased at 7%/frame. Click (movement <3px) selects nearest object within 24px of the cursor and flies the camera toward it (yaw eased to face it, distance to `clamp(r*2.1+120, 150, 1500)`).
- **Idle rotation**: yaw += 0.00012/frame, ONLY after 4s of no input AND while the pointer is off the canvas. (Deliberately very slow — do not speed up; users must never chase a click target.)
- **Star field**: 700 background stars on a unit sphere, projected with the same rotation, twinkle 0.7–1.0, color `#cfe0ff`, alpha 0.12–0.57 by magnitude; plus 4 very faint nebula washes (radial gradients, alpha 0.055) fixed to sky directions.
- **Orbit rings**: for planets/dwarfs with |phi|<0.2, a 1px circle at their orbital radius, `rgba(140,180,255,0.09)`.
- **Procedural sprites**: each destination pre-renders once to a 160px offscreen canvas (deterministic per name), drawn billboarded, size clamped per type (star ≤64px, landmark ≤56, planet ≤34, dwarf ≤26, craft ≤20, moon ≤18, min 9). Solid bodies are drawn lit from the left and rotated at draw time so the lit side faces the sun's screen position. See `buildSprite()` for the exact per-object recipes (gas-giant bands, Jupiter's spot, Earth continents+clouds, Mars polar cap, craters, Saturn front/back ring halves, Uranus ring, corona'd stars, satellite with panels, star-forming nebulae + Pillars columns, supernova filaments, planetary-nebula shell, Horsehead silhouette, Eta Car lobes, magnetar beams, Sgr A* accretion ellipses over black core, Andromeda particle spiral, Sombrero dust lane, Boötes void ring).
- **Hover** (canvas or list row): pulse ring + label; cursor pointer; sprite scales ×1.12 with soft glow. **Selected**: persistent ring + expanding pulse ring (1.6s cycle). List `highlight(name)` and `select(name)` are the API the list wires into.
- **Labels**: lowercase name, 10px weight 300, letter-spacing 2px, `rgba(230,240,255,0.55)` (0.95 hovered/selected), offset right of the sprite; hovered/selected also show distance below at 9px `rgba(160,200,255,0.55)`. Visibility: landmarks always; planets/star/dwarfs when camera dist <700; moons/craft when <200. Earth carries a pulsing diamond "you are here" marker in `#8fd8ff`.
- **Distances**: real light-years for landmarks (`ly` field, formatted "6500 LY" / "2.5 MLY"); km for near-Earth (`shipKm`); otherwise AU from the ship's position. Same formatter feeds the list rows and the selection bar.

## State Management
- `selected: destination | null` (drives selection bar + row highlight), `hovered` (list↔map two-way highlight), `tier` (drives wordmark subtitle), camera state (yaw/pitch/dist + eased targets).
- List→map: row hover calls `view.highlight(name)`; row click calls `view.select(name)` (flies camera). Map→list: canvas select updates the row's selected state (scroll the row into view with a plain `scrollTop` adjustment if off-screen).
- Open/close: same slide/fade pattern as the current drawer; keyboard M/Escape.

## Design Tokens
- Backgrounds: `#010208 / #03050c / #070b16`; panels `rgba(8,10,18,0.92)` (list), `rgba(8,12,20,0.7)` (selection bar)
- Primary text `rgba(255,255,255,0.92–0.95)`; dim text `rgba(255,255,255,0.3–0.5)`
- Accent blue `#8fd8ff`; UI blue `rgba(120,180,255,x)`; label blue `rgba(160,200,255,x)`; featured gold `rgba(255,220,120,0.7)`
- Object colors: from `starmap-data.js` (e.g. Earth `#4a9cff`, Saturn `#e8cc88`, Sgr A* `#ff8800`)
- Type: Segoe UI stack, weight 300; letter-spacing scale 1.2 / 1.5 / 2 / 3 / 4 / 5 / 6 / 7 / 8px; sizes 9–13px UI, 16px selection title
- Motion: 0.15s row hover, 0.3s selection-bar fade+rise, 7%/frame camera easing, 1.6s selection pulse

## Assets
None — every visual is procedural (canvas gradients/particles). No images, no icon fonts. Destination copy comes from the repo's own `bodies.js` / `starmap.js` / `deepspace.js` plus the new `kind`/`short`/`ly` fields in `starmap-data.js`.

## Files
- `starmap-c-navigator.dc.html` — **the chosen design** (two-pane layout + list↔map wiring)
- `starmap-engine.js` — full renderer: layout, projection, input, picking, procedural sprites (portable ES module)
- `starmap-data.js` — destination catalog with `kind`, `short`, `ly`, sections, colors (portable ES module)
- `starmap-a-holo-bridge.dc.html`, `starmap-b-deep-field.dc.html` — alternate directions, reference only (same engine; the holo bridge shows the `theme:'holo'` + `accent` monochrome tinting)
