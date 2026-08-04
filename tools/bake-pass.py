# Stages 2+4+6 of docs/webgl-asset-pipeline.md, headless:
# import a GLB blockout, weld + bevel (stage 2), join everything into one
# multi-material mesh, unwrap a second UV set, then Cycles-bake an ORM
# atlas (stage 6): AO in R, procedural roughness in G (edge wear via
# Pointiness — Cycles-only, which is fine because baking runs in Cycles;
# grime via AO node; large-scale noise variation), B=1 so each material's
# metallicFactor still rules. Base colour and emissives stay untouched on
# UV0; the ORM atlas rides UV1.
#
#   blender --background --python tools/bake-pass.py -- in.glb out.glb

import bpy
import bmesh
import math
import os
import sys
import tempfile

import numpy as np

argv = sys.argv[sys.argv.index("--") + 1:]
src, dst = argv[0], argv[1]

ATLAS = 2048
SMOOTH_ANGLE = math.radians(30)
WIDTH_FACTOR, WIDTH_MIN, WIDTH_MAX = 0.06, 0.02, 0.12
SEGMENTS = 2
ANGLE_LIMIT = math.radians(40)

# Per-material resting roughness; wear/grime/noise modulate around it.
BASE_ROUGH = {
    "hull": 0.55, "hull_light": 0.55, "hull_dark": 0.62, "grime": 0.82,
    "window_glow": 0.15, "metal_dark": 0.60, "nav_red": 0.35, "rust": 0.85,
    "panel_dark": 0.65, "nav_green": 0.35, "pipe_steel": 0.38,
    "tank_shell": 0.50, "warning_yellow": 0.50, "engine_nozzle": 0.35,
    "crew_suit": 0.70,
}
DEFAULT_ROUGH = 0.55

# ── Stage 2: weld + bevel (same recipe as bevel-pass.py) ─────────────
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.data.objects if o.type == "MESH"]

bpy.ops.object.select_all(action="DESELECT")
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.make_single_user(object=True, obdata=True)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

# Tag landing-gear geometry before the join so it can be separated back
# out afterwards — runtime needs gear as its own node (stowed in flight,
# down on the pad). Vertex groups merge by name and survive the join.
for o in meshes:
    if o.name.startswith("gear_"):
        vg = o.vertex_groups.new(name="gear")
        vg.add(list(range(len(o.data.vertices))), 1.0, "REPLACE")

# THREE.GLTFExporter ships split-normal duplicate verts: weld first or
# Bevel's angle limit sees only boundary edges and does nothing.
for o in meshes:
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bm.to_mesh(o.data)
    bm.free()

bpy.ops.object.shade_auto_smooth(angle=SMOOTH_ANGLE)

for o in meshes:
    dims = [d for d in o.dimensions if d > 1e-4]
    if not dims:
        continue
    b = o.modifiers.new("Bevel", "BEVEL")
    b.offset_type = "OFFSET"
    b.width = max(WIDTH_MIN, min(WIDTH_MAX, WIDTH_FACTOR * min(dims)))
    b.segments = SEGMENTS
    b.limit_method = "ANGLE"
    b.angle_limit = ANGLE_LIMIT
    b.miter_outer = "MITER_ARC"
    b.use_clamp_overlap = True
    wn = o.modifiers.new("WeightedNormal", "WEIGHTED_NORMAL")
    wn.keep_sharp = True

bpy.ops.object.convert(target="MESH")   # apply the whole stack for real
bpy.ops.object.join()                   # one mesh, one bake target
ship = bpy.context.view_layer.objects.active
ship.name = "solace"
me = ship.data

# ── Bake UVs: unique unwrap on a second layer, UV0 keeps base colour ──
bake_uv = me.uv_layers.new(name="bake")
me.uv_layers[0].active_render = True    # base colour keeps sampling UV0
me.uv_layers.active = bake_uv           # bake writes into UV1

bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.003)
bpy.ops.object.mode_set(mode="OBJECT")

# ── Bake setup ───────────────────────────────────────────────────────
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.samples = 32
scene.cycles.use_denoising = False
scene.world = bpy.data.worlds.new("bake-world")

ao_img = bpy.data.images.new("bake_ao", ATLAS, ATLAS)
rough_img = bpy.data.images.new("bake_rough", ATLAS, ATLAS)
for img in (ao_img, rough_img):
    img.colorspace_settings.name = "Non-Color"

def output_node(nt):
    return next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")

def principled(nt):
    return next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")

# Every material gets an active image-texture node aimed at the atlas.
for slot in ship.material_slots:
    nt = slot.material.node_tree
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.name = "BAKE_TARGET"
    tex.image = ao_img
    uvn = nt.nodes.new("ShaderNodeUVMap")
    uvn.name = "BAKE_UV"
    uvn.uv_map = "bake"
    nt.links.new(uvn.outputs["UV"], tex.inputs["Vector"])
    for n in nt.nodes:
        n.select = False
    tex.select = True
    nt.nodes.active = tex

bpy.ops.object.select_all(action="DESELECT")
ship.select_set(True)
bpy.context.view_layer.objects.active = ship

print("bake-pass: baking AO…")
bpy.ops.object.bake(type="AO")

# Roughness rides an Emission shader per material, then an EMIT bake:
# wear (Pointiness ramp) brightens edges to low roughness, grime (inverted
# AO) roughens crevices, low-frequency noise breaks up the rest.
saved_links = {}
temp_nodes = {}
for slot in ship.material_slots:
    mat = slot.material
    nt = mat.node_tree
    out = output_node(nt)
    saved_links[mat.name] = out.inputs["Surface"].links[0].from_socket
    base = BASE_ROUGH.get(mat.name, DEFAULT_ROUGH)
    n = nt.nodes
    added = []

    def new(kind):
        node = n.new(kind)
        added.append(node)
        return node

    geo = new("ShaderNodeNewGeometry")
    ramp = new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.55
    ramp.color_ramp.elements[1].position = 0.72
    nt.links.new(geo.outputs["Pointiness"], ramp.inputs["Fac"])

    ao = new("ShaderNodeAmbientOcclusion")
    ao.samples = 8
    grime = new("ShaderNodeMath")
    grime.operation = "SUBTRACT"
    grime.inputs[0].default_value = 1.0
    nt.links.new(ao.outputs["Color"], grime.inputs[1])

    # r1 = base + (0.28 - base) * wear
    wear = new("ShaderNodeMath")
    wear.operation = "MULTIPLY_ADD"
    wear.inputs[1].default_value = 0.28 - base
    wear.inputs[2].default_value = base
    nt.links.new(ramp.outputs["Color"], wear.inputs[0])

    # r2 = r1 + grime * 0.35
    gmul = new("ShaderNodeMath")
    gmul.operation = "MULTIPLY"
    gmul.inputs[1].default_value = 0.35
    nt.links.new(grime.outputs["Value"], gmul.inputs[0])
    radd = new("ShaderNodeMath")
    radd.operation = "ADD"
    nt.links.new(wear.outputs["Value"], radd.inputs[0])
    nt.links.new(gmul.outputs["Value"], radd.inputs[1])

    # r3 = clamp(r2 + noise * 0.16 - 0.08)
    noise = new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 0.02
    nmad = new("ShaderNodeMath")
    nmad.operation = "MULTIPLY_ADD"
    nmad.inputs[1].default_value = 0.16
    nmad.inputs[2].default_value = -0.08
    nt.links.new(noise.outputs["Fac"], nmad.inputs[0])
    total = new("ShaderNodeMath")
    total.operation = "ADD"
    total.use_clamp = True
    nt.links.new(radd.outputs["Value"], total.inputs[0])
    nt.links.new(nmad.outputs["Value"], total.inputs[1])

    em = new("ShaderNodeEmission")
    nt.links.new(total.outputs["Value"], em.inputs["Color"])
    nt.links.new(em.outputs["Emission"], out.inputs["Surface"])

    nt.nodes["BAKE_TARGET"].image = rough_img
    temp_nodes[mat.name] = added

print("bake-pass: baking roughness…")
bpy.ops.object.bake(type="EMIT")

# ── Compose ORM (R=AO, G=rough, B=1) and rewire materials for export ──
buf_ao = np.empty(ATLAS * ATLAS * 4, np.float32)
buf_rg = np.empty(ATLAS * ATLAS * 4, np.float32)
ao_img.pixels.foreach_get(buf_ao)
rough_img.pixels.foreach_get(buf_rg)
orm = np.ones(ATLAS * ATLAS * 4, np.float32)
orm[0::4] = buf_ao[0::4]
orm[1::4] = buf_rg[0::4]
orm_img = bpy.data.images.new("solace_orm", ATLAS, ATLAS)
orm_img.colorspace_settings.name = "Non-Color"
orm_img.pixels.foreach_set(orm)
orm_img.filepath_raw = os.path.join(tempfile.gettempdir(), "solace_orm.png")
orm_img.file_format = "PNG"
orm_img.save()

# The exporter reads occlusion from a node group named "glTF Material
# Output" with an "Occlusion" input; roughness from Principled via
# Separate Color G. UV1 travels along from the shared UVMap node.
grp_tree = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
grp_tree.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")

for slot in ship.material_slots:
    mat = slot.material
    nt = mat.node_tree
    out = output_node(nt)
    nt.links.new(saved_links[mat.name], out.inputs["Surface"])
    for node in temp_nodes[mat.name]:
        nt.nodes.remove(node)
    tex = nt.nodes["BAKE_TARGET"]
    tex.image = orm_img
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(tex.outputs["Color"], sep.inputs["Color"])
    nt.links.new(sep.outputs["Green"], principled(nt).inputs["Roughness"])
    grp = nt.nodes.new("ShaderNodeGroup")
    grp.node_tree = grp_tree
    nt.links.new(sep.outputs["Red"], grp.inputs["Occlusion"])

# Split the gear back out as its own node (shares materials + atlas, so
# only a handful of extra draw calls) — runtime toggles it by name.
bpy.ops.object.select_all(action="DESELECT")
ship.select_set(True)
bpy.context.view_layer.objects.active = ship
ship.vertex_groups.active_index = ship.vertex_groups["gear"].index
bpy.ops.object.mode_set(mode="EDIT")
bpy.context.tool_settings.mesh_select_mode = (True, False, False)
bpy.ops.mesh.select_all(action="DESELECT")
bpy.ops.object.vertex_group_select()
bpy.ops.mesh.separate(type="SELECTED")
bpy.ops.object.mode_set(mode="OBJECT")
for o in bpy.context.selected_objects:
    if o is not ship:
        o.name = "gear"
ship.name = "solace"

bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", export_yup=True)
print(f"bake-pass: {src} -> {dst}")
