// ground/ground.js — the groundside mode: making landfall, standing on
// Mars, and lifting off again.
//
// Phase 0 of docs/LOOP.md: one real place in full 3D — Coprates
// Chasma, Valles Marineris — land, walk, rove. No loop yet; the feel.
//
// The site lives in a pocket frame far off the galactic plane. On
// entry the space scene is hidden wholesale (lights included), the
// ground root becomes the world, and the camera walks in meters. The
// flight model is suppressed, its pose saved; lift-off restores it
// exactly — from orbit, the descent is a held breath, not a cut.

import * as THREE from 'three';
import { getScene, getCamera, setWorldPos } from '../engine.js';
import { setFlightSuppressed, restorePose, getCamPos, getCamQuat, getOrbitBodyName } from '../flight.js';
import { getBodies } from '../bodies.js';
import { getPlanetConfig } from '../planetconfig.js';
import { emit } from '../bus.js';
import { setZoneOverride } from '../music.js';
import { setGroundWind } from '../soundscape.js';
import { loadSite, getSite } from './site.js';
import { initTerrain, updateTerrain, disposeTerrain, debugTerrain } from './terrain.js';
import { initSky, updateSky, disposeSky, getSunState, debugSky } from './sky.js';
import { initController, updateController, disposeController, getLocalPos, getMode, getGroundSpeed, getEyeY, getHeldKeys } from './controller.js';
import { initDustField, updateDustField, disposeDustField } from './dust.js';
import { initLamp, updateLamp, disposeLamp } from './lamp.js';

const POCKET = new THREE.Vector3(0, 6e8, 0);  // far above the galactic plane
const SITE_NAME = 'COPRATES CHASMA';

let state = 'idle';            // idle | entering | active | exiting
let rootGroup = null;
let hiddenChildren = null;     // [obj, wasVisible][]
let savedPose = null;          // { pos, quat, orbitName }
let overlay = null;
let hintEl = null;
let hudTimer = 0;
let lastGust = 0;
const _worldCam = new THREE.Vector3();

export function isGroundActive() { return state === 'active' || state === 'exiting'; }

export function getGroundCamPos() {
  const p = getLocalPos();
  return _worldCam.set(POCKET.x + p.x, POCKET.y + getEyeY(), POCKET.z + p.z);
}

export function getGroundState() {
  if (state !== 'active') return null;
  const sun = getSunState();
  return {
    onGround: true,
    site: SITE_NAME,
    body: 'MARS',
    mode: getMode(),
    speed: getGroundSpeed(),
    sunElevDeg: sun.elevDeg,
    gust: lastGust,
  };
}

// ── The landfall affordance ──────────────────────────────────────────

export function initGround() {
  overlay = document.createElement('div');
  overlay.style.cssText =
    'position:fixed;inset:0;background:#000;z-index:350;pointer-events:none;' +
    'opacity:0;transition:opacity 1.6s ease;';
  document.body.appendChild(overlay);

  hintEl = document.createElement('div');
  hintEl.style.cssText =
    'position:fixed;bottom:96px;left:50%;transform:translateX(-50%);' +
    'font-family:inherit;font-size:11px;letter-spacing:4px;' +
    'color:rgba(255,180,110,0.55);z-index:60;opacity:0;' +
    'transition:opacity 1.8s ease;pointer-events:none;text-align:center;';
  hintEl.textContent = 'L — MAKE LANDFALL · COPRATES CHASMA';
  document.body.appendChild(hintEl);

  // The affordance breathes on its own clock — no per-frame main.js tax
  setInterval(() => {
    const offer = state === 'idle' && getOrbitBodyName() === 'MARS';
    hintEl.style.opacity = offer ? '1' : '0';
  }, 700);

  window.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
      if (!(e.code === 'KeyL' && !e.target.value)) return;  // empty line yields
      e.target.blur();
    }
    if (e.code !== 'KeyL') return;
    if (state === 'active') exitGround();
    else if (state === 'idle' && getOrbitBodyName() === 'MARS') enterGround();
  });
}

// ── Entry ────────────────────────────────────────────────────────────

export async function enterGround() {
  if (state !== 'idle') return;
  state = 'entering';

  // The veil falls first — the site loads behind it
  overlay.style.transition = 'opacity 1.6s ease';
  overlay.style.opacity = '1';

  try {
    await loadSite();
  } catch (err) {
    console.error('[ground] site load failed', err);
    overlay.style.opacity = '0';
    state = 'idle';
    return;
  }
  await wait(1700);   // let the black settle — a held breath

  const scene = getScene();
  const camera = getCamera();

  // Save the helm exactly as it stands
  const p = getCamPos(), q = getCamQuat();
  savedPose = {
    pos: { px: p.x, py: p.y, pz: p.z },
    quat: { qx: q.x, qy: q.y, qz: q.z, qw: q.w },
    orbitName: getOrbitBodyName(),
  };
  setFlightSuppressed(true);

  // The space scene sleeps — lights and all
  hiddenChildren = [];
  for (const child of scene.children) {
    hiddenChildren.push([child, child.visible]);
    child.visible = false;
  }

  rootGroup = new THREE.Group();
  setWorldPos(rootGroup, POCKET);
  scene.add(rootGroup);

  initTerrain(rootGroup);
  initSky(rootGroup, scene);
  // Bootfall: at the shelf lip, facing south-southwest and pitched
  // gently down — out over the 3.9 km drop to the canyon floor, sun
  // raking from the west. The vista is the first thing the boots see.
  initController(camera, new THREE.Vector3(0, 0, 1250), Math.PI + 0.25, -0.15);
  initDustField(rootGroup, new THREE.Vector3(0, 2, 0));
  initLamp(rootGroup);

  swapHud(true);
  setZoneOverride({ name: 'ground-mars', track: null });
  // The boots must own the keys: if the terminal input held focus
  // through the descent, WASD would type into the chat instead of walk.
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  const cv = document.getElementById('c');
  if (cv) cv.focus();
  emit('ground:enter', { name: SITE_NAME });

  state = 'active';
  await wait(400);
  overlay.style.transition = 'opacity 3.2s ease';
  overlay.style.opacity = '0';
}

// ── Exit ─────────────────────────────────────────────────────────────

export async function exitGround() {
  if (state !== 'active') return;
  state = 'exiting';

  overlay.style.transition = 'opacity 1.4s ease';
  overlay.style.opacity = '1';
  await wait(1600);

  const scene = getScene();

  disposeController();
  disposeDustField();
  disposeLamp();
  disposeSky(scene);
  disposeTerrain();
  if (rootGroup) { scene.remove(rootGroup); rootGroup = null; }

  for (const [child, wasVisible] of (hiddenChildren || [])) {
    child.visible = wasVisible;
  }
  hiddenChildren = null;

  setFlightSuppressed(false);
  const orbitRef = savedPose.orbitName
    ? getBodies().find((b) => b.name === savedPose.orbitName) || null
    : null;
  restorePose(savedPose.pos, savedPose.quat, orbitRef);

  swapHud(false);
  setZoneOverride(null);
  setGroundWind(0);
  emit('ground:exit', { name: savedPose.orbitName || 'MARS' });
  savedPose = null;

  state = 'idle';
  await wait(300);
  overlay.style.transition = 'opacity 2.6s ease';
  overlay.style.opacity = '0';
}

// ── Per-frame ────────────────────────────────────────────────────────

export function updateGround(dt) {
  if (state !== 'active' && state !== 'exiting') return null;

  const ctl = updateController(dt);
  const local = getLocalPos();

  updateTerrain(local);
  updateSky(dt, local);

  const roverK = getMode() === 'rove' ? Math.min(1, getGroundSpeed() / 20) : 0;
  lastGust = updateDustField(dt, local, roverK);
  updateLamp(dt, getSunState().elevDeg, local, getCamera().quaternion, getMode() === 'rove');

  // What you hear is what you see: base air + gusts + your own speed
  setGroundWind(0.35 + lastGust * 0.65 + roverK * 0.5 +
    (getMode() === 'walk' ? Math.min(0.25, getGroundSpeed() * 0.05) : 0));

  hudTimer -= dt;
  if (hudTimer <= 0) { hudTimer = 0.25; refreshHud(); }

  // Dev probe — written to the DOM (dataset survives script-world
  // isolation, which window properties do not under some extensions)
  if (typeof window !== 'undefined') {
    const cam = getCamera();
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    window._groundDbg = {
      pos: { x: +local.x.toFixed(1), y: +local.y.toFixed(1), z: +local.z.toFixed(1) },
      fwd: { x: +fwd.x.toFixed(2), y: +fwd.y.toFixed(2), z: +fwd.z.toFixed(2) },
      sun: getSunState().elevDeg.toFixed(1),
      mode: getMode(),
      state,
      terrain: debugTerrain(),
      sky: debugSky(),
    };
    window.__groundLine = 'p:' + local.x.toFixed(0) + ',' + local.z.toFixed(0) +
      ' v:' + getGroundSpeed().toFixed(1) + ' held:' + getHeldKeys() +
      ' rel:' + (window.__relCount || 0);
    try { document.body.dataset.groundDbg = JSON.stringify(window._groundDbg); } catch (e) {}
  }

  return getGroundState();
}

// ── The surface HUD (the dormant #surface-hud, woken in amber) ──────

const HUD_IDS_HIDE = ['crosshair', 'target-info', 'planet-bar', 'time-scale', 'nav-rail-tab', 'info-card', 'info-panel'];
let hudPrev = null;

function swapHud(onGround) {
  if (onGround) {
    hudPrev = {};
    for (const id of HUD_IDS_HIDE) {
      const el = document.getElementById(id);
      if (el) { hudPrev[id] = el.style.display; el.style.display = 'none'; }
    }
    const s = document.getElementById('surface-hud');
    if (s) {
      s.style.display = 'block';
      const name = document.getElementById('surface-planet');
      if (name) {
        name.textContent = SITE_NAME;
        name.style.color = 'rgba(255,180,110,0.75)';
      }
    }
  } else {
    for (const id of HUD_IDS_HIDE) {
      const el = document.getElementById(id);
      if (el && hudPrev) el.style.display = hudPrev[id] || '';
    }
    const s = document.getElementById('surface-hud');
    if (s) s.style.display = 'none';
    hudPrev = null;
  }
}

function refreshHud() {
  const site = getSite();
  const local = getLocalPos();
  const elevMsl = site.landingElev + (local.y - 1.65);
  const sun = getSunState();
  const cfg = getPlanetConfig('MARS');
  const set = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };
  const spd = getGroundSpeed();
  set('surface-alt', `ELEV ${(elevMsl / 1000).toFixed(2)} KM · ${getMode() === 'rove' ? 'ROVER' : 'ON FOOT'}${spd > 0.2 ? ` · ${spd.toFixed(1)} M/S` : ''}`);
  const east = (local.x / 1000).toFixed(1), south = (local.z / 1000).toFixed(1);
  set('surface-coords', `SITE +E ${east} KM · +S ${south} KM`);
  const t = cfg && cfg.surface && cfg.surface.temperature;
  // Cold that follows the sun down
  const temp = t ? Math.round(t.value - 40 + 55 * Math.max(0, Math.sin(THREE.MathUtils.degToRad(sun.elevDeg)))) : null;
  set('surface-temp', temp !== null ? `${temp} °C` : '');
  set('surface-pressure', `SUN ${sun.elevDeg > 0 ? '+' : ''}${sun.elevDeg.toFixed(0)}° · 6 mbar`);
}

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
