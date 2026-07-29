// voice.js — SOLACE's voice: TTS played through the ship's intercom.
//
// The worker's /api/voice returns audio (Gemini TTS when the key
// exists, Workers AI otherwise); the wire timbre is made HERE — a
// bandpass with a presence peak and gentle tanh saturation, the sound
// of a calm voice over cabin wiring. While Sol speaks: the music ducks
// under it, and the voiceprint trace is driven by the REAL audio level
// (companion-mark.setVoiceLevel) — the line on the glass is the actual
// waveform of what you hear.
//
// Contract: prepareVoice(text) resolves to { play(): duration,
// cancel() } or null (voice unavailable — the teletype speaks alone;
// silence is never an error the traveler sees).

import { setVoiceLevel } from './companion-mark.js';
import { setVoiceDuck } from './music.js';

let AC = null;
let chainIn = null;
let analyser = null;
let activeSource = null;
let levelTimer = null;

// TTS synthesis genuinely takes 3-6s — an impatient abort here reads
// as "voice randomly missing" (and the first cut at 3.5s did exactly
// that). The blinking cursor carries the wait; a breath, not a lag.
const PREP_TIMEOUT_MS = 9000;

function ensureContext() {
  if (!AC) {
    try {
      AC = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      return false;
    }
    // The intercom: high-pass and low-pass shoulders, a presence peak
    // that adds the faint metal, and soft saturation for the wire.
    const hp = AC.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 185; hp.Q.value = 0.8;
    const lp = AC.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 3400; lp.Q.value = 0.9;
    const peak = AC.createBiquadFilter();
    peak.type = 'peaking'; peak.frequency.value = 1700; peak.Q.value = 1.1; peak.gain.value = 3.5;
    const shaper = AC.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = i / 127.5 - 1;
      curve[i] = Math.tanh(x * 1.6) / Math.tanh(1.6);
    }
    shaper.curve = curve;
    const out = AC.createGain();
    out.gain.value = 0.92;
    analyser = AC.createAnalyser();
    analyser.fftSize = 512;
    hp.connect(lp); lp.connect(peak); peak.connect(shaper);
    shaper.connect(out); out.connect(analyser); analyser.connect(AC.destination);
    chainIn = hp;
  }
  if (AC.state === 'suspended') AC.resume().catch(() => {});
  return true;
}

function decodePcm24k(b64) {
  const bin = atob(b64);
  const n = Math.floor(bin.length / 2);
  const buf = AC.createBuffer(1, n, 24000);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < n; i++) {
    let v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
    if (v >= 32768) v -= 65536;
    ch[i] = v / 32768;
  }
  return buf;
}

function b64ToArrayBuffer(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function stopActive() {
  if (activeSource) {
    try { activeSource.stop(); } catch (e) { /* already ended */ }
    activeSource = null;
  }
  if (levelTimer) { clearInterval(levelTimer); levelTimer = null; }
  setVoiceLevel(-1);
  setVoiceDuck(0);
}

const _levelBuf = new Uint8Array(512);
function meterLoop() {
  if (!analyser) return;
  analyser.getByteTimeDomainData(_levelBuf);
  let sum = 0;
  for (let i = 0; i < _levelBuf.length; i++) {
    const d = (_levelBuf[i] - 128) / 128;
    sum += d * d;
  }
  const rms = Math.sqrt(sum / _levelBuf.length);
  setVoiceLevel(Math.min(1, rms * 3.2));
}

/**
 * Fetch and decode a line of Sol's voice. Resolves null on any failure
 * or timeout — the caller lets the teletype speak alone.
 */
export async function prepareVoice(text) {
  if (!text || text.length > 300) return null;
  if (!ensureContext()) return null;
  // Autoplay-blocked context: no voice until the traveler has touched
  // something. The text carries the line; the voice joins next time.
  if (AC.state !== 'running') return null;

  let data = null;
  try {
    const ctl = new AbortController();
    const timeout = setTimeout(() => ctl.abort(), PREP_TIMEOUT_MS);
    const res = await fetch('/api/voice', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: ctl.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    data = await res.json();
  } catch (e) {
    return null;
  }
  if (!data || !data.audio) return null;

  let buffer = null;
  try {
    if (data.format === 'pcm24k') {
      buffer = decodePcm24k(data.audio);
    } else {
      buffer = await AC.decodeAudioData(b64ToArrayBuffer(data.audio));
    }
  } catch (e) {
    return null;
  }
  if (!buffer || !buffer.duration) return null;

  return {
    play() {
      stopActive();
      const src = AC.createBufferSource();
      src.buffer = buffer;
      // A shade lower: ~a semitone down. The model is directed to an
      // easy pace, so the slight slowing here still nets out quicker
      // than the original delivery — deeper AND brisker.
      src.playbackRate.value = 0.94;
      src.connect(chainIn);
      src.onended = () => { if (activeSource === src) stopActive(); };
      activeSource = src;
      setVoiceDuck(1);
      levelTimer = setInterval(meterLoop, 55);
      src.start();
      return buffer.duration / 0.94;
    },
    cancel() { /* never played — nothing to release */ },
  };
}

/** Cut any speech short (the traveler moved on). */
export function hushVoice() { stopActive(); }
