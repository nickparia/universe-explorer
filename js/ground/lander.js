// ground/lander.js — the SOLACE, standing on her pad.
//
// The ship gains a body (docs/SHIP.md). This is the S0 hull: the same
// vessel the exterior view and the walkable interior will be, seen
// first as the thing you walk away from and back to. Built to the
// quality law: stylized × Nostromo — painted panel detail, palette
// shading, silhouette greebles, practicals as jewelry. Every texture
// here is PAINTED at runtime onto canvas: seams, rivets, wear streaks,
// hazard stripes, stencils, grime — the hand-crafted density that
// photorealism can't age into and low-effort low-poly never reaches.
//
// At night she is the hearth: windows glow warm, beacons breathe,
// floodlights pool on the pad. The engine bells hold their ember for
// a few minutes after landing, then cool.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { heightAt } from './site.js';

let group = null;
let parts = null;      // named practicals for the update loop
let landedAt = 0;      // ember clock

// The ship parks east of the touchdown point, broadside to the spawn —
// far enough that she reads as a VESSEL, not a wall. (34 m of hull
// wants ~35 m of viewing distance.)
export const SHIP_POS = { x: 36, z: -6, yaw: Math.PI / 2 };

// ── The paint shop: hand-crafted canvas textures ─────────────────────

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/** A wobbly painted line — never ruler-straight; that's the craft. */
function seam(g, x1, y1, x2, y2, color, width) {
  g.strokeStyle = color;
  g.lineWidth = width;
  g.beginPath();
  const steps = 6;
  g.moveTo(x1, y1);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    g.lineTo(
      x1 + (x2 - x1) * t + (Math.random() - 0.5) * 1.6,
      y1 + (y2 - y1) * t + (Math.random() - 0.5) * 1.6
    );
  }
  g.stroke();
}

/** Vertical grime streak below a point — thin at top, fading out. */
function streak(g, x, y, len, w, alpha, color = '38,34,28') {
  const grad = g.createLinearGradient(x, y, x, y + len);
  grad.addColorStop(0, `rgba(${color},${alpha})`);
  grad.addColorStop(1, `rgba(${color},0)`);
  g.fillStyle = grad;
  g.fillRect(x - w / 2, y, w, len);
}

// ── The corrosion pass: iron under the paint ─────────────────────────
// Rust is a story told in layers: a bloom of overlapping oxide dabs in
// three hues (dark core, mid body, bright fresh edge), eaten-looking
// because every dab is offset and sized by hand-jitter.
const RUST = ['#5a3018', '#7a4520', '#9a5c28', '#b06a2c'];

function rustBloom(g, x, y, r) {
  for (let i = 0; i < 8 + r; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = Math.random() * r;
    g.fillStyle = RUST[Math.min(3, Math.floor((d / r) * 3 + Math.random() * 1.4))] +
      (Math.random() < 0.4 ? 'cc' : '88');
    g.beginPath();
    g.ellipse(x + Math.cos(a) * d, y + Math.sin(a) * d,
      1 + Math.random() * (r * 0.35), 0.8 + Math.random() * (r * 0.25),
      Math.random() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }
  // the tell: a rust streak bleeding down from the bloom
  if (Math.random() < 0.7) streak(g, x, y, r * (3 + Math.random() * 5), 2 + Math.random() * r * 0.5, 0.28, '122,69,32');
}

/** A paint chip: bite out the coat, show dark iron, rust the rim. */
function chip(g, x, y, s) {
  g.fillStyle = '#3a3630';
  g.beginPath();
  g.moveTo(x, y);
  for (let i = 1; i <= 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    g.lineTo(x + Math.cos(a) * s * (0.5 + Math.random() * 0.8),
             y + Math.sin(a) * s * (0.5 + Math.random() * 0.8));
  }
  g.closePath();
  g.fill();
  g.strokeStyle = RUST[2] + 'aa';
  g.lineWidth = 1;
  g.stroke();
}

/** The painted hull plate: iron first, paint second. Bone-ochre coat
 *  over rust-brown metal, weathered until the ship's age is the first
 *  thing you read: whole plates gone to oxide, run-down stains, dust
 *  thrown up the lower hull, and every seam a place corrosion lives. */
function paintHull(w, h, { stripes = false, stencil = null, grime = 0.5 } = {}) {
  const c = canvas(w, h);
  const g = c.getContext('2d');

  // Base coat, dirtier and more varied than before
  g.fillStyle = '#8a8272';
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 30; i++) {
    g.fillStyle = `rgba(${110 + Math.random() * 55 | 0},${102 + Math.random() * 48 | 0},${86 + Math.random() * 40 | 0},0.14)`;
    g.fillRect(Math.random() * w, Math.random() * h, 50 + Math.random() * 150, 40 + Math.random() * 110);
  }
  // large soft mottling — decades of unequal sun and dust
  for (let i = 0; i < 10; i++) {
    const mg = g.createRadialGradient(
      Math.random() * w, Math.random() * h, 10,
      Math.random() * w, Math.random() * h, 90 + Math.random() * 140);
    mg.addColorStop(0, 'rgba(70,58,44,0.13)');
    mg.addColorStop(1, 'rgba(70,58,44,0)');
    g.fillStyle = mg;
    g.fillRect(0, 0, w, h);
  }

  // Panel grid — irregular spacing, like plates cut to fit
  const cols = [0];
  for (let x = 0; x < w;) { x += 54 + Math.random() * 90; if (x < w) cols.push(x); }
  const rows = [0];
  for (let y = 0; y < h;) { y += 44 + Math.random() * 70; if (y < h) rows.push(y); }

  // SOME PLATES LOST THE ARGUMENT: ~10% are majority rust — repaired
  // with whatever iron was aboard and never repainted
  for (let ci = 0; ci < cols.length; ci++) {
    for (let ri = 0; ri < rows.length; ri++) {
      const x0 = cols[ci], y0 = rows[ri];
      const x1 = cols[ci + 1] ?? w, y1 = rows[ri + 1] ?? h;
      const roll = Math.random();
      if (roll < 0.10 * grime) {
        // the rusted-out plate: iron brown base + heavy oxide texture
        g.fillStyle = `rgba(94,58,30,${0.55 + Math.random() * 0.3})`;
        g.fillRect(x0, y0, x1 - x0, y1 - y0);
        for (let i = 0; i < 14; i++) {
          rustBloom(g, x0 + Math.random() * (x1 - x0), y0 + Math.random() * (y1 - y0), 3 + Math.random() * 8);
        }
      } else if (roll < 0.28) {
        // a plate that just reads DARKER — replaced, or older paint
        g.fillStyle = `rgba(58,50,40,${0.10 + Math.random() * 0.14})`;
        g.fillRect(x0, y0, x1 - x0, y1 - y0);
      }
      // rust creeping up from each plate's bottom seam
      if (Math.random() < 0.6) {
        const bg = g.createLinearGradient(0, y1, 0, y1 - 16);
        bg.addColorStop(0, `rgba(122,69,32,${0.22 + Math.random() * 0.2})`);
        bg.addColorStop(1, 'rgba(122,69,32,0)');
        g.fillStyle = bg;
        g.fillRect(x0 + 2, y1 - 16, x1 - x0 - 4, 16);
      }
    }
  }

  for (const x of cols) seam(g, x, 0, x, h, 'rgba(46,40,32,0.7)', 1.8);
  for (const y of rows) seam(g, 0, y, w, y, 'rgba(46,40,32,0.6)', 1.6);
  // A one-pixel light kiss beside each seam sells the plate edge
  for (const x of cols) seam(g, x + 2, 0, x + 2, h, 'rgba(220,214,196,0.16)', 1);
  // and rust living IN the seams themselves
  for (const x of cols) if (Math.random() < 0.5) seam(g, x - 1, 0, x - 1, h, 'rgba(122,69,32,0.35)', 2.2);
  for (const y of rows) if (Math.random() < 0.5) seam(g, 0, y + 1, w, y + 1, 'rgba(122,69,32,0.3)', 2);

  // Rivets marching along the seams — each with a faint oxide halo
  for (const x of cols) for (let y = 8; y < h; y += 22 + Math.random() * 8) {
    if (Math.random() < 0.4) {
      g.fillStyle = 'rgba(122,69,32,0.4)';
      g.beginPath(); g.arc(x + 5, y, 2.8, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = 'rgba(45,42,36,0.7)';
    g.beginPath(); g.arc(x + 5, y, 1.4, 0, Math.PI * 2); g.fill();
  }

  // The iron shows through, EVERYWHERE: blooms at junctions and plate
  // wounds, chips to dark metal, long rusty run-downs from the seams
  // above — a machine rained on by two decades of space weather that
  // nobody ever repainted.
  for (let i = 0; i < 40 * grime; i++) {
    rustBloom(g, Math.random() * w, Math.random() * h, 4 + Math.random() * 14);
  }
  for (const x of cols) for (const y of rows) {
    if (Math.random() < 0.45) rustBloom(g, x + (Math.random() - 0.5) * 8, y + (Math.random() - 0.5) * 8, 4 + Math.random() * 9);
  }
  for (let i = 0; i < 60 * grime; i++) {
    chip(g, Math.random() * w, Math.random() * h, 2 + Math.random() * 6);
  }
  // the long stains: rust-water run-downs off the upper seams
  for (const y of rows) {
    for (let i = 0; i < 5; i++) {
      if (Math.random() < 0.6) {
        streak(g, Math.random() * w, y, 50 + Math.random() * 130, 3 + Math.random() * 8,
          0.2 + Math.random() * 0.2, '122,69,32');
      }
    }
  }
  // dust thrown up the lower hull — the planet claiming her
  const dust = g.createLinearGradient(0, h, 0, h * 0.6);
  dust.addColorStop(0, 'rgba(112,70,42,0.30)');
  dust.addColorStop(1, 'rgba(112,70,42,0)');
  g.fillStyle = dust;
  g.fillRect(0, h * 0.6, w, h * 0.4);

  // Grime: streaks bleeding down from seam junctions and vents
  for (let i = 0; i < 22 * grime; i++) {
    streak(g, Math.random() * w, Math.random() * h * 0.7, 30 + Math.random() * 90, 3 + Math.random() * 7, 0.10 + Math.random() * 0.14);
  }

  // Hazard band along the bottom edge
  if (stripes) {
    const bh = 26;
    g.save();
    g.beginPath(); g.rect(0, h - bh, w, bh); g.clip();
    g.fillStyle = '#a89a3c';
    g.fillRect(0, h - bh, w, bh);
    g.fillStyle = '#33302a';
    for (let x = -bh; x < w + bh; x += 36) {
      g.beginPath();
      g.moveTo(x, h); g.lineTo(x + 18, h - bh); g.lineTo(x + 36, h - bh); g.lineTo(x + 18, h);
      g.closePath(); g.fill();
    }
    // the band is old paint: scuff it
    for (let i = 0; i < 30; i++) {
      g.fillStyle = 'rgba(142,137,123,0.5)';
      g.fillRect(Math.random() * w, h - bh + Math.random() * bh, 2 + Math.random() * 8, 1 + Math.random() * 3);
    }
    g.restore();
  }

  // Stencils — worn company paint
  if (stencil) {
    g.save();
    g.font = `bold ${stencil.size || 46}px "Arial Narrow", Arial, sans-serif`;
    g.fillStyle = `rgba(84,42,34,${stencil.alpha || 0.78})`;
    g.textAlign = 'left';
    g.fillText(stencil.text, stencil.x, stencil.y);
    // wear: bite specks out of the letters
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 160; i++) {
      g.fillStyle = 'rgba(0,0,0,0.5)';
      g.fillRect(stencil.x + Math.random() * stencil.text.length * (stencil.size || 46) * 0.6,
        stencil.y - (stencil.size || 46) + Math.random() * (stencil.size || 46) * 1.2,
        1 + Math.random() * 3, 1 + Math.random() * 2);
    }
    g.restore();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Darker machine surfaces: engine towers, legs, underside. */
function paintMech(w, h) {
  const c = canvas(w, h);
  const g = c.getContext('2d');
  g.fillStyle = '#565860';
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 20; i++) {
    g.fillStyle = `rgba(${60 + Math.random() * 40 | 0},${62 + Math.random() * 38 | 0},${68 + Math.random() * 36 | 0},0.14)`;
    g.fillRect(Math.random() * w, Math.random() * h, 30 + Math.random() * 80, 20 + Math.random() * 60);
  }
  for (let y = 0; y < h; y += 26 + Math.random() * 30) seam(g, 0, y, w, y, 'rgba(28,28,32,0.6)', 1.6);
  for (let x = 0; x < w; x += 40 + Math.random() * 60) seam(g, x, 0, x, h, 'rgba(28,28,32,0.5)', 1.4);
  for (let i = 0; i < 24; i++) streak(g, Math.random() * w, Math.random() * h * 0.6, 20 + Math.random() * 60, 3 + Math.random() * 6, 0.16);
  // machine iron rusts harder than painted hull
  for (let i = 0; i < 16; i++) rustBloom(g, Math.random() * w, Math.random() * h, 3 + Math.random() * 10);
  for (let i = 0; i < 14; i++) chip(g, Math.random() * w, Math.random() * h, 2 + Math.random() * 4);
  // oil kisses and scuffs
  for (let i = 0; i < 12; i++) {
    g.fillStyle = 'rgba(20,18,16,0.25)';
    g.beginPath();
    g.ellipse(Math.random() * w, Math.random() * h, 4 + Math.random() * 14, 2 + Math.random() * 6, Math.random(), 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ── Materials ────────────────────────────────────────────────────────

// A painted surface that never drops to black: the texture doubles as
// its own dim emissive map, so shadowed plates show their detail in a
// warm rust key. This is how the site's shadow side stays ART — the
// scene has no ambient light, and lights can't reach every flank.
function paintedMat(tex) {
  return new THREE.MeshLambertMaterial({
    map: tex,
    emissiveMap: tex,
    emissive: new THREE.Color(0xc0906c),
    emissiveIntensity: 0.34,
  });
}

function mats() {
  return {
    hull: paintedMat(paintHull(512, 512)),
    hullSide: paintedMat(paintHull(1024, 512, { stripes: true, stencil: { text: 'SOLACE', x: 96, y: 210, size: 92, alpha: 0.62 } })),
    hullBow: paintedMat(paintHull(512, 512, { stencil: { text: 'DHV-2', x: 60, y: 120, size: 54, alpha: 0.55 }, grime: 0.8 })),
    mech: paintedMat(paintMech(512, 512)),
    glassWarm: new THREE.MeshLambertMaterial({
      color: 0x201a12, emissive: 0xffc06a, emissiveIntensity: 0,
    }),
    glassDome: new THREE.MeshLambertMaterial({
      color: 0x0e1214, emissive: 0x88b0c8, emissiveIntensity: 0.06,
      transparent: true, opacity: 0.85,
    }),
    beaconR: new THREE.MeshLambertMaterial({ color: 0x1c0c0a, emissive: 0xff3020, emissiveIntensity: 0 }),
    beaconG: new THREE.MeshLambertMaterial({ color: 0x0a140c, emissive: 0x28ff60, emissiveIntensity: 0 }),
    strobe: new THREE.MeshLambertMaterial({ color: 0x14140f, emissive: 0xfff4dc, emissiveIntensity: 0 }),
    bell: new THREE.MeshLambertMaterial({ color: 0x3a3c40, emissive: 0xff6a28, emissiveIntensity: 0 }),
  };
}

// ── The body (SHIP.md massing) ───────────────────────────────────────

function box(w, h, d, mat) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
}

/** Greeble cluster: pipes and small boxes, seeded placement. */
function greebles(mat, count, spread, yBase) {
  const g = new THREE.Group();
  for (let i = 0; i < count; i++) {
    const pipe = Math.random() < 0.5;
    const m = pipe
      ? new THREE.Mesh(new THREE.CylinderGeometry(0.06 + Math.random() * 0.1, 0.06 + Math.random() * 0.1, 0.5 + Math.random() * 1.6, 6), mat)
      : box(0.2 + Math.random() * 0.6, 0.15 + Math.random() * 0.5, 0.2 + Math.random() * 0.6, mat);
    m.position.set((Math.random() - 0.5) * spread.x, yBase + Math.random() * spread.y, (Math.random() - 0.5) * spread.z);
    if (pipe && Math.random() < 0.5) m.rotation.z = Math.PI / 2;
    g.add(m);
  }
  return g;
}

function buildShip() {
  const M = mats();
  const ship = new THREE.Group();
  const P = {};

  // ── midbody: the home (14 × 4.4 × 7) ──
  // Material per face: the stencilled plate lives on the FLANKS only;
  // the deck and belly wear their own paint.
  const mid = new THREE.Mesh(new THREE.BoxGeometry(14, 4.4, 7),
    [M.hull, M.hull, M.hull, M.mech, M.hullSide, M.hullSide]);
  mid.position.set(0, 4.4 / 2, 0);
  ship.add(mid);
  // dorsal spine rails + greebles: the working back of the ship
  const spine = box(11, 0.5, 2.4, M.mech);
  spine.position.set(0, 4.7, 0);
  ship.add(spine);
  ship.add(greebles(M.mech, 26, { x: 10, y: 0.8, z: 4.2 }, 4.6));

  // observatory blister — the dorsal glass half-dome, aft of midships
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(1.7, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), M.glassDome);
  dome.position.set(-3.4, 4.5, 0);
  ship.add(dome);
  const domeRing = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.16, 8, 24), M.mech);
  domeRing.rotation.x = Math.PI / 2;
  domeRing.position.copy(dome.position);
  ship.add(domeRing);
  P.dome = dome;

  // mess porthole + corridor deadlights, BOTH flanks — the hearth
  // must glow from every approach
  P.windows = [];
  for (const side of [1, -1]) {
    const porthole = new THREE.Mesh(new THREE.CircleGeometry(0.5, 20), M.glassWarm);
    porthole.position.set(1.4, 2.6, 3.53 * side);
    porthole.rotation.y = side > 0 ? 0 : Math.PI;
    ship.add(porthole);
    P.windows.push(porthole);
    for (const dx of [-2.2, -4.6]) {
      const dl = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.4), M.glassWarm);
      dl.position.set(dx, 2.7, 3.53 * side);
      dl.rotation.y = side > 0 ? 0 : Math.PI;
      ship.add(dl);
      P.windows.push(dl);
    }
  }

  // ── forward castle: bridge over cryo (two decks) ──
  const castle = new THREE.Mesh(new THREE.BoxGeometry(5.2, 7.2, 6.2),
    [M.hullBow, M.hull, M.hull, M.mech, M.hull, M.hull]);
  castle.position.set(9.4, 7.2 / 2, 0);
  ship.add(castle);
  // the bridge glass slit — wide, low, angled by a chamfer illusion
  const slit = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 0.85), M.glassWarm);
  slit.position.set(12.02, 5.9, 0);
  slit.rotation.y = Math.PI / 2;
  ship.add(slit);
  P.windows.push(slit);
  // brow overhang above the glass — the ship frowns into the weather
  const brow = box(1.1, 0.5, 6.6, M.mech);
  brow.position.set(11.7, 6.7, 0);
  ship.add(brow);
  // chin floodlight housings
  const chin = box(0.9, 0.6, 3.6, M.mech);
  chin.position.set(11.9, 1.6, 0);
  ship.add(chin);

  // wedge nose ahead of the castle — the bow leans into the weather
  const nose = box(3.4, 3.2, 5.0, M.hullBow);
  nose.position.set(12.6, 2.6, 0);
  nose.rotation.z = -0.22;
  ship.add(nose);

  // comms mast on the castle roof
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.11, 3.4, 6), M.mech);
  mast.position.set(9.0, 8.9, 1.2);
  ship.add(mast);
  const dish = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.1, 12), M.mech);
  dish.rotation.z = Math.PI / 3;
  dish.position.set(9.0, 10.1, 1.2);
  ship.add(dish);

  // whisker antennae reaching forward off the bow — the reference's
  // unmistakable signature against any sky
  for (const [dy, dz, len] of [[3.6, -1.4, 7], [4.1, 0.8, 9], [3.2, 1.9, 6]]) {
    const whisker = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.045, len, 5), M.mech);
    whisker.rotation.z = Math.PI / 2 - 0.06;
    whisker.position.set(13.6 + len / 2 - 1, dy, dz);
    ship.add(whisker);
  }

  // ── engine block: angled nacelles flared out on pylons — the
  // reference silhouette's strongest move. Each nacelle is a canted
  // box with a grilled aft face, riding an outrigger off the stern.
  P.bells = [];
  for (const side of [-1, 1]) {
    const pylon = box(2.6, 1.0, 2.8, M.mech);
    pylon.position.set(-8.6, 3.4, side * 4.4);
    ship.add(pylon);
    const nacelle = box(6.2, 3.4, 3.2, M.mech);
    nacelle.position.set(-10.2, 3.6, side * 6.2);
    nacelle.rotation.x = side * -0.16;         // flared outward
    nacelle.rotation.z = 0.10;                 // nose-down cant
    ship.add(nacelle);
    // aft grille: dark inset + glowing bell pair inside
    const grille = box(0.3, 2.8, 2.6, M.mech);
    grille.position.set(-13.2, 3.2, side * 6.2);
    ship.add(grille);
    for (const dy of [-0.6, 0.7]) {
      const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, 1.3, 10, 1, true), M.bell.clone());
      bell.rotation.z = Math.PI / 2;
      bell.position.set(-13.6, 3.2 + dy, side * 6.2);
      ship.add(bell);
      P.bells.push(bell);
    }
    const nacGreeb = greebles(M.mech, 8, { x: 4.5, y: 0.8, z: 2.4 }, 1.6);
    nacGreeb.position.set(-10.2, 3.6, side * 6.2);
    ship.add(nacGreeb);
  }
  // stern block between the outriggers
  const stern = box(3.6, 4.6, 5.4, M.mech);
  stern.position.set(-8.6, 2.9, 0);
  ship.add(stern);

  // ── landing gear: four splayed legs with oleo struts and pads ──
  for (const [lx, lz] of [[7.5, 3.2], [7.5, -3.2], [-7.5, 3.2], [-7.5, -3.2]]) {
    const leg = new THREE.Group();
    const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 2.6, 8), M.mech);
    upper.position.y = 1.6;
    upper.rotation.z = lx > 0 ? -0.35 : 0.35;
    upper.rotation.x = lz > 0 ? 0.3 : -0.3;
    leg.add(upper);
    const oleo = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.2, 8),
      new THREE.MeshLambertMaterial({ color: 0xb9bcc4 }));
    oleo.position.set(lx > 0 ? 0.45 : -0.45, 0.55, lz > 0 ? 0.38 : -0.38);
    leg.add(oleo);
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.9, 0.28, 10), M.mech);
    pad.position.set(lx > 0 ? 0.55 : -0.55, 0.05, lz > 0 ? 0.48 : -0.48);
    leg.add(pad);
    leg.position.set(lx, 0, lz);
    ship.add(leg);
  }

  // ── practicals ──
  P.beaconR = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), M.beaconR);
  P.beaconR.position.set(0.5, 5.0, 3.6);
  ship.add(P.beaconR);
  P.beaconG = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), M.beaconG);
  P.beaconG.position.set(0.5, 5.0, -3.6);
  ship.add(P.beaconG);
  P.strobe = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), M.strobe);
  P.strobe.position.set(9.0, 12.0, 1.2);
  ship.add(P.strobe);

  // floodlight: one real light, pooled on the pad after dark
  P.flood = new THREE.SpotLight(0xffe2b0, 0, 40, THREE.MathUtils.degToRad(48), 0.6, 1.1);
  P.flood.position.set(11.9, 1.4, 0);
  ship.add(P.flood);
  ship.add(P.flood.target);
  P.flood.target.position.set(17, -2, 0);

  // One cool skyfill from above for the decks; the flanks are kept
  // alive by the painted emissive floor in paintedMat (lights placed
  // inside a closed hull can only strike backfaces — learned the
  // hard way).
  const skyfill = new THREE.PointLight(0x93a2b6, 40, 60, 1.0);
  skyfill.position.set(0, 20, 0);
  ship.add(skyfill);
  P.skyfill = skyfill;

  // ── the egress ramp: hinged at the west-flank sill, swings down to
  // the ground when the traveler steps out. Gas vents ride its fall.
  P.ramp = new THREE.Group();
  const rampPanel = box(0.18, 4.2, 2.4, M.mech);
  rampPanel.position.y = -2.1;                 // hangs from the hinge
  P.ramp.add(rampPanel);
  P.ramp.position.set(3.6, 2.4, -3.55);        // west flank, mid-hull sill
  P.ramp.rotation.x = 0;                       // closed flush; opens toward -Z
  ship.add(P.ramp);

  // vent puffs: painted fog sprites, fired on egress
  const puffC = canvas(64, 64);
  {
    const g = puffC.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 4, 32, 32, 30);
    grad.addColorStop(0, 'rgba(235,225,210,0.55)');
    grad.addColorStop(1, 'rgba(235,225,210,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  }
  const puffTex = new THREE.CanvasTexture(puffC);
  P.puffs = [];
  for (let i = 0; i < 6; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, transparent: true, opacity: 0, depthWrite: false }));
    s.position.set(3.6 + (Math.random() - 0.5) * 1.4, 0.6, -4.4 - Math.random() * 1.2);
    s.scale.setScalar(0.8);
    ship.add(s);
    P.puffs.push(s);
  }

  P.glassWarm = M.glassWarm;
  return { ship, P };
}

// ── Egress: the ramp falls, the ship exhales — fast, every landfall ──
let egressT = -1;   // -1 idle; 0..1 playing

export function playEgress() {
  egressT = 0;
  if (parts) {
    for (const p of parts.puffs) {
      p.material.opacity = 0.85;
      p.scale.setScalar(0.7 + Math.random() * 0.5);
      p.userData.vx = (Math.random() - 0.5) * 1.6;
      p.userData.vz = -1.2 - Math.random() * 1.6;
      p.userData.vy = 0.5 + Math.random() * 0.8;
    }
  }
}

export function setLanderVisible(v) {
  if (group) group.visible = v;
}

// ── The modelled hull: solace-hauler.baked.glb ───────────────────────
// A proper sculpted body (authored in real meters: 238 m stem to stern,
// y-up, bow pointing −X, gear pads at y=0; the .baked variant is the
// authored model run through tools/ship-pipeline.sh — machined-edge
// bevel pass, baked AO + edge-wear roughness atlas, join (645→~15 draw
// calls), draco + webp (6.7→1.1 MB)). We load it async and swap it in
// over the procedural hull; the painted ship stays as the instant-on
// fallback so the pad is never empty while 1 MB travels. Practicals and
// collision re-seat themselves from the model's bbox.

const REAL_LEN = 238;      // authored length, meters
const TARGET_LEN = 52;     // game-scale hull — fills the graded apron

function upgradeToModel() {
  const draco = new DRACOLoader();
  draco.setDecoderPath('/draco/gltf/');
  new GLTFLoader().setDRACOLoader(draco).load('/models/solace-hauler.baked.glb', (gltf) => {
    if (!group || !parts) return;            // site torn down mid-flight
    const model = gltf.scene;
    // real meters → game hull; bow −X → our local +X (π about Y).
    // group already carries SCALE, so divide it out here.
    model.scale.setScalar(TARGET_LEN / REAL_LEN / SCALE);
    model.rotation.y = Math.PI;
    // Materials keep their baked PBR maps (AO + roughness) and get the
    // palette-law painted-emissive floor (the site has no ambient light;
    // shadow sides must stay art). Authored glow survives untouched.
    model.traverse((o) => {
      if (!o.isMesh) return;
      const convert = (m) => {
        const hasGlow = m.emissive && (m.emissive.r + m.emissive.g + m.emissive.b) > 0.05 &&
          (m.emissiveIntensity === undefined || m.emissiveIntensity > 0);
        if (m.map) { m.map.colorSpace = THREE.SRGBColorSpace; m.map.anisotropy = 4; }
        if (!hasGlow) {
          m.emissiveMap = m.map || null;
          m.emissive = m.map ? new THREE.Color(0xc0906c)
            : m.color.clone().lerp(new THREE.Color(0xc0906c), 0.3);
          m.emissiveIntensity = m.map ? 0.34 : 0.30;
        }
        return m;
      };
      o.material = Array.isArray(o.material) ? o.material.map(convert) : convert(o.material);
    });
    // Her true footprint, in group-local (unscaled) units
    model.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(model);

    // The procedural hull stands down; the practicals stay in service
    const keep = new Set([parts.flood, parts.flood.target, parts.skyfill,
      parts.beaconR, parts.beaconG, parts.strobe, ...parts.puffs]);
    for (const child of [...group.children]) {
      if (keep.has(child)) continue;
      group.remove(child);
      child.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          const list = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of list) { if (m.map) m.map.dispose(); m.dispose(); }
        }
      });
    }
    parts.dome = null;
    parts.ramp = null;
    parts.bells = [];
    parts.windows = [];
    group.add(model);

    // Re-seat the jewelry on the real body
    parts.strobe.position.set(bb.max.x * 0.55, bb.max.y + 0.15, (bb.min.z + bb.max.z) / 2);
    parts.beaconR.position.set(0, bb.max.y * 0.8, bb.max.z + 0.12);
    parts.beaconG.position.set(0, bb.max.y * 0.8, bb.min.z - 0.12);
    parts.flood.position.set(bb.max.x - 2, 1.6, 0);
    parts.flood.target.position.set(bb.max.x + 7, -2, 0);
    parts.skyfill.position.set(0, bb.max.y + 8, 0);
    parts.skyfill.distance = Math.max(60, bb.max.x * 3);
    for (const p of parts.puffs) {
      p.position.set((Math.random() - 0.5) * 4, 0.6, bb.min.z - 0.6 - Math.random());
    }

    // Collision follows the body: a narrow full-length core plus the
    // full-width aft span (nacelles/outriggers live astern).
    const hzFull = Math.max(Math.abs(bb.min.z), Math.abs(bb.max.z));
    COLL_BOXES = [
      { minX: bb.min.x, maxX: bb.max.x, hz: hzFull * 0.38 },
      { minX: bb.min.x, maxX: bb.min.x + (bb.max.x - bb.min.x) * 0.42, hz: hzFull },
    ];
  }, undefined, (err) => {
    console.warn('[SOLACE] hauler model failed to load; painted hull stands', err);
  });
}

// ── Lifecycle ────────────────────────────────────────────────────────

const SCALE = 1.4;   // she was too small at 34 m — ~48 m reads as a SHIP

export function initLander(parentGroup) {
  const { ship, P } = buildShip();
  group = ship;
  parts = P;
  landedAt = performance.now();
  group.scale.setScalar(SCALE);
  upgradeToModel();

  // Seat her on the graded apron: highest leg contact wins (the apron
  // makes them agree to within centimetres)
  const { x, z, yaw } = SHIP_POS;
  let ground = -Infinity;
  for (const [lx, lz] of [[7.5, 3.2], [7.5, -3.2], [-7.5, 3.2], [-7.5, -3.2]]) {
    const sx = lx * SCALE, sz = lz * SCALE;
    const wx = x + Math.cos(yaw) * sx - Math.sin(yaw) * sz;
    const wz = z - Math.sin(yaw) * sx - Math.cos(yaw) * sz;
    ground = Math.max(ground, heightAt(wx, wz));
  }
  group.position.set(x, ground + 0.05, z);
  group.rotation.y = yaw;
  parentGroup.add(group);
}

export function disposeLander() {
  if (group && group.parent) group.parent.remove(group);
  if (group) {
    group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const list = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of list) { if (m.map) m.map.dispose(); m.dispose(); }
      }
    });
  }
  group = null;
  parts = null;
}

/** Practicals live on their own clocks; the windows follow the sun. */
export function updateLander(dt, sunElevDeg) {
  if (!parts) return;
  const t = performance.now();
  const night = THREE.MathUtils.smoothstep(-sunElevDeg, -3, 2); // 0 day → 1 night

  // beacons: slow alternating breath, brighter in the dark
  const beat = Math.sin(t * 0.0016);
  parts.beaconR.material.emissiveIntensity = (beat > 0.4 ? 1.6 : 0.12) * (0.5 + night * 0.8);
  parts.beaconG.material.emissiveIntensity = (beat < -0.4 ? 1.6 : 0.12) * (0.5 + night * 0.8);

  // dorsal strobe: rare double-flash
  const cycle = (t % 3800) / 3800;
  parts.strobe.material.emissiveIntensity =
    (cycle < 0.02 || (cycle > 0.07 && cycle < 0.09)) ? 3.2 : 0;

  // windows: the hearth — warm after sundown
  parts.glassWarm.emissiveIntensity = 0.12 + night * 1.15;
  if (parts.dome) parts.dome.material.emissiveIntensity = 0.06 + night * 0.22;

  // floodlights pool on the pad after dark
  parts.flood.intensity = night * 160;

  // engine bells: ember after landing, cooling over ~4 minutes
  const ember = Math.max(0, 1 - (t - landedAt) / 240000);
  for (const bell of parts.bells) {
    bell.material.emissiveIntensity = ember * (0.5 + 0.2 * Math.sin(t * 0.003 + bell.position.z));
  }

  // the egress beat: ramp swings down over ~1.6 s, gas rolls out and
  // thins — the whole thing under three seconds, oft-repeated
  if (egressT >= 0) {
    egressT = Math.min(1, egressT + dt / 1.6);
    const e = egressT < 0.5 ? 2 * egressT * egressT : 1 - Math.pow(-2 * egressT + 2, 2) / 2;
    if (parts.ramp) parts.ramp.rotation.x = -e * 1.15;  // falls outward to the ground
    for (const p of parts.puffs) {
      if (p.material.opacity <= 0) continue;
      p.position.x += (p.userData.vx || 0) * dt;
      p.position.y += (p.userData.vy || 0) * dt;
      p.position.z += (p.userData.vz || 0) * dt;
      // grow gently and CAP — exponential growth compounded to a
      // thirty-meter white ball that ate the whole hull on camera
      p.scale.multiplyScalar(1 + dt * 0.55);
      if (p.scale.x > 3.5) p.scale.setScalar(3.5);
      p.material.opacity = Math.max(0, p.material.opacity - dt * 0.6);
    }
    if (egressT >= 1 && parts.puffs.every((p) => p.material.opacity <= 0)) egressT = -1;
  }
}

export function getLanderPos() { return SHIP_POS; }

// ── Collision: the hull is SOLID ─────────────────────────────────────
// Two axis-aligned boxes in the ship's own (scaled) frame — the main
// hull run and the wider nacelle span aft. A walker or rover inside
// either is pushed out along the axis of least penetration. Cheap,
// exact enough, and it works whether she's visible or not — but only
// when she's actually standing (not mid-descent).
// Defaults fit the procedural hull; the GLB upgrade rewrites them
// from the loaded model's real bounding box.
let COLL_BOXES = [
  { minX: -11.5, maxX: 15.2, hz: 4.4 },   // hull + castle + legs
  { minX: -14.2, maxX: -6.6, hz: 8.2 },   // nacelle outriggers
];

export function resolveShipCollision(px, pz, r = 0.6) {
  if (!group || !group.visible) return null;
  const { x, z, yaw } = SHIP_POS;
  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  const wx = px - x, wz = pz - z;
  // world → ship-local (invert rotation.y), then unscale
  let lx = (wx * cos - wz * sin) / SCALE;
  let lz = (wx * sin + wz * cos) / SCALE;
  const rl = r / SCALE;
  let moved = false;
  for (const b of COLL_BOXES) {
    if (lx < b.minX - rl || lx > b.maxX + rl || Math.abs(lz) > b.hz + rl) continue;
    // penetration on each axis — exit through the shallowest wall
    const pxMin = lx - (b.minX - rl);
    const pxMax = (b.maxX + rl) - lx;
    const pzPen = (b.hz + rl) - Math.abs(lz);
    const xPen = Math.min(pxMin, pxMax);
    if (pzPen <= xPen) {
      lz = (lz >= 0 ? 1 : -1) * (b.hz + rl);
    } else {
      lx = pxMin <= pxMax ? b.minX - rl : b.maxX + rl;
    }
    moved = true;
  }
  if (!moved) return null;
  // ship-local → world
  const sx = lx * SCALE, sz = lz * SCALE;
  return { x: x + sx * cos + sz * sin, z: z + (-sx * sin + sz * cos) };
}
