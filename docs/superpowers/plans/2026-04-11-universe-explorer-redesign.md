# Universe Explorer Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the Universe Explorer from a basic solar system viewer into an awe-inspiring, physics-driven space exploration experience with real textures, classical music, and cinematic post-processing.

**Architecture:** Modular ES modules loaded via `<script type="module">` from a slim index.html shell. Three.js r170 from CDN (ES module imports via importmap). Six JS modules: engine, flight, bodies, deepspace, music, textures. All assets (textures, audio) served locally.

**Tech Stack:** Three.js r170 (ES modules from cdn.jsdelivr.net), HTML5 Audio API, Web Audio API (fallback synth), Python http.server for local dev.

**Testing:** This is a visual/interactive project — verification is done by launching the preview server and visually confirming each feature works. Each task ends with specific visual verification steps.

---

## File Structure

```
Universe/
├── index.html              ← HTML shell, CSS, importmap, boot/loading
├── js/
│   ├── main.js             ← entry point, wires everything together
│   ├── engine.js           ← renderer, post-processing, scene, skybox, resize, animate loop
│   ├── flight.js           ← velocity physics, input (right-click look), gravity, dampening
│   ├── bodies.js           ← planet/star/moon/comet/asteroid definitions, orbital mechanics
│   ├── deepspace.js        ← nebula clouds, black hole, landmarks, billboards
│   ├── music.js            ← audio loader, zone detection, crossfader, fallback synth
│   ├── textures.js         ← texture catalog, loader with fallbacks, procedural generators
│   └── hud.js              ← HUD updates, target info, speed display, warp indicator
├── textures/               ← planet/star/nebula/galaxy images
├── audio/                  ← classical music MP3 files
├── .claude/launch.json     ← preview server config
└── docs/
```

---

## Task 0: Download Assets (Textures + Music)

**Files:**
- Create: `textures/` (additional files)
- Create: `audio/` (all music files)

This task downloads all required assets before any code changes. Textures come from Solar System Scope (CC BY 4.0) and NASA (public domain). Music comes from Wikimedia Commons and Internet Archive (public domain).

- [ ] **Step 1: Download missing planet textures**

```bash
cd "C:/Users/nicho/OneDrive/Desktop/Universe/textures"

# Mercury (missing entirely)
curl -L -o 2k_mercury.jpg "https://www.solarsystemscope.com/textures/download/2k_mercury.jpg"

# Pluto (new addition)
curl -L -o 2k_pluto.jpg "https://www.solarsystemscope.com/textures/download/2k_pluto.jpg"

# Earth specular map - try JPG version
curl -L -o 2k_earth_specular_map.jpg "https://www.solarsystemscope.com/textures/download/2k_earth_specular_map.tif"
```

If Solar System Scope URLs don't work (they may require auth), use NASA alternatives or generate procedural fallbacks. The code already handles missing textures gracefully.

- [ ] **Step 2: Convert Earth normal map from TIF to JPG**

```bash
# If ImageMagick is available:
magick "8k_earth_normal_map.tif" "8k_earth_normal_map.jpg"

# If not available, the procedural fallback will handle it.
# Just ensure the code references .jpg and falls back to procedural.
```

- [ ] **Step 3: Download deep space landmark images (NASA public domain)**

Search NASA Images API and download high-res nebula/galaxy images:

```bash
# These are NASA public domain images - search for direct URLs
# Orion Nebula, Pillars of Creation, Crab Nebula, Andromeda Galaxy
# Save as textures/nebula_orion.jpg, textures/nebula_pillars.jpg, etc.

# Use NASA Images API to find URLs:
curl -s "https://images-api.nasa.gov/search?q=orion+nebula&media_type=image" | python -c "
import json,sys
data=json.load(sys.stdin)
for item in data['collection']['items'][:3]:
    print(item['links'][0]['href'] if item.get('links') else 'no link')
    print(item['data'][0]['title'])
    print()
"
```

Download 4 landmark images (at least 2048px wide) and save to textures/:
- `textures/landmark_orion.jpg`
- `textures/landmark_pillars.jpg`
- `textures/landmark_crab.jpg`
- `textures/landmark_andromeda.jpg`

- [ ] **Step 4: Download starfield skybox texture**

```bash
# NASA Deep Star Maps (Gaia data) - or use existing 8k_stars_milky_way.jpg
# The existing texture can work as a skybox equirectangular map
# If a better one is available from NASA SVS:
curl -L -o textures/starmap_4k.jpg "https://svs.gsfc.nasa.gov/vis/a000000/a004800/a004851/starmap_2020_4k_print.jpg"
```

- [ ] **Step 5: Create audio directory and download classical music**

```bash
mkdir -p "C:/Users/nicho/OneDrive/Desktop/Universe/audio"
cd "C:/Users/nicho/OneDrive/Desktop/Universe/audio"
```

Search Wikimedia Commons and Internet Archive for public domain classical recordings. Target these pieces:

| File | Piece | Source |
|------|-------|--------|
| `inner_clair_de_lune.mp3` | Debussy — Clair de Lune | Wikimedia Commons / Musopen |
| `inner_moonlight.mp3` | Beethoven — Moonlight Sonata mvt 1 | Wikimedia Commons |
| `giants_jupiter.mp3` | Holst — Jupiter (orchestral) | Internet Archive / Musopen |
| `giants_new_world.mp3` | Dvorak — New World Symphony (Largo) | Internet Archive |
| `deep_gymnopedie.mp3` | Satie — Gymnopedie No. 1 | Wikimedia Commons |
| `deep_reverie.mp3` | Debussy — Reverie | Wikimedia Commons |
| `nebula_air.mp3` | Bach — Air on G String | Wikimedia Commons |
| `nebula_arabesque.mp3` | Debussy — Arabesque No. 1 | Wikimedia Commons |
| `blackhole_adagio.mp3` | Barber — Adagio for Strings | Internet Archive |
| `blackhole_mountain.mp3` | Grieg — In the Hall of the Mountain King | Wikimedia Commons |
| `sun_zarathustra.mp3` | Strauss — Also sprach Zarathustra (opening) | Internet Archive |
| `sun_mars.mp3` | Holst — Mars | Internet Archive |

Use `curl` to download from Wikimedia Commons direct file URLs or Internet Archive download URLs. Example pattern:
```bash
# Wikimedia Commons pattern:
curl -L -o inner_clair_de_lune.mp3 "https://upload.wikimedia.org/wikipedia/commons/[path]/Claude_Debussy_-_Clair_de_lune.ogg"

# Internet Archive pattern:
curl -L -o giants_new_world.mp3 "https://archive.org/download/[collection]/[filename].mp3"
```

The agent executing this task should use WebSearch to find the actual current URLs for each piece, then download them. If a piece can't be found as a free download, skip it — the music system gracefully handles missing tracks.

- [ ] **Step 6: Verify all downloaded assets**

```bash
ls -la "C:/Users/nicho/OneDrive/Desktop/Universe/textures/"
ls -la "C:/Users/nicho/OneDrive/Desktop/Universe/audio/"
```

Confirm files exist and have reasonable sizes (textures > 50KB, audio > 500KB).

---

## Task 1: Index.html Shell + Three.js Upgrade

**Files:**
- Rewrite: `index.html`
- Create: `js/main.js`

Replace the monolithic index.html with a slim shell that imports ES modules. Upgrade Three.js from r128 to r170.

- [ ] **Step 1: Rewrite index.html**

The new index.html contains:
- All CSS (same styles as current, plus any new ones)
- HTML structure (canvas, setup screen, loading screen, overlay, HUD)
- An importmap for Three.js r170 ES modules from CDN
- A single `<script type="module" src="js/main.js"></script>`

Key changes from current:
- Remove the inline `<script>` block (all 550+ lines of JS)
- Add importmap for `three`, `three/addons/...`
- Add `contextmenu` prevention on canvas (for right-click look)
- Add an `#info-panel` div for body descriptions when near a planet
- Keep all existing HUD elements

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Universe Explorer</title>
<style>
/* All existing CSS preserved, plus additions for:
   - #info-panel (planet description popup)
   - .zone-label (deep space landmark labels)
   - star-streak warp effect overlay
   - black hole event horizon flash
*/
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;background:#000;overflow:hidden;font-family:'Courier New',monospace}
canvas{display:block;cursor:crosshair}

/* ... (all existing CSS from current index.html) ... */

/* NEW: Info panel for planet descriptions */
#info-panel{position:fixed;bottom:60px;left:50%;transform:translateX(-50%);
  text-align:center;pointer-events:none;z-index:10;display:none}
#info-panel .desc{font-size:9px;letter-spacing:1.5px;color:rgba(255,255,255,0.35);
  max-width:400px;line-height:1.8}

/* NEW: Deep space landmark labels */
.zone-label{position:absolute;font-size:8px;letter-spacing:3px;
  color:rgba(180,200,255,0.5);pointer-events:none;text-align:center}

/* NEW: Warp streak overlay */
#warp-streaks{position:fixed;inset:0;pointer-events:none;z-index:5;opacity:0;
  transition:opacity 0.3s}

/* NEW: Event horizon flash */
#horizon-flash{position:fixed;inset:0;background:#fff;pointer-events:none;z-index:200;opacity:0}
</style>
</head>
<body>
<canvas id="c"></canvas>

<!-- SETUP SCREEN (same as current) -->
<div id="setup">
  <!-- ... same content ... -->
</div>

<!-- LOADING (same as current) -->
<div id="loading">
  <!-- ... same content ... -->
</div>

<!-- PLAY OVERLAY (same as current, update controls for right-click) -->
<div id="overlay">
  <!-- ... same but update control table to show RIGHT-DRAG for look ... -->
</div>

<!-- HUD (same as current + info panel) -->
<div id="hud">
  <!-- ... same content ... -->
  <div id="info-panel"><span class="desc"></span></div>
</div>

<!-- Warp streaks overlay -->
<div id="warp-streaks"></div>
<!-- Event horizon flash -->
<div id="horizon-flash"></div>

<script type="importmap">
{
  "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js",
    "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/"
  }
}
</script>
<script type="module" src="js/main.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create js/main.js entry point**

```javascript
// js/main.js — wires all modules together
import { initEngine, getScene, getCamera, startRenderLoop } from './engine.js';
import { loadAllTextures } from './textures.js';
import { createSolarSystem, updateBodies, getBodies } from './bodies.js';
import { createDeepSpace, updateDeepSpace, getDeepSpaceObjects } from './deepspace.js';
import { initFlight, updateFlight, getCamPos } from './flight.js';
import { initMusic, updateMusic } from './music.js';
import { initHud, updateHud } from './hud.js';

async function boot() {
  // 1. Show loading screen
  document.getElementById('setup').style.display = 'none';
  document.getElementById('loading').style.display = 'flex';

  // 2. Init renderer + post-processing
  const { scene, camera, composer } = initEngine();

  // 3. Load textures
  const textures = await loadAllTextures((progress, detail) => {
    document.getElementById('loading-bar').style.width = (progress * 100) + '%';
    document.getElementById('loading-detail').textContent = detail;
  });

  // 4. Build scene
  createSolarSystem(scene, textures);
  createDeepSpace(scene, textures);

  // 5. Init flight controls
  const flight = initFlight(camera, getBodies());

  // 6. Init music
  const music = initMusic();

  // 7. Init HUD
  initHud();

  // 8. Show overlay
  document.getElementById('loading').style.display = 'none';
  // Show texture status
  const real = Object.entries(textures.status).filter(([k,v]) => v === 'real').length;
  const proc = Object.entries(textures.status).filter(([k,v]) => v === 'procedural').length;
  let html = '';
  if (real) html += `<span class="t-ok">✓ ${real} real textures loaded</span><br>`;
  if (proc) html += `<span class="t-miss">⚠ ${proc} procedural fallbacks</span>`;
  document.getElementById('tex-status').innerHTML = html;
  document.getElementById('overlay').style.display = 'flex';

  // 9. Start button
  document.getElementById('start-btn').addEventListener('click', () => {
    document.getElementById('overlay').style.display = 'none';
    document.getElementById('hud').style.display = 'block';
    document.getElementById('c').focus();
    music.start();

    // 10. Render loop
    let lastTime = performance.now();
    function animate() {
      requestAnimationFrame(animate);
      const now = performance.now();
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;

      updateBodies(dt);
      updateDeepSpace(dt, getCamPos());
      updateFlight(dt, getBodies().concat(getDeepSpaceObjects()));
      updateMusic(getCamPos(), getBodies().concat(getDeepSpaceObjects()));
      updateHud(flight, getBodies().concat(getDeepSpaceObjects()));

      composer.render();
    }
    animate();
  });
}

// Auto-boot if served via HTTP, otherwise show setup
const isServed = location.protocol === 'http:' || location.protocol === 'https:';
if (isServed) {
  boot();
} else {
  document.getElementById('setup').style.display = 'flex';
  document.getElementById('proceed-btn').addEventListener('click', boot);
}
```

- [ ] **Step 3: Verify — launch preview, confirm blank page loads without JS errors**

Open preview. The page should load (no scene yet since modules aren't built). Check browser console for import errors — the importmap should resolve Three.js correctly.

---

## Task 2: Texture System (js/textures.js)

**Files:**
- Create: `js/textures.js`

Port the texture loading and procedural fallback system from the old index.html into a clean module.

- [ ] **Step 1: Create js/textures.js**

```javascript
// js/textures.js — texture catalog, loader, procedural fallbacks
import * as THREE from 'three';

// Texture definitions: key, file paths (tried in order), procedural fallback
const TEX_CATALOG = [
  { key: 'sun',         paths: ['textures/8k_sun.jpg', 'textures/2k_sun.jpg'] },
  { key: 'mercury',     paths: ['textures/8k_mercury.jpg', 'textures/2k_mercury.jpg'] },
  { key: 'venus',       paths: ['textures/8k_venus_surface.jpg', 'textures/2k_venus_surface.jpg'] },
  { key: 'venusAtmo',   paths: ['textures/4k_venus_atmosphere.jpg', 'textures/2k_venus_atmosphere.jpg'] },
  { key: 'earth',       paths: ['textures/8k_earth_daymap.jpg', 'textures/2k_earth_daymap.jpg'] },
  { key: 'earthNight',  paths: ['textures/8k_earth_nightmap.jpg', 'textures/2k_earth_nightmap.jpg'] },
  { key: 'earthClouds', paths: ['textures/8k_earth_clouds.jpg', 'textures/2k_earth_clouds.jpg'] },
  { key: 'earthNormal', paths: ['textures/8k_earth_normal_map.jpg', 'textures/2k_earth_normal_map.jpg'] },
  { key: 'earthSpec',   paths: ['textures/8k_earth_specular_map.jpg', 'textures/2k_earth_specular_map.jpg'] },
  { key: 'moon',        paths: ['textures/8k_moon.jpg', 'textures/2k_moon.jpg'] },
  { key: 'mars',        paths: ['textures/8k_mars.jpg', 'textures/2k_mars.jpg'] },
  { key: 'jupiter',     paths: ['textures/8k_jupiter.jpg', 'textures/2k_jupiter.jpg'] },
  { key: 'saturn',      paths: ['textures/8k_saturn.jpg', 'textures/2k_saturn.jpg'] },
  { key: 'saturnRing',  paths: ['textures/8k_saturn_ring_alpha.png', 'textures/2k_saturn_ring_alpha.png'] },
  { key: 'uranus',      paths: ['textures/2k_uranus.jpg'] },
  { key: 'neptune',     paths: ['textures/2k_neptune.jpg'] },
  { key: 'pluto',       paths: ['textures/2k_pluto.jpg'] },
  { key: 'starmap',     paths: ['textures/starmap_4k.jpg', 'textures/8k_stars_milky_way.jpg', 'textures/8k_stars.jpg'] },
  // Deep space landmarks
  { key: 'landmarkOrion',     paths: ['textures/landmark_orion.jpg'] },
  { key: 'landmarkPillars',   paths: ['textures/landmark_pillars.jpg'] },
  { key: 'landmarkCrab',      paths: ['textures/landmark_crab.jpg'] },
  { key: 'landmarkAndromeda', paths: ['textures/landmark_andromeda.jpg'] },
];

// --- Procedural fallback generators (ported from old code) ---
// (Include all the mkTex, hh, sn, fbm, wfbm, mkProc functions from the original)
// Plus new procedural generators for pluto, landmarks

function mkTex(w, h, fn) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  fn(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ... (all procedural noise and generation functions from original index.html) ...

const PROCEDURAL = {
  sun:      () => mkProc(512, 256, 195,70,0, 255,210,30, 2, 1.8, 1.8),
  mercury:  () => mkProc(512, 256, 108,100,92, 168,155,138, 2.2),
  venus:    () => mkProc(512, 256, 168,128,48, 215,178,90, 1.4, 4, 4),
  earth:    () => mkProc(512, 256, 8,35,100, 35,80,30, 1.6, 2, 2),
  earthNight: () => mkTex(512, 256, (ctx,w,h) => { ctx.fillStyle='#000'; ctx.fillRect(0,0,w,h); }),
  earthClouds: () => mkProc(512, 256, 200,200,200, 255,255,255, 2, 10, 10),
  earthNormal: () => mkTex(512, 256, (ctx,w,h) => {
    const img = ctx.createImageData(w,h);
    for(let i=0;i<w*h*4;i+=4){img.data[i]=128;img.data[i+1]=128;img.data[i+2]=255;img.data[i+3]=255;}
    ctx.putImageData(img,0,0);
  }),
  earthSpec: () => mkTex(512, 256, (ctx,w,h) => { ctx.fillStyle='#333'; ctx.fillRect(0,0,w,h); }),
  moon:     () => mkProc(512, 256, 100,95,88, 165,158,148, 2.5, 5, 5),
  mars:     () => mkProc(512, 256, 142,48,28, 200,98,58, 1.8),
  jupiter:  () => mkProc(512, 256, 168,110,65, 225,182,128, 2, 7, 7),
  saturn:   () => mkProc(512, 256, 195,172,120, 235,212,148, 1.8, 4, 4),
  saturnRing: () => mkTex(512, 4, (ctx,w) => {
    const g = ctx.createLinearGradient(0,0,w,0);
    g.addColorStop(0,'rgba(170,150,90,0)');
    g.addColorStop(.08,'rgba(210,188,120,0.7)');
    g.addColorStop(.22,'rgba(228,205,135,0.88)');
    g.addColorStop(.40,'rgba(235,212,142,0.92)');
    g.addColorStop(.55,'rgba(215,192,128,0.68)');
    g.addColorStop(.72,'rgba(190,168,108,0.35)');
    g.addColorStop(1,'rgba(158,138,88,0)');
    ctx.fillStyle = g; ctx.fillRect(0,0,w,4);
  }),
  uranus:   () => mkProc(512, 256, 85,188,200, 138,220,232, 1.1, 6, 6),
  neptune:  () => mkProc(512, 256, 12,30,168, 32,70,220, 1.3, 7, 7),
  pluto:    () => mkProc(512, 256, 180,160,130, 220,200,170, 1.5, 3, 3),
  starmap:  () => mkTex(2048, 1024, (ctx,w,h) => {
    ctx.fillStyle = '#000'; ctx.fillRect(0,0,w,h);
    for(let i=0;i<3000;i++){
      const br = Math.random();
      ctx.fillStyle = `rgba(${200+Math.random()*55},${200+Math.random()*55},${220+Math.random()*35},${br})`;
      ctx.fillRect(Math.random()*w, Math.random()*h, 1+Math.random(), 1+Math.random());
    }
  }),
  // Landmark fallbacks: colored glowing rectangles
  landmarkOrion:     () => mkLandmarkFallback(512, 512, [30, 80, 180], [200, 100, 255]),
  landmarkPillars:   () => mkLandmarkFallback(512, 512, [80, 50, 20], [255, 180, 80]),
  landmarkCrab:      () => mkLandmarkFallback(512, 512, [180, 40, 20], [255, 200, 100]),
  landmarkAndromeda: () => mkLandmarkFallback(512, 512, [20, 20, 60], [150, 170, 255]),
};

// Helper for landmark procedural fallbacks
function mkLandmarkFallback(w, h, inner, outer) {
  return mkTex(w, h, (ctx, w, h) => {
    const grd = ctx.createRadialGradient(w/2, h/2, 0, w/2, h/2, w/2);
    grd.addColorStop(0, `rgba(${outer[0]},${outer[1]},${outer[2]},1)`);
    grd.addColorStop(0.3, `rgba(${inner[0]},${inner[1]},${inner[2]},0.8)`);
    grd.addColorStop(1, `rgba(${inner[0]},${inner[1]},${inner[2]},0)`);
    ctx.fillStyle = grd;
    ctx.fillRect(0,0,w,h);
  });
}

// --- Public API ---

export async function loadAllTextures(onProgress) {
  const textures = {};
  const status = {};
  const loader = new THREE.TextureLoader();
  let done = 0;
  const total = TEX_CATALOG.length;

  async function tryPaths(def, idx) {
    if (idx >= def.paths.length) {
      // All paths failed — use procedural fallback
      textures[def.key] = PROCEDURAL[def.key] ? PROCEDURAL[def.key]() : null;
      status[def.key] = 'procedural';
      done++;
      onProgress(done / total, def.key.toUpperCase() + ' → procedural fallback');
      return;
    }
    return new Promise(resolve => {
      loader.load(def.paths[idx],
        tex => {
          tex.colorSpace = THREE.SRGBColorSpace;
          textures[def.key] = tex;
          status[def.key] = 'real';
          done++;
          onProgress(done / total, def.key.toUpperCase() + ' ✓');
          resolve();
        },
        undefined,
        () => tryPaths(def, idx + 1).then(resolve)
      );
    });
  }

  await Promise.all(TEX_CATALOG.map(d => tryPaths(d, 0)));
  textures.status = status;
  return textures;
}
```

Copy all the procedural noise functions (`hh`, `sn`, `fbm`, `wfbm`, `mkProc`) exactly from the original index.html into this file. Update `THREE.sRGBEncoding` to `THREE.SRGBColorSpace` (r170 API change).

- [ ] **Step 2: Verify — import textures.js in main.js, confirm textures load in console**

---

## Task 3: Engine + Post-Processing (js/engine.js)

**Files:**
- Create: `js/engine.js`

Set up the renderer, scene, camera, skybox, post-processing (bloom, vignette, film grain), and stars.

- [ ] **Step 1: Create js/engine.js**

```javascript
// js/engine.js — renderer, scene, camera, post-processing, skybox, stars
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

let scene, camera, renderer, composer;
let sunLight;

// Vignette shader
const VignetteShader = {
  uniforms: {
    tDiffuse: { value: null },
    offset: { value: 1.0 },
    darkness: { value: 1.2 },
  },
  vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
  fragmentShader: `uniform sampler2D tDiffuse;uniform float offset;uniform float darkness;varying vec2 vUv;
    void main(){vec4 c=texture2D(tDiffuse,vUv);vec2 uv=(vUv-vec2(0.5))*vec2(offset);
    gl_FragColor=vec4(mix(c.rgb,vec3(1.0-darkness),dot(uv,uv)),c.a);}`
};

// Film grain shader
const FilmGrainShader = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    intensity: { value: 0.03 },
  },
  vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
  fragmentShader: `uniform sampler2D tDiffuse;uniform float time;uniform float intensity;varying vec2 vUv;
    float rand(vec2 co){return fract(sin(dot(co,vec2(12.9898,78.233)))*43758.5453);}
    void main(){vec4 c=texture2D(tDiffuse,vUv);float n=rand(vUv+time)*intensity;
    gl_FragColor=vec4(c.rgb+n-intensity*0.5,c.a);}`
};

// Black hole distortion shader (applied globally but controlled by uniform)
const DistortionShader = {
  uniforms: {
    tDiffuse: { value: null },
    bhScreenPos: { value: new THREE.Vector2(0.5, 0.5) },
    bhStrength: { value: 0.0 },  // 0 = no distortion, >0 = active
  },
  vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
  fragmentShader: `uniform sampler2D tDiffuse;uniform vec2 bhScreenPos;uniform float bhStrength;varying vec2 vUv;
    void main(){
      vec2 dir=vUv-bhScreenPos;float dist=length(dir);
      vec2 offset=vec2(0.0);
      if(bhStrength>0.0&&dist>0.01){
        float pull=bhStrength/(dist*dist*80.0+1.0);
        offset=-normalize(dir)*pull*0.08;
      }
      gl_FragColor=texture2D(tDiffuse,vUv+offset);
    }`
};

let filmGrainPass, distortionPass;

export function initEngine() {
  const canvas = document.getElementById('c');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.001, 8000000);

  // Lights
  sunLight = new THREE.PointLight(0xfff8e8, 5.0, 0);
  scene.add(sunLight);
  scene.add(new THREE.AmbientLight(0x020206, 1));

  // Post-processing
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    1.5,   // strength
    0.4,   // radius
    0.8    // threshold
  );
  composer.addPass(bloomPass);

  distortionPass = new ShaderPass(DistortionShader);
  composer.addPass(distortionPass);

  const vignettePass = new ShaderPass(VignetteShader);
  composer.addPass(vignettePass);

  filmGrainPass = new ShaderPass(FilmGrainShader);
  composer.addPass(filmGrainPass);

  composer.addPass(new OutputPass());

  // Resize handler
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
  });

  return { scene, camera, composer };
}

export function getScene() { return scene; }
export function getCamera() { return camera; }
export function getSunLight() { return sunLight; }
export function getDistortionPass() { return distortionPass; }
export function updateFilmGrain(time) {
  if (filmGrainPass) filmGrainPass.uniforms.time.value = time;
}

// Create skybox from equirectangular texture
export function createSkybox(starmapTexture) {
  if (!starmapTexture) return;
  const skyGeo = new THREE.SphereGeometry(5000000, 64, 64);
  const skyMat = new THREE.MeshBasicMaterial({
    map: starmapTexture,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const skyMesh = new THREE.Mesh(skyGeo, skyMat);
  scene.add(skyMesh);
}

// Create layered particle stars (on top of skybox for sparkle)
export function createStars() {
  const SC = [[1,.88,.72],[.72,.80,1],[1,.62,.32],[.94,1,.90],[1,1,.58],[.85,.90,1]];
  function addStars(n, minR, maxR, sz, op) {
    const pos = new Float32Array(n*3), col = new Float32Array(n*3);
    for(let i=0;i<n;i++){
      const r=minR+Math.random()*(maxR-minR), t=Math.random()*Math.PI*2, p=Math.acos(2*Math.random()-1);
      pos[i*3]=r*Math.sin(p)*Math.cos(t); pos[i*3+1]=r*Math.sin(p)*Math.sin(t); pos[i*3+2]=r*Math.cos(p);
      const [cr,cg,cb]=SC[Math.floor(Math.random()*SC.length)], br=.35+Math.random()*.65;
      col[i*3]=cr*br; col[i*3+1]=cg*br; col[i*3+2]=cb*br;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos,3));
    g.setAttribute('color', new THREE.BufferAttribute(col,3));
    scene.add(new THREE.Points(g, new THREE.PointsMaterial({
      vertexColors:true, size:sz, sizeAttenuation:false,
      blending:THREE.AdditiveBlending, depthWrite:false, transparent:true, opacity:op
    })));
  }
  addStars(22000, 4000, 120000, 1.2, 1);
  addStars(8000, 120000, 600000, .7, .5);
  addStars(1500, 400, 2500, 3.0, .85);

  // Milky Way band
  const n=50000, pos=new Float32Array(n*3), col=new Float32Array(n*3);
  for(let i=0;i<n;i++){
    const arm=Math.floor(Math.random()*4)*(Math.PI/2);
    const rr=100+Math.pow(Math.random(),.6)*6000, tw=rr*.0009, sp=rr*.22+50;
    const ang=arm+tw+(Math.random()-.5)*1.2;
    pos[i*3]=Math.cos(ang)*rr+(Math.random()-.5)*sp;
    pos[i*3+1]=(Math.random()-.5)*rr*.04;
    pos[i*3+2]=Math.sin(ang)*rr+(Math.random()-.5)*sp;
    const hv=Math.random(); col[i*3]=.35+hv*.45; col[i*3+1]=.42+hv*.32; col[i*3+2]=.65+hv*.22;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos,3));
  g.setAttribute('color', new THREE.BufferAttribute(col,3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({
    vertexColors:true, size:.9, sizeAttenuation:false,
    blending:THREE.AdditiveBlending, depthWrite:false, transparent:true, opacity:.5
  })));
}
```

- [ ] **Step 2: Verify — scene renders with stars, bloom visible on bright particles**

---

## Task 4: Flight Physics (js/flight.js)

**Files:**
- Create: `js/flight.js`

The core flight model: velocity-based movement with cinematic dampening, angular momentum, gravitational influence, right-click mouse look, warp drive.

- [ ] **Step 1: Create js/flight.js**

```javascript
// js/flight.js — velocity physics, input, gravity, dampening
import * as THREE from 'three';

const AU = 55; // scene units per AU

// State
const camPos = new THREE.Vector3(0, 60, 220);
const camQuat = new THREE.Quaternion();
const velocity = new THREE.Vector3(0, 0, 0);
const angularVelocity = new THREE.Vector3(0, 0, 0); // pitch, yaw, roll rates

const homePos = new THREE.Vector3(0, 60, 220);
const homeQuat = new THREE.Quaternion();

// Config
const THRUST_ACCEL = 2.0;
const WARP_MULTIPLIER = 25;
const LINEAR_DAMPING = 0.035;   // 3.5% per frame
const ANGULAR_DAMPING = 0.08;   // 8% per frame
const MAX_BASE_SPEED = 120;
const MOUSE_SENS = 0.002;
const ROLL_ACCEL = 1.5;
const GRAVITY_RANGE_MULT = 5;   // gravity reaches 5x visual radius
const BH_GRAVITY_RANGE_MULT = 50;

// Input state
const keys = {};
let rmb = false, lastX = 0, lastY = 0, mouseDX = 0, mouseDY = 0;
let boostEnergy = 1;
let returning = false, retT = 0;
const retFromP = new THREE.Vector3(), retFromQ = new THREE.Quaternion();

// Temp vectors (reused to avoid GC)
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _gravDir = new THREE.Vector3();

let canvas;

export function initFlight(camera, bodies) {
  canvas = document.getElementById('c');
  camQuat.setFromEuler(new THREE.Euler(-0.27, 0, 0));

  canvas.setAttribute('tabindex', '0');
  canvas.addEventListener('click', () => canvas.focus());

  // Prevent context menu on right-click
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  // Keyboard
  window.addEventListener('keydown', e => {
    keys[e.code] = true;
    if (e.code === 'KeyH') doHome();
    if (['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', e => keys[e.code] = false);

  // Right-click mouse look
  canvas.addEventListener('mousedown', e => {
    if (e.button === 2) { rmb = true; lastX = e.clientX; lastY = e.clientY; canvas.style.cursor = 'none'; }
  });
  window.addEventListener('mouseup', e => {
    if (e.button === 2) { rmb = false; canvas.style.cursor = 'crosshair'; }
  });
  window.addEventListener('mousemove', e => {
    if (!rmb) return;
    mouseDX += e.clientX - lastX;
    mouseDY += e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
  });

  // Touch controls (preserved)
  let touching = false;
  canvas.addEventListener('touchstart', e => {
    touching = true; lastX = e.touches[0].clientX; lastY = e.touches[0].clientY;
  }, { passive: true });
  window.addEventListener('touchend', () => touching = false);
  window.addEventListener('touchmove', e => {
    if (!touching) return;
    mouseDX += e.touches[0].clientX - lastX;
    mouseDY += e.touches[0].clientY - lastY;
    lastX = e.touches[0].clientX; lastY = e.touches[0].clientY;
  }, { passive: true });

  // Home button
  const homeBtn = document.getElementById('home-btn');
  homeBtn.addEventListener('click', doHome);

  return { getCamPos: () => camPos, getVelocity: () => velocity, getBoostEnergy: () => boostEnergy };
}

function doHome() {
  retFromP.copy(camPos);
  retFromQ.copy(camQuat);
  returning = true;
  retT = 0;
  velocity.set(0,0,0);
  angularVelocity.set(0,0,0);
  document.getElementById('home-btn').style.display = 'none';
}

export function updateFlight(dt, allBodies) {
  const camera = getCamera();
  if (!camera) return;

  // Return home animation
  if (returning) {
    retT = Math.min(1, retT + dt * 0.5);
    const e = retT < 0.5 ? 2*retT*retT : 1 - Math.pow(-2*retT+2,2)/2;
    camPos.lerpVectors(retFromP, homePos, e);
    camQuat.slerpQuaternions(retFromQ, homeQuat, e);
    camera.position.copy(camPos);
    camera.quaternion.copy(camQuat);
    if (retT >= 1) returning = false;
    return;
  }

  // --- Angular momentum from mouse look ---
  const angAccelPitch = mouseDY * MOUSE_SENS;   // Y inverted
  const angAccelYaw = -mouseDX * MOUSE_SENS;
  mouseDX = 0; mouseDY = 0;

  angularVelocity.x += angAccelPitch;
  angularVelocity.y += angAccelYaw;

  // Roll from Q/E
  if (keys['KeyQ']) angularVelocity.z += ROLL_ACCEL * dt;
  if (keys['KeyE']) angularVelocity.z -= ROLL_ACCEL * dt;

  // Apply angular velocity to quaternion
  const camRight = new THREE.Vector3(1,0,0).applyQuaternion(camQuat);
  const camUp = new THREE.Vector3(0,1,0).applyQuaternion(camQuat);
  const camFwd = new THREE.Vector3(0,0,-1).applyQuaternion(camQuat);

  const pQ = new THREE.Quaternion().setFromAxisAngle(camRight, angularVelocity.x);
  const yQ = new THREE.Quaternion().setFromAxisAngle(camUp, angularVelocity.y);
  const rQ = new THREE.Quaternion().setFromAxisAngle(camFwd, angularVelocity.z);
  camQuat.premultiply(pQ).premultiply(yQ).premultiply(rQ).normalize();

  // Dampen angular velocity
  angularVelocity.multiplyScalar(1 - ANGULAR_DAMPING);

  // --- Warp drive ---
  const isWarp = keys['ShiftLeft'] || keys['ShiftRight'];
  if (isWarp) boostEnergy = Math.max(0, boostEnergy - dt * 0.2);
  else boostEnergy = Math.min(1, boostEnergy + dt * 0.125);

  const warpActive = isWarp && boostEnergy > 0;
  const warpMult = warpActive ? WARP_MULTIPLIER : 1;
  const maxSpeed = MAX_BASE_SPEED * warpMult;
  const thrustAccel = THRUST_ACCEL * warpMult;

  // --- Thrust acceleration ---
  _fwd.set(0,0,-1).applyQuaternion(camQuat);
  _right.set(1,0,0).applyQuaternion(camQuat);
  _up.set(0,1,0).applyQuaternion(camQuat);

  let thrusting = false;
  if (keys['KeyW'] || keys['ArrowUp'])    { velocity.addScaledVector(_fwd, thrustAccel * dt);  thrusting = true; }
  if (keys['KeyS'] || keys['ArrowDown'])  { velocity.addScaledVector(_fwd, -thrustAccel * dt); thrusting = true; }
  if (keys['KeyA'] || keys['ArrowLeft'])  { velocity.addScaledVector(_right, -thrustAccel * dt); thrusting = true; }
  if (keys['KeyD'] || keys['ArrowRight']) { velocity.addScaledVector(_right, thrustAccel * dt); thrusting = true; }
  if (keys['Space'])                      { velocity.addScaledVector(_up, thrustAccel * dt);   thrusting = true; }
  if (keys['KeyC'])                       { velocity.addScaledVector(_up, -thrustAccel * dt);  thrusting = true; }

  // --- Gravitational influence ---
  if (allBodies) {
    for (const body of allBodies) {
      if (!body.g || !body.r) continue;
      const gravRange = body.r * (body.isBlackHole ? BH_GRAVITY_RANGE_MULT : GRAVITY_RANGE_MULT);
      _gravDir.subVectors(body.g.position, camPos);
      const dist = _gravDir.length();
      if (dist < gravRange && dist > body.r * 0.5) {
        _gravDir.normalize();
        const strength = body.isBlackHole ? 80 : 3;
        const pull = strength * body.r * body.r / (dist * dist);
        velocity.addScaledVector(_gravDir, Math.min(pull, 5) * dt);
      }
    }
  }

  // --- Linear dampening ---
  if (!thrusting) {
    velocity.multiplyScalar(1 - LINEAR_DAMPING);
  }

  // Soft speed cap
  const speed = velocity.length();
  if (speed > maxSpeed) {
    velocity.multiplyScalar(maxSpeed / speed);
  }

  // --- Apply velocity to position ---
  camPos.addScaledVector(velocity, dt * 60);
  camera.position.copy(camPos);
  camera.quaternion.copy(camQuat);

  // Show home button when far from origin
  const homeBtn = document.getElementById('home-btn');
  if (homeBtn) homeBtn.style.display = camPos.length() > 350 ? 'block' : 'none';

  // Warp HUD
  const boostEl = document.getElementById('boost-fill');
  const warpEl = document.getElementById('warp-active');
  if (boostEl) boostEl.style.width = (boostEnergy * 100) + '%';
  if (warpEl) warpEl.style.display = warpActive ? 'block' : 'none';
}

export function getCamPos() { return camPos; }
export function getCamQuat() { return camQuat; }
export function getVelocity() { return velocity; }
export function getSpeed() { return velocity.length(); }
export function getBoostEnergy() { return boostEnergy; }
export function isWarping() {
  return (keys['ShiftLeft'] || keys['ShiftRight']) && boostEnergy > 0;
}

// Import camera getter from engine (set by main.js)
let _camera;
export function setCamera(cam) { _camera = cam; }
function getCamera() { return _camera; }
```

- [ ] **Step 2: Wire flight into main.js, verify — WASD gives smooth acceleration/deceleration, right-click drag looks around, drift when releasing keys**

---

## Task 5: Solar System Bodies (js/bodies.js)

**Files:**
- Create: `js/bodies.js`

All planets, sun, moon, comets, asteroid belt, Kuiper belt, ISS. Orbital mechanics. Atmosphere shaders.

- [ ] **Step 1: Create js/bodies.js**

Port all planet definitions from the original index.html. Add Pluto, dwarf planets, comets, ISS, Kuiper belt. The file exports:
- `createSolarSystem(scene, textures)` — builds all meshes and adds to scene
- `updateBodies(dt)` — updates orbital positions, rotations, comet trails
- `getBodies()` — returns array of `{name, desc, g, r}` for HUD/gravity

Key additions beyond original:
- **Pluto** at orb 39.48 AU with its texture
- **Ceres** at orb 2.77 AU (procedural, r=0.08)
- **Eris** at orb 67.7 AU (procedural, r=0.15)
- **Comets**: 3 comets on elliptical orbits with particle trail systems (THREE.Points with fading alpha)
- **Kuiper belt**: sparse particle ring from 30-50 AU
- **ISS**: small emissive sphere orbiting Earth at r=1.05 with label

Atmosphere shader updated for Three.js r170 (use `colorSpace` instead of `encoding`).

- [ ] **Step 2: Verify — all planets visible in correct orbits, comets have trailing particles, Pluto exists far out**

---

## Task 6: Deep Space Content (js/deepspace.js)

**Files:**
- Create: `js/deepspace.js`

Nebula landmarks (textured billboards), nebula clouds (particle volumes), black hole with accretion disk and gravitational lensing.

- [ ] **Step 1: Create js/deepspace.js**

```javascript
// js/deepspace.js — deep space landmarks, nebula clouds, black hole
import * as THREE from 'three';

const AU = 55;
let blackHoleGroup;
const landmarks = [];
const nebulaClouds = [];

const LANDMARK_DEFS = [
  { name: 'ORION NEBULA',         texKey: 'landmarkOrion',    dist: 2500, angle: 0.3,    size: 400, desc: 'Stellar nursery 1,344 light-years away. Over 700 stars forming.' },
  { name: 'PILLARS OF CREATION',  texKey: 'landmarkPillars',  dist: 4000, angle: 1.8,    size: 500, desc: 'Columns of interstellar gas in the Eagle Nebula. 6,500 light-years distant.' },
  { name: 'CRAB NEBULA',          texKey: 'landmarkCrab',     dist: 5000, angle: 3.5,    size: 350, desc: 'Supernova remnant from 1054 AD. Pulsar at its heart spins 30x/second.' },
  { name: 'ANDROMEDA GALAXY',     texKey: 'landmarkAndromeda', dist: 8000, angle: 5.2,   size: 800, desc: '2.5 million light-years away. One trillion stars. Approaching us at 110 km/s.' },
];

const NEBULA_CLOUD_DEFS = [
  { pos: [1800, 200, 1200],   color: [0.2, 0.4, 1.0],  size: 300, count: 3000 },
  { pos: [-2200, -100, 3000], color: [1.0, 0.3, 0.6],  size: 400, count: 4000 },
  { pos: [3500, 500, -1500],  color: [1.0, 0.8, 0.2],  size: 250, count: 2500 },
  { pos: [-1000, 300, -4000], color: [0.3, 1.0, 0.5],  size: 350, count: 3500 },
  { pos: [5000, -200, 2500],  color: [0.6, 0.2, 1.0],  size: 300, count: 3000 },
  { pos: [-3000, 100, 5500],  color: [0.1, 0.6, 0.9],  size: 450, count: 4500 },
];

export function createDeepSpace(scene, textures) {
  // --- Landmarks (textured billboards) ---
  for (const def of LANDMARK_DEFS) {
    const x = Math.cos(def.angle) * def.dist * AU;
    const z = Math.sin(def.angle) * def.dist * AU;
    const y = (Math.random() - 0.5) * 200;

    const tex = textures[def.texKey];
    const spriteMat = new THREE.SpriteMaterial({
      map: tex,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.position.set(x, y, z);
    sprite.scale.set(def.size * AU, def.size * AU, 1);
    scene.add(sprite);

    // Point light at landmark location for glow
    const light = new THREE.PointLight(
      new THREE.Color(spriteMat.color || 0xaaccff), 2.0, def.size * AU * 2
    );
    light.position.copy(sprite.position);
    scene.add(light);

    landmarks.push({
      name: def.name,
      desc: def.desc,
      g: sprite,
      r: def.size * AU * 0.3,
      isLandmark: true,
    });
  }

  // --- Nebula clouds (particle volumes) ---
  for (const def of NEBULA_CLOUD_DEFS) {
    const positions = new Float32Array(def.count * 3);
    const colors = new Float32Array(def.count * 3);
    const sizes = new Float32Array(def.count);

    for (let i = 0; i < def.count; i++) {
      // Gaussian-ish distribution within sphere
      const r = Math.pow(Math.random(), 0.5) * def.size * AU;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i*3]     = def.pos[0] * AU + r * Math.sin(phi) * Math.cos(theta);
      positions[i*3 + 1] = def.pos[1] * AU + r * Math.sin(phi) * Math.sin(theta);
      positions[i*3 + 2] = def.pos[2] * AU + r * Math.cos(phi);

      const brightness = 0.3 + Math.random() * 0.7;
      colors[i*3]     = def.color[0] * brightness;
      colors[i*3 + 1] = def.color[1] * brightness;
      colors[i*3 + 2] = def.color[2] * brightness;

      sizes[i] = 2 + Math.random() * 6;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const cloud = new THREE.Points(geo, new THREE.PointsMaterial({
      vertexColors: true,
      size: 3,
      sizeAttenuation: false,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
    }));
    scene.add(cloud);
    nebulaClouds.push(cloud);
  }

  // --- Black Hole ---
  createBlackHole(scene);
}

function createBlackHole(scene) {
  blackHoleGroup = new THREE.Group();
  const bhPos = new THREE.Vector3(
    Math.cos(4.0) * 6000 * AU,
    -100,
    Math.sin(4.0) * 6000 * AU
  );
  blackHoleGroup.position.copy(bhPos);

  // Event horizon sphere (pure black)
  const horizonGeo = new THREE.SphereGeometry(8, 64, 64);
  const horizonMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
  blackHoleGroup.add(new THREE.Mesh(horizonGeo, horizonMat));

  // Accretion disk
  const diskGeo = new THREE.RingGeometry(12, 40, 128, 4);
  const diskMat = new THREE.MeshBasicMaterial({
    color: 0xff8833,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.7,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const disk = new THREE.Mesh(diskGeo, diskMat);
  disk.rotation.x = Math.PI * 0.45;
  blackHoleGroup.add(disk);
  blackHoleGroup.userData.disk = disk;

  // Accretion disk glow particles
  const particleCount = 8000;
  const diskPos = new Float32Array(particleCount * 3);
  const diskCol = new Float32Array(particleCount * 3);
  for (let i = 0; i < particleCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const r = 12 + Math.random() * 28;
    const y = (Math.random() - 0.5) * 2;
    diskPos[i*3] = Math.cos(angle) * r;
    diskPos[i*3+1] = y;
    diskPos[i*3+2] = Math.sin(angle) * r;

    const heat = 1 - (r - 12) / 28;
    diskCol[i*3] = 1.0;
    diskCol[i*3+1] = 0.3 + heat * 0.5;
    diskCol[i*3+2] = heat * 0.3;
  }
  const diskParticleGeo = new THREE.BufferGeometry();
  diskParticleGeo.setAttribute('position', new THREE.BufferAttribute(diskPos, 3));
  diskParticleGeo.setAttribute('color', new THREE.BufferAttribute(diskCol, 3));
  const diskParticles = new THREE.Points(diskParticleGeo, new THREE.PointsMaterial({
    vertexColors: true, size: 1.5, sizeAttenuation: true,
    blending: THREE.AdditiveBlending, transparent: true, opacity: 0.8, depthWrite: false,
  }));
  disk.rotation.x = 0; // particles in local space
  blackHoleGroup.add(diskParticles);
  blackHoleGroup.userData.diskParticles = diskParticles;

  // Outer glow shells
  [
    [20, 0xff4400, 0.08],
    [35, 0xff2200, 0.03],
    [60, 0x440000, 0.015],
  ].forEach(([r, c, a]) => {
    blackHoleGroup.add(new THREE.Mesh(
      new THREE.SphereGeometry(r, 32, 32),
      new THREE.MeshBasicMaterial({
        color: c, transparent: true, opacity: a,
        blending: THREE.AdditiveBlending, depthWrite: false
      })
    ));
  });

  scene.add(blackHoleGroup);
}

export function updateDeepSpace(dt, camPos) {
  // Rotate accretion disk particles
  if (blackHoleGroup && blackHoleGroup.userData.diskParticles) {
    blackHoleGroup.userData.diskParticles.rotation.y += dt * 0.5;
    if (blackHoleGroup.userData.disk) {
      blackHoleGroup.userData.disk.rotation.z += dt * 0.3;
    }
  }
}

export function getDeepSpaceObjects() {
  const objects = [...landmarks];
  if (blackHoleGroup) {
    objects.push({
      name: 'BLACK HOLE',
      desc: 'Stellar-mass black hole. 10 solar masses compressed into a singularity. Event horizon radius: 30 km.',
      g: blackHoleGroup,
      r: 8,
      isBlackHole: true,
      gravityRadius: 8 * 50, // 50x visual radius
    });
  }
  return objects;
}
```

- [ ] **Step 2: Verify — landmarks visible as glowing points in far distance, nebula clouds exist, black hole has accretion disk spinning**

---

## Task 7: HUD System (js/hud.js)

**Files:**
- Create: `js/hud.js`

Extracted HUD update logic — nearest body detection, distance display, speed, body descriptions.

- [ ] **Step 1: Create js/hud.js**

```javascript
// js/hud.js — HUD updates, nearest body, distance, speed, descriptions
import { getCamPos, getSpeed, isWarping, getBoostEnergy } from './flight.js';

const AU = 55;

const speedEl = () => document.getElementById('speed-val');
const tNameEl = () => document.getElementById('target-name');
const tDistEl = () => document.getElementById('target-dist');
const angEl = () => document.getElementById('ang-size');
const infoPanel = () => document.getElementById('info-panel');
const infoPanelDesc = () => {
  const panel = infoPanel();
  return panel ? panel.querySelector('.desc') : null;
};

let lastNearest = null;

export function initHud() {
  // Nothing special needed at init
}

export function updateHud(flight, allBodies) {
  const camPos = getCamPos();
  const speed = getSpeed();

  // Speed display
  const sel = speedEl();
  if (sel) sel.textContent = speed.toFixed(1);

  // Find nearest body
  let nb = null, nd = Infinity;
  for (const b of allBodies) {
    if (!b.g) continue;
    const dd = camPos.distanceTo(b.g.position) - b.r;
    if (dd < nd) { nd = dd; nb = b; }
  }

  if (nb) {
    const tName = tNameEl();
    const tDist = tDistEl();
    const ang = angEl();

    if (tName) tName.textContent = nb.name;
    if (tDist) {
      const km = Math.max(0, nd) / AU * 1.496e8;
      tDist.textContent = `${(Math.max(0, nd) / AU).toFixed(3)} AU · ${km.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')} km`;
    }
    if (ang) {
      const angDeg = (2 * Math.atan(nb.r / Math.max(nb.r + 0.001, camPos.distanceTo(nb.g.position))) * (180 / Math.PI)).toFixed(3);
      ang.textContent = `∅ ${angDeg}°`;
    }

    // Show description when close to a body
    const panel = infoPanel();
    const desc = infoPanelDesc();
    if (panel && desc) {
      if (nd < nb.r * 10 && nb.desc) {
        desc.textContent = nb.desc;
        panel.style.display = 'block';
      } else {
        panel.style.display = 'none';
      }
    }
  }
}
```

- [ ] **Step 2: Verify — HUD shows nearest body name, distance updates in real time, description appears when close**

---

## Task 8: Music System (js/music.js)

**Files:**
- Create: `js/music.js`

Zone-based classical music with crossfading. Falls back to procedural synth.

- [ ] **Step 1: Create js/music.js**

```javascript
// js/music.js — zone-based classical music with crossfading
const AU = 55;

// Zone definitions
const ZONES = [
  { name: 'sun',       check: (pos, bodies) => distToBody(pos, bodies, 'SOL') < 30 * AU },
  { name: 'blackhole', check: (pos, bodies) => distToBody(pos, bodies, 'BLACK HOLE') < 200 * AU },
  { name: 'nebula',    check: (pos, bodies) => nearestLandmarkDist(pos, bodies) < 500 * AU },
  { name: 'giants',    check: (pos, bodies) => nearGasGiant(pos, bodies) },
  { name: 'inner',     check: (pos, bodies) => nearInnerPlanet(pos, bodies) },
  { name: 'deep',      check: () => true },  // fallback — always matches last
];

// Track catalog per zone
const TRACKS = {
  sun:       ['audio/sun_zarathustra.mp3', 'audio/sun_mars.mp3'],
  inner:     ['audio/inner_clair_de_lune.mp3', 'audio/inner_moonlight.mp3'],
  giants:    ['audio/giants_jupiter.mp3', 'audio/giants_new_world.mp3'],
  deep:      ['audio/deep_gymnopedie.mp3', 'audio/deep_reverie.mp3'],
  nebula:    ['audio/nebula_air.mp3', 'audio/nebula_arabesque.mp3'],
  blackhole: ['audio/blackhole_adagio.mp3', 'audio/blackhole_mountain.mp3'],
};

// Two audio channels for crossfading
let channelA = null, channelB = null;
let activeChannel = 'A';
let currentZone = null;
let currentTrackIdx = {};
let masterVolume = 0.45;
let paused = false;
let started = false;
let fadeInterval = null;
let zoneCheckTimer = 0;

// Fallback synth (preserved from original)
let AC, masterGain, reverbNode, dryGain, synthStarted = false;
// ... (all the original procedural synth code for fallback) ...

function distToBody(pos, bodies, name) {
  const b = bodies.find(b => b.name === name);
  if (!b || !b.g) return Infinity;
  return pos.distanceTo(b.g.position);
}

function nearestLandmarkDist(pos, bodies) {
  let min = Infinity;
  for (const b of bodies) {
    if (b.isLandmark) {
      min = Math.min(min, pos.distanceTo(b.g.position));
    }
  }
  return min;
}

function nearGasGiant(pos, bodies) {
  for (const name of ['JUPITER', 'SATURN', 'URANUS', 'NEPTUNE']) {
    if (distToBody(pos, bodies, name) < 80 * AU) return true;
  }
  return false;
}

function nearInnerPlanet(pos, bodies) {
  for (const name of ['MERCURY', 'VENUS', 'EARTH', 'MARS', 'MOON']) {
    if (distToBody(pos, bodies, name) < 40 * AU) return true;
  }
  return false;
}

function detectZone(pos, bodies) {
  for (const zone of ZONES) {
    if (zone.check(pos, bodies)) return zone.name;
  }
  return 'deep';
}

function getNextTrack(zone) {
  const tracks = TRACKS[zone];
  if (!tracks || tracks.length === 0) return null;
  if (!currentTrackIdx[zone]) currentTrackIdx[zone] = 0;
  const track = tracks[currentTrackIdx[zone] % tracks.length];
  currentTrackIdx[zone]++;
  return track;
}

function createAudioEl() {
  const el = new Audio();
  el.volume = 0;
  el.preload = 'auto';
  return el;
}

function fadeIn(el, targetVol, duration = 4000) {
  const steps = 40;
  const stepTime = duration / steps;
  const volStep = targetVol / steps;
  let current = 0;
  const interval = setInterval(() => {
    current += volStep;
    if (current >= targetVol) {
      el.volume = targetVol;
      clearInterval(interval);
    } else {
      el.volume = current;
    }
  }, stepTime);
  return interval;
}

function fadeOut(el, duration = 4000) {
  if (!el || el.paused) return;
  const startVol = el.volume;
  const steps = 40;
  const stepTime = duration / steps;
  const volStep = startVol / steps;
  let current = startVol;
  const interval = setInterval(() => {
    current -= volStep;
    if (current <= 0) {
      el.volume = 0;
      el.pause();
      clearInterval(interval);
    } else {
      el.volume = current;
    }
  }, stepTime);
}

function playTrackOnChannel(channel, trackUrl) {
  if (!trackUrl) return;
  channel.src = trackUrl;
  channel.load();
  channel.play().catch(() => {}); // may fail if no user gesture yet
  fadeIn(channel, masterVolume);
}

function crossfadeTo(zone) {
  const trackUrl = getNextTrack(zone);
  if (!trackUrl) return;

  const outgoing = activeChannel === 'A' ? channelA : channelB;
  const incoming = activeChannel === 'A' ? channelB : channelA;

  fadeOut(outgoing);
  playTrackOnChannel(incoming, trackUrl);
  activeChannel = activeChannel === 'A' ? 'B' : 'A';
}

export function initMusic() {
  channelA = createAudioEl();
  channelB = createAudioEl();

  // When a track ends, play next in same zone
  channelA.addEventListener('ended', () => {
    if (currentZone && !paused) crossfadeTo(currentZone);
  });
  channelB.addEventListener('ended', () => {
    if (currentZone && !paused) crossfadeTo(currentZone);
  });

  // Volume slider
  const volSlider = document.getElementById('vol-slider');
  if (volSlider) {
    volSlider.addEventListener('input', e => {
      masterVolume = parseFloat(e.target.value);
      if (channelA && !channelA.paused) channelA.volume = Math.min(channelA.volume, masterVolume);
      if (channelB && !channelB.paused) channelB.volume = Math.min(channelB.volume, masterVolume);
    });
  }

  // Pause/resume button
  const musicBtn = document.getElementById('music-btn');
  if (musicBtn) {
    musicBtn.addEventListener('click', () => {
      if (!started) {
        started = true;
        musicBtn.textContent = '‖ PAUSE';
        return;
      }
      if (paused) {
        paused = false;
        if (channelA && channelA.src) channelA.play().catch(()=>{});
        if (channelB && channelB.src) channelB.play().catch(()=>{});
        musicBtn.textContent = '‖ PAUSE';
      } else {
        paused = true;
        if (channelA) channelA.pause();
        if (channelB) channelB.pause();
        musicBtn.textContent = '♪ MUSIC';
      }
    });
  }

  return {
    start() {
      started = true;
      if (musicBtn) musicBtn.textContent = '‖ PAUSE';
    }
  };
}

export function updateMusic(camPos, allBodies) {
  if (!started || paused) return;

  zoneCheckTimer += 0.016; // approximate dt
  if (zoneCheckTimer < 2.0) return; // check every ~2 seconds
  zoneCheckTimer = 0;

  const zone = detectZone(camPos, allBodies);
  if (zone !== currentZone) {
    currentZone = zone;
    crossfadeTo(zone);
    // Update track label
    const lbl = document.getElementById('track-lbl');
    if (lbl) lbl.textContent = zone.toUpperCase() + ' ZONE';
  }

  // If nothing is playing (both channels silent), start something
  if (channelA.paused && channelB.paused && currentZone) {
    crossfadeTo(currentZone);
  }
}
```

- [ ] **Step 2: Verify — music changes when flying between zones, crossfade is smooth, pause/resume works**

---

## Task 9: Integration, Polish, Black Hole Event Horizon

**Files:**
- Modify: `js/main.js` — wire everything together properly
- Modify: `js/engine.js` — black hole distortion uniform updates
- Modify: `js/flight.js` — event horizon detection and return-home trigger

- [ ] **Step 1: Wire black hole distortion into the render loop**

In `main.js` animate loop, update the distortion pass uniforms based on black hole screen position and distance:

```javascript
// In animate loop, after updateFlight:
const bhObjects = getDeepSpaceObjects().filter(o => o.isBlackHole);
if (bhObjects.length > 0) {
  const bh = bhObjects[0];
  const bhScreenPos = bh.g.position.clone().project(camera);
  const distToBH = getCamPos().distanceTo(bh.g.position);
  const distortionPass = getDistortionPass();
  if (distortionPass) {
    distortionPass.uniforms.bhScreenPos.value.set(
      (bhScreenPos.x + 1) / 2,
      (-bhScreenPos.y + 1) / 2
    );
    // Strength increases as you get closer
    const maxDist = bh.r * 50 * AU;
    const strength = Math.max(0, 1 - distToBH / maxDist) * 3.0;
    distortionPass.uniforms.bhStrength.value = bhScreenPos.z < 1 ? strength : 0;
  }

  // Event horizon check
  if (distToBH < bh.r * 1.2) {
    // Flash and return home
    const flash = document.getElementById('horizon-flash');
    if (flash) {
      flash.style.transition = 'opacity 0.3s';
      flash.style.opacity = '1';
      setTimeout(() => {
        flash.style.transition = 'opacity 2s';
        flash.style.opacity = '0';
      }, 300);
    }
    // Trigger return home via flight module
    doHome(); // exported from flight.js
  }
}

// Update film grain time
updateFilmGrain(performance.now() * 0.001);

// Update sun light flicker
getSunLight().intensity = 4.8 + Math.sin(performance.now() * 0.001 * 6.2) * 0.4;
```

- [ ] **Step 2: Final integration — ensure all modules are properly imported and wired in main.js**

Review main.js to ensure:
- All imports resolve
- `createSkybox()` and `createStars()` are called after texture load
- `setCamera(camera)` is called so flight.js has the camera reference
- The animate loop calls all update functions in the correct order
- Resize handler updates both renderer and composer

- [ ] **Step 3: Update .claude/launch.json if needed and verify full experience**

Launch the preview server. Verify:
1. Textures load (real or procedural fallback)
2. Stars and skybox render
3. Bloom is visible on sun and bright objects
4. WASD gives smooth acceleration with drift
5. Right-click drag looks around
6. Shift warps with speed increase
7. Planets orbit, Earth has clouds, Saturn has rings
8. Deep space landmarks visible in the distance
9. Black hole has spinning accretion disk and distorts the background
10. Music plays and changes zones when you fly around
11. H returns home smoothly
12. HUD shows distance, speed, nearest body
13. Vignette and film grain are subtle but present

- [ ] **Step 4: Commit**

```bash
git init  # if not already a repo
git add index.html js/ textures/ audio/ .claude/launch.json
git commit -m "feat: universe explorer redesign — physics, music, deep space, post-processing"
```

---

## Execution Notes

- **Asset downloads (Task 0)** should be done first and may require web search to find working URLs. If specific URLs fail, the code handles missing assets gracefully with procedural fallbacks.
- **Tasks 1-3** (shell, textures, engine) should be done sequentially as they form the foundation.
- **Tasks 4-8** (flight, bodies, deepspace, hud, music) can be done in parallel since they're independent modules wired together in main.js.
- **Task 9** (integration) must be done last as it ties everything together.
- The Three.js r170 importmap approach means no build step — just serve the directory.
