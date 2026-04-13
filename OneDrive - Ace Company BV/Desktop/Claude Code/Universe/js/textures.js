// textures.js - Texture loading module with procedural fallbacks
import * as THREE from 'three';

// ── Noise / procedural helpers ──────────────────────────────────────

function mkTex(w, h, fn) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  fn(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function hh(a, b) { let v = (Math.sin(a*127.1+b*311.7)*43758.5453)%1; return v<0?v+1:v; }

function sn(x, y, s) {
  x*=s; y*=s;
  const xi=Math.floor(x), yi=Math.floor(y), xf=x-xi, yf=y-yi;
  const ux=xf*xf*(3-2*xf), uy=yf*yf*(3-2*yf);
  return hh(xi,yi)*(1-ux)*(1-uy)+hh(xi+1,yi)*ux*(1-uy)+hh(xi,yi+1)*(1-ux)*uy+hh(xi+1,yi+1)*ux*uy;
}

function fbm(x, y, o, s) {
  let v=0, a=1, t=0;
  for(let i=0;i<o;i++){v+=sn(x,y,s)*a;t+=a;a*=.48;s*=2.1;}
  return v/t;
}

function wfbm(x, y, o, s) {
  const qx=fbm(x,y,4,s*.7), qy=fbm(x+5.2,y+1.3,4,s*.7);
  return fbm(x+qx*3.5,y+qy*3.5,o,s);
}

function mkProc(w, h, r1,g1,b1, r2,g2,b2, s, ox, oy) {
  return mkTex(w, h, (ctx, w, h) => {
    const img = ctx.createImageData(w, h);
    for(let y=0;y<h;y++) for(let x=0;x<w;x++){
      const lat=(y/h-.5)*Math.PI, lon=(x/w)*Math.PI*2;
      const nx=Math.cos(lat)*Math.cos(lon)+(ox||3), ny=Math.sin(lat)+(oy||3);
      const n=wfbm(nx,ny,7,s||1.5); const i=(y*w+x)*4;
      img.data[i]=Math.floor(r1+n*(r2-r1));
      img.data[i+1]=Math.floor(g1+n*(g2-g1));
      img.data[i+2]=Math.floor(b1+n*(b2-b1));
      img.data[i+3]=255;
    }
    ctx.putImageData(img,0,0);
  });
}

function mkLandmarkFallback(w, h, inner, outer) {
  return mkTex(w, h, (ctx, w, h) => {
    const grd = ctx.createRadialGradient(w/2, h/2, 0, w/2, h/2, w/2);
    grd.addColorStop(0, `rgba(${outer[0]},${outer[1]},${outer[2]},1)`);
    grd.addColorStop(0.3, `rgba(${inner[0]},${inner[1]},${inner[2]},0.8)`);
    grd.addColorStop(1, `rgba(${inner[0]},${inner[1]},${inner[2]},0)`);
    ctx.fillStyle = grd; ctx.fillRect(0,0,w,h);
  });
}

// ── Procedural fallback map ─────────────────────────────────────────

const PROCEDURAL = {
  sun:      () => mkProc(512,256, 195,70,0, 255,210,30, 2, 1.8,1.8),
  mercury:  () => mkProc(512,256, 108,100,92, 168,155,138, 2.2),
  venus:    () => mkProc(512,256, 168,128,48, 215,178,90, 1.4, 4,4),
  earth:    () => mkProc(512,256, 8,35,100, 35,80,30, 1.6, 2,2),
  earthNight: () => mkTex(512,256, (ctx,w,h) => { ctx.fillStyle='#000'; ctx.fillRect(0,0,w,h); }),
  earthClouds: () => mkProc(512,256, 200,200,200, 255,255,255, 2, 10,10),
  earthNormal: () => mkTex(512,256, (ctx,w,h) => {
    const img=ctx.createImageData(w,h);
    for(let i=0;i<w*h*4;i+=4){img.data[i]=128;img.data[i+1]=128;img.data[i+2]=255;img.data[i+3]=255;}
    ctx.putImageData(img,0,0);
  }),
  earthSpec: () => mkTex(512,256, (ctx,w,h) => { ctx.fillStyle='#333'; ctx.fillRect(0,0,w,h); }),
  moon:     () => mkProc(512,256, 100,95,88, 165,158,148, 2.5, 5,5),
  mars:     () => mkProc(512,256, 142,48,28, 200,98,58, 1.8),
  jupiter:  () => mkProc(512,256, 168,110,65, 225,182,128, 2, 7,7),
  saturn:   () => mkProc(512,256, 195,172,120, 235,212,148, 1.8, 4,4),
  saturnRing: () => mkTex(512,4, (ctx,w) => {
    const g=ctx.createLinearGradient(0,0,w,0);
    g.addColorStop(0,'rgba(170,150,90,0)'); g.addColorStop(.08,'rgba(210,188,120,0.7)');
    g.addColorStop(.22,'rgba(228,205,135,0.88)'); g.addColorStop(.40,'rgba(235,212,142,0.92)');
    g.addColorStop(.55,'rgba(215,192,128,0.68)'); g.addColorStop(.72,'rgba(190,168,108,0.35)');
    g.addColorStop(1,'rgba(158,138,88,0)'); ctx.fillStyle=g; ctx.fillRect(0,0,w,4);
  }),
  uranus:   () => mkProc(512,256, 85,188,200, 138,220,232, 1.1, 6,6),
  neptune:  () => mkProc(512,256, 12,30,168, 32,70,220, 1.3, 7,7),
  pluto:    () => mkProc(512,256, 180,160,130, 220,200,170, 1.5, 3,3),
  venusAtmo: () => mkProc(512,256, 200,180,100, 240,220,150, 1.2, 5,5),
  // ── Moon textures (procedural) ──
  phobos:   () => mkProc(256,128, 80,75,68, 130,122,110, 3.0, 8,8),
  deimos:   () => mkProc(256,128, 90,82,72, 140,130,115, 2.8, 9,9),
  io:       () => mkProc(256,128, 180,160,40, 230,200,60, 1.8, 3,3),   // sulfur yellow
  europa:   () => mkProc(256,128, 160,150,130, 220,215,200, 1.5, 4,4), // icy white
  ganymede: () => mkProc(256,128, 120,110,90, 180,168,145, 2.0, 5,5),  // brownish gray
  callisto: () => mkProc(256,128, 60,55,48, 120,112,100, 2.5, 6,6),    // dark cratered
  titan:    () => mkProc(256,128, 160,120,50, 210,170,80, 1.3, 7,7),   // orange haze
  enceladus:() => mkProc(256,128, 200,200,210, 240,240,250, 1.6, 8,8), // bright ice
  mimas:    () => mkProc(256,128, 140,138,132, 200,196,188, 2.2, 9,9), // gray cratered
  titania:  () => mkProc(256,128, 130,120,110, 185,175,165, 2.0, 10,10),
  oberon:   () => mkProc(256,128, 100,90,82, 155,145,135, 2.3, 11,11),
  triton:   () => mkProc(256,128, 150,160,170, 210,220,230, 1.8, 12,12), // icy blue-pink
  starmap:  () => mkTex(2048,1024, (ctx,w,h) => {
    ctx.fillStyle='#000'; ctx.fillRect(0,0,w,h);
    for(let i=0;i<3000;i++){
      const br=Math.random();
      ctx.fillStyle=`rgba(${200+Math.random()*55|0},${200+Math.random()*55|0},${220+Math.random()*35|0},${br})`;
      ctx.fillRect(Math.random()*w, Math.random()*h, 1+Math.random(), 1+Math.random());
    }
  }),
  landmarkOrion:     () => mkLandmarkFallback(512,512, [30,80,180], [200,100,255]),
  landmarkPillars:   () => mkLandmarkFallback(512,512, [80,50,20], [255,180,80]),
  landmarkCrab:      () => mkLandmarkFallback(512,512, [180,40,20], [255,200,100]),
  landmarkAndromeda: () => mkLandmarkFallback(512,512, [20,20,60], [150,170,255]),
};

// ── Texture catalog: key -> ordered list of paths to try ────────────

const TEXTURE_PATHS = {
  sun:               ['textures/8k_sun.jpg', 'textures/2k_sun.jpg'],
  mercury:           ['textures/8k_mercury.jpg', 'textures/2k_mercury.jpg'],
  venus:             ['textures/8k_venus_surface.jpg', 'textures/2k_venus_surface.jpg'],
  venusAtmo:         ['textures/4k_venus_atmosphere.jpg', 'textures/2k_venus_atmosphere.jpg'],
  earth:             ['textures/8k_earth_daymap.jpg', 'textures/2k_earth_daymap.jpg'],
  earthNight:        ['textures/8k_earth_nightmap.jpg', 'textures/2k_earth_nightmap.jpg'],
  earthClouds:       ['textures/8k_earth_clouds.jpg', 'textures/2k_earth_clouds.jpg'],
  earthNormal:       ['textures/8k_earth_normal_map.jpg', 'textures/2k_earth_normal_map.jpg'],
  earthSpec:         ['textures/8k_earth_specular_map.jpg', 'textures/2k_earth_specular_map.jpg'],
  moon:              ['textures/8k_moon.jpg', 'textures/2k_moon.jpg'],
  mars:              ['textures/8k_mars.jpg', 'textures/2k_mars.jpg'],
  jupiter:           ['textures/8k_jupiter.jpg', 'textures/2k_jupiter.jpg'],
  saturn:            ['textures/8k_saturn.jpg', 'textures/2k_saturn.jpg'],
  saturnRing:        ['textures/8k_saturn_ring_alpha.png', 'textures/2k_saturn_ring_alpha.png'],
  uranus:            ['textures/2k_uranus.jpg'],
  neptune:           ['textures/2k_neptune.jpg'],
  pluto:             ['textures/2k_pluto.jpg'],
  starmap:           ['textures/starmap_4k.jpg', 'textures/8k_stars_milky_way.jpg', 'textures/8k_stars.jpg'],
  // Moon textures — procedural only (no real texture files)
  phobos:    [],
  deimos:    [],
  io:        [],
  europa:    [],
  ganymede:  [],
  callisto:  [],
  titan:     [],
  enceladus: [],
  mimas:     [],
  titania:   [],
  oberon:    [],
  triton:    [],
  landmarkOrion:     ['textures/landmark_orion.jpg'],
  landmarkPillars:   ['textures/landmark_pillars.jpg'],
  landmarkCrab:      ['textures/landmark_crab.jpg'],
  landmarkAndromeda: ['textures/landmark_andromeda.jpg'],
};

// ── Loader ──────────────────────────────────────────────────────────

/**
 * Try loading a texture from an ordered list of paths.
 * Returns { texture, source: 'real'|'procedural' }
 */
function tryLoad(loader, key, paths) {
  return new Promise((resolve) => {
    let idx = 0;
    let resolved = false;

    function fallback() {
      if (resolved) return;
      resolved = true;
      if (PROCEDURAL[key]) {
        resolve({ texture: PROCEDURAL[key](), source: 'procedural' });
      } else {
        resolve({ texture: mkTex(64, 64, (ctx, w, h) => {
          ctx.fillStyle = '#ff00ff'; ctx.fillRect(0,0,w,h);
        }), source: 'procedural' });
      }
    }

    function attempt() {
      if (idx >= paths.length) {
        fallback();
        return;
      }

      const path = paths[idx];
      // Timeout per attempt — 10 seconds max
      const timeout = setTimeout(() => {
        idx++;
        attempt();
      }, 10000);

      loader.load(
        path,
        (tex) => {
          if (resolved) return;
          clearTimeout(timeout);
          resolved = true;
          tex.colorSpace = THREE.SRGBColorSpace;
          resolve({ texture: tex, source: 'real' });
        },
        undefined,
        () => {
          clearTimeout(timeout);
          idx++;
          attempt();
        }
      );
    }

    // Global timeout — 15 seconds total per texture
    setTimeout(fallback, 15000);
    attempt();
  });
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Load all textures in parallel. Calls onProgress(0-1, detailString) as
 * each texture resolves.
 *
 * Returns { sun: Texture, mercury: Texture, ..., status: { sun: 'real'|'procedural', ... } }
 */
export async function loadAllTextures(onProgress) {
  const loader = new THREE.TextureLoader();
  const keys = Object.keys(TEXTURE_PATHS);
  const total = keys.length;
  let done = 0;

  const results = {};
  const status = {};

  const promises = keys.map((key) => {
    return tryLoad(loader, key, TEXTURE_PATHS[key]).then(({ texture, source }) => {
      results[key] = texture;
      status[key] = source;
      done++;
      if (onProgress) {
        onProgress(done / total, `${key} (${source})`);
      }
    });
  });

  await Promise.all(promises);

  results.status = status;
  return results;
}

// ── Shared circular point sprite texture ───────────────────────────
let _pointTex = null;
export function getPointTexture() {
  if (_pointTex) return _pointTex;
  const size = 64;
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  const ctx = cv.getContext('2d');
  const half = size / 2;
  const grd = ctx.createRadialGradient(half, half, 0, half, half, half);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.2, 'rgba(255,255,255,0.8)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.3)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, size, size);
  _pointTex = new THREE.CanvasTexture(cv);
  return _pointTex;
}
