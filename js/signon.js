// signon.js — the cryostasis wake terminal.
//
// There is no login screen. There is a pod, a company, and a shift.
// First boot: the revival sequence runs over black, the personnel
// check comes up, and a new worker never fills a form — the terminal
// FILES them, assigning a company designation that doubles as their
// first access key. An existing worker quotes their designation (and
// their code, if they've personalized) — the same wake text every
// time, because waking IS logging on. ESC boards unregistered and the
// terminal never insists again; SOLACE can always summon it later.
//
// Terminal text is the ship's OS voice — flat, procedural, upper case,
// green phosphor. SOLACE's own voice (murmurs, chat) stays elsewhere.

import { emit } from './bus.js';
import { adoptSignon, isSignedOn, NEWHIRE_SIM } from './crew.js';
import { stageOf, hopperOf, etaHours } from './ground/outposts.js';
import { activeOrder, getCredits } from './workorders.js';

const SEEN_KEY = 'solace_signon_seen_v1';
// Same key shipchat.js uses — a guest's existing local log is adopted
// into a newly filed contract, so enlisting never loses a memory.
const NOTES_KEY = 'solace_traveler_notes_v1';

const MONO = "'SF Mono','Cascadia Mono','JetBrains Mono',Menlo,Consolas,'Courier New',monospace";

let overlay = null;
let screen = null;
let active = false;
let state = null;     // 'desig' | 'code' | 'busy' | 'hold' | 'closing'
let buffer = '';
let desigEntry = '';
let inputLine = null; // the line currently receiving keystrokes
let cursorEl = null;

export function isSignonActive() { return active; }

function el(tag, css) {
  const e = document.createElement(tag);
  if (css) e.style.cssText = css;
  return e;
}

function buildOverlay() {
  overlay = el('div',
    'position:fixed;inset:0;z-index:410;background:#020604;' +
    'display:flex;align-items:center;justify-content:center;' +
    'opacity:0;transition:opacity 0.9s ease;');
  // Faint scanlines — the tube, not a texture pack
  const lines = el('div',
    'position:absolute;inset:0;pointer-events:none;opacity:0.5;' +
    'background:repeating-linear-gradient(0deg,rgba(0,0,0,0) 0 2px,rgba(120,255,160,0.025) 2px 4px);');
  overlay.appendChild(lines);
  const vignette = el('div',
    'position:absolute;inset:0;pointer-events:none;' +
    'background:radial-gradient(ellipse at center,rgba(0,0,0,0) 55%,rgba(0,0,0,0.5) 100%);');
  overlay.appendChild(vignette);

  screen = el('div',
    'width:min(640px,86vw);max-height:84vh;overflow-y:auto;' +
    'padding-right:14px;scrollbar-width:thin;' +
    'scrollbar-color:rgba(120,255,150,0.25) transparent;' +
    'font-family:' + MONO + ';font-size:14px;' +
    'letter-spacing:2px;line-height:2.2;color:rgba(160,255,180,0.92);' +
    'text-shadow:0 0 6px rgba(80,255,120,0.55),0 0 18px rgba(50,255,90,0.22);' +
    'text-transform:uppercase;white-space:pre-wrap;');
  overlay.appendChild(screen);

  const hint = el('div',
    'position:absolute;bottom:7vh;left:50%;transform:translateX(-50%);' +
    'font-family:' + MONO + ';font-size:11px;letter-spacing:3px;' +
    'color:rgba(130,220,150,0.34);text-transform:uppercase;');
  hint.textContent = 'esc · board unregistered';
  overlay.appendChild(hint);

  document.body.appendChild(overlay);
  requestAnimationFrame(() => { overlay.style.opacity = '1'; });
}

function newCursor() {
  const c = el('span', 'display:inline-block;width:0.62em;height:1.15em;' +
    'vertical-align:text-bottom;background:rgba(160,255,180,0.85);' +
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
    if (!overlay) { resolve(); return; }
    const line = el('div');
    screen.appendChild(line);
    const cur = newCursor();
    line.appendChild(cur);
    let i = 0;
    const tick = () => {
      if (!overlay) return; // dismissed mid-print
      if (i < text.length) {
        cur.before(document.createTextNode(text[i++]));
        screen.scrollTop = screen.scrollHeight;   // short glass never clips the card
        setTimeout(tick, pace);
      } else {
        cur.remove();
        setTimeout(resolve, pause);
      }
    };
    tick();
  });
}

/** A status line that fills its dots and lands its verdict — the
 *  register of a machine checking a pod, not typing a sentence. */
async function status(label, verdict) {
  await print(label + ' '.repeat(Math.max(1, 22 - label.length)) + verdict, { pace: 6, pause: 170 });
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

async function submitField() {
  const value = buffer.trim();
  inputLine = null;
  if (cursorEl) { cursorEl.remove(); cursorEl = null; } // the line is done

  if (state === 'desig') {
    if (!value) { await enlist(); return; }
    desigEntry = value.toLowerCase().replace(/\s+/g, ' ');
    // The company-issued designation IS its own key — try it silently
    // first; a personalized record answers 401 and earns a code prompt.
    await requestSignon(desigEntry, desigEntry, { silentDenied: true });
    return;
  }
  if (state === 'code') {
    if (value.length < 4) {
      await print('ACCESS CODES ARE AT LEAST 4 CHARACTERS.');
      state = 'code';
      await prompt('access code:');
      return;
    }
    await requestSignon(desigEntry, value, {});
    return;
  }
}

/** File a new contract: the terminal assigns everything. */
async function enlist() {
  state = 'busy';
  await print('');
  await print('FILING NEW CONTRACT…', { pause: 320 });
  let data = null, status429 = false;
  try {
    const res = await fetch('/api/enlist', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // A simulated hire is a stranger: the machine's guest log stays home
      body: JSON.stringify({ notes: NEWHIRE_SIM ? '' : (localStorage.getItem(NOTES_KEY) || '') }),
    });
    status429 = res.status === 429;
    data = await res.json().catch(() => null);
  } catch (e) { /* unreachable */ }

  if (data && data.status === 'created') {
    const id = data.name.toUpperCase();
    await print('CONTRACT FILED.');
    await print('');
    await print('YOUR DESIGNATION: ' + id, { pause: 300 });
    await print('THIS IS YOUR NAME AND YOUR PASSWORD, IN ONE.', { pace: 9 });
    await print('WRITE IT DOWN — IT SIGNS YOU IN ON ANY MACHINE.', { pace: 9 });
    await print('TO CHOOSE YOUR OWN NAME LATER: PRESS ESC ABOARD,', { pace: 9 });
    await print('THEN [2] EMPLOYEE MODULE.', { pace: 9, pause: 400 });
    await print('');
    await print('— ASSIGNMENT BRIEF —', { pause: 300 });
    await print('DESTINATION: SOL SYSTEM · THIRD PLANET.', { pace: 9 });
    await print('PURPOSE: SURVEY AND PRESENCE.', { pace: 9 });
    await print('PREVIOUS CONTRACTOR: RECORD SEALED.', { pace: 9, pause: 340 });
    await print('DURATION: INDEFINITE.', { pace: 9, pause: 420 });
    await print('');
    await print('WELCOME TO THE COMPANY.', { pause: 420 });
    await print('');
    await print('ENTER · BEGIN SHIFT', { pace: 9 });
    adoptSignon(data);
    emit('crew:enlisted', { name: data.name });
    // The card HOLDS — a designation that must be kept cannot be
    // allowed to dismiss itself before it has been read.
    state = 'hold';
    return;
  }
  if (status429) {
    await print('REGISTRY LOCKOUT · TRY NEXT SHIFT.');
    setTimeout(dismiss, 1600);
    return;
  }
  await print('REGISTRY UNREACHABLE · BOARDING UNREGISTERED.');
  setTimeout(dismiss, 1600);
}

async function requestSignon(name, code, { silentDenied }) {
  state = 'busy';
  await print('CHECKING THE REGISTER…', { pause: 60 });
  let data = null, status = 0;
  try {
    const res = await fetch('/api/signon', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, code, create: false }),
    });
    status = res.status;
    data = await res.json().catch(() => null);
  } catch (e) { /* unreachable */ }

  if (data && data.status === 'ok') {
    await print('RECORD RETRIEVED · WELCOME BACK, ' + data.name.toUpperCase() + '.');
    adoptSignon(data);
    setTimeout(dismiss, 1100);
    return;
  }
  if (data && data.status === 'unknown') {
    await print('NO RECORD UNDER THAT DESIGNATION.');
    state = 'desig';
    await prompt('your designation — new worker? just press enter:');
    return;
  }
  if (status === 401) {
    // Personalized record: the designation alone no longer opens it
    if (!silentDenied) await print('ACCESS DENIED.');
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
  if (!NEWHIRE_SIM) {
    try { localStorage.setItem(SEEN_KEY, '1'); } catch (e) { /* fine */ }
  }
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
  if (state === 'hold') {
    // The brief waits for a deliberate ENTER — the shift begins when
    // the worker says so, not when a stray key lands.
    e.preventDefault();
    if (e.key === 'Enter') dismiss();
    return;
  }
  if (e.key === 'Escape') {
    e.preventDefault();
    window.__solaceEscClaimed = performance.now();
    dismiss();
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

/** Raise the wake terminal (boot, or summoned via SOLACE). */
export async function openSignonTerminal() {
  if (active) return;
  active = true;
  buildOverlay();
  document.addEventListener('keydown', onKey, true);
  state = 'busy';
  await print('solace os 7.7 · deep haul division', { pause: 420 });
  await print('');
  await print('CRYOSTASIS REVIVAL SEQUENCE', { pause: 260 });
  await status('POD SEALS', '.... RELEASED');
  await status('VITALS', '....... NOMINAL');
  await status('NEURAL FOG', '... CLEARING');
  await print('');
  await print('PERSONNEL CHECK.', { pause: 200 });
  state = 'desig';
  await prompt('your designation — new worker? just press enter:');
}

/** The returning worker's boot: no prompts — the pod opens, the record
 *  flashes past. Same register as the wake, compressed to a breath.
 *  Any key skips. Resolves when the card has cleared. */
export function showShiftResumption(rec) {
  if (active) return Promise.resolve();
  active = true;
  return new Promise((resolve) => {
    buildOverlay();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      document.removeEventListener('keydown', skip, true);
      const o = overlay;
      overlay = null;
      active = false;
      if (o) {
        o.style.opacity = '0';
        setTimeout(() => { if (o.parentNode) o.parentNode.removeChild(o); }, 900);
      }
      resolve();
    };
    const skip = (e) => { e.stopPropagation(); e.preventDefault(); finish(); };
    document.addEventListener('keydown', skip, true);
    (async () => {
      const worlds = Object.keys(rec.places || {}).length;
      const surveys = (rec.stakes || []).length;
      const days = rec.createdAt ? Math.max(0, Math.floor((Date.now() - rec.createdAt) / 86400000)) : 0;
      const last = rec.lastShiftDays;
      await print('solace os 7.7 · deep haul division', { pause: 240 });
      await print('');
      await print('SHIFT RESUMPTION · ' + String(rec.name || '').toUpperCase(), { pause: 200 });
      await status('CONTRACT', '..... ' + (days === 0 ? 'NEW HIRE' : days + (days === 1 ? ' DAY' : ' DAYS')));
      await status('WORLDS LOGGED', ' ' + worlds);
      if (surveys) await status('SURVEYS', '...... ' + surveys);
      // The works kept working: the card reports what changed while
      // the pod held — the loop's first real "come back" payoff.
      for (const o of (rec.outposts || []).slice(0, 2)) {
        const st = stageOf(o);
        await status('WORKS E' + o.n, st.frac >= 1
          ? '.. ONLINE · ' + hopperOf(o) + ' FE-OX'
          : '.. ' + st.label + ' · ' + Math.ceil(etaHours(o)) + 'H');
      }
      // The company's side of the ledger: the open order, the account
      const open = activeOrder();
      if (open) await status('INBOX', '....... W/O ' + open.id + ' OPEN');
      const cr = Math.max(getCredits(), rec.credits || 0);
      if (cr > 0) await status('ACCOUNT', '..... ' + cr + ' CR');
      if (typeof last === 'number' && last >= 1) {
        await status('LAST SHIFT', '... ' + Math.floor(last) + (Math.floor(last) === 1 ? ' DAY AGO' : ' DAYS AGO'));
      }
      await print('');
      await print('GOOD MORNING.', { pause: 900 });
      setTimeout(finish, 700);
    })();
  });
}

/** Boot-time wake. Returns true when the terminal was raised, so the
 * caller can hold the opening shot until the traveler is aboard. */
export function initSignon() {
  if (isSignedOn()) return false;
  // ?newhire=1 always wakes cold — the simulation ignores the machine's
  // memory of having offered the terminal before.
  if (!NEWHIRE_SIM) {
    let seen = null;
    try { seen = localStorage.getItem(SEEN_KEY); } catch (e) { /* fine */ }
    if (seen) return false;
  }
  openSignonTerminal();
  return true;
}
