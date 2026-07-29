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

let token = null;
let crewName = null;
try {
  token = localStorage.getItem(TOKEN_KEY) || null;
  crewName = localStorage.getItem(NAME_KEY) || null;
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
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(NAME_KEY, crewName);
  } catch (e) { /* private mode — signed on for this session only */ }
  emit('crew:signed-on', { name: data.name, notes: data.notes || '', places: data.places || {} });
}

/** Sign off — the record stays in the registry; this ship forgets. */
export function signOff() {
  token = null;
  crewName = null;
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(NAME_KEY);
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
        emit('crew:signed-on', { name: data.name, notes: data.notes || '', places: data.places || {} });
      })
      .catch((status) => {
        // 401 = the token aged out of the registry; quietly become a
        // guest again rather than erroring at boot.
        if (status === 401) signOff();
      });
  }

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
