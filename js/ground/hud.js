// ground/hud.js — the suit's glass.
//
// On the ground the traveler is IN something: a helmet. The HUD is its
// glass — a compass ribbon overhead (the one instrument a planet
// demands), a phosphor readout in the corner in the ship's own
// teletype voice, and the faintest vignette of a visor's edge. All of
// it amber, all of it quiet, none of it a menu.

import * as THREE from 'three';
import { setMapMount } from './map.js';
import { setChatSurface } from '../shipchat.js';

const MONO = "'SF Mono','Cascadia Mono','JetBrains Mono',Menlo,Consolas,'Courier New',monospace";
const AMBER = 'rgba(255,186,100,';

let vignette = null, compass = null, cctx = null, panel = null;
let lines = {};
let textTimer = 0;
let strip = null;
let chips = {};      // key → {el, cap}
let lastGait = null;
let cockpit = null;  // the rover's cab framing
let survey = null;   // the readings panel beside a stake
let lastHeading = 0, parX = 0, parY = 0;
let _crtT = 0, _btnT = 0;
let _bobAng = 0, _bobVel = 0, _bobPrevSpd = 0;
let guidance = null, guideList = null;
let _gT = 0, _gEvents = null;

const HELMET_BG =
  'radial-gradient(ellipse 75% 66% at 50% 46%, transparent 58%, rgba(12,7,4,0.34) 100%)';
const ROVER_BG =
  'linear-gradient(to top, rgba(8,5,3,0.55) 0%, transparent 16%),' +
  'linear-gradient(to bottom, rgba(8,5,3,0.30) 0%, transparent 8%),' +
  'radial-gradient(ellipse 92% 58% at 50% 40%, transparent 52%, rgba(8,5,3,0.48) 96%)';

function makeChip(keyLabel, caption, onClick) {
  const el = document.createElement('div');
  el.style.cssText =
    'display:flex;align-items:center;gap:6px;cursor:pointer;pointer-events:auto;' +
    'transition:opacity 0.4s;';
  const key = document.createElement('span');
  key.textContent = keyLabel;
  key.style.cssText =
    `font-family:${MONO};font-size:9.5px;letter-spacing:1px;color:${AMBER}0.75);` +
    `border:1px solid ${AMBER}0.4);border-radius:3px;padding:1.5px 6px;` +
    'text-shadow:0 1px 3px rgba(0,0,0,0.9);transition:all 0.25s;';
  const cap = document.createElement('span');
  cap.textContent = caption;
  cap.style.cssText =
    `font-family:${MONO};font-size:9px;letter-spacing:2.5px;color:${AMBER}0.5);` +
    'text-shadow:0 1px 3px rgba(0,0,0,0.9);transition:color 0.25s;';
  el.appendChild(key);
  el.appendChild(cap);
  if (onClick) {
    el.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    el.addEventListener('mousedown', (e) => e.stopPropagation());
  }
  return { el, key, cap };
}

// The visor's instruments become cab hardware when the gait changes:
// the compass ribbon gets a heading-tape housing bolted to the header,
// the switch strip becomes a row of backlit console buttons.
function mountCompass(roving) {
  if (!compass) return;
  if (roving) {
    compass.style.top = '46px';
    compass.style.background = 'linear-gradient(rgba(8,6,4,0.94), rgba(11,8,6,0.96))';
    compass.style.borderRadius = '7px';
    compass.style.boxShadow =
      '0 0 0 4px rgba(26,22,18,0.95), 0 0 0 6px rgba(210,195,165,0.38), ' +
      'inset 0 0 14px rgba(0,0,0,0.5), 0 5px 14px rgba(0,0,0,0.55)';
  } else {
    compass.style.top = '14px';
    compass.style.background = 'none';
    compass.style.borderRadius = '0';
    compass.style.boxShadow = 'none';
  }
}

function mountStrip(roving) {
  if (!strip) return;
  if (roving) {
    strip.style.bottom = '18px';
    strip.style.padding = '9px 20px';
    strip.style.background = 'linear-gradient(rgba(16,13,10,0.95), rgba(10,8,6,0.97))';
    strip.style.borderRadius = '8px';
    strip.style.boxShadow =
      '0 0 0 3px rgba(26,22,18,0.95), 0 0 0 5px rgba(210,195,165,0.32), ' +
      'inset 0 1px 0 rgba(255,255,255,0.05), 0 4px 12px rgba(0,0,0,0.5)';
  } else {
    strip.style.bottom = '22px';
    strip.style.padding = '0';
    strip.style.background = 'none';
    strip.style.borderRadius = '0';
    strip.style.boxShadow = 'none';
  }
  for (const k in chips) {
    const key = chips[k].key;
    if (roving) {
      key.style.background = key.style.background || 'transparent';
      key.style.backgroundColor = '#1d1712';
      key.style.boxShadow = '0 2px 0 rgba(0,0,0,0.65), inset 0 1px 0 rgba(255,255,255,0.07)';
      key.style.borderRadius = '4px';
    } else {
      key.style.backgroundColor = '';
      key.style.boxShadow = '';
      key.style.borderRadius = '3px';
    }
  }
}

function setChipLit(chip, lit) {
  chip.key.style.background = lit ? AMBER + '0.18)' : 'transparent';
  chip.key.style.color = lit ? AMBER + '1)' : AMBER + '0.75)';
  chip.key.style.borderColor = lit ? AMBER + '0.8)' : AMBER + '0.4)';
  chip.key.style.textShadow = lit
    ? '0 1px 3px rgba(0,0,0,0.9),0 0 8px rgba(255,170,80,0.5)'
    : '0 1px 3px rgba(0,0,0,0.9)';
  chip.cap.style.color = lit ? AMBER + '0.85)' : AMBER + '0.5)';
}

export function initGroundHud(siteName, actions = {}) {
  // The visor's edge — barely there, but the frame makes the world a view
  vignette = document.createElement('div');
  vignette.style.cssText =
    'position:fixed;inset:0;pointer-events:none;z-index:44;' +
    'background:radial-gradient(ellipse 75% 66% at 50% 46%, transparent 58%, rgba(12,7,4,0.34) 100%);';
  document.body.appendChild(vignette);

  // Compass ribbon
  compass = document.createElement('canvas');
  const W = 460, H = 34;
  compass.width = W * 2; compass.height = H * 2;   // retina
  compass.style.cssText =
    'position:fixed;top:14px;left:50%;transform:translateX(-50%);' +
    `width:${W}px;height:${H}px;pointer-events:none;z-index:46;` +
    '-webkit-mask-image:linear-gradient(90deg,transparent 0,#000 18%,#000 82%,transparent 100%);' +
    'mask-image:linear-gradient(90deg,transparent 0,#000 18%,#000 82%,transparent 100%);';
  document.body.appendChild(compass);
  cctx = compass.getContext('2d');
  cctx.scale(2, 2);

  // Suit readout — the terminal's voice on the visor
  panel = document.createElement('div');
  panel.style.cssText =
    'position:fixed;top:18px;left:22px;z-index:46;pointer-events:none;' +
    `font-family:${MONO};color:${AMBER}0.62);text-shadow:0 1px 4px rgba(0,0,0,0.9),0 0 9px rgba(255,150,60,0.25);` +
    '-webkit-mask-image:repeating-linear-gradient(0deg,#000 0 2px,rgba(0,0,0,0.65) 2px 3px);' +
    'mask-image:repeating-linear-gradient(0deg,#000 0 2px,rgba(0,0,0,0.65) 2px 3px);';
  const title = document.createElement('div');
  title.textContent = siteName;
  title.style.cssText = `font-size:15px;letter-spacing:7px;color:${AMBER}0.8);margin-bottom:7px;`;
  panel.appendChild(title);
  for (const key of ['elev', 'env', 'motion', 'wind']) {
    const el = document.createElement('div');
    el.style.cssText = 'font-size:10.5px;letter-spacing:2.5px;margin-top:3px;';
    panel.appendChild(el);
    lines[key] = el;
  }
  document.body.appendChild(panel);

  // The frames you live inside — DRAWN, not implied. The helmet is an
  // aperture with a rim, a brow, a chin console (the switch strip's
  // home); the cab has real pillars, a header, and a dashboard with a
  // console hump. SVG, painted in the ship's own light.
  cockpit = document.createElement('div');
  cockpit.style.cssText =
    'position:fixed;inset:0;pointer-events:none;z-index:45;';
  cockpit.innerHTML =
    // ── HELMET ──
    '<svg id="hud-helmet" viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" ' +
    'style="position:absolute;inset:0;width:100%;height:100%;opacity:1;transition:opacity 0.6s;">' +
    '<defs><filter id="hblur"><feGaussianBlur stdDeviation="14"/></filter></defs>' +
    // shell outside the visor aperture
    '<path fill-rule="evenodd" fill="rgba(9,6,4,0.88)" d="M0,0 H1920 V1080 H0 Z ' +
    'M960,42 C1450,42 1878,180 1878,540 C1878,900 1450,1038 960,1038 C470,1038 42,900 42,540 C42,180 470,42 960,42 Z"/>' +
    // visor rim: a hard edge and a faint inner catch-light
    '<path fill="none" stroke="rgba(150,140,128,0.34)" stroke-width="3" d="M960,42 C1450,42 1878,180 1878,540 C1878,900 1450,1038 960,1038 C470,1038 42,900 42,540 C42,180 470,42 960,42 Z"/>' +
    '<path fill="none" stroke="rgba(255,186,100,0.10)" stroke-width="9" d="M960,52 C1444,52 1868,186 1868,540 C1868,894 1444,1028 960,1028 C476,1028 52,894 52,540 C52,186 476,52 960,52 Z"/>' +
    // glass: two soft reflection streaks, upper left
    '<g filter="url(#hblur)" opacity="0.05">' +
    '<rect x="240" y="120" width="520" height="46" fill="#fff" transform="rotate(-16 240 120)"/>' +
    '<rect x="180" y="230" width="330" height="26" fill="#fff" transform="rotate(-16 180 230)"/></g>' +
    // brow plate (the compass mounts here)
    '<path fill="rgba(11,7,5,0.85)" d="M560,0 H1360 L1330,64 Q960,86 590,64 Z"/>' +
    // chin console (the switch strip mounts here)
    '<path fill="rgba(12,8,6,0.92)" d="M620,1080 L672,1006 Q960,978 1248,1006 L1300,1080 Z"/>' +
    '<path fill="none" stroke="rgba(255,170,80,0.28)" stroke-width="2" d="M672,1006 Q960,978 1248,1006"/>' +
    '<text x="960" y="1069" text-anchor="middle" font-family="SF Mono,Menlo,monospace" font-size="12" letter-spacing="6" fill="rgba(200,180,150,0.28)">EVA-1 · SOLACE</text>' +
    '<g fill="rgba(160,145,125,0.3)"><circle cx="700" cy="1052" r="3.5"/><circle cx="1220" cy="1052" r="3.5"/></g>' +
    '</svg>' +
    // ── CAB — a truck someone LIVES in: depth, wells, switches, and
    // the crew's own junk on the shelf ──
    '<svg id="hud-cab" viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" ' +
    'font-family="SF Mono,Menlo,monospace" ' +
    'style="position:absolute;inset:0;width:100%;height:100%;opacity:0;transition:opacity 0.6s;">' +
    '<defs>' +
    '<filter id="grime"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" result="n"/>' +
    '<feColorMatrix in="n" type="matrix" values="0 0 0 0 0.55 0 0 0 0 0.45 0 0 0 0 0.35 0 0 0 0.05 0"/>' +
    '<feComposite in2="SourceGraphic" operator="atop"/></filter>' +
    '<filter id="phos"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge>' +
    '<feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>' +
    '<filter id="soft"><feGaussianBlur stdDeviation="5"/></filter>' +
    '<pattern id="scan" width="4" height="5" patternUnits="userSpaceOnUse">' +
    '<rect width="4" height="2.4" fill="rgba(0,0,0,0.42)"/></pattern>' +
    '<pattern id="hazard" width="28" height="28" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">' +
    '<rect width="14" height="28" fill="rgba(190,150,45,0.30)"/><rect x="14" width="14" height="28" fill="rgba(20,14,8,0.55)"/></pattern>' +
    '<radialGradient id="crtglass" cx="0.5" cy="0.42" r="0.75">' +
    '<stop offset="0%" stop-color="rgba(255,255,255,0.07)"/><stop offset="55%" stop-color="rgba(255,255,255,0.015)"/><stop offset="100%" stop-color="rgba(0,0,0,0.25)"/></radialGradient>' +
    '<linearGradient id="gShelf" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0%" stop-color="#3a3128"/><stop offset="45%" stop-color="#2a2219"/><stop offset="100%" stop-color="#17110c"/></linearGradient>' +
    '<linearGradient id="gFace" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0%" stop-color="#221b14"/><stop offset="100%" stop-color="#0b0806"/></linearGradient>' +
    '<linearGradient id="gWell" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0%" stop-color="#050403"/><stop offset="100%" stop-color="#140f0a"/></linearGradient>' +
    '<linearGradient id="gMug" x1="0" y1="0" x2="1" y2="0">' +
    '<stop offset="0%" stop-color="#5a4636"/><stop offset="35%" stop-color="#8a7258"/><stop offset="70%" stop-color="#4c3a2c"/><stop offset="100%" stop-color="#2e2318"/></linearGradient>' +
    '</defs>' +
    // ── OVERHEAD CONSOLE — the ceiling is instruments too ──
    '<path fill="rgba(8,6,4,0.97)" d="M0,0 H1920 V96 Q1500,148 1160,152 L760,152 Q420,148 0,96 Z"/>' +
    '<path fill="none" stroke="rgba(210,195,165,0.14)" stroke-width="2" d="M0,96 Q420,148 760,152 L1160,152 Q1500,148 1920,96"/>' +
    '<g id="gen-ovh"></g>' +
    '<text x="960" y="24" text-anchor="middle" font-size="12" letter-spacing="7" fill="rgba(210,195,165,0.22)">MRV-01 &#183; SOLACE EXPEDITIONARY</text>' +
    // conduit runs where ceiling meets pillar
    '<path d="M300,10 q-40,180 -150,320" stroke="#0a0705" stroke-width="13" fill="none"/>' +
    '<path d="M300,10 q-40,180 -150,320" stroke="rgba(210,195,165,0.10)" stroke-width="2" fill="none"/>' +
    '<path d="M1620,10 q40,180 150,320" stroke="#0a0705" stroke-width="13" fill="none"/>' +
    '<path d="M1620,10 q40,180 150,320" stroke="rgba(210,195,165,0.10)" stroke-width="2" fill="none"/>' +
    // A-pillars with mounted switch PLATES (angled with the pillar)
    '<path fill="rgba(11,8,6,0.97)" d="M0,0 H300 L128,640 Q60,760 0,800 Z"/>' +
    '<path fill="rgba(11,8,6,0.97)" d="M1920,0 H1620 L1792,640 Q1860,760 1920,800 Z"/>' +
    '<path fill="none" stroke="rgba(210,195,165,0.14)" stroke-width="2.5" d="M300,0 L128,640 Q60,760 0,800"/>' +
    '<path fill="none" stroke="rgba(210,195,165,0.14)" stroke-width="2.5" d="M1620,0 L1792,640 Q1860,760 1920,800"/>' +
    '<g transform="rotate(-11 250 340)">' +
    '<rect x="216" y="240" width="62" height="196" rx="7" fill="#161009" stroke="rgba(210,195,165,0.25)" stroke-width="2.5"/>' +
    '<circle cx="228" cy="254" r="2.5" fill="rgba(210,195,165,0.3)"/><circle cx="266" cy="422" r="2.5" fill="rgba(210,195,165,0.3)"/>' +
    '<circle class="lens" data-c="255,170,80" cx="247" cy="284" r="7" fill="rgb(255,170,80)" fill-opacity="0.75"/>' +
    '<circle class="lens" data-c="140,220,110" cx="247" cy="324" r="7" fill="rgb(140,220,110)" fill-opacity="0.2"/>' +
    '<circle class="lens" data-c="200,90,60" cx="247" cy="364" r="7" fill="rgb(200,90,60)" fill-opacity="0.6"/>' +
    '<circle class="lens" data-c="210,195,165" cx="247" cy="404" r="7" fill="rgb(210,195,165)" fill-opacity="0.15"/>' +
    '</g>' +
    '<g transform="rotate(11 1670 340)">' +
    '<rect x="1642" y="240" width="62" height="196" rx="7" fill="#161009" stroke="rgba(210,195,165,0.25)" stroke-width="2.5"/>' +
    '<circle class="lens" data-c="255,170,80" cx="1673" cy="284" r="7" fill="rgb(255,170,80)" fill-opacity="0.3"/>' +
    '<circle class="lens" data-c="120,170,220" cx="1673" cy="324" r="7" fill="rgb(120,170,220)" fill-opacity="0.7"/>' +
    '<circle class="lens" data-c="140,220,110" cx="1673" cy="364" r="7" fill="rgb(140,220,110)" fill-opacity="0.65"/>' +
    '<circle class="lens" data-c="255,170,80" cx="1673" cy="404" r="7" fill="rgb(255,170,80)" fill-opacity="0.12"/>' +
    '</g>' +
    '<path fill="url(#hazard)" d="M0,800 Q60,760 128,640 L164,640 Q104,780 0,854 Z"/>' +
    '<path fill="url(#hazard)" d="M1920,800 Q1860,760 1792,640 L1756,640 Q1816,780 1920,854 Z"/>' +
    // ── THE SHELF: a lit top surface — depth begins here ──
    '<path fill="url(#gShelf)" filter="url(#grime)" d="M0,796 Q430,748 660,740 L1260,740 Q1490,748 1920,796 L1920,876 Q1490,838 1260,830 L660,830 Q430,838 0,876 Z"/>' +
    '<path fill="none" stroke="rgba(255,220,170,0.20)" stroke-width="2" d="M0,796 Q430,748 660,740 L1260,740 Q1490,748 1920,796"/>' +
    // ── THE FACE, falling away darker below the shelf lip ──
    '<path fill="url(#gFace)" filter="url(#grime)" d="M0,876 Q430,838 660,830 L1260,830 Q1490,838 1920,876 V1080 H0 Z"/>' +
    '<path fill="none" stroke="rgba(0,0,0,0.55)" stroke-width="3" d="M0,878 Q430,840 660,832 L1260,832 Q1490,840 1920,878"/>' +
    // panel seams + screws + placards
    '<g stroke="rgba(0,0,0,0.5)" stroke-width="1.5"><path d="M340,1080 L354,846"/><path d="M1580,1080 L1566,846"/></g>' +
    '<g fill="rgba(210,195,165,0.2)"><circle cx="348" cy="866" r="3.5"/><circle cx="1572" cy="866" r="3.5"/><circle cx="40" cy="900" r="3.5"/><circle cx="1880" cy="900" r="3.5"/></g>' +
    '<text x="356" y="1072" font-size="10" letter-spacing="2" fill="rgba(210,195,165,0.32)">ENV/02</text>' +
    '<g id="gen-left"></g>' +
    '<g id="gen-right"></g>' +
    '<g id="gen-keys"></g>' +
    '<rect x="64" y="988" width="150" height="32" rx="3" fill="url(#hazard)" opacity="0.65"/>' +
    '<text x="139" y="1040" text-anchor="middle" font-size="9" letter-spacing="2" fill="rgba(210,195,165,0.4)">NO STEP &#183; SVC PNL 4</text>' +
    // ── BOBBLEHEAD on the shelf, left — it rides the suspension ──
    '<g id="bobble">' +
    '<ellipse cx="256" cy="795" rx="26" ry="7" fill="rgba(0,0,0,0.5)" filter="url(#soft)"/>' +
    '<path d="M240,792 Q256,780 272,792 L268,776 Q256,768 244,776 Z" fill="#463a2c"/>' +
    '<path id="bobble-spring" d="M256,774 l-5,-5 l10,-5 l-10,-5 l10,-5 l-5,-5" stroke="rgba(210,195,165,0.5)" stroke-width="2.5" fill="none"/>' +
    '<g id="bobble-head">' +
    '<circle cx="256" cy="726" r="22" fill="#c9b8a0"/>' +
    '<circle cx="256" cy="726" r="22" fill="none" stroke="rgba(0,0,0,0.35)" stroke-width="2"/>' +
    '<path d="M240,726 a16,13 0 0 1 32,0 a16,10 0 0 1 -32,0" fill="#2a2622"/>' +
    '<circle cx="262" cy="720" r="4" fill="rgba(255,255,255,0.25)"/>' +
    '</g></g>' +
    // ── COFFEE MUG in its holder, right shelf — steam and all ──
    '<g id="mug">' +
    '<ellipse cx="1478" cy="798" rx="34" ry="9" fill="rgba(0,0,0,0.5)" filter="url(#soft)"/>' +
    '<ellipse cx="1478" cy="792" rx="30" ry="8" fill="#241c14" stroke="rgba(210,195,165,0.3)" stroke-width="2"/>' +
    '<path d="M1456,790 V736 a22,7 0 0 1 44,0 V790 Z" fill="url(#gMug)"/>' +
    '<ellipse cx="1478" cy="736" rx="22" ry="7" fill="#1c130c"/>' +
    '<ellipse cx="1478" cy="737" rx="17" ry="5" fill="#30201159"/>' +
    '<ellipse cx="1478" cy="737.5" rx="17" ry="5" fill="#3a2412"/>' +
    '<path d="M1500,748 q16,4 12,20 q-3,12 -14,12" stroke="#6a5540" stroke-width="6" fill="none"/>' +
    '<path d="M1471,722 q-5,-12 2,-20" stroke="rgba(220,220,220,0.0)" stroke-width="3" fill="none" stroke-linecap="round">' +
    '<animate attributeName="stroke" values="rgba(220,220,220,0);rgba(220,220,220,0.22);rgba(220,220,220,0)" dur="3.4s" repeatCount="indefinite"/></path>' +
    '<path d="M1484,720 q6,-14 -1,-24" stroke="rgba(220,220,220,0.0)" stroke-width="3" fill="none" stroke-linecap="round">' +
    '<animate attributeName="stroke" values="rgba(220,220,220,0);rgba(220,220,220,0.18);rgba(220,220,220,0)" dur="4.1s" begin="1.6s" repeatCount="indefinite"/></path>' +
    '</g>' +
    // ── VEL GAUGE in a recessed well ──
    '<rect x="366" y="852" width="208" height="200" rx="14" fill="url(#gWell)" stroke="rgba(0,0,0,0.6)" stroke-width="3"/>' +
    '<path d="M370,856 h200" stroke="rgba(255,220,170,0.10)" stroke-width="2"/>' +
    '<g id="gauge-vel">' +
    '<circle cx="470" cy="948" r="82" fill="rgba(6,5,4,0.98)" stroke="rgba(210,195,165,0.45)" stroke-width="6"/>' +
    '<g id="vel-ticks" stroke="rgba(255,186,100,0.55)" stroke-width="2"></g>' +
    '<line id="vel-needle" x1="470" y1="948" x2="470" y2="884" stroke="rgba(255,110,45,0.95)" stroke-width="3.5" stroke-linecap="round"/>' +
    '<circle cx="470" cy="948" r="7" fill="rgba(210,195,165,0.55)"/>' +
    '<text x="470" y="992" text-anchor="middle" font-size="12" letter-spacing="3" fill="rgba(255,186,100,0.5)">GND VEL</text>' +
    '<text id="vel-digits" x="470" y="926" text-anchor="middle" font-size="18" fill="rgba(255,200,130,0.85)">0.0</text>' +
    '</g>' +
    // ── INCLINOMETER, its own small well ──
    '<rect x="592" y="952" width="116" height="116" rx="12" fill="url(#gWell)" stroke="rgba(0,0,0,0.6)" stroke-width="3"/>' +
    '<g id="gauge-incl">' +
    '<circle cx="650" cy="1006" r="46" fill="rgba(6,5,4,0.98)" stroke="rgba(210,195,165,0.4)" stroke-width="4"/>' +
    '<path d="M616,1006 H684" stroke="rgba(255,186,100,0.3)" stroke-width="1.5"/>' +
    '<line id="incl-needle" x1="650" y1="1006" x2="650" y2="972" stroke="rgba(140,220,110,0.85)" stroke-width="3" stroke-linecap="round"/>' +
    '<circle cx="650" cy="1006" r="5" fill="rgba(210,195,165,0.5)"/>' +
    '<text x="650" y="1044" text-anchor="middle" font-size="10" letter-spacing="2" fill="rgba(255,186,100,0.45)">BANK</text>' +
    '</g>' +
    // ── CRTs, recessed ──
    '<rect x="688" y="842" width="276" height="172" rx="12" fill="url(#gWell)" stroke="rgba(0,0,0,0.6)" stroke-width="3"/>' +
    '<g id="crt-env">' +
    '<rect x="704" y="856" width="244" height="142" rx="8" fill="rgba(4,7,4,0.99)" stroke="rgba(210,195,165,0.4)" stroke-width="4"/>' +
    '<text x="720" y="882" font-size="12" letter-spacing="2" fill="rgba(140,230,120,0.45)">ECU-5 // ENVIRON</text>' +
    '<g filter="url(#phos)">' +
    '<text id="crt-l1" x="720" y="910" font-size="18" letter-spacing="1" fill="rgba(140,230,120,0.8)">ELEV</text>' +
    '<text id="crt-l2" x="720" y="936" font-size="18" letter-spacing="1" fill="rgba(140,230,120,0.8)">TEMP</text>' +
    '<text id="crt-l3" x="720" y="962" font-size="18" letter-spacing="1" fill="rgba(140,230,120,0.68)">WIND</text>' +
    '<text id="crt-cur" x="720" y="984" font-size="16" fill="rgba(140,230,120,0.8)">&#9646;</text></g>' +
    '<rect x="704" y="856" width="244" height="142" rx="8" fill="url(#scan)"/>' +
    '<rect x="704" y="856" width="244" height="142" rx="8" fill="url(#crtglass)"/>' +
    '</g>' +
    '<rect x="976" y="842" width="276" height="172" rx="12" fill="url(#gWell)" stroke="rgba(0,0,0,0.6)" stroke-width="3"/>' +
    '<g id="crt-sys">' +
    '<rect x="992" y="856" width="244" height="142" rx="8" fill="rgba(8,5,3,0.99)" stroke="rgba(210,195,165,0.4)" stroke-width="4"/>' +
    `<text x="1008" y="882" font-size="12" letter-spacing="2" fill="rgba(255,186,100,0.45)">MU-TH // SYS &#183; R:${typeof __SOLACE_BUILD__ !== 'undefined' ? __SOLACE_BUILD__ : 'dev'}</text>` +
    '<g filter="url(#phos)">' +
    '<text id="sys-l1" x="1008" y="910" font-size="18" letter-spacing="1" fill="rgba(255,186,100,0.85)">GAIT</text>' +
    '<text id="sys-l2" x="1008" y="936" font-size="18" letter-spacing="1" fill="rgba(255,186,100,0.75)">STK</text>' +
    '<text id="sys-l3" x="1008" y="962" font-size="18" letter-spacing="1" fill="rgba(255,186,100,0.6)">HDG</text></g>' +
    '<rect x="992" y="856" width="244" height="142" rx="8" fill="url(#scan)"/>' +
    '<rect x="992" y="856" width="244" height="142" rx="8" fill="url(#crtglass)"/>' +
    '</g>' +
    // ── SWITCHGEAR: lenses in wells, bat toggles, one guarded ──
    '<rect x="1280" y="852" width="316" height="200" rx="14" fill="url(#gWell)" stroke="rgba(0,0,0,0.6)" stroke-width="3"/>' +
    '<path d="M1284,856 h308" stroke="rgba(255,220,170,0.10)" stroke-width="2"/>' +
    '<g font-size="10" letter-spacing="1">' +
    '<g id="st-lamp"><circle cx="1318" cy="890" r="11" fill="#080604" stroke="rgba(210,195,165,0.35)" stroke-width="2.5"/>' +
    '<circle id="lp-lamp" cx="1318" cy="890" r="6.5" fill="rgb(255,190,90)" fill-opacity="0.12"/>' +
    '<text x="1336" y="894" fill="rgba(210,195,165,0.42)">LAMP</text></g>' +
    '<g id="st-boost"><circle cx="1318" cy="922" r="11" fill="#080604" stroke="rgba(210,195,165,0.35)" stroke-width="2.5"/>' +
    '<circle id="lp-boost" cx="1318" cy="922" r="6.5" fill="rgb(255,140,60)" fill-opacity="0.12"/>' +
    '<text x="1336" y="926" fill="rgba(210,195,165,0.42)">BOOST</text></g>' +
    '<g id="st-srv"><circle cx="1432" cy="890" r="11" fill="#080604" stroke="rgba(210,195,165,0.35)" stroke-width="2.5"/>' +
    '<circle id="lp-srv" cx="1432" cy="890" r="6.5" fill="rgb(140,220,110)" fill-opacity="0.12"/>' +
    '<text x="1450" y="894" fill="rgba(210,195,165,0.42)">SRV</text></g>' +
    '<g id="st-pwr"><circle cx="1432" cy="922" r="11" fill="#080604" stroke="rgba(210,195,165,0.35)" stroke-width="2.5"/>' +
    '<circle id="lp-pwr" cx="1432" cy="922" r="6.5" fill="rgb(140,220,110)" fill-opacity="0.75"/>' +
    '<text x="1450" y="926" fill="rgba(210,195,165,0.42)">PWR</text></g>' +
    '<circle class="lens" data-c="255,170,80" cx="1538" cy="890" r="6.5" fill="rgb(255,170,80)" fill-opacity="0.5"/>' +
    '<circle class="lens" data-c="120,170,220" cx="1538" cy="922" r="6.5" fill="rgb(120,170,220)" fill-opacity="0.25"/>' +
    '</g>' +
    // bat toggles: bases + levers (two up, one down) + one guarded
    '<g stroke-linecap="round">' +
    '<g class="tog"><rect x="1306" y="964" width="26" height="14" rx="4" fill="#241d15" stroke="rgba(210,195,165,0.3)" stroke-width="2"/>' +
    '<line x1="1319" y1="971" x2="1319" y2="950" stroke="#b8a488" stroke-width="6"/><circle cx="1319" cy="948" r="4.5" fill="#d6c4a8"/></g>' +
    '<g class="tog"><rect x="1356" y="964" width="26" height="14" rx="4" fill="#241d15" stroke="rgba(210,195,165,0.3)" stroke-width="2"/>' +
    '<line x1="1369" y1="971" x2="1369" y2="992" stroke="#b8a488" stroke-width="6"/><circle cx="1369" cy="994" r="4.5" fill="#8a7a62"/></g>' +
    '<g class="tog"><rect x="1406" y="964" width="26" height="14" rx="4" fill="#241d15" stroke="rgba(210,195,165,0.3)" stroke-width="2"/>' +
    '<line x1="1419" y1="971" x2="1419" y2="950" stroke="#b8a488" stroke-width="6"/><circle cx="1419" cy="948" r="4.5" fill="#d6c4a8"/></g>' +
    '</g>' +
    '<g id="guard"><rect x="1470" y="952" width="44" height="52" rx="6" fill="#33150f" stroke="rgba(210,180,120,0.4)" stroke-width="2.5"/>' +
    '<path d="M1470,958 h44" stroke="rgba(255,200,120,0.25)" stroke-width="2"/>' +
    '<text x="1492" y="1022" text-anchor="middle" font-size="9" letter-spacing="1" fill="rgba(210,180,140,0.45)">ARM</text></g>' +
    '</svg>';
  document.body.appendChild(cockpit);

  // ── PANEL GENERATORS: the Nostromo look is DENSITY — fields of
  // tiny lights, bar-meter banks, breakers, keys — programmatic,
  // deterministic, each module framed and glowing as a pool ──
  {
    const rnd = (seed) => { let t = seed; return () => (t = (t * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; };
    const CHOICES = [
      ['255,170,80'], ['255,170,80'], ['255,170,80'], ['255,150,55'], ['255,150,55'],
      ['255,190,110'], ['255,170,80'], ['140,220,110'], ['200,90,60'], ['120,170,220'],
    ];
    const frame = (x, y, w, h) =>
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="#0a0705" stroke="rgba(210,195,165,0.20)" stroke-width="2"/>` +
      `<circle cx="${x + 8}" cy="${y + 8}" r="2" fill="rgba(210,195,165,0.25)"/>` +
      `<circle cx="${x + w - 8}" cy="${y + h - 8}" r="2" fill="rgba(210,195,165,0.25)"/>`;
    const dotField = (x, y, cols, rows, pitch, seed, litFrac) => {
      const r = rnd(seed);
      let out = `<rect x="${x - 4}" y="${y - 4}" width="${cols * pitch + 8}" height="${rows * pitch + 8}" fill="rgba(255,150,60,0.05)" filter="url(#soft)"/>`;
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const [c] = CHOICES[Math.floor(r() * CHOICES.length)];
          const lit = r() < litFrac;
          out += `<circle class="mdot" data-c="${c}" cx="${x + i * pitch + pitch / 2}" cy="${y + j * pitch + pitch / 2}" r="${pitch * 0.30}" ` +
            `fill="rgb(${c})" fill-opacity="${lit ? (0.45 + r() * 0.5).toFixed(2) : '0.07'}"/>`;
        }
      }
      return out;
    };
    const barBank = (x, y, n, seed) => {
      const r = rnd(seed);
      let out = `<rect x="${x - 5}" y="${y - 6}" width="${n * 13 + 10}" height="66" fill="rgba(255,150,60,0.05)" filter="url(#soft)"/>`;
      for (let i = 0; i < n; i++) {
        const hgt = 12 + Math.floor(r() * 42);
        out += `<rect x="${x + i * 13}" y="${y}" width="6" height="54" rx="2" fill="#050403"/>` +
          `<rect class="mbar" x="${x + i * 13}" y="${y + 54 - hgt}" width="6" height="${hgt}" rx="2" fill="rgb(255,170,80)" fill-opacity="0.6"/>`;
      }
      return out;
    };
    const keyRow = (x, y, n, w, seed) => {
      const r = rnd(seed);
      let out = '';
      for (let i = 0; i < n; i++) {
        out += `<rect x="${x + i * (w + 3)}" y="${y}" width="${w}" height="13" rx="2.5" fill="#1a1510" ` +
          `stroke="rgba(0,0,0,0.6)" stroke-width="1"/>` +
          (r() > 0.85 ? `<rect x="${x + i * (w + 3) + 2}" y="${y + 2}" width="${w - 4}" height="2.5" fill="rgba(255,170,80,0.5)"/>` : '');
      }
      return out;
    };
    const gen = (gid, html) => { const g = cockpit.querySelector(gid); if (g) g.innerHTML = html; };

    // The ceiling: three light-field modules + a switch course
    gen('#gen-ovh',
      frame(390, 14, 320, 116) + dotField(402, 24, 24, 8, 12.5, 11, 0.55) +
      frame(760, 22, 400, 122) + dotField(774, 32, 22, 5, 12.5, 23, 0.5) + barBank(790, 116 - 30, 14, 31) +
      frame(1210, 14, 320, 116) + dotField(1222, 24, 24, 8, 12.5, 47, 0.6) +
      keyRow(300, 140, 10, 22, 5) + keyRow(1370, 140, 10, 22, 9));
    // Dash flanks: dense fields where the metal was bare
    gen('#gen-left',
      frame(214, 856, 140, 118) + dotField(224, 866, 10, 8, 12.5, 71, 0.5) +
      frame(214, 986, 140, 84) + barBank(226, 1002, 9, 83));
    gen('#gen-right',
      frame(1612, 856, 268, 214) + dotField(1624, 868, 20, 10, 12.5, 97, 0.55) +
      barBank(1636, 1006, 16, 113));
    // The keyboard course under the CRTs
    gen('#gen-keys',
      keyRow(692, 1022, 16, 30, 121) + keyRow(692, 1040, 16, 30, 131) +
      keyRow(986, 1022, 14, 30, 141) + keyRow(986, 1040, 14, 30, 151));
  }

  // Gauge ticks: 0–40 m/s over a 240° sweep, majors every 10
  {
    const g = cockpit.querySelector('#vel-ticks');
    if (g) {
      let ticks = '';
      for (let v = 0; v <= 40; v += 5) {
        const a = (-210 + (v / 40) * 240) * Math.PI / 180;
        const major = v % 10 === 0;
        const r1 = major ? 60 : 66, r2 = 74;
        ticks += `<line x1="${470 + Math.cos(a) * r1}" y1="${948 + Math.sin(a) * r1}" x2="${470 + Math.cos(a) * r2}" y2="${948 + Math.sin(a) * r2}" stroke-width="${major ? 3 : 1.5}"/>`;
        if (major) ticks += `<text x="${470 + Math.cos(a) * 46}" y="${948 + Math.sin(a) * 46 + 5}" text-anchor="middle" font-size="12" fill="rgba(255,186,100,0.5)" stroke="none">${v}</text>`;
      }
      g.innerHTML = ticks;
    }
  }


  // The switch strip — the suit labels its own controls, like every
  // console aboard. Clickable switches, lit when engaged.
  strip = document.createElement('div');
  strip.style.cssText =
    'position:fixed;bottom:22px;left:50%;transform:translateX(-50%);' +
    'display:flex;gap:22px;align-items:center;z-index:46;pointer-events:none;';
  chips.gait = makeChip('V', 'ROVER', actions.onGait);
  chips.run = makeChip('SHIFT', 'RUN');
  chips.hop = makeChip('SPACE', 'HOP');
  chips.stake = makeChip('E', 'PLANT STAKE', actions.onStake);
  chips.lift = makeChip('L', 'LIFT OFF', actions.onLiftoff);
  for (const k of ['gait', 'run', 'hop', 'stake', 'lift']) strip.appendChild(chips[k].el);
  document.body.appendChild(strip);

  // The lander's guidance feed: telemetry scrolling up the glass
  // during descent and ascent — the landing computer thinking aloud.
  guidance = document.createElement('div');
  guidance.style.cssText =
    `position:fixed;left:5vw;top:30vh;width:270px;z-index:46;pointer-events:none;` +
    `font-family:${MONO};font-size:12px;letter-spacing:1.5px;line-height:1.75;` +
    'color:rgba(140,230,120,0.75);opacity:0;transition:opacity 0.6s;' +
    'text-shadow:0 0 6px rgba(80,200,80,0.35),0 1px 3px rgba(0,0,0,0.9);' +
    '-webkit-mask-image:linear-gradient(to bottom,transparent 0,#000 26%);' +
    'mask-image:linear-gradient(to bottom,transparent 0,#000 26%);';
  guidance.innerHTML =
    '<div style="font-size:10px;letter-spacing:4px;color:rgba(140,230,120,0.45);' +
    'border-bottom:1px solid rgba(140,230,120,0.2);padding-bottom:4px;margin-bottom:6px;">LDR // GUIDANCE</div>' +
    '<div id="guide-list"></div>';
  document.body.appendChild(guidance);
  guideList = guidance.querySelector('#guide-list');

  // Survey readings — the stake answers, on the glass beside it
  survey = document.createElement('div');
  survey.style.cssText =
    `position:fixed;top:206px;right:22px;z-index:46;pointer-events:none;` +
    `font-family:${MONO};font-size:10px;letter-spacing:2px;color:${AMBER}0.66);` +
    'text-align:right;opacity:0;transition:opacity 0.5s;' +
    'text-shadow:0 1px 4px rgba(0,0,0,0.9),0 0 8px rgba(255,150,60,0.2);' +
    '-webkit-mask-image:repeating-linear-gradient(0deg,#000 0 2px,rgba(0,0,0,0.65) 2px 3px);' +
    'mask-image:repeating-linear-gradient(0deg,#000 0 2px,rgba(0,0,0,0.65) 2px 3px);';
  document.body.appendChild(survey);
  lastGait = null;
}

export function disposeGroundHud() {
  for (const el of [vignette, compass, panel, strip, cockpit, survey, guidance]) if (el && el.parentNode) el.parentNode.removeChild(el);
  vignette = null; compass = null; cctx = null; panel = null; lines = {}; strip = null; chips = {}; cockpit = null; survey = null;
  guidance = null; guideList = null; _gEvents = null;
}

const CARDINALS = [[0, 'N'], [45, 'NE'], [90, 'E'], [135, 'SE'], [180, 'S'], [225, 'SW'], [270, 'W'], [315, 'NW']];

/**
 * @param s {heading, elevMsl, tempC, sunElev, speed, mode, run, gust}
 */
export function updateGroundHud(dt, s) {
  if (!cctx) return;

  // The glass changes with the gait: helmet bubble on foot, a wider
  // windshield with a dashboard shadow in the rover.
  if (s.mode !== lastGait) {
    lastGait = s.mode;
    const roving = s.mode === 'rove';
    const flying = s.mode === 'descent' || s.mode === 'ascent';
    if (vignette) vignette.style.background = roving ? ROVER_BG : HELMET_BG;
    setMapMount(roving);
    setChatSurface(roving ? 'cab' : 'visor');
    mountCompass(roving);
    mountStrip(roving);
    if (cockpit) {
      const helm = cockpit.querySelector('#hud-helmet');
      const cab = cockpit.querySelector('#hud-cab');
      if (helm) helm.style.opacity = roving ? '0' : flying ? '0.55' : '1';
      if (cab) cab.style.opacity = roving ? '1' : '0';
    }
    if (strip) strip.style.opacity = flying ? '0' : '1';   // no switches mid-air
    if (chips.gait) {
      chips.gait.cap.textContent = roving ? 'DISMOUNT' : 'ROVER';
      setChipLit(chips.gait, roving);
    }
    if (chips.run) chips.run.cap.textContent = roving ? 'BOOST' : 'RUN';
    if (chips.hop) chips.hop.el.style.opacity = roving ? '0' : '1';
  }
  if (chips.run) setChipLit(chips.run, !!s.run && s.speed > 0.5);
  if (chips.stake) {
    chips.stake.cap.textContent =
      s.placing
        ? (s.placeBlocked === 'supply' ? `FABRICATING · ${s.supplyEtaMin} MIN`
          : s.placeBlocked === 'spacing' ? 'TOO CLOSE · 12 M'
          : s.placeBlocked === 'ground' ? 'GROUND REFUSES'
          : `SET STAKE · ×${s.supply}`)
        : s.inReach ? 'UPROOT'
        : s.supply > 0 ? `PLANT STAKE · ×${s.supply}`
        : `FABRICATING · ${s.supplyEtaMin} MIN`;
    setChipLit(chips.stake, !!s.inReach || (!!s.placing && !s.placeBlocked));
  }

  // The stake speaks when you stand beside it
  if (survey) {
    if (s.nearStake) {
      const r = s.nearStake.readings;
      survey.innerHTML =
        `<div style="color:${AMBER}0.85);letter-spacing:4px;margin-bottom:4px;">SURVEY S${s.nearStake.n}</div>` +
        `SLOPE ${r.slopePct}% · ${r.roughness}<br>` +
        `SUN ${r.sunHours} H/SOL<br>` +
        `FE-OX ${r.feox}% · SIO₂ ${r.sio2}%${r.ice > 0 ? ' · ICE TR ' + r.ice + '%' : ''}<br>` +
        `<span style="color:${AMBER}0.45);">${r.atmos}</span>`;
      survey.style.opacity = '1';
    } else {
      survey.style.opacity = '0';
    }
  }

  // ── The console lives: needle, CRTs, lamps, blinkenlights ──
  if (cockpit && s.mode === 'rove') {
    const q = (id) => cockpit.querySelector(id);
    const needle = q('#vel-needle');
    if (needle) {
      const ang = -210 + (THREE.MathUtils.clamp(s.speed, 0, 40) / 40) * 240 + 90;
      needle.setAttribute('transform', `rotate(${ang.toFixed(1)} 470 948)`);
    }
    const incl = q('#incl-needle');
    if (incl) incl.setAttribute('transform', `rotate(${THREE.MathUtils.clamp((s.rollDeg || 0) * 2.2, -55, 55).toFixed(1)} 650 1006)`);
    _crtT += dt;
    const cur = q('#crt-cur');
    if (cur) cur.style.opacity = Math.floor(_crtT / 0.53) % 2 ? '0' : '1';
    // an old tube coughs now and then
    for (const gid of ['#crt-env', '#crt-sys']) {
      const el = q(gid);
      if (el) el.style.opacity = (Math.sin(_crtT * 1.7 + (gid.length)) > 0.997) ? '0.72' : '1';
    }
    if (_crtT - _btnT > 1.9) {
      _btnT = _crtT;
      const pool = cockpit.querySelectorAll('.lens, .mdot');
      for (let k = 0; k < 4; k++) {
        const el = pool[Math.floor(Math.random() * pool.length)];
        if (!el) continue;
        const cur = parseFloat(el.getAttribute('fill-opacity') || '0.3');
        el.setAttribute('fill-opacity', cur > 0.4 ? '0.07' : (0.5 + Math.random() * 0.45).toFixed(2));
      }
      // a bar meter breathes somewhere
      const bars = cockpit.querySelectorAll('.mbar');
      const b = bars[Math.floor(Math.random() * bars.length)];
      if (b) {
        const hgt = 12 + Math.floor(Math.random() * 42);
        const y0 = parseFloat(b.previousElementSibling ? b.previousElementSibling.getAttribute('y') : b.getAttribute('y'));
        b.setAttribute('height', hgt);
        b.setAttribute('y', (y0 + 54 - hgt).toFixed(0));
      }
    }
    // The bobblehead rides the suspension — spring physics off the
    // real roll and the real speed changes
    {
      const spd = s.speed || 0;
      const impulse = (spd - _bobPrevSpd) * 3.2 + (s.rollDeg || 0) * 0.25;
      _bobPrevSpd = spd;
      _bobVel += (-14 * _bobAng - 4.2 * _bobVel + impulse) * dt * 8;
      _bobAng += _bobVel * dt * 8;
      _bobAng = THREE.MathUtils.clamp(_bobAng, -24, 24);
      const head = q('#bobble-head');
      if (head) head.setAttribute('transform', `rotate(${_bobAng.toFixed(1)} 256 750)`);
    }
    if (textTimer <= 0.01) {   // ride the same 4 Hz cadence as the text
      const dots = (label, val, w = 16) => label + ' ' + '.'.repeat(Math.max(1, w - label.length - String(val).length)) + ' ' + val;
      const vd = q('#vel-digits'); if (vd) vd.textContent = s.speed.toFixed(1);
      const l1 = q('#crt-l1'); if (l1) l1.textContent = dots('ELEV', (s.elevMsl / 1000).toFixed(2) + 'KM');
      const l2 = q('#crt-l2'); if (l2) l2.textContent = dots('TEMP', s.tempC + 'C/' + (s.sunElev > 0 ? '+' : '') + s.sunElev.toFixed(0));
      const l3 = q('#crt-l3'); if (l3) l3.textContent = dots('WIND', '▮'.repeat(Math.max(1, Math.round(THREE.MathUtils.clamp(s.gust, 0, 1) * 6))));
      const s1 = q('#sys-l1'); if (s1) s1.textContent = dots('GAIT', s.run ? 'ROVER+B' : 'ROVER');
      const s2 = q('#sys-l2'); if (s2) s2.textContent = dots('STK', '×' + (s.supply ?? '-'));
      const s3 = q('#sys-l3'); if (s3) s3.textContent = dots('HDG', String(Math.round(s.heading)).padStart(3, '0'));
      const lit = (id, on) => { const el = q(id); if (el) el.setAttribute('fill-opacity', on ? '0.92' : '0.12'); };
      lit('#lp-lamp', s.sunElev < 1.5);
      lit('#lp-boost', !!s.run && s.speed > 1);
      lit('#lp-srv', !!s.nearStake);
    }
  }
  // In the cab, the console is the only source — the visor text yields
  const flyingNow = s.mode === 'descent' || s.mode === 'ascent';
  if (panel) panel.style.opacity = (s.mode === 'rove' || flyingNow) ? '0' : '1';

  // The guidance feed thinks aloud on the way down (and up)
  if (guidance) {
    guidance.style.opacity = flyingNow ? '1' : '0';
    if (flyingNow && guideList) {
      if (!_gEvents) {
        _gEvents = s.mode === 'descent'
          ? [[0.03, 'BLACKOUT EXIT · SIGNAL REACQ'], [0.2, 'PLASMA CLEAR'],
             [0.32, 'TGT: COPRATES CHASMA'], [0.45, 'GUIDANCE CONVERGED'],
             [0.58, 'RETRO IGNITION'], [0.8, 'TERRAIN LOCK · 1M SURVEY'], [0.93, 'GEAR DOWN']]
          : [[0.04, 'THROTTLE UP'], [0.3, 'MAX Q'], [0.62, 'CANYON RIM CLEARED'], [0.82, 'PLASMA ONSET']];
        guideList.innerHTML = '';
        _gT = 0;
      }
      _gT += dt;
      let line = null;
      while (_gEvents.length && (s.progress || 0) >= _gEvents[0][0]) {
        line = '&gt;&gt; ' + _gEvents.shift()[1];
        _gT = 0.4;
      }
      if (!line && _gT >= 0.62) {
        _gT = 0;
        line = `ALT ${(Math.max(0, s.elevMsl + 2717) / 1000).toFixed(2)}KM · VEL ${Math.round(s.speed)}`;
      }
      if (line) {
        const d2 = document.createElement('div');
        d2.innerHTML = line;
        if (line.startsWith('&gt;')) d2.style.color = 'rgba(200,255,170,0.95)';
        guideList.appendChild(d2);
        while (guideList.children.length > 11) guideList.removeChild(guideList.firstChild);
      }
    } else if (!flyingNow && _gEvents) {
      _gEvents = null;
    }
  }

  // Cockpit parallax — the cab is a THING you sit in: it lags the
  // gaze a few pixels, the Subnautica trick at CSS prices
  {
    let dh = s.heading - lastHeading;
    if (dh > 180) dh -= 360; else if (dh < -180) dh += 360;
    lastHeading = s.heading;
    parX += (THREE.MathUtils.clamp(-dh * 2.2, -26, 26) - parX) * Math.min(1, dt * 6);
    const pitchOff = THREE.MathUtils.clamp((s.pitchDeg || 0) * 0.55, -18, 18);
    parY += (pitchOff - parY) * Math.min(1, dt * 6);
    if (cockpit) cockpit.style.transform = `translate(${parX.toFixed(1)}px, ${parY.toFixed(1)}px) scale(1.06)`;
    if (vignette) vignette.style.transform = `translate(${(parX * 0.35).toFixed(1)}px, ${(parY * 0.35).toFixed(1)}px) scale(1.04)`;
  }
  const W = 460, H = 34;
  cctx.clearRect(0, 0, W, H);
  const degSpan = 90;                       // visible arc
  const pxPerDeg = W / degSpan;
  // ticks every 5°, taller every 15°
  cctx.strokeStyle = AMBER + '0.5)';
  cctx.fillStyle = AMBER + '0.75)';
  cctx.lineWidth = 1;
  cctx.font = `10px ${MONO}`;
  cctx.textAlign = 'center';
  const h = s.heading;
  const first = Math.floor((h - degSpan / 2) / 5) * 5;
  for (let a = first; a <= h + degSpan / 2 + 5; a += 5) {
    const x = W / 2 + (a - h) * pxPerDeg;
    const major = ((a % 360) + 360) % 360 % 15 === 0;
    cctx.globalAlpha = major ? 0.8 : 0.45;
    cctx.beginPath();
    cctx.moveTo(x, H - 8);
    cctx.lineTo(x, H - (major ? 16 : 12));
    cctx.stroke();
  }
  cctx.globalAlpha = 1;
  for (const [deg, label] of CARDINALS) {
    for (const wrap of [-360, 0, 360]) {
      const d = deg + wrap - h;
      if (Math.abs(d) > degSpan / 2 + 4) continue;
      const x = W / 2 + d * pxPerDeg;
      cctx.fillStyle = AMBER + (label.length === 1 ? '0.95)' : '0.55)');
      cctx.fillText(label, x, 12);
    }
  }
  // marks: stakes and the pad ride the ribbon as diamonds
  if (s.marks) {
    for (const mk of s.marks) {
      for (const wrap of [-360, 0, 360]) {
        const d = mk.bearing + wrap - h;
        if (Math.abs(d) > degSpan / 2) continue;
        const x = W / 2 + d * pxPerDeg;
        cctx.save();
        cctx.translate(x, H - 24);
        cctx.rotate(Math.PI / 4);
        cctx.fillStyle = mk.pad ? AMBER + '0.9)' : AMBER + '0.6)';
        cctx.fillRect(-3, -3, 6, 6);
        cctx.restore();
      }
    }
  }
  // center lubber line
  cctx.strokeStyle = AMBER + '0.9)';
  cctx.lineWidth = 1.5;
  cctx.beginPath();
  cctx.moveTo(W / 2, H - 6);
  cctx.lineTo(W / 2, H - 20);
  cctx.stroke();

  // text at 4 Hz — no layout churn
  textTimer -= dt;
  if (textTimer <= 0 && lines.elev) {
    textTimer = 0.25;
    lines.elev.textContent = `ELEV ${(s.elevMsl / 1000).toFixed(2)} KM`;
    lines.env.textContent = `${s.tempC} °C · SUN ${s.sunElev > 0 ? '+' : ''}${s.sunElev.toFixed(0)}° · 6 MBAR`;
    lines.motion.textContent =
      s.mode === 'descent' ? `ENTRY · ${s.speed.toFixed(0)} M/S`
      : s.mode === 'ascent' ? `ASCENT · ${s.speed.toFixed(0)} M/S`
      : s.speed > 0.2
        ? `${s.mode === 'rove' ? 'ROVER' : 'ON FOOT'} · ${s.speed.toFixed(1)} M/S`
        : (s.mode === 'rove' ? 'ROVER · HALTED' : 'ON FOOT');
    const bars = Math.round(THREE.MathUtils.clamp(s.gust, 0, 1) * 5);
    lines.wind.textContent = 'WIND ' + '▁▂▃▄▅▆'.slice(0, bars + 1).split('').join('') + (s.gust > 0.7 ? ' GUST' : '');
  }
}
