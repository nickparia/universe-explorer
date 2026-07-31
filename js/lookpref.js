// lookpref.js — one ship, one Y.
//
// Whether pulling the hand down raises the eyes (flight-sim Y, the
// helm's long-standing default) or lowers them (direct). There is no
// options menu on this ship: the traveler asks Sol to flip it, the
// preference persists locally and in the crew record, and the helm and
// the boots always agree.

import { on, emit } from './bus.js';

const KEY = 'solace_look_invert_v1';
let inverted = true;   // the helm's historic default
try {
  const v = localStorage.getItem(KEY);
  if (v !== null) inverted = v === '1';
} catch (e) { /* private mode */ }

export function getLookInvert() { return inverted; }

export function setLookInvert(v) {
  inverted = !!v;
  try { localStorage.setItem(KEY, inverted ? '1' : '0'); } catch (e) { /* fine */ }
  emit('prefs:changed', { lookInvert: inverted });
}

// Adopt from the crew record — silently, like the music preference
on('crew:signed-on', ({ prefs }) => {
  if (prefs && typeof prefs.lookInvert === 'boolean') {
    inverted = prefs.lookInvert;
    try { localStorage.setItem(KEY, inverted ? '1' : '0'); } catch (e) { /* fine */ }
  }
});
