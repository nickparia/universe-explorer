// transit.js — (retired) route furniture.
//
// This module used to seed synthetic sights along the route while the
// drive was engaged: cirrus wisps, tinted nebula banks, squalls, a
// streaked glint. All of it is gone, deliberately. Three rounds of
// density tuning taught the same lesson: camera-anchored procedural
// sprites read as cheap artifacts at ANY density, because they are the
// only things aboard that aren't real. The strategy now is subtraction
// — the sensation of travel comes from true things only: star-volume
// parallax, real nebulae growing on approach, their outskirt shrouds
// sweeping past at flyby. The void is allowed to be void; that IS the
// soothing register. If weather ever returns it will be volumetric and
// anchored in the world, not sprites spawned around the camera.
//
// The exports remain so main.js needs no changes; they do nothing.

export function initTransit() {}

const _dbg = { active: false, retired: true };
export function getTransitDebug() { return _dbg; }

export function updateTransit() {}
