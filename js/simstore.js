// simstore.js — the recruiting-office clean room.
//
// ?newhire=1 must show a STRANGER'S ship: no stakes already planted on
// Mars, no worlds in the log, no keycap hints retired, no resume pose.
// Rather than teach every module about the simulation, the persistence
// layer itself is swapped: in sim mode, window.localStorage IS a wiped
// sessionStorage — every module reads and writes the tab-local store
// without knowing, the machine's real history is never seen and never
// touched, and closing the tab burns the room down.
//
// This must run before ANY module touches storage at import time
// (crew.js reads its token at module scope) — keep this the FIRST
// import in main.js.

if (typeof location !== 'undefined' &&
    new URLSearchParams(location.search).has('newhire')) {
  try {
    sessionStorage.clear();   // cold EVERY load — a new stranger each time
    Object.defineProperty(window, 'localStorage', {
      get() { return sessionStorage; },
      configurable: true,
    });
  } catch (e) {
    // Storage sealed (rare) — the sim runs memoryless, which is at
    // least still a stranger.
  }
}
