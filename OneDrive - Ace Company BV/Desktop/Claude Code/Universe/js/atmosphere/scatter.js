// atmosphere/scatter.js — Atmospheric sky dome for surface/near-surface view
import * as THREE from 'three';
import { getAltitude } from '../altitude.js';
import { getPlanetConfig } from '../planetconfig.js';
import { getConfig } from '../perf.js';

// ── Sky dome shader ─────────────────────────────────────────────────
// Camera-relative: camera is always at origin, planet center is offset

const SkyVS = /* glsl */`
varying vec3 vWorldPos;
varying vec3 vViewDir;
uniform vec3 sunWorldPos;
varying vec3 vSunDir;

void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  vViewDir = normalize(worldPos.xyz); // camera at origin
  vSunDir = normalize(sunWorldPos);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SkyFS = /* glsl */`
uniform vec3 planetCenter;
uniform float planetRadius;
uniform vec3 skyColor;
uniform vec3 horizonColor;
uniform float density;
uniform float altNorm;
varying vec3 vWorldPos;
varying vec3 vViewDir;
varying vec3 vSunDir;

void main() {
  // "Up" = away from planet center
  vec3 up = normalize(-planetCenter);

  // View-up angle: +1 = looking straight up, -1 = straight down
  float upDot = dot(vViewDir, up);

  // SKY: only render above horizon. Below horizon = fully transparent (terrain shows through)
  if (upDot < -0.02) {
    discard;
  }

  // Gradient: zenith (looking up) → horizon (looking sideways)
  float zenithT = clamp(upDot, 0.0, 1.0);
  vec3 color = mix(horizonColor * 0.4, skyColor * 0.5, zenithT);

  // Horizon band glow — subtle
  float horizonBand = exp(-upDot * upDot * 30.0);
  color += horizonColor * horizonBand * 0.15;

  // Sun glow
  float sunDot = max(dot(vViewDir, vSunDir), 0.0);
  color += vec3(1.0, 0.95, 0.85) * pow(sunDot, 64.0) * 0.3;

  // Sun disk
  float sunDisk = smoothstep(0.9997, 0.9999, sunDot);
  color += vec3(1.0, 0.98, 0.9) * sunDisk * 3.0;

  // Sunset tint when sun is near horizon
  float sunHeight = dot(vSunDir, up);
  float sunsetT = pow(clamp(1.0 - abs(sunHeight), 0.0, 1.0), 2.0);
  color += vec3(0.9, 0.4, 0.15) * horizonBand * sunsetT * 0.3;

  // Alpha: subtle overhead, fades near horizon
  float alpha = clamp(zenithT * 0.6, 0.0, 0.55);
  // Soft fade near horizon
  if (upDot < 0.15) {
    alpha *= upDot / 0.15;
  }

  gl_FragColor = vec4(color, alpha);
}
`;

// ── Sky dome manager ─────────────────────────────────────────────────

let skyDome = null;
let skyMaterial = null;
let activePlanet = null;
let fogElement = null;

/**
 * Create or update the atmospheric sky dome.
 * Called each frame when near a planet surface.
 */
export function updateAtmosphere(scene, camPos, sunPos) {
  const alt = getAltitude();

  if (!alt.hasAtmosphere || alt.altitudeNorm > 0.5) {
    if (skyDome) skyDome.visible = false;
    if (fogElement) fogElement.style.opacity = 0;
    activePlanet = null;
    return;
  }

  const config = getPlanetConfig(alt.nearestBody);
  if (!config || !config.atmosphere || !config.atmosphere.hasAtmosphere) {
    if (skyDome) skyDome.visible = false;
    if (fogElement) fogElement.style.opacity = 0;
    return;
  }

  const atmo = config.atmosphere;

  // Create sky dome if needed
  if (!skyDome) {
    const geo = new THREE.SphereGeometry(1, 32, 32);

    skyMaterial = new THREE.ShaderMaterial({
      uniforms: {
        planetCenter:    { value: new THREE.Vector3() },
        planetRadius:    { value: 1 },
        sunWorldPos:     { value: new THREE.Vector3(0, 0, 0) },
        skyColor:        { value: new THREE.Vector3(0.3, 0.5, 0.9) },
        horizonColor:    { value: new THREE.Vector3(0.7, 0.8, 1.0) },
        density:         { value: 1.0 },
        altNorm:         { value: 0.0 },
      },
      vertexShader: SkyVS,
      fragmentShader: SkyFS,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
    });

    skyDome = new THREE.Mesh(geo, skyMaterial);
    skyDome.renderOrder = -1; // render before terrain
    scene.add(skyDome);
  }

  // Cache fog overlay element
  if (!fogElement) {
    fogElement = document.getElementById('atmo-fog');
  }

  // Scale dome to surround camera
  const domeSize = alt.bodyRadius * 0.8;
  skyDome.scale.setScalar(domeSize);
  skyDome.position.set(0, 0, 0); // camera is at origin
  skyDome.visible = true;

  // Update uniforms
  const u = skyMaterial.uniforms;
  // Planet center in camera-relative coords (camera at origin)
  u.planetCenter.value.copy(alt.body.g.position); // already camera-relative
  u.planetRadius.value = alt.bodyRadius;
  u.sunWorldPos.value.copy(sunPos || new THREE.Vector3(0, 0, 0));
  u.density.value = Math.min(atmo.density, 3);
  u.altNorm.value = alt.altitudeNorm;

  // Per-planet sky colors
  const skyColors = {
    EARTH: { sky: [0.25, 0.45, 0.85], horizon: [0.55, 0.70, 0.95] },
    MARS:  { sky: [0.65, 0.45, 0.30], horizon: [0.80, 0.60, 0.40] },
    VENUS: { sky: [0.70, 0.55, 0.20], horizon: [0.80, 0.65, 0.30] },
  };
  const sc = skyColors[alt.nearestBody] || { sky: [0.4, 0.5, 0.7], horizon: [0.6, 0.7, 0.8] };
  u.skyColor.value.set(sc.sky[0], sc.sky[1], sc.sky[2]);
  u.horizonColor.value.set(sc.horizon[0], sc.horizon[1], sc.horizon[2]);

  // Fade in/out based on altitude
  const fadeStart = 0.5;
  const fadeFull = 0.1;
  const fade = 1 - Math.max(0, Math.min(1, (alt.altitudeNorm - fadeFull) / (fadeStart - fadeFull)));
  skyMaterial.opacity = fade;

  // Fog overlay now handled by surface/surface.js

  activePlanet = alt.nearestBody;
}
