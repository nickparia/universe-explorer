// bus.js — tiny pub/sub event bus.
//
// Modules communicate through events instead of importing each other:
// the emitter doesn't know (or care) who listens. This is what keeps
// flight / navigation / starmap / music free of circular imports.
//
// Events currently in use:
//   'nav:target'      (name)               — a travel target was chosen
//   'flyto:start'     ({ name })           — autopilot fly-to began
//   'warp:start'      ({ name, duration }) — interstellar warp began
//   'warp:end'        ({ name, reason })   — warp finished: 'arrived' | 'cancelled'
//   'starmap:toggled' (isOpen)             — star map drawer opened/closed

const listeners = new Map();

export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => off(event, fn);
}

export function off(event, fn) {
  listeners.get(event)?.delete(fn);
}

export function emit(event, payload) {
  const set = listeners.get(event);
  if (!set) return;
  // Copy so a listener that unsubscribes mid-emit doesn't skip others
  for (const fn of [...set]) {
    try {
      fn(payload);
    } catch (err) {
      console.error(`[bus] listener for "${event}" threw`, err);
    }
  }
}
