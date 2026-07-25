// navigation.js — Planet carousel, time control, fly-to coordination
import { AU } from './constants.js';
import { flyTo, isFlyingTo } from './flight.js';
import { getDeepSpaceObjects } from './deepspace.js';

// ═══════════════════════════════════════════════════════════════
// Time Control
// ═══════════════════════════════════════════════════════════════

const TIME_SCALES = [0.1, 1, 10, 100, 1000];
let timeScaleIndex = 1;
let elTimeScale = null;

export function getTimeScale() { return TIME_SCALES[timeScaleIndex]; }

export function cycleTimeScale(dir) {
  timeScaleIndex = Math.max(0, Math.min(TIME_SCALES.length - 1, timeScaleIndex + dir));
  updateTimeHud();
}

function updateTimeHud() {
  if (!elTimeScale) return;
  const s = TIME_SCALES[timeScaleIndex];
  if (s === 1) {
    elTimeScale.style.display = 'none';
  } else {
    elTimeScale.style.display = 'block';
    elTimeScale.textContent = (s < 1 ? s.toFixed(1) : s.toFixed(0)) + 'x';
  }
}

// ═══════════════════════════════════════════════════════════════
// Planet Carousel
// ═══════════════════════════════════════════════════════════════

// Order matches number keys: 0=Sun, 1=Mercury...9=Pluto
const PLANET_ORDER = ['SUN','MERCURY','VENUS','EARTH','MARS','JUPITER','SATURN','URANUS','NEPTUNE','PLUTO'];
const PLANET_LABELS = ['☉ SUN','MERCURY','VENUS','EARTH','MARS','JUPITER','SATURN','URANUS','NEPTUNE','PLUTO'];
const SPACECRAFT_ORDER = ['ISS','HUBBLE','JWST','NEW HORIZONS','VOYAGER 1','VOYAGER 2'];
const SPACECRAFT_LABELS = ['ISS','HUBBLE','JWST','NEW HORIZONS','VOYAGER 1','VOYAGER 2'];

let barItems = []; // { el, distEl, name, bodyRef }
let barContainer = null;
let _currentNearest = null;
let _userSelected = false; // only highlight after user interaction

export function getActivePlanet() { return _userSelected ? _currentNearest : null; }

// Called when user clicks carousel or uses fly-to
export function setActivePlanet(name) {
  _currentNearest = name;
  _userSelected = true;
  for (let i = 0; i < barItems.length; i++) {
    const isActive = barItems[i].name === name;
    barItems[i].el.classList.toggle('active', isActive);
    // Scroll active item into view
    if (isActive && barContainer) {
      barItems[i].el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }
}

function addSectionLabel(text) {
  const label = document.createElement('div');
  label.className = 'pb-section';
  label.textContent = text;
  barContainer.appendChild(label);
}

function createBar(allBodies) {
  barContainer = document.getElementById('planet-bar');
  if (!barContainer) return;

  // ── Planets section ──
  addSectionLabel('PLANETS');
  for (let i = 0; i < PLANET_ORDER.length; i++) {
    const name = PLANET_ORDER[i];
    const body = allBodies.find(b => b.name === name);
    if (!body) continue;

    const el = document.createElement('div');
    el.className = 'pb-item';
    el.innerHTML = `<div class="pb-name">${PLANET_LABELS[i]}</div><div class="pb-dist"></div>`;
    el.addEventListener('click', () => { setActivePlanet(name); flyTo(name); });
    barContainer.appendChild(el);

    barItems.push({ el, distEl: el.querySelector('.pb-dist'), name, bodyRef: body });
  }

  // ── Spacecraft section ──
  addSectionLabel('CRAFT');
  for (let i = 0; i < SPACECRAFT_ORDER.length; i++) {
    const name = SPACECRAFT_ORDER[i];
    const body = allBodies.find(b => b.name === name);
    if (!body) continue;

    const el = document.createElement('div');
    el.className = 'pb-item pb-craft';
    el.innerHTML = `<div class="pb-name">${SPACECRAFT_LABELS[i]}</div><div class="pb-dist"></div>`;
    el.addEventListener('click', () => { setActivePlanet(name); flyTo(name); });
    barContainer.appendChild(el);

    barItems.push({ el, distEl: el.querySelector('.pb-dist'), name, bodyRef: body });
  }

  // ── Landmarks section ──
  addSectionLabel('LANDMARKS');
  const landmarks = getDeepSpaceObjects().filter(o => o.isLandmark);
  for (const lm of landmarks) {
    const el = document.createElement('div');
    el.className = 'pb-item pb-landmark';
    el.innerHTML = `<div class="pb-name">${lm.name}</div><div class="pb-dist"></div>`;
    el.addEventListener('click', () => {
      setActivePlanet(lm.name);
      import('./flight.js').then(m => m.warpTo(lm.name));
    });
    barContainer.appendChild(el);

    barItems.push({ el, distEl: el.querySelector('.pb-dist'), name: lm.name, bodyRef: lm });
  }
}

function updateBar(camPos) {
  if (!barContainer || barItems.length === 0) return;

  let nearestName = null;
  let nearestDist = Infinity;

  for (let i = 0; i < barItems.length; i++) {
    const item = barItems[i];
    const bodyPos = item.bodyRef.g.userData._worldPos || item.bodyRef.g.position;
    const dist = camPos.distanceTo(bodyPos);

    if (dist < nearestDist) {
      nearestDist = dist;
      nearestName = item.name;
    }

    // Update distance text
    if (item.distEl) {
      if (item.bodyRef.isLandmark) {
        const distLY = dist / (AU * 63241);
        if (distLY > 1000000) {
          item.distEl.textContent = (distLY / 1000000).toFixed(1) + 'M LY';
        } else if (distLY > 1000) {
          item.distEl.textContent = (distLY / 1000).toFixed(1) + 'K LY';
        } else {
          item.distEl.textContent = distLY.toFixed(0) + ' LY';
        }
      } else {
        const distAU = dist / AU;
        if (distAU > 10) {
          item.distEl.textContent = distAU.toFixed(0) + ' AU';
        } else if (distAU > 0.1) {
          item.distEl.textContent = distAU.toFixed(1) + ' AU';
        } else {
          const km = dist * 50000;
          if (km > 1000000) item.distEl.textContent = (km / 1000000).toFixed(1) + 'M km';
          else item.distEl.textContent = (km / 1000).toFixed(0) + 'K km';
        }
      }
    }
  }

  // Only auto-highlight nearest after user has interacted, and not mid-flight
  if (_userSelected && nearestName !== _currentNearest && !isFlyingTo()) {
    _currentNearest = nearestName;
    for (let i = 0; i < barItems.length; i++) {
      barItems[i].el.classList.toggle('active', barItems[i].name === nearestName);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// Init / Update
// ═══════════════════════════════════════════════════════════════

let _initialized = false;

export function initNavigation(camera) {
  elTimeScale = document.getElementById('time-scale');

  window.addEventListener('keydown', (e) => {
    if (e.code === 'BracketRight' || e.code === 'Period') cycleTimeScale(1);
    if (e.code === 'BracketLeft' || e.code === 'Comma') cycleTimeScale(-1);
  });

  updateTimeHud();
}

export function updateNavigation(dt, camPos, speed, allBodies) {
  if (!_initialized && allBodies && allBodies.length > 0) {
    createBar(allBodies);
    _initialized = true;
  }

  updateBar(camPos);
}
