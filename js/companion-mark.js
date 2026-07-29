// companion-mark.js — the Vessel's companion mark: SOLACE's animated logo.
//
// Seven vertical filaments that breathe. Seven emotional states — idle,
// thinking, speaking, pleased, concerned, sinister, dormant — expressed
// entirely through breath, phase and warmth. The geometry never changes
// between states, which is the whole idea: it stays calm and abstract,
// and the menace arrives as wrong timing, not as a scary shape.
//
// Ported from design_handoff_vessel_ai_mark — the motion math in amps()
// and paint() follows the handoff's numbers, with one sanctioned
// deviation: filaments render as gently swaying strands rather than
// straight strokes (see the organic pass in the draw loop). The mark is
// a pure view of a string: call setCompanionState(key), drive
// updateCompanionMark(dt) from the main render loop.

const STATES = [
  { key: 'idle',      col: [120, 180, 255], glow: 16, alpha: 0.9  },
  { key: 'thinking',  col: [150, 200, 255], glow: 20, alpha: 0.95 },
  { key: 'speaking',  col: [185, 218, 255], glow: 22, alpha: 1    },
  { key: 'pleased',   col: [255, 206, 148], glow: 28, alpha: 1    },
  { key: 'concerned', col: [255, 200, 80],  glow: 24, alpha: 0.95 },
  { key: 'sinister',  col: [255, 124, 96],  glow: 34, alpha: 1    },
  { key: 'dormant',   col: [92, 124, 176],  glow: 9,  alpha: 0.42 },
];
const BY = {};
STATES.forEach((s) => { BY[s.key] = s; });

let canvas = null;
let ctx = null;
let cur = 'dormant';   // the ship is asleep until something wakes it
let prev = 'dormant';
let mix = 1;           // 0→1 blend progress between prev and cur
let t = 0;             // seconds since init, drives all motion

const N = 7;

export function initCompanionMark(cv) {
  canvas = cv;
  ctx = canvas.getContext('2d');
}

export function setCompanionState(key) {
  if (!BY[key] || key === cur) return;
  prev = cur;
  cur = key;
  mix = 0;
}

export function getCompanionState() { return cur; }

// Never cut between states: a 0.9s easeInOutCubic blend of amplitudes,
// color, glow and alpha. This is what makes the mask slipping feel like
// a slow bleed rather than a jump cut.
function ease(x) {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

// Centre-tallest spread — the mark's one shape.
function bell(i, n) {
  const c = (n - 1) / 2, d = Math.abs(i - c) / c;
  return 1 - 0.58 * d * d;
}

function amps(key, tt, n) {
  const out = new Array(n), c = (n - 1) / 2;
  for (let i = 0; i < n; i++) {
    const b = bell(i, n), d = (i - c) / c;
    let a = b, glowMul = 1;
    switch (key) {
      case 'idle': {
        // Deeper, wave-like breath than the handoff's (±10% read as
        // static at HUD size): the swell travels outward from the
        // centre, and every ~9s a soft "passing thought" shimmers
        // across the filaments — alive even from the corner of an eye.
        const breathe = 0.60 + 0.24 * Math.sin(tt * 0.62 - Math.abs(d) * 1.1);
        const ph = tt % 9.3;
        const scan = (ph / 1.9) * (n + 1.6) - 0.8;
        const thought = ph < 1.9
          ? Math.exp(-Math.pow(i - scan, 2) / 1.2) * 0.22
          : 0;
        a = b * breathe + thought;
        break;
      }
      case 'thinking': {
        const scan = ((tt * 1.15) % 2.4) / 2.4 * (n + 1.6) - 0.8;
        const p = Math.exp(-Math.pow(i - scan, 2) / 0.85);
        a = b * (0.5 + 0.06 * Math.sin(tt * 1.4)) + p * 0.42;
        break;
      }
      case 'speaking': {
        const env = 0.5 + 0.5 * Math.sin(tt * 2.9) * Math.sin(tt * 1.13 + 0.7);
        const g = Math.sin(tt * 7.3 + i * 1.9) * Math.sin(tt * 4.1 + i * 0.7);
        a = b * (0.52 + 0.42 * env * (0.55 + 0.45 * g));
        break;
      }
      case 'pleased': {
        const sw = Math.sin(tt * 0.72 - Math.abs(d) * 0.9);
        a = (1 - 0.24 * d * d) * (0.86 + 0.13 * sw); // wider, lifted bell
        break;
      }
      case 'concerned': {
        const trem = Math.sin(tt * 9.4 + i * 2.3) * 0.028;
        const dip = i === n - 2 ? 0.72 : 1;
        a = b * dip * (0.66 + 0.07 * Math.sin(tt * 0.5 + i) + trem);
        break;
      }
      case 'sinister': {
        // holds too still, then a fast asymmetric snap; one filament off-phase
        const cyc = tt % 6.4;
        const hold = cyc < 4.4
          ? 0
          : Math.min(1, (cyc - 4.4) / 0.16) * Math.exp(-(cyc - 4.4 - 0.16) * 1.9);
        const off = i === n - 2 ? 1 : 0;
        a = b * (0.70 + 0.014 * Math.sin(tt * 0.30))
          + hold * (0.30 + 0.34 * (i / (n - 1)))
          + off * (0.16 + 0.12 * Math.sin(tt * 1.9));
        glowMul = 1 + hold * 1.3;
        break;
      }
      case 'dormant':
        a = b * (0.15 + 0.055 * Math.sin(tt * 0.30));
        break;
    }
    out[i] = { a: Math.max(0.02, a), glowMul };
  }
  return out;
}

export function updateCompanionMark(dt) {
  if (!ctx) return;
  t += dt;
  mix = Math.min(1, mix + dt / 0.9);

  const cssW = canvas.clientWidth || 1, cssH = canvas.clientHeight || 1;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const e = ease(mix);
  const A = amps(prev, t, N), B = amps(cur, t, N);
  const sa = BY[prev], sb = BY[cur];
  const col = sa.col.map((v, k) => v + (sb.col[k] - v) * e);
  const glowBase = sa.glow + (sb.glow - sa.glow) * e;
  const alpha = sa.alpha + (sb.alpha - sa.alpha) * e;

  const cx = cssW / 2, cy = cssH / 2;
  // Portrait geometry (deviation from the handoff's squat proportions,
  // per direction): tall slender columns — height well over twice the
  // spread — so the mark reads as a presence, not a smudge.
  const span = Math.min(cssW * 0.7, cssH * 0.4);
  const gap = span / (N - 1);
  const maxH = cssH * 0.86;
  const lw = Math.max(0.8, Math.min(gap * 0.2, 1.6));
  const scale = cssW / 440;
  // The gap-relative cap is load-bearing — without it the halos merge
  // at small sizes and the mark becomes an illegible blob.
  const glowCap = gap * 0.8;

  // ambient halo behind everything
  const breath = 0.5 + 0.5 * Math.sin(t * (cur === 'dormant' ? 0.30 : 0.62));
  const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(span * 0.82, maxH * 0.55));
  rg.addColorStop(0, `rgba(${col[0] | 0},${col[1] | 0},${col[2] | 0},${(0.07 + 0.04 * breath) * alpha})`);
  rg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, cssW, cssH);

  const rgb = `${col[0] | 0},${col[1] | 0},${col[2] | 0}`;
  // whitened variant for the hot core pass
  const wr = `${(col[0] + (255 - col[0]) * 0.6) | 0},${(col[1] + (255 - col[1]) * 0.6) | 0},${(col[2] + (255 - col[2]) * 0.6) | 0}`;

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let i = 0; i < N; i++) {
    const a = A[i].a + (B[i].a - A[i].a) * e;
    const gm = A[i].glowMul + (B[i].glowMul - A[i].glowMul) * e;
    const h = maxH * a;
    const x = cx + (i - (N - 1) / 2) * gap;
    const fade = 0.55 + 0.45 * bell(i, N);

    // Organic strand (deviation from the handoff's straight strokes): a
    // slow bow and a finer ripple sway the middle while the sin(pi*u)
    // envelope anchors both tips — kelp in a current.
    const bow = Math.min(h * 0.06, gap * 0.5) * Math.sin(t * 0.43 + i * 1.7);
    const rip = Math.min(h * 0.03, gap * 0.25);
    const yc = cy + h * 0.05 * Math.sin(t * 0.51 + i * 2.4);
    const path = new Path2D();
    const SEG = 11;
    for (let k = 0; k <= SEG; k++) {
      const u = k / SEG;
      const env = Math.sin(Math.PI * u);
      const sx = x
        + bow * env
        + rip * env * Math.sin(u * 4.6 + t * 1.05 + i * 2.1);
      const sy = yc - h / 2 + h * u;
      if (k === 0) path.moveTo(sx, sy); else path.lineTo(sx, sy);
    }

    // Columns of light, not lines: alpha tapers to nothing at the tips
    // (no hard caps), drawn in three passes — a wide soft aura for
    // substance, the body, and a whitened core for inner light.
    const grad = ctx.createLinearGradient(0, yc - h / 2, 0, yc + h / 2);
    grad.addColorStop(0, `rgba(${rgb},0)`);
    grad.addColorStop(0.16, `rgba(${rgb},${0.5 * alpha * fade})`);
    grad.addColorStop(0.5, `rgba(${rgb},${alpha * fade})`);
    grad.addColorStop(0.84, `rgba(${rgb},${0.5 * alpha * fade})`);
    grad.addColorStop(1, `rgba(${rgb},0)`);
    const core = ctx.createLinearGradient(0, yc - h / 2, 0, yc + h / 2);
    core.addColorStop(0, `rgba(${wr},0)`);
    core.addColorStop(0.3, `rgba(${wr},${0.65 * alpha * fade})`);
    core.addColorStop(0.5, `rgba(${wr},${0.9 * alpha * fade})`);
    core.addColorStop(0.7, `rgba(${wr},${0.65 * alpha * fade})`);
    core.addColorStop(1, `rgba(${wr},0)`);

    ctx.shadowColor = `rgba(${rgb},${0.55 * alpha})`;
    ctx.shadowBlur = Math.min(glowBase * gm * scale * 2.2, glowCap);
    ctx.strokeStyle = grad;
    ctx.lineWidth = lw * 3.4;
    ctx.globalAlpha = 0.18;
    ctx.stroke(path);
    ctx.lineWidth = lw * 1.4;
    ctx.globalAlpha = 0.85;
    ctx.stroke(path);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = core;
    ctx.lineWidth = Math.max(0.45, lw * 0.55);
    ctx.globalAlpha = 1;
    ctx.stroke(path);
  }
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
}
