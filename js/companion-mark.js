// companion-mark.js — Sol's voiceprint: the trace of a voice on glass.
//
// Sol's body IS its voice. A thin horizontal phosphor line — an
// oscilloscope trace in MOTHER's chamber — that lies flat when the
// ship is quiet and ripples when it thinks, speaks, or feels. Seven
// emotional states expressed entirely through the trace's energy,
// texture and timing: speech arrives as syllable bursts, thought as a
// scanning packet, and the menace as a wave that is too smooth and too
// slow — wrong timing, never a scary shape. When the HAL voice ships,
// this line becomes the literal audio waveform.
//
// Same contract as every prior body: a pure view of a string. Call
// setCompanionState(key), drive updateCompanionMark(dt) from the main
// render loop. Never cut between states — a 0.9s easeInOutCubic blend.

const STATES = [
  { key: 'idle',      col: [120, 180, 255], glow: 10, alpha: 0.9  },
  { key: 'thinking',  col: [150, 200, 255], glow: 13, alpha: 0.95 },
  { key: 'speaking',  col: [185, 218, 255], glow: 15, alpha: 1    },
  { key: 'pleased',   col: [255, 206, 148], glow: 17, alpha: 1    },
  { key: 'concerned', col: [255, 200, 80],  glow: 14, alpha: 0.95 },
  { key: 'sinister',  col: [255, 124, 96],  glow: 20, alpha: 1    },
  { key: 'dormant',   col: [92, 124, 176],  glow: 6,  alpha: 0.42 },
];
const BY = {};
STATES.forEach((s) => { BY[s.key] = s; });

let canvas = null;
let ctx = null;
let cur = 'dormant';   // the ship is asleep until something wakes it
let prev = 'dormant';
let mix = 1;           // 0→1 blend progress between prev and cur
let t = 0;             // seconds since init, drives all motion

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

// The blinking block at the trace's head — MOTHER's prompt, standing
// invitation to address the ship. Hidden while the traveler's own line
// is open (the input carries its own cursor).
let cursorOn = true;
export function setTraceCursor(v) { cursorOn = !!v; }

// When real audio is playing, the trace follows the actual level —
// the line on the glass IS the waveform of the voice. Negative = no
// live audio; the procedural speech envelope carries the motion.
let voiceLevel = -1;
export function setVoiceLevel(v) { voiceLevel = v; }

function ease(x) {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

// Overall energy of the trace, 0..1 — how loud the voice is right now.
function envelope(key, tt) {
  switch (key) {
    case 'dormant':
      return 0.05 + 0.02 * Math.sin(tt * 0.30);
    case 'idle': {
      // near-flat, with the ~9s "passing thought" traveling through
      const ph = tt % 9.3;
      const thought = ph < 1.9 ? Math.exp(-Math.pow((ph / 1.9) * 4 - 2, 2)) * 0.22 : 0;
      return 0.09 + 0.04 * Math.sin(tt * 0.62) + thought;
    }
    case 'thinking':
      return 0.26 + 0.07 * Math.sin(tt * 1.4);
    case 'speaking': {
      // Live voice: the real audio level drives the trace
      if (voiceLevel >= 0) return 0.12 + Math.min(1.05, voiceLevel * 1.8);
      // Silent teletype: syllable bursts at speech cadence
      const syll = Math.max(0, Math.sin(tt * 6.1) * Math.sin(tt * 2.9 + 0.7));
      const phrase = 0.6 + 0.4 * Math.sin(tt * 0.9 + 2.1);
      return 0.22 + 0.68 * syll * phrase;
    }
    case 'pleased':
      return 0.28 + 0.14 * Math.sin(tt * 0.72);
    case 'concerned':
      return 0.24 + 0.05 * Math.sin(tt * 9.4);
    case 'sinister': {
      // holds too still, then a fast asymmetric surge — wrong timing
      const cyc = tt % 6.4;
      const snap = cyc > 4.4 ? Math.min(1, (cyc - 4.4) / 0.16) * Math.exp(-(cyc - 4.4 - 0.16) * 1.9) : 0;
      return 0.18 + 0.05 * Math.sin(tt * 0.30) + snap * 0.7;
    }
  }
  return 0.1;
}

// The trace's shape at position u∈[0,1], in units of max amplitude.
function waveY(key, tt, u) {
  const w1 = Math.sin(u * 14 + tt * 3.1);
  const w2 = Math.sin(u * 31 - tt * 5.7 + 1.3);
  const w3 = Math.sin(u * 57 + tt * 9.3 + 4.1);
  switch (key) {
    case 'speaking':
      // dense voiceprint texture — three traveling components
      return 0.5 * w1 + 0.32 * w2 + 0.18 * w3;
    case 'thinking': {
      // a packet scanning along the line, reading it
      const scan = ((tt * 1.15) % 2.4) / 2.4;
      const p = Math.exp(-Math.pow((u - scan) * 9, 2));
      return 0.28 * w1 + p * Math.sin(u * 40 + tt * 6);
    }
    case 'concerned':
      // fine fast tremor over the body
      return 0.32 * w1 + 0.14 * w3 + 0.22 * Math.sin(u * 90 + tt * 22);
    case 'sinister':
      // ONE deep slow wave — a voice with no syllables in it
      return Math.sin(u * 6.2 - tt * 0.9);
    case 'pleased':
      return 0.7 * Math.sin(u * 9 - tt * 1.4) + 0.2 * w1;
    default:
      return 0.6 * w1 + 0.25 * w2;
  }
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
  const sa = BY[prev], sb = BY[cur];
  const col = sa.col.map((v, k) => v + (sb.col[k] - v) * e);
  const glow = sa.glow + (sb.glow - sa.glow) * e;
  const alpha = sa.alpha + (sb.alpha - sa.alpha) * e;
  const envA = envelope(prev, t), envB = envelope(cur, t);
  const env = envA + (envB - envA) * e;

  const cy = cssH / 2;
  const maxAmp = cssH * 0.40;
  const rgb = `${col[0] | 0},${col[1] | 0},${col[2] | 0}`;
  const wr = `${(col[0] + (255 - col[0]) * 0.6) | 0},${(col[1] + (255 - col[1]) * 0.6) | 0},${(col[2] + (255 - col[2]) * 0.6) | 0}`;

  // The trace — sampled across the width; both ends fade to nothing
  // (nothing ends like a lightswitch, not even a line).
  const SEG = 72;
  const path = new Path2D();
  for (let k = 0; k <= SEG; k++) {
    const u = k / SEG;
    const win = Math.pow(Math.sin(Math.PI * u), 0.7); // edge taper
    const ya = waveY(prev, t, u), yb = waveY(cur, t, u);
    const y = cy + maxAmp * env * win * (ya + (yb - ya) * e);
    const x = u * cssW;
    if (k === 0) path.moveTo(x, y); else path.lineTo(x, y);
  }

  // Horizontal phosphor falloff for every pass
  const fade = ctx.createLinearGradient(0, 0, cssW, 0);
  fade.addColorStop(0, `rgba(${rgb},0)`);
  fade.addColorStop(0.12, `rgba(${rgb},${0.85 * alpha})`);
  fade.addColorStop(0.88, `rgba(${rgb},${0.85 * alpha})`);
  fade.addColorStop(1, `rgba(${rgb},0)`);
  const coreFade = ctx.createLinearGradient(0, 0, cssW, 0);
  coreFade.addColorStop(0, `rgba(${wr},0)`);
  coreFade.addColorStop(0.14, `rgba(${wr},${0.9 * alpha})`);
  coreFade.addColorStop(0.86, `rgba(${wr},${0.9 * alpha})`);
  coreFade.addColorStop(1, `rgba(${wr},0)`);

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Three passes: a wide soft aura for substance, the body, and a
  // whitened core for the inner light — the strands' ethereal render,
  // laid on its side.
  ctx.shadowColor = `rgba(${rgb},${0.5 * alpha})`;
  ctx.shadowBlur = glow * (0.6 + env);
  ctx.strokeStyle = fade;
  ctx.lineWidth = 3.2;
  ctx.globalAlpha = 0.16;
  ctx.stroke(path);
  ctx.lineWidth = 1.3;
  ctx.globalAlpha = 0.8;
  ctx.stroke(path);
  ctx.shadowBlur = 0;
  ctx.strokeStyle = coreFade;
  ctx.lineWidth = 0.55;
  ctx.globalAlpha = 1;
  ctx.stroke(path);
  ctx.globalAlpha = 1;

  // The prompt: a phosphor block blinking on the teletype beat at the
  // head of the trace — the ship, visibly listening.
  if (cursorOn && (t % 1.06) < 0.53) {
    const ch = Math.min(11, cssH * 0.4), cw = ch * 0.48;
    ctx.fillStyle = `rgba(${wr},${0.85 * alpha})`;
    ctx.shadowColor = `rgba(${rgb},${0.6 * alpha})`;
    ctx.shadowBlur = 7;
    ctx.fillRect(cssW * 0.045, cy - ch / 2, cw, ch);
    ctx.shadowBlur = 0;
  }
}
