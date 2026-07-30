// fieldnotes.js — the ship's OS whispers.
//
// One information law aboard (the user's call — two competing homes
// meant no home): FACTS live in the info card, bottom-left. Sol's
// words live bottom-right. The center of the screen belongs to the
// view. The old top-center "field notes" deck — location lore dripping
// in over the vista — duplicated the card and made the eye hunt, so
// it's gone. What remains here is the OS whisper: brief, transient
// state lines low on the glass (helm handoffs, courses laid in, the
// crew record, the one Enter hint).

import { on } from './bus.js';

export function initFieldNotes() {
  const helmEl = document.createElement('div');
  helmEl.style.cssText =
    'position:fixed;bottom:10%;left:50%;transform:translateX(-50%);z-index:40;' +
    'max-width:560px;width:80vw;text-align:center;pointer-events:none;' +
    "font-family:'Segoe UI','Helvetica Neue',Arial,sans-serif;font-weight:300;" +
    'font-size:11px;letter-spacing:2.5px;line-height:2.1;' +
    'color:rgba(205,225,255,0.6);text-shadow:0 0 2px rgba(0,0,0,0.85),0 0 2px rgba(0,0,0,0.85),0 1px 3px rgba(0,0,0,0.95),0 0 14px rgba(0,0,0,0.6);' +
    'opacity:0;transition:opacity 1800ms ease;';
  document.body.appendChild(helmEl);
  let helmTimer = null;
  const whisper = (text) => {
    helmEl.textContent = text;
    helmEl.style.opacity = '1';
    if (helmTimer) clearTimeout(helmTimer);
    helmTimer = setTimeout(() => { helmEl.style.opacity = '0'; }, 5000);
  };
  on('autopilot:engaged', () => whisper('\u2014 solace has the helm \u2014'));
  on('autopilot:released', () => whisper('\u2014 helm yours \u2014'));
  // The plotted course, stated as the ship's log would: quiet fact
  on('warp:start', ({ mode, via }) => {
    if (mode === 'cruise' && via && via.length) {
      whisper('\u2014 course laid in \u00b7 via ' + via.join(' \u00b7 ').toLowerCase() + ' \u2014');
    }
  });
  on('crew:signed-on', ({ name }) => whisper('\u2014 crew record open \u00b7 ' + name + ' \u2014'));
  on('crew:signed-off', () => whisper('\u2014 record closed \u2014'));
  // Once, ever: the ship teaches the one control that can't be found
  // by fishing in the dark. Same OS voice as the helm whispers.
  let enterHintDone = false;
  try { enterHintDone = !!localStorage.getItem('solace_enter_hint_v1'); } catch (e) { /* fine */ }
  on('orbit:enter', () => {
    if (enterHintDone) return;
    enterHintDone = true;
    try { localStorage.setItem('solace_enter_hint_v1', '1'); } catch (e) { /* fine */ }
    setTimeout(() => whisper('\u2014 enter \u00b7 speak to the ship \u2014'), 7000);
  });
}
