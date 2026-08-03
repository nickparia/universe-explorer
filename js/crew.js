// crew.js — the crew record: who is aboard, and the sync of SOLACE's
// memory of them to the ship's registry (the worker's KV).
//
// Guests sail exactly as before — everything stays in localStorage and
// nothing here activates. Signing on (signon.js) stores a token; from
// then on the traveler's log and place history live in their crew
// record too, so SOLACE remembers them from any machine they board.
//
// Other modules never fetch crew endpoints themselves. They listen for
// 'crew:signed-on' ({ name, notes, places }) to adopt server memory,
// and emit 'places:changed' (placeLog) when local history moves; this
// module debounces the push upstream.

import { on, emit } from './bus.js';

const TOKEN_KEY = 'solace_crew_token_v1';
const NAME_KEY = 'solace_crew_name_v1';

// ?newhire=1 — the recruiting-office door: identity lives in
// sessionStorage for this TAB only, so the first-boot wake, enlistment
// and a fresh record can be walked end-to-end without touching the
// machine's real crew token. Close the tab, the simulation evaporates.
export const NEWHIRE_SIM = typeof location !== 'undefined' &&
  new URLSearchParams(location.search).has('newhire');
const store = NEWHIRE_SIM ? sessionStorage : localStorage;

let token = null;
let crewName = null;
try {
  if (NEWHIRE_SIM) {
    // COLD every load: sessionStorage outlives reloads within a tab,
    // and a simulation that remembers its last hire isn't simulating
    // a new one. Every visit to ?newhire=1 is a stranger in the pod.
    store.removeItem(TOKEN_KEY);
    store.removeItem(NAME_KEY);
  }
  token = store.getItem(TOKEN_KEY) || null;
  crewName = store.getItem(NAME_KEY) || null;
} catch (e) { /* private mode — guest voyage */ }

let pushTimer = null;
let pendingPlaces = null;

export function getCrewName() { return crewName; }
export function isSignedOn() { return !!token; }

/** Authorization header for endpoints that persist crew memory. */
export function crewHeaders() {
  return token ? { authorization: 'Bearer ' + token } : {};
}

/** Called by signon.js when the terminal grants access. */
export function adoptSignon(data) {
  token = data.token;
  crewName = data.name;
  try {
    store.setItem(TOKEN_KEY, token);
    store.setItem(NAME_KEY, crewName);
  } catch (e) { /* private mode — signed on for this session only */ }
  emit('crew:signed-on', { name: data.name, notes: data.notes || '', places: data.places || {}, prefs: data.prefs || {} });
}

/** Called by the employee module after a redesignation is filed. */
export function adoptRename(name) {
  crewName = name;
  try { store.setItem(NAME_KEY, name); } catch (e) { /* fine */ }
  emit('crew:renamed', { name });
}

/** Sign off — the record stays in the registry; this ship forgets. */
export function signOff() {
  token = null;
  crewName = null;
  try {
    store.removeItem(TOKEN_KEY);
    store.removeItem(NAME_KEY);
  } catch (e) { /* fine */ }
  emit('crew:signed-off');
}

/** Push a piece of crew state upstream. Fire-and-forget; failures are
 * silent — memory sync is a grace, never an error the traveler sees. */
export async function pushCrewState(partial) {
  if (!token) return;
  try {
    await fetch('/api/crew/state', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...crewHeaders() },
      body: JSON.stringify(partial),
    });
  } catch (e) { /* offline */ }
}

export function initCrew() {
  // A stored token re-opens the record silently — no ceremony on a
  // machine the traveler already signed on from.
  if (token) {
    fetch('/api/crew/state', { headers: crewHeaders() })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data) => {
        crewName = data.name;
        emit('crew:signed-on', {
          name: data.name, notes: data.notes || '', places: data.places || {},
          prefs: data.prefs || {}, stakes: data.stakes || [],
          outposts: data.outposts || [],
          credits: data.credits || 0, woPaid: data.woPaid || [],
          createdAt: data.createdAt || 0, assigned: !!data.assigned,
          // Days since the last shift touched the record — for the
          // resumption card. lastSeen predates this boot's own GET.
          lastShiftDays: data.lastSeen ? (Date.now() - data.lastSeen) / 86400000 : null,
        });
      })
      .catch((status) => {
        // 401 = the token aged out of the registry; quietly become a
        // guest again rather than erroring at boot.
        if (status === 401) signOff();
      });
  }

  // Ship preferences moved (music on/off, cabin volume, look-Y) —
  // upstream. Emitters send only their own keys, so accumulate: a lone
  // {lookInvert} push must never erase the music preference.
  const prefsAcc = {};
  on('crew:signed-on', ({ prefs }) => { Object.assign(prefsAcc, prefs || {}); });
  let prefsTimer = null;
  on('prefs:changed', (prefs) => {
    Object.assign(prefsAcc, prefs || {});
    if (prefsTimer) clearTimeout(prefsTimer);
    prefsTimer = setTimeout(() => { prefsTimer = null; pushCrewState({ prefs: prefsAcc }); }, 3000);
  });

  // Local place history moved — push it upstream, gently debounced.
  on('places:changed', (placeLog) => {
    pendingPlaces = placeLog;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      pushTimer = null;
      const places = pendingPlaces;
      pendingPlaces = null;
      pushCrewState({ places });
    }, 4000);
  });
}
