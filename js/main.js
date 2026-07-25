// js/main.js — Universe Explorer entry point
// Wires all modules together: engine, textures, bodies, deep space, flight, music, HUD

import { initEngine, getSunLight, createSkybox, createStars, applyCameraRelative, setStarFieldOpacity, updateStarFieldOpacity, updateMilkyWayRotation, setSkyboxOpacity, setMilkyWayOpacity } from './engine.js';
import { runBenchmark, getTier, getConfig, adaptTier } from './perf.js';
import { loadAllTextures } from './textures.js';
import { createSolarSystem, updateBodies, getBodies } from './bodies.js';
import { createDeepSpace, updateDeepSpace, getDeepSpaceObjects, getLandmarks } from './deepspace.js';
import { initFlight, updateFlight, getCamPos, getSpeed, getVelocity, getSpeedFeel, doHome, isIntroPlaying, startArrival, skipArrival, flyTo, warpTo } from './flight.js';
import { initFieldNotes } from './fieldnotes.js';
import { initShipChat } from './shipchat.js';
import { initDust, updateDust } from './dust.js';
import { initSession, getResumePose } from './session.js';
import { initSoundscape, startSoundscape } from './soundscape.js';
import { restorePose } from './flight.js';
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
    'opacity:1;transition:opacity 1.6s ease-out;';
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
    startSoundscape();
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

  // ── Opening: one continuous shot, no prompts ─────────────────────────────
  // Fade from black far beyond Earth, looking sunward. The word looms,
  // accelerates, and the camera flies through it — settling behind Earth
  // so the night side silhouettes against the Sun. Orbit drift then
  // slowly brings dawn around the limb. Any input skips.
  initFieldNotes();
  initShipChat();
  initSession();
  initSoundscape();

  // One zero-dt pass so every body has its world position before we compose
  updateBodies(0, getCamPos());
  const earthBody = getBodies().find(b => b.name === 'EARTH') || getBodies()[0];

  setSkyboxOpacity(0.9);
  setMilkyWayOpacity(0.0);

  // Returning travelers resume where they left off — the title sequence
  // belongs to first arrivals (and long absences). The ship remembers.
  const resume = getResumePose();
  if (resume) {
    const orbitRef = resume.orbit
      ? getBodies().concat(getDeepSpaceObjects()).find(b => b.name === resume.orbit)
      : null;
    restorePose(resume, resume, orbitRef || null);
  } else {
    startArrival(earthBody, { duration: 8 });
  }

  const titleEl = document.getElementById('hero-title');
  let titleAnim = null;

  function skipOpening() {
    window.removeEventListener('keydown', skipOpening);
    window.removeEventListener('mousedown', skipOpening);
    window.removeEventListener('touchstart', skipOpening);
    skipArrival();
    if (titleAnim) titleAnim.finish();
    else if (titleEl) titleEl.remove();
    titleActive = false;
  }
  if (resume) {
    // No ceremony on return — remove the title and hand over instantly
    if (titleEl) titleEl.remove();
    titleActive = false;
  } else {
    window.addEventListener('keydown', skipOpening);
    window.addEventListener('mousedown', skipOpening);
    window.addEventListener('touchstart', skipOpening);
  }

  // The reveal is triggered from the render loop's first real frame —
  // an rAF here fires while the main thread is still decoding textures,
  // which would start (and waste) the fade behind a stalled compositor.
  let bootFadeStarted = false;
  function revealWorld() {
    if (bootFadeStarted) return;
    bootFadeStarted = true;
    bootFade.style.opacity = '0';
    setTimeout(() => { if (bootFade.parentNode) bootFade.parentNode.removeChild(bootFade); }, 2000);

    // The word: fade large, loom, then blow past the camera. Timed to the
    // 8s arrival glide — the letters tear past as the camera crosses.
    if (!resume && titleEl) {
      titleEl.style.transition = 'none';
      // Pin one high-res raster: double the font, halve the scale range —
      // Chrome re-rasterizing mid-scale is what makes animated text "jump".
      titleEl.style.fontSize = 'clamp(88px, 14vw, 192px)';
      titleEl.style.willChange = 'transform, opacity';
      // Scale rides ONE continuous accelerating curve (the loom is simply
      // its slow beginning) — per-segment easings had velocity seams that
      // read as hitches. Opacity runs on its own seam-free track.
      titleEl.animate([
        { transform: 'translate(-50%, -50%) scale(0.47)' },
        { transform: 'translate(-50%, -50%) scale(9)' },
      ], { duration: 7000, easing: 'cubic-bezier(0.8, 0, 0.9, 0.4)', fill: 'forwards' });
      titleAnim = titleEl.animate([
        { opacity: 0 },
        { opacity: 1, offset: 0.3 },
        { opacity: 1, offset: 0.82 },
        { opacity: 0 },
      ], { duration: 7000, easing: 'linear', fill: 'forwards' });
      titleAnim.onfinish = () => { if (titleEl.parentNode) titleEl.remove(); };
    }
    // Release click-to-travel once the shot has settled
    setTimeout(() => { titleActive = false; }, 8600);
  }

  // 11. Main render loop
  let lastTime = performance.now();
  const sunLight = getSunLight();
  const bootesVoidLandmark = getLandmarks().find(lm => lm.name === 'BOOTES VOID');

  let _frameCount = 0;
  function animate() {
    requestAnimationFrame(animate);
    if (++_frameCount === 2) revealWorld();
    const now = performance.now();
    // dt is clamped for physics stability; dtWall is real elapsed time so
    // scripted travel keeps progressing while the tab is backgrounded
    const dtWall = (now - lastTime) / 1000;
    const dt = Math.min(dtWall, 0.05);
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

    // Fade distant landmarks in/out smoothly — a hard visibility toggle
    // reads as the whole nebula popping into existence mid-departure.
    {
      const camP = getCamPos();
      const allLandmarks = getLandmarks();
      for (const lm of allLandmarks) {
        const d = camP.distanceTo(lm.pos);
        const fadeStart = lm.radius * 4.0;
        const fadeEnd = lm.radius * 7.0;
        const f = d <= fadeStart ? 1 : d >= fadeEnd ? 0 :
          1 - (d - fadeStart) / (fadeEnd - fadeStart);
        if (f <= 0) {
          lm.anchor.visible = false;
          continue;
        }
        lm.anchor.visible = true;
        if (Math.abs((lm._fade ?? -1) - f) > 0.02) {
          lm._fade = f;
          lm.anchor.traverse((o) => {
            if (o.material) {
              if (o.material.userData._baseOpacity === undefined) {
                o.material.userData._baseOpacity = o.material.opacity;
              }
              o.material.opacity = o.material.userData._baseOpacity * f;
            }
          });
        }
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
