// ground/hud.js — the suit's glass.
//
// On the ground the traveler is IN something: a helmet, or the rover's
// windshield. Either way the instruments are the same school — light
// PROJECTED on glass. Phosphor text, leader dots, thin brackets, the
// teletype voice of the landing computer. Nothing painted, nothing
// pretending to be furniture: the world stays visible through every
// instrument, and the frame is only the faintest vignette of an edge.

import * as THREE from 'three';
import { setMapMount } from './map.js';
import { setChatSurface } from '../shipchat.js';

const MONO = "'SF Mono','Cascadia Mono','JetBrains Mono',Menlo,Consolas,'Courier New',monospace";
const AMBER = 'rgba(255,186,100,';
const SCAN =
  '-webkit-mask-image:repeating-linear-gradient(0deg,#000 0 2px,rgba(0,0,0,0.65) 2px 3px);' +
  'mask-image:repeating-linear-gradient(0deg,#000 0 2px,rgba(0,0,0,0.65) 2px 3px);';
const GLOW = 'text-shadow:0 1px 4px rgba(0,0,0,0.9),0 0 9px rgba(255,150,60,0.25);';

let vignette = null, compass = null, cctx = null, panel = null;
let lines = {};
let textTimer = 0;
let strip = null;
let chips = {};      // key → {el, cap}
let lastGait = null;
let glass = null;    // the rover's projected instrument layer
let g = {};          // glass elements by key
let survey = null;   // the readings panel beside a stake
let lastHeading = 0, parX = 0, parY = 0;
let _crtT = 0;
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

function setChipLit(chip, lit) {
  chip.key.style.background = lit ? AMBER + '0.18)' : 'transparent';
  chip.key.style.color = lit ? AMBER + '1)' : AMBER + '0.75)';
  chip.key.style.borderColor = lit ? AMBER + '0.8)' : AMBER + '0.4)';
  chip.key.style.textShadow = lit
    ? '0 1px 3px rgba(0,0,0,0.9),0 0 8px rgba(255,170,80,0.5)'
    : '0 1px 3px rgba(0,0,0,0.9)';
  chip.cap.style.color = lit ? AMBER + '0.85)' : AMBER + '0.5)';
}

// A projected instrument cluster in the guidance-feed school: a small
// underlined header, then whatever lines the instrument speaks.
function makeCluster(header, css) {
  const el = document.createElement('div');
  el.style.cssText =
    `position:fixed;z-index:46;pointer-events:none;font-family:${MONO};` +
    `color:${AMBER}0.66);${GLOW}${SCAN}` +
    'opacity:0;transition:opacity 0.6s;' + css;
  const h = document.createElement('div');
  h.textContent = header;
  h.style.cssText =
    `font-size:10px;letter-spacing:4px;color:${AMBER}0.42);` +
    `border-bottom:1px solid ${AMBER}0.22);padding-bottom:4px;margin-bottom:6px;`;
  el.appendChild(h);
  return el;
}

export function initGroundHud(siteName, actions = {}) {
  // The visor's edge — barely there, but the frame makes the world a view
  vignette = document.createElement('div');
  vignette.style.cssText =
    'position:fixed;inset:0;pointer-events:none;z-index:44;' +
    `background:${HELMET_BG};`;
  document.body.appendChild(vignette);

  // Compass ribbon — projected top center, in every gait
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
    `font-family:${MONO};color:${AMBER}0.62);${GLOW}${SCAN}`;
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

  // ── THE ROVER'S GLASS: projected clusters, nothing painted ──
  glass = document.createElement('div');
  glass.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:45;';
  document.body.appendChild(glass);

  // Drive cluster, bottom left: the speed is the biggest light in the cab
  const drive = makeCluster('MRV-01 // DRIVE', 'left:26px;bottom:96px;width:196px;');
  const spd = document.createElement('div');
  spd.style.cssText = 'display:flex;align-items:baseline;gap:9px;';
  spd.innerHTML =
    `<span id="gl-vel" style="font-size:38px;letter-spacing:2px;color:${AMBER}0.92);` +
    'text-shadow:0 0 14px rgba(255,160,70,0.4),0 1px 4px rgba(0,0,0,0.9);">0.0</span>' +
    `<span style="font-size:10px;letter-spacing:3px;color:${AMBER}0.45);">M/S</span>`;
  drive.appendChild(spd);
  // bank: a thin horizon line that tilts against a fixed lubber tick
  const bank = document.createElement('div');
  bank.style.cssText = 'position:relative;height:30px;margin-top:8px;width:150px;';
  bank.innerHTML =
    `<div style="position:absolute;left:50%;top:2px;width:1.5px;height:7px;background:${AMBER}0.7);transform:translateX(-50%);"></div>` +
    `<div id="gl-bank" style="position:absolute;left:0;top:14px;width:150px;height:0;` +
    `border-top:1.5px solid ${AMBER}0.75);box-shadow:0 0 7px rgba(255,160,70,0.35);transition:transform 0.12s linear;"></div>` +
    `<div style="position:absolute;left:50%;top:11px;width:5px;height:5px;border:1px solid ${AMBER}0.8);border-radius:50%;transform:translateX(-50%);"></div>` +
    `<div id="gl-bankv" style="position:absolute;right:-42px;top:9px;font-size:10px;letter-spacing:2px;color:${AMBER}0.5);">+0°</div>`;
  drive.appendChild(bank);
  glass.appendChild(drive);

  // Systems cluster, bottom right (inboard of the minimap): the rover
  // reports itself — and its own firmware, so a stale build confesses
  const sys = makeCluster(
    `MRV-01 // SYS · R:${typeof __SOLACE_BUILD__ !== 'undefined' ? __SOLACE_BUILD__ : 'dev'}`,
    'right:26px;bottom:96px;width:252px;text-align:left;');
  for (const key of ['gait', 'stk', 'hdg']) {
    const el = document.createElement('div');
    el.style.cssText = 'font-size:11.5px;letter-spacing:2px;margin-top:3px;white-space:pre;';
    sys.appendChild(el);
    g[key] = el;
  }
  // annunciators: words that light, not lamps that pretend to be glass
  const ann = document.createElement('div');
  ann.style.cssText = 'display:flex;gap:13px;margin-top:9px;font-size:9.5px;letter-spacing:2px;';
  for (const key of ['LAMP', 'BOOST', 'SRV', 'PWR']) {
    const a = document.createElement('span');
    a.textContent = key;
    a.style.cssText = `color:${AMBER}0.18);transition:all 0.3s;`;
    ann.appendChild(a);
    g['an' + key] = a;
  }
  sys.appendChild(ann);
  glass.appendChild(sys);
  g.drive = drive; g.sys = sys;

  // The switch strip — the suit labels its own controls
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
    'text-shadow:0 1px 4px rgba(0,0,0,0.9),0 0 8px rgba(255,150,60,0.2);' + SCAN;
  document.body.appendChild(survey);
  lastGait = null;
}

export function disposeGroundHud() {
  for (const el of [vignette, compass, panel, strip, glass, survey, guidance]) if (el && el.parentNode) el.parentNode.removeChild(el);
  vignette = null; compass = null; cctx = null; panel = null; lines = {}; strip = null; chips = {}; glass = null; g = {}; survey = null;
  guidance = null; guideList = null; _gEvents = null;
}

const CARDINALS = [[0, 'N'], [45, 'NE'], [90, 'E'], [135, 'SE'], [180, 'S'], [225, 'SW'], [270, 'W'], [315, 'NW']];

/**
 * @param s {heading, elevMsl, tempC, sunElev, speed, mode, run, gust}
 */
export function updateGroundHud(dt, s) {
  if (!cctx) return;

  // The glass changes with the gait: helmet bubble on foot, the wider
  // windshield shadow in the rover — and the drive projection lights.
  if (s.mode !== lastGait) {
    lastGait = s.mode;
    const roving = s.mode === 'rove';
    const flying = s.mode === 'descent' || s.mode === 'ascent';
    if (vignette) vignette.style.background = roving ? ROVER_BG : HELMET_BG;
    setMapMount(roving);
    setChatSurface(roving ? 'cab' : 'visor');
    if (g.drive) g.drive.style.opacity = roving ? '1' : '0';
    if (g.sys) g.sys.style.opacity = roving ? '1' : '0';
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

  // ── The drive projection lives: numerals, bank line, annunciators ──
  if (glass && s.mode === 'rove') {
    _crtT += dt;
    const bankEl = glass.querySelector('#gl-bank');
    const roll = THREE.MathUtils.clamp((s.rollDeg || 0) * 1.6, -40, 40);
    if (bankEl) bankEl.style.transform = `rotate(${(-roll).toFixed(1)}deg)`;
    // an old projector coughs now and then
    const cough = Math.sin(_crtT * 1.7) > 0.997;
    glass.style.opacity = cough ? '0.72' : '1';
    if (textTimer <= 0.01) {   // ride the same 4 Hz cadence as the text
      const dots = (label, val, w = 20) => label + ' ' + '.'.repeat(Math.max(1, w - label.length - String(val).length)) + ' ' + val;
      const vel = glass.querySelector('#gl-vel');
      if (vel) vel.textContent = s.speed.toFixed(1);
      const bv = glass.querySelector('#gl-bankv');
      if (bv) bv.textContent = (s.rollDeg > 0 ? '+' : '') + Math.round(s.rollDeg || 0) + '°';
      if (g.gait) g.gait.textContent = dots('GAIT', s.run ? 'ROVER+B' : 'ROVER');
      if (g.stk) g.stk.textContent = dots('STK', '×' + (s.supply ?? '-'));
      if (g.hdg) g.hdg.textContent = dots('HDG', String(Math.round(s.heading)).padStart(3, '0'));
      const lit = (key, on, glow = 'rgba(255,170,80,0.55)') => {
        const el = g['an' + key];
        if (!el) return;
        el.style.color = on ? AMBER + '0.95)' : AMBER + '0.18)';
        el.style.textShadow = on ? `0 0 8px ${glow},0 1px 3px rgba(0,0,0,0.9)` : 'none';
      };
      lit('LAMP', s.sunElev < 1.5);
      lit('BOOST', !!s.run && s.speed > 1);
      lit('SRV', !!s.nearStake);
      lit('PWR', true);
    }
  }

  // The guidance feed thinks aloud on the way down (and up)
  const flyingNow = s.mode === 'descent' || s.mode === 'ascent';
  if (panel) panel.style.opacity = flyingNow ? '0' : '1';
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

  // Vignette parallax — the frame you live inside lags the gaze a few
  // pixels; the projections stay pinned to the glass, as light does
  {
    let dh = s.heading - lastHeading;
    if (dh > 180) dh -= 360; else if (dh < -180) dh += 360;
    lastHeading = s.heading;
    parX += (THREE.MathUtils.clamp(-dh * 2.2, -26, 26) - parX) * Math.min(1, dt * 6);
    const pitchOff = THREE.MathUtils.clamp((s.pitchDeg || 0) * 0.55, -18, 18);
    parY += (pitchOff - parY) * Math.min(1, dt * 6);
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
