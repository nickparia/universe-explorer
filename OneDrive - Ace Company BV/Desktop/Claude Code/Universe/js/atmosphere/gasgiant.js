// atmosphere/gasgiant.js — Gas giant atmospheric dive phases, HUD warnings, crush depth ejection
import { getAltitude } from '../altitude.js';
import { getPlanetConfig } from '../planetconfig.js';
import { doHome } from '../flight.js';

// ── State ────────────────────────────────────────────────────────────
let divePhase = 'none'; // 'none' | 'upper' | 'cloud' | 'deep' | 'crush' | 'ejecting'
let hullStress = 0;
let ejecting = false;
let ejectTimer = 0;
let hudElements = null;

// ── HUD bindings ─────────────────────────────────────────────────────
export function initGasGiantHud() {
  hudElements = {
    pressure: document.getElementById('atmo-pressure'),
    temperature: document.getElementById('atmo-temperature'),
    hullStress: document.getElementById('hull-stress'),
    hullBar: document.getElementById('hull-bar'),
    warning: document.getElementById('atmo-warning'),
  };
}

// ── Update ───────────────────────────────────────────────────────────

/**
 * Update gas giant dive state. Returns true if currently in a gas giant.
 * @param {number} dt
 * @param {THREE.Vector3} camPos
 * @param {Object} velocity — flight velocity vector (mutated for ejection)
 * @returns {{ inDive: boolean, phase: string, hullStress: number, fogDensity: number, fogColor: string }}
 */
export function updateGasGiantDive(dt, camPos, velocity) {
  const alt = getAltitude();

  if (!alt.isGasGiant || alt.altitudeNorm > 2.5) {
    // Not in a gas giant
    if (divePhase !== 'none') {
      divePhase = 'none';
      hullStress = 0;
      ejecting = false;
      hideHud();
    }
    return { inDive: false, phase: 'none', hullStress: 0, fogDensity: 0, fogColor: '#000' };
  }

  const config = getPlanetConfig(alt.nearestBody);
  const gg = config?.gasGiant;
  if (!gg) return { inDive: false, phase: 'none', hullStress: 0, fogDensity: 0, fogColor: '#000' };

  // ── Determine phase from altitude ──────────────────────────────
  const an = alt.altitudeNorm;
  let newPhase = 'upper';
  if (an < gg.crushDepthNorm) newPhase = 'crush';
  else if (an < 0.3) newPhase = 'deep';
  else if (an < 0.6) newPhase = 'cloud';
  else if (an < 1.0) newPhase = 'upper';

  // ── Handle ejection ────────────────────────────────────────────
  if (ejecting) {
    ejectTimer += dt;
    if (ejectTimer > 5) {
      ejecting = false;
      ejectTimer = 0;
    }
    // Ejection thrust — push player outward from planet center
    const dir = camPos.clone().sub(alt.body.g.position).normalize();
    velocity.addScaledVector(dir, 300 * dt);

    updateHud('ejecting', 100, alt.nearestBody, gg);
    return { inDive: true, phase: 'ejecting', hullStress: 100, fogDensity: 0.5, fogColor: gg.bandColor1 };
  }

  // ── Crush depth trigger ────────────────────────────────────────
  if (newPhase === 'crush' && !ejecting) {
    ejecting = true;
    ejectTimer = 0;
    // Flash
    const flash = document.getElementById('horizon-flash');
    if (flash) {
      flash.style.transition = 'opacity 0.2s';
      flash.style.opacity = '1';
      setTimeout(() => { flash.style.transition = 'opacity 1.5s'; flash.style.opacity = '0'; }, 200);
    }
    newPhase = 'crush';
  }

  divePhase = newPhase;

  // ── Hull stress calculation ────────────────────────────────────
  const stressTarget =
    divePhase === 'crush' ? 100 :
    divePhase === 'deep' ? 30 + (1 - an / 0.3) * 60 :
    divePhase === 'cloud' ? 5 + (1 - an / 0.6) * 20 :
    0;
  hullStress += (stressTarget - hullStress) * dt * 2;

  // ── Fog density ────────────────────────────────────────────────
  const fogDensity =
    divePhase === 'crush' ? 0.95 :
    divePhase === 'deep' ? 0.4 + (1 - an / 0.3) * 0.5 :
    divePhase === 'cloud' ? 0.1 + (1 - an / 0.6) * 0.3 :
    0;

  updateHud(divePhase, hullStress, alt.nearestBody, gg);

  return {
    inDive: true,
    phase: divePhase,
    hullStress,
    fogDensity,
    fogColor: gg.bandColor1,
  };
}

// ── HUD helpers ──────────────────────────────────────────────────────

function updateHud(phase, stress, planet, gg) {
  if (!hudElements) return;

  if (hudElements.pressure) {
    hudElements.pressure.style.display = 'block';
    const pressureVal = phase === 'upper' ? '1.2' :
      phase === 'cloud' ? (10 + stress * 2).toFixed(0) :
      phase === 'deep' ? (100 + stress * 100).toFixed(0) :
      '∞';
    hudElements.pressure.textContent = `PRESSURE: ${pressureVal} ATM`;
  }

  if (hudElements.temperature) {
    hudElements.temperature.style.display = 'block';
    const tempVal = phase === 'upper' ? '-110' :
      phase === 'cloud' ? (20 + stress * 5).toFixed(0) :
      phase === 'deep' ? (200 + stress * 30).toFixed(0) :
      '∞';
    hudElements.temperature.textContent = `TEMP: ${tempVal}°C`;
  }

  if (hudElements.hullStress) {
    hudElements.hullStress.style.display = 'block';
    hudElements.hullStress.textContent = `HULL STRESS: ${Math.round(stress)}%`;
    hudElements.hullStress.style.color =
      stress > 80 ? 'rgba(255,60,40,0.9)' :
      stress > 40 ? 'rgba(255,180,60,0.8)' :
      'rgba(255,255,255,0.4)';
  }

  if (hudElements.hullBar) {
    hudElements.hullBar.style.width = Math.min(100, stress) + '%';
    hudElements.hullBar.style.background =
      stress > 80 ? 'rgba(255,60,40,0.8)' :
      stress > 40 ? 'rgba(255,180,60,0.7)' :
      'rgba(120,180,255,0.5)';
  }

  if (hudElements.warning) {
    if (phase === 'ejecting') {
      hudElements.warning.style.display = 'block';
      hudElements.warning.textContent = '⚠ SYSTEMS RECOVERING';
      hudElements.warning.style.color = 'rgba(255,180,60,0.8)';
    } else if (phase === 'deep' || phase === 'crush') {
      hudElements.warning.style.display = 'block';
      hudElements.warning.textContent = '⚠ DANGER — EXTREME PRESSURE';
      hudElements.warning.style.color = 'rgba(255,60,40,0.9)';
    } else {
      hudElements.warning.style.display = 'none';
    }
  }
}

function hideHud() {
  if (!hudElements) return;
  if (hudElements.pressure) hudElements.pressure.style.display = 'none';
  if (hudElements.temperature) hudElements.temperature.style.display = 'none';
  if (hudElements.hullStress) hudElements.hullStress.style.display = 'none';
  if (hudElements.warning) hudElements.warning.style.display = 'none';
}
