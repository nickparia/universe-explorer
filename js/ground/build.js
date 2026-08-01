// ground/build.js — the placement engine.
//
// Everything ever built on a world goes through here. A placeable
// registers a definition — footprint, anchor feet, slope tolerance,
// spacing rules, build time, a ghost — and the engine provides the
// rest: the amber footprint ring projected onto the real terrain,
// foot markers that individually seat or float, spacing feedback,
// the cant of a ghost on ground that won't take it, and the commit.
// No grid, ever: the terrain is real and the projection conforms to
// it. The suit draws the plan on the land; the land answers.
//
// Build time is the engine's clock: a committed structure's stage is
// derived from commit-time plus wall-time (the honest-clock law), so
// construction continues while the traveler is away — deterministic,
// serverless, on any device.

import * as THREE from 'three';
import { heightAt } from './site.js';

let group = null;
let active = null;      // { def, ghost, ring, feet[], ok, seat }
const _p = new THREE.Vector3();

const RING_SEGS = 48;

export function initBuild(parentGroup) {
  group = new THREE.Group();
  parentGroup.add(group);
}

export function disposeBuild() {
  cancelPlacement();
  if (group && group.parent) group.parent.remove(group);
  group = null;
}

export function isPlacing() { return !!active; }
export function activeDef() { return active ? active.def : null; }

/**
 * Enter placement mode for a definition:
 * { key, footR, feet: [ [dx,dz], ... ], maxSlope, minSpacing(x,z)->m|0,
 *   makeGhost() -> Object3D, onCommit(x,z,seat) }
 */
export function beginPlacement(def) {
  cancelPlacement();
  const ghost = def.makeGhost();
  ghost.traverse((o) => {
    if (o.material) {
      o.material = o.material.clone();
      o.material.transparent = true;
      o.material.opacity = 0.42;
      o.material.depthWrite = false;
      if (o.material.emissive) o.material.emissive = new THREE.Color(0xff9a3c);
      if (o.material.emissiveIntensity !== undefined) o.material.emissiveIntensity = 0.7;
    }
  });
  group.add(ghost);

  // Footprint ring — conformed to the terrain every frame
  const ringGeo = new THREE.BufferGeometry();
  const ringPos = new Float32Array((RING_SEGS + 1) * 2 * 3);
  ringGeo.setAttribute('position', new THREE.BufferAttribute(ringPos, 3));
  const ringIdx = [];
  for (let i = 0; i < RING_SEGS; i++) {
    const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
    ringIdx.push(a, b, c, b, d, c);
  }
  ringGeo.setIndex(ringIdx);
  const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
    color: 0xffb066, transparent: true, opacity: 0.55,
    side: THREE.DoubleSide, depthWrite: false,
  }));
  ring.frustumCulled = false;
  group.add(ring);

  // Foot markers — each one tells the truth about its own ground
  const feet = (def.feet || [[0, 0]]).map(() => {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.06, 0.22),
      new THREE.MeshBasicMaterial({ color: 0xffb066, transparent: true, opacity: 0.9, depthWrite: false })
    );
    group.add(m);
    return m;
  });

  active = { def, ghost, ring, feet, ok: false, seat: 0, x: 0, z: 0 };
}

export function cancelPlacement() {
  if (!active) return;
  for (const m of [active.ghost, active.ring, ...active.feet]) {
    if (m.parent) m.parent.remove(m);
    m.traverse ? m.traverse((o) => { if (o.geometry) o.geometry.dispose(); }) : null;
  }
  active = null;
}

/** Commit if the ground accepts. Returns the def's result or null. */
export function commitPlacement() {
  if (!active || !active.ok) return null;
  const { def, x, z, seat } = active;
  cancelPlacement();
  return def.onCommit(x, z, seat);
}

/**
 * Per-frame: aim the ghost at a point ahead of the traveler, read the
 * ground under every foot, and let the projection tell the truth.
 */
export function updatePlacement(camLocal, yaw, roving) {
  if (!active) return null;
  const dist = roving ? 6.5 : 3.2;
  const x = camLocal.x - Math.sin(yaw) * dist;
  const z = camLocal.z - Math.cos(yaw) * dist;
  active.x = x; active.z = z;
  const def = active.def;

  // Feet: sample the real ground; seat quality is how flat the stance is
  const h0 = heightAt(x, z);
  let hMin = Infinity, hMax = -Infinity;
  const footWorld = [];
  for (let i = 0; i < (def.feet || [[0, 0]]).length; i++) {
    const [dx, dz] = def.feet[i];
    const fx = x + dx * Math.cos(yaw) - dz * Math.sin(yaw);
    const fz = z - dx * Math.sin(yaw) - dz * Math.cos(yaw);
    const fh = heightAt(fx, fz);
    hMin = Math.min(hMin, fh); hMax = Math.max(hMax, fh);
    footWorld.push([fx, fh, fz]);
  }
  const span = Math.max(0.001, def.footR * 2);
  const cant = (hMax - hMin) / span;               // rise/run across stance
  const seat = THREE.MathUtils.clamp(1 - cant / (def.maxSlope || 0.3), 0, 1);
  const spacing = def.minSpacing ? def.minSpacing(x, z) : 0;
  const ok = seat > 0.12 && spacing <= 0;
  active.ok = ok;
  active.seat = seat;

  // The ghost: seats flush on good ground, cants and floats on bad
  active.ghost.position.set(x, ok ? hMin + (hMax - hMin) * 0.4 : h0 + 0.25 * (1 - seat), z);
  active.ghost.rotation.set(
    ok ? 0 : (hMax - hMin) * 0.4, yaw, ok ? 0 : -(hMax - hMin) * 0.3
  );

  // Ring conforms to the land; its light dims where the ground refuses
  const pos = active.ring.geometry.attributes.position.array;
  for (let i = 0; i <= RING_SEGS; i++) {
    const a = (i / RING_SEGS) * Math.PI * 2;
    const cx = x + Math.cos(a) * def.footR, cz = z + Math.sin(a) * def.footR;
    const cy = heightAt(cx, cz) + 0.06;
    const inner = 0.86;
    pos[i * 6] = x + Math.cos(a) * def.footR * inner;
    pos[i * 6 + 1] = heightAt(x + Math.cos(a) * def.footR * inner, z + Math.sin(a) * def.footR * inner) + 0.06;
    pos[i * 6 + 2] = z + Math.sin(a) * def.footR * inner;
    pos[i * 6 + 3] = cx; pos[i * 6 + 4] = cy; pos[i * 6 + 5] = cz;
  }
  active.ring.geometry.attributes.position.needsUpdate = true;
  active.ring.material.opacity = ok ? 0.55 : 0.18;
  active.ring.material.color.setHex(ok ? 0xffb066 : 0xa66a4a);

  // Feet markers sit on their own ground — a floating foot is the tell
  active.feet.forEach((m, i) => {
    const [fx, fh, fz] = footWorld[i];
    m.position.set(fx, (ok ? fh : hMin) + 0.05, fz);
    m.material.opacity = ok ? 0.9 : 0.45;
  });

  return { ok, seat, spacing };
}

/**
 * The construction clock: derive a build stage purely from wall time.
 * stages: [['SCAFFOLD', hours], ['FRAME', hours], ...]; returns
 * { stage, label, frac } — frac 1 when complete.
 */
export function buildStage(committedAtMs, stages) {
  const elapsedH = (Date.now() - committedAtMs) / 3600000;
  let acc = 0, total = 0;
  for (const [, h] of stages) total += h;
  for (let i = 0; i < stages.length; i++) {
    acc += stages[i][1];
    if (elapsedH < acc) {
      return { stage: i, label: stages[i][0], frac: Math.min(1, elapsedH / total) };
    }
  }
  return { stage: stages.length, label: 'ONLINE', frac: 1 };
}
