// ground/stakes.js — survey stakes: the first mark a traveler leaves.
//
// The first thing you do on a world is ask it questions. A stake
// planted (E) surveys the ground it stands in: slope, real sun-hours
// integrated against the real horizon (the canyon wall genuinely
// shadows the morning), mineral signature, atmosphere. Its circle of
// verified ground appears on the charts — the orbital map shows you
// everything, but only surveyed ground is KNOWN. Stakes persist: in
// this browser always, in the crew record across every device.
//
// And the ten-times law begins here: every stake planted is counted.
// The traveler who has planted enough of them has earned the right to
// stop doing it by hand — that count is the trigger for the survey
// drone, when the workshop can build one.

import * as THREE from 'three';
import { heightAt, macroSlopeAt, getSite } from './site.js';
import { sunDirFor } from './sky.js';
import { stepCrunch } from '../soundscape.js';
import { emit, on } from '../bus.js';
import { pushCrewState } from '../crew.js';

const MAX_STAKES = 24;
// A hand stake verifies a kilometer of ground around it. The radius is
// stamped ON each stake at plant time (st.r) — future instruments
// (site drones, the mesh) will plant wider circles without touching
// the stakes already in the ground.
const SURVEY_RADIUS = 1000;     // m of verified ground per hand stake
const MIN_SPACING = 12;         // physical only — circles may overlap
const SUPPLY_MAX = 6;           // stakes carried; the lander fabricates more
const REGEN_MS = 5 * 60 * 1000; // one new stake every 5 real minutes
const KEY = 'solace_stakes_v1';
const COUNT_KEY = 'solace_stakes_planted_v1';
const SUPPLY_KEY = 'solace_stake_supply_v1';

let group = null;
let stakes = [];        // { x, z, t, n, readings, mesh }
let plantedCount = 0;
let nightLight = null;
let pushTimer = null;
let supply = SUPPLY_MAX;
let supplyT = Date.now();   // fabrication clock anchor
let pulses = [];            // shared pool of survey-pulse rings

function h32(a, b, c) {
  let h = (a * 374761393 + b * 668265263 + c * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ── The questions a stake asks ───────────────────────────────────────

function surveyReadings(x, z) {
  // slope, at both scales
  const macro = macroSlopeAt(x, z);
  const h0 = heightAt(x, z);
  const fine = Math.max(
    Math.abs(heightAt(x + 2, z) - h0),
    Math.abs(heightAt(x, z + 2) - h0)
  ) / 2;

  // Real sun-hours: sample the sol's arc, raycast each sun position
  // against the actual terrain horizon. The wall earns its shadows.
  let lit = 0, samples = 0;
  for (let t = 0.29; t < 0.71; t += 0.02) {
    const s = sunDirFor(t);
    if (s.elevDeg <= 0) continue;
    samples++;
    let blocked = false;
    for (let d = 60; d <= 5000; d *= 1.6) {
      const hT = heightAt(x + s.x * d, z + s.z * d);
      if (hT > h0 + 1.5 + s.y * d) { blocked = true; break; }
    }
    if (!blocked) lit++;
  }
  const sunFrac = samples ? lit / samples : 0;

  // Mineral signature — deterministic per location (the resource map
  // exists before the resource system does)
  const ix = Math.floor(x / 120), iz = Math.floor(z / 120);
  const feox = 38 + h32(ix, iz, 3) * 34;
  const sio2 = 14 + h32(ix, iz, 7) * 22;
  const ice = macro < 0.06 ? h32(ix, iz, 11) * 6 : 0;

  return {
    slopePct: Math.round(macro * 100),
    roughness: fine > 0.35 ? 'BLOCKY' : fine > 0.15 ? 'RUBBLED' : 'FIRM',
    sunHours: Math.round(sunFrac * 10.6 * 10) / 10,   // of a 10.6h sol day
    feox: Math.round(feox),
    sio2: Math.round(sio2),
    ice: Math.round(ice * 10) / 10,
    atmos: '6 MBAR CO₂ · NONTOXIC · SUIT REQUIRED',
  };
}

// ── The object itself ────────────────────────────────────────────────

function buildStakeMesh(x, z) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.035, 1.35, 6),
    new THREE.MeshLambertMaterial({ color: 0x8a8f96 })
  );
  pole.position.y = 0.675;
  g.add(pole);
  const head = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.1, 0.06),
    new THREE.MeshLambertMaterial({ color: 0x2c2c30, emissive: 0xff9a3c, emissiveIntensity: 1.4 })
  );
  head.position.y = 1.32;
  g.add(head);
  g.position.set(x, heightAt(x, z), z);
  return g;
}

export function initStakes(parentGroup) {
  group = new THREE.Group();
  parentGroup.add(group);
  // One shared light serves the nearest stake after dark
  nightLight = new THREE.PointLight(0xffa050, 0, 9, 1.6);
  group.add(nightLight);

  try { plantedCount = parseInt(localStorage.getItem(COUNT_KEY) || '0', 10) || 0; } catch (e) {}
  try {
    const sv = JSON.parse(localStorage.getItem(SUPPLY_KEY) || 'null');
    if (sv) { supply = sv.s; supplyT = sv.t; }
  } catch (e) {}
  regenSupply();
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) {}
  stakes = [];
  for (const st of saved.slice(0, MAX_STAKES)) restore(st);
}

// Crew record adoption: a signed-on traveler's stakes follow them to
// any machine. Local plants merge in; the union is pushed back.
on('crew:signed-on', (data) => {
  if (!Array.isArray(data.stakes) || !group) return;
  for (const st of data.stakes) {
    if (stakes.length >= MAX_STAKES) break;
    if (stakes.some((s) => Math.hypot(s.x - st.x, s.z - st.z) < 2)) continue;
    restore(st);
  }
  persist();
});

function restore(st) {
  const mesh = buildStakeMesh(st.x, st.z);
  group.add(mesh);
  // Stakes from before the radius was stamped adopt today's reach
  stakes.push({ x: st.x, z: st.z, t: st.t || Date.now(), n: st.n || stakes.length + 1,
    r: st.r || SURVEY_RADIUS,
    readings: st.readings || surveyReadings(st.x, st.z), mesh });
}

export function disposeStakes() {
  if (group && group.parent) group.parent.remove(group);
  for (const s of stakes) {
    s.mesh.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  }
  group = null;
  stakes = [];
  nightLight = null;
}

function regenSupply() {
  // The lander's fabricator works on the honest clock, here or away
  const now = Date.now();
  while (supply < SUPPLY_MAX && now - supplyT >= REGEN_MS) {
    supply++;
    supplyT += REGEN_MS;
  }
  if (supply >= SUPPLY_MAX) supplyT = now;
  try { localStorage.setItem(SUPPLY_KEY, JSON.stringify({ s: supply, t: supplyT })); } catch (e) {}
}

export function getSupply() { regenSupply(); return supply; }
export function getSupplyEta() {
  regenSupply();
  if (supply >= SUPPLY_MAX) return 0;
  return Math.max(0, REGEN_MS - (Date.now() - supplyT));
}

function persist() {
  const flat = stakes.map(({ x, z, t, n, r, readings }) => ({ x, z, t, n, r, readings }));
  try {
    localStorage.setItem(KEY, JSON.stringify(flat));
    localStorage.setItem(COUNT_KEY, String(plantedCount));
  } catch (e) { /* private mode */ }
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    pushCrewState({ stakes: flat.map(({ x, z, t, n }) => ({ x, z, t, n })) });
  }, 2500);
}

// ── Plant / uproot ───────────────────────────────────────────────────

export function nearestStake(x, z) {
  let best = null, bd = Infinity;
  for (const s of stakes) {
    const d = Math.hypot(s.x - x, s.z - z);
    if (d < bd) { bd = d; best = s; }
  }
  return best ? { stake: best, dist: bd } : null;
}

/** Uproot the stake within reach, if any. */
export function uprootNear(x, z) {
  const near = nearestStake(x, z);
  if (!(near && near.dist < 3)) return null;
  group.remove(near.stake.mesh);
  stakes = stakes.filter((s) => s !== near.stake);
  supply = Math.min(SUPPLY_MAX, supply + 1);   // recovered, not wasted
  try { localStorage.setItem(SUPPLY_KEY, JSON.stringify({ s: supply, t: supplyT })); } catch (e) {}
  persist();
  stepCrunch(0.7, false);
  emit('stake:uprooted', { n: near.stake.n });
  return near.stake;
}

/** Commit a stake at a surveyed-and-accepted spot (the engine calls this). */
export function plantAt(x, z) {
  regenSupply();
  if (stakes.length >= MAX_STAKES || supply <= 0) return null;
  if (supply === SUPPLY_MAX) supplyT = Date.now();  // fabricator starts now
  supply--;
  try { localStorage.setItem(SUPPLY_KEY, JSON.stringify({ s: supply, t: supplyT })); } catch (e) {}
  const n = ++plantedCount;
  const readings = surveyReadings(x, z);
  const mesh = buildStakeMesh(x, z);
  group.add(mesh);
  const stake = { x, z, t: Date.now(), n, r: SURVEY_RADIUS, readings, mesh };
  stakes.push(stake);
  persist();
  stepCrunch(1.1, true);   // driven into the regolith
  emit('stake:planted', { n, readings, count: plantedCount });
  return stake;
}

/** The stake's registration with the placement engine. */
export function stakeDef() {
  return {
    key: 'stake',
    footR: 0.9,
    feet: [[0, 0]],
    maxSlope: 0.55,
    minSpacing: (x, z) => {
      // Physical clearance only — survey circles are ALLOWED to
      // overlap; the stake supply throttles spamming, not a rule
      const near = nearestStake(x, z);
      return near && near.dist < MIN_SPACING ? MIN_SPACING - near.dist : 0;
    },
    canCommit: () => getSupply() > 0,
    makeGhost: () => buildStakeMesh(0, 0),
    onCommit: (x, z) => plantAt(x, z),
  };
}

export function getStakes() { return stakes; }
export function getPlantedCount() { return plantedCount; }
export function getSurveyRadius() { return SURVEY_RADIUS; }

// ── The stake LIVES: a survey pulse breathes out of it ───────────────
const PULSE_SEGS = 26;

function makePulseRing() {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((PULSE_SEGS + 1) * 2 * 3), 3));
  const idx = [];
  for (let i = 0; i < PULSE_SEGS; i++) {
    const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
    idx.push(a, b, c, b, d, c);
  }
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    color: 0xffa050, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false,
  }));
  mesh.frustumCulled = false;
  group.add(mesh);
  return { mesh, stake: null, t: 0 };
}

/** Night service + the living pulse. */
export function updateStakes(camLocal, sunElevDeg, dt = 0.016) {
  if (!nightLight) return;
  regenSupply();
  const near = nearestStake(camLocal.x, camLocal.z);
  if (near && near.dist < 30 && sunElevDeg < 2) {
    nightLight.position.set(near.stake.x, heightAt(near.stake.x, near.stake.z) + 1.35, near.stake.z);
    nightLight.intensity = 4;
  } else {
    nightLight.intensity = 0;
  }

  const now = Date.now();
  // Heads blink, staggered — each stake keeps its own beat; a fresh
  // stake (surveying, first 40 s) beats fast
  for (const st of stakes) {
    const head = st.mesh.children[1];
    if (head && head.material) {
      const fresh = now - st.t < 40000;
      head.material.emissiveIntensity = fresh
        ? 1.2 + Math.sin(now * 0.012 + st.n) * 0.9
        : 1.0 + Math.max(0, Math.sin(now * 0.0021 + st.n * 1.7)) * 0.8;
    }
  }

  // Pulse pool serves the three nearest stakes within sight — an
  // expanding ring that hugs the real terrain, sonar made visible
  while (pulses.length < 3) pulses.push(makePulseRing());
  const nearStakes = stakes
    .map((st) => ({ st, d: Math.hypot(st.x - camLocal.x, st.z - camLocal.z) }))
    .filter((e) => e.d < 260)
    .sort((a, b) => a.d - b.d)
    .slice(0, 3);
  pulses.forEach((p, i) => {
    const e = nearStakes[i];
    if (!e) { p.mesh.material.opacity = 0; p.stake = null; return; }
    if (p.stake !== e.st) { p.stake = e.st; p.t = 0; }
    const fresh = now - e.st.t < 40000;
    const period = fresh ? 1.5 : 6.5;
    p.t += dt;
    const ph = (p.t % period) / period;
    const R = 1.5 + ph * (fresh ? 16 : 11);
    const pos = p.mesh.geometry.attributes.position.array;
    for (let k = 0; k <= PULSE_SEGS; k++) {
      const a = (k / PULSE_SEGS) * Math.PI * 2;
      const ox = e.st.x + Math.cos(a) * R, oz = e.st.z + Math.sin(a) * R;
      const oy = heightAt(ox, oz) + 0.12;
      const inR = R - 0.55;
      pos[k * 6] = e.st.x + Math.cos(a) * inR;
      pos[k * 6 + 1] = heightAt(e.st.x + Math.cos(a) * inR, e.st.z + Math.sin(a) * inR) + 0.12;
      pos[k * 6 + 2] = e.st.z + Math.sin(a) * inR;
      pos[k * 6 + 3] = ox; pos[k * 6 + 4] = oy; pos[k * 6 + 5] = oz;
    }
    p.mesh.geometry.attributes.position.needsUpdate = true;
    p.mesh.material.opacity = (fresh ? 0.55 : 0.3) * (1 - ph) * (1 - Math.min(1, e.d / 260));
  });
}
