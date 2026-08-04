#!/usr/bin/env bash
# Asset pipeline for ship GLBs (docs/webgl-asset-pipeline.md, stages 2 + 8).
# Usage: tools/ship-pipeline.sh models/solace-hauler.glb
#
# in.glb → [blender bevel pass] → [gltf-transform join/weld] → public/models/<name>.bevel.glb
# Judge the result in /ship-viewer.html (npx vite) before wiring it into the game.
set -euo pipefail
cd "$(dirname "$0")/.."

SRC="$1"
BASE="$(basename "${SRC%.glb}")"
TMP="$(mktemp -d)/baked.glb"
OUT="public/models/${BASE}.baked.glb"

BLENDER="${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"

"$BLENDER" --background --python tools/bake-pass.py -- "$SRC" "$TMP"

# webp: GLTFLoader reads EXT_texture_webp natively, no decoder wiring needed
# draco: loaders must wire DRACOLoader ('/draco/gltf/'), as bodies.js does
# --join false: joining is done (deliberately, per-group) in Blender —
# gltf-transform must not merge the gear node back into the hull
npx --yes @gltf-transform/cli optimize "$TMP" "$OUT" \
  --compress draco --texture-compress webp --simplify false --join false

echo "→ $OUT"
ls -la "$OUT"
