import * as THREE from 'three';
import { makePhotoLayers, addPhotoLayerStack } from './nebulae.js';
import { getPointTexture } from '../textures.js';

// ═══════════════════════════════════════════════════════════════════════
// Shared helpers
// ═══════════════════════════════════════════════════════════════════════

/** Cached 64px radial glow particle texture */
let _glowTex = null;
function getGlowTex() {
  if (_glowTex) return _glowTex;
  const sz = 64;
  const cv = document.createElement('canvas');
  cv.width = sz; cv.height = sz;
  const ctx = cv.getContext('2d');
  const grd = ctx.createRadialGradient(sz / 2, sz / 2, 0, sz / 2, sz / 2, sz / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1.0)');
  grd.addColorStop(0.3, 'rgba(255,255,255,0.5)');
  grd.addColorStop(0.7, 'rgba(255,255,255,0.1)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, sz, sz);
  _glowTex = new THREE.CanvasTexture(cv);
  return _glowTex;
}

/** Gaussian random number (Box-Muller transform) */
function gaussRandom() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

// ═══════════════════════════════════════════════════════════════════════
// 1. UY Scuti — Hypergiant star
// ═══════════════════════════════════════════════════════════════════════
export function createHypergiant(group, def) {
  // UY Scuti — a red hypergiant ~1700x the Sun's radius. No telescope
  // resolves its disc, so the accuracy source is what ALMA/VLT imaging
  // shows of Betelgeuse: a boiling surface with only a handful of
  // continent-sized convection cells, deep limb darkening, semi-regular
  // pulsation, and a vast dusty envelope shed by mass loss. Rendered as
  // an animated shader star — the only honest depiction is motion.
  const scale = def.size * (def._scaleUnit || 500);
  const starRadius = scale * 0.3;

  const starMat = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 } },
    vertexShader: `
      varying vec3 vN; varying vec3 vView;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalMatrix * normal;
        vView = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float time;
      varying vec3 vN; varying vec3 vView;
      float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float noise(vec3 x) { vec3 i = floor(x), f = fract(x);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
                       mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                       mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z); }
      float fbm(vec3 p) { float v = 0.0, a = 0.55;
        for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.07 + 11.3; a *= 0.5; }
        return v; }
      void main() {
        vec3 n = normalize(vN);
        float t = time * 0.03;
        // Domain-warped fbm: a few huge cells churning slowly — the
        // granulation scale that makes a hypergiant NOT look like a sun
        vec3 q = n * 2.6 + vec3(0.0, t * 0.6, t);
        vec3 warp = vec3(fbm(q + vec3(3.1)), fbm(q + vec3(7.7)), fbm(q + vec3(1.3)));
        float cells = fbm(q * 1.6 + warp * 1.9 - t * 0.5);
        cells = pow(max(cells, 0.0), 2.6) * 2.6;
        vec3 c1 = vec3(0.24, 0.045, 0.012);  // maroon shadow lanes
        vec3 c2 = vec3(0.62, 0.13, 0.03);    // deep red
        vec3 c3 = vec3(0.97, 0.42, 0.10);    // bright granule orange
        vec3 c4 = vec3(1.0, 0.82, 0.45);     // rare hotspot
        vec3 col = mix(c1, c2, smoothstep(0.15, 0.55, cells));
        col = mix(col, c3, smoothstep(0.55, 0.85, cells));
        col = mix(col, c4, smoothstep(0.88, 1.05, cells));
        // Deep limb darkening + rim reddening — cool molecular edge
        float mu = clamp(dot(n, normalize(vView)), 0.0, 1.0);
        col *= pow(mu, 1.2) * 0.92 + 0.04;
        col = mix(vec3(col.r * 0.85, col.g * 0.35, col.b * 0.2), col,
                  smoothstep(0.0, 0.35, mu));
        // Semi-regular variable: two incommensurate slow pulsations
        col *= 1.0 + 0.05 * sin(time * 0.11) + 0.04 * sin(time * 0.031 + 1.7);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const star = new THREE.Mesh(new THREE.SphereGeometry(starRadius, 64, 64), starMat);
  star.userData._onUpdate = (dt, mesh) => {
    mesh.material.uniforms.time.value += dt;
    mesh.rotation.y += dt * 0.006; // hypergiants rotate over years, not minutes
  };
  group.add(star);

  // Chromosphere + detached molecular shell (BackSide = soft interior glow)
  for (const sh of [
    { radiusMul: 1.14, color: 0xff3a08, opacity: 0.16 },
    { radiusMul: 1.6,  color: 0xa81f04, opacity: 0.05 },
  ]) {
    const mat = new THREE.MeshBasicMaterial({
      color: sh.color, transparent: true, opacity: sh.opacity,
      blending: THREE.AdditiveBlending, side: THREE.BackSide, depthWrite: false,
    });
    group.add(new THREE.Mesh(new THREE.SphereGeometry(starRadius * sh.radiusMul, 40, 40), mat));
  }

  // Dusty mass-loss envelope: nested glow sprites, the outermost offset —
  // hypergiants shed asymmetrically (VY CMa's plumes), never in neat shells
  const mkGlow = (sizeMul, color, opacity, ox, oy) => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: getGlowTex(), color, transparent: true, opacity,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    sp.scale.setScalar(starRadius * sizeMul);
    sp.position.set(ox * starRadius, oy * starRadius, 0);
    group.add(sp);
  };
  mkGlow(1.9, 0xff5512, 0.14, 0, 0);       // inner radiance
  mkGlow(4.0, 0xc02a06, 0.07, 0, 0);       // warm envelope
  mkGlow(8.0, 0x701403, 0.04, 0.9, 0.35);  // offset dust plume
  mkGlow(13.0, 0x400b02, 0.02, -0.5, -0.2); // far cold dust

  // Reference stars threading the Scutum field — scale needs witnesses
  {
    const count = 520;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3]     = (Math.random() - 0.5) * scale * 3.0;
      positions[i * 3 + 1] = (Math.random() - 0.5) * scale * 3.0;
      positions[i * 3 + 2] = (Math.random() * 2 - 1) * scale * 1.2;
      const warm = Math.random() < 0.55; // Scutum is a rich warm starfield
      const b = 0.14 + Math.random() * 0.5;
      colors[i * 3]     = (warm ? 1.0 : 0.75) * b;
      colors[i * 3 + 1] = (warm ? 0.78 : 0.85) * b;
      colors[i * 3 + 2] = (warm ? 0.55 : 1.0) * b;
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      size: 1.6, map: getPointTexture(), vertexColors: true,
      sizeAttenuation: false, blending: THREE.AdditiveBlending,
      transparent: true, opacity: 0.85, depthWrite: false,
    });
    group.add(new THREE.Points(geom, mat));
  }

  // Deep red light on anything nearby
  const light = new THREE.PointLight(0xff3300, 4, scale * 6);
  group.add(light);
}

// ═══════════════════════════════════════════════════════════════════════
// 2. Ring Nebula — Planetary nebula with dying white dwarf
// ═══════════════════════════════════════════════════════════════════════
export function createRingNebula(group, def, textures) {
  // Hubble's M57 (credit NASA/ESA/Hubble Heritage): the smoke-ring of a
  // dead sun — amber shell in front, blue-green heart behind, and the
  // scorching white dwarf as a hard spark at the center.
  const s = def.size * (def._scaleUnit || 500);

  const layers = textures && textures.landmarkRing
    ? makePhotoLayers(textures.landmarkRing, [
        { kind: 'full' },
        { kind: 'full', blurPx: 12 }, // star-free twin, SAME geometry — the
                                      // far identity; resolve = sharpen in
                                      // place, never a positional crossfade
        { kind: 'cool', lumLo: 150 },
        { kind: 'warm' },
      ])
    : null;
  if (layers) {
    addPhotoLayerStack(group, layers, [
      { z: -s * 0.26, scale: 1.2, opacity: 0.5, order: 2 },
      { z: -s * 0.26, scale: 1.2, opacity: 0.4, order: 2 },
      { z: -s * 0.06, scale: 1.0, opacity: 0.9, order: 3 },
      { z:  s * 0.16, scale: 0.98, opacity: 1.0, order: 4 },
    ], s * 1.25, 1.0);
  }

  // The white dwarf — smaller than Earth, hotter than almost anything
  {
    const core = new THREE.Sprite(new THREE.SpriteMaterial({
      map: getGlowTex(), color: 0xe8f2ff, blending: THREE.AdditiveBlending,
      transparent: true, opacity: 0.95, depthWrite: false,
    }));
    core.scale.set(s * 0.016, s * 0.016, 1);
    core.position.z = s * 0.05;
    core.renderOrder = 5;
    group.add(core);
  }

  // Field stars in true depth
  {
    const tex2 = getGlowTex();
    const count = 420;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3]     = (Math.random() - 0.5) * s * 2.4;
      positions[i * 3 + 1] = (Math.random() - 0.5) * s * 2.4;
      positions[i * 3 + 2] = (Math.random() * 2 - 1) * s * 0.9;
      const warm = Math.random() < 0.45;
      const b = 0.15 + Math.random() * 0.5;
      colors[i * 3]     = b * (warm ? 1.0 : 0.78);
      colors[i * 3 + 1] = b * (warm ? 0.8 : 0.86);
      colors[i * 3 + 2] = b * (warm ? 0.5 : 1.0);
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      vertexColors: true, map: tex2, size: s * 0.011, sizeAttenuation: true,
      blending: THREE.AdditiveBlending, transparent: true, opacity: 0.8,
      depthWrite: false,
    });
    const pts = new THREE.Points(geom, mat);
    pts.renderOrder = 6;
    group.add(pts);
  }
}

export function createEtaCarinae(group, def, textures) {
  // Hubble's Homunculus in ultraviolet (2019 — credit NASA/ESA/STScI):
  // two blast-lobes of a star tearing itself apart, magenta shrapnel
  // skirt behind, the blinding binary at the waist.
  const s = def.size * (def._scaleUnit || 500);

  const layers = textures && textures.landmarkEtaCar
    ? makePhotoLayers(textures.landmarkEtaCar, [
        { kind: 'full' },
        { kind: 'cool', lumLo: 150 },
        { kind: 'bright', lumLo: 135 },
      ])
    : null;
  if (layers) {
    addPhotoLayerStack(group, layers, [
      { z: -s * 0.28, scale: 1.24, opacity: 0.55, order: 2 },
      { z: -s * 0.05, scale: 1.0, opacity: 0.85, order: 3 },
      { z:  s * 0.16, scale: 0.94, opacity: 1.0, order: 4 },
    ], s * 1.35, 1805 / 1779);
  }

  // The doomed binary — a hard spark at the waist of the lobes
  {
    const core = new THREE.Sprite(new THREE.SpriteMaterial({
      map: getGlowTex(), color: 0xfff2e0, blending: THREE.AdditiveBlending,
      transparent: true, opacity: 0.9, depthWrite: false,
    }));
    core.scale.set(s * 0.022, s * 0.022, 1);
    core.position.z = s * 0.1;
    core.renderOrder = 5;
    group.add(core);
  }

  // Field stars in true depth
  {
    const tex2 = getGlowTex();
    const count = 600;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3]     = (Math.random() - 0.5) * s * 2.5;
      positions[i * 3 + 1] = (Math.random() - 0.5) * s * 2.5;
      positions[i * 3 + 2] = (Math.random() * 2 - 1) * s * 0.9;
      const warm = Math.random() < 0.6;
      const b = 0.15 + Math.random() * 0.5;
      colors[i * 3]     = b * (warm ? 1.0 : 0.78);
      colors[i * 3 + 1] = b * (warm ? 0.8 : 0.86);
      colors[i * 3 + 2] = b * (warm ? 0.5 : 1.0);
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      vertexColors: true, map: tex2, size: s * 0.011, sizeAttenuation: true,
      blending: THREE.AdditiveBlending, transparent: true, opacity: 0.8,
      depthWrite: false,
    });
    const pts = new THREE.Points(geom, mat);
    pts.renderOrder = 6;
    group.add(pts);
  }
}

export function createMagnetar(group, def) {
  // A magnetar is the most violent compact object there is — but it is
  // 20 km wide. The design law: CONCENTRATION. A blinding spark you
  // never resolve, wrapped in a twisted glowing magnetosphere, tilted
  // lighthouse beams sweeping on a seconds-long spin, and periodic
  // starquakes that flash the whole field structure. Menace, not bulk.
  const scale = def.size * (def._scaleUnit || 500);
  const tex = getGlowTex();

  // ── The spark ──────────────────────────────────────────────────────
  const spark = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, color: 0xdfeeff, blending: THREE.AdditiveBlending,
    transparent: true, opacity: 1.0, depthWrite: false,
  }));
  spark.scale.setScalar(scale * 0.05);
  group.add(spark);
  const innerGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, color: 0x9db8ff, blending: THREE.AdditiveBlending,
    transparent: true, opacity: 0.5, depthWrite: false,
  }));
  innerGlow.scale.setScalar(scale * 0.16);
  group.add(innerGlow);
  const violetGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, color: 0x7a5cff, blending: THREE.AdditiveBlending,
    transparent: true, opacity: 0.12, depthWrite: false,
  }));
  violetGlow.scale.setScalar(scale * 0.55);
  group.add(violetGlow);

  // ── Twisted magnetosphere ──────────────────────────────────────────
  // Dipole field lines at three L-shells, each line's azimuth advancing
  // with latitude — the twisted field that defines a magnetar. Rigidly
  // co-rotating, individually crackling.
  const fieldGroup = new THREE.Group();
  fieldGroup.rotation.z = 0.34; // magnetic axis tilted off the spin axis
  const fieldMats = [];
  const L_SHELLS = [0.15, 0.26, 0.4];
  for (let li = 0; li < L_SHELLS.length; li++) {
    const L = scale * L_SHELLS[li];
    const lines = 10;
    for (let f = 0; f < lines; f++) {
      const az0 = (f / lines) * Math.PI * 2 + li * 0.21;
      const pts = [];
      const steps = 90;
      for (let st = 0; st <= steps; st++) {
        const lat = -1.42 + (st / steps) * 2.84; // stop short of the poles
        const cosLat = Math.cos(lat);
        const r = L * cosLat * cosLat;
        if (r < scale * 0.012) continue;
        const az = az0 + Math.sin(lat) * 1.6; // the twist
        pts.push(new THREE.Vector3(
          r * cosLat * Math.cos(az), r * Math.sin(lat), r * cosLat * Math.sin(az)));
      }
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const mat = new THREE.LineBasicMaterial({
        color: li === 1 ? 0x9a6bff : 0x59c8ff,
        transparent: true, opacity: 0.0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      fieldMats.push({ mat, base: 0.30 - li * 0.07, f: 2.1 + Math.random() * 4.2, ph: Math.random() * 6.28 });
      fieldGroup.add(new THREE.Line(geo, mat));
    }
  }

  // ── Polar beams — along the magnetic axis, so they sweep as it spins
  for (const sign of [1, -1]) {
    const beamGeo = new THREE.CylinderGeometry(scale * 0.004, scale * 0.06, scale * 1.5, 12, 1, true);
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0x9fd8ff, transparent: true, opacity: 0.09,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.y = sign * scale * 0.76;
    if (sign < 0) beam.rotation.z = Math.PI;
    fieldGroup.add(beam);
    const cap = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, color: 0xbfe4ff, blending: THREE.AdditiveBlending,
      transparent: true, opacity: 0.35, depthWrite: false,
    }));
    cap.scale.setScalar(scale * 0.1);
    cap.position.y = sign * scale * 0.09;
    fieldGroup.add(cap);
  }
  group.add(fieldGroup);

  // ── Plasma wind haze — squashed magenta torus glow in the spin plane
  const torus = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, color: 0xc84a9a, blending: THREE.AdditiveBlending,
    transparent: true, opacity: 0.05, depthWrite: false,
  }));
  torus.scale.set(scale * 1.0, scale * 0.3, 1);
  group.add(torus);

  // ── Starquake flash machinery ──────────────────────────────────────
  const shock = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, color: 0xe8f4ff, blending: THREE.AdditiveBlending,
    transparent: true, opacity: 0, depthWrite: false,
  }));
  group.add(shock);

  let t = 0, quake = 0, quakeTimer = 5 + Math.random() * 6, shockAge = 1e9;
  fieldGroup.userData._onUpdate = (dt) => {
    t += dt;
    // Seconds-long rigid rotation: the lighthouse
    fieldGroup.rotation.y += dt * (Math.PI * 2 / 9);
    // Starquakes: the crust snaps, the whole field flashes
    quakeTimer -= dt;
    if (quakeTimer <= 0) { quake = 1; shockAge = 0; quakeTimer = 8 + Math.random() * 9; }
    quake *= Math.exp(-dt / 0.35);
    shockAge += dt;
    for (const e of fieldMats) {
      e.mat.opacity = e.base * (0.72 + 0.28 * Math.sin(t * e.f + e.ph)) * (1 + quake * 2.2);
    }
    spark.material.opacity = Math.min(1, 0.82 + 0.18 * Math.sin(t * 9.4) + quake);
    innerGlow.material.opacity = 0.5 + quake * 0.5;
    // Expanding flash shell after each quake
    if (shockAge < 1.6) {
      const p = shockAge / 1.6;
      shock.material.opacity = (1 - p) * (1 - p) * 0.5;
      shock.scale.setScalar(scale * (0.1 + p * 1.5));
    } else {
      shock.material.opacity = 0;
    }
  };

  // ── Isolation: sparse, cold, dim witnesses — no cozy star corridor
  {
    const count = 240;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3]     = (Math.random() - 0.5) * scale * 4.0;
      positions[i * 3 + 1] = (Math.random() - 0.5) * scale * 4.0;
      positions[i * 3 + 2] = (Math.random() * 2 - 1) * scale * 1.6;
      const b = 0.08 + Math.random() * 0.3;
      colors[i * 3] = 0.72 * b; colors[i * 3 + 1] = 0.8 * b; colors[i * 3 + 2] = b;
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    group.add(new THREE.Points(geom, new THREE.PointsMaterial({
      size: 1.4, map: getPointTexture(), vertexColors: true,
      sizeAttenuation: false, blending: THREE.AdditiveBlending,
      transparent: true, opacity: 0.8, depthWrite: false,
    })));
  }

  const light = new THREE.PointLight(0x88aaff, 3, scale * 4);
  group.add(light);
}
