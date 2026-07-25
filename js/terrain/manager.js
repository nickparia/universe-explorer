// terrain/manager.js — Manages terrain quadtrees for all nearby planets
import * as THREE from 'three';
import { TerrainQuadtree } from './quadtree.js';
import { getPlanetConfig } from '../planetconfig.js';
import { getAltitude } from '../altitude.js';
import { setWorldPos } from '../engine.js';

const TERRAIN_ACTIVATE_DIST = 0.5; // altitudeNorm — activate terrain only when very close
const SPHERE_FADE_START = 0.15;   // altitudeNorm — start fading planet sphere
const SPHERE_FADE_END   = 0.05;   // altitudeNorm — fully hidden

let activeQuadtree = null;
let activeBody = null;
let hiddenMeshes = []; // references to hidden planet group children
let fadedMeshes = [];  // references to crossfading planet meshes

const terrainMaterial = new THREE.MeshLambertMaterial({
  vertexColors: true,
  emissive: 0x555555,  // strong self-illumination so terrain is always visible
  emissiveIntensity: 1.0,
});

/**
 * Update terrain system. Call every frame.
 * @param {THREE.Scene} scene
 * @param {THREE.Vector3} camWorldPos
 */
export function updateTerrain(scene, camWorldPos) {
  const alt = getAltitude();

  // Terrain system disabled — the 8K textured sphere looks better than
  // procedural chunks at all distances. Terrain chunks create visible grid
  // lines, seams, and coverage gaps that degrade the landing experience.
  // TODO: re-enable once terrain quality is improved (proper texture projection,
  // seamless face stitching, normal-map detail).
  if (false && alt.altitudeNorm < TERRAIN_ACTIVATE_DIST && alt.body) {
    const config = getPlanetConfig(alt.nearestBody);
    if (!config || !config.terrain || config.terrain.type === 'gas' || config.terrain.type === 'none') {
      if (activeQuadtree) {
        activeQuadtree.dispose();
        activeQuadtree = null;
        activeBody = null;
        showPlanetMesh();
      }
      return;
    }

    // Activate terrain for this body if not already
    if (activeBody !== alt.nearestBody) {
      if (activeQuadtree) {
        activeQuadtree.dispose();
        showPlanetMesh();
      }

      // Set planet's color palette on terrain config for chunk vertex coloring
      const palette = getTerrainPalette(alt.nearestBody);
      config.terrain._baseColor = palette.base;
      config.terrain._lowColor  = palette.low;
      config.terrain._highColor = palette.high;

      // Use world position for terrain placement
      const worldPos = alt.body.g.userData._worldPos || alt.body.g.position;

      activeQuadtree = new TerrainQuadtree(
        scene,
        alt.bodyRadius,
        worldPos.clone(),
        config.terrain,
        terrainMaterial
      );
      // Tag terrain group for camera-relative rendering immediately
      setWorldPos(activeQuadtree.group, worldPos);
      activeBody = alt.nearestBody;
      console.log(`[terrain] Activated terrain for ${alt.nearestBody}`);
    }

    // Update terrain
    if (activeQuadtree) {
      const worldPos = alt.body.g.userData._worldPos || alt.body.g.position;
      activeQuadtree.planetWorldPos.copy(worldPos);
      // Tag group with planet's world position for camera-relative rendering
      setWorldPos(activeQuadtree.group, worldPos);
      activeQuadtree.update(camWorldPos);
    }

    // Never hide the planet sphere — it provides base coverage.
    // Terrain chunks render on top for detail.
    showPlanetMesh();
  } else {
    // Too far — deactivate
    if (activeQuadtree) {
      activeQuadtree.dispose();
      activeQuadtree = null;
      activeBody = null;
      showPlanetMesh();
      console.log('[terrain] Deactivated terrain (too far)');
    }
  }
}

/**
 * Hide ALL meshes in the planet's group so terrain chunks are visible.
 */
function hidePlanetMesh(body) {
  if (body.g && body.g.children.length > 0) {
    for (let i = 0; i < body.g.children.length; i++) {
      const child = body.g.children[i];
      if (child.visible || fadedMeshes.indexOf(child) !== -1) {
        child.visible = false;
        if (hiddenMeshes.indexOf(child) === -1) hiddenMeshes.push(child);
      }
    }
  }
  fadedMeshes.length = 0;
}

/**
 * Fade planet meshes to a given opacity for crossfade transition.
 */
function fadePlanetMesh(body, opacity) {
  if (!body.g) return;
  for (let i = 0; i < body.g.children.length; i++) {
    const child = body.g.children[i];
    if (!child.material) continue;
    child.visible = true;
    // Make material transparent for crossfade
    if (!child.material._origTransparent && child.material._origTransparent !== false) {
      child.material._origTransparent = child.material.transparent;
      child.material._origOpacity = child.material.opacity;
      child.material._origDepthWrite = child.material.depthWrite;
    }
    child.material.transparent = true;
    child.material.opacity = Math.max(0, Math.min(1, opacity));
    child.material.depthWrite = opacity > 0.5;
    if (fadedMeshes.indexOf(child) === -1) fadedMeshes.push(child);
    // Remove from hidden if it was there
    const idx = hiddenMeshes.indexOf(child);
    if (idx !== -1) hiddenMeshes.splice(idx, 1);
  }
}

/**
 * Show all previously hidden/faded planet meshes and restore materials.
 */
function showPlanetMesh() {
  for (let i = 0; i < hiddenMeshes.length; i++) {
    hiddenMeshes[i].visible = true;
  }
  hiddenMeshes.length = 0;
  // Restore faded materials
  for (let i = 0; i < fadedMeshes.length; i++) {
    const child = fadedMeshes[i];
    if (child.material && child.material._origTransparent !== undefined) {
      child.material.transparent = child.material._origTransparent;
      child.material.opacity = child.material._origOpacity;
      child.material.depthWrite = child.material._origDepthWrite;
      delete child.material._origTransparent;
      delete child.material._origOpacity;
      delete child.material._origDepthWrite;
    }
  }
  fadedMeshes.length = 0;
}

/**
 * Get terrain color palette per planet (low, base, high as [r,g,b] 0-1).
 */
function getTerrainPalette(name) {
  const palettes = {
    MERCURY: { low: [0.35, 0.33, 0.30], base: [0.53, 0.50, 0.47], high: [0.70, 0.67, 0.62] },
    VENUS:   { low: [0.45, 0.32, 0.15], base: [0.55, 0.40, 0.20], high: [0.70, 0.55, 0.30] },
    EARTH:   { low: [0.20, 0.35, 0.55], base: [0.35, 0.55, 0.30], high: [0.70, 0.65, 0.50] },
    MOON:    { low: [0.40, 0.40, 0.38], base: [0.55, 0.54, 0.50], high: [0.72, 0.70, 0.65] },
    MARS:    { low: [0.55, 0.28, 0.15], base: [0.72, 0.35, 0.18], high: [0.85, 0.55, 0.35] },
    PLUTO:   { low: [0.55, 0.50, 0.45], base: [0.70, 0.65, 0.58], high: [0.85, 0.82, 0.78] },
    CERES:   { low: [0.35, 0.35, 0.35], base: [0.47, 0.47, 0.47], high: [0.62, 0.62, 0.62] },
    ERIS:    { low: [0.55, 0.60, 0.65], base: [0.68, 0.72, 0.78], high: [0.82, 0.85, 0.90] },
  };
  return palettes[name] || { low: [0.3, 0.3, 0.3], base: [0.5, 0.5, 0.5], high: [0.7, 0.7, 0.7] };
}

/**
 * Check if terrain is currently active.
 */
export function isTerrainActive() {
  return activeQuadtree !== null;
}

/**
 * Get the active planet name (for HUD).
 */
export function getTerrainPlanet() {
  return activeBody;
}
