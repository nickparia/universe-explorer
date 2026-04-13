// ── bodies.js ── Solar system bodies: Sun, planets, Moon, comets, asteroid & Kuiper belts
import * as THREE from 'three';
import { Lensflare, LensflareElement } from 'three/addons/objects/Lensflare.js';
import { getPointTexture } from './textures.js';
import { setWorldPos, getSunLight } from './engine.js';

import { AU } from './constants.js';
import { createSunShader, updateSun } from './sun.js';

// ── Lens flare texture generator ──
function makeFlareTex(size, innerColor, outerColor) {
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  const ctx = cv.getContext('2d');
  const grd = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
  grd.addColorStop(0, innerColor);
  grd.addColorStop(0.3, innerColor);
  grd.addColorStop(1, outerColor);
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(cv);
  return t;
}

// ── Module state ──
let sunGroup, sunMesh;
let planets = [];   // { name, desc, g (Group), r, mesh, orb, spd, angle, moonOrbit, clouds }
let bodies  = [];   // returned by getBodies()
let comets  = [];   // { g, mesh, trail, trailPositions, a, b, cx, angle, spd }
let moonRef = null; // reference to Earth's Moon entry
let earthRef = null;
let marsRef = null;
let jupiterRef = null;
let saturnRef = null;
let uranusRef = null;
let neptuneRef = null;
let moons = []; // { ref (planet entry), parentRef, dist, speed, angleOffset }
let elapsed = 0;
let auroraGroup = null; // Earth aurora sprites
let auroraAdded = false;

// ═══════════════════════════════════════════════════════════════
// Atmosphere Shader
// ═══════════════════════════════════════════════════════════════

const AtmoVS = `varying vec3 vN,vP;void main(){vN=normalize(normalMatrix*normal);vP=(modelViewMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const AtmoFS = `uniform vec3 col;uniform float coeff,pw;varying vec3 vN,vP;void main(){float d=coeff-dot(vN,normalize(-vP));if(d<=0.0)discard;float i=pow(d,pw);gl_FragColor=vec4(col*i,i);}`;

function mkAtm(r, color, coeff, pw) {
  return new THREE.Mesh(
    new THREE.SphereGeometry(r, 48, 48),
    new THREE.ShaderMaterial({
      uniforms: { col:{value:new THREE.Color(color)}, coeff:{value:coeff}, pw:{value:pw} },
      vertexShader: AtmoVS, fragmentShader: AtmoFS,
      side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false
    })
  );
}

// ═══════════════════════════════════════════════════════════════
// Earth special material helper
// ═══════════════════════════════════════════════════════════════

/**
 * Generate a normal map from a diffuse texture using Sobel filter on brightness.
 * Works for any planet — craters, mountains, cloud bands all get depth.
 * @param {THREE.Texture} diffuseTex — source diffuse texture
 * @param {number} strength — normal map intensity (1.0 = standard, 3.0 = deep)
 * @returns {THREE.Texture|null}
 */
function normalFromDiffuse(diffuseTex, strength = 2.0) {
  if (!diffuseTex || !diffuseTex.image) return null;
  try {
    const img = diffuseTex.image;
    const w = Math.min(img.width, 2048); // cap for performance
    const h = Math.min(img.height, 1024);
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    const src = ctx.getImageData(0, 0, w, h);
    const dst = ctx.createImageData(w, h);

    // Helper: get brightness at (x,y) with wrapping
    function bright(x, y) {
      x = ((x % w) + w) % w;
      y = Math.max(0, Math.min(h - 1, y));
      const i = (y * w + x) * 4;
      return (src.data[i] * 0.299 + src.data[i+1] * 0.587 + src.data[i+2] * 0.114) / 255;
    }

    // Sobel filter to compute normals
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const tl = bright(x-1, y-1), tc = bright(x, y-1), tr = bright(x+1, y-1);
        const ml = bright(x-1, y),                          mr = bright(x+1, y);
        const bl = bright(x-1, y+1), bc = bright(x, y+1), br = bright(x+1, y+1);

        const dx = (tr + 2*mr + br) - (tl + 2*ml + bl);
        const dy = (bl + 2*bc + br) - (tl + 2*tc + tr);

        // Normal vector
        const nx = -dx * strength;
        const ny = -dy * strength;
        const nz = 1;
        const len = Math.sqrt(nx*nx + ny*ny + nz*nz);

        const i = (y * w + x) * 4;
        dst.data[i]   = Math.floor((nx/len * 0.5 + 0.5) * 255);
        dst.data[i+1] = Math.floor((ny/len * 0.5 + 0.5) * 255);
        dst.data[i+2] = Math.floor((nz/len * 0.5 + 0.5) * 255);
        dst.data[i+3] = 255;
      }
    }

    ctx.putImageData(dst, 0, 0);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.LinearSRGBColorSpace;
    return t;
  } catch (e) {
    console.warn('[bodies] normalFromDiffuse failed:', e);
    return null;
  }
}

function invertSpecToRough(specTex) {
  if (!specTex || !specTex.image) return null;
  try {
    const img = specTex.image;
    const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
    const ctx = cv.getContext('2d'); ctx.drawImage(img, 0, 0);
    ctx.globalCompositeOperation = 'difference'; ctx.fillStyle = 'white'; ctx.fillRect(0, 0, cv.width, cv.height);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.LinearSRGBColorSpace; return t;
  } catch (e) { return null; }
}

// ═══════════════════════════════════════════════════════════════
// Orbit line helper
// ═══════════════════════════════════════════════════════════════

function makeOrbitLine(radiusAU) {
  const pts = [];
  const r = radiusAU * AU;
  const segs = Math.max(128, Math.floor(radiusAU * 16));
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
  }
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const mat = new THREE.LineBasicMaterial({ color: 0x334466, transparent: true, opacity: 0.18, depthWrite: false });
  return new THREE.Line(geo, mat);
}

// ═══════════════════════════════════════════════════════════════
// Saturn ring helper
// ═══════════════════════════════════════════════════════════════

function makeSaturnRing(r, tex) {
  const geo = new THREE.RingGeometry(r * 1.3, r * 2.6, 128);
  // Remap UVs so the texture spans inner->outer
  const pos = geo.attributes.position;
  const uv  = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getY(i); // RingGeometry is in XY plane
    const dist = Math.sqrt(x * x + z * z);
    const u = (dist - r * 1.3) / (r * 2.6 - r * 1.3);
    uv.setXY(i, u, 0.5);
  }
  const mat = new THREE.MeshStandardMaterial({
    map: tex, side: THREE.DoubleSide, transparent: true, depthWrite: false, opacity: 0.9,
    roughness: 0.8, metalness: 0
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI * 0.5;
  return mesh;
}

// ═══════════════════════════════════════════════════════════════
// Saturn ring shimmer — ice crystal glint particles
// ═══════════════════════════════════════════════════════════════

function makeSaturnRingShimmer(r) {
  const count = 500;  // sparse — just occasional glints
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = r * 1.4 + Math.random() * r * 1.1; // within the ring band
    positions[i * 3]     = Math.cos(angle) * dist;
    positions[i * 3 + 1] = (Math.random() - 0.5) * 0.5; // extremely thin
    positions[i * 3 + 2] = Math.sin(angle) * dist;

    const brightness = 0.6 + Math.random() * 0.4;
    colors[i * 3]     = brightness;
    colors[i * 3 + 1] = brightness * 0.95;
    colors[i * 3 + 2] = brightness * 0.9;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.PointsMaterial({
    size: 0.4, map: getPointTexture(), vertexColors: true, sizeAttenuation: true,
    transparent: true, opacity: 0.15, blending: THREE.AdditiveBlending, depthWrite: false
  });

  const pts = new THREE.Points(geo, mat);
  pts.rotation.x = -Math.PI * 0.5;
  return pts;
}

// ═══════════════════════════════════════════════════════════════
// createSolarSystem
// ═══════════════════════════════════════════════════════════════

export function createSolarSystem(scene, textures) {
  planets = [];
  bodies = [];
  comets = [];
  elapsed = 0;

  // ── Sun — animated plasma shader + prominences ──
  sunGroup = new THREE.Group();
  const sunShaderMat = createSunShader(800, sunGroup);
  sunMesh = new THREE.Mesh(
    new THREE.SphereGeometry(800, 96, 96),  // higher tessellation for vertex displacement
    sunShaderMat
  );
  sunGroup.add(sunMesh);

  // Corona glow — BackSide so they only show as halo AROUND the sun,
  // not stacking additively on top of the surface.
  [
    [810, 0xffdd88, 0.25],   // tight inner corona
    [830, 0xffbb55, 0.15],
    [870, 0xff9933, 0.08],
    [940, 0xff7722, 0.04],
    [1050, 0xff5511, 0.02],  // wide outer halo
    [1200, 0xff3300, 0.008],
  ].forEach(([r, c, a]) => {
      sunGroup.add(new THREE.Mesh(
        new THREE.SphereGeometry(r, 48, 48),
        new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: a, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide })
      ));
    });
  scene.add(sunGroup);
  setWorldPos(sunGroup, sunGroup.position);

  bodies.push({ name: 'SUN', desc: 'Our star. 4.6 billion years old, 1.4 million km diameter. 99.86% of the solar system mass.', g: sunGroup, r: 800 });

  // ── Sun Lens Flare — subtle, not overpowering ──
  {
    const flareTexture = makeFlareTex(256, 'rgba(255,240,200,0.5)', 'rgba(255,200,120,0)');
    const flareTexOrange = makeFlareTex(128, 'rgba(255,160,60,0.3)', 'rgba(255,100,20,0)');
    const flareTexBlue = makeFlareTex(64, 'rgba(130,180,255,0.2)', 'rgba(80,120,255,0)');

    const lensflare = new Lensflare();
    lensflare.addElement(new LensflareElement(flareTexture, 200, 0, new THREE.Color(0xffeedd)));
    lensflare.addElement(new LensflareElement(flareTexOrange, 120, 0.2, new THREE.Color(0xffaa44)));
    lensflare.addElement(new LensflareElement(flareTexBlue, 80, 0.4, new THREE.Color(0x8899ff)));

    const sunLight = getSunLight();
    if (sunLight) sunLight.add(lensflare);
  }

  // ── Earth material ──
  const roughFromSpec = invertSpecToRough(textures.earthSpec);
  const earthMat = new THREE.MeshStandardMaterial({
    map: textures.earth,
    normalMap: textures.earthNormal,
    normalScale: new THREE.Vector2(1.5, 1.5),
    roughnessMap: roughFromSpec || undefined,
    roughness: roughFromSpec ? 1 : 0.7,
    metalness: 0,
    emissiveMap: textures.earthNight,
    emissive: new THREE.Color(0xffeeaa),
    emissiveIntensity: 0.6,
  });

  // ── Planet definitions ──
  // Clean materials — 8K textures look great without generated normals.
  // Earth keeps its real normal map. All others use just diffuse + roughness.
  const defs = [
    { name: 'MERCURY', desc: 'Smallest planet. Cratered surface, extreme temperature swings of 600\u00B0C.',
      r: 19, orb: .387, spd: 4.15, atmC: null,
      mat: new THREE.MeshStandardMaterial({ map: textures.mercury, roughness: .9, metalness: 0 }) },

    { name: 'VENUS', desc: 'Hottest planet at 465\u00B0C. Thick sulphuric acid cloud cover.',
      r: 47, orb: .723, spd: 1.62, atmC: [52, 0xffcc55, .62, 4.2], venusClouds: true,
      mat: new THREE.MeshStandardMaterial({ map: textures.venus, roughness: .75, metalness: 0 }) },

    { name: 'EARTH', desc: 'Our home. 71% ocean. City lights visible on the dark side.',
      r: 50, orb: 1.0, spd: 1.0, atmC: [55, 0x55aaff, .52, 4.0], clouds: true,
      mat: earthMat },

    { name: 'MOON', desc: "Earth's only natural satellite. Tidally locked, 384,400 km away.",
      r: 14, orb: 1.0, spd: 1.0, moonOrbit: true, atmC: null,
      mat: new THREE.MeshStandardMaterial({ map: textures.moon, roughness: .9, metalness: 0 }) },

    { name: 'MARS', desc: 'The Red Planet. Valles Marineris \u2014 4,000 km canyon. Polar ice caps.',
      r: 27, orb: 1.524, spd: .531, atmC: [30, 0xff7755, .32, 7],
      mat: new THREE.MeshStandardMaterial({ map: textures.mars, roughness: .85, metalness: 0 }) },

    { name: 'JUPITER', desc: 'Largest planet. Great Red Spot \u2014 a storm for centuries.',
      r: 560, orb: 5.203, spd: .084, atmC: [590, 0xddaa55, .36, 5],
      mat: new THREE.MeshStandardMaterial({ map: textures.jupiter, roughness: .4, metalness: 0 }) },

    { name: 'SATURN', desc: 'Ring system spans 280,000 km yet averages ~10m thick.',
      r: 472, orb: 9.537, spd: .034, atmC: [496, 0xeedd88, .32, 5.5], rings: true,
      mat: new THREE.MeshStandardMaterial({ map: textures.saturn, roughness: .4, metalness: 0 }) },

    { name: 'URANUS', desc: 'Ice giant tilted 98\u00B0. Rotates on its side.',
      r: 200, orb: 19.19, spd: .012, atmC: [215, 0x99eeff, .5, 3.8],
      mat: new THREE.MeshStandardMaterial({ map: textures.uranus, roughness: .25, metalness: .1 }) },

    { name: 'NEPTUNE', desc: 'Windiest world. Storms reach 2,100 km/h. 165-year orbit.',
      r: 194, orb: 30.07, spd: .006, atmC: [208, 0x3366ff, .54, 4.2],
      mat: new THREE.MeshStandardMaterial({ map: textures.neptune, roughness: .25, metalness: .1 }) },

    { name: 'PLUTO', desc: 'Dwarf planet with a heart-shaped nitrogen glacier. 248-year orbit.',
      r: 9, orb: 39.48, spd: .004, atmC: null,
      mat: new THREE.MeshStandardMaterial({ map: textures.pluto, roughness: .85, metalness: 0 }) },
  ];

  // ── Build each planet ──
  defs.forEach((def) => {
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(def.r, 72, 72), def.mat);
    mesh.renderOrder = 10; // render after stars to ensure depth occlusion
    group.add(mesh);

    let cloudMesh = null;

    // Cloud layer (Earth)
    if (def.clouds) {
      cloudMesh = new THREE.Mesh(
        new THREE.SphereGeometry(def.r * 1.018, 72, 72),
        new THREE.MeshStandardMaterial({
          alphaMap: textures.earthClouds,
          transparent: true,
          opacity: 0.45,
          depthWrite: false,
          side: THREE.DoubleSide,
          color: 0xffffff,
        })
      );
      group.add(cloudMesh);
    }

    // Venus thick atmosphere cloud layer — fully opaque since Venus
    // is completely shrouded in clouds
    if (def.venusClouds && textures.venusAtmo) {
      const venusCloudMesh = new THREE.Mesh(
        new THREE.SphereGeometry(def.r * 1.03, 72, 72),
        new THREE.MeshStandardMaterial({
          map: textures.venusAtmo,
          roughness: 0.6,
          metalness: 0,
        })
      );
      group.add(venusCloudMesh);
    }

    // Atmosphere shells removed — the Fresnel shader created dark disk
    // artifacts on planet surfaces that couldn't be fixed with FrontSide,
    // BackSide, or discard. The planets look better without them.

    // Saturn rings
    if (def.rings) {
      group.add(makeSaturnRing(def.r, textures.saturnRing));
      group.add(makeSaturnRingShimmer(def.r));
    }

    // Axial tilts — applied to the whole group so rings tilt with the planet
    if (def.name === 'SATURN')  group.rotation.z = 26.7 * Math.PI / 180;  // 26.7°
    if (def.name === 'URANUS')  group.rotation.z = 97.8 * Math.PI / 180;  // 97.8° — on its side
    if (def.name === 'EARTH')   group.rotation.z = 23.4 * Math.PI / 180;  // 23.4°

    // Random starting angle
    const angle = Math.random() * Math.PI * 2;

    const entry = {
      name: def.name, desc: def.desc, g: group, r: def.r, mesh,
      orb: def.orb, spd: def.spd, angle,
      moonOrbit: !!def.moonOrbit, clouds: cloudMesh
    };

    if (def.moonOrbit) {
      // Moon - don't add orbit line, position is driven by Earth
      moonRef = entry;
      scene.add(group);
      setWorldPos(group, group.position);
    } else {
      // Place on orbit
      group.position.set(Math.cos(angle) * def.orb * AU, 0, Math.sin(angle) * def.orb * AU);
      scene.add(group);
      setWorldPos(group, group.position);
      // Orbit line
      const orbitLine = makeOrbitLine(def.orb);
      scene.add(orbitLine);
      setWorldPos(orbitLine, new THREE.Vector3(0, 0, 0));
    }

    if (def.name === 'EARTH')   earthRef = entry;
    if (def.name === 'MARS')    marsRef = entry;
    if (def.name === 'JUPITER') jupiterRef = entry;
    if (def.name === 'SATURN')  saturnRef = entry;
    if (def.name === 'URANUS')  uranusRef = entry;
    if (def.name === 'NEPTUNE') neptuneRef = entry;

    planets.push(entry);
    bodies.push({ name: def.name, desc: def.desc, g: group, r: def.r });
  });

  // ── Earth Aurora sprites ──
  buildEarthAurora(scene);

  // ── Planetary moons ──
  buildMoons(scene, textures);

  // ── Dwarf planets (procedural) ──
  buildDwarfPlanets(scene);

  // ── Spacecraft ──
  buildSpacecraft(scene);

  // ── Comets ──
  buildComets(scene);

  // ── Asteroid belt ──
  buildAsteroidBelt(scene);

  // ── Kuiper belt ──
  buildKuiperBelt(scene);
}

// ═══════════════════════════════════════════════════════════════
// Spacecraft
// ═══════════════════════════════════════════════════════════════

function buildSpacecraft(scene) {
  const craftDefs = [
    { name: 'VOYAGER 1', desc: 'Launched 1977. Farthest human-made object at 24.4 billion km. First to enter interstellar space (2012). Still transmitting.',
      dist: 163, angle: 1.2, size: 1.5, color: 0xffeedd },
    { name: 'VOYAGER 2', desc: 'Launched 1977. Only spacecraft to visit all four gas giants. Entered interstellar space 2018. Twin of Voyager 1.',
      dist: 137, angle: 3.8, size: 1.5, color: 0xffeedd },
    { name: 'NEW HORIZONS', desc: 'First to fly by Pluto (2015). Revealed a heart-shaped nitrogen glacier. Now exploring the Kuiper Belt.',
      dist: 60, angle: 5.1, size: 1.2, color: 0xddddff },
    { name: 'JWST', desc: 'James Webb Space Telescope at Sun-Earth L2 point. 6.5m gold mirror. Seeing the first galaxies formed after the Big Bang.',
      dist: 1.01, angle: null, size: 2, color: 0xffdd66 },  // angle=null means follow Earth
    { name: 'ISS', desc: 'International Space Station. 420 km altitude. Continuously crewed since 2000. Visible from Earth with naked eye.',
      dist: null, angle: null, size: 0.8, color: 0xffffff, orbitsEarth: true },
  ];

  craftDefs.forEach((def) => {
    const group = new THREE.Group();

    // Spacecraft body — small box + solar panels
    const bodyGeo = new THREE.BoxGeometry(def.size, def.size * 0.5, def.size * 0.8);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.6, metalness: 0.4 });
    const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    group.add(bodyMesh);

    // Solar panel "wings"
    const panelGeo = new THREE.BoxGeometry(def.size * 3, def.size * 0.05, def.size * 0.8);
    const panelMat = new THREE.MeshStandardMaterial({ color: 0x334488, roughness: 0.3, metalness: 0.5 });
    const panelMesh = new THREE.Mesh(panelGeo, panelMat);
    group.add(panelMesh);

    // Glowing beacon so it's visible from distance
    const beaconGeo = new THREE.SphereGeometry(def.size * 4, 24, 24);
    const beaconMat = new THREE.MeshBasicMaterial({
      color: def.color, transparent: true, opacity: 0.08,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide
    });
    group.add(new THREE.Mesh(beaconGeo, beaconMat));

    // Brighter inner beacon
    const innerGeo = new THREE.SphereGeometry(def.size * 1.5, 16, 16);
    const innerMat = new THREE.MeshBasicMaterial({
      color: def.color, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    group.add(new THREE.Mesh(innerGeo, innerMat));

    // Position
    if (def.orbitsEarth && earthRef) {
      // ISS — very close to Earth
      const ePos = earthRef.g.position;
      group.position.set(ePos.x + 52, 1, ePos.z);
      group.userData._isISS = true;
    } else if (def.angle === null && earthRef) {
      // JWST — follows Earth at L2 (slightly farther from Sun)
      const ePos = earthRef.g.position;
      const dir = ePos.clone().normalize();
      group.position.copy(dir.multiplyScalar(def.dist * AU));
      group.userData._isJWST = true;
    } else {
      // Deep space probes — fixed positions at given AU distance and angle
      group.position.set(
        Math.cos(def.angle) * def.dist * AU,
        (Math.random() - 0.5) * 200, // slight vertical offset
        Math.sin(def.angle) * def.dist * AU
      );
    }

    scene.add(group);
    setWorldPos(group, group.position);

    bodies.push({ name: def.name, desc: def.desc, g: group, r: def.size * 4 });
  });
}

// ═══════════════════════════════════════════════════════════════
// Planetary Moons
// ═══════════════════════════════════════════════════════════════

function buildMoons(scene, textures) {
  // Moon definitions: { name, desc, r, parentRef, dist, speed, tex }
  // dist = orbital distance from parent center (scene units)
  // speed = orbital speed multiplier (higher = faster orbit)
  const moonDefs = [
    // Mars moons
    { name: 'PHOBOS', desc: 'Tiny, irregular moon. Orbits so close it will break apart in 50M years.',
      r: 2, parentRef: marsRef, dist: 55, speed: 0.5, tex: textures.phobos },
    { name: 'DEIMOS', desc: 'Mars\u2019s smaller moon. Only 12 km across. Slowly drifting away.',
      r: 1.5, parentRef: marsRef, dist: 80, speed: 0.3, tex: textures.deimos },

    // Jupiter — Galilean moons
    { name: 'IO', desc: 'Most volcanically active body in the solar system. 400+ active volcanoes.',
      r: 14, parentRef: jupiterRef, dist: 700, speed: 0.25, tex: textures.io },
    { name: 'EUROPA', desc: 'Subsurface ocean beneath ice crust. Prime candidate for extraterrestrial life.',
      r: 12, parentRef: jupiterRef, dist: 850, speed: 0.18, tex: textures.europa },
    { name: 'GANYMEDE', desc: 'Largest moon in the solar system. Bigger than Mercury. Has its own magnetic field.',
      r: 20, parentRef: jupiterRef, dist: 1050, speed: 0.12, tex: textures.ganymede },
    { name: 'CALLISTO', desc: 'Most heavily cratered object in the solar system. 4.5 billion years of impacts.',
      r: 18, parentRef: jupiterRef, dist: 1250, speed: 0.08, tex: textures.callisto },

    // Saturn moons
    { name: 'TITAN', desc: 'Only moon with a dense atmosphere. Methane lakes and rain. Larger than Mercury.',
      r: 20, parentRef: saturnRef, dist: 1500, speed: 0.1, tex: textures.titan },
    { name: 'ENCELADUS', desc: 'Geysers of water ice erupt from the south pole. Subsurface ocean confirmed.',
      r: 10, parentRef: saturnRef, dist: 1350, speed: 0.18, tex: textures.enceladus },
    { name: 'MIMAS', desc: 'Herschel crater makes it look like the Death Star. Only 396 km across.',
      r: 8, parentRef: saturnRef, dist: 1280, speed: 0.25, tex: textures.mimas },

    // Uranus moons
    { name: 'TITANIA', desc: 'Largest moon of Uranus. Icy surface with massive canyons.',
      r: 10, parentRef: uranusRef, dist: 350, speed: 0.14, tex: textures.titania },
    { name: 'OBERON', desc: 'Outermost major moon of Uranus. Dark, cratered, ancient surface.',
      r: 9, parentRef: uranusRef, dist: 450, speed: 0.1, tex: textures.oberon },

    // Neptune moons
    { name: 'TRITON', desc: 'Captured Kuiper Belt object. Orbits backwards. Nitrogen geysers.',
      r: 11, parentRef: neptuneRef, dist: 380, speed: 0.15, tex: textures.triton },
  ];

  moonDefs.forEach((def) => {
    if (!def.parentRef) return; // parent planet not found

    const group = new THREE.Group();
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(def.r, 32, 32),
      new THREE.MeshStandardMaterial({ map: def.tex, roughness: 0.85, metalness: 0 })
    );
    mesh.renderOrder = 10;
    group.add(mesh);

    scene.add(group);
    setWorldPos(group, group.position);

    const angleOffset = Math.random() * Math.PI * 2;

    const entry = {
      name: def.name, desc: def.desc, g: group, r: def.r, mesh,
      orb: 0, spd: 0, angle: angleOffset, moonOrbit: true, clouds: null
    };

    moons.push({
      ref: entry,
      parentRef: def.parentRef,
      dist: def.dist,
      speed: def.speed,
      angleOffset
    });

    planets.push(entry);
    bodies.push({ name: def.name, desc: def.desc, g: group, r: def.r });
  });
}

// ═══════════════════════════════════════════════════════════════
// Dwarf Planets
// ═══════════════════════════════════════════════════════════════

function buildDwarfPlanets(scene) {
  const dwarfs = [
    { name: 'CERES', desc: 'Largest object in the asteroid belt. Dwarf planet, 940 km diameter.',
      r: 7, orb: 2.77, color: 0x888888, spd: 0.18 },
    { name: 'ERIS', desc: 'Most massive dwarf planet. Icy surface, 96 AU aphelion.',
      r: 18, orb: 67.7, color: 0xccddee, spd: 0.0016 },
  ];

  dwarfs.forEach((d) => {
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(d.r, 32, 32),
      new THREE.MeshStandardMaterial({ color: d.color, roughness: 0.9, metalness: 0 })
    );
    group.add(mesh);

    const angle = Math.random() * Math.PI * 2;
    group.position.set(Math.cos(angle) * d.orb * AU, 0, Math.sin(angle) * d.orb * AU);
    scene.add(group);
    setWorldPos(group, group.position);

    planets.push({ name: d.name, desc: d.desc, g: group, r: d.r, mesh, orb: d.orb, spd: d.spd, angle, moonOrbit: false, clouds: null });
    bodies.push({ name: d.name, desc: d.desc, g: group, r: d.r });
  });
}

// ═══════════════════════════════════════════════════════════════
// Earth Aurora
// ═══════════════════════════════════════════════════════════════

function buildEarthAurora(scene) {
  auroraGroup = new THREE.Group();
  auroraGroup.visible = false; // hidden until close

  const auroraColors = [0x44ff88, 0x44ff88, 0x8844ff, 0x44ff88];
  const earthR = 50;

  // North pole sprites
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2;
    const mat = new THREE.SpriteMaterial({
      map: getPointTexture(), color: auroraColors[i],
      blending: THREE.AdditiveBlending, transparent: true,
      opacity: 0.08 + Math.random() * 0.04, depthWrite: false
    });
    const sprite = new THREE.Sprite(mat);
    const dist = earthR * 1.04;
    sprite.position.set(Math.cos(angle) * 12, 48, Math.sin(angle) * 12);
    sprite.scale.set(18, 8, 1);
    sprite.userData._auroraAngle = angle;
    sprite.userData._auroraY = 48;
    auroraGroup.add(sprite);
  }

  // South pole sprites
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2 + 0.4;
    const mat = new THREE.SpriteMaterial({
      map: getPointTexture(), color: auroraColors[i],
      blending: THREE.AdditiveBlending, transparent: true,
      opacity: 0.08 + Math.random() * 0.04, depthWrite: false
    });
    const sprite = new THREE.Sprite(mat);
    sprite.position.set(Math.cos(angle) * 12, -48, Math.sin(angle) * 12);
    sprite.scale.set(18, 8, 1);
    sprite.userData._auroraAngle = angle;
    sprite.userData._auroraY = -48;
    auroraGroup.add(sprite);
  }

  // Aurora group will be parented to Earth
  if (earthRef) {
    earthRef.g.add(auroraGroup);
  }
}

// ═══════════════════════════════════════════════════════════════
// Comets
// ═══════════════════════════════════════════════════════════════

function buildComets(scene) {
  const cometDefs = [
    { a: 360, b: 120, cx: -280, spd: 0.035, tilt: 0.3 },
    { a: 560, b: 200, cx: -400, spd: 0.02, tilt: -0.15 },
    { a: 800, b: 280, cx: -600, spd: 0.012, tilt: 0.45 },
  ];

  cometDefs.forEach((cd) => {
    const group = new THREE.Group();

    // Comet head
    const headMesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xccddff })
    );
    // Small glow
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(12, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xffcc66, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    // Extra soft glow sprite at comet head
    const headGlowMat = new THREE.SpriteMaterial({
      map: getPointTexture(), color: 0xffeedd, blending: THREE.AdditiveBlending,
      transparent: true, opacity: 0.35, depthWrite: false
    });
    const headGlowSprite = new THREE.Sprite(headGlowMat);
    headGlowSprite.scale.set(15, 15, 1);
    group.add(headGlowSprite);
    group.add(headMesh);
    group.add(glow);

    // Trail particles
    const trailCount = 400;
    const trailPositions = new Float32Array(trailCount * 3);
    const trailAlphas = new Float32Array(trailCount);
    for (let i = 0; i < trailCount; i++) {
      trailPositions[i * 3] = 0;
      trailPositions[i * 3 + 1] = 0;
      trailPositions[i * 3 + 2] = 0;
      trailAlphas[i] = 1.0 - (i / trailCount);
    }
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
    // Use vertex colors for fading: white -> yellow -> orange
    const trailColors = new Float32Array(trailCount * 3);
    for (let i = 0; i < trailCount; i++) {
      const t = i / trailCount; // 0 = head, 1 = tail
      const fade = 1.0 - t;
      // White at head, yellow mid, orange at tail
      trailColors[i * 3]     = 1.0 * fade;                       // R stays high
      trailColors[i * 3 + 1] = (1.0 - t * 0.5) * fade;          // G fades to orange
      trailColors[i * 3 + 2] = (1.0 - t * 0.85) * fade;         // B fades fast
    }
    trailGeo.setAttribute('color', new THREE.BufferAttribute(trailColors, 3));

    const trailMat = new THREE.PointsMaterial({
      size: 3.0, map: getPointTexture(), vertexColors: true, sizeAttenuation: true,
      transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false
    });
    const trail = new THREE.Points(trailGeo, trailMat);
    scene.add(trail);
    setWorldPos(trail, new THREE.Vector3(0, 0, 0));

    group.rotation.z = cd.tilt;
    scene.add(group);
    setWorldPos(group, group.position);

    const angle = Math.random() * Math.PI * 2;
    comets.push({
      g: group, mesh: headMesh, trail, trailPositions,
      a: cd.a, b: cd.b, cx: cd.cx, angle, spd: cd.spd
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// Asteroid Belt
// ═══════════════════════════════════════════════════════════════

function buildAsteroidBelt(scene) {
  const count = 8000;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = (2.2 + Math.random() * 1.1) * AU;
    const ySpread = (Math.random() - 0.5) * 30;
    positions[i * 3]     = Math.cos(angle) * dist;
    positions[i * 3 + 1] = ySpread;
    positions[i * 3 + 2] = Math.sin(angle) * dist;

    const shade = 0.3 + Math.random() * 0.35;
    colors[i * 3]     = shade * 1.05;
    colors[i * 3 + 1] = shade * 0.95;
    colors[i * 3 + 2] = shade * 0.85;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.PointsMaterial({
    size: 0.8, map: getPointTexture(), vertexColors: true, sizeAttenuation: true,
    transparent: true, opacity: 0.5, depthWrite: false
  });
  const asteroidBeltPoints = new THREE.Points(geo, mat);
  scene.add(asteroidBeltPoints);
  setWorldPos(asteroidBeltPoints, new THREE.Vector3(0, 0, 0));

  // Removed torus glow — it was too thick and visible as a dark band
}

// ═══════════════════════════════════════════════════════════════
// Kuiper Belt
// ═══════════════════════════════════════════════════════════════

function buildKuiperBelt(scene) {
  const count = 3000;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = (30 + Math.random() * 20) * AU;
    const ySpread = (Math.random() - 0.5) * 60;
    positions[i * 3]     = Math.cos(angle) * dist;
    positions[i * 3 + 1] = ySpread;
    positions[i * 3 + 2] = Math.sin(angle) * dist;

    const shade = 0.15 + Math.random() * 0.2;
    colors[i * 3]     = shade;
    colors[i * 3 + 1] = shade * 0.95;
    colors[i * 3 + 2] = shade * 1.1;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.PointsMaterial({
    size: 0.8, map: getPointTexture(), vertexColors: true, sizeAttenuation: true,
    transparent: true, opacity: 0.55, depthWrite: false
  });
  const kuiperBeltPoints = new THREE.Points(geo, mat);
  scene.add(kuiperBeltPoints);
  setWorldPos(kuiperBeltPoints, new THREE.Vector3(0, 0, 0));
}

// ═══════════════════════════════════════════════════════════════
// updateBodies
// ═══════════════════════════════════════════════════════════════

export function updateBodies(dt, camWorldPos) {
  elapsed += dt;

  // ── Sun animation ──
  updateSun(dt, elapsed);
  if (sunMesh) sunMesh.rotation.y += 0.0003;  // slow rotation

  // ── Planets ──
  planets.forEach((p) => {
    if (p.moonOrbit) return; // Moon handled separately

    // Orbital motion
    p.angle += p.spd * dt * 0.00008; // 100x slower — orbits take hours, not minutes
    p.g.position.set(
      Math.cos(p.angle) * p.orb * AU,
      0,
      Math.sin(p.angle) * p.orb * AU
    );
    if (p.g.userData._worldPos) p.g.userData._worldPos.copy(p.g.position);

    // Self-rotation — visible but slow, same speed for all planets
    if (p.mesh) {
      p.mesh.rotation.y += 0.001;
    }

    // Cloud rotation
    if (p.clouds) {
      p.clouds.rotation.y += 0.0005;
    }
  });

  // ── Moon follows Earth ──
  if (moonRef && earthRef) {
    const moonAngle = elapsed * 0.1;
    const moonDist = 150;
    const ex = earthRef.g.position.x;
    const ez = earthRef.g.position.z;
    moonRef.g.position.set(
      ex + Math.cos(moonAngle) * moonDist,
      0,
      ez + Math.sin(moonAngle) * moonDist
    );
    if (moonRef.g.userData._worldPos) moonRef.g.userData._worldPos.copy(moonRef.g.position);
    if (moonRef.mesh) moonRef.mesh.rotation.y += 0.0015 * (1 / Math.max(moonRef.r, 0.4));
  }

  // ── All other moons follow their parent planets ──
  for (let i = 0; i < moons.length; i++) {
    const m = moons[i];
    const parent = m.parentRef;
    if (!parent || !parent.g) continue;

    const parentPos = parent.g.userData._worldPos || parent.g.position;
    const angle = m.angleOffset + elapsed * m.speed;

    // Orbit in the parent's tilted plane
    const px = parentPos.x + Math.cos(angle) * m.dist;
    const py = parentPos.y;
    const pz = parentPos.z + Math.sin(angle) * m.dist;

    m.ref.g.position.set(px, py, pz);
    if (m.ref.g.userData._worldPos) m.ref.g.userData._worldPos.set(px, py, pz);
    else m.ref.g.userData._worldPos = new THREE.Vector3(px, py, pz);

    // Self-rotation
    if (m.ref.mesh) m.ref.mesh.rotation.y += 0.001 * (1 / Math.max(m.ref.r, 0.4));
  }

  // ── Spacecraft that follow Earth (ISS, JWST) ──
  if (earthRef) {
    const ePos = earthRef.g.userData._worldPos || earthRef.g.position;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      if (!b.g || !b.g.userData) continue;
      if (b.g.userData._isISS) {
        // ISS orbits Earth very close
        const issAngle = elapsed * 2.0; // fast orbit
        b.g.position.set(ePos.x + Math.cos(issAngle) * 52, Math.sin(issAngle * 0.7) * 2, ePos.z + Math.sin(issAngle) * 52);
        if (b.g.userData._worldPos) b.g.userData._worldPos.copy(b.g.position);
      }
      if (b.g.userData._isJWST) {
        // JWST at L2 — slightly farther from Sun than Earth
        const dir = ePos.clone().normalize();
        b.g.position.copy(dir.multiplyScalar(1.01 * AU));
        if (b.g.userData._worldPos) b.g.userData._worldPos.copy(b.g.position);
      }
    }
  }

  // ── Comets ──
  comets.forEach((c) => {
    c.angle += c.spd * dt * 0.00008;
    const x = (Math.cos(c.angle) * c.a + c.cx) * AU;
    const z = Math.sin(c.angle) * c.b * AU;
    c.g.position.set(x, 0, z);
    if (c.g.userData._worldPos) c.g.userData._worldPos.copy(c.g.position);

    // Shift trail particles backward, insert new head position
    const pos = c.trail.geometry.attributes.position.array;
    for (let i = pos.length - 3; i >= 3; i -= 3) {
      pos[i]     = pos[i - 3];
      pos[i + 1] = pos[i - 2];
      pos[i + 2] = pos[i - 1];
    }
    // World position of head
    pos[0] = c.g.position.x;
    pos[1] = c.g.position.y;
    pos[2] = c.g.position.z;
    c.trail.geometry.attributes.position.needsUpdate = true;
  });

  // ── Earth Aurora ── show only when close, animate sprites
  if (auroraGroup && earthRef && camWorldPos) {
    const earthWP = earthRef.g.userData._worldPos;
    if (earthWP) {
      const dist = camWorldPos.distanceTo(earthWP);
      const showDist = 600; // visible within ~12x Earth radius
      auroraGroup.visible = dist < showDist;

      if (auroraGroup.visible) {
        // Slowly orbit aurora sprites around poles
        auroraGroup.children.forEach((sprite) => {
          const a = sprite.userData._auroraAngle;
          if (a !== undefined) {
            const newA = a + elapsed * 0.05;
            sprite.position.x = Math.cos(newA) * 12;
            sprite.position.z = Math.sin(newA) * 12;
            // Subtle opacity flicker
            sprite.material.opacity = 0.08 + Math.sin(elapsed * 2 + a * 3) * 0.04;
          }
        });
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// getBodies
// ═══════════════════════════════════════════════════════════════

export function getBodies() {
  return bodies;
}
