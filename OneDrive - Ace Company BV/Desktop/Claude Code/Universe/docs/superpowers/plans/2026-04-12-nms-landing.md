# NMS-Style Landing System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the current passive landing into an NMS-inspired experience with altitude-based speed limiting, terrain-following floor, press-to-land autopilot, atmosphere entry barrier effects, and supporting HUD.

**Architecture:** Five systems layered in `flight.js` (speed cap + floor), a new `landing.js` (autopilot state machine), enhanced `atmosphere/effects.js` (entry barrier), and `hud.js` + `index.html` (new HUD elements). The landing module integrates via a single `updateLanding()` call from the flight loop that returns whether to skip normal flight physics.

**Tech Stack:** Three.js r170, vanilla JS ES modules, DOM-based HUD

---

## File Structure

| File | Responsibility |
|------|---------------|
| `js/flight.js` | Altitude-based speed cap (replaces lines 233-311), repulsion floor (replaces lines 313-345), landing module integration, F key binding |
| `js/landing.js` | **New** — Landing autopilot state machine (INACTIVE → READY → ALIGN → DESCEND → SETTLE → LANDED) |
| `js/atmosphere/effects.js` | Entry/exit flash, shake burst, tuned glow/shake thresholds |
| `js/hud.js` | Speed limit display, terrain lock label, landing prompt/progress, warp disabled text, surface HUD threshold change |
| `index.html` | New DOM elements for landing HUD |

---

### Task 1: Altitude-Based Speed Limiting

**Files:**
- Modify: `js/flight.js:6-14` (add constants), `js/flight.js:233-311` (replace warp/speed logic)

- [ ] **Step 1: Add altitude speed constants**

Add after line 14 (`BH_GRAVITY_RANGE_MULT`):

```javascript
const LOW_FLIGHT_SPEED    = 80;
const SPEED_LIMIT_START   = 2.0;   // altitudeNorm where limiting begins
const SPEED_LIMIT_FULL    = 0.5;   // altitudeNorm where low-flight cap is fully applied
```

- [ ] **Step 2: Replace warp and speed cap logic**

Replace lines 233-311 (from `// ── 6. Warp drive` through `// ── 10. Soft speed cap` block end) with:

```javascript
    // ── 6. Altitude-based speed limiting ─────────────────────────────────
    const alt = getAltitude();
    let altMaxSpeed = MAX_BASE_SPEED;
    let warpAllowed = true;

    if (alt.body && alt.altitudeNorm < SPEED_LIMIT_START && !alt.isGasGiant) {
      if (alt.altitudeNorm < SPEED_LIMIT_FULL) {
        // Fully inside low-flight zone
        altMaxSpeed = LOW_FLIGHT_SPEED;
        warpAllowed = false;
      } else {
        // Linear ramp between full speed and low-flight cap
        const t = (alt.altitudeNorm - SPEED_LIMIT_FULL) / (SPEED_LIMIT_START - SPEED_LIMIT_FULL);
        altMaxSpeed = LOW_FLIGHT_SPEED + t * (MAX_BASE_SPEED - LOW_FLIGHT_SPEED);
        // Disable warp below midpoint
        if (alt.altitudeNorm < 1.0) warpAllowed = false;
      }
    }

    // ── 7. Warp drive ────────────────────────────────────────────────────
    const shiftHeld = keys['ShiftLeft'] || keys['ShiftRight'];
    if (shiftHeld && warpAllowed) {
        boostEnergy -= dt * 0.2;
    } else {
        boostEnergy += dt * 0.125;
    }
    boostEnergy = Math.max(0, Math.min(1, boostEnergy));

    warpActive = shiftHeld && boostEnergy > 0 && warpAllowed;
    const warpMult   = warpActive ? WARP_MULTIPLIER : 1;
    const maxSpeed    = Math.min(altMaxSpeed * warpMult, altMaxSpeed * (warpAllowed ? WARP_MULTIPLIER : 1));
    const thrustAccel = THRUST_ACCEL * Math.min(warpMult, altMaxSpeed / MAX_BASE_SPEED * warpMult);
```

- [ ] **Step 3: Replace the soft speed cap section**

Replace the old speed cap block (was `// ── 10. Soft speed cap`) with atmospheric-drag-style limiting:

```javascript
    // ── 10. Soft speed cap with atmospheric drag ─────────────────────────
    const speed = velocity.length();
    if (speed > maxSpeed) {
      // Atmospheric drag — stronger the more you exceed the limit
      const overspeedRatio = Math.min((speed - maxSpeed) / maxSpeed, 1);
      const dragDamp = 0.035 + overspeedRatio * 0.15;
      velocity.multiplyScalar(1 - dragDamp);
    } else if (speed > maxSpeed * 0.95) {
      // Gentle drag near the limit to prevent oscillation
      velocity.multiplyScalar(maxSpeed / speed);
    }
```

- [ ] **Step 4: Export altitude speed state for HUD**

Add a new exported function at the bottom of flight.js:

```javascript
export function getAltMaxSpeed() {
    // Return 0 when no limit is active
    const alt = getAltitude();
    if (!alt.body || alt.altitudeNorm >= SPEED_LIMIT_START || alt.isGasGiant) return 0;
    if (alt.altitudeNorm < SPEED_LIMIT_FULL) return LOW_FLIGHT_SPEED;
    const t = (alt.altitudeNorm - SPEED_LIMIT_FULL) / (SPEED_LIMIT_START - SPEED_LIMIT_FULL);
    return LOW_FLIGHT_SPEED + t * (MAX_BASE_SPEED - LOW_FLIGHT_SPEED);
}

export function isWarpAllowed() {
    const alt = getAltitude();
    if (!alt.body || alt.isGasGiant) return true;
    return alt.altitudeNorm >= 1.0;
}
```

- [ ] **Step 5: Update main.js import**

In `js/main.js` line 9, add the new exports:

```javascript
import { initFlight, updateFlight, getCamPos, getSpeed, getVelocity, doHome, getAltMaxSpeed, isWarpAllowed } from './flight.js';
```

- [ ] **Step 6: Test manually**

Run the local server and fly toward Earth:
- Approaching from space, speed should gradually decrease as you enter atmosphere
- Below `altitudeNorm < 0.5`, max speed should be ~80 u/s
- Warp (Shift) should stop working below `altitudeNorm < 1.0`
- The deceleration should feel smooth, not jarring

- [ ] **Step 7: Commit**

```bash
git add js/flight.js js/main.js
git commit -m "feat: altitude-based speed limiting — atmospheric drag on approach"
```

---

### Task 2: Soft Altitude Floor with Terrain Following

**Files:**
- Modify: `js/flight.js:313-345` (replace landing mechanics section)

- [ ] **Step 1: Add floor constants**

Add after the `SPEED_LIMIT_FULL` constant (from Task 1):

```javascript
const FLOOR_ALT_FACTOR      = 0.008;  // floor = bodyRadius * this
const REPULSION_ZONE_FACTOR  = 0.05;   // repulsion starts at bodyRadius * this
const REPULSION_STRENGTH     = 60;     // max acceleration at floor
```

- [ ] **Step 2: Replace the landing mechanics section**

Replace the entire `// ── Landing mechanics` block (lines 313-345 — the `landable` check, hard collision, settle, and approach dampening) with:

```javascript
    // ── Landing mechanics — repulsion floor + terrain following ──────────
    const landAlt = getAltitude();
    const landable = landAlt.body && !landAlt.isGasGiant && landAlt.nearestBody !== 'SUN' && landAlt.altitudeNorm < 2;

    // Export state for HUD
    _floorActive = false;

    if (landable) {
      const bodyWorldPos = landAlt.body.g.userData._worldPos || landAlt.body.g.position;
      const surfaceNormal = _dir.copy(camPos).sub(bodyWorldPos).normalize();
      const floorAlt = landAlt.bodyRadius * FLOOR_ALT_FACTOR;
      const repulsionTop = landAlt.bodyRadius * REPULSION_ZONE_FACTOR;

      // Hard collision safety net — prevent clipping through terrain
      if (landAlt.altitude < 0.2) {
        camPos.copy(bodyWorldPos).addScaledVector(surfaceNormal, landAlt.bodyRadius + floorAlt);
        const inward = velocity.dot(_dir.copy(bodyWorldPos).sub(camPos).normalize());
        if (inward > 0) velocity.addScaledVector(_dir, -inward);
      }

      // Repulsion floor — exponentially increasing upward force
      if (landAlt.altitude < repulsionTop && landAlt.altitude > 0.2) {
        const t = 1 - (landAlt.altitude - floorAlt) / (repulsionTop - floorAlt);
        const clampedT = Math.max(0, Math.min(t, 1));

        if (clampedT > 0) {
          _floorActive = true;

          // C key override — allow pushing through with resistance
          const cDown = keys['KeyC'];
          const repulsionMult = cDown ? 0.15 : 1.0;

          // Repulsion acceleration (quadratic ramp)
          const repulsionAccel = clampedT * clampedT * REPULSION_STRENGTH * repulsionMult;
          velocity.addScaledVector(surfaceNormal, repulsionAccel * dt);

          // Terrain following — dampen inward velocity component
          const inwardSpeed = velocity.dot(_dir.copy(bodyWorldPos).sub(camPos).normalize());
          if (inwardSpeed > 0 && !cDown) {
            const dampFactor = clampedT * 0.8;
            velocity.addScaledVector(_dir, -inwardSpeed * dampFactor);
          }
        }
      }

      // Settle — lock when below floor, very slow, and not thrusting
      if (landAlt.altitude < floorAlt && speed < 8 && !thrusting) {
        velocity.set(0, 0, 0);
        angularVelocity.set(0, 0, 0);
        camPos.copy(bodyWorldPos).addScaledVector(surfaceNormal, landAlt.bodyRadius + floorAlt);
      }
    }
```

- [ ] **Step 3: Add floor state variable and export**

Add near the top of flight.js with the other state variables (after line 40 `let warpActive`):

```javascript
let _floorActive = false;
```

Add an export at the bottom:

```javascript
export function isFloorActive() {
    return _floorActive;
}
```

- [ ] **Step 4: Update main.js import**

Update the flight.js import in `js/main.js` to include the new export:

```javascript
import { initFlight, updateFlight, getCamPos, getSpeed, getVelocity, doHome, getAltMaxSpeed, isWarpAllowed, isFloorActive } from './flight.js';
```

- [ ] **Step 5: Remove duplicate `alt` variable**

The old code declared `const alt = getAltitude()` at line 314 for landing mechanics. The new code uses `landAlt` to avoid conflict with the `alt` variable used earlier in the speed limiting section (Task 1 step 2 already declares `const alt = getAltitude()` near line 233). Verify there are no duplicate declarations — the speed section uses `alt`, the landing section uses `landAlt`.

- [ ] **Step 6: Test manually**

Fly toward Earth at low speed:
- Ship should start "floating" above the terrain at ~50-100m equivalent
- Moving over hills, the ship should gently rise and fall
- Pressing C should let you push through the floor toward the surface
- Releasing C should snap back to terrain-following
- Hard collision at very low altitude should still prevent clipping

- [ ] **Step 7: Commit**

```bash
git add js/flight.js js/main.js
git commit -m "feat: soft altitude floor with terrain following — hovercraft feel"
```

---

### Task 3: Landing Autopilot State Machine

**Files:**
- Create: `js/landing.js`
- Modify: `js/flight.js` (integrate landing calls, F key binding)
- Modify: `js/main.js` (import and wire up)

- [ ] **Step 1: Create `js/landing.js`**

```javascript
// landing.js — NMS-style press-to-land autopilot state machine
import * as THREE from 'three';
import { getAltitude } from './altitude.js';

// ── States ──────────────────────────────────────────────────────────────
export const LAND_STATE = {
  INACTIVE: 0,
  READY: 1,
  ALIGN: 2,
  DESCEND: 3,
  SETTLE: 4,
  LANDED: 5,
};

// ── Constants ───────────────────────────────────────────────────────────
const LAND_TRIGGER_ALT    = 0.3;
const LAND_TRIGGER_SPEED  = 40;
const ALIGN_DURATION      = 1.0;
const DESCEND_DURATION    = 2.5;
const SETTLE_DURATION     = 1.0;
const DESCEND_START_SPEED = 20;
const CAMERA_TILT_ANGLE   = -0.17;  // ~10 degrees

// ── State ───────────────────────────────────────────────────────────────
let state = LAND_STATE.INACTIVE;
let phaseTimer = 0;
let startQuat = new THREE.Quaternion();
let targetQuat = new THREE.Quaternion();
let startPitchOffset = 0;
let landingSurfaceNormal = new THREE.Vector3();
let landingBodyPos = new THREE.Vector3();
let landingBodyRadius = 0;
let landingFloorAlt = 0;

// Temp vectors
const _tempV = new THREE.Vector3();
const _tempQ = new THREE.Quaternion();

function easeOutQuad(t) {
  return 1 - (1 - t) * (1 - t);
}

// ── Public API ──────────────────────────────────────────────────────────

export function getLandingState() {
  return state;
}

export function getLandingProgress() {
  if (state === LAND_STATE.ALIGN) return { phase: 'ALIGNING', progress: phaseTimer / ALIGN_DURATION };
  if (state === LAND_STATE.DESCEND) return { phase: 'DESCENDING', progress: phaseTimer / DESCEND_DURATION };
  if (state === LAND_STATE.SETTLE) return { phase: 'SETTLING', progress: phaseTimer / SETTLE_DURATION };
  return null;
}

/**
 * Attempt to initiate landing. Called when F is pressed.
 * @returns {boolean} true if landing sequence started
 */
export function tryLand(camPos, velocity) {
  if (state !== LAND_STATE.READY) return false;

  const alt = getAltitude();
  if (!alt.body) return false;

  // Capture landing target
  landingBodyPos.copy(alt.body.g.userData._worldPos || alt.body.g.position);
  landingBodyRadius = alt.bodyRadius;
  landingSurfaceNormal.copy(camPos).sub(landingBodyPos).normalize();
  landingFloorAlt = landingBodyRadius * 0.008;

  state = LAND_STATE.ALIGN;
  phaseTimer = 0;

  return true;
}

/**
 * Abort landing (e.g. H key pressed, altitude lost).
 */
export function abortLanding() {
  state = LAND_STATE.INACTIVE;
  phaseTimer = 0;
}

/**
 * Update landing system. Call every frame from updateFlight.
 * @returns {boolean} true if landing is active and flight.js should skip normal input/physics
 */
export function updateLanding(dt, camPos, camQuat, velocity, angularVelocity, keys, thrusting) {
  const alt = getAltitude();
  const speed = velocity.length();

  // ── Check READY conditions ────────────────────────────────────────
  if (state === LAND_STATE.INACTIVE || state === LAND_STATE.READY) {
    const canLand = alt.body &&
      !alt.isGasGiant &&
      alt.nearestBody !== 'SUN' &&
      alt.altitudeNorm < LAND_TRIGGER_ALT &&
      speed < LAND_TRIGGER_SPEED;

    if (canLand) {
      if (state === LAND_STATE.INACTIVE) state = LAND_STATE.READY;
    } else {
      if (state === LAND_STATE.READY) state = LAND_STATE.INACTIVE;
    }

    // READY and INACTIVE don't override flight controls
    return false;
  }

  // ── Active landing — all states below lock player controls ─────────

  // Safety: abort if we somehow lost the body
  if (!alt.body || alt.altitudeNorm > LAND_TRIGGER_ALT * 2) {
    abortLanding();
    return false;
  }

  // Update body position (it may have moved due to orbit)
  landingBodyPos.copy(alt.body.g.userData._worldPos || alt.body.g.position);
  landingSurfaceNormal.copy(camPos).sub(landingBodyPos).normalize();

  phaseTimer += dt;

  // ── ALIGN ─────────────────────────────────────────────────────────
  if (state === LAND_STATE.ALIGN) {
    if (phaseTimer <= dt) {
      // First frame — capture start orientation
      startQuat.copy(camQuat);
      // Compute target: "up" aligned with surface normal
      _tempV.copy(landingSurfaceNormal);
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camQuat);
      // Project forward onto the tangent plane
      const fwdTangent = fwd.sub(_tempV.clone().multiplyScalar(fwd.dot(_tempV))).normalize();
      const m = new THREE.Matrix4().lookAt(
        new THREE.Vector3(0, 0, 0),
        fwdTangent.negate(),
        _tempV
      );
      targetQuat.setFromRotationMatrix(m);
    }

    const t = Math.min(phaseTimer / ALIGN_DURATION, 1);
    const ease = easeOutQuad(t);

    // Slerp orientation toward surface-aligned
    camQuat.slerpQuaternions(startQuat, targetQuat, ease);

    // Dampen velocity to zero
    velocity.multiplyScalar(1 - 3 * dt);
    angularVelocity.multiplyScalar(1 - 5 * dt);

    if (phaseTimer >= ALIGN_DURATION) {
      state = LAND_STATE.DESCEND;
      phaseTimer = 0;
    }
    return true;
  }

  // ── DESCEND ───────────────────────────────────────────────────────
  if (state === LAND_STATE.DESCEND) {
    const t = Math.min(phaseTimer / DESCEND_DURATION, 1);

    // Descend speed eases from DESCEND_START_SPEED toward zero
    const descentSpeed = DESCEND_START_SPEED * (1 - easeOutQuad(t));

    // Move toward surface along inverted surface normal
    velocity.copy(landingSurfaceNormal).multiplyScalar(-descentSpeed);
    angularVelocity.set(0, 0, 0);

    // Camera tilt — pitch down gently
    const tiltT = t < 0.8 ? t / 0.8 : 1;  // ramp in over 80% of descent
    const pitchOffset = CAMERA_TILT_ANGLE * easeOutQuad(tiltT);
    const pitchAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(camQuat);
    _tempQ.setFromAxisAngle(pitchAxis, pitchOffset - startPitchOffset);
    camQuat.premultiply(_tempQ);
    camQuat.normalize();
    startPitchOffset = pitchOffset;

    if (phaseTimer >= DESCEND_DURATION) {
      state = LAND_STATE.SETTLE;
      phaseTimer = 0;
    }
    return true;
  }

  // ── SETTLE ────────────────────────────────────────────────────────
  if (state === LAND_STATE.SETTLE) {
    const t = Math.min(phaseTimer / SETTLE_DURATION, 1);
    const ease = easeOutQuad(t);

    // Ease velocity to zero
    velocity.multiplyScalar(1 - 5 * dt);
    angularVelocity.set(0, 0, 0);

    // Return camera pitch to level
    if (startPitchOffset !== 0) {
      const pitchReturn = startPitchOffset * (1 - ease);
      const pitchAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(camQuat);
      _tempQ.setFromAxisAngle(pitchAxis, pitchReturn - startPitchOffset);
      camQuat.premultiply(_tempQ);
      camQuat.normalize();
      startPitchOffset = pitchReturn;
    }

    // Snap to floor altitude at end
    if (phaseTimer >= SETTLE_DURATION) {
      velocity.set(0, 0, 0);
      angularVelocity.set(0, 0, 0);
      startPitchOffset = 0;

      // Place at floor altitude
      camPos.copy(landingBodyPos).addScaledVector(landingSurfaceNormal, landingBodyRadius + landingFloorAlt);

      state = LAND_STATE.LANDED;
      phaseTimer = 0;
    }
    return true;
  }

  // ── LANDED ────────────────────────────────────────────────────────
  if (state === LAND_STATE.LANDED) {
    // Any thrust input lifts off
    if (thrusting) {
      state = LAND_STATE.INACTIVE;
      return false;
    }

    // Hold position at floor
    velocity.set(0, 0, 0);
    angularVelocity.set(0, 0, 0);

    // Keep updating surface normal in case planet rotates
    landingBodyPos.copy(alt.body.g.userData._worldPos || alt.body.g.position);
    landingSurfaceNormal.copy(camPos).sub(landingBodyPos).normalize();
    camPos.copy(landingBodyPos).addScaledVector(landingSurfaceNormal, landingBodyRadius + landingFloorAlt);

    // Allow look-around but no translation — return false so flight.js processes mouse input
    return false;
  }

  return false;
}
```

- [ ] **Step 2: Integrate landing into flight.js — imports and F key**

At the top of `js/flight.js`, add the import:

```javascript
import { updateLanding, tryLand, abortLanding, getLandingState, LAND_STATE } from './landing.js';
```

In the `initFlight` function, inside the keydown listener (after the `if (e.code === 'KeyH') doHome();` line), add:

```javascript
        if (e.code === 'KeyF') tryLand(camPos, velocity);
```

- [ ] **Step 3: Integrate landing into flight.js — update loop**

In `updateFlight`, right after the return-home animation block (after line 203 `return;`), add:

```javascript
    // ── 1b. Landing autopilot ────────────────────────────────────────────
    const landingActive = updateLanding(dt, camPos, camQuat, velocity, angularVelocity, keys,
      keys['KeyW'] || keys['ArrowUp'] || keys['KeyS'] || keys['ArrowDown'] ||
      keys['KeyA'] || keys['ArrowLeft'] || keys['KeyD'] || keys['ArrowRight'] ||
      keys['Space'] || keys['KeyC']);

    if (landingActive) {
      // Landing controls the ship — skip normal flight input/physics
      // Still apply velocity to position
      camPos.addScaledVector(velocity, dt * 60);
      cam.quaternion.copy(camQuat);
      updateHUD();
      return;
    }
```

- [ ] **Step 4: Abort landing on H key**

In the `doHome` function, add at the very top:

```javascript
    // Abort any active landing
    if (getLandingState() !== LAND_STATE.INACTIVE && getLandingState() !== LAND_STATE.READY) {
      abortLanding();
    }
```

- [ ] **Step 5: Skip repulsion floor during active landing**

In the landing mechanics section (Task 2), wrap the repulsion floor logic so it's skipped during active descent. At the start of the `if (landable)` block, add:

```javascript
      // Skip floor repulsion during landing autopilot descent
      const landState = getLandingState();
      const skipFloor = landState === LAND_STATE.ALIGN || landState === LAND_STATE.DESCEND || landState === LAND_STATE.SETTLE;
```

Then wrap the repulsion and settle blocks with `if (!skipFloor)`:

```javascript
      if (!skipFloor) {
        // Repulsion floor — exponentially increasing upward force
        if (landAlt.altitude < repulsionTop && landAlt.altitude > 0.2) {
          // ... existing repulsion code ...
        }

        // Settle — lock when below floor, very slow, and not thrusting
        if (landAlt.altitude < floorAlt && speed < 8 && !thrusting) {
          // ... existing settle code ...
        }
      }
```

Keep the hard collision safety net outside the `skipFloor` check — it should always apply.

- [ ] **Step 6: Update main.js imports**

Add landing imports to `js/main.js`:

```javascript
import { getLandingState, LAND_STATE } from './landing.js';
```

- [ ] **Step 7: Test manually**

Fly to Earth, slow down near the surface:
- "PRESS F TO LAND" should appear (Task 5 adds HUD, for now just verify state transitions via console)
- Press F — ship should align upright, descend smoothly, settle, then lock
- Press W or Space while landed — should lift off naturally
- Press H during landing — should abort and return home

- [ ] **Step 8: Commit**

```bash
git add js/landing.js js/flight.js js/main.js
git commit -m "feat: press-to-land autopilot — F key triggers guided descent"
```

---

### Task 4: Atmosphere Entry Barrier Effect

**Files:**
- Modify: `js/atmosphere/effects.js`

- [ ] **Step 1: Add state variables for entry flash**

After the existing `let shakeOffset` declaration (line 11), add:

```javascript
let prevAltNorm = Infinity;
let entryFlashActive = false;
let entryFlashTimer = 0;
let canTriggerEntry = true;
```

- [ ] **Step 2: Add landing state import**

At the top of the file, add:

```javascript
import { getLandingState, LAND_STATE } from '../landing.js';
```

- [ ] **Step 3: Replace the updateAtmoEffects function body**

Replace the entire `updateAtmoEffects` function with:

```javascript
export function updateAtmoEffects(dt, camPos, velocity, camera, scene) {
  const alt = getAltitude();
  const speed = velocity.length();
  const perfConfig = getConfig();
  const landState = getLandingState();

  // Suppress effects during landing autopilot
  const suppressEffects = landState === LAND_STATE.ALIGN ||
    landState === LAND_STATE.DESCEND ||
    landState === LAND_STATE.SETTLE;

  // ── Entry/exit flash detection ────────────────────────────────────
  if (alt.hasAtmosphere && !suppressEffects) {
    const crossedIn = prevAltNorm >= 2.0 && alt.altitudeNorm < 2.0 && speed > 80;
    const crossedOut = prevAltNorm <= 2.0 && alt.altitudeNorm > 2.0 && speed > 80;

    if ((crossedIn || crossedOut) && canTriggerEntry) {
      entryFlashActive = true;
      entryFlashTimer = 0;
      canTriggerEntry = false;

      // Shake burst — single strong impulse
      if (camera) {
        camera.rotateX((Math.random() - 0.5) * 0.02);
        camera.rotateY((Math.random() - 0.5) * 0.02);
      }
    }

    // Reset trigger when far enough away (hysteresis)
    if (alt.altitudeNorm > 2.5 || alt.altitudeNorm < 1.5) {
      canTriggerEntry = true;
    }
  }

  // ── Entry flash decay ─────────────────────────────────────────────
  if (entryFlashActive) {
    entryFlashTimer += dt;
    if (entryFlashTimer > 0.3) {
      entryFlashActive = false;
    }
  }

  // ── Re-entry glow ─────────────────────────────────────────────────
  if (glowOverlay) {
    if (suppressEffects) {
      glowOverlay.style.opacity = 0;
    } else if (alt.hasAtmosphere && alt.altitudeNorm < 3 && speed > 80) {
      const config = getPlanetConfig(alt.nearestBody);
      const density = config?.atmosphere?.density || 1;
      const baseIntensity = Math.min(1, (speed / 150) * Math.min(density, 5) * (1 - alt.altitudeNorm / 3));

      // Add flash spike
      let flashBoost = 0;
      if (entryFlashActive) {
        flashBoost = 0.8 * (1 - entryFlashTimer / 0.3);
      }

      glowOverlay.style.opacity = Math.min(1, baseIntensity * 0.6 + flashBoost);
    } else if (entryFlashActive) {
      // Flash even if below normal speed threshold
      const flashIntensity = 0.8 * (1 - entryFlashTimer / 0.3);
      glowOverlay.style.opacity = flashIntensity;
    } else {
      glowOverlay.style.opacity = 0;
    }
  }

  // ── Camera shake ──────────────────────────────────────────────────
  const shakeMultiplier = perfConfig.cameraShake;
  if (!suppressEffects && alt.hasAtmosphere && alt.altitudeNorm < 2 && speed > 30 && shakeMultiplier > 0) {
    const config = getPlanetConfig(alt.nearestBody);
    const density = Math.min(config?.atmosphere?.density || 1, 10);
    // More aggressive at high speed
    const speedFactor = Math.min(speed / 200, 2);
    const shakeIntensity = speedFactor * density * (1 - alt.altitudeNorm / 2) * 0.003 * shakeMultiplier;

    shakeOffset.set(
      (Math.random() - 0.5) * shakeIntensity,
      (Math.random() - 0.5) * shakeIntensity,
      (Math.random() - 0.5) * shakeIntensity * 0.3
    );
    camera.rotateX(shakeOffset.x);
    camera.rotateY(shakeOffset.y);
  }

  // Track for next frame
  prevAltNorm = alt.hasAtmosphere ? alt.altitudeNorm : Infinity;
}
```

- [ ] **Step 4: Test manually**

Fly toward Earth at high speed (warp):
- Crossing the atmosphere boundary should produce a bright flash and strong shake burst
- Continuous glow and shake should be more intense at higher speeds
- Leaving the atmosphere at speed should also flash
- During landing autopilot, glow and shake should be suppressed

- [ ] **Step 5: Commit**

```bash
git add js/atmosphere/effects.js
git commit -m "feat: atmosphere entry barrier — flash and shake burst on crossing"
```

---

### Task 5: HUD Enhancements

**Files:**
- Modify: `index.html` (new DOM elements)
- Modify: `js/hud.js` (new displays + threshold changes)

- [ ] **Step 1: Add new DOM elements to index.html**

In `index.html`, inside the `#hud` div, before the closing `</div>` of `#hud` (before line 242 `</div>`), add:

```html
  <div id="land-prompt" style="position:absolute;bottom:120px;left:50%;transform:translateX(-50%);
    font-size:18px;letter-spacing:6px;color:rgba(120,180,255,0.8);display:none;
    animation:pulse-land 2s ease-in-out infinite">PRESS F TO LAND</div>
  <div id="land-progress" style="position:absolute;right:30px;top:50%;transform:translateY(-50%);
    width:6px;height:120px;background:rgba(255,255,255,0.06);display:none;border-radius:3px;overflow:hidden">
    <div id="land-progress-fill" style="position:absolute;bottom:0;width:100%;height:0%;
      background:rgba(120,180,255,0.6);border-radius:3px;transition:height 0.1s"></div>
    <div id="land-progress-label" style="position:absolute;right:14px;top:50%;transform:translateY(-50%);
      font-size:9px;letter-spacing:2px;color:rgba(255,255,255,0.3);white-space:nowrap"></div>
  </div>
  <div id="speed-limit" style="display:none;font-size:11px;color:rgba(255,255,255,0.2);letter-spacing:1px"></div>
  <div id="terrain-lock" style="position:absolute;bottom:60px;left:50%;transform:translateX(-50%);
    font-size:10px;letter-spacing:4px;color:rgba(120,255,120,0.4);display:none">TERRAIN LOCK</div>
```

- [ ] **Step 2: Add CSS animation for land prompt pulse**

In the `<style>` section of `index.html`, add before the closing `</style>`:

```css
@keyframes pulse-land{0%,100%{opacity:0.6}50%{opacity:1}}
```

- [ ] **Step 3: Add F key to controls table**

In the overlay controls table in `index.html` (after the `H / Return Home` row, before `RIGHT-DRAG`), add:

```html
    <tr><td>F</td><td>Land (when near surface)</td></tr>
```

Also add to the `#ctrl-hint` div:

```html
    <span>F</span> LAND<br>
```

- [ ] **Step 4: Update hud.js — imports and cached elements**

Add imports at the top of `js/hud.js`:

```javascript
import { getAltMaxSpeed, isWarpAllowed, isFloorActive } from './flight.js';
import { getLandingState, getLandingProgress, LAND_STATE } from './landing.js';
```

Add to the element cache variables (after `surfacePressure`):

```javascript
let landPrompt, landProgress, landProgressFill, landProgressLabel, speedLimitEl, terrainLockEl;
```

Add to `initHud()`:

```javascript
  landPrompt         = document.getElementById('land-prompt');
  landProgress       = document.getElementById('land-progress');
  landProgressFill   = document.getElementById('land-progress-fill');
  landProgressLabel  = document.getElementById('land-progress-label');
  speedLimitEl       = document.getElementById('speed-limit');
  terrainLockEl      = document.getElementById('terrain-lock');
```

- [ ] **Step 5: Update hud.js — updateHud function additions**

At the end of the `updateHud` function (before the closing `}`), add:

```javascript
  /* 6. Landing HUD --------------------------------------------------- */
  const landState = getLandingState();

  // Land prompt
  if (landPrompt) {
    landPrompt.style.display = landState === LAND_STATE.READY ? 'block' : 'none';
  }

  // Landing progress
  const prog = getLandingProgress();
  if (landProgress) {
    if (prog) {
      landProgress.style.display = 'block';
      if (landProgressFill) landProgressFill.style.height = (prog.progress * 100) + '%';
      if (landProgressLabel) landProgressLabel.textContent = prog.phase;
    } else {
      landProgress.style.display = 'none';
    }
  }

  /* 7. Speed limit indicator ----------------------------------------- */
  const altMax = getAltMaxSpeed();
  if (speedLimitEl) {
    if (altMax > 0) {
      speedLimitEl.style.display = 'inline';
      speedLimitEl.textContent = ' / ' + Math.round(altMax);
    } else {
      speedLimitEl.style.display = 'none';
    }
  }

  /* 8. Terrain lock indicator ---------------------------------------- */
  if (terrainLockEl) {
    terrainLockEl.style.display = isFloorActive() ? 'block' : 'none';
  }

  /* 9. Warp disabled text -------------------------------------------- */
  const warpEl = document.getElementById('warp-active');
  if (warpEl) {
    if (!isWarpAllowed()) {
      warpEl.style.display = 'block';
      warpEl.textContent = '⚡ WARP DISABLED';
      warpEl.style.color = 'rgba(255,100,80,0.5)';
    }
    // Reset to normal warp display is handled by flight.js updateHUD
  }
```

- [ ] **Step 6: Change surface HUD threshold**

In the `updateHud` function, change the surface HUD condition from:

```javascript
  if (surfaceHud && alt.body && alt.altitudeNorm < 0.5 && !alt.isGasGiant) {
```

to:

```javascript
  if (surfaceHud && alt.body && alt.altitudeNorm < 0.3 && !alt.isGasGiant) {
```

- [ ] **Step 7: Position speed-limit element next to speed readout**

In `index.html`, modify the `#nav` div to include the speed-limit element inline. Move `speed-limit` to be inside the `#nav` div, right after `#speed-unit`:

Find:
```html
    <span id="speed-unit">U/S</span>
```

Replace with:
```html
    <span id="speed-unit">U/S</span><span id="speed-limit" style="display:none;font-size:11px;color:rgba(255,255,255,0.2);letter-spacing:1px"></span>
```

And remove the standalone `speed-limit` div that was added in Step 1 (it's now inline).

- [ ] **Step 8: Update flight.js warp HUD to reset properly**

In the `updateHUD` function inside `flight.js`, update the warp display logic:

```javascript
    if (elWarpActive) {
        if (warpActive) {
            elWarpActive.style.display = 'block';
            elWarpActive.textContent = '⚡ WARP';
            elWarpActive.style.color = 'rgba(255,180,80,0.75)';
        } else {
            // Don't hide if hud.js is showing "WARP DISABLED"
            const alt = getAltitude();
            if (!alt.body || alt.altitudeNorm >= 1.0 || alt.isGasGiant) {
                elWarpActive.style.display = 'none';
            }
        }
    }
```

- [ ] **Step 9: Test manually**

- Approach a planet — speed limit should appear next to speed readout (e.g. "45.2 / 80")
- Enter low-flight zone — "TERRAIN LOCK" should appear
- Slow down near surface — "PRESS F TO LAND" should pulse
- Press F — landing progress bar should appear with phase labels
- Warp near atmosphere — should show "WARP DISABLED"
- Surface HUD should only appear at `altitudeNorm < 0.3`

- [ ] **Step 10: Commit**

```bash
git add index.html js/hud.js js/flight.js
git commit -m "feat: landing HUD — speed limit, terrain lock, land prompt, progress bar"
```

---

### Task 6: Final Integration and Polish

**Files:**
- Modify: `js/main.js` (verify all imports)
- Modify: `js/flight.js` (verify no duplicate variable declarations)

- [ ] **Step 1: Verify main.js imports are complete**

The final import lines in `js/main.js` should be:

```javascript
import { initFlight, updateFlight, getCamPos, getSpeed, getVelocity, doHome, getAltMaxSpeed, isWarpAllowed, isFloorActive } from './flight.js';
import { getLandingState, LAND_STATE } from './landing.js';
```

If any are missing from earlier tasks, add them now.

- [ ] **Step 2: Verify no duplicate `alt` declarations in flight.js**

Search `flight.js` for `const alt = getAltitude()`. It should appear exactly once (in the speed limiting section). The landing mechanics section should use `const landAlt = getAltitude()`. Fix if there are duplicates.

- [ ] **Step 3: Full integration test**

Run the full experience and test the complete flow:

1. Start in space, warp toward Earth
2. Atmosphere entry flash and shake burst should fire
3. Speed gradually reduces as you enter atmosphere
4. "WARP DISABLED" appears, speed limit shows in HUD
5. Near surface, "TERRAIN LOCK" shows, ship rides above terrain
6. Slow down — "PRESS F TO LAND" appears
7. Press F — ship aligns, descends, settles with progress bar
8. Landed — press W to lift off
9. Fly away, exit atmosphere — exit flash fires
10. Test on Mars, Moon, Mercury (different sizes)
11. Fly toward Jupiter — speed cap applies but no floor/landing (gas giant)

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: NMS-style landing system — complete integration"
```
