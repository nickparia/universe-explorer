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

// ── Event tones ───────────────────────────────────────────────────────

function warpSwell(durationUp = 2.5) {
  const t = ctx.currentTime;
  const noise = ctx.createBufferSource();
  noise.buffer = makeNoiseBuffer(2);
  noise.loop = true;

  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 1.2;
  bp.frequency.setValueAtTime(300, t);
  bp.frequency.exponentialRampToValueAtTime(1400, t + durationUp);

  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.05, t + durationUp);
  g.gain.exponentialRampToValueAtTime(0.02, t + durationUp + 2);

  noise.connect(bp).connect(g).connect(master);
  noise.start();
  return { noise, g, bp };
}

let activeWarp = null;

function warpEnd() {
  if (activeWarp) {
    const t = ctx.currentTime;
    const { noise, g, bp } = activeWarp;
    bp.frequency.exponentialRampToValueAtTime(200, t + 1.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    noise.stop(t + 1.4);
    activeWarp = null;
  }
  // Soft low thump — the drive letting go
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
  on('warp:start', () => { if (started) activeWarp = warpSwell(); });
  on('warp:end', () => { if (started) warpEnd(); });
  on('orbit:enter', () => { if (started) arrivalTone(); });
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
  // The hull fades in over several seconds — presence, not an entrance
  bedGain.gain.setValueAtTime(0.0001, ctx.currentTime);
  bedGain.gain.exponentialRampToValueAtTime(0.05, ctx.currentTime + 6);
}
