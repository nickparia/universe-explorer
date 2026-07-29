import * as THREE from 'three';
import { AU, MILKY_WAY_RADIUS } from './constants.js';
import { getAltitude } from './altitude.js';
import { getLandmarks, getDeepSpaceObjects } from './deepspace.js';
import { getShot } from './planetconfig.js';
import { emit, on } from './bus.js';
import { setStarFieldOpacity, setSkyboxOpacity, setMilkyWayOpacity, BASE_FOV, GALACTIC_CENTER } from './engine.js';

// Star map open state — tracked via bus events so flight doesn't import starmap
let starMapOpen = false;
on('starmap:toggled', (isOpen) => { starMapOpen = isOpen; });

// ── Movement model ───────────────────────────────────────────────────────────
// Distance-proportional speed governor: the allowed speed is K × the distance
// to the nearest (effective) surface. Far from everything you fly at
// interstellar speeds; closing on a target the ceiling falls with the gap, so
// the ship glides in exponentially. Stopping distance is at most
// v·TAU_BRAKE ≤ K·TAU_BRAKE ≈ 0.32 of the remaining gap — overshoot is
// mathematically impossible, at every scale, with no mode switching.
const SPEED_DIST_K = 0.9;     // allowed speed = 0.9 × gap per second
const SPEED_MIN    = 3;       // u/s — crawl floor at a surface
const SPEED_MAX    = 1.5e6;   // u/s — ceiling in the intergalactic gulf
const BOOST_MULT   = 3;       // Shift raises the ceiling while energy lasts
// The governor is split by direction: only the velocity component CLOSING on
// the nearest body is capped by the gap (that is the whole no-overshoot
// guarantee — tangential motion past a sphere cannot hit it). Tangential
// speed gets a looser ceiling scaled by gap + body size, so passing a planet
// is a sweeping flyby instead of wading through invisible molasses. Far from
// everything the two ceilings converge and the split disappears.

// Velocity chases the input direction with critically-damped smoothing.
// Different time constants per intent: slow cinematic ramp-up, authoritative
// braking, gentle glide when keys are released.
const TAU_ACCEL = 1.4;        // s — ramp up
const TAU_BRAKE = 0.35;       // s — slow down / change direction
const TAU_COAST = 0.6;        // s — keys released → glide to rest

// Mouse look: direct rotation with light smoothing (no rotational inertia).
const MOUSE_SENS = 0.0022;
const TAU_LOOK   = 0.07;      // s — look smoothing
const INVERT_Y   = true;      // flight-sim Y: pull down = pitch up
const ROLL_ACCEL = 1.6;
const TAU_ROLL   = 0.30;

const BH_GRAVITY_RANGE_MULT = 50;

// Effective radius floor for the governor. Spacecraft have r=3..6, so their
// true surface would allow blowing past them at range; a ~25-unit effective
// hitbox gives every small object a meaningful approach envelope.
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
const _qLevel = new THREE.Quaternion();
const _levelIdeal = new THREE.Vector3();
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

// Look smoothing + roll state
let _pendYaw = 0, _pendPitch = 0, _rollVel = 0;
const _wish = new THREE.Vector3();
const _govBodyPos = new THREE.Vector3();
const _toBody = new THREE.Vector3();

// Speed feel — consumed by the dust field & HUD
const _feel = { ratio: 0, govDist: Infinity, speed: 0, free: false };

// Approach info (exported for HUD)
let _approachInfo = { maxSpeed: SPEED_MAX, bodyName: null };

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
// Two ways to cross: 'warp' — the event, log-scaled seconds, the tunnel;
// 'cruise' — the state, minutes-long, no tunnel FX, SOLACE's pace. Same
// route/chase/arrival machinery, different temperament.
let warpMode = 'warp';
const cruiseLookP = new THREE.Vector3(); // the place being LEFT — the look-back
let cruiseHasLookBack = false;
let warpPassList = []; // [{ name, pos, frac, announced }] — the sights the course slingshots past, in flight order
let warpU0 = -8, warpU1 = 8; // log-odds endpoints of the sigmoid travel profile
const warpFromP = new THREE.Vector3();
const warpFromQ = new THREE.Quaternion();
const warpTargetP = new THREE.Vector3();
let warpPhase = 'none'; // 'none' | 'accelerating' | 'cruising' | 'decelerating'
let _arrivalShown = false;
let _lastMoveKeyAt = 0;
let _warpStartedAt = 0;

// Arrival state — the universal landing grammar. Used by the opening
// shot (glide along the sun line, gaze settling from Sun onto Earth)
// and by warp arrivals (dolly deeper into the destination with a slight
// lateral drift). Always ends in orbit capture — which is what wakes the
// field notes, the ship computer, the arrival tone, and the voyage log.
let arrival = null;
const _arrFrom = new THREE.Vector3();
const _arrTo = new THREE.Vector3();
const _arrFromRel = new THREE.Vector3(); // glide endpoints relative to a moving body
const _arrToRel = new THREE.Vector3();
let warpChaseBody = null;                // moving destination to track during warp
let warpRoute = null;                    // CatmullRomCurve3 through the plotted course — null flies straight
const warpAimP = new THREE.Vector3();    // what the camera LOOKS at — the body itself, never the standoff point
const warpParkDir = new THREE.Vector3(); // body → standoff, unit
let warpArrOffset = 0;
let warpUpBias = 0;                      // extra raised-vantage lift (0 when the shot sets its own elevation)

// Cinematic intro state — optional "begin from the stars" journey, skippable
let introActive = false;
let _introSkipRequested = false;
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
let _autoCinema = false;   // hands-free helm: composed orbit drifting
let _orbitSettleTarget = 0; // ease orbitDistance here (0 = off) — framing glide

// The distance at which an object FILLS the view well. A per-object
// `shot` config (planetconfig.js for bodies/craft, catalog.js for
// deep-space locations) is the authority — each destination frames
// differently. Objects without one fall back to class heuristics:
// ringed things need room for their spans; landmark visuals are huge
// and diffuse; plain bodies read best at ~4 radii.
function niceOrbitDist(b) {
  if (!b || !b.r) return 0;
  const shot = getShot(b.name);
  if (shot && shot.dist) return b.r * shot.dist;
  const ringed = b.name === 'SATURN' || b.name === 'URANUS' || b.name === 'BLACK HOLE';
  if (ringed) return b.r * 7;
  if (b.isLandmark) return b.r * 2.3;
  // Spacecraft are metres across — planetary multiples leave them specks
  if (b.r < 10) return Math.max(b.r * 3, 2.5);
  return b.r * 4.2;
}

// Direction from a body to the camera's parking spot for a configured
// shot. `azim` swings the bearing around from the sunward side (sun at
// origin), `elev` tilts it above the world plane; either falls back to
// `baseDir` (the direction travel would naturally park from).
function shotParkDir(out, bodyPos, baseDir, shot) {
  if (shot && shot.azim != null) {
    out.copy(bodyPos).negate().normalize();
    out.applyAxisAngle(_upVec, shot.azim * (Math.PI / 180));
  } else {
    out.copy(baseDir);
  }
  if (shot && shot.elev != null) {
    let hx = out.x, hz = out.z;
    const h = Math.hypot(hx, hz);
    // Parking directly overhead has no bearing — keep an arbitrary one
    if (h < 1e-6) { hx = 1; hz = 0; } else { hx /= h; hz /= h; }
    const e = shot.elev * (Math.PI / 180);
    out.set(hx * Math.cos(e), Math.sin(e), hz * Math.cos(e));
  }
  return out.normalize();
}
let _cinemaT = 0;
let _cinemaSeed = 0;
let _cinemaBaseDist = 0;
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
        // Typing in an input (star map search, ship computer) never flies the ship
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
        keys[e.code] = true;

        if (e.code === 'Space' || e.code.startsWith('Arrow')) {
            e.preventDefault();
        }

        if (e.code === 'KeyW' || e.code === 'KeyA' || e.code === 'KeyS' || e.code === 'KeyD' || e.code === 'Space') {
            _lastMoveKeyAt = performance.now();
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
        // No input guard here: clearing is always safe, and skipping it
        // wedges a key as held when focus moves into an input mid-press.
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
        // Self-heal: if the right button was released OUTSIDE the window,
        // our mouseup never fired and the look would stick to bare mouse
        // movement on re-entry. e.buttons is ground truth — trust it.
        if (rightDown && !(e.buttons & 2)) {
            rightDown = false;
            canvas.style.cursor = '';
            return;
        }
        if (rightDown) {
            mouseDX += e.movementX;
            mouseDY += e.movementY;
        }
    });

    // Leaving the window or tab releases everything — no stuck look, no
    // stuck thrust keys after a cmd-tab.
    const _releaseAll = () => {
        rightDown = false;
        canvas.style.cursor = '';
        mouseDX = 0; mouseDY = 0;
        for (const k in keys) keys[k] = false;
    };
    window.addEventListener('blur', _releaseAll);
    document.addEventListener('mouseleave', _releaseAll);

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

export function updateFlight(dt, allBodies, dtWall) {
    if (!cam) return;
    // Scripted travel advances on wall-clock time (capped per frame) so a
    // backgrounded tab still arrives; free-flight physics uses clamped dt.
    const dtTravel = Math.min(dtWall ?? dt, 2.0);
    _feel.free = false; // set true only when free-flight physics runs
    _feel.warp = 0;      // set during warp travel — drives the dust stream
    if (starMapOpen) return; // freeze flight when map is open

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
        // Skippable: any key or click after the first second cuts to arrival
        {
            introT += dt / introDuration;
            if (_introSkipRequested && introT * introDuration > 1) {
                endIntro();
                updateHUD();
                return;
            }
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

    // ── 0a. Opening arrival — glide into the silhouette shot ────────────────
    if (arrival) {
        arrival.t += dtTravel / arrival.dur;
        const t = Math.min(arrival.t, 1);
        // Warp arrivals (rel) start from a near-stationary exponential
        // settle, so the glide must open slow too: smoothstep. The opening
        // cinematic keeps its tuned ease-out (it enters moving fast).
        const ease = arrival.rel ? t * t * (3 - 2 * t) : 1 - Math.pow(1 - t, 3);
        const arrBodyPos = arrival.body.g.userData._worldPos || arrival.body.g.position;
        if (arrival.rel) {
            _arrFrom.copy(arrBodyPos).add(_arrFromRel);
            _arrTo.copy(arrBodyPos).add(_arrToRel);
        }
        camPos.lerpVectors(_arrFrom, _arrTo, ease);
        if (arrival.lookAtBody) {
          // Warp arrival: gaze stays on the destination the whole glide
          _dir.copy(arrBodyPos);
        } else {
          // Opening: locked on the Sun for the crossing, then settling onto
          // the destination in the final stretch — so the orientation at
          // t=1 is EXACTLY what orbit mode computes and the handoff has no
          // snap.
          _dir.set(0, 0, 0);
          const lookBlend = smoothstep(0.7, 1, ease);
          if (lookBlend > 0) _dir.lerp(arrBodyPos, lookBlend);
        }
        _lookMat.lookAt(camPos, _dir, _upVec);
        camQuat.setFromRotationMatrix(_lookMat);
        cam.quaternion.copy(camQuat);
        cam.fov = BASE_FOV + (arrival.rel ? 0 : (1 - ease) * 12); // opening settles; warp stays seamless
        cam.updateProjectionMatrix();

        if (t >= 1) {
            cam.fov = BASE_FOV;
            cam.updateProjectionMatrix();
            // Hand off to a live orbit at exactly this pose
            const body = arrival.body;
            const bodyPos = body.g.userData._worldPos || body.g.position;
            const offset = camPos.clone().sub(bodyPos);
            orbitBody = body;
            orbitDistance = offset.length();
            orbitTheta = Math.atan2(offset.z, offset.x);
            orbitPhi = Math.acos(Math.max(-1, Math.min(1, offset.y / orbitDistance)));
            orbitMode = true;
            orbitTransition = false;
            // Whatever path delivered us, the orbit ENDS at the framing
            // distance — glide in if the arrival left us out of frame,
            // glide OUT if it dropped us inside something massive.
            const niceCap = niceOrbitDist(body);
            _orbitSettleTarget = (niceCap > 0 &&
              (orbitDistance > niceCap * 1.35 || orbitDistance < niceCap * 0.75))
              ? niceCap : 0;
            if (typeof window !== 'undefined') {
              window.__arrDebug = {
                name: body.name, r: body.r,
                capturedDist: Math.round(orbitDistance),
                nice: Math.round(niceCap),
              };
            }
            arrival = null;
        }
        updateHUD();
        return;
    }

    // ── 1w. Warp travel (interstellar journeys) ─────────────────────────────
    if (warpTarget) {
        warpT += dtTravel / warpDuration;

        // Allow cancel on WASD input after initial acceleration — but only
        // a keypress that happened AFTER the warp began counts, so stuck or
        // pre-held keys can't silently abort the journey.
        if (warpT > 0.1) {
            const anyMove = (keys['KeyW'] || keys['KeyS'] || keys['KeyA'] || keys['KeyD'] || keys['Space']) &&
                            _lastMoveKeyAt > _warpStartedAt;
            if (anyMove) {
                // Cancel warp — reset FOV, streaks, and vignette
                cam.fov = BASE_FOV;
                cam.updateProjectionMatrix();
                const streakEl = document.getElementById('warp-streaks');
                if (streakEl) streakEl.style.opacity = 0;
                const vignetteCancel = document.getElementById('warp-vignette');
                if (vignetteCancel) vignetteCancel.style.opacity = 0;
                emit('warp:end', { name: warpTarget.name, reason: 'cancelled' });
                warpTarget = null;
                warpPhase = 'none';
                setStarFieldOpacity(1.0); // restore stars on cancel
                updateHUD();
                // Fall through to normal flight
            }
        }

        if (warpTarget) {
            // Four-phase easing: a charge beat (held while the drive spools
            // and the nose swings onto the target), then accelerate, cruise,
            // decelerate. The anticipation is what makes the leap feel big.
            // Cruise barely holds at the start — a breath, not a charge
            const HOLD = warpMode === 'cruise' ? 0.008 : 0.06;
            let eased;
            let speedFeeling;
            if (warpT < HOLD) {
                eased = 0;
                speedFeeling = 0.12 * (warpT / HOLD); // faint tremble while charging
                warpPhase = 'charging';
            } else {
                const t2 = Math.min(1, (warpT - HOLD) / (1 - HOLD));
                if (warpMode === 'cruise') {
                    // The warp profile's exponential tails scale with
                    // duration: over four MINUTES they become whole
                    // minutes of imperceptible drift — a cruise that
                    // "doesn't move". Cruise clamps the log-odds range
                    // (normalized so the endpoints still land exactly)
                    // for short, visible departure/arrival legs and a
                    // long steady middle.
                    // Asymmetric: the departure clamp (-3.5) is much
                    // gentler than the arrival clamp (+5.5), so takeoff
                    // is felt within seconds — the burn actually MOVES
                    // the ship — while the arrival still resolves slowly.
                    const U0 = -3.5, U1 = 5.5;
                    const s0 = 1 / (1 + Math.exp(-U0));
                    const s1 = 1 / (1 + Math.exp(-U1));
                    const u = U0 + (U1 - U0) * t2;
                    eased = (1 / (1 + Math.exp(-u)) - s0) / (s1 - s0);
                    // The burn arc — sensation follows the engines, not
                    // the odometer. A hard throttle-up you can feel,
                    // then CUTOFF: the drives fall silent and the coast
                    // is carried by wisps and star parallax at a low
                    // steady breath. On approach, the braking burn
                    // swells once more, releasing into the arrival.
                    const burn = Math.min(1, t2 / 0.03) * (1 - smoothstep(0.09, 0.16, t2));
                    const brake = smoothstep(0.86, 0.93, t2) * (1 - smoothstep(0.965, 1.0, t2));
                    const coast = 0.3 * Math.min(1, t2 / 0.03);
                    // Slingshot swells: the ship leans into each waypoint's
                    // well and whips back out — felt in the drive, not told
                    let swell = 0;
                    for (const p of warpPassList) {
                      swell = Math.max(swell, Math.exp(-Math.pow((eased - p.frac) / 0.07, 2)));
                    }
                    speedFeeling = Math.max(burn * 0.85, brake * 0.6, coast + swell * 0.3);
                    warpPhase = t2 < 0.16 ? 'accelerating' : t2 < 0.86 ? 'cruising' : 'decelerating';
                } else {
                    // Log-symmetric travel: the sigmoid in log-odds space makes
                    // BOTH ends exponential. Departure: distance from the start
                    // point doubles on a steady beat — the ship visibly backs
                    // out through every scale, like a car leaving a car park.
                    // Arrival: remaining distance halves on the same beat — the
                    // solar system is a multi-second traverse, worlds resolving
                    // in stages, never a blink. The middle is the grand sweep.
                    const u = warpU0 + (warpU1 - warpU0) * t2;
                    eased = 1 / (1 + Math.exp(-u));
                    // Perceived rush is steady through both exponential legs
                    // (scales stream past at a constant beat) — ramp in as the
                    // ship backs out, ease off through the final settle.
                    speedFeeling = t2 < 0.28 ? Math.pow(t2 / 0.28, 2)
                        : t2 > 0.78 ? Math.max(0, 1 - Math.pow((t2 - 0.78) / 0.22, 2))
                        : 1.0;
                    warpPhase = t2 < 0.33 ? 'accelerating' : t2 < 0.75 ? 'cruising' : 'decelerating';
                }
            }
            _feel.warp = speedFeeling;
            _feel.govDist = 150000; // dust shell at interstellar scale

            // Planets keep orbiting during a multi-second warp — chase the
            // live position, or the ship decelerates toward where the body
            // WAS at launch and visibly jumps to where it IS on handoff.
            if (warpChaseBody && warpChaseBody.g) {
                const bp = warpChaseBody.g.userData._worldPos || warpChaseBody.g.position;
                warpAimP.copy(bp);
                warpTargetP.copy(bp)
                    .addScaledVector(warpParkDir, warpArrOffset)
                    .addScaledVector(_upVec, warpArrOffset * warpUpBias);
                // The course's last point IS warpTargetP (by reference) —
                // refresh the arc-length table so the pace stays honest
                if (warpRoute) warpRoute.updateArcLengths();
            }

            // Interpolate position — along the plotted course when the
            // journey has sights to pass. Arc-length parameterization
            // keeps the pace steady through the slingshot arcs.
            const _e = Math.min(eased, 1);
            if (warpRoute) {
                warpRoute.getPointAt(_e, camPos);
            } else {
                camPos.lerpVectors(warpFromP, warpTargetP, _e);
            }

            // Look at the DESTINATION BODY, never the standoff point:
            // planetary standoffs sit above the ecliptic, and aiming at
            // the point while the glide aims at the body meant a ~19-degree
            // gaze snap at handoff. Aiming at the body keeps it fixed in
            // frame through deceleration and into the glide seamlessly.
            //
            // Cruise opens differently: the gaze rests on the place being
            // LEFT — watching it recede like a station platform — then
            // sweeps slowly onto the road ahead.
            if (warpMode === 'cruise' && cruiseHasLookBack) {
              // A dozen seconds of platform-watching, not a full minute —
              // the nose is on course well before the burn cuts off
              const sweep = smoothstep(0.05, 0.16, warpT);
              _dir.copy(cruiseLookP).lerp(warpAimP, sweep);
            } else {
              _dir.copy(warpAimP);
            }
            // The vista sweeps: as the course skims each waypoint, the
            // gaze turns to hold it through the pass, then returns to
            // the road. The journey acknowledges its own scenery.
            if (warpMode === 'cruise' && warpPassList.length) {
              for (const p of warpPassList) {
                const b = Math.exp(-Math.pow((_e - p.frac) / 0.09, 2)) * 0.85;
                if (b > 0.02) _dir.lerp(p.pos, b);
                if (!p.announced && _e > p.frac - 0.03) {
                  p.announced = true;
                  emit('cruise:pass', { name: p.name });
                }
              }
            }
            _lookMat.lookAt(camPos, _dir, _upVec);
            const targetQuat = new THREE.Quaternion().setFromRotationMatrix(_lookMat);
            camQuat.slerpQuaternions(warpFromQ, targetQuat, Math.min(warpT * 5, 1));
            cam.quaternion.copy(camQuat);

            // Speed feeling: gentle FOV push, a whisper of vignette, star
            // fade — the 3D dust stream carries the tunnel on its own.
            // Cruise: the lens leans in during the burns (you feel the
            // thrust) and relaxes almost flat through the coast.
            cam.fov = BASE_FOV + speedFeeling * (warpMode === 'cruise' ? 9 : 18);
            cam.updateProjectionMatrix();
            const streakEl = document.getElementById('warp-streaks');
            if (streakEl) streakEl.style.opacity = 0;
            const vignetteEl = document.getElementById('warp-vignette');
            if (vignetteEl) vignetteEl.style.opacity = warpMode === 'cruise' ? 0 : speedFeeling * 0.18;

            // Stars stay at full brightness through warp: the parallax
            // volumes ARE the sensation of travel now — dimming them was a
            // relic from before the sky could move. (Void proximity fading
            // is handled independently in the main loop.)
            setStarFieldOpacity(1.0);

            // Arrival notification disabled — the bottom-left info card
            // (hud.js) already shows the name and description on proximity,
            // and two cards at once felt like duplicate UI.

            // Complete at 100% — the drive lets go and the arrival glide
            // begins: a slow dolly deeper into the destination with a slight
            // lateral drift for parallax, ending in orbit capture (which
            // wakes the notes, the tone, the log, the ship computer).
            if (warpT >= 1) {
                // No snap to warpTargetP: the profile ends a settle-gap
                // short, and the glide carries us the rest of the way from
                // exactly here — position stays continuous.
                cam.fov = BASE_FOV;
                cam.updateProjectionMatrix();
                if (streakEl) streakEl.style.opacity = 0;
                if (vignetteEl) vignetteEl.style.opacity = 0;
                emit('warp:end', { name: warpTarget.name, reason: 'arrived' });

                const dsBody = getDeepSpaceObjects().find(o => o.name === warpTarget.name) ||
                               (_allBodies && _allBodies.find(b => b.name === warpTarget.name && b.g && b.r));
                if (dsBody && dsBody.g) {
                    const lmPos = dsBody.g.userData._worldPos || dsBody.g.position;
                    _arrFrom.copy(camPos);
                    // Dolly 35% closer, drifting sideways ~9 degrees around
                    // the destination for parallax as we settle
                    _dir.copy(camPos).sub(lmPos).multiplyScalar(0.65);
                    _dir.applyAxisAngle(_upVec, 0.16);
                    _arrTo.copy(lmPos).add(_dir);
                    // Endpoints stored body-relative: the destination keeps
                    // moving through the 5s settle, and the glide must move
                    // with it (rel flag; landmarks pass fixed points).
                    _arrFromRel.copy(_arrFrom).sub(lmPos);
                    _arrToRel.copy(_arrTo).sub(lmPos);
                    arrival = { t: 0, dur: 5, body: dsBody, lookAtBody: true, rel: true };
                }
                warpTarget = null;
                warpPhase = 'none';
                velocity.set(0, 0, 0);
                angularVelocity.set(0, 0, 0);
            }

            updateHUD();
            return;
        }
    }

    // ── 1a. Fly-to autopilot ─────────────────────────────────────────────────
    if (flyTarget) {
        flyT += dtTravel / flyDuration;
        if (flyT >= 1) {
            flyT = 1;
            // Auto-enter orbit mode on arrival — capture the pose we
            // actually arrived at (no snap), then settle to the framing
            // distance if the body drifted during the glide.
            const arrivedBody = flyTarget.bodyRef;
            flyTarget = null;
            orbitBody = arrivedBody;
            orbitMode = true;
            const bodyPos = arrivedBody.g.userData._worldPos || arrivedBody.g.position;
            const offset = camPos.clone().sub(bodyPos);
            const d = Math.max(offset.length(), 1e-6);
            orbitDistance = d;
            orbitTheta = Math.atan2(offset.z, offset.x);
            orbitPhi = Math.acos(Math.max(-1, Math.min(1, offset.y / d)));
            orbitTransition = false;
            const nice = niceOrbitDist(arrivedBody);
            _orbitSettleTarget = (nice > 0 && (d > nice * 1.35 || d < nice * 0.75)) ? nice : 0;
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
        if (keys['KeyW'] || keys['KeyS'] || keys['KeyA'] || keys['KeyD'] || keys['KeyR'] ||
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
        if (keys['KeyW'] || keys['ArrowUp'] || keys['KeyS'] || keys['ArrowDown']) _orbitSettleTarget = 0;
        if (keys['KeyW'] || keys['ArrowUp'])    orbitDistance = Math.max(orbitBody.r * 1.5, orbitDistance - orbitBody.r * 2 * dt);
        if (keys['KeyS'] || keys['ArrowDown'])  orbitDistance += orbitBody.r * 2 * dt;

        // Auto-rotation — slow drift, ~2.5 minutes per full orbit. Visibly
        // alive (a static opening reads as frozen) while keeping the
        // vista sunlit for the first minute.
        if (_orbitSettleTarget > 0) {
            // Log-space easing: equal seconds per distance decade, so any
            // size of correction reads as a deliberate final approach
            const ratio = _orbitSettleTarget / Math.max(orbitDistance, 1e-6);
            orbitDistance *= Math.pow(ratio, 1 - Math.exp(-dt / 2.2));
            if (Math.abs(Math.log(ratio)) < 0.03) _orbitSettleTarget = 0;
        }
        if (_autoCinema) {
            // Cinematography, not rotation: theta breathes, the camera
            // swings slowly between low and high vantage, the distance
            // eases in and out — every dwell composes different shots.
            _cinemaT += dt;
            if (_cinemaBaseDist <= 0) _cinemaBaseDist = orbitDistance;
            orbitTheta += dt * (0.04 + 0.022 * Math.sin(_cinemaT * 0.013 + _cinemaSeed));
            const phiTarget = 1.05 + Math.sin(_cinemaT * 0.011 + _cinemaSeed * 2.1) * 0.5;
            orbitPhi += (phiTarget - orbitPhi) * (1 - Math.exp(-dt / 12));
            const distTarget = _cinemaBaseDist * (1 + 0.22 * Math.sin(_cinemaT * 0.008 + _cinemaSeed * 3.7));
            orbitDistance += (distTarget - orbitDistance) * (1 - Math.exp(-dt / 16));
        } else {
            orbitTheta += dt * 0.04;
        }

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
      const anyKey = keys['KeyW'] || keys['KeyS'] || keys['KeyA'] || keys['KeyD'] || keys['Space'] || keys['KeyC'] || keys['KeyR'];
      if (anyKey || (rightDown && (mouseDX !== 0 || mouseDY !== 0))) {
        flyTarget = null;
      }
    }

    // ── 2. Mouse look — direct rotation with smoothing, inverted Y ──────────
    _pendYaw   += -mouseDX * MOUSE_SENS;
    _pendPitch += (INVERT_Y ? 1 : -1) * mouseDY * MOUSE_SENS;
    mouseDX = 0;
    mouseDY = 0;

    const lookAlpha = 1 - Math.exp(-dt / TAU_LOOK);
    const yawStep   = _pendYaw * lookAlpha;
    const pitchStep = _pendPitch * lookAlpha;
    _pendYaw   -= yawStep;
    _pendPitch -= pitchStep;

    // ── 3. Roll from Q/E — kept inertial, reads as reaction wheels ──────────
    if (keys['KeyQ']) _rollVel += ROLL_ACCEL * dt;
    if (keys['KeyE']) _rollVel -= ROLL_ACCEL * dt;
    _rollVel *= Math.exp(-dt / TAU_ROLL);

    // ── 4. Apply rotation ────────────────────────────────────────────────────
    _axisX.set(1, 0, 0).applyQuaternion(camQuat);
    _axisY.set(0, 1, 0).applyQuaternion(camQuat);
    _axisZ.set(0, 0, 1).applyQuaternion(camQuat);

    _qPitch.setFromAxisAngle(_axisX, pitchStep);
    _qYaw.setFromAxisAngle(_axisY, yawStep);
    _qRoll.setFromAxisAngle(_axisZ, _rollVel * dt);

    // Gentle auto-level: when you're not rolling on purpose, the ship
    // slowly rights itself toward the ecliptic horizon (~8s). Kills the
    // accumulated-roll disorientation that makes mouse-look feel
    // diagonal, without fighting deliberate Q/E rolls.
    if (!keys['KeyQ'] && !keys['KeyE'] && Math.abs(_rollVel) < 0.02) {
        const fwd2 = _axisZ; // local +Z in world space; forward is its negation
        _levelIdeal.copy(_upVec).addScaledVector(fwd2, -_upVec.dot(fwd2));
        const len2 = _levelIdeal.lengthSq();
        if (len2 > 0.05) {
            _levelIdeal.normalize();
            const upW = _axisY, rightW = _axisX;
            const err = Math.atan2(_levelIdeal.dot(rightW), _levelIdeal.dot(upW));
            const k = (1 - Math.exp(-dt / 8)) * Math.min(1, len2 * 2);
            if (Math.abs(err) > 0.002) {
                _qLevel.setFromAxisAngle(fwd2, -err * k);
                camQuat.premultiply(_qLevel);
            }
        }
    }

    camQuat.premultiply(_qPitch);
    camQuat.premultiply(_qYaw);
    camQuat.premultiply(_qRoll);
    camQuat.normalize();

    // ── 5. Speed governor — ceiling proportional to gap to nearest surface ──
    let govDist = Infinity;
    let govBody = null;
    let govEffR = 0;
    if (allBodies) {
      for (let i = 0; i < allBodies.length; i++) {
        const body = allBodies[i];
        if (!body.g || !body.r) continue;
        const bodyPos = body.g.userData._worldPos || body.g.position;
        const effR = Math.max(body.r, MIN_APPROACH_RADIUS);
        const d = camPos.distanceTo(bodyPos) - effR;
        if (d < govDist) {
          govDist = d;
          govBody = body;
          govEffR = effR;
          _govBodyPos.copy(bodyPos);
        }
      }
    }
    govDist = Math.max(govDist, 0.5);
    if (govBody) _toBody.copy(_govBodyPos).sub(camPos).normalize();
    let allowed    = Math.min(SPEED_MAX, Math.max(SPEED_MIN, govDist * SPEED_DIST_K));
    let allowedTan = Math.min(SPEED_MAX, Math.max(SPEED_MIN, (govDist + govEffR) * SPEED_DIST_K));

    // ── 6. Boost — Shift raises the ceiling while energy lasts ──────────────
    const shiftHeld = keys['ShiftLeft'] || keys['ShiftRight'];
    warpActive = shiftHeld && boostEnergy > 0;
    if (warpActive) {
        boostEnergy -= dt * 0.2;
    } else {
        boostEnergy += dt * 0.125;
    }
    boostEnergy = Math.max(0, Math.min(1, boostEnergy));
    if (warpActive) {
        allowed    = Math.min(SPEED_MAX, allowed * BOOST_MULT);
        allowedTan = Math.min(SPEED_MAX, allowedTan * BOOST_MULT);
    }

    _approachInfo.maxSpeed = allowed;
    _approachInfo.bodyName = govBody ? govBody.name : null;

    // ── 7. Wish velocity from input ──────────────────────────────────────────
    const fwd   = getForward(camQuat);
    const right = getRight(camQuat);
    const up    = getUp(camQuat);

    _wish.set(0, 0, 0);
    let thrusting = false;
    // Space is the universal GO: one hand on Space, one on the mouse is
    // a complete way to fly (tester feedback). Vertical lives on R/C.
    if (keys['KeyW'] || keys['ArrowUp'] || keys['Space']) { _wish.add(fwd); thrusting = true; }
    if (keys['KeyS'] || keys['ArrowDown'])  { _wish.sub(fwd);   thrusting = true; }
    if (keys['KeyD'] || keys['ArrowRight']) { _wish.add(right); thrusting = true; }
    if (keys['KeyA'] || keys['ArrowLeft'])  { _wish.sub(right); thrusting = true; }
    if (keys['KeyR']) { _wish.add(up); thrusting = true; }
    if (keys['KeyC']) { _wish.sub(up); thrusting = true; }
    if (thrusting && _wish.lengthSq() > 0) {
        _wish.normalize().multiplyScalar(allowedTan);
        if (govBody) {
            const closing = _wish.dot(_toBody);
            if (closing > allowed) _wish.addScaledVector(_toBody, allowed - closing);
        }
    }

    // ── 8. Velocity chases wish — critically damped, frame-rate independent ─
    const speed0 = velocity.length();
    let tau;
    if (!thrusting)                     tau = TAU_COAST;
    else if (_wish.length() >= speed0)  tau = TAU_ACCEL;
    else                                tau = TAU_BRAKE;
    velocity.lerp(_wish, 1 - Math.exp(-dt / tau));

    // ── 9. Black hole gravity ────────────────────────────────────────────────
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

    // ── 10. Inbound overspeed clamp ──────────────────────────────────────────
    // Shave only the excess CLOSING component: that's the overshoot
    // guarantee. Tangential and outbound motion stay free — outbound is
    // self-correcting (the gap grows, the ceiling rises) and must not be
    // strangled, or gas-giant ejection and escapes break.
    if (govBody) {
        const closingSpeed = velocity.dot(_toBody);
        const capR = allowed * 1.2;
        if (closingSpeed > capR) {
            velocity.addScaledVector(_toBody, capR - closingSpeed);
        }
    }

    // ── 11. Surface collision — planets only, not spacecraft ────────────────
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

    // ── 12. Integrate position — velocity is true units/second ──────────────
    camPos.addScaledVector(velocity, dt);

    // ── 13. Speed feel ───────────────────────────────────────────────────────
    // ratio = how hard you're pushing the local ceiling. Because the ceiling
    // is distance-proportional, ratio is also the honest measure of APPARENT
    // speed (scenery-passing rate) at every scale — so it drives FOV, streaks
    // and the dust field identically near a moon and between galaxies.
    {
      const spd = velocity.length();
      const ratio = Math.min(spd / Math.max(allowedTan, 1e-6), 1.5);
      _feel.ratio = ratio;
      _feel.govDist = govDist;
      _feel.speed = spd;
      _feel.free = true;

      const targetFov = BASE_FOV + smoothstep(0.35, 1.2, ratio) * 14;
      cam.fov += (targetFov - cam.fov) * (1 - Math.exp(-dt / 0.25));
      cam.updateProjectionMatrix();

      const streakEl = document.getElementById('warp-streaks');
      if (streakEl) {
        streakEl.style.opacity = (smoothstep(0.55, 1.2, ratio) * 0.5).toFixed(3);
      }
    }

    // ── 15. Update camera ────────────────────────────────────────────────────
    cam.quaternion.copy(camQuat);

    // ── 16. Update HUD ───────────────────────────────────────────────────────
    updateHUD();
}

// ── HUD update helper ────────────────────────────────────────────────────────

let _prevOrbitName = null;

function updateHUD() {
    // Orbit state transitions are detected here (updateHUD runs every frame
    // on every path) so no individual orbit entry/exit site can be missed.
    const curOrbitName = (orbitMode && orbitBody) ? orbitBody.name : null;
    if (curOrbitName !== _prevOrbitName) {
        if (curOrbitName) emit('orbit:enter', { name: curOrbitName });
        else emit('orbit:exit', { name: _prevOrbitName });
        _prevOrbitName = curOrbitName;
    }

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

    // A glide is for neighborhood hops. Anything long routes through the
    // warp pipeline — tunnel, charge beat, arrival glide — so travel time
    // and sensation stay proportional to the journey.
    if (dist > 40000) {
        warpTo(bodyName);
        return;
    }

    // Approach from the sunward side (sun is at origin) so the lit face
    // is visible, offset slightly upward for a cinematic angle — unless
    // the body's shot config chooses its own bearing/elevation.
    const shot = getShot(bodyName);
    const sunDir = new THREE.Vector3().copy(bodyPos).negate().normalize();
    sunDir.y += 0.3;
    sunDir.normalize();
    const parkDir = shotParkDir(new THREE.Vector3(), bodyPos, sunDir, shot);
    // Distance: the shot's framing distance, or ~4.5 radii
    const arrivalDist = body.r * ((shot && shot.dist) || 4.5);
    flyTargetP.copy(bodyPos).addScaledVector(parkDir, arrivalDist);

    flyFromP.copy(camPos);
    flyFromQ.copy(camQuat);
    flyTarget = { bodyRef: body };
    flyT = 0;
    emit('nav:target', bodyName);
    emit('flyto:start', { name: bodyName });
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
  // Start position: well outside the Milky Way disc, on the Sun's side
  // of the galaxy and above the plane, so the opening frames the whole
  // spiral from over the rim — and the dive home crosses the disc.
  {
    const R = MILKY_WAY_RADIUS;
    const dirHome = GALACTIC_CENTER.clone().multiplyScalar(-1).normalize();
    const side = new THREE.Vector3().crossVectors(dirHome, _upVec).normalize();
    introFromP.copy(GALACTIC_CENTER)
      .addScaledVector(dirHome, R * 2.6)
      .addScaledVector(_upVec, R * 1.05)
      .addScaledVector(side, R * 0.65);
  }
  introFromQ.copy(camQuat);
  camPos.copy(introFromP);

  // Compose the landing shot: aim a little BELOW the galactic center so
  // the galaxy floats in the lower half of the frame, leaving a calm
  // dark area above for the title. Looking-down-at-the-galaxy vibe.
  introInitialLookAt.copy(GALACTIC_CENTER).add(
    new THREE.Vector3(0, -MILKY_WAY_RADIUS * 0.45, 0)
  );
  _lookMat.lookAt(camPos, introInitialLookAt, _upVec);
  camQuat.setFromRotationMatrix(_lookMat);
  if (cam) cam.quaternion.copy(camQuat);

  introT = 0;
  introActive = true;
  _introSkipRequested = false;
  window.addEventListener('keydown', _requestIntroSkip);
  window.addEventListener('mousedown', _requestIntroSkip);
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

function _requestIntroSkip() { _introSkipRequested = true; }

function endIntro() {
  introActive = false;
  window.removeEventListener('keydown', _requestIntroSkip);
  window.removeEventListener('mousedown', _requestIntroSkip);
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

export function isIntroPlaying() { return introActive || !!arrival; }

/**
 * The opening shot: start far out beyond `body` on its anti-sun side and
 * glide in (ease-out) until the body hangs as a silhouette between the
 * camera and the Sun. Hands off seamlessly to orbit mode, whose slow
 * drift then brings the sunrise around the limb.
 */
export function startArrival(body, opts = {}) {
  if (!body || !body.g) return;
  const bodyPos = (body.g.userData._worldPos || body.g.position).clone();
  const back = bodyPos.clone().normalize();          // away from the Sun
  const side = new THREE.Vector3().crossVectors(back, _upVec).normalize();

  _arrTo.copy(bodyPos)
    .addScaledVector(back, body.r * 5.5)
    .addScaledVector(_upVec, body.r * 1.7);
  _arrFrom.copy(bodyPos)
    .addScaledVector(back, body.r * 85)
    .addScaledVector(_upVec, body.r * 10)
    .addScaledVector(side, body.r * 16);

  arrival = { t: 0, dur: opts.duration || 8, body };
  camPos.copy(_arrFrom);
  _lookMat.lookAt(camPos, new THREE.Vector3(0, 0, 0), _upVec);
  camQuat.setFromRotationMatrix(_lookMat);
  if (cam) cam.quaternion.copy(camQuat);
  velocity.set(0, 0, 0);
  angularVelocity.set(0, 0, 0);
}

export function skipArrival() {
  if (arrival) arrival.t = 1;
}

/**
 * Boot directly into a slow cinematic orbit of a hero body — the app now
 * opens already inside the world instead of commuting in from the galaxy.
 * Composed from the sunlit side, slightly above the equator, so the body
 * is lit and the terminator rakes across the frame.
 */
export function startAtVista(body, opts = {}) {
  if (!body || !body.g) return;
  const bodyPos = body.g.userData._worldPos || body.g.position;

  orbitBody = body;
  orbitMode = true;
  orbitTransition = false;
  const vistaShot = getShot(body.name);
  orbitDistance = body.r * (opts.dist || (vistaShot && vistaShot.dist) || 4.2);

  const sunDir = bodyPos.clone().negate().normalize();
  orbitTheta = Math.atan2(sunDir.z, sunDir.x) + (opts.theta ?? 0.65);
  orbitPhi = opts.phi ?? Math.PI / 2.6;

  const x = orbitDistance * Math.sin(orbitPhi) * Math.cos(orbitTheta);
  const y = orbitDistance * Math.cos(orbitPhi);
  const z = orbitDistance * Math.sin(orbitPhi) * Math.sin(orbitTheta);
  camPos.copy(bodyPos).add(new THREE.Vector3(x, y, z));
  _lookMat.lookAt(camPos, bodyPos, _upVec);
  camQuat.setFromRotationMatrix(_lookMat);
  if (cam) cam.quaternion.copy(camQuat);
  velocity.set(0, 0, 0);
  angularVelocity.set(0, 0, 0);
}

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

export function warpTo(targetName, mode = 'warp') {
  const allLandmarks = getLandmarks();
  const landmark = allLandmarks.find(lm => lm.name === targetName);

  // Resolve the destination: a landmark, or any body (planet, craft,
  // black hole) — warp is the long-haul carrier for everything.
  let targetPos, targetR, isVoid = false;
  warpChaseBody = null;
  if (landmark) {
    targetPos = landmark.pos;
    targetR = landmark.radius;
    isVoid = landmark.visual === 'void';
  } else {
    const body = _allBodies && _allBodies.find(b => b.name === targetName && b.g && b.r);
    if (!body) return;
    warpChaseBody = body;
    targetPos = body.g.userData._worldPos || body.g.position;
    targetR = body.r;
    if (mode !== 'cruise' && camPos.distanceTo(targetPos) <= 40000) {
      flyTo(targetName); // short hop — the neighborhood glide is nicer
      return;
    }
  }

  warpMode = mode;
  // The look-back: a cruise departs the way a train leaves a station —
  // gazing at the place receding before the road ahead. Anchor on the
  // body we were orbiting (snapshot; we're receding, drift is invisible).
  cruiseHasLookBack = false;
  if (mode === 'cruise' && orbitMode && orbitBody && orbitBody.g) {
    cruiseLookP.copy(orbitBody.g.userData._worldPos || orbitBody.g.position);
    cruiseHasLookBack = true;
  }

  // Cancel any active orbit/fly-to/return modes
  orbitMode = false;
  orbitBody = null;
  flyTarget = null;
  returning = false;

  // Set warp origin
  warpFromP.copy(camPos);
  warpFromQ.copy(camQuat);
  warpAimP.copy(targetPos);

  // Compute the standoff: for voids, arrive inside (the near wall behind
  // you, the far wall across the emptiness). For landmarks, stop inside
  // the visual's volume. For bodies, stop a few radii out — the arrival
  // glide then dollies in and captures orbit.
  const approachDir = new THREE.Vector3().copy(targetPos).sub(camPos).normalize();
  // A configured shot is the authority on how far to park: the arrival
  // glide dollies to 0.65×, so the standoff compensates and the glide
  // ENDS at the shot's framing distance. Without one, class heuristics:
  // galaxies must be FRAMED, never entered (from inside, their photo
  // layers wash the screen to white); voids are entered on purpose;
  // ringed planets need room for their spans; spacecraft floors scale
  // with the craft.
  const shot = getShot(targetName);
  let arrivalOffset;
  if (shot && shot.dist) {
    arrivalOffset = (targetR * shot.dist) / 0.65;
  } else {
    const isGalaxy = landmark &&
      (landmark.visual === 'spiral_galaxy' || landmark.visual === 'sombrero_galaxy');
    const isRinged = !landmark &&
      (targetName === 'SATURN' || targetName === 'URANUS' || targetName === 'BLACK HOLE');
    arrivalOffset = landmark
      ? (isVoid ? targetR * 0.45 : isGalaxy ? targetR * 6.0 : targetR * 3.5)
      : targetR < 10
        ? Math.max(targetR * 5, 4)  // 14 units is 23 radii for Hubble (r=0.6)
        : Math.max(targetR * (isRinged ? 11 : 6), 55);
  }
  // Park direction: the shot's bearing/elevation when configured,
  // otherwise the near side of wherever the journey came from. Bodies
  // without a shot settle slightly above the ecliptic: rings, poles,
  // and orbital geometry all read better from a raised vantage than
  // from flat in the plane — where Saturn's rings vanish edge-on.
  if (shot && (shot.azim != null || shot.elev != null)) {
    shotParkDir(warpParkDir, targetPos, approachDir.clone().negate(), shot);
    warpUpBias = 0;
  } else {
    warpParkDir.copy(approachDir).negate();
    warpUpBias = landmark ? 0 : 0.35;
  }
  warpTargetP.copy(targetPos)
    .addScaledVector(warpParkDir, arrivalOffset)
    .addScaledVector(_upVec, arrivalOffset * warpUpBias);
  // ── Course plotting: slingshot waypoints ──────────────────────────
  // A journey is content. Every landmark or planet near the corridor is
  // a candidate; the plotted course threads a spline past the best few
  // at respectful flyby distance — with the gaze locked on the
  // destination, each sight sweeps across the view like a nebula
  // passing the window. Straight lines are for couriers.
  warpRoute = null;
  warpPassList = [];
  {
    const legLen = camPos.distanceTo(warpTargetP);
    const _dirLeg = new THREE.Vector3().copy(warpTargetP).sub(camPos).normalize();
    const candidates = [];
    const _rejects = []; // __routeDebug — why each sight was passed over
    const consider = (pos, r, isLm, name) => {
      const toC = new THREE.Vector3().copy(pos).sub(camPos);
      const s = toC.dot(_dirLeg);
      if (s < legLen * 0.18 || s > legLen * 0.82) { _rejects.push(`${name}: frac ${(s / legLen).toFixed(2)}`); return; } // mid-route only
      const closest = new THREE.Vector3().copy(camPos).addScaledVector(_dirLeg, s);
      const lat = closest.distanceTo(pos);
      const flybyDist = r * (isLm ? 2.2 : 9);
      if (lat < flybyDist) { _rejects.push(`${name}: inside flyby ${Math.round(lat)}<${Math.round(flybyDist)}`); return; } // already flying through it
      if (lat > Math.min(legLen * 0.22, r * 60)) { _rejects.push(`${name}: off-corridor ${Math.round(lat)}`); return; } // too far off-corridor
      candidates.push({ pos: pos.clone(), closest, flybyDist, name, frac: s / legLen, score: r / lat });
    };
    for (const lm of allLandmarks) {
      if (lm.name === targetName) continue;
      consider(lm.pos, lm.radius, true, lm.name);
    }
    if (_allBodies) {
      for (const b of _allBodies) {
        if (!b.g || !b.r || b.r < 5 || b.name === targetName) continue;
        consider(b.g.userData._worldPos || b.g.position, b.r, false, b.name);
      }
    }
    // Greedy by score, waypoints kept a healthy stretch apart so each
    // pass gets its own sweep. A warp takes one; a cruise is long enough
    // to plot a real course — up to three assists on a single crossing.
    candidates.sort((a, b) => b.score - a.score);
    const cap = mode === 'cruise' ? 3 : 1;
    const picked = [];
    for (const c of candidates) {
      if (picked.length >= cap) break;
      if (picked.some((p) => Math.abs(p.frac - c.frac) < 0.16)) continue;
      picked.push(c);
    }
    picked.sort((a, b) => a.frac - b.frac);
    if (typeof window !== 'undefined') {
      window.__routeDebug = {
        target: targetName, legLen: Math.round(legLen),
        candidates: candidates.map((c) => `${c.name}@${c.frac.toFixed(2)}`),
        picked: picked.map((p) => p.name), rejects: _rejects,
      };
    }
    if (picked.length) {
      // Pass points: pulled from each sight toward the corridor, at a
      // respectful flyby distance — the spline arcs around the body and
      // whips back onto the corridor, a gravity assist you can see
      const pts = [warpFromP];
      for (const p of picked) {
        pts.push(new THREE.Vector3().copy(p.closest).sub(p.pos)
          .normalize().multiplyScalar(p.flybyDist).add(p.pos));
      }
      pts.push(warpTargetP); // by reference — chase updates flow into the curve
      warpRoute = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
      // Pass timing lives in arc-length space — where each flyby happens
      // along the course actually FLOWN, not the straight corridor
      const lengths = warpRoute.getLengths(200);
      const total = lengths[lengths.length - 1];
      warpPassList = picked.map((p, i) => ({
        name: p.name,
        pos: p.pos,
        frac: lengths[Math.round(((i + 1) / (pts.length - 1)) * 200)] / total,
        announced: false,
      }));
    }
  }

  warpArrOffset = arrivalOffset;
  {
    const journey = camPos.distanceTo(warpTargetP);
    const startGap = 150;                              // departure creep scale
    const endGap = Math.max(400, arrivalOffset * 0.02); // arrival settle scale
    warpU0 = -Math.log(Math.max(3, journey / startGap));
    warpU1 = Math.log(Math.max(3, journey / endGap));
  }

  // Duration grows logarithmically: every 10x the distance adds ~4s.
  // Pluto ~12s, the Pillars ~20s, the Bootes Void ~25s — journeys feel
  // proportional without long ones becoming tedious. Sensation of speed
  // comes from the tunnel, not the clock.
  const dist = camPos.distanceTo(targetPos);
  if (mode === 'cruise') {
    // Minutes, not seconds — the journey IS the content. Still scales
    // gently with distance so far crossings feel farther.
    warpDuration = Math.min(300, Math.max(150,
      150 + (Math.log10(Math.max(dist, 10000)) - 5) * 45));
  } else {
    warpDuration = Math.min(40, Math.max(9, 10 + 4.6 * Math.log10(Math.max(dist, 10000) / 10000)));
  }

  // Set warp target
  warpTarget = { name: targetName, desc: landmark ? landmark.desc : '', pos: targetPos.clone ? targetPos.clone() : targetPos };
  warpT = 0;
  _warpStartedAt = performance.now();
  warpPhase = 'accelerating';
  _arrivalShown = false;
  emit('nav:target', targetName);
  emit('warp:start', { name: targetName, duration: warpDuration, mode, via: warpPassList.map((p) => p.name) });

  // Clear velocity
  velocity.set(0, 0, 0);
  angularVelocity.set(0, 0, 0);
}

export function isWarpTraveling() { return !!warpTarget; }
export function isCruising() { return !!warpTarget && warpMode === 'cruise'; }

/**
 * The slow crossing — SOLACE's way of traveling. Same destination
 * resolution, routing, and arrival as warp, at a temperament measured
 * in minutes. Any deliberate input returns the helm instantly.
 */
export function cruiseTo(targetName) {
  warpTo(targetName, 'cruise');
}

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

/**
 * If the ship is adrift near a body or landmark, capture a gentle orbit
 * of it at the current pose — the resting state is never a frozen
 * frame. Used on resume when the session was saved mid-flight.
 * @returns {boolean} true if an orbit was captured
 */
export function settleIntoNearestOrbit(bodies, maxMult = 26) {
  if (orbitMode || !bodies) return false;
  let best = null;
  let bestGap = Infinity;
  for (const b of bodies) {
    if (!b.g || !b.r) continue;
    const p = b.g.userData._worldPos || b.g.position;
    const d = camPos.distanceTo(p);
    // Absolute floor on the search window: 26 radii is ~150 units for a
    // spacecraft, so a session saved just beyond that resumed as a
    // frozen frame in the dark. 'Near' has a human scale too.
    const near = Math.max(b.r * maxMult, 1600);
    if (d < near && d < bestGap) { bestGap = d; best = b; }
  }
  if (!best) return false;
  const bodyPos = best.g.userData._worldPos || best.g.position;
  const offset = camPos.clone().sub(bodyPos);
  orbitBody = best;
  orbitDistance = Math.max(offset.length(), best.r * 1.6);
  orbitTheta = Math.atan2(offset.z, offset.x);
  orbitPhi = Math.acos(Math.max(-1, Math.min(1, offset.y / Math.max(orbitDistance, 1e-6))));
  orbitMode = true;
  orbitTransition = false;
  velocity.set(0, 0, 0);
  // Boot-time settle happens before the first paint — snap straight to
  // the framing distance; there is no camera journey to preserve.
  const nice = niceOrbitDist(best);
  if (nice > 0 && orbitDistance > nice * 1.25) orbitDistance = nice;
  emit('orbit:enter', { name: best.name });
  return true;
}

/** Hands-free helm: composed orbit drifting while autopilot holds. */
export function setAutoCinema(onFlag) {
  _autoCinema = !!onFlag;
  if (_autoCinema) {
    _cinemaT = 0;
    _cinemaSeed = Math.random() * 6.28;
    // Breathe around the object's framing distance — an orbit captured
    // 20 radii out would otherwise compose around an egg in the dark.
    const nice = orbitMode ? niceOrbitDist(orbitBody) : 0;
    _cinemaBaseDist = orbitMode
      ? (nice > 0 ? Math.min(orbitDistance, nice * 1.35) : orbitDistance)
      : 0;
  }
}
export function getOrbitBodyName() { return (orbitMode && orbitBody) ? orbitBody.name : null; }

/**
 * Resume a saved session: place the camera exactly where it was. If the
 * traveler was orbiting, re-derive the orbit from the pose so the slow
 * drift continues as if they never left.
 */
export function restorePose(pos, quat, orbitBodyRef) {
  camPos.set(pos.px, pos.py, pos.pz);
  camQuat.set(quat.qx, quat.qy, quat.qz, quat.qw).normalize();
  if (cam) cam.quaternion.copy(camQuat);
  velocity.set(0, 0, 0);
  angularVelocity.set(0, 0, 0);
  if (orbitBodyRef && orbitBodyRef.g) {
    const bodyPos = orbitBodyRef.g.userData._worldPos || orbitBodyRef.g.position;
    const offset = camPos.clone().sub(bodyPos);
    orbitBody = orbitBodyRef;
    orbitDistance = offset.length();
    orbitTheta = Math.atan2(offset.z, offset.x);
    orbitPhi = Math.acos(Math.max(-1, Math.min(1, offset.y / orbitDistance)));
    orbitMode = true;
    orbitTransition = false;
    // Bodies move between sessions while the saved pose is absolute —
    // the restored orbit can be arbitrarily wide. This runs at boot,
    // BEFORE the first frame paints, so snapping to the framing
    // distance is invisible: you wake up in front of the thing itself.
    const nice = niceOrbitDist(orbitBodyRef);
    if (nice > 0 && orbitDistance > nice * 1.25) orbitDistance = nice;
  }
}

// ── Getters ──────────────────────────────────────────────────────────────────

export function getCamPos()      { return camPos; }
export function getCamQuat()     { return camQuat; }
export function getVelocity()    { return velocity; }
export function getSpeed()       { return velocity.length(); }
export function getBoostEnergy() { return boostEnergy; }
export function isWarping()      { return warpActive; }

export function getApproachInfo() { return _approachInfo; }
export function getSpeedFeel()    { return _feel; }
