// constants.js — Shared scale constants
// AU = scene units per astronomical unit
// Compressed distances for playability — planets visible from each other
// Real size ratios preserved, orbital spacing compressed ~5x from reality
export const AU = 3000;

// Interstellar scale — for stellar-neighborhood landmarks (nebulae, stars)
export const INTERSTELLAR_SCALE = 500;

// Intergalactic scale — for galaxy-scale landmarks (galaxies, voids)
export const INTERGALACTIC_SCALE = 2000;

// Milky Way galactic center — offset from world origin so that the Sun
// (which sits at origin) lies inside an outer spiral arm, roughly 60% of
// the way out from the core, mirroring our real ~26 kly distance from
// Sagittarius A* in a galaxy with a ~50 kly disk radius.
// Kept as a plain array to avoid a THREE.js import in this low-level file.
export const GALACTIC_CENTER = [-400000, -50000, -250000];
