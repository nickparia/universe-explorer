# Clay turntable for the hull in progress — the fast judging loop.
#
# Workbench with cavity on, studio light, no materials: exactly the view
# you want while the shape is still being cut, because it shows form and
# nothing else. The bench (/ship-viewer.html) is still the verdict for
# anything involving materials or the pad; this is for "is she the right
# animal yet".
#
#   blender --background --python tools/clay-shot.py -- in.glb outdir [views]
#
# views: comma-separated from side,top,front,quarter,low  (default all)

import bpy
import math
import os
import sys
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
src, outdir = argv[0], argv[1]
views = (argv[2].split(",") if len(argv) > 2
         else ["side", "top", "quarter", "low", "front"])

RES = (1600, 900)

bpy.ops.wm.read_factory_settings(use_empty=True)
if src.endswith(".blend"):
    bpy.ops.wm.open_mainfile(filepath=os.path.abspath(src))
else:
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(src))

meshes = [o for o in bpy.data.objects if o.type == "MESH"]
mn = Vector((1e9, 1e9, 1e9))
mx = Vector((-1e9, -1e9, -1e9))
for o in meshes:
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        mn = Vector((min(mn[i], w[i]) for i in range(3)))
        mx = Vector((max(mx[i], w[i]) for i in range(3)))
ctr = (mn + mx) / 2
size = max(mx[i] - mn[i] for i in range(3))
print(f"clay-shot: bbox {[round(v,1) for v in mn]} .. {[round(v,1) for v in mx]}")
print(f"clay-shot: size {[round(mx[i]-mn[i],1) for i in range(3)]}")

scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
scene.render.resolution_x, scene.render.resolution_y = RES
scene.render.film_transparent = False
sh = scene.display.shading
sh.light = "STUDIO"
sh.studio_light = "Default"
sh.color_type = "SINGLE"
sh.single_color = (0.60, 0.60, 0.62)
sh.show_cavity = True
sh.cavity_type = "BOTH"
sh.curvature_ridge_factor = 1.6
sh.curvature_valley_factor = 1.4
sh.show_shadows = True
scene.display.render_aa = "16"
try:
    scene.world = bpy.data.worlds.new("w")
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs[0].default_value = (0.05, 0.05, 0.06, 1)
except Exception:
    pass

cam_data = bpy.data.cameras.new("cam")
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam

# Directions are chosen the way a modeller checks a hull: the profile
# first (side), then the plan (top), then the three-quarter that decides
# whether the silhouette actually reads, then a low angle at eyeline —
# which on a 256 m ship standing on her legs is the only view a traveler
# will ever actually have of her.
DIRS = {
    "side":    (0.0, -1.0, 0.05),
    "top":     (0.0, -0.12, 1.0),
    "front":   (-1.0, -0.12, 0.10),
    "quarter": (-0.85, -0.95, 0.42),
    "low":     (-0.75, -1.0, 0.055),
}
FIT = {"side": 1.10, "top": 1.10, "front": 2.6, "quarter": 1.25, "low": 1.30}

os.makedirs(outdir, exist_ok=True)
for name in views:
    d = Vector(DIRS[name]).normalized()
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = size * FIT[name]
    target = ctr.copy()
    if name == "low":
        target.z = mn.z + (mx.z - mn.z) * 0.34
    cam.location = target + d * size * 2.5
    cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = os.path.join(outdir, f"{name}.png")
    bpy.ops.render.render(write_still=True)
    print(f"clay-shot: {scene.render.filepath}")
