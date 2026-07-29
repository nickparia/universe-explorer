# Handoff: The Vessel — AI Companion Mark (animated logo)

## Overview
An animated logo for the AI companion aboard *The Vessel*, the glass ship in **Solace**
(`nickparia/universe-explorer`). The mark is a set of seven vertical filaments that breathe.
It has **seven emotional states** — idle, thinking, speaking, pleased, concerned, sinister,
dormant — expressed entirely through breath, phase and warmth. The geometry never changes
between states, which is the whole idea: it stays calm and abstract, and the menace arrives
as *wrong timing*, not as a scary shape.

Intended placement: **bottom-right corner of the HUD**, small (30–96px), non-intrusive, over
the live 3D scene on black.

## About the Design Files
The file in this bundle is a **design reference created in HTML** — a prototype showing the
intended look and motion, not production code to drop in as-is. The task is to **recreate it
inside the target codebase's existing environment**, using its established patterns.

For this specific project the target is the vanilla-ES-module Three.js app in
`nickparia/universe-explorer` (`index.html` + `js/*.js`, no build step, no framework). There the
natural implementation is a small ES module — e.g. `js/companion-mark.js` — exporting
`initCompanionMark(canvas)` and `setCompanionState(key)`, driven from the existing render loop
in `js/main.js` alongside `updateHud()`. The prototype's `paint()` and `amps()` functions port
across essentially unchanged; only the React/DC wrapper and the playground chrome get dropped.

The playground UI (left state rail, caption, size row) is a **review harness only** — do not ship it.
Ship the canvas + the two functions.

## Fidelity
**High-fidelity.** Colors, timing constants, easing and geometry are final. The motion math in
`paint()` / `amps()` is the specification — port the numbers exactly. Palette and type are lifted
from the existing Solace HUD (`index.html`), so the mark already matches the app.

## Screens / Views

### 1. The mark (the only shippable artifact)
- **Purpose**: ambient presence of the AI. Reflects its current emotional state without text.
- **Element**: a single `<canvas>`, 2D context, transparent background (never fill black — it
  composites over the live 3D scene). Recommended HUD size **56×38 CSS px**, anchored
  bottom-right; sizes down to 30×22 and up to 96×66 are verified legible.
- **Geometry** (all derived from canvas size, so it is resolution-independent):
  - `n = 7` filaments, vertical, `lineCap: 'round'`
  - `span = min(cssW * 0.74, cssH * 1.26)` — the total horizontal extent
  - `gap = span / (n - 1)` — spacing between filaments
  - `maxH = min(cssH * 0.82, span * 0.72)` — height of the tallest filament at amplitude 1
  - `lineWidth = max(0.7, min(gap * 0.22, span * 0.0135))`
  - `scale = cssW / 440` (the prototype's hero width is the 1.0 reference)
  - centred: `x = cx + (i - (n-1)/2) * gap`, drawn from `cy - h/2` to `cy + h/2`
  - **Height profile** (`bell(i)`): with `c = (n-1)/2`, `d = |i - c| / c` →
    `1 - 0.58 * d²`. Centre filament tallest, outer ones ~42% shorter.
  - **Per-filament alpha fade**: `0.55 + 0.45 * bell(i)` — outer filaments are also dimmer.
- **Glow**: `shadowColor` = state color at `0.55 * alpha`;
  `shadowBlur = min(glowBase * glowMul * scale, gap * 0.55)`.
  **The `gap * 0.55` cap is load-bearing** — without it the halos merge at small sizes and the
  mark becomes an illegible blob. Scale the blur linearly with canvas size; never floor it.
- **Halo**: one radial gradient behind the filaments, centre → `span * 0.82`, from state color at
  `(0.055 + 0.03 * breath) * alpha` to transparent, where
  `breath = 0.5 + 0.5 * sin(t * 0.62)` (`0.30` instead of `0.62` in the dormant state).
- **DPR**: back the canvas at `min(2, devicePixelRatio)` and `setTransform(dpr,0,0,dpr,0,0)`;
  only resize the backing store when the CSS size actually changes.

### 2. Playground harness (reference only — not shipped)
Two-column grid, `260px 1fr`, black background.
Left rail: 1px right border `rgba(255,255,255,0.06)`, 34px padding; wordmark `SOLACE` at
11px / letter-spacing 6px / weight 300, subtitle `COMPANION MARK · STATES` at 8px /
letter-spacing 3.5px / `rgba(120,180,255,0.6)`; then one row per state — 14px dot column +
label at 10px / letter-spacing 3.2px, 1px bottom border `rgba(255,255,255,0.04)`, hover
background `rgba(120,180,255,0.05)`. Active row: dot = state color at 0.95, label
`rgba(255,255,255,0.92)`; inactive: dot `rgba(255,255,255,0.14)`, label `rgba(255,255,255,0.42)`.
Centre: 440×300 hero canvas; below it the state name at 15px / letter-spacing 9px / weight 300
in the state color, a 34×1px divider `rgba(120,180,255,0.18)`, then the state line at 11px italic
`rgba(255,255,255,0.4)`. A size row (96 / 56 / 30) sits below a 1px top rule.

## Interactions & Behavior

### The seven states
Each state is `{ key, label, line, col:[r,g,b], glow, alpha }` plus an amplitude function of
`(t, i)` where `t` is seconds since mount and `i` is the filament index.

| Key | Label | Color (rgb) | glow | alpha | Motion |
|---|---|---|---|---|---|
| `idle` | IDLE | 120,180,255 | 16 | 0.90 | slow symmetric breath |
| `thinking` | THINKING | 150,200,255 | 20 | 0.95 | a pulse walks left→right |
| `speaking` | SPEAKING | 185,218,255 | 22 | 1.00 | speech-like envelope |
| `pleased` | PLEASED | 255,206,148 | 28 | 1.00 | wider, lifted, warm |
| `concerned` | CONCERNED | 255,200,80 | 24 | 0.95 | fine tremor, one filament dips |
| `sinister` | THE MASK SLIPS | 255,124,96 | 34 | 1.00 | too still, then a snap |
| `dormant` | DORMANT | 92,124,176 | 9 | 0.42 | nearly flat, very slow |

Amplitude formulas (with `b = bell(i)`, `d = (i - c)/c`):

- **idle** — `b * (0.72 + 0.10 * sin(t*0.62 - |d|*0.55))`
- **thinking** — `scan = ((t*1.15) % 2.4)/2.4 * (n+1.6) - 0.8`;
  `p = exp(-(i - scan)² / 0.85)`; `b * (0.5 + 0.06*sin(t*1.4)) + p*0.42`
- **speaking** — `env = 0.5 + 0.5*sin(t*2.9)*sin(t*1.13 + 0.7)`;
  `g = sin(t*7.3 + i*1.9) * sin(t*4.1 + i*0.7)`;
  `b * (0.52 + 0.42*env*(0.55 + 0.45*g))`
- **pleased** — `(1 - 0.24*d²) * (0.86 + 0.13*sin(t*0.72 - |d|*0.9))` (note the *wider* bell —
  the whole mark opens up rather than growing taller)
- **concerned** — `trem = sin(t*9.4 + i*2.3)*0.028`; `dip = (i === n-2) ? 0.72 : 1`;
  `b * dip * (0.66 + 0.07*sin(t*0.5 + i) + trem)`
- **sinister** — a 6.4s cycle. `cyc = t % 6.4`; for `cyc < 4.4` → `hold = 0`, otherwise
  `hold = min(1, (cyc-4.4)/0.16) * exp(-(cyc-4.4-0.16)*1.9)`. `off = (i === n-2) ? 1 : 0`.
  `b * (0.70 + 0.014*sin(t*0.30)) + hold*(0.30 + 0.34*(i/(n-1))) + off*(0.16 + 0.12*sin(t*1.9))`;
  and `glowMul = 1 + hold*1.3`.
  Read: it holds unnaturally still for 4.4s (amplitude wobble of only ±1.4%), then snaps in 160ms
  with a rightward-increasing bias and decays over ~0.5s — while one filament (`n-2`) never
  rejoins the others' phase.
- **dormant** — `b * (0.15 + 0.055 * sin(t*0.30))`

All amplitudes clamp to `max(0.02, a)`.

### State transitions
Never cut. Keep `prev`, `cur`, and `mix` (0→1 over **0.9s**, advanced per frame). Every frame,
compute the amplitude array, color, glow and alpha for **both** `prev` and `cur`, then linearly
interpolate by `e = easeInOutCubic(mix)`:
`x < 0.5 ? 4x³ : 1 - (-2x+2)³/2`. This is what makes the mask slipping feel like a slow bleed
rather than a jump cut.

### Responsive
Everything derives from `clientWidth`/`clientHeight` — no fixed pixel values in the drawing code.
Verified legible from 30×22 up to 440×300.

## State Management
- `cur: string` — active state key
- `prev: string` — the state being blended out of
- `mix: number` — 0→1 blend progress, `+= dt/0.9` per frame, clamped at 1
- `t: number` — seconds since mount, drives all motion

Single `requestAnimationFrame` loop; cancel on teardown. No data fetching. In the real app the
state key comes from the companion's own logic (proximity events, warp, chat activity, idle
timers) — the mark is a pure view of a string.

## Design Tokens
Lifted from `index.html` in the source repo.

- Background: `#000`
- HUD blue: `rgba(120,180,255,*)` — primary accent (also `150,200,255` and `185,218,255` as brighter variants)
- Warm amber: `rgba(255,200,80,*)` — caution (and `255,206,148` for affection)
- Warm red: `rgba(255,124,96,*)` — the slip (repo's alert family is `255,100,70` / `255,140,110`)
- Cool dim: `rgba(92,124,176,*)` — dormant
- Rules/borders: `rgba(255,255,255,0.06)` and `rgba(255,255,255,0.04)`
- Text: 0.92 / 0.42 / 0.28 white alphas
- Type: `'Segoe UI','Helvetica Neue',Arial,sans-serif`, weight 100–300 only
- Type scale (px / letter-spacing): 15/9, 11/6, 11/1.4 italic, 10/3.2, 9/1.6, 8/3
- Radii: none (1px rules and round line caps only)
- Blend/transition durations: 0.9s state blend, easeInOutCubic

## Assets
None. No images, no icon files, no fonts to load — the mark is drawn procedurally on a 2D canvas
and the type uses the system stack already in `index.html`.

## Files
- `Vessel AI Logo.dc.html` — the prototype. The logic class holds `STATES`, `amps()` and `paint()`;
  those three are the actual specification. The template is the review harness.
- `github.md` — source-repo association (repo, branch, subtree path, screen map).
