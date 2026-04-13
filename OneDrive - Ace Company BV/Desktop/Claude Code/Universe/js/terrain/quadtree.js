// terrain/quadtree.js — Quadtree LOD manager for cube-sphere terrain
import * as THREE from 'three';
import { buildChunkGeometry } from './chunk.js';
import { getConfig } from '../perf.js';

/**
 * A quadtree node representing one terrain chunk on one face of the cube-sphere.
 */
class QuadNode {
  constructor(face, uMin, vMin, uMax, vMax, depth) {
    this.face = face;
    this.uMin = uMin;
    this.vMin = vMin;
    this.uMax = uMax;
    this.vMax = vMax;
    this.depth = depth;
    this.children = null;  // null = leaf, array of 4 = split
    this.mesh = null;
    this.center = new THREE.Vector3();
    this.size = 0; // approximate world-space size of this chunk
  }
}

/**
 * Manages the full quadtree for one planet.
 */
export class TerrainQuadtree {
  /**
   * @param {THREE.Scene} scene
   * @param {number} planetRadius — scene units
   * @param {THREE.Vector3} planetWorldPos — planet center in world space
   * @param {Object} terrainConfig — from planetconfig.js
   * @param {THREE.Material} material — shared terrain material
   */
  constructor(scene, planetRadius, planetWorldPos, terrainConfig, material) {
    this.scene = scene;
    this.planetRadius = planetRadius;
    this.planetWorldPos = planetWorldPos;
    this.terrainConfig = terrainConfig;
    this.material = material;
    this.group = new THREE.Group();
    this.scene.add(this.group);

    // Root nodes: 6 faces
    this.roots = [];
    for (let face = 0; face < 6; face++) {
      this.roots.push(new QuadNode(face, 0, 0, 1, 1, 0));
    }

    // Chunk recycling pool
    this.meshPool = [];
    this.activeChunks = 0;
  }

  /**
   * Update the quadtree: split/merge nodes based on camera distance.
   * @param {THREE.Vector3} camWorldPos — camera world position
   */
  update(camWorldPos) {
    const config = getConfig();
    const maxDepth = config.terrainMaxDepth;
    const gridSize = config.chunkGrid;
    const octaves = config.noiseOctaves;

    // Camera position relative to planet center
    const camLocal = camWorldPos.clone().sub(this.planetWorldPos);

    let chunksGenerated = 0;
    const maxChunksPerFrame = config.chunksPerFrame;

    for (const root of this.roots) {
      chunksGenerated += this._updateNode(
        root, camLocal, maxDepth, gridSize, octaves, maxChunksPerFrame - chunksGenerated
      );
    }
  }

  /**
   * Recursively update a quadtree node.
   * Returns number of chunks generated this frame.
   */
  _updateNode(node, camLocal, maxDepth, gridSize, octaves, budget) {
    if (budget <= 0) return 0;

    // Compute node center on sphere surface
    const uMid = (node.uMin + node.uMax) / 2;
    const vMid = (node.vMin + node.vMax) / 2;

    // Approximate center by cube-to-sphere mapping
    const cx = uMid * 2 - 1, cy = vMid * 2 - 1;
    // Simplified — just use the face center direction scaled by radius
    this._cubeToSphere(node.face, uMid, vMid, node.center);
    node.center.multiplyScalar(this.planetRadius);

    // Approximate chunk size in world space
    node.size = this.planetRadius * Math.PI / (3 * Math.pow(2, node.depth));

    // Distance from camera to chunk center
    const dist = camLocal.distanceTo(node.center);

    // Screen-space error metric: split if chunk appears large on screen
    const screenSize = node.size / Math.max(dist, 0.001);
    const splitThreshold = 1.2; // tunable

    const shouldSplit = screenSize > splitThreshold && node.depth < maxDepth;

    if (shouldSplit) {
      // Split into 4 children
      if (!node.children) {
        node.children = this._createChildren(node);
        // Remove this node's mesh (parent chunk)
        this._removeMesh(node);
      }
      let generated = 0;
      for (const child of node.children) {
        generated += this._updateNode(child, camLocal, maxDepth, gridSize, octaves, budget - generated);
      }
      return generated;
    } else {
      // Merge: remove children, show this node
      if (node.children) {
        this._removeChildren(node);
        node.children = null;
      }

      // Ensure this node has a mesh
      if (!node.mesh) {
        const { geometry, center } = buildChunkGeometry(
          node.face, node.uMin, node.vMin, node.uMax, node.vMax,
          gridSize, this.planetRadius, this.terrainConfig, octaves
        );
        node.mesh = this._getMesh(geometry);
        node.mesh.position.set(0, 0, 0); // chunks are relative to group, group is at planet pos
        this.group.add(node.mesh);
        return 1;
      }

      return 0;
    }
  }

  _createChildren(parent) {
    const uMid = (parent.uMin + parent.uMax) / 2;
    const vMid = (parent.vMin + parent.vMax) / 2;
    const d = parent.depth + 1;
    return [
      new QuadNode(parent.face, parent.uMin, parent.vMin, uMid, vMid, d),
      new QuadNode(parent.face, uMid, parent.vMin, parent.uMax, vMid, d),
      new QuadNode(parent.face, parent.uMin, vMid, uMid, parent.vMax, d),
      new QuadNode(parent.face, uMid, vMid, parent.uMax, parent.vMax, d),
    ];
  }

  _removeChildren(node) {
    if (!node.children) return;
    for (const child of node.children) {
      this._removeChildren(child);
      this._removeMesh(child);
      child.children = null;
    }
  }

  _removeMesh(node) {
    if (node.mesh) {
      this.group.remove(node.mesh);
      // Recycle mesh and geometry
      node.mesh.geometry.dispose();
      this.meshPool.push(node.mesh);
      node.mesh = null;
    }
  }

  _getMesh(geometry) {
    if (this.meshPool.length > 0) {
      const mesh = this.meshPool.pop();
      mesh.geometry = geometry;
      return mesh;
    }
    return new THREE.Mesh(geometry, this.material);
  }

  _cubeToSphere(face, u, v, out) {
    const x2 = u * 2 - 1, y2 = v * 2 - 1;
    let x, y, z;
    switch (face) {
      case 0: x =  1; y = y2; z = -x2; break;
      case 1: x = -1; y = y2; z =  x2; break;
      case 2: x = x2; y =  1; z = -y2; break;
      case 3: x = x2; y = -1; z =  y2; break;
      case 4: x = x2; y = y2; z =  1;  break;
      case 5: x =-x2; y = y2; z = -1;  break;
    }
    const len = Math.sqrt(x * x + y * y + z * z);
    out.set(x / len, y / len, z / len);
  }

  /**
   * Dispose all meshes and remove from scene.
   */
  dispose() {
    for (const root of this.roots) {
      this._removeChildren(root);
      this._removeMesh(root);
    }
    this.scene.remove(this.group);
    this.meshPool.length = 0;
  }
}
