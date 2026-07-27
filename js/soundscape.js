// soundscape.js — the ship's ambient sound bed and event tones.
//
// Music is weather; this is the room. A continuous, very quiet hum makes
// silence feel inhabited (a vessel, not a muted tab), and flight events
// get soft synthesized swells — no audio assets, everything generated in
// WebAudio, everything subtle. Volumes here are deliberately low: the bed
// should be *felt* when it stops, not noticed while it runs.

import { on } from './bus.js';

let ctx = null;
let master = null;
let bedGain = null;
let started = false;

function makeNoiseBuffer(seconds = 4) {
  const rate = ctx.sampleRate;
  const buf = ctx.createBuffer(1, rate * seconds, rate);
  const data = buf.getChannelData(0);
  // Brown noise — random walk, deep and soft
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    data[i] = last * 3.5;
  }
  return buf;
}

function buildBed() {
  // Deep filtered brown noise: the hull
  const noise = ctx.createBufferSource();
  noise.buffer = makeNoiseBuffer();
  noise.loop = true;

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 110;
  lp.Q.value = 0.7;

  // Slow breathing on the filter so the hum never reads as a loop
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.06; // one breath every ~17s
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 28;
  lfo.connect(lfoGain).connect(lp.frequency);

  // A faint sub tone under the noise: the reactor
  const sub = ctx.createOscillator();
  sub.type = 'sine';
  sub.frequency.value = 55;
  const subGain = ctx.createGain();
  subGain.gain.value = 0.012;

  bedGain = ctx.createGain();
  bedGain.gain.value = 0;

  noise.connect(lp).connect(bedGain);
  sub.connect(subGain).connect(bedGain);
  bedGain.connect(master);

  noise.start();
  sub.start();
  lfo.start();
}

// ── The travel voice ─────────────────────────────────────────────────
// One persistent, silent-by-default voice that PERFORMS the journey:
// driven per-frame from the flight model's speed feel (same law as the
// dust field and FOV), so an 8s hop and a 40s intergalactic run both
// sound right. Two colors from one noise source: a deep lowpass rumble
// (the drive working) and a dark bandpass wind (motion) that never
// rises into hiss territory — capped far below sibilance.
let travel = null;

function buildTravelVoice() {
  const noise = ctx.createBufferSource();
  noise.buffer = makeNoiseBuffer(3);
  noise.loop = true;

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 90;
  lp.Q.value = 0.6;
  const lpG = ctx.createGain();
  lpG.gain.value = 0;

  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 140;
  bp.Q.value = 0.55; // wide — wind, not whistle
  const bpG = ctx.createGain();
  bpG.gain.value = 0;

  // A slow wobble on the wind's center so long cruises stay alive
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.11;
  const lfoG = ctx.createGain();
  lfoG.gain.value = 55;
  lfo.connect(lfoG).connect(bp.frequency);

  noise.connect(lp).connect(lpG).connect(master);
  noise.connect(bp).connect(bpG).connect(master);
  noise.start();
  lfo.start();
  travel = { lp, lpG, bp, bpG };
}

/**
 * Call once per frame with the flight feel {warp, ratio, free}.
 * The voice follows the journey's actual arc — spool, sweep, settle.
 */
export function updateSoundscape(feel) {
  if (!started || !travel) return;
  const t = ctx.currentTime;
  const w = feel.warp || 0;
  // Free-flight wind is a whisper that only appears when pushing hard
  const fr = feel.free ? Math.pow(Math.max(0, feel.ratio || 0), 3) * 0.5 : 0;
  const drive = Math.max(w, fr);

  // Rumble: the drive under load — strongest while accelerating
  travel.lpG.gain.setTargetAtTime(0.030 * drive, t, 0.3);
  travel.lp.frequency.setTargetAtTime(70 + 90 * drive, t, 0.4);
  // Wind: dark, swelling with speed, sliding home as we settle
  travel.bpG.gain.setTargetAtTime(0.040 * drive * drive, t, 0.35);
  travel.bp.frequency.setTargetAtTime(130 + 420 * drive, t, 0.5);
}

function warpEnd() {
  // Soft low thump — the drive letting go (the voice itself eases out
  // on its own as speedFeeling dies through the settle)
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(90, t);
  o.frequency.exponentialRampToValueAtTime(45, t + 0.5);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.045, t + 0.05);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + 1);
}

// ── Location tones ───────────────────────────────────────────────────
// Each place hums its own signature under the music while in orbit —
// the field recording of the location. Built from tiny primitives
// (subs, filtered noise, partials, crackle), all whisper-quiet,
// bloomed in over ~5s and disposed on departure.
let toneNodes = null;   // { gain, stops: [] }

function makeCrackleBuffer() {
  // Sparse impulses baked into a loop — magnetospheric static
  const rate = ctx.sampleRate;
  const buf = ctx.createBuffer(1, rate * 3, rate);
  const d = buf.getChannelData(0);
  let i = 0;
  while (i < d.length) {
    i += Math.floor(rate * (0.03 + Math.random() * 0.22));
    const len = Math.floor(rate * (0.002 + Math.random() * 0.006));
    const amp = 0.3 + Math.random() * 0.7;
    for (let k = 0; k < len && i + k < d.length; k++) {
      d[i + k] = (Math.random() * 2 - 1) * amp * (1 - k / len);
    }
    i += len;
  }
  return buf;
}

function stopLocationTone(fade = 3) {
  if (!toneNodes) return;
  const t = ctx.currentTime;
  toneNodes.gain.gain.setTargetAtTime(0.0001, t, fade / 4);
  const nodes = toneNodes;
  setTimeout(() => nodes.stops.forEach((n) => { try { n.stop(); } catch (e) {} }), fade * 1000 + 500);
  toneNodes = null;
}

function startLocationTone(name) {
  if (!started || !name) return;
  stopLocationTone(2.5);
  const n = name.toUpperCase();
  let spec = null;
  if (n.includes('MAGNETAR')) {
    spec = { crackle: 0.012, subs: [{ f: 46, g: 0.018, lfoF: 0.22, lfoD: 0.85 }] };
  } else if (n.includes('BLACK HOLE')) {
    spec = { subs: [{ f: 32, g: 0.02 }, { f: 32.7, g: 0.02 }],
             noise: [{ type: 'lowpass', f: 70, q: 0.7, g: 0.010, lfoF: 0.05, lfoD: 22 }] };
  } else if (n.includes('UY SCUTI')) {
    spec = { noise: [{ type: 'lowpass', f: 95, q: 0.8, g: 0.024, lfoF: 0.07, lfoD: 42 }],
             subs: [{ f: 41, g: 0.011, lfoF: 0.045, lfoD: 0.7 }] };
  } else if (n.includes('SAGITTARIUS')) {
    spec = { subs: [{ f: 36, g: 0.016 }],
             noise: [{ type: 'bandpass', f: 1050, q: 0.8, g: 0.003, lfoF: 0.03, lfoD: 240 }] };
  } else if (n.includes('ANDROMEDA') || n.includes('SOMBRERO')) {
    spec = { partials: [[110, 0.005], [164.8, 0.0038], [220, 0.0026]],
             noise: [{ type: 'bandpass', f: 880, q: 0.9, g: 0.0026, lfoF: 0.04, lfoD: 190 }] };
  } else if (/(PILLARS|CRAB|CARINA|HORSEHEAD|RING NEBULA|ETA CARINAE)/.test(n)) {
    spec = { partials: [[196, 0.0034], [294, 0.0026], [392, 0.0019]],
             noise: [{ type: 'bandpass', f: 1250, q: 0.7, g: 0.0028, lfoF: 0.05, lfoD: 280 }] };
  }
  if (!spec) return; // planets & the void: the music (or silence) carries

  const t = ctx.currentTime;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.setTargetAtTime(1.0, t, 2.2);
  gain.connect(master);
  const stops = [];

  for (const p of spec.subs || []) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = p.f;
    const g = ctx.createGain();
    g.gain.value = p.g;
    if (p.lfoF) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = p.lfoF;
      const lg = ctx.createGain();
      lg.gain.value = p.g * (p.lfoD || 0.5);
      lfo.connect(lg).connect(g.gain);
      lfo.start(); stops.push(lfo);
    }
    o.connect(g).connect(gain);
    o.start(); stops.push(o);
  }
  for (const p of spec.partials || []) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = p[0];
    const g = ctx.createGain();
    g.gain.value = p[1];
    o.connect(g).connect(gain);
    o.start(); stops.push(o);
  }
  for (const p of spec.noise || []) {
    const src = ctx.createBufferSource();
    src.buffer = makeNoiseBuffer(3);
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = p.type;
    f.frequency.value = p.f;
    f.Q.value = p.q;
    const g = ctx.createGain();
    g.gain.value = p.g;
    if (p.lfoF) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = p.lfoF;
      const lg = ctx.createGain();
      lg.gain.value = p.lfoD;
      lfo.connect(lg).connect(f.frequency);
      lfo.start(); stops.push(lfo);
    }
    src.connect(f).connect(g).connect(gain);
    src.start(); stops.push(src);
  }
  if (spec.crackle) {
    const src = ctx.createBufferSource();
    src.buffer = makeCrackleBuffer();
    src.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.value = spec.crackle;
    src.connect(hp).connect(g).connect(gain);
    src.start(); stops.push(src);
  }
  toneNodes = { gain, stops };
}

// ── Void hush — the ship itself goes quiet inside the emptiness ─────
let _hush = 0;
export function setVoidHush(h) {
  if (!started) return;
  h = Math.max(0, Math.min(1, h));
  if (Math.abs(h - _hush) < 0.01) return;
  _hush = h;
  // The hull thins to a fifth of itself, never to zero — total silence
  // reads as broken audio; near-silence reads as awe.
  bedGain.gain.setTargetAtTime(0.05 * (1 - 0.8 * h), ctx.currentTime, 1.5);
}

function arrivalTone() {
  // Two soft partials, staggered — instrumentation, not a doorbell
  const t = ctx.currentTime;
  [[392, 0], [587.33, 0.35]].forEach(([freq, delay]) => {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t + delay);
    g.gain.exponentialRampToValueAtTime(0.016, t + delay + 0.15);
    g.gain.exponentialRampToValueAtTime(0.0001, t + delay + 3);
    o.connect(g).connect(master);
    o.start(t + delay);
    o.stop(t + delay + 3.2);
  });
}

// ── Public API ────────────────────────────────────────────────────────

export function initSoundscape() {
  on('warp:end', () => { if (started) warpEnd(); });
  on('orbit:enter', ({ name }) => {
    if (!started) return;
    arrivalTone();
    startLocationTone(name);
  });
  on('orbit:exit', () => { if (started) stopLocationTone(); });
}

/** Call from a user gesture — browsers require one to unlock audio. */
export function startSoundscape() {
  if (started) return;
  started = true;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain();
  master.gain.value = 1;
  master.connect(ctx.destination);
  buildBed();
  buildTravelVoice();
  // The hull fades in over several seconds — presence, not an entrance
  bedGain.gain.setValueAtTime(0.0001, ctx.currentTime);
  bedGain.gain.exponentialRampToValueAtTime(0.05, ctx.currentTime + 6);
}
