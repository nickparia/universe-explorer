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

// ── Ground wind — the air of a real place ────────────────────────────
// Started on ground:enter, driven per-frame by the same gust envelope
// that moves the visible dust (what you hear is what you see). Two
// colors from one noise source: a broad low moan (air over the canyon)
// and a darker mid sigh that swells in gusts against the suit. On
// lift-off it fades and the hull bed returns to full.
let groundWind = null;   // { moanG, sighG, moan, sigh, stops }
let _groundK = 0;

function buildGroundWind() {
  const noise = ctx.createBufferSource();
  noise.buffer = makeNoiseBuffer(5);
  noise.loop = true;

  const moan = ctx.createBiquadFilter();
  moan.type = 'lowpass';
  moan.frequency.value = 130;
  moan.Q.value = 0.8;
  const moanG = ctx.createGain();
  moanG.gain.value = 0;

  const sigh = ctx.createBiquadFilter();
  sigh.type = 'bandpass';
  sigh.frequency.value = 420;
  sigh.Q.value = 0.5;
  const sighG = ctx.createGain();
  sighG.gain.value = 0;

  // Unhurried wander on the sigh's center — no two minutes alike
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.05;
  const lfoG = ctx.createGain();
  lfoG.gain.value = 160;
  lfo.connect(lfoG).connect(sigh.frequency);

  noise.connect(moan).connect(moanG).connect(master);
  noise.connect(sigh).connect(sighG).connect(master);
  noise.start();
  lfo.start();
  groundWind = { moan, moanG, sigh, sighG, stops: [noise, lfo] };
}

function stopGroundWind() {
  if (!groundWind) return;
  const t = ctx.currentTime;
  groundWind.moanG.gain.setTargetAtTime(0.0001, t, 0.8);
  groundWind.sighG.gain.setTargetAtTime(0.0001, t, 0.8);
  const gw = groundWind;
  setTimeout(() => gw.stops.forEach((n) => { try { n.stop(); } catch (e) {} }), 4000);
  groundWind = null;
  _groundK = 0;
  // The hull remembers its own voice
  if (bedGain) bedGain.gain.setTargetAtTime(0.05 * (1 - 0.8 * _hush), t, 2);
}

/** Per-frame from the ground mode: 0 = still air, ~1.5 = hard gust. */
export function setGroundWind(k) {
  if (!started) return;
  if (k > 0 && !groundWind) {
    buildGroundWind();
    // Groundside the room is the suit, not the hull — the bed thins
    bedGain.gain.setTargetAtTime(0.018, ctx.currentTime, 2);
  }
  if (!groundWind) return;
  if (Math.abs(k - _groundK) < 0.015) return;
  _groundK = k;
  const t = ctx.currentTime;
  groundWind.moanG.gain.setTargetAtTime(0.030 * Math.min(1.4, k), t, 0.5);
  groundWind.moan.frequency.setTargetAtTime(110 + 70 * k, t, 0.6);
  groundWind.sighG.gain.setTargetAtTime(0.020 * Math.max(0, k - 0.25), t, 0.35);
}

// ── Footfalls and wheels — the ground answers the traveler ──────────
// A footstep is a short granular crunch (regolith under a boot), pitch
// and level jittered so no two strides match. Landing from a hop gets
// a deeper, harder bite. The rover is a continuous machine: a low
// electric hum that climbs with speed and gravel hiss under the wheels.
let _crunchBuf = null;

function makeCrunchBuffer() {
  const rate = ctx.sampleRate;
  const buf = ctx.createBuffer(1, (rate * 0.13) | 0, rate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) {
    const t = i / d.length;
    const env = Math.pow(1 - t, 1.7);
    // granular: dense at contact, sparse grains as the boot settles
    d[i] = (Math.random() * 2 - 1) * env * (Math.random() < 0.45 - t * 0.3 ? 1 : 0.3);
  }
  return buf;
}

/** One footfall. level ~0..1.3; hard=true for landings. */
export function stepCrunch(level = 1, hard = false) {
  if (!started) return;
  if (!_crunchBuf) _crunchBuf = makeCrunchBuffer();
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = _crunchBuf;
  src.playbackRate.value = (hard ? 0.62 : 0.92) + Math.random() * 0.3;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = hard ? 520 : 980 + Math.random() * 320;
  f.Q.value = 0.4;
  const g = ctx.createGain();
  g.gain.value = (hard ? 0.075 : 0.034) * Math.min(1.4, level);
  src.connect(f).connect(g).connect(master);
  src.start(t);
}

let roverBed = null;
let _rbK = -1;

function buildRoverBed() {
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.value = 58;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 150;
  lp.Q.value = 0.7;
  const og = ctx.createGain();
  og.gain.value = 0;
  const noise = ctx.createBufferSource();
  noise.buffer = makeNoiseBuffer(3);
  noise.loop = true;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 420;
  bp.Q.value = 0.55;
  const ng = ctx.createGain();
  ng.gain.value = 0;
  osc.connect(lp).connect(og).connect(master);
  noise.connect(bp).connect(ng).connect(master);
  osc.start();
  noise.start();
  roverBed = { osc, og, bp, ng, stops: [osc, noise] };
}

function stopRoverBed() {
  if (!roverBed) return;
  const t = ctx.currentTime;
  roverBed.og.gain.setTargetAtTime(0.0001, t, 0.4);
  roverBed.ng.gain.setTargetAtTime(0.0001, t, 0.4);
  const rb = roverBed;
  setTimeout(() => rb.stops.forEach((n) => { try { n.stop(); } catch (e) {} }), 2500);
  roverBed = null;
  _rbK = -1;
}

/** Per-frame from the rover: 0 = parked/afoot (bed sleeps), ~1 = boost. */
export function setRoverBed(k) {
  if (!started) return;
  if (k > 0.02 && !roverBed) buildRoverBed();
  if (!roverBed) return;
  if (Math.abs(k - _rbK) < 0.01) return;
  _rbK = k;
  const t = ctx.currentTime;
  roverBed.og.gain.setTargetAtTime(0.011 * Math.min(1, 0.25 + k), t, 0.2);
  roverBed.osc.frequency.setTargetAtTime(56 + 64 * k, t, 0.25);
  roverBed.ng.gain.setTargetAtTime(0.030 * k * k + 0.005 * Math.min(1, k * 3), t, 0.2);
  roverBed.bp.frequency.setTargetAtTime(380 + 340 * k, t, 0.3);
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
  on('ground:exit', () => { if (started) { stopGroundWind(); stopRoverBed(); } });
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
