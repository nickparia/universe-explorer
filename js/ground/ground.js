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
import { setZoneOverride, setMusicDuck } from '../music.js';
import { setGroundWind, setRoverBed } from '../soundscape.js';
import { loadSite, getSite } from './site.js';
import { initTerrain, updateTerrain, disposeTerrain, debugTerrain } from './terrain.js';
import { initSky, updateSky, disposeSky, getSunState, debugSky, setSkyGust, getWeather } from './sky.js';
import { initController, updateController, disposeController, getLocalPos, getMode, getGroundSpeed, getEyeY, getHeldKeys, getVisOffset, toggleGait } from './controller.js';
import { initDustField, updateDustField, disposeDustField } from './dust.js';
import { initLamp, updateLamp, disposeLamp } from './lamp.js';
import { initRocks, updateRocks, disposeRocks } from './rocks.js';
import { initDevils, updateDevils, disposeDevils } from './devils.js';
import { initGroundHud, updateGroundHud, disposeGroundHud } from './hud.js';
import { initGroundMap, updateGroundMap, disposeGroundMap } from './map.js';
import { initStakes, disposeStakes, updateStakes, nearestStake, getStakes, uprootNear, stakeDef, getSupply, getSupplyEta } from './stakes.js';
import { initBuild, disposeBuild, beginPlacement, cancelPlacement, commitPlacement, updatePlacement, isPlacing } from './build.js';
import { startDescent, startAscent, updateDescent, getDescentPos, fadePlasma, disposeDescent, tickSmoke } from './descent.js';
import { stepCrunch } from '../soundscape.js';
import { heightAt } from './site.js';

const POCKET = new THREE.Vector3(0, 6e8, 0);  // far above the galactic plane
const SITE_NAME = 'COPRATES CHASMA';

let state = 'idle';            // idle | entering | descending | active | ascending
let rootGroup = null;
let hiddenChildren = null;     // [obj, wasVisible][]
let savedPose = null;          // { pos, quat, orbitName }
let overlay = null;
let hintEl = null;
let lastGust = 0;
const _worldCam = new THREE.Vector3();

export function isGroundActive() { return state === 'active' || state === 'descending' || state === 'ascending'; }

export function getGroundCamPos() {
  if (state === 'descending' || state === 'ascending') {
    const d = getDescentPos();
    return _worldCam.set(POCKET.x + d.x, POCKET.y + d.y, POCKET.z + d.z);
  }
  const p = getLocalPos();
  const v = getVisOffset();
  return _worldCam.set(POCKET.x + p.x + v.x, POCKET.y + getEyeY(), POCKET.z + p.z + v.z);
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

  // Top-center: the bottom band belongs to field notes, the info panel
  // and the time scale — the greeting toast was landing on this line.
  // Up here it reads as an approach annunciator, alone in its airspace.
  hintEl = document.createElement('div');
  hintEl.style.cssText =
    'position:fixed;top:88px;left:50%;transform:translateX(-50%);' +
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
      if (!((e.code === 'KeyL' || e.code === 'KeyE') && !e.target.value)) return;  // empty line yields
      e.target.blur();
    }
    if (e.code === 'KeyE' && state === 'active') {
      const p = getLocalPos();
      if (isPlacing()) { commitPlacement(); return; }
      if (uprootNear(p.x, p.z)) return;
      beginPlacement(stakeDef());
      return;
    }
    if (e.code === 'Escape' && isPlacing()) { cancelPlacement(); return; }
    if (e.code !== 'KeyL') return;
    if (state === 'active') exitGround();
    else if (state === 'idle' && getOrbitBodyName() === 'MARS') enterGround();
  });
}

// ── Entry ────────────────────────────────────────────────────────────

export async function enterGround() {
  if (state !== 'idle') return;
  state = 'entering';

  // The suit seals: landfall takes the whole screen. In fullscreen,
  // Chrome merges its pointer-capture notice into one bubble per
  // session instead of one per drag. Esc hands the screen back and
  // we never force it again until the next landfall.
  try {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    }
  } catch (e) { /* not offered — fine */ }

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
  await wait(900);    // a breath of black — the blackout is the cut

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
  initDustField(rootGroup, new THREE.Vector3(0, 2, 0));
  initLamp(rootGroup);
  initRocks(rootGroup);
  updateRocks(new THREE.Vector3(0, 0, 0));
  initDevils(rootGroup);
  initGroundHud(SITE_NAME, {
    onGait: toggleGait,
    onLiftoff: () => exitGround(),
    onStake: () => {
      const p2 = getLocalPos();
      if (isPlacing()) { commitPlacement(); return; }
      if (uprootNear(p2.x, p2.z)) return;
      beginPlacement(stakeDef());
    },
  });
  initGroundMap();
  initStakes(rootGroup);
  initBuild(rootGroup);

  swapHud(true);
  setZoneOverride({ name: 'ground-mars', track: null });
  // On the ground the place is the music: the library ducks to a
  // whisper (the Bootes law), and the canyon's own tone carries.
  setMusicDuck(0.94);
  // The boots must own the keys: if the terminal input held focus
  // through the descent, WASD would type into the chat instead of walk.
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  const cv = document.getElementById('c');
  if (cv) cv.focus();
  emit('ground:enter', { name: SITE_NAME });

  // Out of blackout twelve kilometers up: the descent corridor flies
  // the whole canyon down to the landing, then hands the boots the
  // keys. The vista heading/pitch ride in the baked site metadata.
  const landMeta = getSite().meta.landing || {};
  const vYaw = landMeta.yaw ?? Math.PI + 0.25;
  const vPitch = landMeta.pitch ?? -0.15;
  const endLocal = new THREE.Vector3(0, heightAt(0, 0), 0);
  state = 'descending';
  startDescent(camera, rootGroup, endLocal, vYaw, vPitch, () => {
    initController(camera, new THREE.Vector3(0, 0, 0), vYaw, vPitch);
    stepCrunch(1.25, true);   // the shelf takes the weight
    const cv2 = document.getElementById('c');
    if (cv2) cv2.focus();
    state = 'active';
  });
  overlay.style.transition = 'opacity 0.7s ease';
  overlay.style.opacity = '0';
}

// ── Exit ─────────────────────────────────────────────────────────────

export function exitGround() {
  if (state !== 'active') return;
  state = 'ascending';

  // The climb-out: canyon dropping away, sky thinning, plasma washing
  // in — the teardown happens behind the sheath.
  const from = getLocalPos().clone();
  from.y = getEyeY();
  const camera = getCamera();
  disposeController();
  startAscent(camera, rootGroup, from, () => {
    const scene = getScene();
    disposeDustField();
    disposeLamp();
    disposeRocks();
    disposeDevils();
    disposeGroundHud();
    disposeGroundMap();
    disposeStakes();
    disposeBuild();
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
    setMusicDuck(0);
    setGroundWind(0);
    emit('ground:exit', { name: savedPose.orbitName || 'MARS' });
    savedPose = null;
    state = 'idle';

    // Orbit resolves out of the fading sheath
    fadePlasma(1.8);
    disposeDescent();
  });
}

// ── Per-frame ────────────────────────────────────────────────────────

export function updateGround(dt) {
  if (state === 'descending' || state === 'ascending') {
    const d = updateDescent(dt);
    if (!d) return null;
    const local = getDescentPos();
    updateTerrain(local);
    updateSky(dt, local);
    if (local.y < 600) updateRocks(local);
    lastGust = updateDustField(dt, local, 0, getWeather());
    updateDevils(dt, local, getWeather());
    setSkyGust(lastGust);
    // The air roars out of blackout and calms with the deceleration —
    // or builds again on the climb — and the retro engines hum under it
    setGroundWind(state === 'descending' ? 2.1 * (1 - d.frac) + 0.5 : 0.4 + 1.9 * d.frac);
    setRoverBed(state === 'descending' ? Math.max(0.3, d.frac) : Math.max(0.3, 1 - d.frac));
    const cam = getCamera();
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const heading = ((Math.atan2(fwd.x, -fwd.z) * 180 / Math.PI) + 360) % 360;
    const site = getSite();
    const sun = getSunState();
    updateGroundHud(dt, {
      heading,
      elevMsl: site.landingElev + local.y,
      tempC: Math.round(-103 + 55 * Math.max(0, Math.sin(THREE.MathUtils.degToRad(sun.elevDeg)))),
      sunElev: sun.elevDeg,
      speed: d.speed,
      mode: state === 'descending' ? 'descent' : 'ascent',
      run: false,
      gust: lastGust,
    });
    updateGroundMap(dt, local, heading);
    return null;
  }
  if (state !== 'active') return null;

  const ctl = updateController(dt) || {};
  const local = getLocalPos();
  tickSmoke(dt);   // the touchdown blast settles behind the bootfall

  updateTerrain(local);
  updateSky(dt, local);
  updateRocks(local);

  const roverK = getMode() === 'rove' ? Math.min(1, getGroundSpeed() / 20) : 0;
  lastGust = updateDustField(dt, local, roverK, getWeather());
  const devilNear = updateDevils(dt, local, getWeather());
  setSkyGust(lastGust);
  updateLamp(dt, getSunState().elevDeg, local, getCamera().quaternion, getMode() === 'rove');
  updateStakes(local, getSunState().elevDeg, dt);
  let placeStatus = null;
  {
    const cam0 = getCamera();
    const f0 = new THREE.Vector3(0, 0, -1).applyQuaternion(cam0.quaternion);
    placeStatus = updatePlacement(local, Math.atan2(-f0.x, -f0.z), getMode() === 'rove');
  }

  // What you hear is what you see: base air + gusts + your own speed —
  // and a dust devil passing close roars over all of it
  setGroundWind(0.35 + lastGust * 0.65 + roverK * 0.5 + devilNear * 1.3 +
    (getMode() === 'walk' ? Math.min(0.25, getGroundSpeed() * 0.05) : 0));

  // The suit's glass — compass every frame, text at its own cadence
  {
    const cam = getCamera();
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const heading = ((Math.atan2(fwd.x, -fwd.z) * 180 / Math.PI) + 360) % 360;
    const site = getSite();
    const sun = getSunState();
    const cfg = getPlanetConfig('MARS');
    const baseT = (cfg && cfg.surface && cfg.surface.temperature) ? cfg.surface.temperature.value : -63;
    updateGroundHud(dt, {
      heading,
      elevMsl: site.landingElev + (local.y - 1.65),
      tempC: Math.round(baseT - 40 + 55 * Math.max(0, Math.sin(THREE.MathUtils.degToRad(sun.elevDeg)))),
      sunElev: sun.elevDeg,
      speed: getGroundSpeed(),
      mode: getMode(),
      run: !!ctl.run,
      rollDeg: (ctl.roll || 0) * 180 / Math.PI,
      gust: lastGust,
      pitchDeg: Math.asin(Math.max(-1, Math.min(1, fwd.y))) * 180 / Math.PI,
      marks: (() => {
        const out = [{ bearing: ((Math.atan2(0 - local.x, -(0 - local.z)) * 180 / Math.PI) + 360) % 360, pad: true }];
        for (const st of getStakes()) {
          out.push({ bearing: ((Math.atan2(st.x - local.x, -(st.z - local.z)) * 180 / Math.PI) + 360) % 360 });
        }
        return out;
      })(),
      nearStake: (() => { const n = nearestStake(local.x, local.z); return n && n.dist < 8 ? { n: n.stake.n, dist: n.dist, readings: n.stake.readings } : null; })(),
      inReach: (() => { const n = nearestStake(local.x, local.z); return !!(n && n.dist < 3); })(),
      placing: isPlacing(),
      placeBlocked: placeStatus ? placeStatus.blocked : null,
      supply: getSupply(),
      supplyEtaMin: Math.ceil(getSupplyEta() / 60000),
    });
    updateGroundMap(dt, local, heading);
  }

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
    // the dormant #surface-hud stays dormant — the suit has its own glass now
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

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
