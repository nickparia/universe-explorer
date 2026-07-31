// ground/sky.js — the Martian sky, sun, and light rig.
//
// A camera-centered gradient dome: butterscotch at the horizon fading
// to a dark dusty mauve overhead — thin air doesn't light the zenith.
// The sun is drawn in the same shader (bright core so bloom catches
// it), with Mars's signature inversion: the sky is warm, but the halo
// AROUND the sun is cool blue — dust forward-scatters blue light. At
// dusk the whole west goes indigo around the sinking sun.
//
// One slow arc drives everything: the dome shader, the directional
// sun, the hemisphere fill, and the fog color all read the same sun
// state, so the light always agrees with the sky.

import * as THREE from 'three';

const DOME_R = 180000;

// The compressed sol: bootfall at late afternoon, sunset in about
// twenty real minutes, a long indigo twilight, then the light returns.
// Feel-first for Phase 0 — the real Mars clock can arrive with Phase 1.
const SOL_SECONDS = 8600;          // full cycle ≈ 2.4 h real
const START_T = 0.645;             // late afternoon, sun low in the west

let dome = null, mat = null;
let sunLight = null, hemi = null, fill = null;
let fog = null;
// Dev: /?solt=0.70 starts the sol at a chosen phase (sunset ≈ 0.707)
let solT = (() => {
  try {
    const p = new URLSearchParams(location.search).get('solt');
    if (p !== null) { const v = parseFloat(p); if (v >= 0 && v < 1) return v; }
  } catch (e) { /* non-browser */ }
  return START_T;
})();
const sunDir = new THREE.Vector3(0, 1, 0);
let sunElevDeg = 30;

const COL = {
  horizonDay: new THREE.Color('#c99771'),
  horizonDusk: new THREE.Color('#7c5a52'),
  zenithDay: new THREE.Color('#5d4032'),
  zenithNight: new THREE.Color('#0b0908'),
  duskBlue: new THREE.Color('#8fa4c8'),
  sunWarm: new THREE.Color('#ffe0b8'),
  fogDay: new THREE.Color('#b98a68'),
  fogNight: new THREE.Color('#191210'),
};

export function initSky(parentGroup, scene) {
  mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    uniforms: {
      uSunDir: { value: sunDir },
      uHorizon: { value: new THREE.Color() },
      uZenith: { value: new THREE.Color() },
      uDusk: { value: COL.duskBlue },
      uSunCol: { value: COL.sunWarm },
      uDay: { value: 1.0 },     // 0 night … 1 day
      uLow: { value: 0.0 },     // how low the sun is (dusk factor)
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */`
      varying vec3 vDir;
      uniform vec3 uSunDir, uHorizon, uZenith, uDusk, uSunCol;
      uniform float uDay, uLow;
      void main() {
        vec3 dir = normalize(vDir);
        float elev = dir.y;
        // Vertical gradient — thin air: horizon band is shallow
        float t = pow(clamp(elev, 0.0, 1.0), 0.38);
        vec3 sky = mix(uHorizon, uZenith, t);
        // Below the horizon the dome darkens into ground haze.
        // (edge0 < edge1 always — reversed edges are UB in GLSL and
        // rendered this whole dome black on ANGLE/Metal.)
        sky = mix(sky, uZenith * 0.55, smoothstep(0.0, 0.12, -elev));

        float d = dot(dir, uSunDir);
        // Blue dusk glow around the sun — the Mars inversion. Wide at
        // sunset, subtle at midday.
        float blue = pow(max(d, 0.0), 14.0) * (0.12 + 0.88 * uLow);
        sky = mix(sky, uDusk, blue * 0.65 * uDay);
        // Warm inner halo
        sky += uSunCol * pow(max(d, 0.0), 240.0) * 0.55 * uDay;
        // The disc itself — hot enough to bloom
        float disc = smoothstep(0.999945, 0.999975, d);
        sky += uSunCol * disc * 5.0 * max(uDay, 0.08);
        // Night floor — never a dead black; dust remembers the light
        sky = max(sky, uZenith * 0.4);
        // The stars come out as the day factor dies — no light
        // pollution on Mars, so the night sky is the show. Hashed
        // cells on the dome; haze eats them near the horizon.
        float night = 1.0 - uDay;
        if (night > 0.03 && elev > 0.0) {
          vec2 sp = vec2(atan(dir.z, dir.x) * 44.5, asin(clamp(dir.y, -1.0, 1.0)) * 89.0);
          vec2 cell = floor(sp);
          vec2 fpt = fract(sp);
          float h = fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
          float h2 = fract(h * 91.17);
          vec2 spos = vec2(fract(h * 7.31), fract(h * 13.73)) * 0.8 + 0.1;
          float d = length(fpt - spos);
          float star = smoothstep(0.10, 0.015, d) * step(0.76, h2);
          float horizonFade = smoothstep(0.0, 0.18, elev);
          sky += vec3(0.82, 0.87, 1.0) * star * (0.25 + 0.75 * h) * night * horizonFade * 1.4;
        }
        gl_FragColor = vec4(sky, 1.0);
      }
    `,
  });
  dome = new THREE.Mesh(new THREE.SphereGeometry(DOME_R, 48, 24), mat);
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  dome.onBeforeRender = () => { if (typeof window !== 'undefined') window.__domeDrawn = (window.__domeDrawn || 0) + 1; };
  parentGroup.add(dome);

  sunLight = new THREE.DirectionalLight(0xffd9b0, 2.4);
  parentGroup.add(sunLight);
  parentGroup.add(sunLight.target);

  hemi = new THREE.HemisphereLight(0xb07a52, 0x2e1c14, 0.55);
  parentGroup.add(hemi);

  fill = new THREE.AmbientLight(0x40281c, 0.30);
  parentGroup.add(fill);

  // Thin: the far canyon rim must stay legible from the floor — at
  // 25 km this gives ~70% transmittance, haze without milk.
  fog = new THREE.FogExp2(COL.fogDay.getHex(), 1.45e-5);
  scene.fog = fog;

  updateSky(0, new THREE.Vector3());
}

export function disposeSky(scene) {
  if (dome) { dome.geometry.dispose(); mat.dispose(); }
  dome = null; mat = null; sunLight = null; hemi = null; fill = null;
  scene.fog = null;
  fog = null;
  solT = START_T;
}

export function getSunState() {
  return { elevDeg: sunElevDeg, dir: sunDir, t: solT };
}

export function debugSky() {
  return {
    dome: !!dome,
    visible: dome ? dome.visible : null,
    pos: dome ? dome.position.toArray().map((v) => +v.toFixed(1)) : null,
    day: mat ? +mat.uniforms.uDay.value.toFixed(2) : null,
    fog: !!fog,
    drawn: (typeof window !== 'undefined' && window.__domeDrawn) || 0,
    sunY: +sunDir.y.toFixed(2),
  };
}

export function updateSky(dt, camLocal) {
  if (!dome) return;
  // Asymmetric clock: the authored sol lingers in daylight and hurries
  // through the dark — night is an event (stars, the lamp, the cold),
  // not an 80-minute wall. Roughly 64 min of day, ~25 of night.
  const rate = sunElevDeg < 0 ? 3.0 : 0.9;
  solT = (solT + (dt * rate) / SOL_SECONDS) % 1;

  // Sun arc: a cosine day-curve — noon peaks at 38° toward the north
  // (we stand at 13°S), night bottoms at -14°. Azimuth runs east at
  // dawn (+x), north at noon (-z), west at dusk (-x).
  const phase = solT * Math.PI * 2;             // 0 = midnight
  const dayCurve = Math.max(0, -Math.cos(phase));
  const elev = -14 + 52 * Math.pow(dayCurve, 0.9);
  const elevR = THREE.MathUtils.degToRad(elev);
  const azim = Math.PI - phase;                 // east → north → west
  sunElevDeg = elev;
  sunDir.set(
    Math.cos(elevR) * Math.sin(azim),
    Math.sin(elevR),
    -Math.cos(elevR) * Math.cos(azim)
  ).normalize();

  // Day/dusk factors
  const day = THREE.MathUtils.smoothstep(sunElevDeg, -12, 6);
  const low = 1 - THREE.MathUtils.smoothstep(sunElevDeg, 2, 22);

  // Dome follows the camera; light aims through it
  dome.position.copy(camLocal);
  sunLight.position.copy(camLocal).addScaledVector(sunDir, 8000);
  sunLight.target.position.copy(camLocal);
  sunLight.intensity = 2.4 * day + 0.05;
  sunLight.color.copy(COL.sunWarm).lerp(new THREE.Color('#ff9e66'), low * 0.7);
  // Skylight: a dusty atmosphere scatters real light into the shade —
  // shadowed slopes must keep readable texture or walking over them
  // reads as standing still. Night floor is starlight, faintly cool.
  hemi.intensity = 0.38 + 0.40 * day;
  hemi.color.copy(new THREE.Color('#b07a52')).lerp(new THREE.Color('#5a6478'), 1 - day);
  fill.intensity = 0.26 + 0.18 * day;

  mat.uniforms.uHorizon.value.copy(COL.horizonDusk).lerp(COL.horizonDay, day)
    .lerp(new THREE.Color('#c97a4e'), low * day * 0.5);
  mat.uniforms.uZenith.value.copy(COL.zenithNight).lerp(COL.zenithDay, day);
  mat.uniforms.uDay.value = day;
  mat.uniforms.uLow.value = low;

  if (fog) {
    fog.color.copy(COL.fogNight).lerp(COL.fogDay, day);
  }
}
