import * as THREE from 'three';
import { AU } from './constants.js';
import { getAltitude } from './altitude.js';
import { setActivePlanet } from './navigation.js';
import { getLandmarks } from './deepspace.js';
import { isStarMapOpen } from './starmap.js';
import { setStarFieldOpacity, setSkyboxOpacity, setMilkyWayOpacity, BASE_FOV, GALACTIC_CENTER } from './engine.js';

// ── Warp state flag (read by music.js to avoid circular imports) ─────────────
window._isWarping = false;

// ── Constants ────────────────────────────────────────────────────────────────
const THRUST_ACCEL       = 12;      // gentler initial acceleration
const WARP_MULTIPLIER    = 40;
const LINEAR_DAMPING     = 0.06;    // stronger drag when coasting — stops faster
const THRUST_DAMPING     = 0.025;   // mild drag even while thrusting — prevents runaway
const ANGULAR_DAMPING    = 0.12;    // snappier rotation stops
const MAX_BASE_SPEED     = 600;
const MOUSE_SENS         = 0.0015;  // slightly less twitchy
const ROLL_ACCEL         = 1.2;
const GRAVITY_RANGE_MULT = 5;
const BH_GRAVITY_RANGE_MULT = 50;

// Angular-size speed limiting — creates awe on approach
const ANGULAR_SLOW_START  = 5;    // degrees — planet becomes noticeable, start slowing
const ANGULAR_SLOW_FULL   = 60;   // degrees — planet fills view, crawling speed
const ANGULAR_WARP_CUTOFF = 15;   // degrees — warp disabled
const MIN_APPROACH_SPEED  = 5;    // u/s — minimum speed near a body
// Effective radius floor used ONLY for angular-size approach-speed limiting.
// Real-world spacecraft in this scene have r=3..6 so at any reasonable viewing
// distance their true angular size stays near 0 and the braking never kicks
// in — you blow straight past them. Treating them as if they had a ~25-unit
// hitbox for approach purposes gives a braking zone ~4x their visual size,
// which makes small objects approachable without overshoot.
const MIN_APPROACH_RADIUS = 25;

// ── Home position / orientation ──────────────────────────────────────────────
const homePos  = new THREE.Vector3(0, 1500, 4000);
const homeQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.27, 0, 0));

// ── Reusable temp objects (avoid GC) ─────────────────────────────────────────
const _fwd   = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up    = new THREE.Vector3();
const _dir   = new THREE.Vector3();
const _qPitch = new THREE.Quaternion();
const _qYaw   = new THREE.Quaternion();
const _qRoll  = new THREE.Quaternion();
const _axisX  = new THREE.Vector3();
const _axisY  = new THREE.Vector3();
const _axisZ  = new THREE.Vector3();

// ── Flight state ─────────────────────────────────────────────────────────────
let cam = null;

const camPos  = new THREE.Vector3().copy(homePos);
const camQuat = new THREE.Quaternion().copy(homeQuat);
const velocity        = new THREE.Vector3(0, 0, 0);
const angularVelocity = new THREE.Vector3(0, 0, 0);

let boostEnergy = 1;
let warpActive  = false;

// Approach info (exported for HUD)
let _approachInfo = { angularSize: 0, maxSpeed: MAX_BASE_SPEED, bodyName: null, warpAllowed: true };

// Return-home animation state
let returning = false;
let retT      = 0;
const retFromP = new THREE.Vector3();
const retFromQ = new THREE.Quaternion();

// Fly-to autopilot state
let flyTarget = null; // { bodyRef, targetPos }
let flyT = 0;
let flyDuration = 0;
const flyFromP = new THREE.Vector3();
const flyFromQ = new THREE.Quaternion();
const flyTargetP = new THREE.Vector3();
const _lookMat = new THREE.Matrix4();
const _upVec = new THREE.Vector3(0, 1, 0);

// Warp travel state (interstellar journeys)
let warpTarget = null;
let warpT = 0;
let warpDuration = 0;
const warpFromP = new THREE.Vector3();
const warpFromQ = new THREE.Quaternion();
const warpTargetP = new THREE.Vector3();
let warpPhase = 'none'; // 'none' | 'accelerating' | 'cruising' | 'decelerating'
let _arrivalShown = false;

// Cinematic intro state — plays once on boot, skippable
let introActive = false;
let introPaused = false;   // held paused while the landing page is visible
let introT = 0;
let introDuration = 13;    // seconds
const introFromP = new THREE.Vector3();
const introFromQ = new THREE.Quaternion();
// The point we aim at during the paused/early-intro phase — offset from
// the galactic center to compose the galaxy off-center in the frame.
const introInitialLookAt = new THREE.Vector3();

// Orbit camera state
let orbitMode = false;
let orbitBody = null;
let orbitDistance = 0;
let orbitTheta = 0;
let orbitPhi = Math.PI / 3; // start 60 degrees from pole
let orbitTransition = false;
let orbitTransT = 0;
const orbitFromP = new THREE.Vector3();
const orbitFromQ = new THREE.Quaternion();

// Stored reference to allBodies for number key access
let _allBodies = null;

// Planet order for number keys
const PLANET_KEYS = ['SUN','MERCURY','VENUS','EARTH','MARS','JUPITER','SATURN','URANUS','NEPTUNE','PLUTO'];

// Input state
const keys = {};
let mouseDX = 0;
let mouseDY = 0;
let rightDown = false;

// Touch state
let touchId  = null;
let touchX   = 0;
let touchY   = 0;

// HUD elements (cached)
let elBoostFill = null;
let elWarpActive = null;
let elHomeBtn   = null;

// ── Helpers ──────────────────────────────────────────────────────────────────

function getForward(q) {
    return _fwd.set(0, 0, -1).applyQuaternion(q);
}
function getRight(q) {
    return _right.set(1, 0, 0).applyQuaternion(q);
}
function getUp(q) {
    return _up.set(0, 1, 0).applyQuaternion(q);
}

function easeInOutQuad(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function smoothstep(edge0, edge1, x) {
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
}

// ── initFlight ───────────────────────────────────────────────────────────────

export function initFlight(camera) {
    cam = camera;

    // Cache HUD elements
    elBoostFill  = document.getElementById('boost-fill');
    elWarpActive = document.getElementById('warp-active');
    elHomeBtn    = document.getElementById('home-btn');

    // Wire up home button click
    if (elHomeBtn) {
      elHomeBtn.addEventListener('click', doHome);
    }

    const canvas = document.getElementById('c');

    // ── Keyboard ─────────────────────────────────────────────────────────────
    window.addEventListener('keydown', (e) => {
        keys[e.code] = true;

        if (e.code === 'Space' || e.code.startsWith('Arrow')) {
            e.preventDefault();
        }

        if (e.code === 'KeyH') doHome();
        if (e.code === 'KeyO') toggleOrbit();
        if (e.code === 'KeyI') {
          const h = document.getElementById('ctrl-hint');
          if (h) {
            const vis = h.style.opacity !== '0';
            h.style.opacity = vis ? '0' : '1';
            h.style.pointerEvents = vis ? 'none' : 'auto';
          }
        }

        // Number keys 1-9,0 for fly-to planets (1=Mercury...9=Pluto, 0=Sun)
        if (e.code.match(/^Digit\d$/) && _allBodies) {
          const digit = parseInt(e.code.charAt(5));
          const name = PLANET_KEYS[digit];
          if (name) {
            flyTo(name);
            e.preventDefault();
          }
        }
    });

    window.addEventListener('keyup', (e) => {
        keys[e.code] = false;
    });

    // ── Mouse ────────────────────────────────────────────────────────────────
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    canvas.addEventListener('mousedown', (e) => {
        if (e.button === 2) {
            rightDown = true;
            canvas.style.cursor = 'none';
        }
        canvas.focus();
    });

    window.addEventListener('mouseup', (e) => {
        if (e.button === 2) {
            rightDown = false;
            canvas.style.cursor = '';
        }
    });

    window.addEventListener('mousemove', (e) => {
        if (rightDown) {
            mouseDX += e.movementX;
            mouseDY += e.movementY;
        }
    });

    // ── Touch ────────────────────────────────────────────────────────────────
    canvas.addEventListener('touchstart', (e) => {
        e.preventDefault();
        if (touchId === null && e.changedTouches.length > 0) {
            const t = e.changedTouches[0];
            touchId = t.identifier;
            touchX  = t.clientX;
            touchY  = t.clientY;
        }
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
        e.preventDefault();
        for (let i = 0; i < e.changedTouches.length; i++) {
            const t = e.changedTouches[i];
            if (t.identifier === touchId) {
                mouseDX += t.clientX - touchX;
                mouseDY += t.clientY - touchY;
                touchX = t.clientX;
                touchY = t.clientY;
            }
        }
    }, { passive: false });

    canvas.addEventListener('touchend', (e) => {
        for (let i = 0; i < e.changedTouches.length; i++) {
            if (e.changedTouches[i].identifier === touchId) {
                touchId = null;
            }
        }
    });

    camera.quaternion.copy(camQuat);

    return {
        camPos, camQuat, velocity, angularVelocity, boostEnergy, warpActive,
    };
}

// ── updateFlight ─────────────────────────────────────────────────────────────

export function updateFlight(dt, allBodies) {
    if (!cam) return;
    if (isStarMapOpen()) return; // freeze flight when map is open

    // Store reference for number key fly-to
    _allBodies = allBodies;

    // ── 0. Cinematic intro (plays once on boot) ─────────────────────────────
    if (introActive) {
        // While paused (landing page showing), hold camera at start pose and
        // render the scene — we want the Milky Way visible behind the hero UI.
        if (introPaused) {
            camPos.copy(introFromP);
            cam.quaternion.copy(camQuat);
            updateHUD();
            return;
        }
        // The intro plays through to completion — no skip. Input during
        // the cinematic is ignored so the user can't shortcut the journey.
        {
            introT += dt / introDuration;
            if (introT >= 1) {
                endIntro();
            } else {
                // ease-in-out cubic — slow at both ends, fast through the
                // middle. Previously ease-out-cubic started at max speed
                // and made the zoom look jerky.
                const p = introT;
                const ease = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
                camPos.lerpVectors(introFromP, homePos, ease);

                // Crossfade between the 3D particle galaxy (which reads as a
                // distinct spiral object when seen from outside) and the
                // equirectangular skybox (which reads as the Milky Way band
                // we see from inside, near Earth). Early: 3D galaxy dominates.
                // Late: skybox carries the "inside the Milky Way" view.
                const SKYBOX_PEAK = 0.9;
                setSkyboxOpacity(Math.max(0.05, Math.min(SKYBOX_PEAK, ease * SKYBOX_PEAK * 1.1)));
                // Galaxy particles fade over the last 40% of the journey so
                // at arrival they're essentially invisible — the skybox is
                // the Milky Way from here on.
                const mwFade = 1 - Math.max(0, Math.min(1, (ease - 0.6) / 0.4));
                setMilkyWayOpacity(mwFade);

                // Look target lerps from the composed landing-page aim
                // (just off the galactic core) to the Sun at origin. Easing
                // is ease-in-cubic so we linger on the galaxy early and
                // swing toward the Sun in the final third.
                const lookShift = p * p; // slow shift early, fast late
                const lookTarget = new THREE.Vector3().lerpVectors(
                  introInitialLookAt,
                  new THREE.Vector3(0, 0, 0),
                  lookShift
                );
                _lookMat.lookAt(camPos, lookTarget, _upVec);
                const aimQuat = new THREE.Quaternion().setFromRotationMatrix(_lookMat);
                // Slerp toward final home orientation in the last 25% so we land cleanly
                if (p > 0.75) {
                    const blend = (p - 0.75) / 0.25;
                    const smooth = blend * blend * (3 - 2 * blend);
                    aimQuat.slerp(homeQuat, smooth);
                }
                camQuat.copy(aimQuat);
                cam.quaternion.copy(camQuat);

                // FOV: widens through middle, settles at base by end
                const fovCurve = Math.sin(p * Math.PI); // 0→1→0
                cam.fov = BASE_FOV + fovCurve * 18;
                cam.updateProjectionMatrix();

                // Warp streaks for sense of motion (peak in middle)
                const streakEl = document.getElementById('warp-streaks');
                if (streakEl) streakEl.style.opacity = fovCurve * 0.55;

                // "Fly through" the title — reuse the hero's #hero-title
                // element so there's a single continuous "solace" word
                // from landing page all the way through the intro. It
                // scales up as the camera accelerates, giving the sense
                // that the letters are racing past.
                const titleEl = document.getElementById('hero-title');
                if (titleEl) {
                    // Phase 1 (p: 0.00 → 0.08): hold at scale 1 briefly
                    // Phase 2 (p: 0.08 → 0.30): scale 1 → 8, fade to 0
                    // Phase 3 (p > 0.30): kill it
                    if (p < 0.08) {
                        titleEl.style.opacity = '1';
                        titleEl.style.transform = 'translate(-50%,-50%) scale(1)';
                    } else if (p < 0.30) {
                        const t = (p - 0.08) / 0.22;     // 0 → 1
                        const scale = 1 + t * 7;          // 1 → 8
                        // Accelerating fade — holds briefly then drops fast
                        const alpha = Math.max(0, 1 - t * t * 1.1);
                        titleEl.style.opacity = alpha.toFixed(3);
                        titleEl.style.transform = `translate(-50%,-50%) scale(${scale.toFixed(2)})`;
                    } else {
                        titleEl.style.opacity = '0';
                        // Remove once fully invisible so it can't block anything
                        if (titleEl.parentNode && !titleEl.dataset.removed) {
                            titleEl.dataset.removed = '1';
                            setTimeout(() => {
                                if (titleEl.parentNode) titleEl.parentNode.removeChild(titleEl);
                            }, 200);
                        }
                    }
                }

                updateHUD();
                return;
            }
        }
    }

    // ── 1w. Warp travel (interstellar journeys) ─────────────────────────────
    if (warpTarget) {
        warpT += dt / warpDuration;

        // Allow cancel on WASD input after initial acceleration
        if (warpT > 0.1) {
            const anyMove = keys['KeyW'] || keys['KeyS'] || keys['KeyA'] || keys['KeyD'];
            if (anyMove) {
                // Cancel warp — reset FOV, streaks, and vignette
                cam.fov = BASE_FOV;
                cam.updateProjectionMatrix();
                const streakEl = document.getElementById('warp-streaks');
                if (streakEl) streakEl.style.opacity = 0;
                const vignetteCancel = document.getElementById('warp-vignette');
                if (vignetteCancel) vignetteCancel.style.opacity = 0;
                warpTarget = null;
                warpPhase = 'none';
                window._isWarping = false;
                setStarFieldOpacity(1.0); // restore stars on cancel
                updateHUD();
                // Fall through to normal flight
            }
        }

        if (warpTarget) {
            // Three-phase easing
            let eased;
            let speedFeeling;
            if (warpT < 0.15) {
                // Accelerating: quadratic ease-in (0-15%)
                const p = warpT / 0.15;
                eased = 0.15 * (p * p);
                speedFeeling = p * p;
                warpPhase = 'accelerating';
            } else if (warpT < 0.85) {
                // Cruising: linear (15-85%)
                const p = (warpT - 0.15) / 0.70;
                eased = 0.15 + 0.70 * p;
                speedFeeling = 1.0;
                warpPhase = 'cruising';
            } else {
                // Decelerating: quadratic ease-out (85-100%)
                const p = (warpT - 0.85) / 0.15;
                eased = 0.85 + 0.15 * (1 - (1 - p) * (1 - p));
                speedFeeling = (1 - p) * (1 - p);
                warpPhase = 'decelerating';
            }

            // Interpolate position
            camPos.lerpVectors(warpFromP, warpTargetP, Math.min(eased, 1));

            // Look toward destination — snap quickly
            _lookMat.lookAt(camPos, warpTargetP, _upVec);
            const targetQuat = new THREE.Quaternion().setFromRotationMatrix(_lookMat);
            camQuat.slerpQuaternions(warpFromQ, targetQuat, Math.min(warpT * 5, 1));
            cam.quaternion.copy(camQuat);

            // Speed feeling: FOV, warp streaks, vignette, and star fade
            cam.fov = BASE_FOV + speedFeeling * 40;
            cam.updateProjectionMatrix();
            const streakEl = document.getElementById('warp-streaks');
            if (streakEl) streakEl.style.opacity = speedFeeling * 1.0;
            const vignetteEl = document.getElementById('warp-vignette');
            if (vignetteEl) vignetteEl.style.opacity = (warpPhase === 'cruising') ? 0.7 : speedFeeling * 0.5;

            // Star fade during warp — keep a faint layer visible so that
            // camera-relative motion against the near-star field gives a real
            // sense of moving through space. Full blackness during cruise
            // made the warp look like a static loading screen.
            const CRUISE_STAR_OPACITY = 0.22;
            if (warpPhase === 'accelerating') {
              setStarFieldOpacity(1.0 - speedFeeling * (1.0 - CRUISE_STAR_OPACITY));
            } else if (warpPhase === 'cruising') {
              setStarFieldOpacity(CRUISE_STAR_OPACITY);
            } else {
              // Decelerating — fade stars back in as we slow down
              setStarFieldOpacity(CRUISE_STAR_OPACITY + (1.0 - CRUISE_STAR_OPACITY) * (1.0 - speedFeeling));
            }

            // Arrival notification disabled — the bottom-left info card
            // (hud.js) already shows the name and description on proximity,
            // and two cards at once felt like duplicate UI.

            // Complete at 100%
            if (warpT >= 1) {
                camPos.copy(warpTargetP);
                cam.fov = BASE_FOV;
                cam.updateProjectionMatrix();
                if (streakEl) streakEl.style.opacity = 0;
                if (vignetteEl) vignetteEl.style.opacity = 0;
                warpTarget = null;
                warpPhase = 'none';
                window._isWarping = false;
                velocity.set(0, 0, 0);
                angularVelocity.set(0, 0, 0);
            }

            updateHUD();
            return;
        }
    }

    // ── 1a. Fly-to autopilot ─────────────────────────────────────────────────
    if (flyTarget) {
        flyT += dt / flyDuration;
        if (flyT >= 1) {
            flyT = 1;
            // Auto-enter orbit mode on arrival
            const arrivedBody = flyTarget.bodyRef;
            flyTarget = null;
            orbitBody = arrivedBody;
            orbitDistance = arrivedBody.r * 4.5;
            orbitMode = true;
            const bodyPos = arrivedBody.g.userData._worldPos || arrivedBody.g.position;
            const offset = camPos.clone().sub(bodyPos);
            const d = offset.length();
            orbitTheta = Math.atan2(offset.z, offset.x);
            orbitPhi = Math.acos(Math.max(-1, Math.min(1, offset.y / d)));
            orbitTransition = false;
            velocity.set(0, 0, 0);
            angularVelocity.set(0, 0, 0);
            updateHUD();
            return;
        }
        const ease = easeInOutQuad(Math.min(flyT, 1));
        // Use locked target position (set at start of fly-to)
        const bodyPos = flyTarget.bodyRef.g.userData._worldPos || flyTarget.bodyRef.g.position;

        // Interpolate position
        camPos.lerpVectors(flyFromP, flyTargetP, ease);

        // Camera orientation: start with original, quickly rotate to face destination,
        // end looking at the body
        _lookMat.lookAt(camPos, bodyPos, _upVec);
        const targetQuat = new THREE.Quaternion().setFromRotationMatrix(_lookMat);
        camQuat.slerpQuaternions(flyFromQ, targetQuat, Math.min(ease * 2.0, 1.0));
        cam.quaternion.copy(camQuat);

        // Speed feeling during fly-to — strongest at midpoint
        const flySpeed = Math.sin(flyT * Math.PI); // 0 at start/end, 1 at midpoint
        cam.fov = BASE_FOV + flySpeed * 25;
        cam.updateProjectionMatrix();
        const streakEl = document.getElementById('warp-streaks');
        if (streakEl) streakEl.style.opacity = flySpeed * 0.7;

        updateHUD();
        return;
    }

    // ── 1b. Orbit camera mode ────────────────────────────────────────────────
    if (orbitMode && orbitBody) {
        // Any movement input breaks orbit
        if (keys['KeyW'] || keys['KeyS'] || keys['KeyA'] || keys['KeyD'] ||
            keys['ArrowUp'] || keys['ArrowDown'] || keys['ArrowLeft'] || keys['ArrowRight'] ||
            keys['Space'] || keys['KeyC'] || keys['KeyQ'] || keys['KeyE']) {
            orbitMode = false;
            orbitBody = null;
        }
    }
    if (orbitMode && orbitBody) {
        const bodyPos = orbitBody.g.userData._worldPos || orbitBody.g.position;

        // Smooth transition into orbit
        if (orbitTransition) {
            orbitTransT += dt * 1.5;
            if (orbitTransT >= 1) { orbitTransT = 1; orbitTransition = false; }
        }

        // Mouse adjusts orbit angles (always, not just right-click in orbit mode)
        orbitTheta += mouseDX * 0.003;
        orbitPhi -= mouseDY * 0.003;
        orbitPhi = Math.max(0.15, Math.min(Math.PI - 0.15, orbitPhi));
        mouseDX = 0;
        mouseDY = 0;

        // W/S zoom in/out
        if (keys['KeyW'] || keys['ArrowUp'])    orbitDistance = Math.max(orbitBody.r * 1.5, orbitDistance - orbitBody.r * 2 * dt);
        if (keys['KeyS'] || keys['ArrowDown'])  orbitDistance += orbitBody.r * 2 * dt;

        // Auto-rotation — slow cinematic drift, ~45 seconds per full orbit
        orbitTheta += dt * 0.14;

        // Compute orbit position
        const x = orbitDistance * Math.sin(orbitPhi) * Math.cos(orbitTheta);
        const y = orbitDistance * Math.cos(orbitPhi);
        const z = orbitDistance * Math.sin(orbitPhi) * Math.sin(orbitTheta);
        const orbitPos = bodyPos.clone().add(new THREE.Vector3(x, y, z));

        // Look at body
        _lookMat.lookAt(orbitPos, bodyPos, _upVec);
        const orbitQuat = new THREE.Quaternion().setFromRotationMatrix(_lookMat);

        if (orbitTransition) {
            const ease = easeInOutQuad(orbitTransT);
            camPos.lerpVectors(orbitFromP, orbitPos, ease);
            camQuat.slerpQuaternions(orbitFromQ, orbitQuat, ease);
        } else {
            camPos.copy(orbitPos);
            camQuat.copy(orbitQuat);
        }

        cam.quaternion.copy(camQuat);
        velocity.set(0, 0, 0);
        angularVelocity.set(0, 0, 0);
        // Reset FOV and speed lines in orbit mode
        cam.fov += (BASE_FOV - cam.fov) * 0.1;
        cam.updateProjectionMatrix();
        const streakEl2 = document.getElementById('warp-streaks');
        if (streakEl2) streakEl2.style.opacity = 0;
        updateHUD();
        return;
    }

    // ── 1c. Return-home animation ────────────────────────────────────────────
    if (returning) {
        retT += dt * 0.5;
        if (retT >= 1) {
            retT = 1;
            returning = false;
        }
        const ease = easeInOutQuad(Math.min(retT, 1));
        camPos.lerpVectors(retFromP, homePos, ease);
        camQuat.slerpQuaternions(retFromQ, homeQuat, ease);
        cam.quaternion.copy(camQuat);
        updateHUD();
        return;
    }

    // Cancel fly-to on manual input
    if (flyTarget) {
      const anyKey = keys['KeyW'] || keys['KeyS'] || keys['KeyA'] || keys['KeyD'] || keys['Space'] || keys['KeyC'];
      if (anyKey || (rightDown && (mouseDX !== 0 || mouseDY !== 0))) {
        flyTarget = null;
      }
    }

    // ── 2. Angular momentum from mouse ───────────────────────────────────────
    angularVelocity.x += mouseDY * MOUSE_SENS;
    angularVelocity.y += -mouseDX * MOUSE_SENS;
    mouseDX = 0;
    mouseDY = 0;

    // ── 3. Roll from Q/E ─────────────────────────────────────────────────────
    if (keys['KeyQ'])  angularVelocity.z += ROLL_ACCEL * dt;
    if (keys['KeyE'])  angularVelocity.z -= ROLL_ACCEL * dt;

    // ── 4. Apply angular velocity to quaternion ──────────────────────────────
    _axisX.set(1, 0, 0).applyQuaternion(camQuat);
    _axisY.set(0, 1, 0).applyQuaternion(camQuat);
    _axisZ.set(0, 0, 1).applyQuaternion(camQuat);

    _qPitch.setFromAxisAngle(_axisX, angularVelocity.x);
    _qYaw.setFromAxisAngle(_axisY, angularVelocity.y);
    _qRoll.setFromAxisAngle(_axisZ, angularVelocity.z);

    camQuat.premultiply(_qPitch);
    camQuat.premultiply(_qYaw);
    camQuat.premultiply(_qRoll);
    camQuat.normalize();

    // ── 5. Dampen angular velocity ───────────────────────────────────────────
    angularVelocity.multiplyScalar(1 - ANGULAR_DAMPING);

    // ── 6. Angular-size speed limiting ───────────────────────────────────────
    // Compute the apparent angular size of the nearest body. When it looks
    // big on screen, force the player to slow down — this creates the sense
    // of scale and makes overshooting impossible.
    let angularDeg = 0;
    let approachMaxSpeed = MAX_BASE_SPEED;
    let warpAllowed = true;
    let approachBody = null;

    if (allBodies) {
      for (let i = 0; i < allBodies.length; i++) {
        const body = allBodies[i];
        if (!body.g || !body.r) continue;
        // Skip the Sun — its huge radius would brake us any time we're in the
        // solar system. Everything else (planets, moons, spacecraft) gets
        // approach-speed limiting. Small bodies use an inflated effective
        // radius so the braking zone is meaningful at typical viewing dists.
        if (body.name === 'SUN') continue;
        const bodyPos = body.g.userData._worldPos || body.g.position;
        const dist = camPos.distanceTo(bodyPos);
        const effR = Math.max(body.r, MIN_APPROACH_RADIUS);
        const angDeg = 2 * Math.atan(effR / Math.max(dist, 0.001)) * (180 / Math.PI);
        if (angDeg > angularDeg) {
          angularDeg = angDeg;
          approachBody = body;
        }
      }
    }

    if (angularDeg > ANGULAR_SLOW_START) {
      const t = smoothstep(ANGULAR_SLOW_START, ANGULAR_SLOW_FULL, angularDeg);
      approachMaxSpeed = MAX_BASE_SPEED * (1 - t) + MIN_APPROACH_SPEED * t;
      if (angularDeg > ANGULAR_WARP_CUTOFF) warpAllowed = false;
    }

    _approachInfo.angularSize = angularDeg;
    _approachInfo.maxSpeed = approachMaxSpeed;
    _approachInfo.bodyName = approachBody ? approachBody.name : null;
    _approachInfo.warpAllowed = warpAllowed;

    // ── 7. Warp drive ────────────────────────────────────────────────────────
    const shiftHeld = keys['ShiftLeft'] || keys['ShiftRight'];
    if (shiftHeld && warpAllowed) {
        boostEnergy -= dt * 0.2;
    } else {
        boostEnergy += dt * 0.125;
    }
    boostEnergy = Math.max(0, Math.min(1, boostEnergy));

    warpActive = shiftHeld && boostEnergy > 0 && warpAllowed;
    const warpMult   = warpActive ? WARP_MULTIPLIER : 1;
    const maxSpeed    = approachMaxSpeed * warpMult;
    // Thrust is ALWAYS full power — only max speed is capped, not your ability to accelerate/escape
    const thrustAccel = THRUST_ACCEL * warpMult;

    // ── 8. Thrust acceleration ───────────────────────────────────────────────
    const fwd   = getForward(camQuat);
    const right = getRight(camQuat);
    const up    = getUp(camQuat);

    let thrusting = false;

    if (keys['KeyW'] || keys['ArrowUp'])    { velocity.addScaledVector(fwd, thrustAccel * dt); thrusting = true; }
    if (keys['KeyS'] || keys['ArrowDown'])  { velocity.addScaledVector(fwd, -thrustAccel * dt); thrusting = true; }
    if (keys['KeyA'] || keys['ArrowLeft'])  { velocity.addScaledVector(right, -thrustAccel * dt); thrusting = true; }
    if (keys['KeyD'] || keys['ArrowRight']) { velocity.addScaledVector(right, thrustAccel * dt); thrusting = true; }
    if (keys['Space']) { velocity.addScaledVector(up, thrustAccel * dt); thrusting = true; }
    if (keys['KeyC'])  { velocity.addScaledVector(up, -thrustAccel * dt); thrusting = true; }

    // ── 9. Black hole gravity only ──────────────────────────────────────────
    const alt = getAltitude();
    if (allBodies) {
        for (let i = 0; i < allBodies.length; i++) {
            const body = allBodies[i];
            if (!body.isBlackHole) continue;
            const gravRange = body.r * BH_GRAVITY_RANGE_MULT;
            const bodyPos = (body.g && body.g.userData._worldPos) || (body.g ? body.g.position : body.position);
            if (!bodyPos) continue;
            _dir.copy(bodyPos).sub(camPos);
            const dist = _dir.length();
            if (dist < gravRange && dist > body.r * 1.1) {
                _dir.normalize();
                const pull = 80 * body.r * body.r / (dist * dist);
                velocity.addScaledVector(_dir, Math.min(pull, 5) * dt);
            }
        }
    }

    // ── 10. Linear dampening ───────────────────────────────────────────────
    // Always apply some drag — stronger when coasting, mild when thrusting.
    if (thrusting) {
        velocity.multiplyScalar(1 - THRUST_DAMPING);
    } else {
        const curSpeed = velocity.length();
        const speedFactor = 1 + Math.min(curSpeed / MAX_BASE_SPEED, 1) * 0.08;
        velocity.multiplyScalar(1 - LINEAR_DAMPING * speedFactor);
    }

    // ── 11. Speed cap ────────────────────────────────────────────────────────
    const speed = velocity.length();
    if (speed > maxSpeed) {
        const overspeedRatio = Math.min((speed - maxSpeed) / maxSpeed, 1);
        const dragDamp = 0.035 + overspeedRatio * 0.15;
        velocity.multiplyScalar(1 - dragDamp);
    }

    // ── 12. Surface collision — planets only, not spacecraft ───────────────
    if (alt.body && alt.altitude < 1 && alt.nearestBody !== 'SUN' && alt.bodyRadius > 8) {
        const bodyPos = alt.body.g.userData._worldPos || alt.body.g.position;
        const outward = _dir.copy(camPos).sub(bodyPos).normalize();
        // Push out to just above surface
        camPos.copy(bodyPos).addScaledVector(outward, alt.bodyRadius + 2);
        // Kill inward velocity, keep tangential
        const inwardSpeed = velocity.dot(outward);
        if (inwardSpeed < 0) {
            velocity.addScaledVector(outward, -inwardSpeed);
        }
    }

    // ── 13. Apply velocity to position ───────────────────────────────────────
    camPos.addScaledVector(velocity, dt * 60);

    // ── 14. Speed feeling — FOV widen + speed lines ────────────────────────
    {
      const spd = velocity.length();
      const speedRatio = Math.min(spd / MAX_BASE_SPEED, 3); // 0-3 range
      // FOV: BASE at rest, widen up to +8 at max normal speed (warp adds more)
      const targetFov = BASE_FOV + speedRatio * 8;
      cam.fov += (targetFov - cam.fov) * 0.05; // smooth lerp
      cam.updateProjectionMatrix();

      // Speed lines overlay
      const streakEl = document.getElementById('warp-streaks');
      if (streakEl) {
        const lineOpacity = Math.max(0, (speedRatio - 0.3) / 2.7); // fade in above 30% speed
        streakEl.style.opacity = lineOpacity * 0.6;
      }
    }

    // ── 15. Update camera ────────────────────────────────────────────────────
    cam.quaternion.copy(camQuat);

    // ── 16. Update HUD ───────────────────────────────────────────────────────
    updateHUD();
}

// ── HUD update helper ────────────────────────────────────────────────────────

function updateHUD() {
    if (elBoostFill) {
        elBoostFill.style.width = (boostEnergy * 100) + '%';
    }
    if (elWarpActive) {
        elWarpActive.style.display = warpActive ? 'block' : 'none';
    }
    // Home button removed from UI — control hints cover it
    const orbitEl = document.getElementById('orbit-indicator');
    if (orbitEl) {
        orbitEl.style.display = orbitMode ? 'block' : 'none';
    }
}

// ── doHome ───────────────────────────────────────────────────────────────────

export function doHome() {
    // Cancel any active fly-to or orbit mode
    flyTarget = null;
    orbitMode = false;
    orbitBody = null;

    const alt = getAltitude();

    if (alt && alt.body && alt.altitudeNorm < 2) {
      const surfaceNormal = camPos.clone().sub(alt.body.g.position).normalize();
      velocity.copy(surfaceNormal).multiplyScalar(80);

      setTimeout(() => {
        retFromP.copy(camPos);
        retFromQ.copy(camQuat);
        returning = true;
        retT = 0;
        velocity.set(0, 0, 0);
        angularVelocity.set(0, 0, 0);
      }, 2000);
    } else {
      retFromP.copy(camPos);
      retFromQ.copy(camQuat);
      returning = true;
      retT = 0;
      velocity.set(0, 0, 0);
      angularVelocity.set(0, 0, 0);
    }

    if (elHomeBtn) elHomeBtn.style.display = 'none';
}

// ── flyTo ────────────────────────────────────────────────────────────────────

export function flyTo(bodyName) {
    if (!_allBodies) return;
    const body = _allBodies.find(b => b.name === bodyName);
    if (!body) return;

    // Cancel orbit mode if active
    orbitMode = false;
    orbitBody = null;
    returning = false;

    const bodyPos = body.g.userData._worldPos || body.g.position;
    const dist = camPos.distanceTo(bodyPos);

    // Approach from the sunward side (sun is at origin) so the lit face is visible
    const sunDir = new THREE.Vector3().copy(bodyPos).negate().normalize();
    // Offset slightly upward for a cinematic angle
    sunDir.y += 0.3;
    sunDir.normalize();
    // Distance: further for large bodies so they frame nicely
    const arrivalDist = body.r * 4.5;
    flyTargetP.copy(bodyPos).addScaledVector(sunDir, arrivalDist);

    flyFromP.copy(camPos);
    flyFromQ.copy(camQuat);
    flyTarget = { bodyRef: body };
    flyT = 0;
    setActivePlanet(bodyName);
    // Duration based on distance: 2-6 seconds
    flyDuration = Math.max(2, Math.min(6, dist / 6000));
    velocity.set(0, 0, 0);
    angularVelocity.set(0, 0, 0);
}

export function isFlyingTo() { return !!flyTarget; }

// ── Cinematic intro ─────────────────────────────────────────────────────
// Fly in from far outside the Milky Way disk to the home position.
// Called once at boot; skippable with any input.
/**
 * Stage the camera for the intro, optionally paused for a landing page.
 * @param {{paused?:boolean}} [opts]
 */
export function startIntro(opts = {}) {
  // Start position: well outside the Milky Way disk (~620k units radius),
  // offset from the galactic center so we see the spiral structure from
  // above/side. The start is expressed relative to the galactic center so
  // that even though the Sun is at world origin, the intro frames the
  // galaxy itself, not the Sun.
  introFromP.copy(GALACTIC_CENTER).add(new THREE.Vector3(1500000, 700000, 1200000));
  introFromQ.copy(camQuat);
  camPos.copy(introFromP);

  // Compose the landing shot: aim a little BELOW the galactic center so
  // the galaxy floats in the lower half of the frame, leaving a calm
  // dark area above for the title. Looking-down-at-the-galaxy vibe.
  introInitialLookAt.copy(GALACTIC_CENTER).add(
    new THREE.Vector3(0, -350000, 0)
  );
  _lookMat.lookAt(camPos, introInitialLookAt, _upVec);
  camQuat.setFromRotationMatrix(_lookMat);
  if (cam) cam.quaternion.copy(camQuat);

  introT = 0;
  introActive = true;
  introPaused = !!opts.paused;
  velocity.set(0, 0, 0);
  angularVelocity.set(0, 0, 0);

  // Fade skybox hard — we're outside the galaxy, an inside-view starmap
  // wrapping the camera would drown out the 3D Milky Way. Also reset the
  // 3D galaxy to full opacity in case a previous run faded it.
  setSkyboxOpacity(0.05);
  setMilkyWayOpacity(1.0);

  // Hide HUD (carousel etc.) — it reappears at the end of the cinematic
  const hudEl = document.getElementById('hud');
  if (hudEl) {
    hudEl.style.transition = 'opacity 1.2s';
    hudEl.style.opacity = '0';
  }

  // The floating in-world title card is only used when the intro plays
  // without a landing page (e.g. if startIntro is called without paused).
  if (!introPaused) {
    showIntroTitleCard();
  }
}

/**
 * Unpause a paused intro (called when the hero page is dismissed).
 * The existing #hero-title element carries over into the intro — no
 * separate in-world title is created. It gets scaled + faded during
 * the fly-through so the user literally floats through the word.
 */
export function beginIntroAnimation() {
  if (!introActive) return;
  introPaused = false;
  // Kill the CSS opacity transition on the hero title — during the
  // fly-through we update opacity every frame and any CSS transition
  // lag would desync it from the camera's acceleration.
  const titleEl = document.getElementById('hero-title');
  if (titleEl) titleEl.style.transition = 'none';
}

function endIntro() {
  introActive = false;
  // Snap cleanly to home
  camPos.copy(homePos);
  camQuat.copy(homeQuat);
  if (cam) {
    cam.quaternion.copy(camQuat);
    cam.fov = BASE_FOV;
    cam.updateProjectionMatrix();
  }
  // Now that we're inside the Milky Way, the equirectangular starmap is
  // the correct "view from Earth" Milky Way band. Restore skybox fully and
  // hide the 3D particle galaxy — it was a prop for the outside-view
  // intro, not meant to be seen from within the solar system.
  setSkyboxOpacity(0.9);
  setMilkyWayOpacity(0.0);
  const streakEl = document.getElementById('warp-streaks');
  if (streakEl) streakEl.style.opacity = 0;
  const titleEl = document.getElementById('intro-title');
  if (titleEl) {
    titleEl.style.opacity = '0';
    setTimeout(() => { if (titleEl.parentNode) titleEl.parentNode.removeChild(titleEl); }, 1500);
  }
  // Fade HUD back in
  const hudEl = document.getElementById('hud');
  if (hudEl) {
    hudEl.style.transition = 'opacity 1.2s';
    hudEl.style.opacity = '1';
  }
  velocity.set(0, 0, 0);
  angularVelocity.set(0, 0, 0);
}

export function isIntroPlaying() { return introActive; }

// ── Arrival notification ────────────────────────────────────────────────

function showArrivalNotification(name, desc) {
  if (_arrivalShown) return;
  _arrivalShown = true;
  let el = document.getElementById('arrival-notification');
  if (!el) {
    el = document.createElement('div');
    el.id = 'arrival-notification';
    el.style.cssText = 'position:fixed;top:15%;left:50%;transform:translateX(-50%);font-family:"Segoe UI",sans-serif;text-align:center;z-index:50;pointer-events:none;opacity:0;transition:opacity 2s;';
    document.body.appendChild(el);
  }
  el.innerHTML = '<div style="font-size:9px;letter-spacing:6px;color:rgba(140,180,255,0.5);margin-bottom:8px">ENTERING</div>' +
    '<div style="font-size:22px;letter-spacing:4px;color:rgba(255,255,255,0.9);font-weight:100;margin-bottom:6px">' + name + '</div>' +
    '<div style="font-size:10px;letter-spacing:1px;color:rgba(255,255,255,0.35);max-width:400px;line-height:1.8">' + desc + '</div>';
  el.style.opacity = '1';
  setTimeout(() => { el.style.opacity = '0'; _arrivalShown = false; }, 6000);
}

// ── warpTo (interstellar travel) ────────────────────────────────────────

export function warpTo(targetName) {
  const allLandmarks = getLandmarks();
  const landmark = allLandmarks.find(lm => lm.name === targetName);

  if (!landmark) {
    // Fall back to regular fly-to for solar system bodies
    flyTo(targetName);
    return;
  }

  // Cancel any active orbit/fly-to/return modes
  orbitMode = false;
  orbitBody = null;
  flyTarget = null;
  returning = false;

  // Set warp origin
  warpFromP.copy(camPos);
  warpFromQ.copy(camQuat);

  // Compute target position: arrive close to the landmark center.
  // For voids, arrive offset from center (not dead-center) so the player
  // sees the near shell wall behind them and looks across the void at the
  // far wall — gives depth and scale. For everything else, stop short so
  // the object frames nicely.
  const approachDir = new THREE.Vector3().copy(landmark.pos).sub(camPos).normalize();
  const arrivalOffset = landmark.visualType === 'void'
    ? landmark.radius * 1.0   // inside the void, ~halfway between near wall and center
    : landmark.radius * 0.5;
  warpTargetP.copy(landmark.pos).addScaledVector(approachDir, -arrivalOffset);

  // Duration: 15-30 seconds based on distance
  const dist = camPos.distanceTo(landmark.pos);
  warpDuration = Math.max(15, Math.min(30, dist / 2000));

  // Set warp target
  warpTarget = { name: landmark.name, desc: landmark.desc, pos: landmark.pos };
  warpT = 0;
  warpPhase = 'accelerating';
  _arrivalShown = false;
  window._isWarping = true;

  // Clear velocity
  velocity.set(0, 0, 0);
  angularVelocity.set(0, 0, 0);
}

export function isWarpTraveling() { return !!warpTarget; }

// ── toggleOrbit ──────────────────────────────────────────────────────────────

function toggleOrbit() {
    if (orbitMode) {
        // Exit orbit — transfer position/orientation to flight mode
        orbitMode = false;
        orbitBody = null;
        return;
    }

    // Find nearest body
    if (!_allBodies) return;
    let nearest = null;
    let nearestDist = Infinity;
    for (let i = 0; i < _allBodies.length; i++) {
        const b = _allBodies[i];
        if (!b.g || !b.r) continue;
        const bodyPos = b.g.userData._worldPos || b.g.position;
        const d = camPos.distanceTo(bodyPos);
        if (d < b.r * 10 && d < nearestDist) {
            nearestDist = d;
            nearest = b;
        }
    }

    if (!nearest) return;

    const bodyPos = nearest.g.userData._worldPos || nearest.g.position;
    orbitBody = nearest;
    orbitDistance = nearestDist;
    orbitMode = true;

    // Compute initial angles from current camera position
    const offset = camPos.clone().sub(bodyPos);
    orbitTheta = Math.atan2(offset.z, offset.x);
    orbitPhi = Math.acos(Math.max(-1, Math.min(1, offset.y / nearestDist)));

    // Smooth transition
    orbitTransition = true;
    orbitTransT = 0;
    orbitFromP.copy(camPos);
    orbitFromQ.copy(camQuat);

    velocity.set(0, 0, 0);
    angularVelocity.set(0, 0, 0);

    // Cancel fly-to if active
    flyTarget = null;
    returning = false;

    // Show orbit indicator
    const el = document.getElementById('orbit-indicator');
    if (el) el.style.display = 'block';
}

export function isOrbiting() { return orbitMode; }

// ── Getters ──────────────────────────────────────────────────────────────────

export function getCamPos()      { return camPos; }
export function getCamQuat()     { return camQuat; }
export function getVelocity()    { return velocity; }
export function getSpeed()       { return velocity.length(); }
export function getBoostEnergy() { return boostEnergy; }
export function isWarping()      { return warpActive; }

export function getApproachInfo() { return _approachInfo; }
