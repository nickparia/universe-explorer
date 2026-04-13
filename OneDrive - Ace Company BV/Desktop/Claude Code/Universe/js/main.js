// js/main.js — Universe Explorer entry point
// Wires all modules together: engine, textures, bodies, deep space, flight, music, HUD

import { initEngine, getSunLight, getDistortionPass, updateFilmGrain, createSkybox, createStars, applyCameraRelative } from './engine.js';
import { runBenchmark, getTier, getConfig, adaptTier } from './perf.js';
import { loadAllTextures } from './textures.js';
import { createSolarSystem, updateBodies, getBodies } from './bodies.js';
import { createDeepSpace, updateDeepSpace, getDeepSpaceObjects } from './deepspace.js';
import { initFlight, updateFlight, getCamPos, getSpeed, getVelocity, doHome } from './flight.js';
import { initMusic, updateMusic } from './music.js';
import { initHud, updateHud } from './hud.js';
import { initAtmoEffects, updateAtmoEffects } from './atmosphere/effects.js';
import { initGasGiantHud, updateGasGiantDive } from './atmosphere/gasgiant.js';
import { updateAtmosphere } from './atmosphere/scatter.js';
import { updateAltitude, getAltitude } from './altitude.js';
import { updateTerrain } from './terrain/manager.js';
import * as THREE from 'three';

async function boot() {
  // 1. Hide setup, show loading
  const setupEl = document.getElementById('setup');
  const loadingEl = document.getElementById('loading');
  const barEl = document.getElementById('loading-bar');
  const detailEl = document.getElementById('loading-detail');

  if (setupEl) setupEl.style.display = 'none';
  if (loadingEl) loadingEl.style.display = 'flex';

  // 2. Initialize renderer + post-processing
  const { scene, camera, composer, renderer } = initEngine();

  // 2b. GPU performance benchmark
  const perfTier = runBenchmark(renderer);
  console.log(`[boot] Performance tier: ${perfTier}`, getConfig());

  // 3. Load all textures
  const textures = await loadAllTextures((progress, detail) => {
    if (barEl) barEl.style.width = (progress * 100) + '%';
    if (detailEl) detailEl.textContent = detail;
  });

  // 4. Create skybox and stars
  createSkybox(textures.starmap);
  createStars();

  // 5. Build solar system
  createSolarSystem(scene, textures);

  // 6. Build deep space content
  createDeepSpace(scene, textures);

  // 7. Initialize flight controls
  initFlight(camera);

  // 8. Initialize music system
  const music = initMusic();

  // 9. Initialize HUD
  initHud();
  initAtmoEffects();
  initGasGiantHud();

  // 10. Hide loading, show overlay with texture status
  if (loadingEl) loadingEl.style.display = 'none';

  const real = Object.entries(textures.status).filter(([k, v]) => v === 'real').length;
  const proc = Object.entries(textures.status).filter(([k, v]) => v === 'procedural').length;
  let statusHtml = '';
  if (real) statusHtml += `<span class="t-ok">\u2713 ${real} real textures loaded</span><br>`;
  if (proc) statusHtml += `<span class="t-miss">\u26A0 ${proc} procedural fallbacks</span>`;
  const texStatus = document.getElementById('tex-status');
  if (texStatus) texStatus.innerHTML = statusHtml;

  const overlayEl = document.getElementById('overlay');
  if (overlayEl) overlayEl.style.display = 'flex';

  // 11. Start button — launches the experience
  document.getElementById('start-btn').addEventListener('click', () => {
    if (overlayEl) overlayEl.style.display = 'none';
    const hudEl = document.getElementById('hud');
    if (hudEl) hudEl.style.display = 'block';

    const canvas = document.getElementById('c');
    if (canvas) canvas.focus();

    // Start music
    music.start();

    // Debug: expose for testing
    window._dbg = { getCamPos, getSpeed, getBodies, getDeepSpaceObjects };

    // 12. Main render loop
    let lastTime = performance.now();
    const sunLight = getSunLight();
    const distortionPass = getDistortionPass();

    function animate() {
      requestAnimationFrame(animate);
      const now = performance.now();
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      adaptTier(now - lastTime);
      lastTime = now;
      const elapsed = now * 0.001;

      // Update orbital mechanics
      updateBodies(dt, getCamPos());

      // Update deep space (accretion disk rotation etc)
      updateDeepSpace(dt, getCamPos());

      // Gather all bodies for physics + HUD
      const allBodies = getBodies().concat(getDeepSpaceObjects());

      // Update flight physics
      updateFlight(dt, allBodies);

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

      // Update music zones
      updateMusic(getCamPos(), allBodies);

      // Update film grain time
      updateFilmGrain(elapsed);

      // Sun light flicker — subtle variation around base intensity
      if (sunLight) {
        sunLight.intensity = 800000 * (1.0 + Math.sin(elapsed * 6.2) * 0.02 + Math.sin(elapsed * 2.7) * 0.01);
      }

      // Black hole distortion
      if (distortionPass) {
        const bhObjects = getDeepSpaceObjects().filter(o => o.isBlackHole);
        if (bhObjects.length > 0) {
          const bh = bhObjects[0];
          const bhWorldPos = new THREE.Vector3();
          bh.g.getWorldPosition(bhWorldPos);
          const bhScreen = bhWorldPos.clone().project(camera);
          const distToBH = getCamPos().distanceTo(bhWorldPos);

          distortionPass.uniforms.bhScreenPos.value.set(
            (bhScreen.x + 1) / 2,
            (-bhScreen.y + 1) / 2
          );

          const maxDist = bh.r * 50 * 55;
          const strength = Math.max(0, 1 - distToBH / maxDist) * 3.0;
          distortionPass.uniforms.bhStrength.value = (bhScreen.z > 0 && bhScreen.z < 1) ? strength : 0;

          // Event horizon — flash and return home
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

      renderer.render(scene, camera);
    }

    animate();
  });
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
