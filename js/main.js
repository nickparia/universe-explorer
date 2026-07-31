// js/main.js — Universe Explorer entry point
// Wires all modules together: engine, textures, bodies, deep space, flight, music, HUD

import { initEngine, getSunLight, createSkybox, createStars, applyCameraRelative, setStarFieldOpacity, updateStarFieldOpacity, updateMilkyWayRotation, setSkyboxOpacity, setMilkyWayOpacity, updateStarParallax, updateSkyDrift, setWarpStarMode, setGalaxyInteriorFactor, GALACTIC_CENTER } from './engine.js';
import { runBenchmark, getTier, getConfig, adaptTier } from './perf.js';
import { loadAllTextures } from './textures.js';
import { createSolarSystem, updateBodies, getBodies, setHomeBeaconFactor } from './bodies.js';
import { createDeepSpace, updateDeepSpace, getDeepSpaceObjects, getLandmarks } from './deepspace.js';
import { initFlight, updateFlight, getCamPos, getSpeed, getVelocity, getSpeedFeel, doHome, isIntroPlaying, startArrival, skipArrival, flyTo, warpTo } from './flight.js';
import { initFieldNotes } from './fieldnotes.js';
import { initShipChat } from './shipchat.js';
import { updateCompanionMark } from './companion-mark.js';
import { initCompanion, updateCompanion } from './companion.js';
import { initDust, updateDust } from './dust.js';
import { initTransit, updateTransit } from './transit.js';
import { initAutopilot, updateAutopilot } from './autopilot.js';
import { initSession, getResumePose } from './session.js';
import { initCrew } from './crew.js';
import { initSignon } from './signon.js';
import { on } from './bus.js';
import { initSoundscape, startSoundscape, updateSoundscape, setVoidHush } from './soundscape.js';
import { restorePose, settleIntoNearestOrbit } from './flight.js';
import { initHoverSelect, updateHoverSelect } from './hover-select.js';
import { initMusic, updateMusic, setMusicDuck } from './music.js';
import { initHud, updateHud } from './hud.js';
import { initNavigation, updateNavigation, getTimeScale } from './navigation.js';
import { initStarMap, updateStarMap, isStarMapOpen, toggleStarMap } from './starmap.js';
import { initAtmoEffects, updateAtmoEffects } from './atmosphere/effects.js';
import { initGasGiantHud, updateGasGiantDive } from './atmosphere/gasgiant.js';
import { updateAtmosphere } from './atmosphere/scatter.js';
import { updateAltitude, getAltitude } from './altitude.js';
import { updateTerrain } from './terrain/manager.js';
import { initGround, updateGround, isGroundActive, getGroundCamPos, enterGround, exitGround } from './ground/ground.js';
import { AU, MILKY_WAY_RADIUS } from './constants.js';
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
  createStars(textures);

  // 5. Build solar system
  createSolarSystem(scene, textures);

  // 6. Build deep space content
  createDeepSpace(scene, textures);
  initDust(scene);
  initTransit(scene);
  initAutopilot();

  // 6b. Pre-warm the GPU behind the boot veil: compile every shader and
  // upload every texture NOW — three.js does both lazily on first draw,
  // which showed up as hitches the first time a destination (three
  // ~2200px canvas layers each) faded into view mid-journey.
  {
    const lms = getLandmarks();
    const prevVis = lms.map((l) => l.anchor.visible);
    lms.forEach((l) => { l.anchor.visible = true; });
    renderer.compile(scene, camera);
    scene.traverse((o) => {
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of mats) {
        if (m.map) renderer.initTexture(m.map);
      }
    });
    lms.forEach((l, i) => { l.anchor.visible = prevVis[i]; });
  }

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
      if (isGroundActive()) return true;
      return false;
    },
  });

  // Groundside mode — Phase 0 of docs/LOOP.md. The landfall key only
  // offers itself in Mars orbit; everything else lives in js/ground/.
  initGround();

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
  // The sign-on terminal swallows its keystrokes (stopPropagation), so
  // the gesture that types a crew name never reaches the listeners
  // above — yet it IS a user activation, so audio may begin. Start the
  // sound with the reveal, not minutes later at the next stray click.
  on('signon:closed', startMusicOnGesture);
  // And try immediately: a passive traveler may not touch anything for
  // minutes — the whole point of the ship is watching. Returning
  // visitors usually carry autoplay rights (media engagement), so this
  // just works; where it's blocked, updateMusic keeps retrying and the
  // first real input lands within a couple of seconds.
  music.start();

  // Debug: expose for testing
  window._dbg = { getCamPos, getSpeed, getBodies, getDeepSpaceObjects,
    land: enterGround, liftoff: exitGround };
  // Dev-only deterministic bootfall: /?land=1 goes straight to the
  // ground once the world exists — no intro race, no manual timing.
  // Also paints a heartbeat line (frames, ground flag, last error) so
  // remote screenshots carry ground truth.
  const _q = new URLSearchParams(location.search);
  if (_q.get('debug') === '1' || _q.get('land') === '1') {
    const hb = document.createElement('div');
    hb.id = 'dev-heartbeat';
    hb.style.cssText = 'position:fixed;bottom:4px;left:8px;z-index:9999;' +
      'font:11px monospace;color:#7fff7f;pointer-events:none;';
    document.body.appendChild(hb);
    window.__hb = hb;
    window.addEventListener('error', (e) => {
      hb.textContent = 'ERR ' + (e.message || '?') + ' @ ' + (e.filename || '').split('/').pop() + ':' + e.lineno;
      hb.style.color = '#ff6060';
    });
    window.addEventListener('unhandledrejection', (e) => {
      hb.textContent = 'REJ ' + String((e.reason && e.reason.message) || e.reason).slice(0, 120);
      hb.style.color = '#ff6060';
    });
    // Key echo: what the WINDOW sees vs what the ground controller
    // registered — tells us in one glance where a keystroke dies.
    window.addEventListener('keydown', (e) => {
      const ae = document.activeElement;
      window.__winKey = e.code + (e.isTrusted ? '' : '*') + ' foc:' +
        (ae ? ae.tagName + (ae.id ? '#' + ae.id : '') : '?');
    }, true);
    if (_q.get('land') === '1') {
      skipArrival();
      setTimeout(() => enterGround(), 800);
    }
  }

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
  initCompanion();
  initSession();
  initSoundscape();
  initCrew();

  // First boot offers the crew sign-on terminal over black — MOTHER's
  // chamber before the vista. The opening shot waits for it: the title
  // fly-through belongs to the moment the traveler actually boards.
  if (initSignon()) {
    await new Promise((resolve) => on('signon:closed', resolve));
  }

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
    // Saved mid-flight near something? Settle into a gentle orbit of it
    // — the ship should be breathing from the first frame, never parked
    // on a frozen view.
    if (!orbitRef) {
      settleIntoNearestOrbit(getBodies().concat(getDeepSpaceObjects()));
    }
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
    // Returning gets a breath, not a ceremony: a longer exhale from
    // black and a whispered title (handled in revealWorld). Controls are
    // live immediately.
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
    if (resume) bootFade.style.transition = 'opacity 2.8s ease-out';
    bootFade.style.opacity = '0';
    setTimeout(() => { if (bootFade.parentNode) bootFade.parentNode.removeChild(bootFade); }, 3200);

    // Returning traveler: the word whispers — small, faint, brief.
    // A greeting from the ship, not an opening sequence.
    if (resume && titleEl) {
      titleEl.style.transition = 'none';
      titleEl.style.willChange = 'transform, opacity';
      titleAnim = titleEl.animate([
        { opacity: 0,    transform: 'translate(-50%, -50%) scale(0.5)' },
        { opacity: 0.48, transform: 'translate(-50%, -50%) scale(0.51)', offset: 0.35 },
        { opacity: 0.48, transform: 'translate(-50%, -50%) scale(0.515)', offset: 0.62 },
        { opacity: 0,    transform: 'translate(-50%, -50%) scale(0.525)' },
      ], { duration: 4200, easing: 'ease-in-out', fill: 'forwards' });
      titleAnim.onfinish = () => { if (titleEl.parentNode) titleEl.remove(); };
    }

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
  let _galIn = null, _galEx = 0, _galVol = 1;
  let _voidDim = 1; // Bootes proximity dims even the home galaxy — nothing survives the void
const PHOTO_CONTEXT_VISUALS = new Set(['pillars', 'crab', 'carina', 'horsehead', 'ring', 'eta_carinae', 'supermassive_bh']); // smoothed galaxy-membership fades

function animate() {
    requestAnimationFrame(animate);
    if (++_frameCount === 2) revealWorld();
    if (window.__hb && !window.__hb.textContent.startsWith('ERR') && !window.__hb.textContent.startsWith('REJ')) {
      window.__hb.textContent = 'f' + _frameCount + ' g' + (isGroundActive() ? 1 : 0) + (window.__hbPerf || '') +
        (window.__winKey ? ' | win:' + window.__winKey : '') +
        (window.__ctlKey ? ' | ctl:' + window.__ctlKey : '');
    }
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

    // ── Groundside: standing on real terrain ────────────────────────
    // The site owns the frame: terrain LOD, sky, boots, dust, wind.
    // Space keeps its clock ticking above (updateBodies already ran),
    // but every space-frame system below is parked until lift-off.
    if (isGroundActive()) {
      const _t0 = performance.now();
      updateGround(dt);
      const _t1 = performance.now();
      updateCompanionMark(dtWall);
      updateCompanion(dtWall, null);
      updateMusic(getGroundCamPos(), allBodies);
      updateSoundscape({ warp: 0, ratio: 0, free: false });
      updateStarMap();
      applyCameraRelative(getGroundCamPos());
      const _t2 = performance.now();
      composer.render();
      const _t3 = performance.now();
      if (window.__hb) {
        window.__hbPerf = ' ug:' + ((_t1 - _t0) | 0) + ' mid:' + ((_t2 - _t1) | 0) + ' rnd:' + ((_t3 - _t2) | 0) + ' pre:' + ((_t0 - now) | 0);
      }
      return;
    }

    // Update flight physics
    updateFlight(dt, allBodies, dtWall);

    // Motion-parallax dust (reads speed feel computed by flight)
    updateDust(dt, getCamPos(), getVelocity(), getSpeedFeel());

    // True stellar parallax — the near sky sweeps at warp, crawls at cruise
    updateStarParallax(getCamPos());

    // The background travels too: whole-sky glide + near-shimmer fade,
    // both scaled by warp intensity. Calm, coherent, unhurried.
    {
      const warpK = getSpeedFeel().warp || 0;
      updateSkyDrift(dt, warpK);
      setWarpStarMode(warpK);
    }

    // Update altitude tracking
    updateAltitude(getCamPos(), allBodies);

    // Update terrain LOD
    updateTerrain(scene, getCamPos());

    // Update atmosphere — sun is at world origin, camera-relative = -camPos
    updateAtmosphere(scene, getCamPos(), getCamPos().clone().negate());

    // Update HUD
    updateHud(getCamPos(), getSpeed(), allBodies);
    updateCompanionMark(dtWall);

    // Atmospheric entry effects
    updateAtmoEffects(dt, getCamPos(), getVelocity(), camera, scene);

    // Gas giant dive system
    const diveState = updateGasGiantDive(dt, getCamPos(), getVelocity());
    updateCompanion(dtWall, diveState);

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
        // Engineered silence: music presses toward nothing, the hull
        // bed thins — absence you can hear. Same law as the visuals.
        setMusicDuck(1 - smoothed);
        setVoidHush(1 - smoothed);
        _voidDim = smoothed;
      } else {
        setStarFieldOpacity(1.0);
        setMusicDuck(0);
        setVoidHush(0);
        _voidDim = 1;
      }
    }
    updateStarFieldOpacity(dt);

    // Travel voice follows the journey's actual arc
    updateSoundscape(getSpeedFeel());

    // Route furniture — the things that pass the window during warp
    updateTransit(dt, getCamPos(), getSpeedFeel());

    // Hands-free helm — SOLACE takes over when you go quiet
    updateAutopilot(dt);

    // Nothing pops: every landmark renders from any distance — a glowing
    // patch among the stars that grows by perspective alone (the no-pop
    // law). But CONTEXT must resolve with proximity: the photograph's own
    // background starfield and the companion-star corridors are faint
    // stars that are physically unresolvable from light-years away — at
    // range they collapsed into a fixed speckle patch that read as "a
    // photo pasted on the sky". So the keyed emission layers carry the
    // distant identity (a small colored glow), and the star context
    // dissolves in over ~40r -> 18r as you approach — resolution
    // improving, exactly like a real telescope closing in.
    {
      const camP = getCamPos();
      const allLandmarks = getLandmarks();
      for (const lm of allLandmarks) {
        lm.anchor.visible = true;
        // Photo-based visuals only: galaxies ARE their full layer, the
        // void is emptiness, and the procedural three are all-particle.
        const hasContext = PHOTO_CONTEXT_VISUALS.has(lm.visual);
        let c = 1, sh = 1;
        if (hasContext) {
          // Log-spaced band (200r -> 30r, most of a distance decade) plus
          // time smoothing: at warp approach speeds a linear band is
          // crossed in under a second and the resolve reads as a pop.
          const d = camP.distanceTo(lm.pos);
          const x = Math.log(Math.max(1e-6, d / (lm.radius * 30))) / Math.log(200 / 30);
          const t = Math.max(0, Math.min(1, x));
          const target = 1 - t * t * (3 - 2 * t);
          const prev = lm._ctxSmooth ?? target;
          c = prev + (target - prev) * (1 - Math.exp(-dt / 1.2));
          lm._ctxSmooth = c;
          // Immersion fade for the outskirts shroud: you cannot see the
          // cloud you are inside. From mid-range the shroud is the
          // environment; entering it (arrival standoffs, slingshot
          // passes, departures) it thins right down, or every travel
          // beat near a nebula becomes soup.
          const u = Math.max(0, Math.min(1, (d / lm.radius - 2.5) / (7 - 2.5)));
          sh = 0.15 + 0.85 * (u * u * (3 - 2 * u));
        }
        const sig = c + sh * 3; // decorrelated: either factor moving re-traverses
        if (Math.abs((lm._ctxSig ?? -1) - sig) > 0.02) {
          lm._ctxSig = sig;
          lm.anchor.traverse((o) => {
            if (o.material) {
              if (o.material.userData._baseOpacity === undefined) {
                o.material.userData._baseOpacity = o.material.opacity;
              }
              const isContext = o.isPoints || o.material.userData._contextPhoto;
              o.material.opacity = o.material.userData._baseOpacity *
                (isContext ? c : 1) * (o.userData._shroud ? sh : 1);
            }
          });
        }
      }
    }

    // ── Galaxy membership: inside vs outside the Milky Way ──────────
    // World-driven, not scripted: deep inside, the sky IS the galaxy
    // (skybox band + star layers + deep backdrop) and the galaxy-object
    // is invisible; crossing the rim they crossfade over wide bands so
    // entry takes unhurried seconds even at warp deceleration. The
    // intro drives these fades itself while it plays.
    if (!isIntroPlaying()) {
      const u = getCamPos().distanceTo(GALACTIC_CENTER) / MILKY_WAY_RADIUS;
      const tIn = Math.max(0, Math.min(1, (u - 0.92) / (1.45 - 0.92)));
      const interior = 1 - tIn * tIn * (3 - 2 * tIn);
      const tOut = Math.max(0, Math.min(1, (u - 1.02) / (2.6 - 1.02)));
      const exterior = tOut * tOut * (3 - 2 * tOut);
      // Particle volume belongs to the rim crossing only — at range the
      // pixel-sized points fuse into a cotton ball over the photograph,
      // so distant views are handed to the photo disc (a whisper stays
      // for edge-on body).
      const tVol = Math.max(0, Math.min(1, (u - 1.5) / (2.9 - 1.5)));
      const volume = 0.22 + 0.78 * (1 - tVol * tVol * (3 - 2 * tVol));
      // Time-smoothing: a rim crossed at warp speed still dissolves like
      // a slow breath — the fade can never happen faster than this.
      if (_galIn === null) { _galIn = interior; _galEx = exterior; _galVol = volume; }
      const gk = 1 - Math.exp(-dt / 1.4);
      _galIn += (interior - _galIn) * gk;
      _galEx += (exterior - _galEx) * gk;
      _galVol += (volume - _galVol) * gk;
      setSkyboxOpacity(0.9 * _galIn);
      setMilkyWayOpacity(_galEx * _voidDim, _galVol);
      setGalaxyInteriorFactor(_galIn);
      setHomeBeaconFactor(_galIn);
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

    // Solar-system-only particles (asteroid/Kuiper belts) fade with
    // distance from home — no lightswitch on the way out or back in
    {
      const distFromOrigin = getCamPos().length();
      const fadeStart = 150 * AU;
      const fadeEnd = 280 * AU;
      const f = distFromOrigin <= fadeStart ? 1 : distFromOrigin >= fadeEnd ? 0 :
        1 - (distFromOrigin - fadeStart) / (fadeEnd - fadeStart);
      scene.traverse((child) => {
        if (child.userData._solarSystemOnly) {
          if (f <= 0) {
            child.visible = false;
          } else {
            child.visible = true;
            if (child.material) {
              if (child.material.userData._baseOpacity === undefined) {
                child.material.userData._baseOpacity = child.material.opacity;
              }
              child.material.opacity = child.material.userData._baseOpacity * f;
            }
          }
        }
      });
    }

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
