// altitude.js — Continuous altitude tracking above nearest planet surface
import * as THREE from 'three';

const state = {
  nearestBody: null,
  distToCenter: Infinity,
  bodyRadius: 0,
  altitude: Infinity,
  altitudeNorm: Infinity,
  isGasGiant: false,
  hasAtmosphere: false,
  body: null,
};

const GAS_GIANTS = ['JUPITER', 'SATURN', 'URANUS', 'NEPTUNE'];
const ATMOSPHERE_BODIES = ['VENUS', 'EARTH', 'MARS', 'JUPITER', 'SATURN', 'URANUS', 'NEPTUNE'];

export function updateAltitude(camPos, allBodies) {
  let nearest = null;
  let minDist = Infinity;

  for (let i = 0; i < allBodies.length; i++) {
    const b = allBodies[i];
    if (!b.g || !b.r) continue;
    // Use true world position (not camera-relative shifted position)
    const bodyPos = b.g.userData._worldPos || b.g.position;
    const d = camPos.distanceTo(bodyPos);
    const surfDist = d - b.r;
    if (surfDist < minDist) {
      minDist = surfDist;
      nearest = b;
      state.distToCenter = d;
    }
  }

  if (nearest) {
    state.nearestBody = nearest.name;
    state.bodyRadius = nearest.r;
    state.altitude = Math.max(0, state.distToCenter - nearest.r);
    state.altitudeNorm = state.altitude / nearest.r;
    state.isGasGiant = GAS_GIANTS.indexOf(nearest.name) !== -1;
    state.hasAtmosphere = ATMOSPHERE_BODIES.indexOf(nearest.name) !== -1;
    state.body = nearest;
  } else {
    state.nearestBody = null;
    state.distToCenter = Infinity;
    state.bodyRadius = 0;
    state.altitude = Infinity;
    state.altitudeNorm = Infinity;
    state.isGasGiant = false;
    state.hasAtmosphere = false;
    state.body = null;
  }
}

export function getAltitude() {
  return state;
}
