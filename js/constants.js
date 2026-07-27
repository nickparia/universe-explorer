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
// The galactic center IS Sagittarius A* — one coherent geometry. This is
// the catalog's sgr-a* placement (dist 8000 AU, angle 4.0, phi -0.2)
// expanded to cartesian. If the catalog entry moves, move this with it.
export const GALACTIC_CENTER = [-15375000, -4768000, -17803000];
// In-world galaxy radius: Sol sits ~60% of the way out, like reality,
// and every interstellar landmark falls inside the disc.
export const MILKY_WAY_RADIUS = 40000000;
