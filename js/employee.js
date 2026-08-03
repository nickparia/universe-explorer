// employee.js — the employee module.
//
// The personnel record, readable and amendable at a company terminal:
// your designation (company-issued until you replace it), contract
// age, worlds logged, surveys filed. [D] redesignates — the moment the
// assigned ID becomes YOUR name; [A] sets a personal access code (the
// assigned designation stops being the key). Same OS voice and green
// phosphor as the wake terminal; SOLACE can summon it by name.

import { emit } from './bus.js';
import { crewHeaders, getCrewName, isSignedOn, adoptRename } from './crew.js';
import { openSignonTerminal } from './signon.js';
import { getCredits } from './workorders.js';

const MONO = "'SF Mono','Cascadia Mono','JetBrains Mono',Menlo,Consolas,'Courier New',monospace";

let overlay = null;
let screen = null;
let active = false;
let state = null;   // 'menu' | 'desig' | 'code' | 'busy' | 'closing'
let buffer = '';
let inputLine = null;
let cursorEl = null;
let record = null;  // the fetched record, for the service log

export function isEmployeeActive() { return active; }

function el(tag, css) {
  const e = document.createElement(tag);
  if (css) e.style.cssText = css;
  return e;
}

function newCursor() {
  return el('span', 'display:inline-block;width:0.62em;height:1.15em;' +
    'vertical-align:text-bottom;background:rgba(160,255,180,0.85);' +
    'animation:solace-cursor 1.1s steps(1) infinite;');
}

function print(text, { pace = 9, pause = 90 } = {}) {
  return new Promise((resolve) => {
    if (!overlay) { resolve(); return; }
    const line = el('div');
    screen.appendChild(line);
    const cur = newCursor();
    line.appendChild(cur);
    let i = 0;
    const tick = () => {
      if (!overlay) return;
      if (i < text.length) {
        cur.before(document.createTextNode(text[i++]));
        screen.scrollTop = screen.scrollHeight;   // the printout leads, the glass follows
        setTimeout(tick, pace);
      } else {
        cur.remove();
        setTimeout(resolve, pause);
      }
    };
    tick();
  });
}

// A command explains itself: bright key, dim plain meaning — printed
// instantly (the menu is furniture, not speech).
function cmd(keyLabel, note) {
  const d = el('div');
  const b = el('span');
  b.textContent = keyLabel;
  const n = el('span', 'color:rgba(160,255,180,0.4);');
  n.textContent = '  — ' + note;
  d.appendChild(b);
  d.appendChild(n);
  screen.appendChild(d);
  screen.scrollTop = screen.scrollHeight;
}

function commandRows() {
  cmd('[L] SERVICE LOG', 'everything on file about you');
  cmd('[D] REDESIGNATE', 'choose your own name (replaces the company id)');
  cmd('[A] ACCESS CODE', 'set a private password');
  cmd('[ESC] CLOSE', 'back to the ship · ↑↓ scroll');
}

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

function dismiss() {
  if (!overlay) return;
  state = 'closing';
  const o = overlay;
  overlay = null;
  active = false;
  document.removeEventListener('keydown', onKey, true);
  o.style.opacity = '0';
  setTimeout(() => { if (o.parentNode) o.parentNode.removeChild(o); }, 900);
  emit('employee:closed');
}

async function submitField() {
  const value = buffer.trim();
  inputLine = null;
  if (cursorEl) { cursorEl.remove(); cursorEl = null; }

  if (state === 'desig') {
    if (!value) { state = 'menu'; await print('AMENDMENT WITHDRAWN.'); return; }
    if (!validName(value)) {
      await print('DESIGNATIONS ARE 2-24 PLAIN CHARACTERS.');
      state = 'desig';
      await prompt('your new name (2-24 plain characters — enter to cancel):');
      return;
    }
    state = 'busy';
    await print('AMENDING THE RECORD…', { pause: 60 });
    let data = null, status = 0;
    try {
      const res = await fetch('/api/crew/rename', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...crewHeaders() },
        body: JSON.stringify({ name: value.toLowerCase().replace(/\s+/g, ' ') }),
      });
      status = res.status;
      data = await res.json().catch(() => null);
    } catch (e) { /* unreachable */ }
    if (data && data.status === 'ok') {
      adoptRename(data.name);
      await print('RECORD AMENDED · YOU ARE ' + data.name.toUpperCase() + '.');
      await print('OTHER TERMINALS WILL ASK YOU TO SIGN ON AGAIN.', { pause: 200 });
    } else if (status === 409) {
      await print('DESIGNATION TAKEN.');
      state = 'desig';
      await prompt('your new name (2-24 plain characters — enter to cancel):');
      return;
    } else {
      await print('REGISTRY UNREACHABLE · RECORD UNCHANGED.');
    }
    state = 'menu';
    return;
  }

  if (state === 'code') {
    if (!value) { state = 'menu'; await print('AMENDMENT WITHDRAWN.'); return; }
    if (value.length < 4) {
      await print('ACCESS CODES ARE AT LEAST 4 CHARACTERS.');
      state = 'code';
      await prompt('your new password (at least 4 characters — enter to cancel):');
      return;
    }
    state = 'busy';
    await print('SEALING…', { pause: 60 });
    let ok = false;
    try {
      const res = await fetch('/api/crew/recode', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...crewHeaders() },
        body: JSON.stringify({ code: value }),
      });
      ok = res.ok;
    } catch (e) { /* unreachable */ }
    await print(ok
      ? 'ACCESS CODE SET · THE DESIGNATION ALONE NO LONGER OPENS THIS RECORD.'
      : 'REGISTRY UNREACHABLE · RECORD UNCHANGED.');
    state = 'menu';
    return;
  }
}

function onKey(e) {
  e.stopPropagation();
  // The record can outrun the glass: arrows and page keys move it,
  // even mid-printout. (The wheel scrolls natively.)
  if (screen && (e.key === 'ArrowDown' || e.key === 'ArrowUp' ||
                 e.key === 'PageDown' || e.key === 'PageUp')) {
    e.preventDefault();
    const step = e.key.startsWith('Page') ? screen.clientHeight * 0.85 : 56;
    screen.scrollTop += (e.key === 'ArrowDown' || e.key === 'PageDown') ? step : -step;
    return;
  }
  if (state === 'busy' || state === 'closing') { e.preventDefault(); return; }
  if (e.key === 'Escape') {
    e.preventDefault();
    window.__solaceEscClaimed = performance.now();
    dismiss();
    return;
  }
  if (state === 'menu') {
    const k = e.key.toLowerCase();
    if (k === 'd') { state = 'desig'; e.preventDefault(); prompt('your new name (2-24 plain characters — enter to cancel):'); return; }
    if (k === 'a') { state = 'code'; e.preventDefault(); prompt('your new password (at least 4 characters — enter to cancel):'); return; }
    if (k === 'l') { e.preventDefault(); serviceLog(); return; }
    return;
  }
  if (!inputLine) return;
  if (e.key === 'Enter') { e.preventDefault(); submitField(); return; }
  if (e.key === 'Backspace') { e.preventDefault(); buffer = buffer.slice(0, -1); echo(); return; }
  if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && buffer.length < 72) {
    e.preventDefault();
    buffer += e.key;
    echo();
  }
}

/** [L] — the service log: everything the record holds on this worker.
 *  Worlds with dates, surveys, and SOLACE's own observations — the
 *  company reads its files aloud when asked. */
async function serviceLog() {
  state = 'busy';
  await print('');
  await print('— SERVICE LOG —', { pause: 160 });
  const places = (record && record.places) || {};
  const entries = Object.entries(places)
    .filter(([, ts]) => typeof ts === 'number')
    .sort((a, b) => b[1] - a[1]);
  if (!entries.length) {
    await print('NO WORLDS ON FILE YET.', { pace: 5 });
  }
  for (const [world, ts] of entries.slice(0, 14)) {
    const d = new Date(ts);
    const stamp = d.getFullYear() + '.' +
      String(d.getMonth() + 1).padStart(2, '0') + '.' +
      String(d.getDate()).padStart(2, '0');
    await print(stamp + '  ' + world, { pace: 4, pause: 30 });
  }
  if (entries.length > 14) await print('… ' + (entries.length - 14) + ' EARLIER', { pace: 4 });
  const stakes = (record && record.stakes) || [];
  if (stakes.length) await print('SURVEYS FILED: ' + stakes.length, { pace: 5 });
  const notes = ((record && record.notes) || '').trim();
  if (notes) {
    await print('');
    await print("— SOLACE'S OBSERVATIONS —", { pause: 160 });
    await print(notes.slice(0, 900), { pace: 3, pause: 60 });
  }
  await print('');
  commandRows();
  state = 'menu';
}

export async function openEmployeeModule() {
  if (active) return;
  if (!isSignedOn()) {
    // No record aboard — the personnel check comes up instead.
    openSignonTerminal();
    return;
  }
  active = true;
  overlay = el('div',
    'position:fixed;inset:0;z-index:410;background:#020604;' +
    'display:flex;align-items:center;justify-content:center;' +
    'opacity:0;transition:opacity 0.7s ease;');
  const lines = el('div',
    'position:absolute;inset:0;pointer-events:none;opacity:0.5;' +
    'background:repeating-linear-gradient(0deg,rgba(0,0,0,0) 0 2px,rgba(120,255,160,0.025) 2px 4px);');
  overlay.appendChild(lines);
  screen = el('div',
    'width:min(940px,88vw);max-height:80vh;overflow-y:auto;' +
    'padding-right:16px;scrollbar-width:thin;' +
    'scrollbar-color:rgba(120,255,150,0.25) transparent;' +
    'font-family:' + MONO + ';font-size:14px;' +
    'letter-spacing:2px;line-height:2.2;color:rgba(160,255,180,0.92);' +
    'text-shadow:0 0 6px rgba(80,255,120,0.55),0 0 18px rgba(50,255,90,0.22);' +
    'text-transform:uppercase;white-space:pre-wrap;');
  overlay.appendChild(screen);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => { overlay.style.opacity = '1'; });
  document.addEventListener('keydown', onKey, true);

  state = 'busy';
  await print('solace os 7.7 · employee module', { pause: 200 });
  await print('');

  // The record, fresh from the registry (local truth as fallback)
  record = null;
  try {
    const res = await fetch('/api/crew/state', { headers: crewHeaders() });
    if (res.ok) record = await res.json();
  } catch (e) { /* offline */ }
  const rec = record;
  const name = ((rec && rec.name) || getCrewName() || '').toUpperCase();
  const issued = rec && rec.assigned;
  await print('RECORD · ' + name + (issued ? '  (COMPANY-ISSUED)' : ''), { pause: 140 });
  if (issued) {
    const note = el('div', 'color:rgba(160,255,180,0.4);');
    note.textContent = 'THIS COMPANY ID IS YOUR NAME AND SIGN-IN KEY. PRESS [D] TO MAKE IT YOUR OWN.';
    screen.appendChild(note);
  }
  if (rec) {
    const days = rec.createdAt ? Math.max(0, Math.floor((Date.now() - rec.createdAt) / 86400000)) : 0;
    await print('CONTRACT ' + (days === 0 ? 'OPENED TODAY' : days + (days === 1 ? ' DAY' : ' DAYS')), { pace: 6 });
    const cr = Math.max(getCredits(), rec.credits || 0);
    if (cr > 0) await print('ACCOUNT ' + cr + ' CR', { pace: 6 });
    await print('WORLDS LOGGED ' + Object.keys(rec.places || {}).length, { pace: 6 });
    const surveys = (rec.stakes || []).length;
    if (surveys) await print('SURVEYS FILED ' + surveys, { pace: 6 });
  }
  await print('');
  commandRows();
  state = 'menu';
}
