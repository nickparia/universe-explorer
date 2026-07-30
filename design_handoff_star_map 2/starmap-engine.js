// starmap-engine.js — shared canvas 3D renderer for the star map redesign options.
// Log-scaled radial layout: solar system inner, interstellar/intergalactic landmarks outer shells.
export const KM_PER_AU = 1.496e8;
export function radiusOf(au){ return Math.log10(1 + au * 8) * 90; }

function baseVec(d){
  const ph = d.phi || 0, r = radiusOf(d.au);
  return [Math.cos(d.angle) * Math.cos(ph) * r, Math.sin(ph) * r * 0.45, Math.sin(d.angle) * Math.cos(ph) * r];
}

export function layout(dests){
  const out = dests.map(d => ({ ...d }));
  const byName = {}; out.forEach(d => byName[d.name] = d);
  const idx = {};
  for (const d of out){
    if (d.parent && byName[d.parent]){
      const p = byName[d.parent];
      const [px, py, pz] = baseVec(p);
      const i = idx[d.parent] = (idx[d.parent] ?? -1) + 1;
      const a = (p.angle || 0) + 0.7 + i * 0.85, off = 7 + i * 3.4;
      d.px = px + Math.cos(a) * off; d.py = py + (i % 2 ? 2.6 : -2.6); d.pz = pz + Math.sin(a) * off;
    } else {
      [d.px, d.py, d.pz] = baseVec(d);
    }
  }
  return out;
}

function auPos(d, byName){
  if (d.parent && byName[d.parent]) d = byName[d.parent];
  const ph = d.phi || 0;
  return [Math.cos(d.angle) * Math.cos(ph) * d.au, Math.sin(ph) * d.au, Math.sin(d.angle) * Math.cos(ph) * d.au];
}

// Distance from the ship (Earth). Landmarks use real light-year figures.
export function distanceLabel(d, dests){
  if (d.ly != null){
    return d.ly >= 1e6 ? (d.ly / 1e6).toFixed(1) + ' MLY'
      : d.ly >= 1000 ? (d.ly / 1000).toFixed(1) + 'K LY'
      : d.ly.toFixed(0) + ' LY';
  }
  if (d.shipKm != null){
    return d.shipKm >= 1e6 ? (d.shipKm / 1e6).toFixed(1) + 'M KM'
      : d.shipKm >= 1000 ? Math.round(d.shipKm / 1000) + 'K KM'
      : d.shipKm + ' KM';
  }
  const byName = {}; dests.forEach(x => byName[x.name] = x);
  const ship = dests.find(x => x.ship) || byName['EARTH'];
  if (d === ship) return 'you are here';
  const a = auPos(d, byName), s = auPos(ship, byName);
  const au = Math.hypot(a[0] - s[0], a[1] - s[1], a[2] - s[2]);
  if (au < 0.01) return Math.round(au * KM_PER_AU / 1000) + 'K KM';
  return au < 10 ? au.toFixed(2) + ' AU' : au < 100 ? au.toFixed(1) + ' AU' : au.toFixed(0) + ' AU';
}

const SIZE = { star: 5, planet: 3.2, dwarf: 2.4, moon: 1.7, craft: 1.9, landmark: 4.2 };
const NEBULA_BLOBS = [
  { th: 1.8, ph: 0.35, color: '255,150,80' },
  { th: 3.5, ph: -0.25, color: '255,110,90' },
  { th: 5.2, ph: 0.4, color: '140,160,230' },
  { th: 2.5, ph: -0.5, color: '90,170,255' },
];

export class StarMapView {
  constructor(canvas, opts = {}){
    this.c = canvas; this.g = canvas.getContext('2d');
    this.o = Object.assign({
      theme: 'natural', accent: '#8fd8ff', autoRotate: true, background: true,
      grid: false, dropLines: false, rings: true, centerY: 0.5,
      onHover: null, onSelect: null, onTier: null,
    }, opts);
    this.yaw = 0.9; this.pitch = 0.5; this.dist = 300; this.targetDist = 300; this.targetYaw = null;
    this.dests = []; this.hover = null; this.selected = null; this.hl = null;
    this.t = 0; this._idle = 99; this.mx = -1; this.my = -1; this._tier = '';
    this.stars = [];
    for (let i = 0; i < 700; i++){
      const th = Math.random() * Math.PI * 2, ph = Math.acos(Math.random() * 2 - 1);
      this.stars.push({ x: Math.sin(ph) * Math.cos(th), y: Math.cos(ph), z: Math.sin(ph) * Math.sin(th), m: Math.random(), tw: Math.random() * 6 });
    }
    this._bind();
    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(canvas.parentElement || canvas);
    this._resize();
    this._loop = () => { this._frame(); this._raf = requestAnimationFrame(this._loop); };
    this._raf = requestAnimationFrame(this._loop);
  }
  setData(d){ this.dests = layout(d); }
  destroy(){ cancelAnimationFrame(this._raf); this._ro.disconnect(); }
  highlight(name){ this.hl = this.dests.find(v => v.name === name) || null; }
  select(name){
    const d = this.dests.find(v => v.name === name) || null;
    this.selected = d;
    if (d) this.flyTo(name);
    return d;
  }
  flyTo(name){
    const d = this.dests.find(v => v.name === name); if (!d) return;
    const r = Math.hypot(d.px, d.py, d.pz);
    this.targetDist = Math.min(1500, Math.max(150, r * 2.1 + 120));
    let ty = Math.PI / 2 - Math.atan2(d.pz, d.px);
    while (ty - this.yaw > Math.PI) ty -= Math.PI * 2;
    while (ty - this.yaw < -Math.PI) ty += Math.PI * 2;
    this.targetYaw = ty;
  }
  distLabel(d){ return distanceLabel(d, this.dests); }
  tier(){ return this.dist < 380 ? 'solar system' : this.dist < 950 ? 'interstellar' : 'galactic'; }
  zoomTier(t){ this.targetDist = t === 'solar system' ? 260 : t === 'interstellar' ? 680 : 1350; }
  _resize(){
    const el = this.c.parentElement || this.c;
    const w = el.clientWidth || 800, h = el.clientHeight || 600;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.c.width = w * dpr; this.c.height = h * dpr;
    this.c.style.width = w + 'px'; this.c.style.height = h + 'px';
    this.w = w; this.h = h; this.dpr = dpr;
  }
  _bind(){
    const c = this.c; let down = null;
    c.style.touchAction = 'none';
    c.addEventListener('pointerdown', e => {
      down = { x: e.clientX, y: e.clientY, moved: false };
      this.targetYaw = null;
      try { c.setPointerCapture(e.pointerId); } catch (_) {}
    });
    c.addEventListener('pointermove', e => {
      const r = c.getBoundingClientRect();
      this.mx = e.clientX - r.left; this.my = e.clientY - r.top;
      if (down){
        const dx = e.clientX - down.x, dy = e.clientY - down.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) down.moved = true;
        this.yaw += dx * 0.005;
        this.pitch = Math.min(1.35, Math.max(0.06, this.pitch + dy * 0.004));
        down.x = e.clientX; down.y = e.clientY; this._idle = 0;
      }
    });
    c.addEventListener('pointerup', () => {
      if (down && !down.moved){
        this.selected = this.hover;
        if (this.hover) this.flyTo(this.hover.name);
        if (this.o.onSelect) this.o.onSelect(this.hover);
      }
      down = null;
    });
    c.addEventListener('pointerleave', () => { this.mx = this.my = -1; });
    c.addEventListener('wheel', e => {
      e.preventDefault();
      this.targetDist = Math.min(1600, Math.max(110, this.targetDist * Math.exp(e.deltaY * 0.0012)));
      this._idle = 0;
    }, { passive: false });
  }
  _frame(){
    const g = this.g, w = this.w, h = this.h;
    if (!w || !h) return;
    this.t += 1 / 60; this._idle += 1 / 60;
    this.dist += (this.targetDist - this.dist) * 0.07;
    if (this.targetYaw != null){
      this.yaw += (this.targetYaw - this.yaw) * 0.07;
      if (Math.abs(this.targetYaw - this.yaw) < 0.002) this.targetYaw = null;
    } else if (this.o.autoRotate && this._idle > 4 && this.mx < 0){
      this.yaw += 0.00012; // very slow drift, and only while the pointer is off the map
    }
    const tier = this.tier();
    if (tier !== this._tier){ this._tier = tier; if (this.o.onTier) this.o.onTier(tier); }
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const holo = this.o.theme === 'holo';
    const cw = Math.cos(this.yaw), sw = Math.sin(this.yaw), cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    if (this.o.background) this._drawBg(g, w, h, cw, sw, cp, sp);
    const f = 620, cx = w / 2, cyy = h * this.o.centerY;
    const P = (px, py, pz) => {
      const xr = px * cw - pz * sw, zr = px * sw + pz * cw;
      const y2 = py * cp - zr * sp, z2 = zr * cp + py * sp + this.dist;
      if (z2 < 30) return null;
      const s = f / z2;
      return [cx + xr * s, cyy - y2 * s, z2, s];
    };
    if (holo) g.globalAlpha = 0.88 + 0.06 * Math.sin(this.t * 6.3) + 0.04 * Math.sin(this.t * 29);
    if (this.o.grid) this._drawGrid(g, P);
    if (this.o.rings) this._drawRings(g, P, holo);
    const pts = [];
    for (const d of this.dests){ const p = P(d.px, d.py, d.pz); if (p) pts.push([d, p]); }
    pts.sort((a, b) => b[1][2] - a[1][2]);
    let hov = null, hd = 24;
    if (this.mx >= 0){
      for (const [d, p] of pts){
        const dd = Math.hypot(p[0] - this.mx, p[1] - this.my);
        if (dd < hd){ hd = dd; hov = d; }
      }
    }
    if (hov !== this.hover){ this.hover = hov; if (this.o.onHover) this.o.onHover(hov); }
    this.c.style.cursor = hov ? 'pointer' : 'grab';
    for (const [d, p] of pts) this._drawDest(g, d, p, P, holo);
    g.globalAlpha = 1;
  }
  _drawBg(g, w, h, cw, sw, cp, sp){
    // Faint nebula washes
    for (const b of NEBULA_BLOBS){
      const x = Math.cos(b.th) * Math.cos(b.ph), y = Math.sin(b.ph), z = Math.sin(b.th) * Math.cos(b.ph);
      const xr = x * cw - z * sw, zr = x * sw + z * cw;
      const y2 = y * cp - zr * sp, z2 = zr * cp + y * sp;
      if (z2 < 0.3) continue;
      const sx = w / 2 + (xr / z2) * 560, sy = h / 2 - (y2 / z2) * 560;
      const rad = 220;
      const gr = g.createRadialGradient(sx, sy, 0, sx, sy, rad);
      gr.addColorStop(0, 'rgba(' + b.color + ',0.055)');
      gr.addColorStop(1, 'rgba(' + b.color + ',0)');
      g.fillStyle = gr;
      g.fillRect(sx - rad, sy - rad, rad * 2, rad * 2);
    }
    // Star field
    for (const s of this.stars){
      const xr = s.x * cw - s.z * sw, zr = s.x * sw + s.z * cw;
      const y2 = s.y * cp - zr * sp, z2 = zr * cp + s.y * sp;
      if (z2 < 0.25) continue;
      const sx = w / 2 + (xr / z2) * 560, sy = h / 2 - (y2 / z2) * 560;
      if (sx < -4 || sx > w + 4 || sy < -4 || sy > h + 4) continue;
      const tw = 0.7 + 0.3 * Math.sin(this.t * 1.5 + s.tw);
      g.globalAlpha = (0.12 + 0.45 * s.m) * tw;
      g.fillStyle = '#cfe0ff';
      const sz = s.m > 0.85 ? 1.5 : 1;
      g.fillRect(sx, sy, sz, sz);
    }
    g.globalAlpha = 1;
  }
  _stroke(g, ptsArr){
    g.beginPath();
    let started = false;
    for (const p of ptsArr){
      if (!p){ started = false; continue; }
      if (!started){ g.moveTo(p[0], p[1]); started = true; }
      else g.lineTo(p[0], p[1]);
    }
    g.stroke();
  }
  _drawGrid(g, P){
    const a = this.o.accent;
    g.lineWidth = 1;
    for (let r = 60; r <= 460; r += 80){
      g.strokeStyle = this._rgba(a, 0.07);
      const arr = [];
      for (let i = 0; i <= 120; i++){
        const th = (i / 120) * Math.PI * 2;
        arr.push(P(Math.cos(th) * r, 0, Math.sin(th) * r));
      }
      this._stroke(g, arr);
    }
    g.strokeStyle = this._rgba(a, 0.045);
    for (let i = 0; i < 12; i++){
      const th = (i / 12) * Math.PI * 2;
      const arr = [P(Math.cos(th) * 40, 0, Math.sin(th) * 40), P(Math.cos(th) * 480, 0, Math.sin(th) * 480)];
      this._stroke(g, arr);
    }
  }
  _drawRings(g, P, holo){
    g.lineWidth = 1;
    for (const d of this.dests){
      if (d.parent || (d.type !== 'planet' && d.type !== 'dwarf')) continue;
      if (Math.abs(d.phi || 0) > 0.2) continue;
      const r = radiusOf(d.au);
      g.strokeStyle = holo ? this._rgba(this.o.accent, 0.10) : 'rgba(140,180,255,0.09)';
      const arr = [];
      for (let i = 0; i <= 110; i++){
        const th = (i / 110) * Math.PI * 2;
        arr.push(P(Math.cos(th) * r, 0, Math.sin(th) * r));
      }
      this._stroke(g, arr);
    }
  }
  _rgba(hex, a){
    const n = parseInt(hex.slice(1), 16);
    return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  _drawDest(g, d, p, P, holo){
    const isHov = d === this.hover, isSel = d === this.selected, isHl = d === this.hl;
    const color = holo ? this.o.accent : d.color;
    let sz = Math.min(9, Math.max(1.4, SIZE[d.type] * p[3] * 1.2));
    if (isHov || isSel || isHl) sz *= 1.25;
    // Drop line to grid plane (holo)
    if (this.o.dropLines && Math.abs(d.py) > 4){
      const base = P(d.px, 0, d.pz);
      if (base){
        g.strokeStyle = this._rgba(color, 0.13);
        g.lineWidth = 1;
        g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(base[0], base[1]); g.stroke();
        g.fillStyle = this._rgba(color, 0.2);
        g.beginPath(); g.arc(base[0], base[1], 1.5, 0, Math.PI * 2); g.fill();
      }
    }
    // Procedural sprite render
    const key = holo ? 'h' + this.o.accent : 'n';
    if (d._spriteKey !== key){ d._sprite = buildSprite(d, holo, this.o.accent); d._spriteKey = key; }
    const CAP = { star: 64, planet: 34, dwarf: 26, moon: 18, craft: 20, landmark: 56 };
    const ds = Math.min(CAP[d.type] || 30, Math.max(9, sz * 5.5)) * (isHov || isSel || isHl ? 1.12 : 1);
    if (isHov || isSel || isHl){
      const gr = g.createRadialGradient(p[0], p[1], 0, p[0], p[1], ds * 0.75);
      gr.addColorStop(0, this._rgba(color, 0.22));
      gr.addColorStop(1, this._rgba(color, 0));
      g.fillStyle = gr;
      g.beginPath(); g.arc(p[0], p[1], ds * 0.75, 0, Math.PI * 2); g.fill();
    }
    if ((d.type === 'planet' || d.type === 'dwarf' || d.type === 'moon') && !holo){
      const sun = P(0, 0, 0);
      const ang = sun ? Math.atan2(sun[1] - p[1], sun[0] - p[0]) : Math.PI;
      g.save(); g.translate(p[0], p[1]); g.rotate(ang - Math.PI);
      g.drawImage(d._sprite, -ds / 2, -ds / 2, ds, ds);
      g.restore();
    } else {
      g.drawImage(d._sprite, p[0] - ds / 2, p[1] - ds / 2, ds, ds);
    }
    const lx0 = Math.max(sz + 9, ds * 0.42 + 8);
    // Ship marker
    if (d.ship){
      g.strokeStyle = this._rgba(this.o.accent, 0.9);
      g.lineWidth = 1;
      const r = Math.max(sz + 5, 13) + Math.sin(this.t * 2.5) * 1.2;
      g.beginPath();
      g.moveTo(p[0], p[1] - r); g.lineTo(p[0] + r, p[1]);
      g.lineTo(p[0], p[1] + r); g.lineTo(p[0] - r, p[1]);
      g.closePath(); g.stroke();
    }
    // Selection pulse
    if (isSel || isHl){
      const ph = (this.t % 1.6) / 1.6;
      g.strokeStyle = this._rgba(color, (1 - ph) * 0.55);
      g.lineWidth = 1;
      const sr = Math.max(sz + 4, 12);
      g.beginPath(); g.arc(p[0], p[1], sr + ph * 22, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = this._rgba(color, 0.5);
      g.beginPath(); g.arc(p[0], p[1], sr, 0, Math.PI * 2); g.stroke();
    }
    // Labels
    const showLabel = isHov || isSel || isHl
      || (d.type === 'landmark')
      || ((d.type === 'planet' || d.type === 'star' || d.type === 'dwarf') && this.dist < 700)
      || ((d.type === 'moon' || d.type === 'craft') && this.dist < 200);
    if (showLabel){
      g.letterSpacing = '2px';
      g.font = '300 10px "Segoe UI", "Helvetica Neue", sans-serif';
      g.fillStyle = holo ? this._rgba(this.o.accent, isHov || isSel ? 0.95 : 0.6)
        : 'rgba(230,240,255,' + (isHov || isSel ? 0.95 : 0.55) + ')';
      g.fillText(d.name.toLowerCase(), p[0] + lx0, p[1] + 3);
      if (isHov || isSel){
        g.font = '300 9px "Segoe UI", "Helvetica Neue", sans-serif';
        g.fillStyle = holo ? this._rgba(this.o.accent, 0.5) : 'rgba(160,200,255,0.55)';
        g.fillText(this.distLabel(d).toLowerCase(), p[0] + lx0, p[1] + 15);
      }
      g.letterSpacing = '0px';
    }
  }
}

// ── Procedural object sprites ─────────────────────────────────────────
// Each destination gets a pre-rendered 160px canvas: shaded spheres for
// solid bodies (lit from the left; the engine rotates them to face the
// sun), banded gas giants, ringed Saturn, corona'd stars, wispy nebulae,
// spiral galaxies, accretion disks. Deterministic per name.
const SPR = 160, HW = 80;

function seeded(name){
  let s = 2166136261;
  for (let i = 0; i < name.length; i++) s = (s * 16777619) ^ name.charCodeAt(i);
  s = s >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
function rgbaOf(hex, a){
  const n = parseInt(hex.slice(1), 16);
  return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
}
function blob(g, x, y, r, color, a){
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, rgbaOf(color, a));
  gr.addColorStop(1, rgbaOf(color, 0));
  g.fillStyle = gr;
  g.fillRect(x - r, y - r, r * 2, r * 2);
}

export function buildSprite(d, holo, accent){
  const cv = document.createElement('canvas');
  cv.width = cv.height = SPR;
  const g = cv.getContext('2d');
  const rnd = seeded(d.name);
  if (d.type === 'star') drawStar(g, d.color, 26, 76);
  else if (d.type === 'craft') drawCraft(g, d.color);
  else if (d.type === 'landmark') drawLandmark(g, d, rnd);
  else drawBody(g, d, rnd);
  if (holo) tint(cv, accent);
  return cv;
}

function tint(cv, accent){
  const m = document.createElement('canvas');
  m.width = m.height = cv.width;
  m.getContext('2d').drawImage(cv, 0, 0);
  const g = cv.getContext('2d');
  g.globalCompositeOperation = 'color';
  g.fillStyle = accent;
  g.fillRect(0, 0, cv.width, cv.height);
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(m, 0, 0);
  g.globalCompositeOperation = 'source-over';
}

function drawStar(g, color, coreR, glowR){
  blob(g, HW, HW, glowR, color, 0.5);
  blob(g, HW, HW, coreR * 1.6, color, 0.8);
  const gr = g.createRadialGradient(HW, HW, 0, HW, HW, coreR);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.5, rgbaOf(color, 1));
  gr.addColorStop(1, rgbaOf(color, 0.15));
  g.fillStyle = gr;
  g.beginPath(); g.arc(HW, HW, coreR, 0, Math.PI * 2); g.fill();
  g.strokeStyle = rgbaOf(color, 0.25);
  g.lineWidth = 1;
  for (let i = 0; i < 4; i++){
    const a = i * Math.PI / 2 + Math.PI / 4;
    g.beginPath();
    g.moveTo(HW + Math.cos(a) * coreR, HW + Math.sin(a) * coreR);
    g.lineTo(HW + Math.cos(a) * glowR, HW + Math.sin(a) * glowR);
    g.stroke();
  }
}

function drawRing(g, front){
  g.save();
  g.translate(HW, HW);
  g.rotate(-0.32);
  const bands = [[46, 0.55, 3], [53, 0.4, 4], [60, 0.22, 3]];
  for (const [r, a, w] of bands){
    g.strokeStyle = 'rgba(226,206,158,' + a + ')';
    g.lineWidth = w;
    g.beginPath();
    g.ellipse(0, 0, r, r * 0.24, 0, front ? 0 : Math.PI, front ? Math.PI : Math.PI * 2);
    g.stroke();
  }
  g.restore();
}

function drawBody(g, d, rnd){
  const R = 34;
  if (d.name === 'SATURN') drawRing(g, false);
  g.save();
  g.beginPath(); g.arc(HW, HW, R, 0, Math.PI * 2); g.clip();
  g.fillStyle = d.color;
  g.fillRect(HW - R, HW - R, R * 2, R * 2);
  const gas = d.name === 'JUPITER' || d.name === 'SATURN' || d.name === 'URANUS' || d.name === 'NEPTUNE';
  if (gas){
    for (let i = 0; i < 8; i++){
      const y = HW - R + (i + 0.5) * (R * 2 / 8), hgt = 3 + rnd() * 7;
      g.fillStyle = rnd() > 0.5 ? 'rgba(255,255,255,' + (0.05 + rnd() * 0.12) + ')' : 'rgba(10,5,30,' + (0.06 + rnd() * 0.12) + ')';
      g.fillRect(HW - R, y - hgt / 2, R * 2, hgt);
    }
    if (d.name === 'JUPITER'){
      g.fillStyle = 'rgba(200,80,50,0.55)';
      g.beginPath(); g.ellipse(HW + 12, HW + 10, 7, 4, 0, 0, Math.PI * 2); g.fill();
    }
  } else if (d.name === 'EARTH'){
    for (let i = 0; i < 5; i++){
      g.fillStyle = 'rgba(70,150,90,0.6)';
      g.beginPath();
      g.ellipse(HW - R + rnd() * R * 2, HW - R + rnd() * R * 2, 5 + rnd() * 9, 4 + rnd() * 6, rnd() * 3, 0, Math.PI * 2);
      g.fill();
    }
    for (let i = 0; i < 6; i++){
      g.fillStyle = 'rgba(255,255,255,0.3)';
      g.beginPath();
      g.ellipse(HW - R + rnd() * R * 2, HW - R + rnd() * R * 2, 8 + rnd() * 12, 2 + rnd() * 3, rnd() * 3, 0, Math.PI * 2);
      g.fill();
    }
  } else if (d.name === 'MARS'){
    g.fillStyle = 'rgba(255,240,230,0.75)';
    g.beginPath(); g.ellipse(HW, HW - R + 3, 10, 4, 0, 0, Math.PI * 2); g.fill();
    for (let i = 0; i < 8; i++){
      g.fillStyle = 'rgba(60,20,10,' + (0.1 + rnd() * 0.12) + ')';
      g.beginPath(); g.arc(HW - R + rnd() * R * 2, HW - R + rnd() * R * 2, 2 + rnd() * 5, 0, Math.PI * 2); g.fill();
    }
  } else {
    for (let i = 0; i < 12; i++){
      g.fillStyle = 'rgba(0,0,0,' + (0.08 + rnd() * 0.14) + ')';
      g.beginPath(); g.arc(HW - R + rnd() * R * 2, HW - R + rnd() * R * 2, 1.5 + rnd() * 4, 0, Math.PI * 2); g.fill();
    }
  }
  // Terminator shading, light from the left
  const sh = g.createRadialGradient(HW - R * 0.6, HW - R * 0.3, R * 0.2, HW, HW, R * 1.35);
  sh.addColorStop(0, 'rgba(255,255,255,0.3)');
  sh.addColorStop(0.55, 'rgba(0,0,0,0)');
  sh.addColorStop(1, 'rgba(0,0,12,0.9)');
  g.fillStyle = sh;
  g.fillRect(HW - R, HW - R, R * 2, R * 2);
  g.restore();
  g.strokeStyle = rgbaOf(d.color, 0.3);
  g.lineWidth = 1.2;
  g.beginPath(); g.arc(HW, HW, R + 0.8, 0, Math.PI * 2); g.stroke();
  if (d.name === 'SATURN') drawRing(g, true);
  if (d.name === 'URANUS'){
    g.save(); g.translate(HW, HW); g.rotate(1.2);
    g.strokeStyle = 'rgba(200,230,240,0.3)'; g.lineWidth = 1.5;
    g.beginPath(); g.ellipse(0, 0, 46, 10, 0, 0, Math.PI * 2); g.stroke();
    g.restore();
  }
}

function drawCraft(g, color){
  blob(g, HW, HW, 34, color, 0.3);
  g.fillStyle = 'rgba(120,160,220,0.9)';
  g.fillRect(HW - 34, HW - 6, 22, 12);
  g.fillRect(HW + 12, HW - 6, 22, 12);
  g.strokeStyle = 'rgba(20,30,50,0.8)';
  g.lineWidth = 1.5;
  for (const x of [-28, -22, -16, 18, 24, 30]){
    g.beginPath(); g.moveTo(HW + x, HW - 6); g.lineTo(HW + x, HW + 6); g.stroke();
  }
  g.fillStyle = color;
  g.fillRect(HW - 9, HW - 9, 18, 18);
  g.strokeStyle = rgbaOf(color, 0.8);
  g.beginPath(); g.moveTo(HW, HW - 9); g.lineTo(HW, HW - 24); g.stroke();
  g.beginPath(); g.arc(HW, HW - 26, 2.5, 0, Math.PI * 2);
  g.fillStyle = 'rgba(255,255,255,0.95)'; g.fill();
}

function drawLandmark(g, d, rnd){
  const k = d.kind, n = d.name;
  if (k === 'red hypergiant'){ drawStar(g, d.color, 34, 78); return; }
  if (k === 'binary star system'){
    blob(g, HW, HW, 70, '#ff8830', 0.25);
    g.save(); g.translate(HW, HW); g.rotate(-0.6);
    for (const s of [-1, 1]){
      const gr = g.createRadialGradient(0, s * 20, 0, 0, s * 20, 30);
      gr.addColorStop(0, 'rgba(255,250,230,0.95)');
      gr.addColorStop(0.4, rgbaOf(d.color, 0.5));
      gr.addColorStop(1, rgbaOf(d.color, 0));
      g.fillStyle = gr;
      g.beginPath(); g.ellipse(0, s * 22, 18, 26, 0, 0, Math.PI * 2); g.fill();
    }
    g.restore();
    g.fillStyle = 'rgba(255,255,255,1)';
    g.beginPath(); g.arc(HW, HW, 4, 0, Math.PI * 2); g.fill();
    return;
  }
  if (k === 'magnetar'){
    g.save(); g.translate(HW, HW); g.rotate(0.5);
    for (const s of [-1, 1]){
      const lg = g.createLinearGradient(0, 0, 0, s * 74);
      lg.addColorStop(0, rgbaOf(d.color, 0.5));
      lg.addColorStop(1, rgbaOf(d.color, 0));
      g.fillStyle = lg;
      g.beginPath(); g.moveTo(-3, 0); g.lineTo(-9, s * 74); g.lineTo(9, s * 74); g.lineTo(3, 0);
      g.closePath(); g.fill();
    }
    g.restore();
    blob(g, HW, HW, 26, d.color, 0.6);
    g.fillStyle = 'rgba(255,255,255,1)';
    g.beginPath(); g.arc(HW, HW, 5, 0, Math.PI * 2); g.fill();
    return;
  }
  if (k === 'supermassive black hole'){
    blob(g, HW, HW, 74, d.color, 0.22);
    g.save(); g.translate(HW, HW); g.rotate(0.35);
    for (const [r, a, w] of [[34, 0.85, 4], [42, 0.4, 5], [50, 0.15, 6]]){
      g.strokeStyle = 'rgba(255,' + (150 - r) + ',30,' + a + ')';
      g.lineWidth = w;
      g.beginPath(); g.ellipse(0, 0, r, r * 0.3, 0, 0, Math.PI * 2); g.stroke();
    }
    g.restore();
    g.fillStyle = '#000';
    g.beginPath(); g.arc(HW, HW, 15, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(255,200,120,0.8)';
    g.lineWidth = 1.5;
    g.beginPath(); g.arc(HW, HW, 16, 0, Math.PI * 2); g.stroke();
    return;
  }
  if (k === 'planetary nebula'){
    const gr = g.createRadialGradient(HW, HW, 0, HW, HW, 52);
    gr.addColorStop(0, 'rgba(120,255,220,0.12)');
    gr.addColorStop(0.5, rgbaOf(d.color, 0.06));
    gr.addColorStop(0.68, rgbaOf(d.color, 0.55));
    gr.addColorStop(0.82, 'rgba(255,120,80,0.3)');
    gr.addColorStop(1, 'rgba(255,120,80,0)');
    g.fillStyle = gr;
    g.beginPath(); g.arc(HW, HW, 52, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.beginPath(); g.arc(HW, HW, 2.5, 0, Math.PI * 2); g.fill();
    return;
  }
  if (k === 'supernova remnant'){
    blob(g, HW, HW, 60, d.color, 0.18);
    for (let i = 0; i < 16; i++){
      const a = rnd() * Math.PI * 2, r0 = 14 + rnd() * 12, r1 = r0 + 14 + rnd() * 22;
      const x0 = HW + Math.cos(a) * r0, y0 = HW + Math.sin(a) * r0;
      const x1 = HW + Math.cos(a) * r1, y1 = HW + Math.sin(a) * r1;
      const lg = g.createLinearGradient(x0, y0, x1, y1);
      lg.addColorStop(0, rgbaOf(i % 3 ? d.color : '#ffcc88', 0.5));
      lg.addColorStop(1, rgbaOf(d.color, 0));
      g.strokeStyle = lg;
      g.lineWidth = 2 + rnd() * 2.5;
      g.beginPath(); g.moveTo(x0, y0);
      g.quadraticCurveTo((x0 + x1) / 2 + (rnd() - 0.5) * 12, (y0 + y1) / 2 + (rnd() - 0.5) * 12, x1, y1);
      g.stroke();
    }
    blob(g, HW, HW, 12, '#aaddff', 0.9);
    g.fillStyle = '#fff';
    g.beginPath(); g.arc(HW, HW, 2.5, 0, Math.PI * 2); g.fill();
    return;
  }
  if (k === 'dark nebula'){
    blob(g, HW, HW, 66, '#ff5533', 0.16);
    blob(g, HW + 16, HW - 10, 40, '#ff8866', 0.14);
    g.fillStyle = 'rgba(12,6,8,0.92)';
    g.beginPath();
    g.moveTo(HW - 6, HW + 40);
    g.bezierCurveTo(HW - 26, HW + 26, HW - 20, HW - 4, HW - 6, HW - 14);
    g.bezierCurveTo(HW + 2, HW - 20, HW + 14, HW - 30, HW + 10, HW - 36);
    g.bezierCurveTo(HW + 22, HW - 32, HW + 22, HW - 14, HW + 12, HW - 4);
    g.bezierCurveTo(HW + 20, HW + 14, HW + 14, HW + 34, HW + 4, HW + 42);
    g.closePath();
    g.fill();
    return;
  }
  if (k === 'spiral galaxy' && n === 'SOMBRERO GALAXY'){
    g.save(); g.translate(HW, HW); g.rotate(-0.12);
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, 56);
    gr.addColorStop(0, 'rgba(255,240,215,0.85)');
    gr.addColorStop(0.35, rgbaOf(d.color, 0.4));
    gr.addColorStop(1, rgbaOf(d.color, 0));
    g.fillStyle = gr;
    g.beginPath(); g.ellipse(0, 0, 56, 17, 0, 0, Math.PI * 2); g.fill();
    blob(g, 0, -3, 18, '#fff2dd', 0.7);
    g.strokeStyle = 'rgba(30,15,10,0.85)';
    g.lineWidth = 3;
    g.beginPath(); g.ellipse(0, 2, 54, 13, 0, 0.12, Math.PI - 0.12); g.stroke();
    g.restore();
    return;
  }
  if (k === 'spiral galaxy'){
    g.save(); g.translate(HW, HW); g.rotate(-0.5); g.scale(1, 0.42);
    blob(g, 0, 0, 64, d.color, 0.3);
    for (let i = 0; i < 170; i++){
      const t = rnd() * 4.6, arm = rnd() > 0.5 ? 0 : Math.PI;
      const r = 5 + t * 12.5, a = t * 1.9 + arm + (rnd() - 0.5) * 0.5;
      g.fillStyle = 'rgba(' + (rnd() > 0.75 ? '190,205,255' : '235,240,255') + ',' + (0.25 + rnd() * 0.5) + ')';
      g.fillRect(Math.cos(a) * r, Math.sin(a) * r, 1.4, 1.4);
    }
    g.restore();
    g.save(); g.translate(HW, HW); g.rotate(-0.5);
    const core = g.createRadialGradient(0, 0, 0, 0, 0, 16);
    core.addColorStop(0, 'rgba(255,250,235,0.95)');
    core.addColorStop(1, 'rgba(255,240,220,0)');
    g.fillStyle = core;
    g.beginPath(); g.ellipse(0, 0, 16, 8, 0, 0, Math.PI * 2); g.fill();
    g.restore();
    return;
  }
  if (k === 'supervoid'){
    g.fillStyle = 'rgba(0,0,6,0.55)';
    g.beginPath(); g.arc(HW, HW, 48, 0, Math.PI * 2); g.fill();
    const gr = g.createRadialGradient(HW, HW, 30, HW, HW, 62);
    gr.addColorStop(0, 'rgba(80,120,170,0)');
    gr.addColorStop(0.75, 'rgba(90,130,180,0.28)');
    gr.addColorStop(1, 'rgba(90,130,180,0)');
    g.fillStyle = gr;
    g.beginPath(); g.arc(HW, HW, 62, 0, Math.PI * 2); g.fill();
    for (let i = 0; i < 9; i++){
      const a = rnd() * Math.PI * 2, r = 50 + rnd() * 12;
      g.fillStyle = 'rgba(220,230,255,' + (0.3 + rnd() * 0.4) + ')';
      g.fillRect(HW + Math.cos(a) * r, HW + Math.sin(a) * r, 1.5, 1.5);
    }
    return;
  }
  // Star-forming nebulae (pillars, carina)
  for (let i = 0; i < 9; i++){
    const a = rnd() * Math.PI * 2, r = rnd() * 32;
    blob(g, HW + Math.cos(a) * r, HW + Math.sin(a) * r * 0.8, 15 + rnd() * 26, d.color, 0.14 + rnd() * 0.14);
  }
  blob(g, HW, HW, 20, '#ffddaa', 0.2);
  if (n === 'PILLARS OF CREATION'){
    for (let i = 0; i < 3; i++){
      const x = HW - 20 + i * 18, top = HW - 18 - i * 10;
      const lg = g.createLinearGradient(x, HW + 34, x, top);
      lg.addColorStop(0, 'rgba(40,18,10,0.9)');
      lg.addColorStop(0.7, 'rgba(90,45,25,0.75)');
      lg.addColorStop(1, 'rgba(120,70,40,0.35)');
      g.fillStyle = lg;
      g.beginPath();
      g.moveTo(x - 6, HW + 36); g.lineTo(x - 2.5, top); g.lineTo(x + 2.5, top); g.lineTo(x + 6, HW + 36);
      g.closePath(); g.fill();
      blob(g, x, top - 2, 5, '#ffcc88', 0.5);
    }
  }
  for (let i = 0; i < 8; i++){
    g.fillStyle = 'rgba(255,245,230,' + (0.45 + rnd() * 0.5) + ')';
    g.fillRect(HW + (rnd() * 2 - 1) * 30, HW + (rnd() * 2 - 1) * 26, 1.5, 1.5);
  }
}
