// ground/outposts.js — the first outpost: the extractor.
//
// The keystone of the loop (docs/LOOP.md): the quest of a site is to
// establish refining infrastructure, and the challenge is PLACEMENT.
// An extractor may only stand on SURVEYED ground — the survey law:
// information is the gate — and its output rate is read from the land
// itself, through the covering stake's own answers: iron oxide in the
// regolith, sun-hours against the real horizon, the slope under the
// feet. A well-sited extractor runs while you're away (the honest
// clock); a poorly-sited one underperforms — the land teaches, and
// nothing is ever destroyed.
//
// The blueprint is EARNED: three surveys filed by hand and the company
// releases the extractor kit (the ten-times law's little brother —
// repetition begets capability, never a substitute for the doing).

import * as THREE from 'three';
import { heightAt } from './site.js';
import { getStakes, getPlantedCount, getSurveyRadius } from './stakes.js';
import { buildStage } from './build.js';
import { emit, on } from '../bus.js';
import { stepCrunch } from '../soundscape.js';
import { pushCrewState } from '../crew.js';

const KEY = 'solace_outposts_v1';
const MAX_OUTPOSTS = 8;
const UNLOCK_SURVEYS = 3;        // surveys filed before the kit is released
const MIN_SPACING = 30;          // m between extractors
const HOPPER_CAP = 400;          // units of fe-ox the hopper holds

// The construction ledger — real hours, visible on approach. A dev
// tab with ?fastbuild=1 runs the clock at 600×: stages in seconds.
const STAGES = [['SCAFFOLD', 2], ['FRAME', 6], ['MACHINERY', 16]];
const FAST = typeof location !== 'undefined' &&
  new URLSearchParams(location.search).has('fastbuild');
const CLOCK = FAST ? 600 : 1;

let group = null;
let outposts = [];   // { x, z, t, n, rate, hopperFrom, mesh, parts }
let pushTimer = null;

function now() { return Date.now(); }
/** Wall-clock ms scaled by the dev clock (fastbuild compresses hours). */
function elapsedMs(sinceMs) { return (now() - sinceMs) * CLOCK; }

// ── What the land pays — the rate is READ, not rolled ────────────────

/** The covering stake, or null: the survey law's gate. */
export function coveringStake(x, z) {
  let best = null, bd = Infinity;
  for (const st of getStakes()) {
    const d = Math.hypot(st.x - x, st.z - z);
    if (d <= (st.r || getSurveyRadius()) && d < bd) { bd = d; best = st; }
  }
  return best;
}

/** Units of fe-ox per hour this ground yields — legible arithmetic
 *  from the stake's own readings, so placement skill IS terrain
 *  literacy: ore in the ground × sun to run on × a stable stance. */
export function yieldAt(x, z) {
  const st = coveringStake(x, z);
  if (!st || !st.readings) return null;
  const r = st.readings;
  const ore = (r.feox || 40) / 55;                       // 0.7..1.3
  const sun = Math.min(1.2, (r.sunHours || 6) / 8);      // shadowed walls starve it
  const slope = Math.max(0.45, 1 - (r.slopePct || 0) / 60);
  const rough = r.roughness === 'BLOCKY' ? 0.85 : r.roughness === 'RUBBLED' ? 0.95 : 1;
  return {
    stake: st,
    perHour: Math.round(10 * ore * sun * slope * rough * 10) / 10,
  };
}

export function isExtractorUnlocked() { return getPlantedCount() >= UNLOCK_SURVEYS; }
export function surveysUntilUnlock() { return Math.max(0, UNLOCK_SURVEYS - getPlantedCount()); }

// ── The machine's body, stage by stage ───────────────────────────────

function lambert(color, emissive, ei) {
  const m = new THREE.MeshLambertMaterial({ color });
  if (emissive) { m.emissive = new THREE.Color(emissive); m.emissiveIntensity = ei || 1; }
  return m;
}

/** Build the full mesh; stages reveal parts as the clock passes. */
function buildExtractorMesh(x, z) {
  const g = new THREE.Group();
  const parts = {};

  // SCAFFOLD: four corner posts and a perimeter of pipe
  const scaffold = new THREE.Group();
  for (const [dx, dz] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 6), lambert(0x8a8f96));
    post.position.set(dx, 1.2, dz);
    scaffold.add(post);
  }
  const rail = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.06, 3.4), lambert(0x6a6f76));
  rail.position.y = 2.35;
  scaffold.add(rail);
  g.add(scaffold);
  parts.scaffold = scaffold;

  // FRAME: the squat body
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.5, 2.6), lambert(0x9a8f82));
  body.position.y = 0.75;
  g.add(body);
  parts.frame = body;

  // MACHINERY: drill mast, flywheel, hopper
  const machinery = new THREE.Group();
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 2.6, 8), lambert(0x555a60));
  mast.position.y = 2.6;
  machinery.add(mast);
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.09, 8, 20), lambert(0x777c84));
  wheel.position.set(0, 1.9, 1.15);
  machinery.add(wheel);
  const hopper = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.45, 1.1, 8), lambert(0x8a6f52));
  hopper.position.set(1.55, 0.85, -0.9);
  machinery.add(hopper);
  // The work light: dark until ONLINE, then the site's amber heartbeat
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.08),
    lambert(0x2c2c30, 0xff9a3c, 0));
  lamp.position.set(0, 3.7, 0);
  machinery.add(lamp);
  g.add(machinery);
  parts.machinery = machinery;
  parts.wheel = wheel;
  parts.lamp = lamp;

  g.position.set(x, heightAt(x, z), z);
  return { mesh: g, parts };
}

/** Reveal parts according to the stage the honest clock has reached. */
function dressForStage(o) {
  const st = stageOf(o);
  o.parts.scaffold.visible = st.stage < 3;             // scaffold comes DOWN when online
  o.parts.frame.visible = st.stage >= 1;
  o.parts.machinery.visible = st.stage >= 2;
  o.parts.lamp.material.emissiveIntensity = st.frac >= 1 ? 1.6 : 0;
  return st;
}

// ── State: the honest clock answers everything ───────────────────────

export function stageOf(o) {
  // buildStage reads Date.now(); feed it a virtual commit time so the
  // fastbuild clock compresses the same arithmetic.
  const virtualT = now() - elapsedMs(o.t);
  return buildStage(virtualT, STAGES);
}

/** Hopper units accrued since last collection (capped). */
export function hopperOf(o) {
  const st = stageOf(o);
  if (st.frac < 1) return 0;
  const totalBuildH = STAGES.reduce((a, [, h]) => a + h, 0);
  const onlineAtMs = o.t + (totalBuildH * 3600000) / CLOCK;   // real ms when it came online
  const from = Math.max(o.hopperFrom || 0, onlineAtMs);
  const hours = Math.max(0, elapsedMs(from) / 3600000);        // virtual hours since
  return Math.min(HOPPER_CAP, Math.round(o.rate * hours));
}

/** DIEGETIC hours until the works complete (0 when online) — always
 *  spoken in the ledger's own scale, whatever the dev clock does. */
export function etaHours(o) {
  const totalH = STAGES.reduce((a, [, h]) => a + h, 0);
  return Math.max(0, totalH - elapsedMs(o.t) / 3600000);
}

// ── Lifecycle ────────────────────────────────────────────────────────

export function initOutposts(parentGroup) {
  group = new THREE.Group();
  parentGroup.add(group);
  outposts = [];
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { /* fine */ }
  for (const o of saved.slice(0, MAX_OUTPOSTS)) restore(o);
}

on('crew:signed-on', (data) => {
  if (!Array.isArray(data.outposts) || !group) return;
  for (const o of data.outposts) {
    if (outposts.length >= MAX_OUTPOSTS) break;
    if (outposts.some((e) => Math.hypot(e.x - o.x, e.z - o.z) < 2)) continue;
    restore(o);
  }
  persist();
});

function restore(o) {
  const { mesh, parts } = buildExtractorMesh(o.x, o.z);
  group.add(mesh);
  outposts.push({
    x: o.x, z: o.z, t: o.t || now(), n: o.n || outposts.length + 1,
    rate: o.rate || 6, hopperFrom: o.hopperFrom || 0, mesh, parts,
  });
}

export function disposeOutposts() {
  if (group && group.parent) group.parent.remove(group);
  for (const o of outposts) {
    o.mesh.traverse((m) => { if (m.geometry) m.geometry.dispose(); if (m.material) m.material.dispose(); });
  }
  group = null;
  outposts = [];
}

function persist() {
  const flat = outposts.map(({ x, z, t, n, rate, hopperFrom }) => ({ x, z, t, n, rate, hopperFrom }));
  try { localStorage.setItem(KEY, JSON.stringify(flat)); } catch (e) { /* fine */ }
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    pushCrewState({ outposts: flat });
  }, 2500);
}

export function getOutposts() { return outposts; }

/** The ledger without the world: plain records straight from storage,
 *  for surfaces that live aboard (roster, resumption card, Sol) —
 *  stageOf/hopperOf/etaHours all work on these. */
export function readOutpostRecords() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { return []; }
}

/** Real-clock ms at which an outpost's construction completes. */
export function onlineAtMs(o) {
  const totalH = STAGES.reduce((a, [, h]) => a + h, 0);
  return o.t + (totalH * 3600000) / CLOCK;
}

export function nearestOutpost(x, z) {
  let best = null, bd = Infinity;
  for (const o of outposts) {
    const d = Math.hypot(o.x - x, o.z - z);
    if (d < bd) { bd = d; best = o; }
  }
  return best ? { outpost: best, dist: bd } : null;
}

/** Empty the hopper (E beside an online extractor). Returns units.
 *  Collected ore accrues to the lifetime ledger — deliveries are what
 *  the company's work orders count. */
export function collectHopper(o) {
  const units = hopperOf(o);
  if (units <= 0) return 0;
  o.hopperFrom = now();
  persist();
  try {
    const total = (parseInt(localStorage.getItem('solace_ore_v1') || '0', 10) || 0) + units;
    localStorage.setItem('solace_ore_v1', String(total));
    pushCrewState({ ore: total });
  } catch (e) { /* fine */ }
  stepCrunch(0.9, true);
  emit('outpost:collected', { n: o.n, units });
  return units;
}

// ── The placement registration — the engine does the rest ────────────

export function extractorDef() {
  return {
    key: 'extractor',
    footR: 2.3,
    feet: [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]],
    // Permissive on purpose: the LOOP law says poor ground UNDERPERFORMS
    // (the rate already reads slope) — outright refusal is for cliffs.
    maxSlope: 0.6,
    minSpacing: (x, z) => {
      const near = nearestOutpost(x, z);
      return near && near.dist < MIN_SPACING ? MIN_SPACING - near.dist : 0;
    },
    // The survey law gates the commit: unsurveyed ground refuses the
    // machine — you cannot build on an estimate.
    canCommit: (x, z) => outposts.length < MAX_OUTPOSTS && !!yieldAt(x, z),
    makeGhost: () => buildExtractorMesh(0, 0).mesh,
    onCommit: (x, z) => place(x, z),
  };
}

function place(x, z) {
  if (outposts.length >= MAX_OUTPOSTS) return null;
  const y = yieldAt(x, z);
  if (!y) return null;   // unsurveyed — the engine's canCommit guard rides on the HUD
  const n = outposts.length + 1;
  const { mesh, parts } = buildExtractorMesh(x, z);
  group.add(mesh);
  const o = { x, z, t: now(), n, rate: y.perHour, hopperFrom: 0, mesh, parts };
  outposts.push(o);
  persist();
  stepCrunch(1.2, true);
  emit('outpost:placed', {
    n, rate: y.perHour,
    readings: y.stake.readings, stakeN: y.stake.n,
  });
  return o;
}

// ── Per-frame: stages reveal, the wheel turns, the lamp breathes ─────

export function updateOutposts(dt) {
  if (!group) return;
  const t = now();
  for (const o of outposts) {
    const st = dressForStage(o);
    if (st.frac >= 1) {
      // The slow work: flywheel turning, lamp on the site's heartbeat
      o.parts.wheel.rotation.z += dt * 0.9;
      o.parts.lamp.material.emissiveIntensity = 1.1 + Math.sin(t * 0.0021 + o.n) * 0.6;
    }
  }
}
