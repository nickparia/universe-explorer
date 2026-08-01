// ground/hud.js — the suit's glass.
//
// On the ground the traveler is IN something: a helmet. The HUD is its
// glass — a compass ribbon overhead (the one instrument a planet
// demands), a phosphor readout in the corner in the ship's own
// teletype voice, and the faintest vignette of a visor's edge. All of
// it amber, all of it quiet, none of it a menu.

import * as THREE from 'three';

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
    '</svg>' +
    // ── CAB ──
    '<svg id="hud-cab" viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" ' +
    'style="position:absolute;inset:0;width:100%;height:100%;opacity:0;transition:opacity 0.6s;">' +
    // header
    '<path fill="rgba(9,6,4,0.94)" d="M0,0 H1920 V56 Q960,96 0,56 Z"/>' +
    // A-pillars, structural
    '<path fill="rgba(9,6,4,0.96)" d="M0,0 H300 L128,640 Q60,760 0,800 Z"/>' +
    '<path fill="rgba(9,6,4,0.96)" d="M1920,0 H1620 L1792,640 Q1860,760 1920,800 Z"/>' +
    '<path fill="none" stroke="rgba(255,170,80,0.16)" stroke-width="2.5" d="M300,0 L128,640 Q60,760 0,800"/>' +
    '<path fill="none" stroke="rgba(255,170,80,0.16)" stroke-width="2.5" d="M1620,0 L1792,640 Q1860,760 1920,800"/>' +
    // dashboard with console hump
    '<path fill="rgba(10,7,5,0.95)" d="M0,1080 V908 Q430,856 700,846 L760,806 H1160 L1220,846 Q1490,856 1920,908 V1080 Z"/>' +
    '<path fill="none" stroke="rgba(255,170,80,0.30)" stroke-width="2" d="M0,908 Q430,856 700,846 L760,806 H1160 L1220,846 Q1490,856 1920,908"/>' +
    // console instruments: two dim live-looking glows
    '<rect x="840" y="836" width="104" height="20" rx="4" fill="rgba(255,170,80,0.13)"/>' +
    '<rect x="976" y="836" width="104" height="20" rx="4" fill="rgba(140,190,255,0.08)"/>' +
    '</svg>';
  document.body.appendChild(cockpit);

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
  for (const el of [vignette, compass, panel, strip, cockpit, survey]) if (el && el.parentNode) el.parentNode.removeChild(el);
  vignette = null; compass = null; cctx = null; panel = null; lines = {}; strip = null; chips = {}; cockpit = null; survey = null;
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
