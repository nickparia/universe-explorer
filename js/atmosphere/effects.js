// atmosphere/effects.js — Re-entry glow, camera shake, descent particles
import * as THREE from 'three';
import { getAltitude } from '../altitude.js';
import { getPlanetConfig } from '../planetconfig.js';
import { getConfig } from '../perf.js';

// ── Module state ─────────────────────────────────────────────────────

let glowOverlay = null;
let shakeOffset = new THREE.Vector3();
let prevAltNorm = Infinity;
let entryFlashActive = false;
let entryFlashTimer = 0;
let canTriggerEntry = true;
let particles = null;
let particleGroup = null;

/**
 * Initialize atmosphere effects. Call once.
 */
export function initAtmoEffects() {
  // Re-entry glow overlay (DOM element)
  glowOverlay = document.getElementById('reentry-glow');
}

/**
 * Update atmosphere entry effects. Call every frame.
 * @param {number} dt — delta time
 * @param {THREE.Vector3} camPos
 * @param {THREE.Vector3} velocity — player velocity vector
 * @param {THREE.Camera} camera — to apply shake
 * @param {THREE.Scene} scene
 */
export function updateAtmoEffects(dt, camPos, velocity, camera, scene) {
  const alt = getAltitude();
  const speed = velocity.length();
  const perfConfig = getConfig();
  // ── Entry/exit flash detection ────────────────────────────────────
  if (alt.hasAtmosphere) {
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
    if (alt.hasAtmosphere && alt.altitudeNorm < 3 && speed > 80) {
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
  if (alt.hasAtmosphere && alt.altitudeNorm < 2 && speed > 30 && shakeMultiplier > 0) {
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
