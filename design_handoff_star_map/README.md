# Handoff: Star Map Redesign — "Deep Field" (universe-explorer)

## Overview
Redesign of the star map (M key) in **nickparia/universe-explorer**. It replaces the current flat catalog drawer (`js/starmap.js`) with a full-screen, interactive 3D spatial map: every destination is rendered as a procedural object (shaded planet, ringed Saturn, wispy nebula, spiral galaxy…) floating in a drifting star field. Drag to rotate, scroll to zoom through three scale tiers (solar system → interstellar → galactic), click an object to select it and see its info card, then fly/warp to it.

**Chosen direction: `starmap-b-deep-field.dc.html` (Deep Field).** Two alternates (`starmap-a-holo-bridge`, `starmap-c-navigator`) are included for reference only.

## About the Design Files
The files in this bundle are **design references created in HTML** — working prototypes showing the intended look and behavior, not production code to copy directly. The task is to **recreate this design inside universe-explorer's existing environment**: vanilla ES-module JavaScript, no framework, three.js r170 already loaded. The prototype's renderer is Canvas-2D; in the real app you should implement it either as a Canvas-2D overlay (cheapest, matches the prototype 1:1) or inside the existing three.js scene as its own overlay scene/camera — developer's choice. The prototype files use a small custom component wrapper (`.dc.html`); ignore the wrapper, the markup/styles/logic inside are the spec.

**`starmap-engine.js` and `starmap-data.js` are plain, dependency-free ES modules and can be ported nearly verbatim** — they contain the entire renderer (projection, input, picking, procedural sprites) and the destination catalog.

## Fidelity
**High-fidelity.** Colors, typography, spacing, letter-spacing, and interaction behavior are final and match the app's existing "Solace" aesthetic (quiet, thin, letter-spaced, dark blue-tinted). Recreate pixel-perfectly.

## Integration with the existing codebase
- Replace the body of `js/starmap.js` (keep its public API: `initStarMap`, `toggleStarMap`, `isStarMapOpen`, `updateStarMap`) so `main.js` needs no changes.
- M toggles the map; Escape closes it (same as today).
- Destination data should come from the live `getBodies()` / `getLandmarks()` instead of the static `starmap-data.js` snapshot. The snapshot's extra per-destination fields you must merge in: `kind` (type badge), `short` (poetic one-liner), `ly` (real light-year distance for landmarks — the old map showed game-scaled "0.1 LY" values; the redesign shows real ones).
- On select + "fly there" / "engage warp": call `flyTo(name)` for bodies, `warpTo(name)` for landmarks (from `js/flight.js`), then close the map — same contract as the current `onSelect`.
- Ship position for the "distance" readout: in the prototype it is fixed at Earth; in the app use the real camera position.

## Screen: Deep Field star map (full-screen overlay)
Background: `radial-gradient(ellipse at 50% 45%, #060a16 0%, #03050c 55%, #010208 100%)`, plus a vignette overlay `radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.5) 100%)` (pointer-events none). Font family everywhere: `'Segoe UI','Helvetica Neue',Arial,sans-serif`, weight 300.

### Components
1. **Wordmark** — top-center, 30px from top. "star map": 12px, letter-spacing 9px, `rgba(220,235,255,0.85)`, text-shadow `0 0 24px rgba(120,180,255,0.4), 0 1px 8px rgba(0,0,0,0.9)`. Below it "press esc to close": 8px, letter-spacing 4px, `rgba(255,255,255,0.3)`, margin-top 8px.
2. **The map canvas** — fills the viewport. See "Renderer spec" below.
3. **Tier ribbon** — bottom-center, 28px from bottom. Three click targets ("solar system", "interstellar", "galactic"), each: 5px dot + 9px label, letter-spacing 4px, gap 9px inside, 30px between items, separated by 26×1px lines `rgba(160,200,255,0.15)`. Active: label `rgba(220,235,255,0.9)`, dot `#8fd8ff` with `box-shadow: 0 0 8px #8fd8ff`. Inactive: label `rgba(180,210,255,0.35)`, dot `rgba(140,180,255,0.25)`. Clicking animates camera distance to that tier (260 / 680 / 1350 world units). The active tier follows live zoom (thresholds: <380 solar, <950 interstellar, else galactic).
4. **Controls hint** — bottom-right (right 28px, bottom 64px — kept above the ribbon line to avoid collision at narrow widths). Two lines, right-aligned: "drag to rotate · scroll to zoom" / "click a light to learn more". 9px, letter-spacing 3px, `rgba(255,255,255,0.3)`, line-height 2.1, pulsing opacity 0.3→0.6 over 4s ease-in-out infinite.
5. **Info card** (on select) — bottom-left (left 32px, bottom 70px), max-width 400px, padding 22px 26px, background `linear-gradient(to right, rgba(5,8,16,0.55), transparent)` + 4px backdrop blur, enter animation fade+8px rise, 0.4s ease-out. Contents:
   - Name (lowercase): 22px, letter-spacing 10px, weight 300, `rgba(255,255,255,0.95)`, text-shadow `0 0 20px <object color>, 0 1px 6px rgba(0,0,0,0.9)`.
   - Meta line: "`<kind>` · `<distance>`" 10px, letter-spacing 6px, `rgba(120,180,255,0.8)`, margin-top 6px.
   - Divider: 40×1px `rgba(120,180,255,0.25)`, 12px vertical margins.
   - Description (full `desc`): 12px, letter-spacing 1.5px, `rgba(255,255,255,0.68)`, line-height 2.
   - Button: "fly there" (bodies) / "engage warp" (landmarks). 10px, letter-spacing 5px, padding 9px 26px, color `rgba(120,180,255,0.9)`, background `rgba(120,180,255,0.06)`, border `1px solid rgba(120,180,255,0.4)`; hover: background `rgba(120,180,255,0.12)`, `box-shadow 0 0 24px rgba(120,180,255,0.3)`. (Matches the app's existing `#start-btn` style.)
6. **Warp confirmation** — center at 44% height: "course laid in", 14px, letter-spacing 8px, `rgba(255,180,80,0.9)`, text-shadow `0 0 20px rgba(255,150,50,0.5)`, fades in, auto-dismisses after ~2.2s. (In the real app this is replaced by actually starting the flight and closing the map.)

## Renderer spec (`starmap-engine.js` — port as-is)
- **Layout**: destinations placed on a log-scaled radial layout: `radius = log10(1 + au*8) * 90` world units; `y = sin(phi) * radius * 0.45` (flattened). Moons/near-Earth craft offset ~7–17 units around their parent. Landmarks use the game's `dist` values (3000–18000 "AU") which land them on outer shells at radius ~396–464.
- **Camera**: orbit around origin. Focal length 620, perspective divide, near-cull z<30. Start yaw 0.9, pitch 0.5, distance 300. Pitch clamped 0.06–1.35 rad.
- **Input**: pointer-drag rotates (yaw += dx·0.005, pitch += dy·0.004); wheel zooms `targetDist *= exp(deltaY·0.0012)`, clamped 110–1600, eased at 7%/frame. Click (movement <3px) selects nearest object within 24px of the cursor and flies the camera toward it (yaw eased to face it, distance to `clamp(r*2.1+120, 150, 1500)`).
- **Idle rotation**: yaw += 0.00012/frame, ONLY after 4s of no input AND while the pointer is off the canvas. (Deliberately very slow — do not speed up; users must never chase a click target.)
- **Star field**: 700 background stars on a unit sphere, projected with the same rotation, twinkle 0.7–1.0, color `#cfe0ff`, alpha 0.12–0.57 by magnitude; plus 4 very faint nebula washes (radial gradients, alpha 0.055) fixed to sky directions.
- **Orbit rings**: for planets/dwarfs with |phi|<0.2, a 1px circle at their orbital radius, `rgba(140,180,255,0.09)`.
- **Procedural sprites**: each destination pre-renders once to a 160px offscreen canvas (deterministic per name), drawn billboarded, size clamped per type (star ≤64px, landmark ≤56, planet ≤34, dwarf ≤26, craft ≤20, moon ≤18, min 9). Solid bodies are drawn lit from the left and rotated at draw time so the lit side faces the sun's screen position. See `buildSprite()` for the exact per-object recipes (gas-giant bands, Jupiter's spot, Earth continents+clouds, Mars polar cap, craters, Saturn front/back ring halves, Uranus ring, corona'd stars, satellite with panels, star-forming nebulae + Pillars columns, supernova filaments, planetary-nebula shell, Horsehead silhouette, Eta Car lobes, magnetar beams, Sgr A* accretion ellipses over black core, Andromeda particle spiral, Sombrero dust lane, Boötes void ring).
- **Hover**: nearest object within 24px: cursor pointer, sprite scales ×1.12 with a soft glow, label + distance shown. **Selected**: persistent ring + expanding pulse ring (1.6s cycle).
- **Labels**: lowercase name, 10px weight 300, letter-spacing 2px, `rgba(230,240,255,0.55)` (0.95 hovered/selected), offset right of the sprite; hovered/selected also show distance below at 9px `rgba(160,200,255,0.55)`. Visibility: landmarks always; planets/star/dwarfs when camera dist <700; moons/craft when <200. Earth carries a pulsing diamond "you are here" marker in `#8fd8ff`.
- **Distances**: real light-years for landmarks (`ly` field, formatted "6500 LY" / "2.5 MLY"); km for near-Earth (`shipKm`); otherwise AU from the ship's position.

## State Management
- `selected: destination | null` (drives info card), `hover`, `tier` (drives ribbon), camera state (yaw/pitch/dist + eased targets), transient "warping" flag.
- Open/close: same slide/fade pattern as the current drawer; keyboard M/Escape.

## Design Tokens
- Backgrounds: `#010208 / #03050c / #060a16`; panel `rgba(5,8,16,0.55)`
- Primary text `rgba(255,255,255,0.94)`; dim text `rgba(255,255,255,0.3–0.45)`
- Accent blue `#8fd8ff`; UI blue `rgba(120,180,255,x)`; label blue `rgba(160,200,255,x)`; warp amber `rgba(255,180,80,0.9)`
- Object colors: from `starmap-data.js` (e.g. Earth `#4a9cff`, Saturn `#e8cc88`, Sgr A* `#ff8800`)
- Type: Segoe UI stack, weight 300; letter-spacing scale 1.5 / 2 / 3 / 4 / 5 / 6 / 8 / 9 / 10px; sizes 8–12px UI, 22px selection title
- Motion: 0.3–0.4s ease-out panel fades; 7%/frame camera easing; 1.6s selection pulse

## Assets
None — every visual is procedural (canvas gradients/particles). No images, no icon fonts. Destination copy comes from the repo's own `bodies.js` / `starmap.js` / `deepspace.js` plus the new `kind`/`short`/`ly` fields in `starmap-data.js`.

## Files
- `starmap-b-deep-field.dc.html` — **the chosen design** (chrome markup + wiring)
- `starmap-engine.js` — full renderer: layout, projection, input, picking, procedural sprites (portable ES module)
- `starmap-data.js` — destination catalog with `kind`, `short`, `ly`, colors (portable ES module)
- `starmap-a-holo-bridge.dc.html`, `starmap-c-navigator.dc.html` — alternate directions, reference only (both reuse the same engine; the holo bridge shows how to monochrome-tint the sprites via the `theme:'holo'` + `accent` options)
