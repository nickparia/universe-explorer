// shipchat.js — SOLACE, the ship computer.
//
// A constant quiet presence in the lower right: the companion mark —
// seven breathing filaments (companion-mark.js) — sleeps dormant in
// transit, wakes when you arrive somewhere, scans while it thinks, and
// moves with a speech envelope while it speaks. Its words surface beside it and
// drift upward, dimming with age like breath on cold glass (hover the
// words to read them back at full strength; the log scrolls). Answers
// come from the Worker's /api/ask endpoint, with the location's catalog
// entry and the session's recent exchanges sent along — SOLACE
// remembers the conversation, not just the last question. Diegetic by
// design — it's the ship talking, not a widget.

import { on } from './bus.js';
import { getLocation } from './catalog.js';
import { getPlanetConfig } from './planetconfig.js';
import { getVisited } from './session.js';
import { initCompanionMark, setCompanionState } from './companion-mark.js';
import { prepareVoice, hushVoice } from './voice.js';

// The spoken voice is OFF (user call): synthesis latency (3-6s) opened
// a gap between asking and hearing that broke the teletype's
// immediacy. The whole machinery — voice.js intercom, /api/voice,
// live-level trace — stays dormant, ready for the day TTS can stream.
const VOICE_ENABLED = false;
import { musicCommand, getNowPlaying } from './music.js';
import { crewHeaders, getCrewName, isSignedOn, signOff, pushCrewState } from './crew.js';
import { openSignonTerminal } from './signon.js';

let wrap = null;
let log = null;
let input = null;
let currentLocation = null;
let busy = false;
let stream = null; // active teletype: { textNode, cursor, full, i, timer, lingerTimer }

// The ship's typeface — phosphor teletype, MOTHER's chamber. All of
// SOLACE's words arrive character by character behind a block cursor.
const MONO = "'SF Mono','Cascadia Mono','JetBrains Mono',Menlo,Consolas,'Courier New',monospace";

// Session conversation, kept across orbits (the transcript on screen is
// per-place; the memory of it is not).
const history = [];
const HISTORY_SENT = 12;   // most recent turns forwarded with each ask
const HISTORY_KEPT = 40;

// The ship's log — SOLACE's long-term memory of THIS traveler. It lives
// only in the traveler's own browser; the worker rewrites it on request
// (/api/reflect) but never stores it. Sent with every ask so answers can
// draw on past voyages.
const NOTES_KEY = 'solace_traveler_notes_v1';
let notes = '';
try { notes = localStorage.getItem(NOTES_KEY) || ''; } catch (e) { /* private mode */ }
let exchangesSinceReflect = 0;
let reflectTimer = null;
let reflecting = false;
const REFLECT_EVERY = 8;     // exchanges between forced reflections
const REFLECT_QUIET_MS = 90000; // a lull in conversation → distill it

const HALO = 'text-shadow:0 1px 4px rgba(0,0,0,0.95),0 0 10px rgba(0,0,0,0.6);';

// The bond signals — how long Sol has known this traveler and how many
// worlds they have seen together (companion.js's place log; read fresh
// each time, importing companion here would be a cycle). The worker
// turns these into the arc register — see docs/SOL.md.
function bondSignals() {
  try {
    const log = JSON.parse(localStorage.getItem('solace_placelog_v1') || '{}');
    const ts = Object.values(log).filter((v) => typeof v === 'number');
    return { worlds: ts.length, met: ts.length ? Math.min(...ts) : 0 };
  } catch (e) {
    return { worlds: 0, met: 0 };
  }
}

export function initShipChat() {
  // Always present — the mark is the companion's body, not an orbit
  // widget. It sleeps (dormant) in transit and wakes when you arrive.
  wrap = document.createElement('div');
  wrap.id = 'ship-chat';
  wrap.style.cssText =
    'position:fixed;right:24px;bottom:64px;width:320px;z-index:60;' +
    "font-family:'Segoe UI','Helvetica Neue',Arial,sans-serif;font-weight:300;";
  // The scene's picker listens on window — swallow pointer events here so
  // clicking the mark (or the words) never also selects whatever object
  // happens to drift beneath the chat.
  for (const ev of ['mousedown', 'mouseup', 'click', 'dblclick']) {
    wrap.addEventListener(ev, (e) => e.stopPropagation());
  }

  // No panel, no glass — the words float on the void itself (a scrim
  // killed the immersion). Legibility over bright cores comes from the
  // phosphor bloom plus a hard dark halo on every character.
  const style = document.createElement('style');
  style.textContent =
    // Sol's voiceprint is always on the glass — a quiet resting line
    // with MOTHER's blinking prompt at its head, so a new traveler can
    // SEE the ship listening. It ripples to life when Sol thinks or
    // speaks; hovering warms the phosphor; clicking opens the line.
    '#ship-chat canvas{cursor:pointer;display:block;flex:none;' +
    'transition:filter 0.45s;}' +
    '#ship-chat canvas:hover{filter:brightness(1.5) ' +
    'drop-shadow(0 0 7px rgba(150,200,255,0.6)) drop-shadow(0 0 14px rgba(120,180,255,0.35));}' +
    // CRT raster on the glyphs themselves: a scanline mask carves thin
    // rows out of the letters and cursor — texture on the phosphor,
    // never a panel over the sky. A slow phosphor waver breathes the
    // whole block, an old tube holding its charge.
    '#ship-chat .sc-line,#ship-chat input,#ship-chat .sc-cursor{' +
    '-webkit-mask-image:repeating-linear-gradient(0deg,#000 0 2px,rgba(0,0,0,0.62) 2px 3px);' +
    'mask-image:repeating-linear-gradient(0deg,#000 0 2px,rgba(0,0,0,0.62) 2px 3px);}' +
    '#ship-chat{animation:sc-phosphor 7.3s ease-in-out infinite;}' +
    '@keyframes sc-phosphor{0%,100%{opacity:1;}38%{opacity:0.965;}61%{opacity:0.985;}72%{opacity:0.955;}}' +
    '#ship-chat .sc-log{scrollbar-width:thin;scrollbar-color:rgba(255,190,100,0.18) transparent;}' +
    '#ship-chat .sc-log::-webkit-scrollbar{width:4px;}' +
    '#ship-chat .sc-log::-webkit-scrollbar-track{background:transparent;}' +
    '#ship-chat .sc-log::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.18);border-radius:2px;}' +
    // Words surface near the mark, hold while they're read, then fade
    // from the glass entirely — spoken, not posted. Hovering the log
    // (or being at the line) keeps them lit for rereading.
    '#ship-chat .sc-line{transition:opacity 1.4s;animation:sc-rise 0.8s ease-out;}' +
    '#ship-chat .sc-log:hover .sc-line{opacity:1 !important;transition:opacity 0.6s !important;}' +
    '@keyframes sc-rise{from{opacity:0;transform:translateY(12px);}to{transform:translateY(0);}}' +
    '@keyframes sc-pulse{0%,100%{opacity:0.25;}50%{opacity:0.8;}}' +
    // The block cursor — steady teletype blink, phosphor bloom.
    '#ship-chat .sc-cursor{animation:sc-blink 1.06s steps(2,start) infinite;}' +
    '@keyframes sc-blink{0%{opacity:1;}50%{opacity:0;}100%{opacity:1;}}';
  document.head.appendChild(style);

  log = document.createElement('div');
  log.className = 'sc-log';
  // The top edge is feathered: a line scrolling out of view dissolves
  // like smoke instead of being cut mid-glyph at the container edge.
  log.style.cssText =
    'position:relative;display:flex;flex-direction:column;gap:10px;margin-bottom:10px;' +
    'max-height:280px;overflow-y:auto;overscroll-behavior:contain;padding-right:6px;' +
    'padding-top:34px;' +
    '-webkit-mask-image:linear-gradient(to bottom,transparent 0,#000 34px);' +
    'mask-image:linear-gradient(to bottom,transparent 0,#000 34px);';
  wrap.appendChild(log);

  // The bottom row: your line in, and the mark you're speaking to.
  const row = document.createElement('div');
  row.style.cssText = 'position:relative;display:flex;align-items:center;gap:12px;';

  // No labelled field — no fourth wall. The line is invisible until the
  // traveler addresses the ship (clicks the mark); then a blinking block
  // cursor wakes — the terminal is listening. Words go onto the glass,
  // Enter speaks them, Escape (or looking away) lets the line go dark.
  const inputWrap = document.createElement('div');
  inputWrap.style.cssText = 'position:relative;flex:1;min-width:0;';
  input = document.createElement('input');
  input.type = 'text';
  input.maxLength = 240;
  input.setAttribute('aria-label', 'speak to the ship');
  input.style.cssText =
    'width:100%;box-sizing:border-box;padding:7px 2px;' +
    'background:transparent;border:none;caret-color:transparent;' +
    'border-radius:0;outline:none;color:rgba(255,196,110,0.88);' +
    'font-size:10.5px;letter-spacing:2px;text-transform:uppercase;' +
    'font-family:' + MONO + ';font-weight:400;' + HALO;
  // The block cursor is ours, not the browser's: a phosphor slab that
  // rides the end of the typed text, blinking on the teletype beat.
  const inputCursor = document.createElement('span');
  inputCursor.className = 'sc-cursor';
  inputCursor.textContent = '█'; // full phosphor slab — MOTHER's prompt
  inputCursor.style.cssText =
    'position:absolute;top:50%;transform:translateY(-50%);left:2px;' +
    'pointer-events:none;color:rgba(255,200,110,0.95);' +
    'font-family:' + MONO + ';font-size:10.5px;' +
    'text-shadow:0 0 7px rgba(255,170,50,0.6),0 1px 4px rgba(0,0,0,0.95);';
  // Hidden twin used to measure where the typed text ends
  const measurer = document.createElement('span');
  measurer.style.cssText =
    'position:absolute;visibility:hidden;white-space:pre;' +
    'font-size:10.5px;letter-spacing:2px;text-transform:uppercase;' +
    'font-family:' + MONO + ';font-weight:400;';
  // The standing prompt: ALWAYS blinking on the traveler's own line —
  // the lowest row, nearest them — dimmed while at rest, full phosphor
  // once the line is open, riding the end of whatever they type.
  const placeCursor = () => {
    const open = document.activeElement === input;
    measurer.textContent = open ? input.value : '';
    inputCursor.style.opacity = open ? '1' : '0.45';
    inputCursor.style.left = (2 + measurer.offsetWidth) + 'px';
  };
  input.addEventListener('input', placeCursor);
  input.addEventListener('focus', placeCursor);
  input.addEventListener('blur', placeCursor);
  input.addEventListener('keydown', (e) => {
    e.stopPropagation(); // never fly the ship while typing
    if (e.key === 'Enter') { send(); placeCursor(); }
    if (e.key === 'Escape') input.blur();
  });
  inputWrap.appendChild(input);
  inputWrap.appendChild(inputCursor);
  inputWrap.appendChild(measurer);
  placeCursor(); // standing prompt visible from the first frame
  row.appendChild(inputWrap);

  // The voiceprint — Sol's visible form: a thin phosphor trace under
  // the words, resting quietly with the prompt blinking at its head,
  // rippling to life as the ship thinks and speaks. Rendering and
  // state animation live in companion-mark.js. Opening the line hands
  // the cursor down to the input; closing it hands the blink back.
  const mark = document.createElement('canvas');
  mark.style.cssText = 'width:100%;height:30px;margin:0 0 2px;';
  initCompanionMark(mark);
  // Addressing the ship: click the trace, the line opens.
  mark.addEventListener('click', () => input.focus());
  // Or simply press Enter — the terminal convention that needs no
  // explaining. Fishing for an invisible field in the dark was the
  // only awkward act aboard. (The sign-on terminal captures its own
  // keys before this; typing in any field is left alone.)
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const el = document.activeElement;
    if (el === input || (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'))) return;
    e.preventDefault();
    input.focus();
  });

  wrap.appendChild(mark);
  wrap.appendChild(row);
  document.body.appendChild(wrap);

  // The glass clears itself: spoken lines hold while they're read, then
  // dissolve. Attention (hovering the log, or being at the line) keeps
  // them lit and postpones the fade.
  setInterval(() => {
    const now = performance.now();
    const attending = log.matches(':hover') || document.activeElement === input;
    for (const line of [...log.children]) {
      if (!line._fadeAt || line._fadeAt === Infinity) continue;
      if (attending) {
        line._fadeAt = Math.max(line._fadeAt, now + 5000);
        if (line._fading) {
          line._fading = false;
          line.style.transition = '';
          applyAgeFade();
        }
        continue;
      }
      if (!line._fading && now >= line._fadeAt) {
        line._fading = true;
        line.style.transition = 'opacity 3.2s ease';
        line.style.opacity = '0';
        line._goneAt = now + 3600;
      } else if (line._fading && now >= line._goneAt) {
        line.remove();
      }
    }
  }, 1000);

  on('orbit:enter', ({ name }) => {
    currentLocation = name;
    setCompanionState('idle'); // dormant → idle: the ship wakes as you arrive
  });
  on('orbit:exit', () => {
    currentLocation = null;
    input.blur();
    stopSpeaking();
    setCompanionState('dormant');
    log.innerHTML = '';
  });
}

// Older words recede: full strength at the bottom near the mark, dimming
// as they drift up, never quite gone.
function applyAgeFade() {
  const n = log.children.length;
  for (let i = 0; i < n; i++) {
    if (log.children[i]._fading) continue; // mid-dissolve — leave it be
    const age = n - 1 - i;
    log.children[i].style.opacity = String(Math.max(0.4, 1 - age * 0.09));
  }
}

// How long a line stays lit once fully spoken: enough to read it calmly
// Spoken, not posted: long enough to read once, then off the glass.
function readingHold(text) {
  return Math.min(11000, 2500 + text.length * 42);
}

function addLine(text, who) {
  // Capture scroll intent BEFORE appending: if the traveler has scrolled
  // up to reread, a new line must not yank them back down.
  const nearBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 40;
  const line = document.createElement('div');
  line.className = 'sc-line';
  // Terminal register for both voices — MOTHER's chamber. Your lines
  // are dim console echo; the ship's are phosphor, bloomed like a CRT.
  line.style.cssText =
    'font-size:10.5px;letter-spacing:1.8px;line-height:2.0;flex:none;' +
    'white-space:pre-wrap;overflow-wrap:break-word;text-transform:uppercase;' +
    'font-family:' + MONO + ';font-weight:400;' +
    (who === 'you'
      ? 'color:rgba(220,180,120,0.5);' + HALO
      : 'color:rgba(255,206,120,0.95);' +
        'text-shadow:0 0 7px rgba(255,170,50,0.55),0 0 18px rgba(255,140,30,0.22),0 1px 4px rgba(0,0,0,0.95);');
  line.textContent = who === 'you' ? '> ' + text : text;
  line._fadeAt = performance.now() + 9000; // streamed lines override this
  log.appendChild(line);
  while (log.children.length > HISTORY_KEPT) log.removeChild(log.firstChild);
  applyAgeFade();
  if (nearBottom) log.scrollTop = log.scrollHeight;
  return line;
}

// SOLACE's words arrive character by character behind a blinking block
// cursor — teletype from the Nostromo's mother chamber. The mark holds
// its speech envelope for as long as the printout runs; the cursor
// lingers a moment after the last character, then goes dark.
function streamInto(line, text, paceMs) {
  cancelStream();
  line.textContent = '';
  line.style.animation = 'none'; // already risen as the pending line
  const textNode = document.createTextNode('');
  const cursor = document.createElement('span');
  cursor.className = 'sc-cursor';
  cursor.textContent = '▎'; // ▎ slim block — phosphor cursor
  line.appendChild(textNode);
  line.appendChild(cursor);
  setCompanionState('speaking');
  line._fadeAt = Infinity; // never fade mid-printout
  stream = { line, textNode, cursor, full: text, i: 0, timer: null, lingerTimer: null };
  stream.timer = setInterval(() => {
    // Slightly irregular cadence — a printout, not a CSS animation
    stream.i = Math.min(text.length, stream.i + (Math.random() < 0.22 ? 2 : 1));
    textNode.data = text.slice(0, stream.i);
    const nearBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 60;
    if (nearBottom) log.scrollTop = log.scrollHeight;
    if (stream.i >= text.length) {
      clearInterval(stream.timer);
      stream.timer = null;
      line._fadeAt = performance.now() + 1600 + readingHold(text);
      // The cursor blinks once or twice more, then the line is just text
      stream.lingerTimer = setTimeout(() => stopSpeaking(), 1600);
    }
  }, paceMs || 30); // ~35 chars/s, or paced to the spoken line
}

/** Teletype pace matched to a spoken duration so print and voice end
 * near-together — clamped so text never crawls nor teleports. */
function paceFor(durationS, text) {
  if (!durationS) return undefined;
  return Math.max(22, Math.min(72, (durationS * 1000) / Math.max(1, text.length)));
}

/** What the voice actually says: the printed line minus the traveler's
 * name — TTS mangles names, and a mispronounced name is worse than an
 * unspoken one. The glass keeps the name; the voice keeps its dignity. */
function spokenText(text) {
  const name = getCrewName();
  if (!name) return text;
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text
    .replace(new RegExp('[,;—–-]?\\s*\\b' + esc + '\\b\\s*([,;])?', 'gi'), '$1 ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.!?,;])/g, '$1')
    .replace(/^[,;]\s*/, '')
    .trim();
}

// Complete any active printout instantly (full text stays on the glass).
function cancelStream() {
  if (!stream) return;
  if (stream.timer) clearInterval(stream.timer);
  if (stream.lingerTimer) clearTimeout(stream.lingerTimer);
  stream.textNode.data = stream.full;
  if (stream.line._fadeAt === Infinity) {
    stream.line._fadeAt = performance.now() + readingHold(stream.full);
  }
  stream.cursor.remove();
  stream = null;
}

function stopSpeaking() {
  cancelStream();
  // Back to whichever resting state fits: listening if still in orbit,
  // asleep if the traveler has already left.
  setCompanionState(currentLocation ? 'idle' : 'dormant');
}

/**
 * SOLACE speaks first — a short line from the companion's own behavior
 * (companion.js), printed in the same teletype voice as its answers.
 * Refused (returns false) while a conversation exchange is in flight,
 * so the companion never talks over itself.
 */
export function companionSay(text) {
  if (busy || stream) return false;
  const line = addLine('', 'solace');
  if (!VOICE_ENABLED) {
    streamInto(line, text);
    return true;
  }
  line._fadeAt = Infinity;
  // The voice warms up first (a breath, not a lag) — print and audio
  // then begin together, paced to end together. If the voice is
  // unavailable the teletype simply speaks alone.
  line.textContent = '▎';
  line.style.animation = 'sc-blink 1.06s steps(2,start) infinite';
  (async () => {
    const v = await prepareVoice(spokenText(text));
    line.style.animation = '';
    if (!line.isConnected) { if (v) v.cancel(); return; }
    if (busy || stream) {
      // Something else took the glass while the voice warmed — the
      // line lands as plain text, already true, no voice over it.
      if (v) v.cancel();
      line.textContent = text;
      line._fadeAt = performance.now() + readingHold(text);
      return;
    }
    const dur = v ? v.play() : 0;
    streamInto(line, text, paceFor(dur, text));
  })();
  return true;
}

/** The ship's log on the traveler — read-only, for the companion's murmurs. */
export function getTravelerNotes() {
  return notes;
}

// A crew record opening hands SOLACE its memory of this traveler. The
// registry's copy wins when it has one; otherwise whatever this machine
// remembers boards with them (first sign-on adopts the guest log).
on('crew:signed-on', ({ notes: serverNotes }) => {
  if (serverNotes && serverNotes.trim()) {
    notes = serverNotes;
    try { localStorage.setItem(NOTES_KEY, notes); } catch (e) { /* full/private */ }
  } else if (notes.trim()) {
    pushCrewState({ notes });
  }
});
on('crew:signed-off', () => {
  // The record keeps the memory; this ship forgets the traveler.
  notes = '';
  try { localStorage.removeItem(NOTES_KEY); } catch (e) { /* fine */ }
});

// After a conversation settles (or every few exchanges), SOLACE rewrites
// its log on the traveler. Failures are silent — memory is a grace, not
// a feature the traveler should ever see erroring.
async function reflect() {
  if (reflecting || exchangesSinceReflect === 0) return;
  reflecting = true;
  const pending = exchangesSinceReflect;
  try {
    const res = await fetch('/api/reflect', {
      method: 'POST',
      // Signed-on crew: the worker persists the rewritten log into the
      // crew record as it reflects — one round trip, memory that travels.
      headers: { 'content-type': 'application/json', ...crewHeaders() },
      body: JSON.stringify({ notes, transcript: history.slice(-16) }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.notes) {
        notes = data.notes;
        try { localStorage.setItem(NOTES_KEY, notes); } catch (e) { /* full/private */ }
        exchangesSinceReflect = Math.max(0, exchangesSinceReflect - pending);
      }
    }
  } catch (e) { /* offline — the log keeps its last shape */ }
  reflecting = false;
}

function scheduleReflect() {
  exchangesSinceReflect++;
  if (reflectTimer) clearTimeout(reflectTimer);
  if (exchangesSinceReflect >= REFLECT_EVERY) {
    reflect();
  } else {
    reflectTimer = setTimeout(reflect, REFLECT_QUIET_MS);
  }
}

function buildContext(name) {
  const loc = getLocation(name);
  const cfg = getPlanetConfig(name);
  const info = (loc && loc.info) || (cfg && cfg.info) || {};
  const parts = [];
  if (loc && loc.desc) parts.push(loc.desc);
  if (info.type) parts.push('Type: ' + info.type);
  if (info.facts) parts.push('Facts: ' + info.facts.join('; '));
  if (info.lore) parts.push(info.lore);
  const visited = [...getVisited()];
  if (visited.length) parts.push('Voyage log — places this traveler has orbited: ' + visited.join(', '));
  return parts.join('\n').slice(0, 1500);
}

async function send() {
  const q = input.value.trim();
  if (!q || busy) return;
  // Registry intents are handled by the ship's OS, not the brain: the
  // traveler asks SOLACE to sign them on (or off) in plain words.
  if (/^sign[ -]?on$|^log[ -]?in$/i.test(q)) {
    input.value = '';
    if (isSignedOn()) { companionSay('the record is already open, ' + getCrewName() + '.'); return; }
    openSignonTerminal();
    return;
  }
  if (/^sign[ -]?off$|^log[ -]?out$/i.test(q)) {
    input.value = '';
    if (isSignedOn()) {
      const name = getCrewName();
      signOff();
      companionSay('record closed. this ship will keep its silence, ' + name + '.');
    } else {
      companionSay('no record is open aboard.');
    }
    return;
  }
  // Music intents: the library is Sol's own — the code moves the
  // needle, then the question flows to the brain WITH a note of what
  // was just done, so the acknowledgment comes in Sol's real voice.
  let acted = '';
  {
    const s = q.toLowerCase();
    const wantsPlay = /^(play|put on)\b/.test(s) ||
      (/\bmusic\b/.test(s) && /\b(play|some|put|start|on|score|little)\b/.test(s)) ||
      /^music( please)?$/.test(s);
    const wantsStop = (/\b(stop|pause|off|enough|silence|kill|no more)\b/.test(s) && /\bmusic\b/.test(s)) ||
      /^stop the music$/.test(s);
    if (wantsStop) {
      acted = musicCommand('stop') || '';
    } else if (/\b(quieter|softer|turn (it|the music) down|lower the (music|volume))\b/.test(s)) {
      acted = musicCommand('quieter') || '';
    } else if (/\b(louder|turn (it|the music) up)\b/.test(s)) {
      acted = musicCommand('louder') || '';
    } else if (wantsPlay) {
      const hint = s.replace(/^(play|put on)\b/, '')
        .replace(/\b(music|some|something|the|a|please|for me|would you|now)\b/g, '')
        .trim();
      acted = musicCommand('play', hint.length >= 3 ? hint : null) || '';
    } else if (/\bwhat('s| is) (this|playing|the music)\b/.test(s)) {
      const nowP = getNowPlaying();
      acted = nowP ? 'the cabin speakers are currently playing "' + nowP + '"' : 'no music is playing just now';
    }
  }

  // The ship listens everywhere — in orbit it knows the place beneath
  // you; adrift between places it simply knows you're in transit.
  const locName = currentLocation || 'deep space, between destinations';
  input.value = '';
  busy = true;
  cancelStream(); // a question interrupts any murmur mid-printout
  hushVoice();    // …and cuts its voice, mid-word if need be
  setCompanionState('thinking');
  addLine(q, 'you');
  // While the ship thinks, the line is just a cursor, blinking
  const pending = addLine('▎', 'solace');
  pending._fadeAt = Infinity; // holds however long the thinking takes
  pending.style.animation = 'sc-blink 1.06s steps(2,start) infinite';

  const past = history.slice(-HISTORY_SENT);
  history.push({ role: 'user', content: q });
  while (history.length > HISTORY_KEPT) history.shift();

  try {
    const res = await fetch('/api/ask', {
      method: 'POST',
      // Signed-on crew are known by their record, not client hints —
      // bond, counts, and the season's pending beat ride the token.
      headers: { 'content-type': 'application/json', ...crewHeaders() },
      body: JSON.stringify({
        location: locName,
        question: q,
        context: buildContext(currentLocation),
        history: past,
        notes: notes.slice(0, 4000),
        crew: getCrewName() || '',
        acted,
        ...bondSignals(),
      }),
    });
    const data = await res.json();
    if (res.ok && data.answer) {
      const answer = data.answer.trim();
      history.push({ role: 'assistant', content: answer });
      pending.style.animation = '';
      if (!VOICE_ENABLED) {
        streamInto(pending, answer);
      } else {
        // The traveler is waiting on an ANSWER: give the voice a few
        // seconds to warm so print and speech start together, but never
        // hold the words hostage — past the grace, the teletype goes
        // ahead and the voice joins mid-print when it lands.
        const prep = prepareVoice(spokenText(answer));
        const v = await Promise.race([prep, new Promise((r) => setTimeout(() => r('slow'), 6000))]);
        if (v === 'slow') {
          streamInto(pending, answer);
          prep.then((late) => {
            if (late && stream && stream.line === pending) late.play();
          });
        } else {
          const dur = v ? v.play() : 0;
          streamInto(pending, answer, paceFor(dur, answer));
        }
      }
      scheduleReflect();
    } else {
      pending.style.animation = '';
      pending.textContent = 'the ship computer is quiet. try again in a moment.';
      pending._fadeAt = performance.now() + 12000;
      setCompanionState(currentLocation ? 'idle' : 'dormant');
    }
  } catch (e) {
    pending.style.animation = '';
    pending.textContent = 'the ship computer is offline out here.';
    pending._fadeAt = performance.now() + 12000;
    setCompanionState(currentLocation ? 'idle' : 'dormant');
  }
  busy = false;
}
