// js/hover-select.js — Click-in-world navigation
//
// Hover any celestial body in the 3D view → a quiet label fades in next
// to the cursor showing its name and distance. Left-click → fly there
// (planets/craft) or warp there (galactic landmarks). Right-click is
// reserved for camera look and intentionally ignored here.
//
// Designed to be "ambient" — no persistent UI, no overlay, just a
// cursor affordance that appears when something under the mouse can
// be travelled to.

import * as THREE from 'three';
import { AU } from './constants.js';

const DRAG_THRESHOLD_PX = 5;

let camera = null;
let raycaster = null;
const pointer = new THREE.Vector2();

let labelEl = null;
let hoveredBody = null;
let canvas = null;

// Callbacks
let getBodiesFn = null;
let getCamPosFn = null;
let flyToFn = null;
let warpToFn = null;
let shouldSuppress = () => false;

// Drag tracking — so a left-click that was really a drag doesn't fire a fly-to
let mouseDownX = null, mouseDownY = null, didDrag = false;
// Track pointer position in screen space (for label positioning)
let lastClientX = 0, lastClientY = 0;

// Throttle raycasting — no need to do it every frame
let frameCounter = 0;
const RAYCAST_EVERY = 2;

/**
 * Initialise the hover-select system.
 * @param {Object} deps
 * @param {THREE.Camera} deps.camera
 * @param {() => Array} deps.getBodies             — returns flat array of { name, g, r, isLandmark?, ... }
 * @param {() => THREE.Vector3} deps.getCamPos     — logical camera world position
 * @param {(name:string) => void} deps.flyTo
 * @param {(name:string) => void} deps.warpTo
 * @param {() => boolean} [deps.suppress]          — return true to disable (e.g. during intro / star map)
 */
export function initHoverSelect(deps) {
  camera = deps.camera;
  getBodiesFn = deps.getBodies;
  getCamPosFn = deps.getCamPos;
  flyToFn = deps.flyTo;
  warpToFn = deps.warpTo;
  if (deps.suppress) shouldSuppress = deps.suppress;

  raycaster = new THREE.Raycaster();
  // Make it a bit more forgiving — thin sprites etc.
  raycaster.params.Points = { threshold: 2 };
  raycaster.params.Line = { threshold: 1 };

  canvas = document.getElementById('c');

  // Ambient floating label — no background, no border, just soft text
  // that sits in world space at the body's projected position. Feels
  // like the universe is whispering the name, not a UI tooltip.
  labelEl = document.createElement('div');
  labelEl.id = 'hover-label';
  labelEl.style.cssText = `
    position: fixed;
    left: 0; top: 0;
    pointer-events: none;
    z-index: 18;
    font-family: 'Segoe UI','Helvetica Neue',Arial,sans-serif;
    color: rgba(255,255,255,0.95);
    opacity: 0;
    transition: opacity 0.35s ease-out;
    white-space: nowrap;
    text-align: center;
    transform: translate(-50%, -100%);
  `;
  document.body.appendChild(labelEl);

  // Mouse events — use window so we don't miss fast moves outside canvas
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
}

function onMouseMove(e) {
  lastClientX = e.clientX;
  lastClientY = e.clientY;

  // Normalized device coords for raycasting
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;

  // Drag tracking
  if (mouseDownX !== null) {
    const dx = e.clientX - mouseDownX;
    const dy = e.clientY - mouseDownY;
    if (!didDrag && (dx * dx + dy * dy) > DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) {
      didDrag = true;
    }
  }
  // Label follows the body, not the cursor — updated in updateHoverSelect.
}

function onMouseDown(e) {
  if (e.button === 0) {
    mouseDownX = e.clientX;
    mouseDownY = e.clientY;
    didDrag = false;
  }
}

function onMouseUp(e) {
  if (e.button === 0 && !didDrag && hoveredBody && !shouldSuppress()) {
    const b = hoveredBody;
    // Landmarks → interstellar warp. Everything else (planets, moons,
    // spacecraft, Sun) → in-system fly-to.
    if (b.isLandmark) {
      warpToFn(b.name);
    } else {
      flyToFn(b.name);
    }
    // Fade the label — we're leaving anyway
    if (labelEl) labelEl.style.opacity = '0';
    hoveredBody = null;
  }
  mouseDownX = null;
  didDrag = false;
}

/**
 * Call once per frame AFTER applyCameraRelative() — camera-relative render
 * positions are what the raycaster compares against.
 */
export function updateHoverSelect() {
  if (!raycaster || !camera) return;
  if (shouldSuppress()) {
    if (hoveredBody) {
      hoveredBody = null;
      if (labelEl) labelEl.style.opacity = '0';
      if (canvas) canvas.style.cursor = 'crosshair';
    }
    return;
  }

  // Throttle — raycast every N frames
  frameCounter++;
  if (frameCounter % RAYCAST_EVERY !== 0) return;

  const bodies = getBodiesFn();
  if (!bodies || bodies.length === 0) return;

  // Tag bodies with back-refs so we can walk from hit → body
  for (const b of bodies) {
    if (b.g && b.g.userData && b.g.userData._bodyRef !== b) {
      b.g.userData._bodyRef = b;
    }
  }

  raycaster.setFromCamera(pointer, camera);

  // Build the list of group roots to test against
  const groups = [];
  for (const b of bodies) {
    if (b.g && b.r && b.r > 0) groups.push(b.g);
  }

  const hits = raycaster.intersectObjects(groups, true);

  let found = null;
  if (hits.length > 0) {
    // Walk up from the first hit to the tagged body group
    for (const hit of hits) {
      let obj = hit.object;
      while (obj) {
        if (obj.userData && obj.userData._bodyRef) {
          found = obj.userData._bodyRef;
          break;
        }
        obj = obj.parent;
      }
      if (found) break;
    }
  }

  if (found !== hoveredBody) {
    hoveredBody = found;
    if (found) {
      updateLabelContent(found);
      labelEl.style.opacity = '1';
      if (canvas) canvas.style.cursor = 'pointer';
    } else {
      if (labelEl) labelEl.style.opacity = '0';
      if (canvas) canvas.style.cursor = 'crosshair';
    }
  }

  // Track the body's current screen position every tick so the label
  // stays pinned above the body as the world moves (not to the cursor).
  if (hoveredBody && labelEl) {
    positionLabelAtBody(hoveredBody);
  }
}

const _tmpScreen = new THREE.Vector3();
function positionLabelAtBody(body) {
  const bodyObj = body.g;
  // Use current live world position (post camera-relative shift)
  bodyObj.getWorldPosition(_tmpScreen);
  _tmpScreen.project(camera);

  // Behind the camera or outside the view? Hide.
  if (_tmpScreen.z > 1 || _tmpScreen.z < -1 ||
      _tmpScreen.x < -1.1 || _tmpScreen.x > 1.1 ||
      _tmpScreen.y < -1.1 || _tmpScreen.y > 1.1) {
    labelEl.style.opacity = '0';
    return;
  }

  const sx = (_tmpScreen.x * 0.5 + 0.5) * window.innerWidth;
  const sy = (-_tmpScreen.y * 0.5 + 0.5) * window.innerHeight;

  // Offset upward by an amount proportional to the body's on-screen
  // angular radius, so the label sits just above the body regardless
  // of whether it's tiny or big.
  const bodyWorldPos = (body.g.userData && body.g.userData._worldPos) || body.g.position;
  const camPos = getCamPosFn();
  const dist = camPos.distanceTo(bodyWorldPos);
  const angRad = Math.atan(body.r / Math.max(dist, 0.001));
  // Screen-px radius ≈ tan(angRad) / tan(FOV/2) * (screenHeight/2)
  const fovRad = (camera.fov || 60) * Math.PI / 180;
  const pxRadius = Math.tan(angRad) / Math.tan(fovRad / 2) * (window.innerHeight / 2);
  const offsetY = Math.max(24, Math.min(120, pxRadius + 28));

  labelEl.style.left = sx + 'px';
  labelEl.style.top = (sy - offsetY) + 'px';
}

function updateLabelContent(body) {
  if (!labelEl) return;

  const bodyPos = (body.g.userData && body.g.userData._worldPos) || body.g.position;
  const camPos = getCamPosFn();
  const dist = camPos.distanceTo(bodyPos);

  // Format distance in a human-friendly way
  // Scene is scaled so that 1 AU = 3000 units; 1 LY ≈ 63241 AU.
  // Approximate km conversion: 1 AU ≈ 1.496e8 km, so 1 unit ≈ 50,000 km.
  const distAU = dist / AU;
  let distStr;
  if (distAU < 0.002) {
    distStr = Math.round(dist * 50) + ' K KM';
  } else if (distAU < 0.2) {
    distStr = (distAU * 1000).toFixed(0) + ' M KM';
  } else if (distAU < 1000) {
    distStr = distAU.toFixed(distAU < 10 ? 2 : 1) + ' AU';
  } else if (distAU < 63241 * 1000) {
    const ly = distAU / 63241;
    distStr = ly.toFixed(ly < 10 ? 2 : 1) + ' LY';
  } else {
    const mly = distAU / 63241 / 1e6;
    distStr = mly.toFixed(2) + ' MLY';
  }

  // Friendly case for display
  const parts = body.name.split(' ');
  const niceName = parts.map(p => p.charAt(0) + p.slice(1).toLowerCase()).join(' ');

  // Pure floating text — no background, just soft shadows for legibility.
  const shadow = '0 0 10px rgba(0,0,0,0.95), 0 2px 6px rgba(0,0,0,0.95)';
  labelEl.innerHTML =
    '<div style="font-size:13px;letter-spacing:5px;font-weight:300;' +
    'color:rgba(255,255,255,0.95);text-shadow:' + shadow + '">' +
      niceName.toLowerCase() +
    '</div>' +
    '<div style="font-size:9px;letter-spacing:3px;font-weight:300;' +
    'color:rgba(200,220,255,0.55);margin-top:4px;text-shadow:' + shadow + '">' +
      distStr +
    '</div>';
}
