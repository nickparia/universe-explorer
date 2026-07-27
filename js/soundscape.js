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
  buildTravelVoice();
  // The hull fades in over several seconds — presence, not an entrance
  bedGain.gain.setValueAtTime(0.0001, ctx.currentTime);
  bedGain.gain.exponentialRampToValueAtTime(0.05, ctx.currentTime + 6);
}
