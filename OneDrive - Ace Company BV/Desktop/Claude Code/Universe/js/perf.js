// perf.js — GPU performance tier detection
import * as THREE from 'three';

let tier = 'medium';

const TIER_CONFIG = {
  high: {
    terrainMaxDepth: 15, chunkGrid: 33, atmosphereQuality: 'full',
    cloudLayers: 3, descentParticles: 500, cameraShake: 1.0,
    noiseOctaves: 8, shadows: 'soft', chunksPerFrame: 3,
  },
  medium: {
    terrainMaxDepth: 12, chunkGrid: 17, atmosphereQuality: 'simple',
    cloudLayers: 2, descentParticles: 150, cameraShake: 0.5,
    noiseOctaves: 5, shadows: 'hard', chunksPerFrame: 2,
  },
  low: {
    terrainMaxDepth: 9, chunkGrid: 9, atmosphereQuality: 'minimal',
    cloudLayers: 1, descentParticles: 50, cameraShake: 0,
    noiseOctaves: 3, shadows: 'none', chunksPerFrame: 1,
  },
};

export function runBenchmark(renderer) {
  const testScene = new THREE.Scene();
  const testCam = new THREE.PerspectiveCamera(70, 1, 0.1, 1000);
  testCam.position.set(0, 0, 50);

  const geo = new THREE.SphereGeometry(10, 64, 64);
  const mat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.5 });
  testScene.add(new THREE.Mesh(geo, mat));
  testScene.add(new THREE.PointLight(0xffffff, 3));
  testScene.add(new THREE.AmbientLight(0x333333, 1));

  // Warm up
  renderer.setSize(256, 256);
  renderer.render(testScene, testCam);
  renderer.render(testScene, testCam);

  // Benchmark: average of 5 frames
  const times = [];
  for (let i = 0; i < 5; i++) {
    const start = performance.now();
    renderer.render(testScene, testCam);
    const gl = renderer.getContext();
    const buf = new Uint8Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    times.push(performance.now() - start);
  }

  renderer.setSize(window.innerWidth, window.innerHeight);
  geo.dispose();
  mat.dispose();

  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  console.log(`[perf] GPU benchmark: ${avg.toFixed(1)}ms avg`);

  if (avg < 8) tier = 'high';
  else if (avg < 20) tier = 'medium';
  else tier = 'low';

  console.log(`[perf] Detected tier: ${tier}`);
  return tier;
}

export function getTier() { return tier; }
export function getConfig() { return TIER_CONFIG[tier]; }

export function setTier(newTier) {
  if (TIER_CONFIG[newTier]) {
    tier = newTier;
    console.log(`[perf] Tier manually set to: ${tier}`);
  }
}

let slowFrameAccum = 0;
export function adaptTier(frameTimeMs) {
  if (frameTimeMs > 33) {
    slowFrameAccum += frameTimeMs / 1000;
    if (slowFrameAccum > 2) {
      if (tier === 'high') { tier = 'medium'; console.log('[perf] Adaptive drop: high → medium'); }
      else if (tier === 'medium') { tier = 'low'; console.log('[perf] Adaptive drop: medium → low'); }
      slowFrameAccum = 0;
    }
  } else {
    slowFrameAccum = Math.max(0, slowFrameAccum - frameTimeMs / 1000);
  }
}
