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
    // ── CAB — Alien-1 for real: density, bone metal, glowing banks ──
    '<svg id="hud-cab" viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" ' +
    'font-family="SF Mono,Menlo,monospace" ' +
    'style="position:absolute;inset:0;width:100%;height:100%;opacity:0;transition:opacity 0.6s;">' +
    '<defs>' +
    '<filter id="grime"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" result="n"/>' +
    '<feColorMatrix in="n" type="matrix" values="0 0 0 0 0.55 0 0 0 0 0.45 0 0 0 0 0.35 0 0 0 0.06 0"/>' +
    '<feComposite in2="SourceGraphic" operator="atop"/></filter>' +
    '<filter id="phos"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge>' +
    '<feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>' +
    '<pattern id="scan" width="4" height="5" patternUnits="userSpaceOnUse">' +
    '<rect width="4" height="2.4" fill="rgba(0,0,0,0.42)"/></pattern>' +
    '<pattern id="hazard" width="28" height="28" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">' +
    '<rect width="14" height="28" fill="rgba(190,150,45,0.30)"/><rect x="14" width="14" height="28" fill="rgba(20,14,8,0.55)"/></pattern>' +
    '<radialGradient id="crtglass" cx="0.5" cy="0.42" r="0.75">' +
    '<stop offset="0%" stop-color="rgba(255,255,255,0.07)"/><stop offset="55%" stop-color="rgba(255,255,255,0.015)"/><stop offset="100%" stop-color="rgba(0,0,0,0.25)"/></radialGradient>' +
    '</defs>' +
    // header + stencil + rivet row
    '<path fill="rgba(12,9,7,0.95)" d="M0,0 H1920 V56 Q960,96 0,56 Z"/>' +
    '<text x="960" y="38" text-anchor="middle" font-size="15" letter-spacing="8" fill="rgba(210,195,165,0.30)">MRV-01 &#183; SOLACE EXPEDITIONARY</text>' +
    '<g fill="rgba(210,195,165,0.16)"><circle cx="80" cy="30" r="3"/><circle cx="400" cy="42" r="3"/><circle cx="1520" cy="42" r="3"/><circle cx="1840" cy="30" r="3"/></g>' +
    // A-pillars with inner-edge BUTTON STRIPS
    '<path fill="rgba(11,8,6,0.97)" d="M0,0 H300 L128,640 Q60,760 0,800 Z"/>' +
    '<path fill="rgba(11,8,6,0.97)" d="M1920,0 H1620 L1792,640 Q1860,760 1920,800 Z"/>' +
    '<path fill="none" stroke="rgba(210,195,165,0.14)" stroke-width="2.5" d="M300,0 L128,640 Q60,760 0,800"/>' +
    '<path fill="none" stroke="rgba(210,195,165,0.14)" stroke-width="2.5" d="M1620,0 L1792,640 Q1860,760 1920,800"/>' +
    '<g id="pillar-btns-l"></g><g id="pillar-btns-r"></g>' +
    '<path fill="url(#hazard)" d="M0,800 Q60,760 128,640 L164,640 Q104,780 0,854 Z"/>' +
    '<path fill="url(#hazard)" d="M1920,800 Q1860,760 1792,640 L1756,640 Q1816,780 1920,854 Z"/>' +
    // ── DASH: paneled, seamed, bone-edged, dense ──
    '<path fill="rgba(13,10,8,0.97)" filter="url(#grime)" d="M0,1080 V852 Q430,808 620,796 L680,742 H1240 L1300,796 Q1490,808 1920,852 V1080 Z"/>' +
    '<path fill="none" stroke="rgba(210,195,165,0.30)" stroke-width="2.5" d="M0,852 Q430,808 620,796 L680,742 H1240 L1300,796 Q1490,808 1920,852"/>' +
    // panel seams + screws
    '<g stroke="rgba(0,0,0,0.5)" stroke-width="1.5">' +
    '<path d="M330,1080 L348,846"/><path d="M660,1080 L660,800"/><path d="M1260,1080 L1260,800"/><path d="M1590,1080 L1572,846"/></g>' +
    '<g fill="rgba(210,195,165,0.22)">' +
    '<circle cx="342" cy="860" r="3.5"/><circle cx="666" cy="812" r="3.5"/><circle cx="1254" cy="812" r="3.5"/><circle cx="1578" cy="860" r="3.5"/>' +
    '<circle cx="40" cy="880" r="3.5"/><circle cx="1880" cy="880" r="3.5"/><circle cx="960" cy="1058" r="3.5"/></g>' +
    // placards + tape
    '<text x="352" y="836" font-size="10" letter-spacing="2" fill="rgba(210,195,165,0.35)">ENV/02</text>' +
    '<text x="1210" y="836" font-size="10" letter-spacing="2" fill="rgba(210,195,165,0.35)">BUS-A</text>' +
    '<rect x="70" y="960" width="150" height="34" rx="3" fill="url(#hazard)" opacity="0.7"/>' +
    '<text x="145" y="1015" text-anchor="middle" font-size="9" letter-spacing="2" fill="rgba(210,195,165,0.4)">NO STEP &#183; SVC PNL 4</text>' +
    '<rect x="1650" y="930" width="120" height="22" fill="rgba(210,195,165,0.10)" transform="rotate(-3 1650 930)"/>' +
    // ── VEL GAUGE, bone bezel ──
    '<g id="gauge-vel">' +
    '<circle cx="470" cy="948" r="88" fill="rgba(24,20,16,0.9)"/>' +
    '<circle cx="470" cy="948" r="82" fill="rgba(6,5,4,0.98)" stroke="rgba(210,195,165,0.45)" stroke-width="6"/>' +
    '<g id="vel-ticks" stroke="rgba(255,186,100,0.55)" stroke-width="2"></g>' +
    '<line id="vel-needle" x1="470" y1="948" x2="470" y2="884" stroke="rgba(255,110,45,0.95)" stroke-width="3.5" stroke-linecap="round"/>' +
    '<circle cx="470" cy="948" r="7" fill="rgba(210,195,165,0.55)"/>' +
    '<text x="470" y="992" text-anchor="middle" font-size="12" letter-spacing="3" fill="rgba(255,186,100,0.5)">GND VEL</text>' +
    '<text id="vel-digits" x="470" y="926" text-anchor="middle" font-size="18" fill="rgba(255,200,130,0.85)">0.0</text>' +
    '</g>' +
    // ── INCLINOMETER — the bank angle is REAL ──
    '<g id="gauge-incl">' +
    '<circle cx="600" cy="1006" r="46" fill="rgba(6,5,4,0.98)" stroke="rgba(210,195,165,0.4)" stroke-width="4"/>' +
    '<path d="M566,1006 H634" stroke="rgba(255,186,100,0.3)" stroke-width="1.5"/>' +
    '<g id="incl-marks" stroke="rgba(255,186,100,0.4)" stroke-width="1.5">' +
    '<path d="M600,968 V978"/><path d="M576,974 L580,983"/><path d="M624,974 L620,983"/></g>' +
    '<line id="incl-needle" x1="600" y1="1006" x2="600" y2="972" stroke="rgba(140,220,110,0.85)" stroke-width="3" stroke-linecap="round"/>' +
    '<circle cx="600" cy="1006" r="5" fill="rgba(210,195,165,0.5)"/>' +
    '<text x="600" y="1044" text-anchor="middle" font-size="10" letter-spacing="2" fill="rgba(255,186,100,0.45)">BANK</text>' +
    '</g>' +
    // ── ENV CRT: bulged glass, leader dots, cursor ──
    '<g id="crt-env">' +
    '<rect x="700" y="790" width="252" height="150" rx="10" fill="rgba(26,22,18,0.95)"/>' +
    '<rect x="708" y="798" width="236" height="134" rx="7" fill="rgba(4,7,4,0.99)" stroke="rgba(210,195,165,0.4)" stroke-width="4"/>' +
    '<text x="722" y="822" font-size="12" letter-spacing="2" fill="rgba(140,230,120,0.45)">ECU-5 // ENVIRON</text>' +
    '<g filter="url(#phos)">' +
    '<text id="crt-l1" x="722" y="850" font-size="18" letter-spacing="1" fill="rgba(140,230,120,0.8)">ELEV</text>' +
    '<text id="crt-l2" x="722" y="876" font-size="18" letter-spacing="1" fill="rgba(140,230,120,0.8)">TEMP</text>' +
    '<text id="crt-l3" x="722" y="902" font-size="18" letter-spacing="1" fill="rgba(140,230,120,0.68)">WIND</text>' +
    '<text id="crt-cur" x="722" y="924" font-size="16" fill="rgba(140,230,120,0.8)">&#9646;</text></g>' +
    '<rect x="708" y="798" width="236" height="134" rx="7" fill="url(#scan)"/>' +
    '<rect x="708" y="798" width="236" height="134" rx="7" fill="url(#crtglass)"/>' +
    '</g>' +
    // ── SYS CRT, amber ──
    '<g id="crt-sys">' +
    '<rect x="962" y="790" width="252" height="150" rx="10" fill="rgba(26,22,18,0.95)"/>' +
    '<rect x="970" y="798" width="236" height="134" rx="7" fill="rgba(8,5,3,0.99)" stroke="rgba(210,195,165,0.4)" stroke-width="4"/>' +
    '<text x="984" y="822" font-size="12" letter-spacing="2" fill="rgba(255,186,100,0.45)">MU-TH // SYSTEMS</text>' +
    '<g filter="url(#phos)">' +
    '<text id="sys-l1" x="984" y="850" font-size="18" letter-spacing="1" fill="rgba(255,186,100,0.85)">GAIT</text>' +
    '<text id="sys-l2" x="984" y="876" font-size="18" letter-spacing="1" fill="rgba(255,186,100,0.75)">STK</text>' +
    '<text id="sys-l3" x="984" y="902" font-size="18" letter-spacing="1" fill="rgba(255,186,100,0.6)">HDG</text></g>' +
    '<rect x="970" y="798" width="236" height="134" rx="7" fill="url(#scan)"/>' +
    '<rect x="970" y="798" width="236" height="134" rx="7" fill="url(#crtglass)"/>' +
    '</g>' +
    // ── BUTTON BANKS: the wall of lights ──
    '<g id="btn-bank-main"></g>' +
    '<g id="lamps" font-size="10" letter-spacing="1">' +
    '<rect x="1276" y="796" width="304" height="60" rx="5" fill="rgba(7,5,4,0.97)" stroke="rgba(210,195,165,0.35)" stroke-width="3"/>' +
    '<circle id="lp-lamp" cx="1304" cy="820" r="7" fill="rgba(60,40,25,0.9)"/><text x="1318" y="824" fill="rgba(210,195,165,0.4)">LAMP</text>' +
    '<circle id="lp-boost" cx="1304" cy="842" r="7" fill="rgba(60,40,25,0.9)"/><text x="1318" y="846" fill="rgba(210,195,165,0.4)">BOOST</text>' +
    '<circle id="lp-srv" cx="1414" cy="820" r="7" fill="rgba(60,40,25,0.9)"/><text x="1428" y="824" fill="rgba(210,195,165,0.4)">SRV</text>' +
    '<circle id="lp-pwr" cx="1414" cy="842" r="7" fill="rgba(140,220,110,0.7)"/><text x="1428" y="846" fill="rgba(210,195,165,0.4)">PWR</text>' +
    '<circle id="lp-o2" cx="1508" cy="820" r="7" fill="rgba(140,220,110,0.55)"/><text x="1522" y="824" fill="rgba(210,195,165,0.4)">O2</text>' +
    '<circle id="lp-com" cx="1508" cy="842" r="7" fill="rgba(255,186,100,0.4)"/><text x="1522" y="846" fill="rgba(210,195,165,0.4)">COM</text>' +
    '</g>' +
    '</svg>';
  document.body.appendChild(cockpit);

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

  // The wall of lights: banks of tiny backlit buttons, most steady,
  // a few alive. Deterministic layout, per-session character.
  {
    const COLS = ['rgba(255,186,100,', 'rgba(210,195,165,', 'rgba(140,220,110,', 'rgba(200,90,60,', 'rgba(120,170,220,'];
    const mk = (gid, x0, y0, cols, rows, w, h, gapx, gapy) => {
      const g = cockpit.querySelector(gid);
      if (!g) return;
      let out = '';
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const rr = Math.sin(r * 7.3 + c * 13.7 + x0) * 0.5 + 0.5;
          const col = COLS[Math.floor(rr * COLS.length) % COLS.length];
          const lit = rr > 0.45;
          out += `<rect class="bt" x="${x0 + c * (w + gapx)}" y="${y0 + r * (h + gapy)}" width="${w}" height="${h}" rx="2" ` +
            `fill="${col}${lit ? (0.2 + rr * 0.45).toFixed(2) : '0.07'})"/>`;
        }
      }
      g.innerHTML = out;
    };
    mk('#btn-bank-main', 1276, 874, 13, 3, 17, 11, 6.4, 7);   // under the lamp cluster
    mk('#pillar-btns-l', 176, 460, 2, 7, 15, 10, 6, 8);
    mk('#pillar-btns-r', 1706, 460, 2, 7, 15, 10, 6, 8);
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
    if (incl) incl.setAttribute('transform', `rotate(${THREE.MathUtils.clamp((s.rollDeg || 0) * 2.2, -55, 55).toFixed(1)} 600 1006)`);
    _crtT += dt;
    const cur = q('#crt-cur');
    if (cur) cur.style.opacity = Math.floor(_crtT / 0.53) % 2 ? '0' : '1';
    // an old tube coughs now and then
    for (const gid of ['#crt-env', '#crt-sys']) {
      const el = q(gid);
      if (el) el.style.opacity = (Math.sin(_crtT * 1.7 + (gid.length)) > 0.997) ? '0.72' : '1';
    }
    if (_crtT - _btnT > 1.7) {
      _btnT = _crtT;
      const bts = cockpit.querySelectorAll('.bt');
      if (bts.length) {
        const el = bts[Math.floor(Math.random() * bts.length)];
        el.style.opacity = el.style.opacity === '0.25' ? '1' : '0.25';
      }
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
      const lit = (id, on, col) => { const el = q(id); if (el) el.setAttribute('fill', on ? col : 'rgba(60,40,25,0.9)'); };
      lit('#lp-lamp', s.sunElev < 1.5, 'rgba(255,190,90,0.95)');
      lit('#lp-boost', !!s.run && s.speed > 1, 'rgba(255,140,60,0.95)');
      lit('#lp-srv', !!s.nearStake, 'rgba(140,220,110,0.9)');
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
