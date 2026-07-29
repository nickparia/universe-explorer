// signon.js — the crew sign-on terminal.
//
// A dark screen and a patient prompt, the way a ship's operating system
// asked for you in 1979. Fully diegetic: no buttons, no form chrome —
// IDENTIFY, ACCESS CODE, and the registry answers. First boot offers it
// once; ESC boards you unregistered and it never insists again. The
// traveler can always summon it later by telling SOLACE "sign on".
//
// Terminal text is the ship's OS voice — flat, procedural, upper case.
// SOLACE's own voice (murmurs, chat) stays elsewhere.

import { emit } from './bus.js';
import { adoptSignon, isSignedOn } from './crew.js';

const SEEN_KEY = 'solace_signon_seen_v1';
// Same key shipchat.js uses — a guest's existing local log is adopted
// into a newly opened crew record, so signing on never loses a memory.
const NOTES_KEY = 'solace_traveler_notes_v1';

const MONO = "'SF Mono','Cascadia Mono','JetBrains Mono',Menlo,Consolas,'Courier New',monospace";

let overlay = null;
let screen = null;
let active = false;
let state = null;     // 'name' | 'code' | 'confirm' | 'busy' | 'closing'
let buffer = '';
let crewNameEntry = '';
let codeEntry = '';
let inputLine = null; // the line currently receiving keystrokes
let cursorEl = null;

function el(tag, css) {
  const e = document.createElement(tag);
  if (css) e.style.cssText = css;
  return e;
}

function buildOverlay() {
  overlay = el('div',
    'position:fixed;inset:0;z-index:410;background:#020407;' +
    'display:flex;align-items:center;justify-content:center;' +
    'opacity:0;transition:opacity 0.9s ease;');
  // Faint scanlines — the tube, not a texture pack
  const lines = el('div',
    'position:absolute;inset:0;pointer-events:none;opacity:0.5;' +
    'background:repeating-linear-gradient(0deg,rgba(0,0,0,0) 0 2px,rgba(120,170,255,0.022) 2px 4px);');
  overlay.appendChild(lines);
  const vignette = el('div',
    'position:absolute;inset:0;pointer-events:none;' +
    'background:radial-gradient(ellipse at center,rgba(0,0,0,0) 55%,rgba(0,0,0,0.5) 100%);');
  overlay.appendChild(vignette);

  screen = el('div',
    'width:min(560px,84vw);font-family:' + MONO + ';font-size:14px;' +
    'letter-spacing:2px;line-height:2.2;color:rgba(190,215,255,0.92);' +
    'text-shadow:0 0 6px rgba(130,180,255,0.55),0 0 18px rgba(90,140,255,0.22);' +
    'text-transform:uppercase;white-space:pre-wrap;');
  overlay.appendChild(screen);

  const hint = el('div',
    'position:absolute;bottom:7vh;left:50%;transform:translateX(-50%);' +
    'font-family:' + MONO + ';font-size:11px;letter-spacing:3px;' +
    'color:rgba(150,180,230,0.34);text-transform:uppercase;');
  hint.textContent = 'esc · board unregistered';
  overlay.appendChild(hint);

  document.body.appendChild(overlay);
  requestAnimationFrame(() => { overlay.style.opacity = '1'; });
}

function newCursor() {
  const c = el('span', 'display:inline-block;width:0.62em;height:1.15em;' +
    'vertical-align:text-bottom;background:rgba(190,215,255,0.85);' +
    'animation:solace-cursor 1.1s steps(1) infinite;');
  return c;
}

// One shared keyframe for the block cursor blink
if (typeof document !== 'undefined' && !document.getElementById('signon-style')) {
  const st = document.createElement('style');
  st.id = 'signon-style';
  st.textContent = '@keyframes solace-cursor{0%,55%{opacity:1}56%,100%{opacity:0}}';
  document.head.appendChild(st);
}

/** Teletype a line onto the screen, then resolve. */
function print(text, { pace = 13, pause = 120 } = {}) {
  return new Promise((resolve) => {
    const line = el('div');
    screen.appendChild(line);
    const cur = newCursor();
    line.appendChild(cur);
    let i = 0;
    const tick = () => {
      if (!overlay) return; // dismissed mid-print
      if (i < text.length) {
        cur.before(document.createTextNode(text[i++]));
        setTimeout(tick, pace);
      } else {
        cur.remove();
        setTimeout(resolve, pause);
      }
    };
    tick();
  });
}

/** Open a prompt line: teletype the label, then echo keystrokes. */
async function prompt(label) {
  await print(label, { pause: 40 });
  const line = el('div');
  screen.appendChild(line);
  cursorEl = newCursor();
  line.appendChild(cursorEl);
  inputLine = line;
  buffer = '';
}

function echo() {
  if (!inputLine) return;
  const masked = state === 'code' ? '•'.repeat(buffer.length) : buffer;
  inputLine.textContent = '';
  inputLine.appendChild(document.createTextNode(masked));
  inputLine.appendChild(cursorEl);
}

function validName(n) {
  return /^[a-z0-9][a-z0-9 _\-\.]{1,23}$/.test(n.trim().toLowerCase().replace(/\s+/g, ' '));
}

async function submitField() {
  const value = buffer.trim();
  inputLine = null;
  if (cursorEl) { cursorEl.remove(); cursorEl = null; } // the line is done
  if (state === 'name') {
    if (!validName(value)) {
      await print('NAMES ARE 2-24 PLAIN CHARACTERS.');
      state = 'name';
      await prompt('identify:');
      return;
    }
    crewNameEntry = value.toLowerCase().replace(/\s+/g, ' ');
    state = 'code';
    await prompt('access code:');
    return;
  }
  if (state === 'code') {
    if (value.length < 4) {
      await print('ACCESS CODES ARE AT LEAST 4 CHARACTERS.');
      state = 'code';
      await prompt('access code:');
      return;
    }
    codeEntry = value;
    await requestSignon(false);
    return;
  }
}

async function requestSignon(create) {
  state = 'busy';
  await print('QUERYING REGISTRY…', { pause: 60 });
  let data = null, status = 0;
  try {
    const res = await fetch('/api/signon', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: crewNameEntry,
        code: codeEntry,
        create,
        // A guest's local log boards with them into a new record
        notes: create ? (localStorage.getItem(NOTES_KEY) || '') : undefined,
      }),
    });
    status = res.status;
    data = await res.json().catch(() => null);
  } catch (e) { /* unreachable */ }

  if (data && (data.status === 'ok' || data.status === 'created')) {
    await print(data.status === 'created'
      ? 'RECORD OPENED · WELCOME ABOARD, ' + data.name + '.'
      : 'ACCESS GRANTED · RECORD OPEN.');
    adoptSignon(data);
    setTimeout(dismiss, 1100);
    return;
  }
  if (data && data.status === 'unknown') {
    state = 'confirm';
    await print('NO RECORD ON FILE FOR "' + crewNameEntry + '".');
    await print('OPEN A NEW CREW RECORD? Y/N', { pause: 30 });
    return;
  }
  if (status === 401) {
    await print('ACCESS DENIED.');
    state = 'code';
    await prompt('access code:');
    return;
  }
  if (status === 429) {
    await print('REGISTRY LOCKOUT · TOO MANY ATTEMPTS.');
    setTimeout(dismiss, 1600);
    return;
  }
  await print('REGISTRY UNREACHABLE · BOARDING UNREGISTERED.');
  setTimeout(dismiss, 1600);
}

function dismiss() {
  if (!overlay) return;
  state = 'closing';
  try { localStorage.setItem(SEEN_KEY, '1'); } catch (e) { /* fine */ }
  const o = overlay;
  overlay = null;
  active = false;
  document.removeEventListener('keydown', onKey, true);
  o.style.opacity = '0';
  setTimeout(() => { if (o.parentNode) o.parentNode.removeChild(o); }, 1000);
  emit('signon:closed');
}

function onKey(e) {
  // The terminal owns the keyboard: nothing leaks to flight controls,
  // the intro skip, or the autopilot's input sensing.
  e.stopPropagation();
  if (state === 'busy' || state === 'closing') { e.preventDefault(); return; }
  if (e.key === 'Escape') { e.preventDefault(); dismiss(); return; }
  if (state === 'confirm') {
    if (e.key === 'y' || e.key === 'Y') { requestSignon(true); }
    else if (e.key === 'n' || e.key === 'N') {
      (async () => {
        state = 'busy';
        await print('N', { pause: 30 });
        state = 'name';
        await prompt('identify:');
      })();
    }
    e.preventDefault();
    return;
  }
  if (!inputLine) return;
  if (e.key === 'Enter') { e.preventDefault(); submitField(); return; }
  if (e.key === 'Backspace') {
    e.preventDefault();
    buffer = buffer.slice(0, -1);
    echo();
    return;
  }
  if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && buffer.length < 72) {
    e.preventDefault();
    buffer += e.key;
    echo();
  }
}

/** Raise the terminal (boot offer, or summoned via SOLACE). */
export async function openSignonTerminal() {
  if (active) return;
  active = true;
  buildOverlay();
  document.addEventListener('keydown', onKey, true);
  state = 'busy';
  await print('solace · ship operating system', { pause: 60 });
  await print('crew registry interface', { pause: 260 });
  await print('');
  state = 'name';
  await prompt('identify:');
}

/** Boot-time offer. Returns true when the terminal was raised, so the
 * caller can hold the opening shot until the traveler is aboard. */
export function initSignon() {
  if (isSignedOn()) return false;
  let seen = null;
  try { seen = localStorage.getItem(SEEN_KEY); } catch (e) { /* fine */ }
  if (seen) return false;
  openSignonTerminal();
  return true;
}
