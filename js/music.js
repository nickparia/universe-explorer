/* music.js -- Zone-based classical music system with crossfading & synth fallback */

import { AU } from './constants.js';
import { getLandmarks } from './deepspace.js';
import { on, emit } from './bus.js';

// ── Track catalog ──────────────────────────────────────────────
// Lofi is the foundation (long ambient sessions; sits over the synth
// layers); classical survives as SIGNATURE pieces for monuments —
// Zarathustra at the Sun, Clair de Lune for the Moon's neighborhood,
// Jupiter among the giants, Part in the deep, the Adagio at the hole.
const TRACKS = {
  sun:       ['audio/sun_zarathustra.mp3'],
  inner:     ['audio/lofi_tokyo_cafe.mp3', 'audio/lofi_study.mp3', 'audio/lofi_chill_beat.mp3',
              'audio/inner_clair_de_lune.mp3', 'audio/satie_gymnopedie.mp3'],
  giants:    ['audio/lofi_smooth.mp3', 'audio/lofi_calm_chillout.mp3', 'audio/lofi_autumn_leaves.mp3',
              'audio/giants_jupiter.mp3'],
  deep:      ['audio/lofi_lost_ambient.mp3', 'audio/lofi_watr_fluid.mp3', 'audio/lofi_mountain.mp3',
              'audio/lofi_midnight_piano.mp3', 'audio/part_spiegel.mp3'],
  nebula:    ['audio/lofi_watr_fluid.mp3', 'audio/nebula_air.mp3', 'audio/lofi_midnight_piano.mp3'],
  blackhole: ['audio/blackhole_adagio.ogg'],
  // Groundside — standing on real terrain. Mountain air, sparse and low.
  'ground-mars': ['audio/lofi_mountain.mp3', 'audio/lofi_lost_ambient.mp3', 'audio/deep_reverie.mp3'],
};

// ── Zone helpers ───────────────────────────────────────────────
function distTo(pos, bodies, name) {
  for (let i = 0; i < bodies.length; i++) {
    if (bodies[i].name === name) {
      return pos.distanceTo(bodies[i].g.userData._worldPos || bodies[i].g.position);
    }
  }
  return Infinity;
}

function nearAny(pos, bodies, names, maxDist) {
  for (let i = 0; i < bodies.length; i++) {
    if (names.indexOf(bodies[i].name) !== -1) {
      if (pos.distanceTo(bodies[i].g.userData._worldPos || bodies[i].g.position) < maxDist) return true;
    }
  }
  return false;
}

// ── Zone definitions (priority order) ─────────────────────────
const ZONES = [
  { name: 'blackhole', check: (pos, bodies) => distTo(pos, bodies, 'BLACK HOLE') < 200 * AU },
  { name: 'sun',       check: (pos, bodies) => distTo(pos, bodies, 'SUN') < 30 * AU },
  { name: 'giants',    check: (pos, bodies) => nearAny(pos, bodies, ['JUPITER','SATURN','URANUS','NEPTUNE'], 80 * AU) },
  { name: 'inner',     check: (pos, bodies) => nearAny(pos, bodies, ['MERCURY','VENUS','EARTH','MARS','MOON'], 40 * AU) },
  { name: 'deep',      check: () => true },
];

// Groundside zone override — set by ground/ground.js on landfall
let zoneOverride = null;
export function setZoneOverride(z) { zoneOverride = z; }

// Warp state — tracked via bus events from flight.js
let warping = false;
on('warp:start', () => { warping = true; });
on('warp:end', () => { warping = false; });

// A crew record opening carries the music preference across devices —
// applied silently; Sol simply scores the sky the way they like it.
on('crew:signed-on', ({ prefs }) => applyMusicPref(prefs));

// ── Zone detection with landmark support ─────────────────────
// Travel deliberately does NOT change the music: the playlist is the
// ship's own, and it plays on through any warp — the synthesized
// travel voice carries the journey. Forcing a 'warp track' meant two
// crossfades per trip, so the music was almost always overlapping.
function detectZone(pos, allBodies) {
  // Groundside override — the site's pocket frame is nowhere near any
  // body, so position-based detection would fall through to 'deep'.
  // The ground mode declares its zone explicitly instead.
  if (zoneOverride) return zoneOverride;

  // Check landmark-specific zones first
  const landmarks = getLandmarks();
  for (const lm of landmarks) {
    const d = pos.distanceTo(lm.pos);
    if (d < lm.radius * 3) {
      return { name: lm.name, track: lm.music[0] };
    }
  }

  // Fall through to existing zone checks
  if (distTo(pos, allBodies, 'BLACK HOLE') < 200 * AU) return { name: 'blackhole', track: null };
  if (distTo(pos, allBodies, 'SUN') < 30 * AU) return { name: 'sun', track: null };
  if (nearAny(pos, allBodies, ['JUPITER','SATURN','URANUS','NEPTUNE'], 80 * AU)) return { name: 'giants', track: null };
  if (nearAny(pos, allBodies, ['MERCURY','VENUS','EARTH','MARS','MOON'], 40 * AU)) return { name: 'inner', track: null };

  return { name: 'deep', track: null };
}

// ── Module state ──────────────────────────────────────────────
let channelA, channelB;
let activeChannel = 'A';        // which channel is currently playing
let currentZone   = null;
let _pendingZone  = null;  // zone-stability gate
let _pendingCount = 0;
let masterVol     = 0.25;
let musicDuck     = 0;   // 0..1 — the void presses music toward silence

function effVol() {
  return masterVol * (1 - 0.94 * musicDuck) * (1 - 0.6 * voiceDuck);
}

// Voice duck — its own channel so Sol speaking and the Void hush
// (setMusicDuck) compose instead of fighting over one knob.
let voiceDuck = 0;
export function setVoiceDuck(d) {
  d = Math.max(0, Math.min(1, d));
  if (Math.abs(d - voiceDuck) < 0.003) return;
  voiceDuck = d;
  const active = typeof getActiveEl === 'function' ? getActiveEl() : null;
  if (active && !active.paused && !active._fadeInterval) active.volume = effVol();
  if (usingSynth && masterGain) masterGain.gain.value = effVol();
}

/** External duck (Bootes Void): 1 = near-silence. Applied live. */
export function setMusicDuck(d) {
  d = Math.max(0, Math.min(1, d));
  if (Math.abs(d - musicDuck) < 0.003) return; // per-frame caller: only act on change
  musicDuck = d;
  const active = typeof getActiveEl === 'function' ? getActiveEl() : null;
  // Don't stomp an in-progress fade ramp — the fade will land on the
  // right level itself; the duck only steers a steadily-playing track.
  if (active && !active.paused && !active._fadeInterval) active.volume = effVol();
  if (usingSynth && masterGain) masterGain.gain.value = effVol();
}
let musicStarted  = false;
let paused        = false;
let zoneCheckAccum = 0;
let lastFrameTime  = 0;
// ── FULLY GENERATIVE (2026-08-01): the ship scores its own sky. ──
// The mp3 library is retired; the procedural engine below is the only
// performer. The Audio-element machinery stays dormant beneath it.
const GENERATIVE   = true;
let usingSynth     = GENERATIVE;
let audioFailed    = false;
let _gestureOk     = false;
let failCount      = 0;
let _currentTrackPath = null;  // track path for landmark/warp zones (for replay)

// ── The library is Sol's own ──────────────────────────────────
// There is no music interface: the traveler ASKS the ship, and the
// preference (on/off, volume) persists — locally, and in the crew
// record for signed-on travelers, so Sol scores the sky unasked on
// the next voyage. The ship boots quiet until first invited.
const WANT_KEY = 'solace_music_on_v1';
const VOL_KEY = 'solace_music_vol_v1';
let musicWanted = false;
try {
  musicWanted = localStorage.getItem(WANT_KEY) === '1';
  const v = parseFloat(localStorage.getItem(VOL_KEY));
  if (!Number.isNaN(v)) masterVol = Math.max(0.05, Math.min(1, v));
} catch (e) { /* private mode */ }
let _lastPos = null, _lastBodies = null; // cached from updateMusic for immediate commands

function persistPrefs() {
  try {
    localStorage.setItem(WANT_KEY, musicWanted ? '1' : '0');
    localStorage.setItem(VOL_KEY, String(masterVol));
  } catch (e) { /* fine */ }
  emit('prefs:changed', { music: musicWanted, vol: masterVol });
}

function prettyTrack(path) {
  if (!path) return null;
  return path.split('/').pop().replace(/\.(mp3|ogg)$/, '').replace(/_/g, ' ');
}

export function isMusicWanted() { return musicWanted; }
export function getNowPlaying() {
  if (usingSynth && musicWanted && synthStarted) {
    const label = (currentZone || synthZone || 'deep').toLowerCase().replace(/-/g, ' ');
    return 'the ship\'s own improvisation \u00b7 ' + label;
  }
  const active = getActiveEl();
  if (!active || active.paused || !active.src) return null;
  return prettyTrack(decodeURIComponent(active.src));
}

/** Adopt a preference from the crew record — silently, no ceremony. */
export function applyMusicPref(prefs) {
  if (!prefs) return;
  if (typeof prefs.vol === 'number' && !Number.isNaN(prefs.vol)) {
    masterVol = Math.max(0.05, Math.min(1, prefs.vol));
  }
  if (typeof prefs.music === 'boolean' && prefs.music !== musicWanted) {
    musicWanted = prefs.music;
    if (!musicWanted) { fadeOut(channelA, 3000); fadeOut(channelB, 3000); }
  }
  try {
    localStorage.setItem(WANT_KEY, musicWanted ? '1' : '0');
    localStorage.setItem(VOL_KEY, String(masterVol));
  } catch (e) { /* fine */ }
}

/**
 * Sol's hands on the library. action: 'play' | 'stop' | 'quieter' |
 * 'louder'. hint: a composer / mood fragment ("bach", "lofi") matched
 * against the library. Returns a short factual note of what happened,
 * for the brain to acknowledge in character — or null.
 */
export function musicCommand(action, hint) {
  if (action === 'stop') {
    if (!musicWanted && !getNowPlaying()) return 'the music was already off';
    musicWanted = false;
    persistPrefs();
    fadeOut(channelA, 3500);
    fadeOut(channelB, 3500);
    if (usingSynth && AC) AC.suspend();
    return 'you let the music fall away';
  }
  if (action === 'quieter' || action === 'louder') {
    masterVol = Math.max(0.05, Math.min(1, masterVol + (action === 'louder' ? 0.14 : -0.14)));
    persistPrefs();
    const active = getActiveEl();
    if (active && !active.paused && !active._fadeInterval) active.volume = effVol();
    if (usingSynth && masterGain) masterGain.gain.value = effVol();
    return 'you brought the music ' + (action === 'louder' ? 'up a little' : 'down a little');
  }
  // play
  musicWanted = true;
  persistPrefs();
  if (usingSynth) {
    if (!synthStarted && _gestureOk) startSynth();
    if (AC && AC.state === 'suspended') AC.resume();
    return 'the ship improvises now — no library, its own hands on its own keys' +
      (hint ? ' (it heard "' + hint + '" and will let the sky decide)' : '');
  }
  let track = null;
  if (hint) {
    const h = hint.toLowerCase();
    const all = Object.values(TRACKS).flat();
    track = all.find((p) => p.toLowerCase().includes(h)) || null;
  }
  const zone = (_lastPos && _lastBodies) ? detectZone(_lastPos, _lastBodies) : null;
  if (track) {
    currentZone = (zone && zone.name) || currentZone || 'deep';
    crossfadeToTrack(track, currentZone);
    return 'you put on "' + prettyTrack(track) + '"';
  }
  if (zone) {
    currentZone = zone.name;
    if (zone.track) crossfadeToTrack(zone.track, zone.name);
    else crossfadeTo(currentZone);
    const chosen = getActiveEl() && getActiveEl().src
      ? prettyTrack(decodeURIComponent(getActiveEl().src)) : 'something fitting';
    return 'you put on "' + chosen + '"' + (hint ? ' — nothing in the library matched "' + hint + '", so you chose yourself' : '');
  }
  currentZone = null; // updateMusic adopts the zone within a beat
  return 'you started the music';
}

// Per-zone track index rotation
const trackIdx = {};
for (const z in TRACKS) trackIdx[z] = 0;

// HUD refs
let musicBtn, trackLbl, volSlider;

// ── Fade helpers ──────────────────────────────────────────────
let fadeIntervals = [];

function clearFades() {
  fadeIntervals.forEach(id => clearInterval(id));
  fadeIntervals = [];
}

// Each element owns AT MOST one fade. Without this, boundary flapping
// (zone A <-> B) stacked competing intervals on the same element — the
// fade-out never won, and two tracks played forever.
function cancelFade(el) {
  if (el && el._fadeInterval) {
    clearInterval(el._fadeInterval);
    el._fadeInterval = null;
  }
}

function fadeIn(el, targetVol, duration = 4000) {
  cancelFade(el);
  const steps = 40, stepTime = duration / steps, volStep = targetVol / steps;
  let current = 0;
  el.volume = 0;
  const interval = setInterval(() => {
    current += volStep;
    if (current >= targetVol) { el.volume = targetVol; cancelFade(el); }
    else el.volume = current;
  }, stepTime);
  el._fadeInterval = interval;
  fadeIntervals.push(interval);
}

function fadeOut(el, duration = 4000) {
  if (!el || el.paused) return;
  cancelFade(el);
  const startVol = el.volume, steps = 40, stepTime = duration / steps, volStep = startVol / steps;
  let current = startVol;
  const interval = setInterval(() => {
    current -= volStep;
    if (current <= 0) { el.volume = 0; el.pause(); cancelFade(el); }
    else el.volume = current;
  }, stepTime);
  el._fadeInterval = interval;
  fadeIntervals.push(interval);
}

// ── Track playback ────────────────────────────────────────────
function getNextTrack(zone) {
  const list = TRACKS[zone];
  if (!list || list.length === 0) return null;
  const idx = trackIdx[zone] % list.length;
  trackIdx[zone] = (trackIdx[zone] + 1) % list.length;
  return list[idx];
}

function getActiveEl()  { return activeChannel === 'A' ? channelA : channelB; }
function getInactiveEl() { return activeChannel === 'A' ? channelB : channelA; }

function crossfadeTo(zone) {
  if (audioFailed || usingSynth) return;

  const track = getNextTrack(zone);
  if (!track) return;
  // Zones share tracks now — never crossfade a piece into itself
  // out of phase. If it's already playing, just carry on.
  const playing = getActiveEl();
  if (playing && !playing.paused && playing.src && playing.src.includes(track)) return;
  _currentTrackPath = null;

  // Fade out current
  fadeOut(getActiveEl());

  // Switch active channel
  activeChannel = activeChannel === 'A' ? 'B' : 'A';
  const next = getActiveEl();

  next.src = track;
  next.load();

  const playPromise = next.play();
  if (playPromise && playPromise.catch) {
    playPromise.catch(err => {
      console.warn('[music] Audio play failed:', err.message);
      failCount++;
      if (failCount >= 2 && !usingSynth) {
        activateSynthFallback();
      }
    });
  }

  fadeIn(next, effVol());

  // Update label
  if (trackLbl) {
    const label = zone.charAt(0).toUpperCase() + zone.slice(1);
    trackLbl.textContent = label;
  }
}

function crossfadeToTrack(trackPath, zoneName) {
  if (audioFailed || usingSynth) return;
  const playing = getActiveEl();
  if (playing && !playing.paused && playing.src && playing.src.includes(trackPath)) {
    _currentTrackPath = trackPath;
    return;
  }
  _currentTrackPath = trackPath;
  fadeOut(getActiveEl());
  activeChannel = activeChannel === 'A' ? 'B' : 'A';
  const next = getActiveEl();
  next.src = trackPath;
  next.load();
  const playPromise = next.play();
  if (playPromise && playPromise.catch) {
    playPromise.catch(err => {
      console.warn('[music] Audio play failed:', err.message);
      failCount++;
      if (failCount >= 2 && !usingSynth) activateSynthFallback();
    });
  }
  fadeIn(next, effVol());
  if (trackLbl) {
    const label = zoneName.split(' ').map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(' ');
    trackLbl.textContent = label;
  }
}

function playNextInZone() {
  if (!currentZone || paused || audioFailed || usingSynth) return;
  // If current zone is a landmark or warp (not in TRACKS), store the track
  // so we can replay it when the track ends
  if (TRACKS[currentZone]) {
    crossfadeTo(currentZone);
  } else if (_currentTrackPath) {
    // Replay the landmark/warp track
    crossfadeToTrack(_currentTrackPath, currentZone);
  }
}

// ── initMusic ─────────────────────────────────────────────────
export function initMusic() {
  channelA = new Audio();
  channelB = new Audio();
  channelA.preload = 'auto';
  channelB.preload = 'auto';

  // When a track ends, play next in same zone
  channelA.addEventListener('ended', playNextInZone);
  channelB.addEventListener('ended', playNextInZone);

  // Error handling: if audio files fail to load, track failures
  channelA.addEventListener('error', () => {
    failCount++;
    if (failCount >= 2 && !usingSynth) activateSynthFallback();
  });
  channelB.addEventListener('error', () => {
    failCount++;
    if (failCount >= 2 && !usingSynth) activateSynthFallback();
  });

  // HUD bindings
  musicBtn  = document.getElementById('music-btn');
  trackLbl  = document.getElementById('track-lbl');
  volSlider = document.getElementById('vol-slider');

  if (volSlider) {
    masterVol = parseFloat(volSlider.value) || 0.5;
    volSlider.addEventListener('input', () => {
      masterVol = parseFloat(volSlider.value);
      // Update active channel volume live
      const active = getActiveEl();
      if (active && !active.paused) active.volume = effVol();
      // Update synth volume if active
      if (usingSynth && masterGain) masterGain.gain.value = effVol();
    });
  }

  if (musicBtn) {
    musicBtn.addEventListener('click', () => {
      if (!musicStarted) return;
      if (paused) {
        paused = false;
        if (usingSynth) {
          if (AC && AC.state === 'suspended') AC.resume();
        } else {
          const active = getActiveEl();
          if (active && active.src) active.play().catch(() => {});
        }
        musicBtn.textContent = '\u23F8';
      } else {
        paused = true;
        if (usingSynth) {
          if (AC) AC.suspend();
        } else {
          channelA.pause();
          channelB.pause();
        }
        musicBtn.textContent = '\u25B6';
      }
    });
  }

  return {
    start() {
      musicStarted = true;
      _gestureOk = true;
      lastFrameTime = performance.now();
    }
  };
}

// ── updateMusic ───────────────────────────────────────────────
export function updateMusic(camPos, allBodies) {
  _lastPos = camPos;
  _lastBodies = allBodies;
  if (!musicStarted || paused) return;
  // The library plays only when the traveler has asked for it — the
  // ship boots quiet, and the preference persists across voyages.
  if (!musicWanted) return;

  const now = performance.now();
  const dt  = (now - lastFrameTime) / 1000;
  lastFrameTime = now;

  // The improviser wakes the first time it is both wanted and allowed
  if (usingSynth && !synthStarted && _gestureOk) startSynth();
  if (usingSynth && synthStarted && AC && AC.state === 'suspended' && musicWanted) AC.resume();

  zoneCheckAccum += dt;
  if (zoneCheckAccum < 2) return;
  zoneCheckAccum = 0;

  // Detect zone
  const zone = detectZone(camPos, allBodies);

  // Hold the current music through warp (the journey has its own
  // voice), and require a zone to be stable for two consecutive
  // checks before switching — boundary flapping was crossfading
  // every few seconds, stacking overlapped tracks. Neither rule
  // applies before the FIRST track: silence held through a whole
  // cruise ("no sound for a minute") because the initial zone was
  // blocked like a switch. When nothing is playing, adopt at once.
  if ((!warping || !currentZone) && zone.name !== currentZone) {
    if (zone.name === _pendingZone) {
      _pendingCount++;
    } else {
      _pendingZone = zone.name;
      _pendingCount = 1;
    }
    if (_pendingCount >= (currentZone ? 2 : 1)) {
      currentZone = zone.name;
      _pendingZone = null;
      _pendingCount = 0;
      if (usingSynth) {
        updateSynthZone(currentZone);
      } else if (zone.track) {
        crossfadeToTrack(zone.track, zone.name);
      } else {
        crossfadeTo(currentZone);
      }
    }
  } else {
    _pendingZone = null;
    _pendingCount = 0;
  }

  // If both channels are silent and we have a zone, start playing
  if (!usingSynth && !audioFailed && currentZone) {
    const a = channelA, b = channelB;
    if (a.paused && b.paused) {
      const restartZone = detectZone(camPos, allBodies);
      if (restartZone.track) {
        crossfadeToTrack(restartZone.track, restartZone.name);
      } else {
        crossfadeTo(currentZone);
      }
    }
  }
}


// ═══════════════════════════════════════════════════════════════
// Procedural Ambient Space Synth — "Music for Airports" in space
// Evolving chord progressions, arpeggiated harmonics, breathing
// dynamics. Each note is an event, not a sustained drone.
// ═══════════════════════════════════════════════════════════════

let AC, masterGain, reverbNode, dryGain, synthStarted = false;

function buildReverb(ac) {
  const len = ac.sampleRate * 10;
  const buf = ac.createBuffer(2, len, ac.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 1.8);
    }
  }
  const n = ac.createConvolver();
  n.buffer = buf;
  return n;
}

// ── Single note with envelope — the building block ──────────────
function playNote(freq, t, dur, vol, filterHz, wetMix) {
  const o1 = AC.createOscillator();
  const o2 = AC.createOscillator();
  const g = AC.createGain();
  const f = AC.createBiquadFilter();

  // Slight detune for warmth
  o1.type = 'sine';
  o2.type = 'triangle';
  o1.frequency.value = freq;
  o2.frequency.value = freq * 1.003;

  f.type = 'lowpass';
  f.frequency.value = filterHz || 800;
  f.Q.value = 0.5;

  // Musical envelope — swell in, sustain, fade out
  const atk = Math.min(3, dur * 0.25);
  const sus = dur * 0.4;
  const rel = dur - atk - sus;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + atk);
  g.gain.setValueAtTime(vol * 0.8, t + atk + sus);
  g.gain.linearRampToValueAtTime(0, t + dur);

  const mix = AC.createGain();
  mix.gain.value = 0.7;
  o1.connect(f);
  o2.connect(mix);
  mix.connect(f);
  f.connect(g);

  // Wet/dry routing
  const wet = wetMix !== undefined ? wetMix : 0.6;
  const dryG = AC.createGain();
  const wetG = AC.createGain();
  dryG.gain.value = 1 - wet;
  wetG.gain.value = wet;
  g.connect(dryG); dryG.connect(dryGain);
  g.connect(wetG); wetG.connect(reverbNode);

  o1.start(t); o1.stop(t + dur + 0.1);
  o2.start(t); o2.stop(t + dur + 0.1);
}

// ── Chord progressions — emotional harmonic movement ────────────
// Each progression is a sequence of chords (arrays of frequencies).
// Chords use open voicings with octave spread for spaciousness.

const PROGRESSIONS = {
  // Am → F → C → G (i → VI → III → VII) — melancholic, vast
  deep: [
    [55, 110, 165, 330, 440],       // Am (A2, A3, E4, E5, A5)
    [43.65, 87.3, 130.8, 262, 349], // F  (F2, F3, C4, C5, F5)
    [65.41, 130.8, 196, 330, 392],  // C  (C2, C3, G3, E5, G5)
    [49, 98, 147, 294, 392],        // G  (G2, G3, D4, D5, G5)
  ],
  // Dm → Bb → Gm → A (warm, close)
  inner: [
    [73.42, 146.8, 220, 440, 587],  // D  (D2, D3, A3, A4, D5)
    [58.27, 116.5, 174.6, 349, 466],// Bb (Bb2, Bb3, F3, F4, Bb4)
    [49, 98, 147, 233, 392],        // Gm (G2, G3, D3, Bb3, G4)
    [55, 110, 165, 277, 440],       // A  (A2, A3, E3, Db4, A4)
  ],
  // Em → Cmaj7 → Am7 → Fmaj7 (ethereal, floating)
  giants: [
    [41.2, 82.4, 123.5, 247, 330],  // Em  (E2, E3, B3, B4, E5)
    [65.41, 130.8, 196, 247, 494],  // Cmaj7
    [55, 110, 165, 262, 392],       // Am7
    [43.65, 87.3, 131, 220, 330],   // Fmaj7
  ],
  // Low, ominous — fifths and minor seconds
  blackhole: [
    [27.5, 55, 82.4, 110, 164.8],
    [29.14, 58.27, 87.3, 116.5, 174.6],
    [25.96, 51.91, 77.8, 103.8, 155.6],
    [30.87, 61.74, 92.5, 123.5, 185],
  ],
  // Sun — major, bright, warm
  sun: [
    [65.41, 130.8, 196, 330, 523],  // C
    [73.42, 146.8, 220, 370, 587],  // D
    [55, 110, 165, 277, 440],       // Am
    [49, 98, 147, 247, 392],        // G
  ],
  // Nebula — suspended, unresolved, mysterious
  nebula: [
    [55, 110, 147, 220, 330],       // Asus4
    [49, 98, 131, 196, 294],        // Gsus4
    [43.65, 87.3, 117, 175, 262],   // Fsus4
    [41.2, 82.4, 110, 165, 247],    // Esus4
  ],
  // Galaxies — grand, slow, resolved: maj7/9 voicings, wide
  galaxy: [
    [41.2, 82.4, 123.5, 208, 311],  // Emaj7-ish
    [55, 110, 165, 262, 415],       // Amaj9-ish
    [36.7, 73.4, 110, 185, 277],    // Dmaj7-ish
    [49, 98, 147, 247, 370],        // Gmaj7-ish
  ],
};

// Every place plays the family progression in its OWN key — a landmark
// name hashes to a transposition, so the Crab and the Carina share a
// harmonic language but never a root.
const LM_MAP = [
  [/MAGNETAR|BLACK HOLE|SAGITTARIUS/, 'blackhole'],
  [/ANDROMEDA|SOMBRERO|MILKY/, 'galaxy'],
  [/UY SCUTI|ETA CARINAE/, 'sun'],
  [/PILLARS|CRAB|CARINA|HORSEHEAD|RING|NEBULA/, 'nebula'],
  [/BOOTES/, 'deep'],
];
let synthTranspose = 1;
let synthSilent = false;

function synthKeyFor(name) {
  if (!name) return 'deep';
  if (PROGRESSIONS[name]) return name;
  const n = name.toUpperCase();
  for (const [re, k] of LM_MAP) if (re.test(n)) return k;
  return 'deep';
}

function transposeFor(name) {
  let h = 0;
  for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  const semis = ((h % 7) + 7) % 7 - 3;   // -3..+3
  return Math.pow(2, semis / 12);
}

const CHORD_DUR = 18;     // seconds per chord
const ARPEG_INTERVAL = 3; // seconds between arpeggiated notes
let schedAhead = 0;
let synthZone = 'deep';
let chordIndex = 0;

function schedMusic(from, chordCount) {
  if (synthSilent) return;
  const prog = PROGRESSIONS[synthZone] || PROGRESSIONS.deep;

  for (let c = 0; c < chordCount; c++) {
    const ci = (chordIndex + c) % prog.length;
    const chord = prog[ci];
    const chordStart = from + c * CHORD_DUR;

    // Play each note of the chord as a staggered arpeggio
    for (let n = 0; n < chord.length; n++) {
      const freq = chord[n] * synthTranspose;
      const noteTime = chordStart + n * ARPEG_INTERVAL;
      const noteDur = CHORD_DUR - n * ARPEG_INTERVAL + 4; // overlap into next chord
      const isLow = freq < 100;
      const isHigh = freq > 300;

      // Low notes: quieter, more filtered, mostly dry
      // High notes: louder relative, open filter, mostly wet (reverb)
      const vol = isLow ? 0.04 : isHigh ? 0.03 : 0.035;
      const filt = isLow ? 300 : isHigh ? 2000 : 800;
      const wet = isLow ? 0.3 : isHigh ? 0.9 : 0.6;

      playNote(freq, noteTime, Math.min(noteDur, 20), vol, filt, wet);
    }

    // Occasional high harmonic — a single note ringing out alone
    if (Math.random() > 0.4) {
      const harmonic = chord[chord.length - 1] * 2 * synthTranspose; // octave above highest
      const hTime = chordStart + 6 + Math.random() * 8;
      playNote(harmonic, hTime, 12, 0.015, 3000, 0.95);
    }
  }

  chordIndex = (chordIndex + chordCount) % prog.length;
}

function startSynth() {
  AC = new (window.AudioContext || window.webkitAudioContext)();
  masterGain = AC.createGain();
  masterGain.gain.value = effVol();
  reverbNode = buildReverb(AC);
  dryGain = AC.createGain();
  dryGain.gain.value = 0.4;
  const rv = AC.createGain();
  rv.gain.value = 0.8;
  reverbNode.connect(rv);
  rv.connect(masterGain);
  dryGain.connect(masterGain);
  masterGain.connect(AC.destination);
  schedAhead = AC.currentTime;
  schedMusic(schedAhead, 2);
  schedAhead += 2 * CHORD_DUR;
  synthStarted = true;
}

// Refill buffer periodically
setInterval(() => {
  if (!AC || !synthStarted || paused || !musicWanted) return;
  // Short horizon: a zone crossed mid-piece takes over within a chord
  if (AC.currentTime + 22 > schedAhead) {
    schedMusic(Math.max(schedAhead, AC.currentTime + 0.5), 2);
    schedAhead = Math.max(schedAhead, AC.currentTime + 0.5) + 2 * CHORD_DUR;
  }
}, 6000);

function updateSynthZone(zone) {
  if (!zone) return;
  // On the ground the place is the music — the improviser rests.
  synthSilent = zone === 'ground-mars';
  const key = synthKeyFor(zone);
  const tr = PROGRESSIONS[zone] ? 1 : transposeFor(zone);
  if (key !== synthZone || tr !== synthTranspose) {
    synthZone = key;
    synthTranspose = tr;
    chordIndex = 0;
  }
}

function activateSynthFallback() {
  audioFailed = true;
  usingSynth  = true;

  // Stop any HTML5 audio
  clearFades();
  if (channelA) { channelA.pause(); channelA.src = ''; }
  if (channelB) { channelB.pause(); channelB.src = ''; }

  startSynth();

  if (trackLbl) trackLbl.textContent = 'Ambient';
  console.log('[music] Using procedural ambient synth.');
}
