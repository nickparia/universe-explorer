# NMS-Style Landing System Design

**Date:** 2026-04-12
**Goal:** Mirror No Man's Sky's planet landing experience — altitude-based speed limiting, terrain-following floor, press-to-land autopilot, atmosphere entry feel, and supporting HUD.

## Overview

Five interconnected systems that transform the current passive landing into an NMS-inspired experience. All first-person (no ship model). The systems layer on top of each other: the speed cap slows you entering atmosphere, the altitude floor keeps you riding above terrain, press-F triggers a guided auto-land, atmosphere entry feels like punching through a barrier, and HUD elements communicate what's happening throughout.

## 1. Altitude-Based Speed Limiting

**File:** `js/flight.js` (replaces lines 307-311 soft speed cap)

**Behavior:**
- `altitudeNorm > 2`: Full speed (600 base / 24000 warp)
- `altitudeNorm 0.5–2`: Linear ramp from full speed down to low-flight cap (80 u/s)
- `altitudeNorm < 0.5`: Capped at 80 u/s, warp drive disabled entirely
- Thrust acceleration scales proportionally so the player can't fight past the cap

**Implementation notes:**
- Compute `maxSpeedForAltitude` each frame based on `altitudeNorm`
- Replace the flat `maxSpeed` in the speed cap section
- When warp is disabled due to altitude, set `warpActive = false` regardless of shift key
- The deceleration should feel like atmospheric drag — smooth, not a wall. Use the existing `LINEAR_DAMPING` but increase it when speed exceeds the altitude cap (e.g. `dampFactor = 0.035 + overspeedRatio * 0.15`)

**Constants:**
```
LOW_FLIGHT_SPEED = 80
SPEED_LIMIT_START = 2.0   // altitudeNorm where limiting begins
SPEED_LIMIT_FULL  = 0.5   // altitudeNorm where low-flight cap is fully applied
```

## 2. Soft Altitude Floor with Terrain Following

**File:** `js/flight.js` (replaces lines 313-345 landing mechanics)

**Behavior:**
- **Floor altitude:** `bodyRadius * 0.008` (scales with planet size)
- **Repulsion zone:** `bodyRadius * 0.05` down to floor — exponentially increasing upward force
- **Terrain following:** Within repulsion zone, vertical velocity adjusted to track terrain contour
- **C key override:** Pressing C pushes through floor with heavy resistance (for intentional landing). Once below the floor, the existing settle logic kicks in — if slow and not thrusting, the ship locks at the surface. Releasing C while above the floor snaps back to terrain-following.
- **Hard collision safety net:** Remains at `altitude < 0.2` to prevent clipping

**Repulsion force formula:**
```
if (altitude < repulsionZoneTop && altitude > floorAlt) {
  t = 1 - (altitude - floorAlt) / (repulsionZoneTop - floorAlt)  // 0 at top, 1 at floor
  repulsionAccel = t * t * 60  // exponential ramp, strong near floor
  // Apply as outward velocity addition along surface normal
}
```

**Terrain following:**
- Each frame, compute the inward velocity component (toward planet center)
- If inside repulsion zone and moving inward, dampen that component based on proximity to floor
- If terrain is rising (altitude decreasing without player input), add upward correction

**Constants:**
```
FLOOR_ALT_FACTOR      = 0.008  // floor = bodyRadius * this
REPULSION_ZONE_FACTOR = 0.05   // repulsion starts at bodyRadius * this
REPULSION_STRENGTH    = 60     // max acceleration at floor
```

## 3. Press-to-Land Autopilot

**File:** New `js/landing.js` module (state machine), integrated from `flight.js`

**Trigger conditions (all required):**
- `altitudeNorm < 0.3`
- `speed < 40`
- Not a gas giant, not the SUN
- Player presses **F** key

**State machine:**
```
INACTIVE → (conditions met) → READY → (F pressed) → ALIGN → DESCEND → SETTLE → LANDED → (thrust input) → INACTIVE
```

### States:

**READY:**
- HUD shows "PRESS F TO LAND" prompt
- No control changes — player flies normally
- Exits if conditions no longer met

**ALIGN (~1s):**
- All player input locked
- Ship orientation slerps so local "up" aligns with surface normal
- Horizontal velocity dampens to zero via exponential decay
- Re-entry glow/shake suppressed

**DESCEND (~2.5s):**
- Ship moves straight down toward surface along surface normal
- Speed: starts at ~20 u/s, eases toward zero using `easeOutQuad`
- Camera gently tilts down ~10 degrees (pitch offset slerped in)
- Altitude floor repulsion disabled during this phase

**SETTLE (~1s):**
- Final approach to floor altitude
- Speed eases to zero
- Camera pitch returns to level
- Velocity and angular velocity zeroed on completion

**LANDED:**
- Ship locked at floor altitude
- Full controls restored
- Any thrust input (W, Space, etc.) transitions back to INACTIVE (natural liftoff via repulsion floor)

**Integration with flight.js:**
- `landing.js` exports `updateLanding(dt)` called from `updateFlight`
- When landing state is not INACTIVE, it returns `true` to signal flight.js to skip normal input/physics
- Landing module reads `camPos`, `camQuat`, `velocity`, `angularVelocity` and writes to them directly
- F key listener added in `initFlight`, calls `landing.tryLand()`

**Constants:**
```
LAND_TRIGGER_ALT   = 0.3   // altitudeNorm
LAND_TRIGGER_SPEED = 40    // max speed to show prompt
ALIGN_DURATION     = 1.0   // seconds
DESCEND_DURATION   = 2.5
SETTLE_DURATION    = 1.0
DESCEND_START_SPEED = 20
CAMERA_TILT_ANGLE  = -0.17 // ~10 degrees in radians
```

## 4. Atmosphere Entry Barrier Effect

**File:** `js/atmosphere/effects.js` (enhancement of existing code)

**New behaviors:**

### Entry flash
- Track previous frame's `altitudeNorm` to detect crossing below 2.0
- On crossing (while `speed > 80`): spike glow overlay opacity to 0.8, then decay back to speed-based intensity over 0.3s
- One-shot flag prevents re-triggering until `altitudeNorm > 2.5` (hysteresis)

### Exit flash
- Same effect when ascending past `altitudeNorm > 2.0` at speed > 80

### Shake burst
- At the same crossing point, apply a single strong camera rotation impulse (~0.01 radians random on X/Y)
- Separate from continuous shake — additive

### Tuning changes
- Raise glow speed threshold from 50 to 80
- Scale glow intensity more aggressively: `(speed / 150)` instead of `(speed / 200)`
- Keep shake threshold at 30 for continuous rumble but increase multiplier at high speed

**State:**
```
let prevAltNorm = Infinity
let entryFlashActive = false
let entryFlashTimer = 0
let canTriggerEntry = true   // reset when altNorm > 2.5
```

## 5. HUD Enhancements

**Files:** `js/hud.js` + `index.html` (new DOM elements)

### New elements:

**"PRESS F TO LAND" prompt:**
- Center-bottom of screen, large text
- CSS pulse animation on opacity (0.6 → 1.0 → 0.6, 2s cycle)
- Shown/hidden by landing.js based on READY state
- DOM id: `land-prompt`

**Landing progress indicator:**
- Right side, vertical bar showing descent progress
- Fill percentage = elapsed time / total duration per phase
- Label shows current phase: "ALIGNING" / "DESCENDING" / "SETTLING"
- DOM id: `land-progress`

**Speed limit indicator:**
- Next to existing speed readout
- Format: "45.2 / 80" when altitude cap is active
- Hidden when no speed limit applies
- DOM id: `speed-limit`

**Terrain lock label:**
- Small "TERRAIN LOCK" text, shown when repulsion floor is actively holding the ship
- DOM id: `terrain-lock`

### Modified elements:

**Surface HUD:**
- Activation threshold changes from `altitudeNorm < 0.5` to `altitudeNorm < 0.3`

**Warp indicator:**
- When inside atmosphere (`altitudeNorm < 0.5`), show "WARP DISABLED" instead of hiding

## File Change Summary

| File | Change |
|------|--------|
| `js/flight.js` | Altitude speed cap, repulsion floor, landing integration, F key binding |
| `js/landing.js` | **New** — landing state machine |
| `js/atmosphere/effects.js` | Entry/exit flash, shake burst, tuning |
| `js/hud.js` | Speed limit display, terrain lock, surface HUD threshold, warp disabled text, landing prompt/progress |
| `index.html` | New DOM elements for landing HUD |

## Dependencies Between Systems

```
Speed Cap (1) ──→ ensures slow enough for Floor (2) to matter
Floor (2) ──→ provides the resting altitude for Landing (3)
Landing (3) ──→ disables Floor during descent, uses its altitude as target
Entry Effect (4) ──→ independent, suppressed during Landing
HUD (5) ──→ reads state from all other systems
```

## Edge Cases

- **Gas giants:** Speed cap still applies (atmospheric drag), but floor and landing are disabled (existing gas giant dive system handles these)
- **SUN:** All landing systems skip the SUN (existing check)
- **Very small bodies (asteroids):** Floor altitude scales with `bodyRadius * 0.008`, so tiny bodies get a tiny floor — should feel natural
- **Leaving during landing:** If somehow `altitudeNorm` jumps above 0.3 during auto-land (e.g. planet moves), abort landing and restore controls
- **Return home during landing:** H key should abort landing first, then trigger return-home
