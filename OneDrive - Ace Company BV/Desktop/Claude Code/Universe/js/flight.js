import * as THREE from 'three';
import { AU } from './constants.js';
import { getAltitude } from './altitude.js';

// ── Constants ────────────────────────────────────────────────────────────────
const THRUST_ACCEL       = 20;
const WARP_MULTIPLIER    = 40;
const LINEAR_DAMPING     = 0.035;
const ANGULAR_DAMPING    = 0.08;
const MAX_BASE_SPEED     = 600;
const MOUSE_SENS         = 0.002;
const ROLL_ACCEL         = 1.5;
const GRAVITY_RANGE_MULT = 5;
const BH_GRAVITY_RANGE_MULT = 50;

// Angular-size speed limiting — creates awe on approach
const ANGULAR_SLOW_START  = 5;    // degrees — planet becomes noticeable, start slowing
const ANGULAR_SLOW_FULL   = 60;   // degrees — planet fills view, crawling speed
const ANGULAR_WARP_CUTOFF = 15;   // degrees — warp disabled
const MIN_APPROACH_SPEED  = 5;    // u/s — minimum speed near a body

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

    const canvas = document.getElementById('c');

    // ── Keyboard ─────────────────────────────────────────────────────────────
    window.addEventListener('keydown', (e) => {
        keys[e.code] = true;

        if (e.code === 'Space' || e.code.startsWith('Arrow')) {
            e.preventDefault();
        }

        if (e.code === 'KeyH') doHome();
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

    // ── 1. Return-home animation ─────────────────────────────────────────────
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
        const bodyPos = body.g.userData._worldPos || body.g.position;
        const dist = camPos.distanceTo(bodyPos);
        const angDeg = 2 * Math.atan(body.r / Math.max(dist, 0.001)) * (180 / Math.PI);
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

    // ── 9. Gravitational influence ───────────────────────────────────────────
    const alt = getAltitude();
    const skipGravity = alt.body && alt.altitudeNorm < 0.1 && !alt.isGasGiant && alt.nearestBody !== 'SUN';
    if (allBodies && !skipGravity) {
        for (let i = 0; i < allBodies.length; i++) {
            const body = allBodies[i];
            const gravRange = body.r * (body.isBlackHole ? BH_GRAVITY_RANGE_MULT : GRAVITY_RANGE_MULT);
            const bodyPos = (body.g && body.g.userData._worldPos) || (body.g ? body.g.position : body.position);
            if (!bodyPos) continue;
            _dir.copy(bodyPos).sub(camPos);
            const dist = _dir.length();
            if (dist < gravRange && dist > body.r * 1.1) {
                _dir.normalize();
                const strength = body.isBlackHole ? 80 : 3;
                const pull = strength * body.r * body.r / (dist * dist);
                velocity.addScaledVector(_dir, Math.min(pull, 5) * dt);
            }
        }
    }

    // ── 10. Linear dampening (only when not thrusting) ───────────────────────
    if (!thrusting) {
        velocity.multiplyScalar(1 - LINEAR_DAMPING);
    }

    // ── 11. Speed cap ────────────────────────────────────────────────────────
    const speed = velocity.length();
    if (speed > maxSpeed) {
        const overspeedRatio = Math.min((speed - maxSpeed) / maxSpeed, 1);
        const dragDamp = 0.035 + overspeedRatio * 0.15;
        velocity.multiplyScalar(1 - dragDamp);
    }

    // ── 12. Hard bounce — repel from body surface, never get stuck ─────────
    if (alt.body && alt.altitudeNorm < 0.1 && alt.nearestBody !== 'SUN') {
        const bodyPos = alt.body.g.userData._worldPos || alt.body.g.position;
        const outward = _dir.copy(camPos).sub(bodyPos).normalize();

        // If actually inside or touching the surface, teleport out and reverse velocity
        if (alt.altitude < 1) {
            camPos.copy(bodyPos).addScaledVector(outward, alt.bodyRadius + 2);
            const inwardSpeed = velocity.dot(outward);
            if (inwardSpeed < 0) {
                // Reverse inward velocity component (bounce)
                velocity.addScaledVector(outward, -inwardSpeed * 1.5);
            }
        }
        // Strong repulsion zone
        else if (alt.altitudeNorm < 0.05) {
            const t = 1 - alt.altitudeNorm / 0.05;
            velocity.addScaledVector(outward, t * 100 * dt);
        }
    }

    // ── 13. Apply velocity to position ───────────────────────────────────────
    camPos.addScaledVector(velocity, dt * 60);

    // ── 14. Update camera ────────────────────────────────────────────────────
    cam.quaternion.copy(camQuat);

    // ── 15. Update HUD ───────────────────────────────────────────────────────
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
    if (elHomeBtn) {
        elHomeBtn.style.display = camPos.length() > 8000 ? 'block' : 'none';
    }
}

// ── doHome ───────────────────────────────────────────────────────────────────

export function doHome() {
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

// ── Getters ──────────────────────────────────────────────────────────────────

export function getCamPos()      { return camPos; }
export function getCamQuat()     { return camQuat; }
export function getVelocity()    { return velocity; }
export function getSpeed()       { return velocity.length(); }
export function getBoostEnergy() { return boostEnergy; }
export function isWarping()      { return warpActive; }

export function getApproachInfo() { return _approachInfo; }
