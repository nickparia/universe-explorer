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
    '<text x="960" y="1069" text-anchor="middle" font-family="SF Mono,Menlo,monospace" font-size="12" letter-spacing="6" fill="rgba(200,180,150,0.28)">EVA-1 · SOLACE</text>' +
    '<g fill="rgba(160,145,125,0.3)"><circle cx="700" cy="1052" r="3.5"/><circle cx="1220" cy="1052" r="3.5"/></g>' +
    '</svg>' +
    // ── CAB — the Nostromo school: worn metal, live instruments ──
    '<svg id="hud-cab" viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" ' +
    'font-family="SF Mono,Menlo,monospace" ' +
    'style="position:absolute;inset:0;width:100%;height:100%;opacity:0;transition:opacity 0.6s;">' +
    '<defs>' +
    '<filter id="grime"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" result="n"/>' +
    '<feColorMatrix in="n" type="matrix" values="0 0 0 0 0.55 0 0 0 0 0.45 0 0 0 0 0.35 0 0 0 0.05 0"/>' +
    '<feComposite in2="SourceGraphic" operator="atop"/></filter>' +
    '<pattern id="scan" width="4" height="4" patternUnits="userSpaceOnUse">' +
    '<rect width="4" height="2" fill="rgba(0,0,0,0.35)"/></pattern>' +
    '<pattern id="hazard" width="28" height="28" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">' +
    '<rect width="14" height="28" fill="rgba(180,140,40,0.24)"/><rect x="14" width="14" height="28" fill="rgba(20,14,8,0.5)"/></pattern>' +
    '</defs>' +
    // header + stencil
    '<path fill="rgba(9,6,4,0.94)" d="M0,0 H1920 V56 Q960,96 0,56 Z"/>' +
    '<text x="960" y="40" text-anchor="middle" font-size="17" letter-spacing="8" fill="rgba(200,180,150,0.30)">MRV-01 · SOLACE EXPEDITIONARY</text>' +
    // A-pillars + rivets + hazard chevrons at their feet
    '<path fill="rgba(9,6,4,0.96)" d="M0,0 H300 L128,640 Q60,760 0,800 Z"/>' +
    '<path fill="rgba(9,6,4,0.96)" d="M1920,0 H1620 L1792,640 Q1860,760 1920,800 Z"/>' +
    '<path fill="none" stroke="rgba(255,170,80,0.16)" stroke-width="2.5" d="M300,0 L128,640 Q60,760 0,800"/>' +
    '<path fill="none" stroke="rgba(255,170,80,0.16)" stroke-width="2.5" d="M1620,0 L1792,640 Q1860,760 1920,800"/>' +
    '<g fill="rgba(160,145,125,0.25)">' +
    '<circle cx="262" cy="80" r="4"/><circle cx="238" cy="170" r="4"/><circle cx="214" cy="260" r="4"/><circle cx="190" cy="350" r="4"/><circle cx="166" cy="440" r="4"/>' +
    '<circle cx="1658" cy="80" r="4"/><circle cx="1682" cy="170" r="4"/><circle cx="1706" cy="260" r="4"/><circle cx="1730" cy="350" r="4"/><circle cx="1754" cy="440" r="4"/></g>' +
    '<path fill="url(#hazard)" d="M0,800 Q60,760 128,640 L160,640 Q100,780 0,850 Z"/>' +
    '<path fill="url(#hazard)" d="M1920,800 Q1860,760 1792,640 L1760,640 Q1820,780 1920,850 Z"/>' +
    // dashboard body
    '<path fill="rgba(11,8,6,0.96)" filter="url(#grime)" d="M0,1080 V888 Q430,846 620,836 L680,782 H1240 L1300,836 Q1490,846 1920,888 V1080 Z"/>' +
    '<path fill="none" stroke="rgba(255,170,80,0.30)" stroke-width="2" d="M0,888 Q430,846 620,836 L680,782 H1240 L1300,836 Q1490,846 1920,888"/>' +
    // ── VELOCITY GAUGE (left of console) ──
    '<g id="gauge-vel">' +
    '<circle cx="560" cy="960" r="86" fill="rgba(6,5,4,0.98)" stroke="rgba(150,135,115,0.4)" stroke-width="5"/>' +
    '<circle cx="560" cy="960" r="78" fill="none" stroke="rgba(255,170,80,0.12)" stroke-width="1"/>' +
    '<g id="vel-ticks" stroke="rgba(255,186,100,0.55)" stroke-width="2"></g>' +
    '<line id="vel-needle" x1="560" y1="960" x2="560" y2="894" stroke="rgba(255,120,50,0.95)" stroke-width="3.5" stroke-linecap="round"/>' +
    '<circle cx="560" cy="960" r="7" fill="rgba(200,180,150,0.6)"/>' +
    '<text x="560" y="1006" text-anchor="middle" font-size="13" letter-spacing="3" fill="rgba(255,186,100,0.5)">GND VEL</text>' +
    '<text id="vel-digits" x="560" y="936" text-anchor="middle" font-size="19" fill="rgba(255,200,130,0.85)">0.0</text>' +
    '</g>' +
    // ── ENV CRT (console center-left) ──
    '<g id="crt-env">' +
    '<rect x="716" y="806" width="238" height="126" rx="8" fill="rgba(5,7,4,0.98)" stroke="rgba(150,135,115,0.45)" stroke-width="5"/>' +
    '<text id="crt-l1" x="734" y="842" font-size="19" letter-spacing="2" fill="rgba(140,230,120,0.75)">ELEV</text>' +
    '<text id="crt-l2" x="734" y="870" font-size="19" letter-spacing="2" fill="rgba(140,230,120,0.75)">TEMP</text>' +
    '<text id="crt-l3" x="734" y="898" font-size="19" letter-spacing="2" fill="rgba(140,230,120,0.62)">WIND</text>' +
    '<rect x="716" y="806" width="238" height="126" rx="8" fill="url(#scan)"/>' +
    '</g>' +
    // ── SYS CRT (console center-right, amber) ──
    '<g id="crt-sys">' +
    '<rect x="966" y="806" width="238" height="126" rx="8" fill="rgba(8,5,3,0.98)" stroke="rgba(150,135,115,0.45)" stroke-width="5"/>' +
    '<text id="sys-l1" x="984" y="842" font-size="19" letter-spacing="2" fill="rgba(255,186,100,0.8)">GAIT ROVER</text>' +
    '<text id="sys-l2" x="984" y="870" font-size="19" letter-spacing="2" fill="rgba(255,186,100,0.7)">STK ×6</text>' +
    '<text id="sys-l3" x="984" y="898" font-size="19" letter-spacing="2" fill="rgba(255,186,100,0.55)">HDG 000</text>' +
    '<rect x="966" y="806" width="238" height="126" rx="8" fill="url(#scan)"/>' +
    '</g>' +
    // ── LAMP CLUSTER (right) — stencil labels, lit states ──
    '<g id="lamps" font-size="11" letter-spacing="1">' +
    '<rect x="1256" y="850" width="200" height="88" rx="6" fill="rgba(7,5,4,0.97)" stroke="rgba(150,135,115,0.4)" stroke-width="4"/>' +
    '<circle id="lp-lamp" cx="1288" cy="878" r="8" fill="rgba(60,40,25,0.9)"/><text x="1304" y="883" fill="rgba(200,180,150,0.45)">LAMP</text>' +
    '<circle id="lp-boost" cx="1288" cy="912" r="8" fill="rgba(60,40,25,0.9)"/><text x="1304" y="917" fill="rgba(200,180,150,0.45)">BOOST</text>' +
    '<circle id="lp-srv" cx="1382" cy="878" r="8" fill="rgba(60,40,25,0.9)"/><text x="1398" y="883" fill="rgba(200,180,150,0.45)">SRV</text>' +
    '<circle id="lp-pwr" cx="1382" cy="912" r="8" fill="rgba(140,220,110,0.7)"/><text x="1398" y="917" fill="rgba(200,180,150,0.45)">PWR</text>' +
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
        const r1 = major ? 62 : 68, r2 = 76;
        ticks += `<line x1="${560 + Math.cos(a) * r1}" y1="${960 + Math.sin(a) * r1}" x2="${560 + Math.cos(a) * r2}" y2="${960 + Math.sin(a) * r2}" stroke-width="${major ? 3 : 1.5}"/>`;
        if (major) ticks += `<text x="${560 + Math.cos(a) * 48}" y="${960 + Math.sin(a) * 48 + 5}" text-anchor="middle" font-size="12" fill="rgba(255,186,100,0.5)" stroke="none">${v}</text>`;
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

  // ── The console lives: needle, CRTs, lamps ──
  if (cockpit && s.mode === 'rove') {
    const needle = cockpit.querySelector('#vel-needle');
    if (needle) {
      const ang = -210 + (THREE.MathUtils.clamp(s.speed, 0, 40) / 40) * 240 + 90;
      needle.setAttribute('transform', `rotate(${ang.toFixed(1)} 560 960)`);
    }
    if (textTimer <= 0.01) {   // ride the same 4 Hz cadence as the text
      const q = (id) => cockpit.querySelector(id);
      const vd = q('#vel-digits'); if (vd) vd.textContent = s.speed.toFixed(1);
      const l1 = q('#crt-l1'); if (l1) l1.textContent = `ELEV ${(s.elevMsl / 1000).toFixed(2)} KM`;
      const l2 = q('#crt-l2'); if (l2) l2.textContent = `TMP ${s.tempC}C SUN${s.sunElev > 0 ? '+' : ''}${s.sunElev.toFixed(0)}`;
      const l3 = q('#crt-l3'); if (l3) l3.textContent = `WIND ${'▮'.repeat(Math.round(THREE.MathUtils.clamp(s.gust, 0, 1) * 6))}`;
      const s1 = q('#sys-l1'); if (s1) s1.textContent = s.run ? 'GAIT ROVER · BOOST' : 'GAIT ROVER';
      const s2 = q('#sys-l2'); if (s2) s2.textContent = `STK ×${s.supply ?? '-'}`;
      const s3 = q('#sys-l3'); if (s3) s3.textContent = `HDG ${String(Math.round(s.heading)).padStart(3, '0')}`;
      const lit = (id, on, col) => { const el = q(id); if (el) el.setAttribute('fill', on ? col : 'rgba(60,40,25,0.9)'); };
      lit('#lp-lamp', s.sunElev < 1.5, 'rgba(255,190,90,0.95)');
      lit('#lp-boost', !!s.run && s.speed > 1, 'rgba(255,140,60,0.95)');
      lit('#lp-srv', !!s.nearStake, 'rgba(140,220,110,0.9)');
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
