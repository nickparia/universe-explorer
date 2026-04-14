// js/starmap.js — 3D Star Map overlay
// Press M to toggle. Click a landmark to warp (fly-to) there.

import * as THREE from 'three';
import { getLandmarks } from './deepspace.js';
import { warpTo, flyTo } from './flight.js';

// ── State ────────────────────────────────────────────────────────────────
let mapActive = false;
let container = null;
let mapCanvas = null;
let mapScene = null;
let mapCamera = null;
let mapRenderer = null;
let raycaster = null;
let mouse = new THREE.Vector2();

// Orbit controls state
let orbitAngle = 0;
let orbitElevation = 0.6;
let orbitDist = 80;
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let dragStartAngle = 0;
let dragStartElev = 0;

// Sprite references for raycasting
let landmarkSprites = [];
let labelDivs = [];
let solSprite = null;

// Dot texture for sprites
let dotTexture = null;

// ── Dot texture (32px radial gradient) ───────────────────────────────────
function getDotTexture() {
  if (dotTexture) return dotTexture;
  const sz = 32;
  const cv = document.createElement('canvas');
  cv.width = sz; cv.height = sz;
  const ctx = cv.getContext('2d');
  const grd = ctx.createRadialGradient(sz / 2, sz / 2, 0, sz / 2, sz / 2, sz / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.3, 'rgba(255,255,255,0.6)');
  grd.addColorStop(0.7, 'rgba(255,255,255,0.15)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, sz, sz);
  dotTexture = new THREE.CanvasTexture(cv);
  return dotTexture;
}

// ── initStarMap ──────────────────────────────────────────────────────────
export function initStarMap() {
  // Create overlay container
  container = document.createElement('div');
  container.id = 'star-map';
  container.style.cssText = `
    position: fixed; inset: 0; z-index: 60;
    background: rgba(0,0,0,0.85);
    display: none;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  `;

  // Title
  const title = document.createElement('div');
  title.textContent = 'STAR MAP';
  title.style.cssText = `
    position: absolute; top: 28px; left: 0; right: 0;
    text-align: center;
    font-variant: small-caps;
    font-size: 22px;
    letter-spacing: 6px;
    color: #6aafff;
    font-family: monospace;
    pointer-events: none;
    z-index: 2;
  `;
  container.appendChild(title);

  // Hint at bottom
  const hint = document.createElement('div');
  hint.textContent = 'PRESS M TO CLOSE \u00B7 CLICK DESTINATION TO WARP';
  hint.style.cssText = `
    position: absolute; bottom: 28px; left: 0; right: 0;
    text-align: center;
    font-size: 12px;
    letter-spacing: 3px;
    color: rgba(120,180,255,0.5);
    font-family: monospace;
    pointer-events: none;
    z-index: 2;
  `;
  container.appendChild(hint);

  // Canvas for the mini Three.js scene
  mapCanvas = document.createElement('canvas');
  mapCanvas.style.cssText = 'width:100%; height:100%; display:block;';
  container.appendChild(mapCanvas);

  document.body.appendChild(container);

  // Mini Three.js scene
  mapScene = new THREE.Scene();
  mapCamera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 500);
  mapRenderer = new THREE.WebGLRenderer({ canvas: mapCanvas, alpha: true, antialias: true });
  mapRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  mapRenderer.setSize(window.innerWidth, window.innerHeight);

  raycaster = new THREE.Raycaster();
  raycaster.params.Points = { threshold: 1.5 };

  // ── Event wiring ───────────────────────────────────────────────────────

  // M key to toggle
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyM') {
      e.preventDefault();
      e.stopPropagation();
      toggleStarMap();
    }
  });

  // Mouse drag for orbiting
  container.addEventListener('mousedown', (e) => {
    if (e.button === 0) {
      isDragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      dragStartAngle = orbitAngle;
      dragStartElev = orbitElevation;
    }
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging || !mapActive) return;
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    orbitAngle = dragStartAngle - dx * 0.008;
    orbitElevation = Math.max(-1.2, Math.min(1.2, dragStartElev + dy * 0.008));
  });

  window.addEventListener('mouseup', () => {
    isDragging = false;
  });

  // Mouse wheel for zoom
  container.addEventListener('wheel', (e) => {
    e.preventDefault();
    orbitDist = Math.max(20, Math.min(200, orbitDist + e.deltaY * 0.05));
  }, { passive: false });

  // Click to warp
  container.addEventListener('click', (e) => {
    if (isDragging) return;
    onMapClick(e);
  });

  // Actually detect whether a click was a drag vs. a real click
  let clickStartX = 0, clickStartY = 0;
  container.addEventListener('mousedown', (e) => {
    clickStartX = e.clientX;
    clickStartY = e.clientY;
  });
  container.addEventListener('mouseup', (e) => {
    const dx = e.clientX - clickStartX;
    const dy = e.clientY - clickStartY;
    if (Math.abs(dx) + Math.abs(dy) < 5) {
      onMapClick(e);
    }
  });

  // Resize
  window.addEventListener('resize', () => {
    if (!mapActive) return;
    mapCamera.aspect = window.innerWidth / window.innerHeight;
    mapCamera.updateProjectionMatrix();
    mapRenderer.setSize(window.innerWidth, window.innerHeight);
  });
}

// ── buildMap ─────────────────────────────────────────────────────────────
function buildMap() {
  // Clear previous
  while (mapScene.children.length > 0) {
    mapScene.remove(mapScene.children[0]);
  }
  landmarkSprites = [];

  // Remove old label divs
  for (const lbl of labelDivs) {
    if (lbl.parentNode) lbl.parentNode.removeChild(lbl);
  }
  labelDivs = [];

  const landmarks = getLandmarks();
  if (!landmarks || landmarks.length === 0) return;

  // Find the range of positions to normalize
  let maxDist = 0;
  for (const lm of landmarks) {
    const d = lm.pos.length();
    if (d > maxDist) maxDist = d;
  }
  const scale = maxDist > 0 ? 40 / maxDist : 1;

  // Ambient light
  mapScene.add(new THREE.AmbientLight(0x334466, 1));

  // Sol at center (yellow sprite)
  const solMat = new THREE.SpriteMaterial({
    map: getDotTexture(),
    color: 0xffdd44,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
  solSprite = new THREE.Sprite(solMat);
  solSprite.scale.set(2, 2, 1);
  solSprite.userData._landmarkName = 'SOL';
  mapScene.add(solSprite);
  landmarkSprites.push(solSprite);

  // Sol label
  addLabel('SOL', new THREE.Vector3(0, 0, 0), '#ffdd44');

  // Each landmark
  for (const lm of landmarks) {
    const pos = lm.pos.clone().multiplyScalar(scale);

    // Determine sprite color
    const isIntergalactic = lm.tier === 'intergalactic';
    const color = isIntergalactic ? 0xaaddff : 0x5588cc;

    const spriteMat = new THREE.SpriteMaterial({
      map: getDotTexture(),
      color: color,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(isIntergalactic ? 1.5 : 1.0, isIntergalactic ? 1.5 : 1.0, 1);
    sprite.position.copy(pos);
    sprite.userData._landmarkName = lm.name;
    mapScene.add(sprite);
    landmarkSprites.push(sprite);

    // Faint connection line to center
    const lineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      pos,
    ]);
    const lineMat = new THREE.LineBasicMaterial({
      color: isIntergalactic ? 0x334466 : 0x223344,
      transparent: true,
      opacity: 0.25,
    });
    const line = new THREE.Line(lineGeo, lineMat);
    mapScene.add(line);

    // HTML label
    addLabel(lm.name, pos, isIntergalactic ? '#aaddff' : '#5588cc');
  }
}

function addLabel(text, pos3D, color) {
  const lbl = document.createElement('div');
  lbl.textContent = text;
  lbl.style.cssText = `
    position: absolute;
    color: ${color};
    font-family: monospace;
    font-size: 10px;
    letter-spacing: 1px;
    pointer-events: none;
    white-space: nowrap;
    text-shadow: 0 0 6px rgba(50,100,200,0.5);
    z-index: 3;
    transition: opacity 0.15s;
  `;
  lbl.dataset.x = pos3D.x;
  lbl.dataset.y = pos3D.y;
  lbl.dataset.z = pos3D.z;
  container.appendChild(lbl);
  labelDivs.push(lbl);
}

// ── onMapClick ───────────────────────────────────────────────────────────
function onMapClick(e) {
  if (!mapActive) return;

  const rect = mapCanvas.getBoundingClientRect();
  mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouse, mapCamera);
  const intersects = raycaster.intersectObjects(landmarkSprites, false);

  if (intersects.length > 0) {
    const hit = intersects[0].object;
    const name = hit.userData._landmarkName;
    if (name) {
      // Close the map
      toggleStarMap();
      // Warp to the destination
      if (name === 'SOL') {
        flyTo('SUN');
      } else {
        warpTo(name);
      }
    }
  }
}

// ── updateStarMap ────────────────────────────────────────────────────────
export function updateStarMap() {
  if (!mapActive) return;

  // Update camera position from orbit params
  const cx = orbitDist * Math.cos(orbitElevation) * Math.cos(orbitAngle);
  const cy = orbitDist * Math.sin(orbitElevation);
  const cz = orbitDist * Math.cos(orbitElevation) * Math.sin(orbitAngle);
  mapCamera.position.set(cx, cy, cz);
  mapCamera.lookAt(0, 0, 0);

  // Update label positions via 3D projection
  const w = window.innerWidth;
  const h = window.innerHeight;
  for (const lbl of labelDivs) {
    const pos = new THREE.Vector3(
      parseFloat(lbl.dataset.x),
      parseFloat(lbl.dataset.y),
      parseFloat(lbl.dataset.z)
    );
    pos.project(mapCamera);

    // Check if behind camera
    if (pos.z > 1) {
      lbl.style.opacity = '0';
      continue;
    }

    const sx = (pos.x * 0.5 + 0.5) * w;
    const sy = (-pos.y * 0.5 + 0.5) * h;
    lbl.style.left = sx + 'px';
    lbl.style.top = (sy - 14) + 'px';
    lbl.style.opacity = '1';
  }

  // Render
  mapRenderer.render(mapScene, mapCamera);
}

// ── toggleStarMap ────────────────────────────────────────────────────────
export function toggleStarMap() {
  mapActive = !mapActive;
  if (mapActive) {
    container.style.display = 'flex';
    // Resize renderer in case window changed
    mapCamera.aspect = window.innerWidth / window.innerHeight;
    mapCamera.updateProjectionMatrix();
    mapRenderer.setSize(window.innerWidth, window.innerHeight);
    buildMap();
  } else {
    container.style.display = 'none';
    // Clean up labels when closing
    for (const lbl of labelDivs) {
      if (lbl.parentNode) lbl.parentNode.removeChild(lbl);
    }
    labelDivs = [];
  }
}

// ── isStarMapOpen ────────────────────────────────────────────────────────
export function isStarMapOpen() {
  return mapActive;
}
