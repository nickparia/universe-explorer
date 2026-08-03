// workorders.js — the company's work orders.
//
// The quest architecture (agreed 2026-08-03): THE COMPANY is the
// source — flat, written, transactional; STRUCTURE is the truth —
// progress computed from real counters, never from prose; SOL is the
// voice — narrating arrivals and closures, appraising, judging, but
// issuing nothing. Orders speak in TERMS, not waypoints: where and
// how are the traveler's problem, and the chart's quiet data is the
// only help they get.
//
// Payoffs ride three clocks: the act answers instantly (elsewhere),
// the account accrues visibly (here), and the works compound while
// away (outposts). Wages are credited exactly once per order — the
// paid set persists locally and in the crew record.

import { on } from './bus.js';
import { companionSay } from './shipchat.js';
import { pushCrewState } from './crew.js';

const CREDITS_KEY = 'solace_credits_v1';
const PAID_KEY = 'solace_wo_paid_v1';
const LANDFALL_KEY = 'solace_landfall_v1';
const ORE_KEY = 'solace_ore_v1';

const int = (k) => { try { return parseInt(localStorage.getItem(k) || '0', 10) || 0; } catch (e) { return 0; } };
const arr = (k) => { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch (e) { return []; } };
const flag = (k) => { try { return localStorage.getItem(k) === '1'; } catch (e) { return false; } };

// The first chain — each order's completion is a pure read of real
// state, so any device (and the sim) computes the same ledger.
const ORDERS = [
  {
    id: '0001', title: 'MAKE LANDFALL', target: 1,
    terms: 'set boots on the survey site · coprates chasma, mars',
    credits: 60,
    progress: () => (flag(LANDFALL_KEY) ? 1 : 0),
  },
  {
    id: '0002', title: 'FILE THREE SURVEYS', target: 3,
    terms: 'plant survey stakes — only verified ground pays',
    credits: 120, releases: 'EXTRACTOR BLUEPRINT',
    progress: () => int('solace_stakes_planted_v1'),
  },
  {
    id: '0003', title: 'ESTABLISH EXTRACTION', target: 1,
    terms: 'site one extractor on ground you have surveyed',
    credits: 200,
    progress: () => arr('solace_outposts_v1').length,
  },
  {
    id: '0004', title: 'FIRST DELIVERY', target: 100,
    terms: 'collect one hundred units of fe-ox from the works',
    credits: 340,
    progress: () => int(ORE_KEY),
  },
];

export function getOrders() { return ORDERS; }
export function getCredits() { return int(CREDITS_KEY); }

function paidSet() { return new Set(arr(PAID_KEY)); }

export function orderState(o) {
  const p = Math.min(o.target, o.progress());
  return { progress: p, done: p >= o.target, paid: paidSet().has(o.id) };
}

/** The open order — first unfinished in the chain (one at a time:
 *  the company is methodical, and focus is a kindness). */
export function activeOrder() {
  for (const o of ORDERS) if (!orderState(o).done) return o;
  return null;
}

/** Settle any completed-but-unpaid orders. Sol announces each closure
 *  once — the company's money, the first officer's voice. */
function settle() {
  const paid = paidSet();
  let credits = int(CREDITS_KEY);
  let changed = false;
  for (const o of ORDERS) {
    const st = orderState(o);
    if (!st.done || paid.has(o.id)) continue;
    paid.add(o.id);
    credits += o.credits;
    changed = true;
    const next = activeOrder();
    companionSay(
      'work order ' + o.id + ' is closed — the company credits your account ' +
      o.credits + '. ' +
      (o.releases ? 'they have released the ' + o.releases.toLowerCase() + '. ' : '') +
      (next ? 'a new order is on the wire: ' + next.title.toLowerCase() + '.' : 'the wire is quiet, for now.')
    );
  }
  if (changed) {
    try {
      localStorage.setItem(PAID_KEY, JSON.stringify([...paid]));
      localStorage.setItem(CREDITS_KEY, String(credits));
    } catch (e) { /* fine */ }
    pushCrewState({ credits, woPaid: [...paid] });
  }
}

export function initWorkOrders() {
  // Real acts move the ledger — settlement follows the same events
  // the world already emits. A breath of delay lets the act's own
  // payoff (pulse, appraisal) land before the money talk.
  on('ground:enter', () => {
    try { localStorage.setItem(LANDFALL_KEY, '1'); } catch (e) { /* fine */ }
    setTimeout(settle, 14000);
  });
  on('stake:planted', () => setTimeout(settle, 9000));
  on('outpost:placed', () => setTimeout(settle, 12000));
  on('outpost:collected', () => setTimeout(settle, 6000));

  // The record's ledger wins where it's ahead (another device paid)
  on('crew:signed-on', (data) => {
    try {
      if (typeof data.credits === 'number' && data.credits > int(CREDITS_KEY)) {
        localStorage.setItem(CREDITS_KEY, String(data.credits));
      }
      if (Array.isArray(data.woPaid)) {
        const merged = new Set([...arr(PAID_KEY), ...data.woPaid]);
        localStorage.setItem(PAID_KEY, JSON.stringify([...merged]));
      }
    } catch (e) { /* fine */ }
  });

  // Boot: anything completed offline settles quietly after arrival
  setTimeout(settle, 60000);
}
