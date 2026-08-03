// systems.js — SOLACE OS · SHIP SYSTEMS.
//
// The game-level functions, dressed as ship operations — because there
// is no pause menu aboard a ship, there is an OS. Esc raises it (when
// nothing closer to the hands wants the key: the chat line, the chart,
// a placement all take precedence and stop propagation before this
// hears anything). While the menu is up it OWNS the keyboard outright
// (capture phase), so its digits never leak into the helm's fly-to
// shortcuts — and the fullscreen re-seal stands down (the flag
// window.__solaceHoldSeal), so leaving fullscreen to quit isn't a
// wrestling match.
//
// Quitting is RETURNING TO CRYOSTASIS: you woke from the pod at boot;
// you go back under to end the shift. The desktop shell actually
// exits. A browser can't close its own tab, so the shift ends
// UNMISTAKABLY on screen instead: fullscreen released, SHIFT ENDED
// over black, and one labelled key to begin the next.

import { on } from './bus.js';
import { getCrewName, isSignedOn, signOff } from './crew.js';
import { openSignonTerminal, isSignonActive } from './signon.js';
import { openEmployeeModule, isEmployeeActive } from './employee.js';
import { readOutpostRecords, stageOf, hopperOf, etaHours } from './ground/outposts.js';
import { getOrders, orderState, activeOrder, getCredits } from './workorders.js';

const MONO = "'SF Mono','Cascadia Mono','JetBrains Mono',Menlo,Consolas,'Courier New',monospace";

let overlay = null;
let screen = null;
let active = false;
let busy = false;
let starmapOpen = false;

export function isSystemsOpen() { return active; }

function el(tag, css) {
  const e = document.createElement(tag);
  if (css) e.style.cssText = css;
  return e;
}

function line(text, bright) {
  const d = el('div', bright ? '' : 'color:rgba(160,255,180,0.5);');
  d.textContent = text;
  screen.appendChild(d);
  return d;
}

// A menu item explains itself: bright command, dim plain meaning.
// Diegetic AND intuitive — the company writes handbooks, after all.
function item(cmd, note) {
  const d = el('div');
  const b = el('span');
  b.textContent = cmd;
  const n = el('span', 'color:rgba(160,255,180,0.4);');
  n.textContent = '  — ' + note;
  d.appendChild(b);
  d.appendChild(n);
  screen.appendChild(d);
}

function holdSeal(hold) {
  window.__solaceHoldSeal = hold;   // main.js reads this before re-sealing fullscreen
}

function open() {
  active = true;
  holdSeal(true);
  overlay = el('div',
    'position:fixed;inset:0;z-index:400;background:rgba(2,6,4,0.86);' +
    'display:flex;align-items:center;justify-content:center;' +
    'opacity:0;transition:opacity 0.45s ease;backdrop-filter:blur(2px);');
  const lines = el('div',
    'position:absolute;inset:0;pointer-events:none;opacity:0.5;' +
    'background:repeating-linear-gradient(0deg,rgba(0,0,0,0) 0 2px,rgba(120,255,160,0.025) 2px 4px);');
  overlay.appendChild(lines);
  screen = el('div',
    'width:min(520px,84vw);font-family:' + MONO + ';font-size:14px;' +
    'letter-spacing:2px;line-height:2.4;color:rgba(160,255,180,0.92);' +
    'text-shadow:0 0 6px rgba(80,255,120,0.55),0 0 18px rgba(50,255,90,0.22);' +
    'text-transform:uppercase;white-space:pre-wrap;');
  overlay.appendChild(screen);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => { overlay.style.opacity = '1'; });

  line('solace os · ship systems', true);
  line('');
  item('[1] RESUME SHIFT', 'back to the ship');
  item('[2] EMPLOYEE MODULE', 'your record · choose your own name');
  if (isSignedOn()) {
    item('[3] CLOSE RECORD · ' + String(getCrewName() || '').toUpperCase(), 'sign out on this machine');
  } else {
    item('[3] PERSONNEL CHECK', 'sign in, or start a new record');
  }
  item('[4] RETURN TO CRYOSTASIS', 'save and quit');
  // The company issues hardened terminals to personnel in the field —
  // but only offers one when you're NOT already holding it.
  if (!/electron/i.test(navigator.userAgent)) {
    item('[5] REQUISITION SHIPBOARD TERMINAL', 'install the desktop app · macos');
  }

  // The company's wire: the open order with its terms and progress —
  // and the account, because wages are the point of employment.
  const open = activeOrder();
  line('');
  line('— work orders · the company —');
  if (open) {
    const st = orderState(open);
    item('W/O ' + open.id + ' · ' + open.title,
      st.progress + '/' + open.target + ' · pays ' + open.credits + ' cr' +
      (open.releases ? ' + ' + open.releases.toLowerCase() : ''));
    line(open.terms);
  } else {
    line('the wire is quiet — all orders closed.');
  }
  const closedCount = getOrders().filter((o) => orderState(o).paid).length;
  line('account ' + getCredits() + ' cr' + (closedCount ? ' · ' + closedCount + ' orders closed' : ''));

  // The duty roster's first heartbeat: the works report themselves,
  // composed from real state every time the menu opens.
  const worksRecs = readOutpostRecords();
  if (worksRecs.length) {
    line('');
    line('— the works · mars —');
    for (const o of worksRecs.slice(0, 4)) {
      const st = stageOf(o);
      if (st.frac >= 1) {
        const h = hopperOf(o);
        item('E' + o.n + ' · ONLINE', h > 0 ? 'hopper ' + h + ' fe-ox — worth a landfall' : 'hopper empty · accruing');
      } else {
        const eta = etaHours(o);
        item('E' + o.n + ' · ' + st.label,
          'online in ' + (eta < 1 ? Math.max(1, Math.round(eta * 60)) + ' min' : eta.toFixed(1) + ' h'));
      }
    }
  }

  line('');
  line('esc · resume');

  // The menu owns the keyboard while it is up — capture phase, before
  // the helm's own listeners can hear a digit and fly somewhere.
  document.addEventListener('keydown', onMenuKey, true);
}

function close() {
  if (!overlay) return;
  document.removeEventListener('keydown', onMenuKey, true);
  holdSeal(false);
  const o = overlay;
  overlay = null;
  active = false;
  busy = false;
  o.style.opacity = '0';
  setTimeout(() => { if (o.parentNode) o.parentNode.removeChild(o); }, 500);
}

/** End the shift. The desktop shell exits; a browser ends it on the
 *  glass instead — fullscreen released, the pod holding, one key out. */
async function cryostasis() {
  busy = true;
  screen.innerHTML = '';
  const type = (t) => new Promise((r) => {
    const d = line('', true);
    let i = 0;
    const tick = () => {
      if (i < t.length) { d.textContent += t[i++]; setTimeout(tick, 14); }
      else setTimeout(r, 260);
    };
    tick();
  });
  await type('SHIFT LOG CLOSED.');
  await type('CRYOSTASIS ENGAGED.');
  await type('GOOD NIGHT.');
  overlay.style.transition = 'opacity 1.4s ease, background 1.4s ease';
  overlay.style.background = '#000';
  await new Promise((r) => setTimeout(r, 1100));

  if (/electron/i.test(navigator.userAgent)) {
    window.close();       // the shell obeys — the process ends here
    return;
  }

  // A browser tab: release the seized screen and make the end STATE
  // unmistakable — no half-quit lingering behind a fullscreen pane.
  window.__solaceQuitFS = true;   // this exit is the shift ending, not a menu request
  if (document.fullscreenElement && document.exitFullscreen) {
    try { document.exitFullscreen(); } catch (e) { /* fine */ }
  }
  document.removeEventListener('keydown', onMenuKey, true);
  screen.innerHTML = '';
  screen.style.textAlign = 'center';
  const big = line('SHIFT ENDED', true);
  big.style.cssText = 'font-size:22px;letter-spacing:9px;';
  const mid = line('CRYOSTASIS ENGAGED · THE POD HOLDS');
  mid.style.cssText = 'color:rgba(160,255,180,0.45);font-size:12px;letter-spacing:4px;margin-top:8px;';
  const cap = line('enter · begin next shift');
  cap.style.cssText = 'color:rgba(160,255,180,0.6);font-size:12px;letter-spacing:4px;margin-top:26px;';
  const wake = (e) => {
    if (e.key !== 'Enter') { e.preventDefault(); return; }
    e.preventDefault();
    document.removeEventListener('keydown', wake, true);
    location.reload();    // the wake sequence begins the next shift
  };
  document.addEventListener('keydown', wake, true);
}

/** Capture-phase handler while the menu is up: every key stops here. */
function onMenuKey(e) {
  e.stopPropagation();
  e.preventDefault();
  if (busy) return;
  if (e.key === 'Escape' || e.key === '1') { close(); return; }
  if (e.key === '2') { close(); openEmployeeModule(); return; }
  if (e.key === '3') {
    close();
    if (isSignedOn()) signOff();
    else openSignonTerminal();
    return;
  }
  if (e.key === '4') { cryostasis(); return; }
  if (e.key === '5' && !/electron/i.test(navigator.userAgent)) {
    // Equipment issue: the hardened shipboard terminal, notarized and
    // sealed. One anchor click — the game never navigates away.
    const a = document.createElement('a');
    a.href = '/downloads/Solace-0.1.0-universal.dmg';
    a.download = 'Solace-0.1.0-universal.dmg';
    document.body.appendChild(a);
    a.click();
    a.remove();
    line('');
    line('TERMINAL ISSUED · CHECK YOUR DOWNLOADS FOLDER.', true);
    line('open the image · drag solace into applications');
  }
}

function canOpen() {
  if (active || busy) return false;
  const ae = document.activeElement;
  if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return false;
  if (isSignonActive() || isEmployeeActive() || starmapOpen) return false;
  return true;
}

/** The quiet opener: only ever hears an UNCLAIMED Esc. */
function onKey(e) {
  if (e.key !== 'Escape') return;
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
  if (!canOpen()) return;
  open();
}

export function initSystems() {
  on('starmap:toggled', (isOpen) => { starmapOpen = !!isOpen; });
  window.addEventListener('keydown', onKey);

  // THE BROWSER'S FIRST ESC never reaches the page — Chrome spends it
  // exiting fullscreen and suppresses the keydown. So the exit ITSELF
  // is read as the request: one press gives windowed mode AND the
  // menu, instead of demanding a second Esc. Surfaces that consume an
  // Esc for their own close (chart, placement, terminals) stamp
  // __solaceEscClaimed so their exits don't false-trigger this; the
  // cryostasis flow's own exitFullscreen sets __solaceQuitFS.
  // (The Electron shell never binds Esc to fullscreen, so only the
  // keydown path runs there.)
  document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement) return;               // sealed, not exited
    if (window.__solaceQuitFS) return;                    // the shift is ending
    if (performance.now() - (window.__solaceEscClaimed || 0) < 500) return;
    if (!canOpen()) return;
    open();
  });
}
