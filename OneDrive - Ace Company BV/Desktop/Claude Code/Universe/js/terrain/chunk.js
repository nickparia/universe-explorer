// terrain/chunk.js — Generate a single terrain chunk mesh for a cube-sphere face
import * as THREE from 'three';
import { getTerrainHeight } from './noise.js';

const _normal = new THREE.Vector3();

/**
 * Map a cube face coordinate to a unit sphere point.
 * @param {number} face — 0-5 (PX, NX, PY, NY, PZ, NZ)
 * @param {number} u — 0-1 within face
 * @param {number} v — 0-1 within face
 * @returns {THREE.Vector3}
 */
export function cubeToSphere(face, u, v, out) {
  // Map u,v from [0,1] to [-1,1]
  const x2 = u * 2 - 1;
  const y2 = v * 2 - 1;

  let x, y, z;
  switch (face) {
    case 0: x =  1; y = y2; z = -x2; break; // +X
    case 1: x = -1; y = y2; z =  x2; break; // -X
    case 2: x = x2; y =  1; z = -y2; break; // +Y
    case 3: x = x2; y = -1; z =  y2; break; // -Y
    case 4: x = x2; y = y2; z =  1;  break; // +Z
    case 5: x =-x2; y = y2; z = -1;  break; // -Z
  }

  // Normalize to sphere
  const len = Math.sqrt(x * x + y * y + z * z);
  out.set(x / len, y / len, z / len);
  return out;
}

/**
 * Build a terrain chunk mesh.
 *
 * @param {number} face — cube face 0-5
 * @param {number} uMin — start U on face (0-1)
 * @param {number} vMin — start V on face (0-1)
 * @param {number} uMax — end U on face (0-1)
 * @param {number} vMax — end V on face (0-1)
 * @param {number} gridSize — vertices per side (e.g. 33)
 * @param {number} planetRadius — in scene units
 * @param {Object} terrainConfig — from planetconfig.js
 * @param {number} octaves — noise octaves (perf tier)
 * @returns {{ geometry: THREE.BufferGeometry, center: THREE.Vector3 }}
 */
export function buildChunkGeometry(face, uMin, vMin, uMax, vMax, gridSize, planetRadius, terrainConfig, octaves) {
  const vertCount = gridSize * gridSize;
  const positions = new Float32Array(vertCount * 3);
  const normals   = new Float32Array(vertCount * 3);
  const colors    = new Float32Array(vertCount * 3);
  const uvs       = new Float32Array(vertCount * 2);

  const sphere = new THREE.Vector3();
  const center = new THREE.Vector3();
  const heights = new Float32Array(vertCount);

  const uStep = (uMax - uMin) / (gridSize - 1);
  const vStep = (vMax - vMin) / (gridSize - 1);

  let minH = Infinity, maxH = -Infinity;

  // Generate vertex positions
  for (let iy = 0; iy < gridSize; iy++) {
    for (let ix = 0; ix < gridSize; ix++) {
      const idx = iy * gridSize + ix;
      const u = uMin + ix * uStep;
      const v = vMin + iy * vStep;

      cubeToSphere(face, u, v, sphere);

      // Terrain height
      const h = getTerrainHeight(sphere.x, sphere.y, sphere.z, terrainConfig, octaves);
      heights[idx] = h;
      if (h < minH) minH = h;
      if (h > maxH) maxH = h;
      const r = planetRadius + h * planetRadius * 0.02; // 2% of radius — subtle relief, sphere is the visual surface

      positions[idx * 3]     = sphere.x * r;
      positions[idx * 3 + 1] = sphere.y * r;
      positions[idx * 3 + 2] = sphere.z * r;

      uvs[idx * 2]     = ix / (gridSize - 1);
      uvs[idx * 2 + 1] = iy / (gridSize - 1);

      center.x += positions[idx * 3];
      center.y += positions[idx * 3 + 1];
      center.z += positions[idx * 3 + 2];
    }
  }

  // Generate vertex colors based on height
  const baseColor = terrainConfig._baseColor || [0.5, 0.5, 0.5];
  const lowColor  = terrainConfig._lowColor  || [0.3, 0.3, 0.3];
  const highColor = terrainConfig._highColor || [0.8, 0.8, 0.8];
  const hRange = maxH - minH || 1;

  for (let i = 0; i < vertCount; i++) {
    const t = (heights[i] - minH) / hRange;
    // Blend between low, base, and high
    let r, g, b;
    if (t < 0.5) {
      const s = t * 2;
      r = lowColor[0] + (baseColor[0] - lowColor[0]) * s;
      g = lowColor[1] + (baseColor[1] - lowColor[1]) * s;
      b = lowColor[2] + (baseColor[2] - lowColor[2]) * s;
    } else {
      const s = (t - 0.5) * 2;
      r = baseColor[0] + (highColor[0] - baseColor[0]) * s;
      g = baseColor[1] + (highColor[1] - baseColor[1]) * s;
      b = baseColor[2] + (highColor[2] - baseColor[2]) * s;
    }
    // Add slight noise variation
    const noise = (heights[i] * 73.13 % 1) * 0.06 - 0.03;
    colors[i * 3]     = Math.max(0, Math.min(1, r + noise));
    colors[i * 3 + 1] = Math.max(0, Math.min(1, g + noise));
    colors[i * 3 + 2] = Math.max(0, Math.min(1, b + noise));
  }

  center.divideScalar(vertCount);

  // Generate triangle indices
  const quads = (gridSize - 1) * (gridSize - 1);
  const indices = new Uint32Array(quads * 6);
  let triIdx = 0;
  for (let iy = 0; iy < gridSize - 1; iy++) {
    for (let ix = 0; ix < gridSize - 1; ix++) {
      const a = iy * gridSize + ix;
      const b = a + 1;
      const c = a + gridSize;
      const d = c + 1;
      indices[triIdx++] = a; indices[triIdx++] = c; indices[triIdx++] = b;
      indices[triIdx++] = b; indices[triIdx++] = c; indices[triIdx++] = d;
    }
  }

  // Compute normals from cross products
  // Initialize to zero
  for (let i = 0; i < normals.length; i++) normals[i] = 0;

  const pA = new THREE.Vector3(), pB = new THREE.Vector3(), pC = new THREE.Vector3();
  const cb = new THREE.Vector3(), ab = new THREE.Vector3();

  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i], ib = indices[i + 1], ic = indices[i + 2];
    pA.fromArray(positions, ia * 3);
    pB.fromArray(positions, ib * 3);
    pC.fromArray(positions, ic * 3);

    cb.subVectors(pC, pB);
    ab.subVectors(pA, pB);
    cb.cross(ab);

    normals[ia * 3]     += cb.x; normals[ia * 3 + 1] += cb.y; normals[ia * 3 + 2] += cb.z;
    normals[ib * 3]     += cb.x; normals[ib * 3 + 1] += cb.y; normals[ib * 3 + 2] += cb.z;
    normals[ic * 3]     += cb.x; normals[ic * 3 + 1] += cb.y; normals[ic * 3 + 2] += cb.z;
  }

  // Normalize
  for (let i = 0; i < vertCount; i++) {
    _normal.set(normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]).normalize();
    normals[i * 3] = _normal.x;
    normals[i * 3 + 1] = _normal.y;
    normals[i * 3 + 2] = _normal.z;
  }

  // Skirt geometry — extend edges downward to hide seams
  const skirtVerts = (gridSize * 4 - 4); // perimeter vertices
  const skirtPositions = new Float32Array((vertCount + skirtVerts) * 3);
  const skirtNormals   = new Float32Array((vertCount + skirtVerts) * 3);
  const skirtColors    = new Float32Array((vertCount + skirtVerts) * 3);
  const skirtUvs       = new Float32Array((vertCount + skirtVerts) * 2);

  // Copy existing data
  skirtPositions.set(positions);
  skirtNormals.set(normals);
  skirtColors.set(colors);
  skirtUvs.set(uvs);

  const skirtDrop = planetRadius * 0.005; // drop skirt below terrain to hide LOD seams
  let skirtIdx = vertCount;
  const skirtIndices = [];

  // Helper: add skirt vertex for edge vertex at idx
  function addSkirtVert(idx) {
    const sx = positions[idx * 3];
    const sy = positions[idx * 3 + 1];
    const sz = positions[idx * 3 + 2];
    // Move toward planet center
    _normal.set(sx, sy, sz).normalize();
    skirtPositions[skirtIdx * 3]     = sx - _normal.x * skirtDrop;
    skirtPositions[skirtIdx * 3 + 1] = sy - _normal.y * skirtDrop;
    skirtPositions[skirtIdx * 3 + 2] = sz - _normal.z * skirtDrop;
    skirtNormals[skirtIdx * 3]     = normals[idx * 3];
    skirtNormals[skirtIdx * 3 + 1] = normals[idx * 3 + 1];
    skirtNormals[skirtIdx * 3 + 2] = normals[idx * 3 + 2];
    skirtColors[skirtIdx * 3]     = colors[idx * 3];
    skirtColors[skirtIdx * 3 + 1] = colors[idx * 3 + 1];
    skirtColors[skirtIdx * 3 + 2] = colors[idx * 3 + 2];
    skirtUvs[skirtIdx * 2]     = uvs[idx * 2];
    skirtUvs[skirtIdx * 2 + 1] = uvs[idx * 2 + 1];
    return skirtIdx++;
  }

  // For simplicity, rebuild skirt with proper triangle winding
  skirtIdx = vertCount;
  const edgeIndices = [];

  // Collect edge vertex indices (in order)
  const edges = [
    // Bottom: iy=0, ix 0..gridSize-1
    Array.from({length: gridSize}, (_, i) => i),
    // Right: ix=gridSize-1, iy 0..gridSize-1
    Array.from({length: gridSize}, (_, i) => i * gridSize + (gridSize - 1)),
    // Top: iy=gridSize-1, ix gridSize-1..0
    Array.from({length: gridSize}, (_, i) => (gridSize - 1) * gridSize + (gridSize - 1 - i)),
    // Left: ix=0, iy gridSize-1..0
    Array.from({length: gridSize}, (_, i) => (gridSize - 1 - i) * gridSize),
  ];

  for (const edge of edges) {
    for (let i = 0; i < edge.length - 1; i++) {
      const a = edge[i], b = edge[i + 1];
      const sa = addSkirtVert(a);
      const sb = addSkirtVert(b);
      skirtIndices.push(a, sa, b);
      skirtIndices.push(b, sa, sb);
    }
  }

  // Combine indices
  const allIndices = new Uint32Array(indices.length + skirtIndices.length);
  allIndices.set(indices);
  allIndices.set(skirtIndices, indices.length);

  // Build geometry
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(skirtPositions.slice(0, skirtIdx * 3), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(skirtNormals.slice(0, skirtIdx * 3), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(skirtColors.slice(0, skirtIdx * 3), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(skirtUvs.slice(0, skirtIdx * 2), 2));
  geo.setIndex(new THREE.BufferAttribute(allIndices, 1));

  return { geometry: geo, center };
}
