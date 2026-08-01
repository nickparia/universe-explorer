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
const SURVEY_RADIUS = 400;      // m of verified ground per stake
const KEY = 'solace_stakes_v1';
const COUNT_KEY = 'solace_stakes_planted_v1';

let group = null;
let stakes = [];        // { x, z, t, n, readings, mesh }
let plantedCount = 0;
let nightLight = null;
let pushTimer = null;

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
  stakes.push({ x: st.x, z: st.z, t: st.t || Date.now(), n: st.n || stakes.length + 1,
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

function persist() {
  const flat = stakes.map(({ x, z, t, n, readings }) => ({ x, z, t, n, readings }));
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
  persist();
  stepCrunch(0.7, false);
  emit('stake:uprooted', { n: near.stake.n });
  return near.stake;
}

/** Commit a stake at a surveyed-and-accepted spot (the engine calls this). */
export function plantAt(x, z) {
  if (stakes.length >= MAX_STAKES) return null;
  const n = ++plantedCount;
  const readings = surveyReadings(x, z);
  const mesh = buildStakeMesh(x, z);
  group.add(mesh);
  const stake = { x, z, t: Date.now(), n, readings, mesh };
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
      const near = nearestStake(x, z);
      return near && near.dist < SURVEY_RADIUS * 0.35 ? SURVEY_RADIUS * 0.35 - near.dist : 0;
    },
    makeGhost: () => buildStakeMesh(0, 0),
    onCommit: (x, z) => plantAt(x, z),
  };
}

export function getStakes() { return stakes; }
export function getPlantedCount() { return plantedCount; }
export function getSurveyRadius() { return SURVEY_RADIUS; }

/** Night service: the nearest stake glows for real. */
export function updateStakes(camLocal, sunElevDeg) {
  if (!nightLight) return;
  const near = nearestStake(camLocal.x, camLocal.z);
  if (near && near.dist < 30 && sunElevDeg < 2) {
    nightLight.position.set(near.stake.x, heightAt(near.stake.x, near.stake.z) + 1.35, near.stake.z);
    nightLight.intensity = 4;
  } else {
    nightLight.intensity = 0;
  }
}
