# Stage 2 of docs/webgl-asset-pipeline.md, headless: import a GLB blockout,
# apply the Bevel + Weighted Normal stack across every mesh, re-export.
# Geometry-only pass — silhouette, materials and hierarchy stay untouched.
#
#   blender --background --python tools/bevel-pass.py -- in.glb out.glb
#
# Bevel width scales with each object's smallest dimension (a 20 m tank
# gets a wider machined edge than a 0.5 m greeble), clamped to read as
# manufactured rather than rounded-off at bootfall camera distance.

import bpy
import bmesh
import math
import sys

argv = sys.argv[sys.argv.index("--") + 1:]
src, dst = argv[0], argv[1]

WIDTH_FACTOR = 0.06   # of the object's smallest bbox dimension
WIDTH_MIN = 0.02      # meters — visible machined edge floor
WIDTH_MAX = 0.12      # meters — anything wider reads as rounded, not machined
SEGMENTS = 2          # doc: 2 for background/mid assets, 3 for hero
ANGLE_LIMIT = math.radians(40)
SMOOTH_ANGLE = math.radians(30)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)

meshes = [o for o in bpy.data.objects if o.type == "MESH"]

# Doc stage 0: apply scale, or bevel widths go inconsistent per object.
bpy.ops.object.select_all(action="DESELECT")
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.make_single_user(object=True, obdata=True)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

# THREE.GLTFExporter ships split normals as duplicated vertices, so every
# face arrives as its own island and Bevel's angle limit sees only
# boundary edges (angle undefined) and skips them all. Weld first.
for o in meshes:
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bm.to_mesh(o.data)
    bm.free()

# Shade auto smooth first so it sits before the bevel in the stack
# (Blender 4.1+: this adds a Smooth by Angle modifier, not a mesh flag).
bpy.ops.object.shade_auto_smooth(angle=SMOOTH_ANGLE)

for o in meshes:
    dims = [d for d in o.dimensions if d > 1e-4]
    if not dims:
        continue
    width = max(WIDTH_MIN, min(WIDTH_MAX, WIDTH_FACTOR * min(dims)))

    b = o.modifiers.new("Bevel", "BEVEL")
    b.offset_type = "OFFSET"
    b.width = width
    b.segments = SEGMENTS
    b.limit_method = "ANGLE"
    b.angle_limit = ANGLE_LIMIT
    b.miter_outer = "MITER_ARC"
    b.use_clamp_overlap = True

    wn = o.modifiers.new("WeightedNormal", "WEIGHTED_NORMAL")
    wn.keep_sharp = True

bpy.ops.export_scene.gltf(
    filepath=dst,
    export_format="GLB",
    export_apply=True,      # bake the modifier stack into the mesh
    export_yup=True,
)

print(f"bevel-pass: {src} -> {dst} ({len(meshes)} meshes)")
