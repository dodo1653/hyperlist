# HYPERLIST's coin image, part 1: a thick glossy coin in Hyperliquid mint with the HYPERLIST mark (three bars and a
# dot) raised on its face in deep green enamel, a raised rim and a reeded edge. Rendered on a transparent film;
# art/compose.py puts it on the background.
# blender -b --factory-startup --python art/coin.py -- <out.png> [samples] [res] [yaw_deg] [pitch_deg]
import bpy, bmesh, math, sys, os

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = os.path.abspath(argv[0]) if argv else os.path.abspath("coin_raw.png")
SAMPLES = int(argv[1]) if len(argv) > 1 else 256
RES = int(argv[2]) if len(argv) > 2 else 1400
YAW = math.radians(float(argv[3])) if len(argv) > 3 else math.radians(-24)
PITCH = math.radians(float(argv[4])) if len(argv) > 4 else math.radians(10)
for o in list(bpy.data.objects): bpy.data.objects.remove(o)
sc = bpy.context.scene

def srgb(h):
    h = h.lstrip("#"); c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)
def P(m): return next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
def setin(p, names, v):
    for n in names:
        if n in p.inputs: p.inputs[n].default_value = v; return
def mat(name, hexcol, rough, coat=0.0, metal=0.0, spec=0.5):
    m = bpy.data.materials.new(name); m.use_nodes = True; p = P(m)
    p.inputs["Base Color"].default_value = (*srgb(hexcol), 1); p.inputs["Roughness"].default_value = rough; p.inputs["Metallic"].default_value = metal
    setin(p, ["Coat Weight", "Clearcoat"], coat); setin(p, ["Coat Roughness", "Clearcoat Roughness"], 0.06); setin(p, ["Specular IOR Level", "Specular"], spec)
    return m

# ---- materials
FACE = mat("face", "#86f7dc", 0.3, coat=0.9)
# a faint guilloché: concentric rings in the face's bump, so the flat mint reads as struck metal under the coat
nt = FACE.node_tree; tc = nt.nodes.new("ShaderNodeTexCoord"); wv = nt.nodes.new("ShaderNodeTexWave")
wv.wave_type = "RINGS"; wv.inputs["Scale"].default_value = 9; wv.inputs["Distortion"].default_value = 0.6; wv.inputs["Detail"].default_value = 2
bump = nt.nodes.new("ShaderNodeBump"); bump.inputs["Strength"].default_value = 0.05; bump.inputs["Distance"].default_value = 0.002
nt.links.new(tc.outputs["Object"], wv.inputs["Vector"]); nt.links.new(wv.outputs["Fac"], bump.inputs["Height"]); nt.links.new(bump.outputs["Normal"], P(FACE).inputs["Normal"])
EDGE = mat("edge", "#3fcfae", 0.26, coat=0.7)
# the reeding: fine grooves around the edge (bump from the angle around the coin's axis)
nt = EDGE.node_tree; tc = nt.nodes.new("ShaderNodeTexCoord"); sep = nt.nodes.new("ShaderNodeSeparateXYZ")
at = nt.nodes.new("ShaderNodeMath"); at.operation = "ARCTAN2"; mul = nt.nodes.new("ShaderNodeMath"); mul.operation = "MULTIPLY"; mul.inputs[1].default_value = 110
sn = nt.nodes.new("ShaderNodeMath"); sn.operation = "SINE"; bump = nt.nodes.new("ShaderNodeBump"); bump.inputs["Strength"].default_value = 0.55; bump.inputs["Distance"].default_value = 0.01
nt.links.new(tc.outputs["Object"], sep.inputs["Vector"]); nt.links.new(sep.outputs["Y"], at.inputs[0]); nt.links.new(sep.outputs["X"], at.inputs[1])
nt.links.new(at.outputs["Value"], mul.inputs[0]); nt.links.new(mul.outputs["Value"], sn.inputs[0]); nt.links.new(sn.outputs["Value"], bump.inputs["Height"]); nt.links.new(bump.outputs["Normal"], P(EDGE).inputs["Normal"])
RIM = mat("rim", "#c4fff2", 0.2, coat=1.0)
INK = mat("ink", "#042a23", 0.16, coat=1.0, spec=0.6)

# ---- the coin: a bevelled disc, faces and edge on separate materials
TH = 0.24
bpy.ops.mesh.primitive_cylinder_add(vertices=256, radius=1.0, depth=TH)
coin = bpy.context.active_object; coin.data.materials.append(FACE); coin.data.materials.append(EDGE)
for poly in coin.data.polygons: poly.material_index = 0 if abs(poly.normal.z) > 0.5 else 1
bv = coin.modifiers.new("bevel", "BEVEL"); bv.width = 0.035; bv.segments = 6; bv.limit_method = "ANGLE"; bv.harden_normals = False
bpy.ops.object.shade_smooth()
# a raised rim on both faces
for s in (1, -1):
    bpy.ops.mesh.primitive_torus_add(major_radius=0.875, minor_radius=0.04, major_segments=256, minor_segments=24, location=(0, 0, s * TH / 2))
    r = bpy.context.active_object; r.scale.z = 0.7; r.data.materials.append(RIM); bpy.ops.object.shade_smooth(); r.parent = coin

# ---- the mark on the front face (from the logo's 32-unit grid): three rounded bars and a dot
K = 0.071; FZ = TH / 2; H = 0.075
def bar(x1, x2, y, w=2.6, side=1):
    # a capsule outline (two half circles), filled and given depth, then softened at its edges
    r, half, cx, cy = w * K / 2, (x2 - x1) * K / 2, side * ((x1 + x2) / 2 - 16) * K, -(y - 16) * K
    pts = [(cx + half + r * math.cos(a), cy + r * math.sin(a)) for a in [math.radians(-90 + i * 180 / 32) for i in range(33)]]
    pts += [(cx - half + r * math.cos(a), cy + r * math.sin(a)) for a in [math.radians(90 + i * 180 / 32) for i in range(33)]]
    me = bpy.data.meshes.new("bar"); bm = bmesh.new()
    vs = [bm.verts.new((x, y_, side * (FZ - 0.01))) for x, y_ in pts]; f = bm.faces.new(vs)
    ex = bmesh.ops.extrude_face_region(bm, geom=[f]); bmesh.ops.translate(bm, vec=(0, 0, side * H), verts=[v for v in ex["geom"] if isinstance(v, bmesh.types.BMVert)])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces); bm.to_mesh(me); bm.free()
    b = bpy.data.objects.new("bar", me); sc.collection.objects.link(b)
    m2 = b.modifiers.new("soft", "BEVEL"); m2.width = 0.014; m2.segments = 5; m2.limit_method = "ANGLE"
    b.data.materials.append(INK); b.data.polygons.foreach_set("use_smooth", [True] * len(b.data.polygons)); b.parent = coin
# the front always; the back too for the film (the coin turns), mirrored so it reads from behind
for side in ((1, -1) if OUT.endswith(".glb") else (1,)):
    bar(9, 23, 10.5, side=side); bar(9, 19, 16, side=side); bar(9, 15, 21.5, side=side)
    bpy.ops.mesh.primitive_cylinder_add(vertices=96, radius=2.3 * K, depth=H, location=(side * (23 - 16) * K, -(21.5 - 16) * K, side * (FZ - 0.01 + H / 2)))
    d = bpy.context.active_object; m = d.modifiers.new("soft", "BEVEL"); m.width = 0.014; m.segments = 4; m.limit_method = "ANGLE"
    d.data.materials.append(INK); bpy.ops.object.shade_smooth(); d.parent = coin

if OUT.endswith(".glb"):                                # the same coin for the film (three.js): face along +Z here, +Y in glTF
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_apply=True, use_selection=True)
    print("wrote", OUT); sys.exit(0)
# face the camera (camera looks down -Y), then turn it a little so the edge shows
coin.rotation_euler = (math.radians(90) + PITCH, 0, YAW)

# ---- light: big soft key, a cool rim from behind, a low fill; a dim studio world for the reflections
world = bpy.data.worlds.new("w"); sc.world = world; world.use_nodes = True
bgn = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND"); bgn.inputs["Color"].default_value = (*srgb("#0d2a24"), 1); bgn.inputs["Strength"].default_value = 0.6
def area(loc, rot, size, power, col):
    bpy.ops.object.light_add(type="AREA", location=loc, rotation=rot); l = bpy.context.active_object
    l.data.size = size; l.data.energy = power; l.data.color = srgb(col)
    return l
def look(o, target=(0, 0, 0)):
    import mathutils
    d = mathutils.Vector(target) - o.location; o.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
k = area((-3.2, -4.0, 3.0), (0, 0, 0), 4.0, 900, "#ffffff"); look(k)
r = area((3.5, 2.5, 2.2), (0, 0, 0), 2.5, 700, "#a8fff0"); look(r)
f = area((2.5, -4.5, -2.0), (0, 0, 0), 3.0, 220, "#d9fff7"); look(f)
t = area((0, -1.0, 4.5), (0, 0, 0), 2.0, 260, "#ffffff"); look(t)

bpy.ops.object.camera_add(location=(0, -7.2, 0)); cam = bpy.context.active_object; cam.rotation_euler = (math.radians(90), 0, 0)
cam.data.lens = 96; sc.camera = cam

sc.render.engine = "CYCLES"; sc.cycles.samples = SAMPLES; sc.cycles.use_denoising = True
try: sc.cycles.device = "GPU"
except Exception: pass
sc.render.resolution_x = sc.render.resolution_y = RES; sc.render.film_transparent = True
sc.view_settings.view_transform = "Standard"; sc.view_settings.exposure = -0.35
sc.view_settings.look = "None"
sc.render.image_settings.file_format = "PNG"; sc.render.image_settings.color_mode = "RGBA"; sc.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print("wrote", OUT)
