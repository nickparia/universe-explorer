# The SOLACE — the hero hull, modelled.
#
# What shipped before this file was a kit-bash: 644 objects, 40,428 tris,
# 380 of them 12-tri boxes and 95 of them 96-tri cylinders. Bevel and
# baked AO made those boxes catch light beautifully; they could not make
# them stop being boxes. At 256 m there is nowhere to hide.
#
# So the body is authored here instead, the way a hull is actually drawn:
# a lines plan. Stations down the length, each a closed section with its
# own beam, sheer, tumblehome and turn of bilge; the skin is lofted
# between them. Every mass that grows off the hull is lofted the same
# way. Nothing in this file is a primitive cube standing in for a shape.
#
# Coordinates are Blender's (Z up, X along the keel, bow toward −X); the
# exporter flips to glTF's Y-up, which is why the runtime sees the bow at
# −X and the gear pads at y=0. Real meters throughout — she is 256.4 m
# and the numbers here are her actual dimensions, not a convenient scale.
#
#   blender --background --python tools/model-solace.py -- out.glb [out.blend]
#
# Then judge it: tools/ship-pipeline.sh for the bevel + bake, and
# /ship-viewer.html for the verdict. Art law lives in docs/SHIP.md.

import bpy
import bmesh
import math
import os
import random
import sys
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT_GLB = argv[0] if argv else "models/solace-hauler-v2.glb"
OUT_BLEND = argv[1] if len(argv) > 1 else None

rng = random.Random(20260812)   # the panel work must be the same every run

# ── The lines plan ───────────────────────────────────────────────────
# Her envelope, held deliberately: the runtime seats her from these
# numbers (js/ground/lander.js probes gear pads at x −100/0/+88, z ±17)
# and 256.4 m is the length the scale pass already put on the pad.
BOW_X, STERN_X = -125.2, 131.2
BELLY_Z = 12.0          # hull underside amidships; the legs make up the rest
PAD_Z = 0.0             # gear pads on the ground plane

MATS = {}


# ── bmesh helpers: the chisels ───────────────────────────────────────

def ring(bm, pts):
    """A closed section: a list of (x, y, z) → a list of bmesh verts."""
    return [bm.verts.new(p) for p in pts]


def loft(bm, rings, close_start=True, close_end=True):
    """Bridge consecutive sections into a skin, then cap the ends.

    Every ring carries the same vertex count and the same winding, so the
    bridge is a plain quad strip — which is the whole point of drawing a
    lines plan first: the topology falls out of the geometry.
    """
    faces = []
    for a, b in zip(rings, rings[1:]):
        n = len(a)
        for j in range(n):
            k = (j + 1) % n
            try:
                faces.append(bm.faces.new((a[j], a[k], b[k], b[j])))
            except ValueError:
                pass          # coincident section (a hard shoulder) — skip
    if close_start:
        try:
            faces.append(bm.faces.new(tuple(reversed(rings[0]))))
        except ValueError:
            pass
    if close_end:
        try:
            faces.append(bm.faces.new(tuple(rings[-1])))
        except ValueError:
            pass
    return faces


def section(x, hy, zb, zt, td=0.72, bd=0.80, sh=0.22, bh=0.16,
            crown=0.0, keel=0.0, roll=0.0):
    """One station of the pressure hull, as twelve points.

    hy   half-beam            td/bd  deck / bottom width fraction
    zb   underside            sh/bh  shoulder / bilge chamfer, as a
    zt   deck                        fraction of section depth
    crown  deck camber at the centreline   keel  centreline drop

    The chamfers are what stop her reading as a slab: a hard shoulder
    line and a turn of the bilge give the flank two highlights instead
    of one, which is the whole Nostromo trick — a big flat body that
    still catches light like machinery.
    """
    d = zt - zb
    s, b = sh * d, bh * d
    pts = [
        (0.0, zt + crown),
        (hy * td, zt),
        (hy, zt - s),
        (hy, zb + b + (d - b - s) * 0.45),
        (hy * 0.97, zb + b),
        (hy * bd, zb),
        (0.0, zb - keel),
        (-hy * bd, zb),
        (-hy * 0.97, zb + b),
        (-hy, zb + b + (d - b - s) * 0.45),
        (-hy, zt - s),
        (-hy * td, zt),
    ]
    if roll:
        c, sn = math.cos(roll), math.sin(roll)
        pts = [(y * c - (z - (zb + zt) / 2) * sn,
                y * sn + (z - (zb + zt) / 2) * c + (zb + zt) / 2) for y, z in pts]
    return [(x, y, z) for y, z in pts]


def box_section(x, y0, y1, z0, z1, cham=0.0):
    """A rectangular station with optional corner chamfers — eight points.

    Used for the masses that genuinely are boxes at heart (housings,
    pylons, the engine block). Chamfered, they are still machined
    volumes rather than cubes: the chamfer is a real face that takes its
    own light, which is exactly what the old kit-bash never had.
    """
    if cham <= 0:
        return [(x, y0, z0), (x, y1, z0), (x, y1, z1), (x, y0, z1)]
    # A chamfer wider than the section leaves slivers where the two
    # chamfers meet, and a sliver is what the bevel pass detonates on.
    # The radiator panels were 0.5 m thick with a 0.2 m chamfer from each
    # side: 0.1 m of actual face between them, and vertices 1e29 m out.
    c = min(cham, 0.45 * min(y1 - y0, z1 - z0))
    return [
        (x, y0 + c, z0), (x, y1 - c, z0),
        (x, y1, z0 + c), (x, y1, z1 - c),
        (x, y1 - c, z1), (x, y0 + c, z1),
        (x, y0, z1 - c), (x, y0, z0 + c),
    ]


def disc(bm, x, cy, cz, r, n=16, squash=1.0):
    """A circular station in the Y/Z plane — for bells, tanks, domes."""
    return ring(bm, [(x, cy + r * math.cos(2 * math.pi * i / n),
                      cz + r * math.sin(2 * math.pi * i / n) * squash)
                     for i in range(n)])


def loft_grid(bm, rings):
    """Loft, but hand back the skin as rows × columns.

    Being able to address the quad at (row, column) is what lets a
    detail follow the form — meridian ribs on a dome, a strake running a
    flank — instead of being a separate object floating near it.
    """
    grid = []
    for a, b in zip(rings, rings[1:]):
        n = len(a)
        row = []
        for j in range(n):
            k = (j + 1) % n
            try:
                row.append(bm.faces.new((a[j], a[k], b[k], b[j])))
            except ValueError:
                row.append(None)
        grid.append(row)
    return grid


def loft_run(bm, stations, panels=None):
    """Loft a run of chamfered rectangular stations.

    Stations are (x, y0, y1, z0, z1, chamfer). Every mass on this ship
    that reads as a box is really this: a run with its own taper and its
    own chamfer, so the corner is a face that takes light rather than an
    edge that doesn't.
    """
    rings = [ring(bm, box_section(*s)) for s in stations]
    faces = loft(bm, rings)
    if panels:
        panelise(bm, faces, **panels)
    return faces


def place(bm, loc=(0, 0, 0), rot=(0, 0, 0)):
    """Rotate then translate a finished bmesh into position."""
    import mathutils
    if any(rot):
        m = mathutils.Euler(rot, "XYZ").to_matrix().to_4x4()
        bmesh.ops.transform(bm, matrix=m, verts=bm.verts[:])
    if any(loc):
        bmesh.ops.translate(bm, vec=Vector(loc), verts=bm.verts[:])


def slab(name, mat, center, size, cham=0.15, rot=(0, 0, 0), panels=None):
    """A plate: window panes, stencil boards, hatch covers, deck gratings.

    A pane genuinely is a flat plate — this is the one place a rectangle
    is the honest answer rather than a stand-in for a shape.
    """
    bm = bmesh.new()
    sx, sy, sz = size
    loft_run(bm, [(-sx / 2, -sy / 2, sy / 2, -sz / 2, sz / 2, cham),
                  (sx / 2, -sy / 2, sy / 2, -sz / 2, sz / 2, cham)],
             panels=panels)
    place(bm, center, rot)
    return to_object(bm, name, mat)


def tube(name, mat, p0, p1, r0, r1, n=14):
    """A round member between two points — struts, braces, pipe runs.

    Lofted along +X from the origin and then swung onto the line p0→p1,
    which keeps every cylindrical thing on the ship built the one way.
    """
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    L = d.length
    bm = bmesh.new()
    loft(bm, [disc(bm, L * t, 0, 0, r, n=n)
              for t, r in ((0.0, r0), (0.5, (r0 + r1) / 2), (1.0, r1))])
    rot = Vector((1, 0, 0)).rotation_difference(d.normalized()).to_euler()
    place(bm, tuple(p0), tuple(rot))
    return to_object(bm, name, mat)


def mirror_y(ob, name):
    """The starboard twin of a port part (and vice versa).

    Mirrored in bmesh rather than by a negative object scale: a −1 scale
    inverts the winding, and an inside-out twin is invisible from the
    only side anyone looks at it from.
    """
    me = ob.data.copy()
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.scale(bm, vec=(1, -1, 1), verts=bm.verts[:])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(me)
    bm.free()
    twin = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(twin)
    return twin


def to_object(bm, name, mat="hull"):
    """Finish a bmesh into a real object with its material slots.

    `mat` may be a single name or a sequence; slot 1, where given, is the
    accent panelise() paints its replaced plates with.
    """
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    for m in ((mat,) if isinstance(mat, str) else mat):
        ob.data.materials.append(MATS[m])
    bpy.context.collection.objects.link(ob)
    return ob


def panelise(bm, faces, cuts=2, fraction=0.34, depth=0.10, thickness=0.6,
             min_area=6.0, accent=0.30):
    """Panel-in-panel relief: cut the skin into plates, sink some of them.

    The reference sheets are covered in this and nothing else explains
    why they read as built objects — a hull is not one surface, it is
    hundreds of plates with seams between them. Subdividing first keeps
    the plates roughly panel-sized instead of hull-sized; insetting a
    minority of them gives the seam a shadow without turning the whole
    flank into corduroy.
    """
    # Quads only. The end caps of a chamfered run are octagons, and
    # subdivide's grid fill has no grid to fill on an n-gon: it lays down
    # overlapping slivers that inset then turns inside out. Which caps
    # got picked depended on the rng, which is why this surfaced as two
    # or three random parts exploding per build rather than as a rule.
    # Panel lines belong on the skin anyway, not on a cut end.
    faces = [f for f in faces if len(f.verts) == 4]
    if not faces:
        return []
    if cuts:
        edges = set()
        for f in faces:
            edges.update(f.edges)
        res = bmesh.ops.subdivide_edges(bm, edges=list(edges), cuts=cuts,
                                        use_grid_fill=True)
        faces = [g for g in res["geom"] if isinstance(g, bmesh.types.BMFace)] or faces
    # Area alone is not enough to know a face can take an inset. A
    # chamfer strip 20 m long and 30 cm wide has plenty of area and an
    # inradius of 15 cm; inset it by 90 cm and it turns inside out. Those
    # inverted slivers survived every stage of the pipeline and only blew
    # up at draco quantisation, which reported vertices four trillion
    # metres away and an empty-looking bench. Gate on the short edge.
    def insettable(f):
        return min(e.calc_length() for e in f.edges) > thickness * 2.6

    picks = [f for f in faces if f.is_valid and f.calc_area() > min_area
             and insettable(f) and rng.random() < fraction]
    for f in picks:
        d = depth * (0.5 + rng.random())
        bmesh.ops.inset_individual(bm, faces=[f], thickness=thickness,
                                   depth=-d, use_even_offset=True)
        # Some sunk plates are a different plate: replaced, repainted, or
        # simply older. One value of grey over a whole hull is the tell
        # of a generated object — a real one is patchwork.
        if f.is_valid and rng.random() < accent:
            f.material_index = 1
    return picks


# ── Materials ────────────────────────────────────────────────────────
# Names are a contract: tools/bake-pass.py looks up per-material resting
# roughness by name, and lander.js finds the practicals the same way.

PALETTE = {
    "hull":           (0.52, 0.50, 0.46, 1),
    "hull_light":     (0.64, 0.62, 0.57, 1),
    "hull_dark":      (0.24, 0.235, 0.225, 1),
    "hull_stencil":   (0.40, 0.39, 0.36, 1),   # her name: paint, gone pale
    "panel_dark":     (0.15, 0.15, 0.145, 1),
    "metal_dark":     (0.13, 0.13, 0.14, 1),
    "pipe_steel":     (0.40, 0.41, 0.44, 1),
    "tank_shell":     (0.46, 0.45, 0.42, 1),
    "rust":           (0.30, 0.18, 0.11, 1),
    "grime":          (0.16, 0.14, 0.12, 1),
    "warning_yellow": (0.66, 0.50, 0.08, 1),
    "engine_nozzle":  (0.17, 0.165, 0.16, 1),
    "window_glow":    (0.05, 0.05, 0.06, 1),
    "nav_red":        (0.40, 0.03, 0.03, 1),
    "nav_green":      (0.03, 0.40, 0.10, 1),
    "crew_suit":      (0.55, 0.42, 0.12, 1),
}
METALLIC = {"pipe_steel": 0.85, "metal_dark": 0.75, "engine_nozzle": 0.8,
            "tank_shell": 0.5, "hull": 0.25, "hull_light": 0.25,
            "hull_dark": 0.3, "panel_dark": 0.3}
EMISSIVE = {"window_glow": ((1.0, 0.80, 0.52), 1.0),
            "nav_red": ((1.0, 0.10, 0.06), 0.6),
            "nav_green": ((0.12, 1.0, 0.30), 0.6)}


def build_materials():
    for name, col in PALETTE.items():
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        bsdf.inputs["Base Color"].default_value = col
        bsdf.inputs["Metallic"].default_value = METALLIC.get(name, 0.1)
        bsdf.inputs["Roughness"].default_value = 0.55
        if name in EMISSIVE:
            rgb, strength = EMISSIVE[name]
            bsdf.inputs["Emission Color"].default_value = (*rgb, 1)
            bsdf.inputs["Emission Strength"].default_value = strength
        MATS[name] = m


# ── The pressure hull ────────────────────────────────────────────────
# Bow to stern, in stations. She is a working hauler: a long parallel
# midbody carrying the accommodation, a bow that tapers hard in plan and
# undercuts in profile, and a stern that swells to take the engines.
#
# She is INDUSTRY, not aerodynamics (docs/SHIP.md), and the first cut of
# this table forgot it: smooth sheer plus a fine entry read as a
# submarine. So the deck is dead flat over the working length, the belly
# is dead flat where the legs meet it, and every change of direction
# happens at a station instead of easing across six. What curves on a
# hauler is nothing; what she has instead is knuckles.
#
#   x        half-beam  underside  deck   tumblehome  notes
STATIONS = [
    (-125.2,   7.0,     21.0,      29.6,   0.50),   # chisel — a cut, not a point
    (-121.0,   9.2,     19.4,      30.6,   0.52),
    (-114.0,  12.2,     17.2,      31.8,   0.55),   # knuckle: entry ends
    (-104.0,  15.0,     15.2,      32.8,   0.58),
    (-92.0,   17.0,     13.6,      33.4,   0.62),
    (-78.0,   18.3,     12.6,      33.9,   0.66),
    (-58.0,   19.0,     12.0,      34.0,   0.70),   # parallel midbody
    (-28.0,   19.2,     12.0,      34.0,   0.72),   #   — the home
    (4.0,     19.2,     12.0,      34.0,   0.72),
    (36.0,    19.2,     12.0,      34.0,   0.72),
    (62.0,    19.4,     12.0,      34.2,   0.72),   # knuckle: shoulders open
    (80.0,    20.8,     12.6,      36.0,   0.74),
    (98.0,    22.0,     13.4,      38.0,   0.76),   # the engine block's seat
    (112.0,   22.4,     14.4,      39.0,   0.78),
    (121.0,   21.6,     15.4,      38.6,   0.80),
    (128.4,   19.4,     16.6,      37.6,   0.82),   # transom
]
# The transom stops 2.8 m short of her stern so the bells have somewhere
# to emerge from. Her length is a contract with the scale pass — the
# nozzles are allowed to be the last thing on the ship, not to add to it.


def build_hull():
    bm = bmesh.new()
    rings = []
    n = len(STATIONS)
    for i, (x, hy, zb, zt, td) in enumerate(STATIONS):
        t = i / (n - 1)
        # The chamfers open up amidships where the flank is tallest and
        # tighten at the ends, so the highlight running her length swells
        # and closes instead of holding one dead width. Forward they go
        # hard: the bow is a wedge in section as well as in plan.
        sh = 0.15 + 0.11 * math.sin(math.pi * min(1.0, t * 1.15))
        bh = 0.11 + 0.09 * math.sin(math.pi * t)
        rings.append(ring(bm, section(x, hy, zb, zt, td=td, bd=0.82,
                                      sh=sh, bh=bh)))
    faces = loft(bm, rings)
    panelise(bm, faces, cuts=2, fraction=0.30, depth=0.14, thickness=0.9,
             min_area=12.0)
    return to_object(bm, "hull_skin", ("hull", "hull_dark"))


# ── The forward castle ───────────────────────────────────────────────
# Bridge on top, cryo bay below it: waking and flying live in the same
# tower (docs/SHIP.md). Its job on the silhouette is the raked visor —
# the one place on a working hull where a face is deliberately angled,
# so it catches a different light than everything around it and reads as
# the head of the animal.

def build_castle():
    bm = bmesh.new()
    # The stations come in pairs a half-metre apart wherever the form
    # changes direction. That gap is the whole difference between a
    # machined block and a loaf: a continuous taper sweeps a soft
    # surface, while a knuckle station puts a near-vertical face in the
    # run and gives the light somewhere to stop.
    loft_run(bm, [
        (-110.0, -9.0, 9.0, 32.6, 36.6, 0.8),    # fairing, faired into the deck
        (-105.0, -12.6, 12.6, 32.9, 38.6, 1.2),
        (-100.0, -14.2, 14.2, 33.1, 40.0, 1.5),
        (-99.4, -14.6, 14.6, 33.2, 40.3, 1.5),   # knuckle: the visor begins
        (-96.0, -14.6, 14.6, 33.2, 43.0, 1.6),
        (-91.0, -14.8, 14.8, 33.3, 45.8, 1.8),
        (-88.0, -15.0, 15.0, 33.4, 46.6, 1.9),   # knuckle: bridge deck
        (-70.0, -15.0, 15.0, 33.6, 46.6, 1.9),   # flat top, flat flanks
        (-66.0, -14.6, 14.6, 33.7, 46.4, 1.8),
        (-65.4, -14.4, 14.4, 33.7, 43.4, 1.7),   # knuckle: step down aft
        (-58.0, -13.0, 13.0, 33.8, 42.0, 1.5),
        (-53.0, -11.5, 11.5, 33.9, 40.6, 1.3),   # onto the spine
    ], panels=dict(cuts=2, fraction=0.36, depth=0.16, thickness=0.5,
                   min_area=3.0))
    return to_object(bm, "castle", ("hull_light", "hull"))


def build_bridge_glass():
    """The visor: a window band lying on the rake, not punched into it."""
    # The raked face runs from (−101, 39.4) to (−87, 46.4): 7 m of rise
    # over 14 m of run, so the band lies at that angle and sits a
    # handspan proud, the way a real gasketed frame does.
    rake = math.atan2(46.4 - 39.4, -87.0 + 101.0)
    glass = slab("bridge_glass", "window_glow", (-93.6, 0, 43.2),
                 (11.0, 25.4, 0.7), cham=0.2, rot=(0, -rake, 0))
    frame = slab("bridge_visor", "metal_dark", (-93.8, 0, 43.2),
                 (12.4, 26.6, 0.5), cham=0.2, rot=(0, -rake, 0))
    # Mullions: the band is divided, because an unbroken 25 m sheet of
    # glass reads as a decal and a divided one reads as engineering.
    for i, y in enumerate((-8.5, -2.8, 2.8, 8.5)):
        slab(f"bridge_mullion_{i}", "metal_dark", (-93.4, y, 43.2),
             (11.4, 0.55, 1.1), cham=0.12, rot=(0, -rake, 0))
    return glass, frame


# ── The dorsal spine ─────────────────────────────────────────────────
# The corridor housing that joins castle to engine block — the home,
# seen from outside. Long, low and panelled: its whole job is to give
# the top deck a second storey so the profile is not one flat line.

def build_spine():
    bm = bmesh.new()
    loft_run(bm, [
        (-55.0, -11.5, 11.5, 33.9, 40.4, 1.3),
        (-38.0, -12.5, 12.5, 33.9, 41.0, 1.5),
        (-6.0, -12.5, 12.5, 33.9, 41.2, 1.5),
        (30.0, -12.5, 12.5, 33.9, 41.2, 1.5),
        (52.0, -12.0, 12.0, 34.0, 40.6, 1.4),
        (66.0, -10.0, 10.0, 34.1, 39.0, 1.2),
    ], panels=dict(cuts=3, fraction=0.40, depth=0.14, thickness=0.45,
                   min_area=2.5))
    return to_object(bm, "spine", ("hull", "hull_dark"))


def build_observatory():
    """The blister you sit in — the vibe, and the reason S2 starts here.

    A half-dome proud of the spine so there is sky in every direction
    above the hull line, ribbed on meridians because a 16 m pressure
    dome is a made thing with seams, not a bubble.
    """
    cx, cz, r = 18.0, 40.9, 8.6
    bm = bmesh.new()
    # Built lying along +X at the origin, then stood up — a dome is a
    # surface of revolution and this is the axis the disc helper turns on.
    N = 24
    rings = [disc(bm, 0, 0, 0, r, n=N)]
    for lat in (15, 30, 45, 60, 74):
        a = math.radians(lat)
        rings.append(disc(bm, r * math.sin(a), 0, 0, r * math.cos(a), n=N))
    rings.append(disc(bm, r * 0.996, 0, 0, r * 0.09, n=N))
    grid = loft_grid(bm, rings)
    try:
        bm.faces.new(tuple(rings[-1]))
    except ValueError:
        pass
    # The ribs are raised out of the dome's own skin rather than floated
    # over it: every fourth meridian, proud by a third of a meter. A
    # 17 m pressure dome is a made thing with seams.
    ribs = [row[j] for row in grid for j in range(0, N, 4) if row[j]]
    bmesh.ops.inset_individual(bm, faces=ribs, thickness=0.10, depth=0.34,
                               use_even_offset=True)
    place(bm, (cx, 0, cz), (0, -math.pi / 2, 0))
    dome = to_object(bm, "observatory_dome", "window_glow")

    # The collar it is set into — a dome without a frame is a soap bubble
    cb = bmesh.new()
    loft_run(cb, [(cx - r - 1.6, -r - 1.6, r + 1.6, cz - 1.4, cz + 0.9, 0.5),
                  (cx - r - 0.4, -r - 1.9, r + 1.9, cz - 1.4, cz + 1.4, 0.5),
                  (cx + r + 0.4, -r - 1.9, r + 1.9, cz - 1.4, cz + 1.4, 0.5),
                  (cx + r + 1.6, -r - 1.6, r + 1.6, cz - 1.4, cz + 0.9, 0.5)])
    to_object(cb, "observatory_collar", "hull_dark")
    return dome


# ── The engine block ─────────────────────────────────────────────────
# Aft: where the ship stops being accommodation and becomes machinery.
# It is the tallest and widest thing on her, which is what makes the
# profile read stern-heavy — a tug pulling, not a dart flying.

def build_engine_block():
    bm = bmesh.new()
    loft_run(bm, [
        (66.0, -13.5, 13.5, 34.1, 37.6, 1.1),
        (71.0, -16.8, 16.8, 34.6, 40.8, 1.5),
        (76.0, -19.0, 19.0, 35.2, 43.6, 1.9),
        (80.0, -20.0, 20.0, 35.8, 46.0, 2.2),
        (80.6, -20.2, 20.2, 35.9, 46.6, 2.2),   # knuckle: the block proper
        (92.0, -20.2, 20.2, 37.0, 46.6, 2.2),   # flat top, flat flanks
        (116.0, -20.2, 20.2, 38.2, 46.6, 2.2),
        (116.6, -20.0, 20.0, 38.3, 46.2, 2.1),  # knuckle: transom taper
        (123.0, -19.4, 19.4, 38.4, 45.4, 2.0),
        (128.4, -17.6, 17.6, 37.8, 43.6, 1.8),
    ], panels=dict(cuts=3, fraction=0.38, depth=0.18, thickness=0.6,
                   min_area=4.0))
    return to_object(bm, "engine_block", ("hull_dark", "rust"))


def build_bells():
    """Four bells at the transom, flared and collared.

    Lofted from discs, so the flare is a real surface of revolution; the
    lip is a heavier ring at the mouth because that is where a nozzle
    takes its beating and where the light catches when she is cooling.
    """
    # Mouths flush with the transom at 131.2: she is 256.4 m and the
    # bells are not allowed to lengthen her behind the scale pass's back.
    made = []
    for i, (cy, cz, r0, r1) in enumerate([(-11.5, 24.0, 4.0, 6.5),
                                          (11.5, 24.0, 4.0, 6.5),
                                          (-4.6, 32.0, 2.7, 4.3),
                                          (4.6, 32.0, 2.7, 4.3)]):
        bm = bmesh.new()
        rings = [disc(bm, 112.0 + t, cy, cz, r, n=18) for t, r in (
            (0.0, r0 * 0.70), (3.5, r0 * 0.80), (7.5, r0),
            (11.5, r0 * 1.18), (15.0, r1 * 0.84), (18.2, r1),
            (19.2, r1 * 0.94))]
        loft(bm, rings)
        made.append(to_object(bm, f"engine_bell_{i}", "engine_nozzle"))

        # The mounting ring the bell emerges through — without it the
        # nozzle reads as pasted onto the transom instead of set into it.
        cb = bmesh.new()
        loft(cb, [disc(cb, 124.6, cy, cz, r1 * 0.90, n=18),
                  disc(cb, 127.2, cy, cz, r1 * 1.16, n=18),
                  disc(cb, 128.8, cy, cz, r1 * 1.10, n=18)])
        made.append(to_object(cb, f"engine_collar_{i}", "metal_dark"))
    return made


# ── Outriggers and nacelle scoops ────────────────────────────────────
# The signature. Everything above is a hull; this is what makes her that
# hull. Two heavy housings slung outboard and low on stub pylons, canted
# out and toed out, with the aft face opened into a deep coffered
# grille — the one place on the ship where you are looking into her
# rather than at her, which is why it holds the eye from any angle.

def coffer(bm, x, y0, y1, z0, z1, cols, rows, depth, rim):
    """A grid of deep cells cut into a face — the grille.

    Insetting each cell with negative depth builds the cell walls for
    free, so the recess is a real four-sided box you can see into, not a
    dark rectangle painted on a flat plate. That difference is the whole
    reason the reference sheets read as machinery at any distance.
    """
    vs = [[bm.verts.new((x, y0 + (y1 - y0) * c / cols,
                         z0 + (z1 - z0) * r / rows))
           for c in range(cols + 1)] for r in range(rows + 1)]
    cells = [bm.faces.new((vs[r][c], vs[r][c + 1], vs[r + 1][c + 1], vs[r + 1][c]))
             for r in range(rows) for c in range(cols)]
    bmesh.ops.inset_individual(bm, faces=cells, thickness=rim, depth=-depth,
                               use_even_offset=True)
    return cells


NAC_LEN = 42.0
NAC_HW, NAC_HH = 6.5, 9.9      # half width / half height at the mouth


def build_nacelle(side):
    """One scoop, built along its own axis and then slung into place."""
    s = 1 if side > 0 else -1
    bm = bmesh.new()
    loft_run(bm, [
        (0.0, -4.6, 4.6, -6.0, 6.0, 1.1),      # the closed nose
        (5.0, -5.8, 5.8, -7.8, 7.8, 1.6),
        (13.0, -6.3, 6.3, -8.9, 8.9, 1.9),
        (30.0, -6.4, 6.4, -9.2, 9.2, 1.9),     # parallel run
        (37.0, -6.4, 6.4, -9.6, 9.6, 2.0),
        (NAC_LEN, -NAC_HW, NAC_HW, -NAC_HH, NAC_HH, 2.1),   # the mouth flares
    ], panels=dict(cuts=3, fraction=0.34, depth=0.20, thickness=0.55,
                   min_area=3.0))
    # The mouth: a 3 × 2 coffer sunk seven metres into the housing.
    coffer(bm, NAC_LEN + 0.02, -NAC_HW + 1.5, NAC_HW - 1.5,
           -NAC_HH + 1.7, NAC_HH - 1.7, cols=3, rows=2, depth=7.0, rim=0.85)
    # Canted out and toed out — the splay is what stops the pair reading
    # as two boxes bolted on parallel to everything else. Slung far
    # enough outboard that daylight shows between housing and flank:
    # tucked in, the first cut swallowed its own pylon whole and the
    # scoops read as blisters on the hull instead of things hung off it.
    place(bm, (70.0, s * 30.0, 23.0), (s * 0.20, -0.04, s * 0.06))
    return to_object(bm, f"nacelle_{'s' if s > 0 else 'p'}", ("hull", "hull_dark"))


def build_pylon(side):
    """The stub outrigger the scoop hangs from."""
    s = 1 if side > 0 else -1
    bm = bmesh.new()
    # Lofted outboard along its own +X, then swung to point along ±Y.
    loft_run(bm, [
        (0.0, -15.0, 15.0, -7.4, 7.4, 1.3),    # root, buried in the flank
        (3.0, -14.0, 14.0, -6.8, 6.8, 1.3),
        (7.0, -12.5, 12.5, -6.0, 6.0, 1.2),
        (10.5, -11.5, 11.5, -5.4, 5.4, 1.1),   # tip, inside the housing
    ], panels=dict(cuts=2, fraction=0.30, depth=0.16, thickness=0.5,
                   min_area=3.0))
    place(bm, (90.0, s * 17.0, 25.0), (0, 0, s * math.pi / 2))
    return to_object(bm, f"pylon_{'s' if s > 0 else 'p'}", ("hull_dark", "grime"))


def build_outriggers():
    made = []
    for side in (1, -1):
        made.append(build_pylon(side))
        made.append(build_nacelle(side))
    return made


# ── Landing gear ─────────────────────────────────────────────────────
# Six legs, and the most load-bearing sixteen hundred millimetres on the
# ship: the user's acceptance test for her scale is that a human coming
# down the ramp should reach the top of a leg base and no further. The
# pad is 9.0 × 7.0 × 1.6 m for exactly that reason, and every part of
# this section is named gear_* so tools/bake-pass.py can lift it into
# its own node — in flight the legs are up, and hiding
# them is a free LOD besides.

PAD_STATIONS = (-100.0, 0.0, 88.0)      # js/ground/lander.js probes these
PAD_Y = 17.0
PAD_H = 1.6


def _lerp_station(x, col):
    pts = [(s[0], s[col]) for s in STATIONS]
    if x <= pts[0][0]:
        return pts[0][1]
    for (x0, v0), (x1, v1) in zip(pts, pts[1:]):
        if x <= x1:
            return v0 + (v1 - v0) * (x - x0) / (x1 - x0)
    return pts[-1][1]


def belly_z(x):
    """The hull's underside at a station — where a leg has to reach."""
    return _lerp_station(x, 2)


def deck_z(x):
    """The top of the pressure hull at a station."""
    return _lerp_station(x, 3)


def half_beam(x):
    """Half the hull's width at a station — where the flank actually is.

    Every greeble that is meant to sit ON her asks this first. Detail
    placed at a guessed offset floats or sinks, and both read as a
    mistake from fifty metres away.
    """
    return _lerp_station(x, 1)


def build_leg(px, side):
    """One leg: bay, oleo, piston, drag brace, pad.

    Splayed — foot outboard of shoulder — because a stance wider than
    the hull is what says "this thing is heavy and it landed itself",
    and because six vertical posts under a slab read as scaffolding.
    """
    s = 1 if side > 0 else -1
    top = belly_z(px)
    made = []

    # The bay it folds out of: a housing let into the belly, so the leg
    # comes from somewhere instead of being welded to the skin.
    bay = bmesh.new()
    loft_run(bay, [
        (px - 7.0, s * 9.5, s * 16.0, top - 0.6, top + 3.4, 0.5),
        (px - 5.6, s * 9.0, s * 16.6, top - 1.9, top + 3.4, 0.6),
        (px + 5.6, s * 9.0, s * 16.6, top - 1.9, top + 3.4, 0.6),
        (px + 7.0, s * 9.5, s * 16.0, top - 0.6, top + 3.4, 0.5),
    ])
    made.append(to_object(bay, f"gear_bay_{px:+.0f}_{'s' if s > 0 else 'p'}",
                          "hull_dark"))

    # Oleo: a fat upper cylinder and a narrower polished piston sliding
    # out of it. Two diameters is the entire visual grammar of a shock
    # strut, and it costs eighteen more verts.
    tag = f"{px:+.0f}_{'s' if s > 0 else 'p'}"
    shoulder = Vector((px, s * 13.6, top - 1.4))
    foot = Vector((px, s * PAD_Y, PAD_H))
    made.append(tube(f"gear_oleo_{tag}", "metal_dark",
                     shoulder, shoulder.lerp(foot, 0.62), 2.05, 1.88))
    made.append(tube(f"gear_piston_{tag}", "pipe_steel",
                     shoulder.lerp(foot, 0.56), foot, 1.28, 1.22))

    # Drag braces: the diagonals that stop the leg folding fore-and-aft.
    for j, dx in enumerate((-8.2, 8.2)):
        made.append(tube(f"gear_brace{j}_{tag}", "pipe_steel",
                         (px + dx, s * 14.6, top - 0.9),
                         (px + dx * 0.16, s * (PAD_Y - 0.5), PAD_H + 0.5),
                         0.74, 0.58, n=8))

    # The pad. 1.6 m: the number the whole scale pass was fought over.
    pad = bmesh.new()
    loft_run(pad, [
        (px - 4.5, s * (PAD_Y - 3.5), s * (PAD_Y + 3.5), 0.0, 1.15, 0.35),
        (px - 3.7, s * (PAD_Y - 3.9), s * (PAD_Y + 3.9), 0.0, 1.20, 0.40),
        (px + 3.7, s * (PAD_Y - 3.9), s * (PAD_Y + 3.9), 0.0, 1.20, 0.40),
        (px + 4.5, s * (PAD_Y - 3.5), s * (PAD_Y + 3.5), 0.0, 1.15, 0.35),
    ])
    made.append(to_object(pad, f"gear_pad_{px:+.0f}_{'s' if s > 0 else 'p'}",
                          "metal_dark"))
    # The ankle: a shallow crown so the foot is a casting, not a coaster.
    ank = bmesh.new()
    loft_run(ank, [
        (px - 2.6, s * (PAD_Y - 2.4), s * (PAD_Y + 2.4), 1.15, 1.45, 0.3),
        (px - 1.9, s * (PAD_Y - 2.0), s * (PAD_Y + 2.0), 1.45, PAD_H, 0.3),
        (px + 1.9, s * (PAD_Y - 2.0), s * (PAD_Y + 2.0), 1.45, PAD_H, 0.3),
        (px + 2.6, s * (PAD_Y - 2.4), s * (PAD_Y + 2.4), 1.15, 1.45, 0.3),
    ])
    made.append(to_object(ank, f"gear_ankle_{px:+.0f}_{'s' if s > 0 else 'p'}",
                          "metal_dark"))
    return made


def build_gear():
    made = []
    for px in PAD_STATIONS:
        for side in (1, -1):
            made += build_leg(px, side)
    return made


# ── Vertical mass: the towers ────────────────────────────────────────
# User, 2026-08-12: "can we make it taller — Nostromo had vertically
# massive pipes or something — not sure what for." They are right, and
# the first cut of this model was the wrong way round: at 49 m she stood
# LOWER than the kit-bash she replaces. What the reference has and she
# did not is a stern that keeps going up — refinery towers, stacks and
# pipe banks standing clear of the deck (docs/reference/ship/
# exterior-refinery-towers). What they are for is the honest answer to
# their question: she is a tug that hauls a refinery, and this is the
# plant. It also gives the profile a second peak, so the eye travels
# bow → castle → dome → towers instead of stopping at the first mass.

TOWER_TOP = 66.0


def build_towers():
    made = []
    for i, (tx, hw, top) in enumerate(((88.0, 6.2, 62.0), (108.0, 6.8, TOWER_TOP))):
        for s in (1, -1):
            ty = s * 10.6
            # Lofted lying down along its own +X and then stood up, the
            # same way the dome and the pylons are built. The first cut
            # ran it along the ship's X and used Z for height, which made
            # it a two-metre slab pretending to be a tower — and put two
            # stations at an identical X, so the loft bridged a ring to
            # itself and left a zero-thickness prism for bevel to chew on.
            H = top - 45.0
            bm = bmesh.new()
            loft_run(bm, [
                (0.0, -hw - 0.9, hw + 0.9, -hw - 0.9, hw + 0.9, 0.7),   # skirt
                (2.8, -hw, hw, -hw, hw, 0.8),                           # knuckle
                (H - 6.0, -hw, hw, -hw, hw, 0.8),                       # shaft
                (H - 1.4, -hw * 0.94, hw * 0.94, -hw * 0.94, hw * 0.94, 0.8),
                (H, -hw * 0.8, hw * 0.8, -hw * 0.8, hw * 0.8, 0.6),     # cap
            ], panels=dict(cuts=3, fraction=0.38, depth=0.16, thickness=0.4,
                           min_area=1.5))
            place(bm, (tx, ty, 45.0), (0, -math.pi / 2, 0))
            made.append(to_object(bm, f"tower_{i}_{'s' if s > 0 else 'p'}",
                                  ("hull_dark", "rust")))

            # The pipe bank climbing the outboard face — the thing that
            # reads at two kilometres and says "plant", not "building".
            for j, (dy, dx, r) in enumerate(((1.14, -0.55, 1.05),
                                             (1.14, 0.55, 1.05),
                                             (0.92, -1.06, 0.72),
                                             (0.92, 1.06, 0.72))):
                made.append(tube(f"tower_pipe_{i}{j}_{'s' if s > 0 else 'p'}",
                                 "pipe_steel",
                                 (tx + dx * hw, ty + s * dy * hw, 44.0),
                                 (tx + dx * hw, ty + s * dy * hw, top + 3.4 - j * 0.9),
                                 r, r * 0.92, n=10))
            # Banding: a pipe with no collars is a drinking straw. Collars
            # ring the whole tower — hung on the outboard face they read
            # as shelving, which made the stacks look like scaffolding.
            for k in range(5):
                z = 47.0 + (top - 47.0) * (k + 0.5) / 5
                made.append(slab(f"tower_band_{i}{k}_{'s' if s > 0 else 'p'}",
                                 "metal_dark", (tx, ty, z),
                                 (hw * 2.24, hw * 2.24, 0.85), cham=0.2))

    # The gantry bridging the towers — a catwalk you could walk, which is
    # the whole trick for scale: something human-sized, sixty metres up.
    for s in (1, -1):
        made.append(slab(f"tower_gantry_{'s' if s > 0 else 'p'}", "metal_dark",
                         (98.0, s * 10.6, 56.4), (22.0, 3.4, 0.5), cham=0.15))
        for k in range(9):
            made.append(slab(f"tower_rail_{k}_{'s' if s > 0 else 'p'}",
                             "pipe_steel",
                             (88.0 + k * 2.5, s * 12.2, 57.5),
                             (0.28, 0.28, 2.2), cham=0.06))
        made.append(tube(f"tower_handrail_{'s' if s > 0 else 'p'}", "pipe_steel",
                         (87.0, s * 12.2, 58.6), (109.0, s * 12.2, 58.6),
                         0.22, 0.22, n=6))
    # And the mast above it all: her highest point, and where the strobe
    # will sit once lander.js re-seats the practicals off the new bbox.
    for s in (1, -1):
        made.append(tube(f"mast_{'s' if s > 0 else 'p'}", "pipe_steel",
                         (108.0, s * 10.6, TOWER_TOP),
                         (108.0, s * 10.6, TOWER_TOP + 8.5), 0.85, 0.30, n=8))
    return made


# ── Her name ─────────────────────────────────────────────────────────
# User, 2026-08-12: "SOLACE as the ship name should be in faded
# lettering — of awe-inspiring size." Eleven metres tall and forty-odd
# long, standing a handspan proud of the flank so the bake gives the
# edges their own wear. Faded is a paint job, and with no base-colour
# textures in this pipeline the honest version of faded is a material a
# shade off the hull rather than a decal pretending to be worn.

def build_name():
    made = []
    for s in (1, -1):
        cu = bpy.data.curves.new(f"name_{s}", "FONT")
        cu.body = "SOLACE"
        cu.size = 11.0
        cu.space_character = 1.25
        cu.extrude = 0.22
        cu.align_x = "CENTER"
        cu.align_y = "CENTER"
        ob = bpy.data.objects.new(f"hull_name_{'s' if s > 0 else 'p'}", cu)
        bpy.context.collection.objects.link(ob)
        # Lying in the flank, reading bow-to-stern on both sides.
        ob.location = (-35.0, s * (half_beam(-35.0) + 0.05), 22.4)
        ob.rotation_euler = (math.pi / 2, 0.0, 0.0 if s < 0 else math.pi)
        ob.data.materials.append(MATS["hull_stencil"])
        bpy.context.view_layer.objects.active = ob
        ob.select_set(True)
        bpy.ops.object.convert(target="MESH")
        ob.select_set(False)
        made.append(ob)
    return made


# ── Everything else that makes her look used ─────────────────────────
# Density is the art law (docs/SHIP.md): "incredible variety of textures
# and details… our quality is what will set this game apart." None of
# this changes her silhouette; all of it changes whether she survives
# being stood next to.

def build_bow_aerials():
    """Whisker antennae off the bow — silhouette law from the reference."""
    # They sweep outboard more than forward. The first cut aimed them
    # straight off the bow and put 43 m of thin antenna in front of her:
    # measured stem to stern she came out 299 m, and lander.js derives
    # collision from the model bbox, so the traveler would have bounced
    # off clear air forty metres ahead of the hull. Whiskers are allowed
    # to be the first thing you meet, not a bowsprit.
    made = []
    for s in (1, -1):
        for j, (x0, z0, dx, dy, dz) in enumerate((
                (-119.0, 27.4, -12.0, 15.0, 2.6),
                (-115.0, 24.0, -9.0, 12.5, -1.4),
                (-121.0, 29.6, -6.0, 7.0, 5.2))):
            made.append(tube(f"aerial_{j}_{'s' if s > 0 else 'p'}", "pipe_steel",
                             (x0, s * 4.0, z0),
                             (x0 + dx, s * (4.0 + dy), z0 + dz),
                             0.40, 0.05, n=6))
    return made


def build_ventral():
    """Belly: the ramp you walk down, and the ring you dock through."""
    made = []
    xr, zb = -18.0, belly_z(-18.0)
    made.append(slab("ramp", "hull_dark", (xr, 0, zb - 0.35),
                     (16.0, 9.0, 0.7), cham=0.2))
    made.append(slab("ramp_surround", "hull_light", (xr, 0, zb + 0.15),
                     (18.4, 11.2, 0.6), cham=0.25))
    for k in range(7):     # tread cleats — the ramp is walked, so it grips
        made.append(slab(f"ramp_cleat_{k}", "metal_dark",
                         (xr - 6.6 + k * 2.2, 0, zb - 0.75),
                         (0.35, 8.2, 0.22), cham=0.05))
    # Hazard banding at a moving part, per the school.
    for s in (1, -1):
        made.append(slab(f"ramp_hazard_{'s' if s > 0 else 'p'}",
                         "warning_yellow", (xr, s * 5.0, zb + 0.16),
                         (17.0, 1.1, 0.5), cham=0.1))

    cx = 26.0
    czb = belly_z(cx)
    made.append(tube("docking_ring", "metal_dark",
                     (cx, 0, czb + 0.3), (cx, 0, czb - 1.9), 5.4, 4.6, n=20))
    made.append(tube("docking_hatch", "panel_dark",
                     (cx, 0, czb - 0.2), (cx, 0, czb - 1.1), 4.2, 4.2, n=20))
    # Chin sensor cluster under the bow — she looks where she is going.
    made.append(slab("sensor_chin", ("panel_dark", "metal_dark"), (-104.0, 0, belly_z(-104.0) - 1.0),
                     (11.0, 9.0, 2.2), cham=0.5,
                     panels=dict(cuts=2, fraction=0.5, depth=0.25,
                                 thickness=0.3, min_area=0.5)))
    return made


def build_windows():
    """Apertures, all honest: they are where the deck plan says they are."""
    made = []
    # Corridor deadlights down both flanks, at the accommodation deck.
    for s in (1, -1):
        for k in range(14):
            x = -46.0 + k * 7.0
            made.append(slab(f"deadlight_{k}_{'s' if s > 0 else 'p'}",
                             "window_glow",
                             (x, s * (half_beam(x) + 0.10), 30.2),
                             (2.3, 0.5, 1.35), cham=0.12))
            made.append(slab(f"deadlight_rim_{k}_{'s' if s > 0 else 'p'}",
                             "metal_dark",
                             (x, s * (half_beam(x) + 0.05), 30.2),
                             (3.1, 0.4, 2.05), cham=0.15))
    # The mess porthole: round, warm, to port (docs/SHIP.md).
    made.append(tube("mess_porthole", "window_glow",
                     (-4.0, -(half_beam(-4.0) + 0.30), 31.0),
                     (-4.0, -(half_beam(-4.0) - 0.60), 31.0), 2.5, 2.5, n=18))
    made.append(tube("mess_porthole_rim", "metal_dark",
                     (-4.0, -(half_beam(-4.0) + 0.55), 31.0),
                     (-4.0, -(half_beam(-4.0) - 0.60), 31.0), 3.1, 3.0, n=18))
    # Spine clerestory — the corridor reads as lit from outside at night.
    for s in (1, -1):
        made.append(slab(f"spine_lights_{'s' if s > 0 else 'p'}", "window_glow",
                         (10.0, s * 12.62, 39.4), (64.0, 0.35, 1.1), cham=0.1))
    return made


def build_navlights():
    """Practicals as jewelry: port red, starboard green, and the flood."""
    made = []
    for s, mat in ((-1, "nav_red"), (1, "nav_green")):
        tag = 'p' if s < 0 else 's'
        for j, x in enumerate((-96.0, 6.0, 112.0)):
            hb = half_beam(x) if x < 120 else 19.0
            made.append(slab(f"nav_{j}_{tag}", mat,
                             (x, s * (hb + 0.35), 32.4), (2.0, 0.5, 1.1), cham=0.2))
            made.append(slab(f"nav_hood_{j}_{tag}", "metal_dark",
                             (x, s * (hb + 0.20), 32.9), (2.8, 0.9, 1.9), cham=0.3))
    # Chin floodlights, pooled on the pad after dark.
    for s in (1, -1):
        made.append(slab(f"floodlight_{'s' if s > 0 else 'p'}", "window_glow",
                         (-92.0, s * 7.5, belly_z(-92.0) - 0.5),
                         (3.2, 2.4, 0.7), cham=0.15))
        made.append(slab(f"floodlight_hood_{'s' if s > 0 else 'p'}", "metal_dark",
                         (-92.0, s * 7.5, belly_z(-92.0) - 0.05),
                         (3.9, 3.1, 1.3), cham=0.3))
    return made


def build_plumbing():
    """Pipe runs, tanks and vents — the working clutter of a hauler."""
    made = []
    # Fore-and-aft pipe runs tucked under the deck edge, both flanks.
    for s in (1, -1):
        tag = 'p' if s < 0 else 's'
        for j, (dz, r) in enumerate(((0.0, 0.95), (-2.1, 0.72), (-3.7, 0.55))):
            # Aft of the name only. Her name wants a clean field: run
            # forward and three pipes cross straight through the letters.
            for (x0, x1) in ((-6.0, 30.0), (30.0, 64.0)):
                y0 = s * (half_beam(x0) + r + 0.35)
                y1 = s * (half_beam(x1) + r + 0.35)
                made.append(tube(f"pipe_{j}_{x0:.0f}_{tag}", "pipe_steel",
                                 (x0, y0, 27.6 + dz), (x1, y1, 27.6 + dz),
                                 r, r, n=8))
            for k in range(4):     # hangers, so the run is carried
                x = -2.0 + k * 21.0
                made.append(slab(f"pipe_hanger_{j}{k}_{tag}", "metal_dark",
                                 (x, s * (half_beam(x) + 0.4), 27.6 + dz),
                                 (0.5, 1.6, r * 2.6), cham=0.1))
    # Deck tanks on the spine shoulders: cylinders lying fore-and-aft.
    for s in (1, -1):
        for j, (x, r, ln) in enumerate(((-30.0, 3.1, 13.0), (14.0, 3.1, 13.0),
                                        (46.0, 2.6, 9.0))):
            tag = 'p' if s < 0 else 's'
            made.append(tube(f"tank_{j}_{tag}", "tank_shell",
                             (x - ln / 2, s * 15.6, 35.6),
                             (x + ln / 2, s * 15.6, 35.6), r, r, n=14))
            for e, ex in ((0, x - ln / 2), (1, x + ln / 2)):
                made.append(tube(f"tank_cap_{j}{e}_{tag}", "metal_dark",
                                 (ex, s * 15.6, 35.6),
                                 (ex + (1.4 if e else -1.4), s * 15.6, 35.6),
                                 r * 0.98, r * 0.55, n=14))
            made.append(slab(f"tank_cradle_{j}_{tag}", "hull_dark",
                             (x, s * 15.6, 33.6), (ln * 0.8, r * 2.4, 2.6),
                             cham=0.3))
    # Louvred vents on the engine block flanks — where the heat goes.
    for s in (1, -1):
        tag = 'p' if s < 0 else 's'
        for j, x in enumerate((84.0, 98.0, 112.0)):
            bm = bmesh.new()
            coffer(bm, 0.0, -5.0, 5.0, -3.4, 3.4, cols=1, rows=5,
                   depth=1.6, rim=0.28)
            place(bm, (x, s * 20.45, 41.6), (0, 0, s * math.pi / 2))
            made.append(to_object(bm, f"vent_{j}_{tag}", "panel_dark"))
    return made


def build_deck_furniture():
    """Handrails, walkways and radiators: human-sized things, for scale."""
    made = []
    for s in (1, -1):
        tag = 'p' if s < 0 else 's'
        # A catwalk down the spine shoulder, stanchions every four metres.
        made.append(slab(f"catwalk_{tag}", "metal_dark",
                         (0.0, s * 13.6, 34.5), (108.0, 2.6, 0.35), cham=0.1))
        made.append(tube(f"catwalk_rail_{tag}", "pipe_steel",
                         (-54.0, s * 14.7, 35.9), (54.0, s * 14.7, 35.9),
                         0.16, 0.16, n=6))
        for k in range(27):
            made.append(slab(f"stanchion_{k}_{tag}", "pipe_steel",
                             (-54.0 + k * 4.0, s * 14.7, 35.2),
                             (0.2, 0.2, 1.5), cham=0.04))
        # Radiator panels standing off the engine block: thin, and edge-on
        # they nearly vanish, which is exactly how a radiator behaves.
        for j in range(2):
            made.append(slab(f"radiator_{j}_{tag}", ("hull_light", "panel_dark"),
                             (86.0 + j * 18.0, s * 22.6, 43.0),
                             (15.0, 0.8, 9.0), cham=0.14,
                             panels=dict(cuts=3, fraction=0.6, depth=0.08,
                                         thickness=0.35, min_area=0.5)))
            made.append(tube(f"radiator_arm_{j}_{tag}", "pipe_steel",
                             (86.0 + j * 18.0, s * 20.2, 43.0),
                             (86.0 + j * 18.0, s * 22.6, 43.0), 0.5, 0.4, n=8))
    # RCS quads at the corners — she trims herself in flight.
    for s in (1, -1):
        for j, (x, z) in enumerate(((-112.0, 29.0), (118.0, 40.0))):
            hb = half_beam(x) if x < 120 else 19.6
            made.append(slab(f"rcs_{j}_{'s' if s > 0 else 'p'}", ("metal_dark", "panel_dark"),
                             (x, s * (hb + 0.2), z), (3.4, 0.9, 3.4), cham=0.4,
                             panels=dict(cuts=1, fraction=1.0, depth=0.45,
                                         thickness=0.5, min_area=0.2)))
    return made


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    build_materials()
    build_hull()
    build_castle()
    build_bridge_glass()
    build_spine()
    build_observatory()
    build_engine_block()
    build_bells()
    build_outriggers()
    build_towers()
    build_gear()
    build_bow_aerials()
    build_ventral()
    build_windows()
    build_navlights()
    build_plumbing()
    build_deck_furniture()
    build_name()

    tris = 0
    for ob in bpy.data.objects:
        if ob.type == "MESH":
            ob.data.calc_loop_triangles()
            tris += len(ob.data.loop_triangles)
    print(f"model-solace: {len(bpy.data.objects)} objects, {tris} tris")

    if OUT_BLEND:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(OUT_BLEND))
    bpy.ops.export_scene.gltf(filepath=os.path.abspath(OUT_GLB),
                              export_format="GLB", export_yup=True)
    print(f"model-solace: -> {OUT_GLB}")


main()
