#!/usr/bin/env bash
# Stage 8 (docs/webgl-asset-pipeline.md) for the satellite/probe fleet.
# Originals live in models/ (source of truth); optimized copies go to
# public/models/<name>.opt.glb — draco geometry (bodies.js already wires
# DRACOLoader) + webp textures. No bevel pass: these are sculpted NASA
# models, not blockouts. Prod needs each .opt.glb uploaded to R2
# (solace-media/models/) before deploy.
set -euo pipefail
cd "$(dirname "$0")/.."

for name in voyager newhorizons jwst hubble iss; do
  src="models/${name}.glb"
  [ -f "$src" ] || { echo "missing $src — copy the original here first"; exit 1; }
  npx --yes @gltf-transform/cli optimize "$src" "public/models/${name}.opt.glb" \
    --compress draco --texture-compress webp --simplify false
done

ls -la public/models/*.opt.glb
