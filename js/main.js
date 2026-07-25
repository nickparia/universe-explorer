// js/main.js — Universe Explorer entry point
// Wires all modules together: engine, textures, bodies, deep space, flight, music, HUD

import { initEngine, getSunLight, createSkybox, createStars, applyCameraRelative, setStarFieldOpacity, updateStarFieldOpacity, updateMilkyWayRotation, setSkyboxOpacity, setMilkyWayOpacity } from './engine.js';
import { runBenchmark, getTier, getConfig, adaptTier } from './perf.js';
import { loadAllTextures } from './textures.js';
import { createSolarSystem, updateBodies, getBodies } from './bodies.js';
import { createDeepSpace, updateDeepSpace, getDeepSpaceObjects, getLandmarks } from './deepspace.js';
import { initFlight, updateFlight, getCamPos, getSpeed, getVelocity, getSpeedFeel, doHome, startIntro, beginIntroAnimation, isIntroPlaying, startAtVista, flyTo, warpTo } from './flight.js';
import { initFieldNotes } from './fieldnotes.js';
import { initShipChat } from './shipchat.js';
import { initDust, updateDust } from './dust.js';
import { initHoverSelect, updateHoverSelect } from './hover-select.js';
import { initMusic, updateMusic } from './music.js';
import { initHud, updateHud } from './hud.js';
import { initNavigation, updateNavigation, getTimeScale } from './navigation.js';
import { initStarMap, updateStarMap, isStarMapOpen, toggleStarMap } from './starmap.js';
import { initAtmoEffects, updateAtmoEffects } from './atmosphere/effects.js';
import { initGasGiantHud, updateGasGiantDive } from './atmosphere/gasgiant.js';
import { updateAtmosphere } from './atmosphere/scatter.js';
import { updateAltitude, getAltitude } from './altitude.js';
import { updateTerrain } from './terrain/manager.js';
import { AU } from './constants.js';
import * as THREE from 'three';

async function boot() {
  // Gentle fade from black — created first so it covers everything the
  // renderer does while booting. Fades out once the vista is composed.
  const bootFade = document.createElement('div');
  bootFade.id = 'boot-fade';
  bootFade.style.cssText =
    'position:fixed;inset:0;background:#000;z-index:400;pointer-events:none;' +
    'opacity:1;transition:opacity 3.2s ease-out;';
  document.body.appendChild(bootFade);

  // 1. Hide setup — the loading screen is intentionally left hidden.
  // Texture loading happens behind a plain black canvas, then the hero
  // landing page (just "solace" over the Milky Way) appears when ready.
  // No "UNIVERSE EXPLORER / 8K PHOTOREALISTIC / LOADING" splash to break
  // the vibe.
  const setupEl = document.getElementById('setup');
  if (setupEl) setupEl.style.display = 'none';

  // 2. Initialize renderer + post-processing
  const { scene, camera, composer, renderer } = initEngine();
  // 'renderer' is still destructured for perf benchmarking below; composer is
  // what we actually render through each frame.

  // 2b. GPU performance benchmark
  const perfTier = runBenchmark(renderer);
  console.log(`[boot] Performance tier: ${perfTier}`, getConfig());

  // 3. Load all textures (no progress UI — keeps the experience quiet)
  const textures = await loadAllTextures(() => {});

  // 4. Create skybox and stars
  createSkybox(textures.starmap);
  createStars();

  // 5. Build solar system
  createSolarSystem(scene, textures);

  // 6. Build deep space content
  createDeepSpace(scene, textures);
  initDust(scene);

  // 7. Initialize flight controls
  initFlight(camera);

  // 8. Initialize music system
  const music = initMusic();

  // 9. Initialize HUD
  initHud();
  initNavigation(camera);
  initStarMap();
  initAtmoEffects();
  initGasGiantHud();

  // Wire the left-rail nav tab → opens the destinations drawer
  const navTab = document.getElementById('nav-rail-tab');
  if (navTab) {
    navTab.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleStarMap();
    });
  }

  // True while the opening title floats over the vista — suppresses
  // click-to-travel so the dismissing click can't also fly you somewhere.
  let titleActive = true;

  // Click-in-world navigation — hover any celestial body to see its name,
  // click to travel there. Suppressed during cinematic / map / title.
  initHoverSelect({
    camera,
    getBodies: () => getBodies().concat(getDeepSpaceObjects()),
    getCamPos,
    flyTo,
    warpTo,
    suppress: () => {
      if (isIntroPlaying()) return true;
      if (isStarMapOpen()) return true;
      if (titleActive) return true;
      return false;
    },
  });

  // 10. Fade out loading screen and auto-start
  const hudEl = document.getElementById('hud');
  if (hudEl) hudEl.style.display = 'block';

  const canvas = document.getElementById('c');
  if (canvas) canvas.focus();

  // Defer music start until first user interaction (browser requires gesture for audio)
  function startMusicOnGesture() {
    music.start();
    window.removeEventListener('click', startMusicOnGesture);
    window.removeEventListener('keydown', startMusicOnGesture);
  }
  window.addEventListener('click', startMusicOnGesture);
  window.addEventListener('keydown', startMusicOnGesture);

  // Debug: expose for testing
  window._dbg = { getCamPos, getSpeed, getBodies, getDeepSpaceObjects };

  // Make sure any legacy loading/overlay screens never show
  const legacyIds = ['loading', 'overlay'];
  for (const id of legacyIds) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }

  // ── Opening: wake up already in the world ────────────────────────────────
  // No forced journey. Pick a hero vista, start in a slow cinematic orbit
  // of it, float the title over the live view. First input hands over the
  // controls instantly. "Begin from the stars" runs the old galaxy intro
  // as an opt-in ride (now skippable).
  initFieldNotes();
  initShipChat();

  // Per-body composition: distance (in radii), polar angle (rad — smaller
  // is higher above the ecliptic; Saturn needs height so the tilted rings
  // open up instead of showing edge-on), and azimuth offset from the
  // sunward axis (rad — how far the terminator rakes across the face).
  const VISTAS = [
    { name: 'SATURN',  dist: 5.4, phi: Math.PI / 3.4, theta: 0.5 },
    { name: 'EARTH',   dist: 4.0, phi: Math.PI / 2.5, theta: 0.6 },
    { name: 'JUPITER', dist: 4.4, phi: Math.PI / 2.7, theta: 0.55 },
    { name: 'NEPTUNE', dist: 4.2, phi: Math.PI / 2.6, theta: 0.6 },
  ];
  let vistaIdx = 0;
  try {
    vistaIdx = parseInt(localStorage.getItem('solace_vista') || '0', 10) % VISTAS.length;
    localStorage.setItem('solace_vista', String((vistaIdx + 1) % VISTAS.length));
  } catch (e) { /* private mode — always Saturn, no tragedy */ }

  // One zero-dt pass so every body has its world position before we compose
  updateBodies(0, getCamPos());
  const vista = VISTAS[vistaIdx];
  const vistaBody = getBodies().find(b => b.name === vista.name) || getBodies()[0];

  // Sky state for "inside the Milky Way" (what endIntro would set)
  setSkyboxOpacity(0.9);
  setMilkyWayOpacity(0.0);
  startAtVista(vistaBody, vista);

  // The reveal is triggered from the render loop's first real frame —
  // an rAF here fires while the main thread is still decoding textures,
  // which would start (and waste) the fade behind a stalled compositor.
  let bootFadeStarted = false;
  function revealWorld() {
    if (bootFadeStarted) return;
    bootFadeStarted = true;
    bootFade.style.opacity = '0';
    setTimeout(() => { if (bootFade.parentNode) bootFade.parentNode.removeChild(bootFade); }, 3500);
    setTimeout(dismissTitle, 8000); // title dissolves on its own
  }

  // Title overlay over the live orbit — no instructions, no choices.
  // The title simply holds for a few breaths after the fade-in and
  // dissolves; any input dismisses it early. You are already flying.
  const titleEl = document.getElementById('hero-title');
  if (titleEl) titleEl.style.opacity = '1';

  let titleDismissing = false;
  function dismissTitle() {
    if (titleDismissing) return;
    titleDismissing = true;
    // Keep click-to-travel suppressed briefly so a dismissing click
    // can't also fly you at whatever planet was under the cursor
    setTimeout(() => { titleActive = false; }, 400);
    window.removeEventListener('keydown', dismissTitle);
    window.removeEventListener('mousedown', dismissTitle);
    window.removeEventListener('touchstart', dismissTitle);
    if (titleEl) titleEl.style.opacity = '0';
  }

  window.addEventListener('keydown', dismissTitle);
  window.addEventListener('mousedown', dismissTitle);
  window.addEventListener('touchstart', dismissTitle);

  // 11. Main render loop
  let lastTime = performance.now();
  const sunLight = getSunLight();
  const bootesVoidLandmark = getLandmarks().find(lm => lm.name === 'BOOTES VOID');

  let _frameCount = 0;
  function animate() {
    requestAnimationFrame(animate);
    if (++_frameCount === 2) revealWorld();
    const now = performance.now();
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    adaptTier(now - lastTime);
    lastTime = now;
    const elapsed = now * 0.001;

    // Update orbital mechanics (scaled by time control)
    const ts = getTimeScale();
    updateBodies(dt * ts, getCamPos());

    // Update deep space (accretion disk rotation etc)
    updateDeepSpace(dt * ts, getCamPos());

    // Gather all bodies for physics + HUD
    const allBodies = getBodies().concat(getDeepSpaceObjects());

    // Update flight physics
    updateFlight(dt, allBodies, dtWall);

    // Motion-parallax dust (reads speed feel computed by flight)
    updateDust(dt, getCamPos(), getVelocity(), getSpeedFeel());

    // Update altitude tracking
    updateAltitude(getCamPos(), allBodies);

    // Update terrain LOD
    updateTerrain(scene, getCamPos());

    // Update atmosphere — sun is at world origin, camera-relative = -camPos
    updateAtmosphere(scene, getCamPos(), getCamPos().clone().negate());

    // Update HUD
    updateHud(getCamPos(), getSpeed(), allBodies);

    // Atmospheric entry effects
    updateAtmoEffects(dt, getCamPos(), getVelocity(), camera, scene);

    // Gas giant dive system
    const diveState = updateGasGiantDive(dt, getCamPos(), getVelocity());

    // Update navigation markers
    updateNavigation(dt, getCamPos(), getSpeed(), allBodies);

    // Update star map overlay
    updateStarMap();

    // Update music zones
    updateMusic(getCamPos(), allBodies);

    // Bootes Void — when you're inside the supervoid everything around
    // you should go dark: star particles, the equirectangular Milky Way
    // skybox (which is an "Earth-view" image and doesn't belong 330Mly
    // away), and the 3D particle galaxy. Outside the void, all restore.
    if (bootesVoidLandmark && !isIntroPlaying()) {
      const distToVoid = getCamPos().distanceTo(bootesVoidLandmark.pos);
      const fadeOuterR = bootesVoidLandmark.radius * 6;
      const fadeInnerR = bootesVoidLandmark.radius * 1.0;
      if (distToVoid < fadeOuterR) {
        const t = Math.max(0, Math.min(1, (distToVoid - fadeInnerR) / (fadeOuterR - fadeInnerR)));
        const smoothed = t * t;  // quadratic falloff
        setStarFieldOpacity(smoothed * 0.8);
        // Also fade the skybox — this is the key fix for "the void has
        // more stars than anywhere else." The starmap image was wrapping
        // the camera even at the void, showing the Milky Way band.
        setSkyboxOpacity(smoothed * 0.4);
      } else {
        setStarFieldOpacity(1.0);
      }
    }
    updateStarFieldOpacity(dt);

    // Hide distant landmark groups — only show the one you're near
    {
      const camP = getCamPos();
      const allLandmarks = getLandmarks();
      for (const lm of allLandmarks) {
        const d = camP.distanceTo(lm.pos);
        const showRange = lm.radius * 5; // only visible when approaching
        lm.anchor.visible = d < showRange;
      }
    }

    // Milky Way rotation — noticeable sweep while the landing page /
    // intro is up, near-imperceptible once the user is free-flying.
    updateMilkyWayRotation(dt, isIntroPlaying() ? 4 : 0.5);

    // Sun light flicker — subtle variation around base intensity
    if (sunLight) {
      sunLight.intensity = 3.0 + Math.sin(elapsed * 6.2) * 0.05 + Math.sin(elapsed * 2.7) * 0.02;
    }

    // Black hole event horizon — flash + return home when too close
    {
      const bhObjects = getDeepSpaceObjects().filter(o => o.isBlackHole);
      if (bhObjects.length > 0) {
        const bh = bhObjects[0];
        const bhWorldPos = new THREE.Vector3();
        bh.g.getWorldPosition(bhWorldPos);
        const distToBH = getCamPos().distanceTo(bhWorldPos);
        if (distToBH < bh.r * 1.5) {
          const flash = document.getElementById('horizon-flash');
          if (flash && flash.style.opacity !== '1') {
            flash.style.transition = 'opacity 0.3s';
            flash.style.opacity = '1';
            setTimeout(() => {
              flash.style.transition = 'opacity 2s';
              flash.style.opacity = '0';
            }, 300);
            doHome();
          }
        }
      }
    }

    // Camera-relative rendering — shift world so camera is at origin
    applyCameraRelative(getCamPos());

    // Click-in-world hover: raycast against current (camera-relative)
    // scene transforms. Must run AFTER applyCameraRelative and BEFORE
    // render so the cursor always matches what you see.
    updateHoverSelect();

    // Hide solar-system-only particles (asteroid/Kuiper belts) when far from origin
    const distFromOrigin = getCamPos().length();
    const solarSystemThreshold = 200 * AU;
    scene.traverse((child) => {
      if (child.userData._solarSystemOnly) {
        child.visible = distFromOrigin < solarSystemThreshold;
      }
    });

    composer.render();
  }

  animate();
}

// Auto-boot if served via HTTP, otherwise show setup screen
const isServed = location.protocol === 'http:' || location.protocol === 'https:';
if (isServed) {
  boot();
} else {
  const setupEl = document.getElementById('setup');
  if (setupEl) setupEl.style.display = 'flex';
  const proceedBtn = document.getElementById('proceed-btn');
  if (proceedBtn) proceedBtn.addEventListener('click', boot);
}
