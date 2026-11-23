"""Finish the NASA-traced F-16 in Blender and export a GLB for the app.

    blender -b -P scripts/blender/f16_finish.py -- in.obj out.glb

Geometry is NOT reshaped here: the proportions are NASA's (lib/aero/f16shape.ts, traced from TP-1538 Fig. 2). Blender
welds each part, smooths the lofted fuselage and canopy (one level of subdivision, edges kept sharp by angle on the
flat surfaces), assigns materials and exports glTF (Y up). It then prints the bounding box so the published length
(15.09 m) and span over the launchers (9.45 m) can be checked.
"""
import sys

import bpy

args = sys.argv[sys.argv.index("--") + 1 :]
src, dst = args[0], args[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.obj_import(filepath=src, forward_axis="Y", up_axis="Z")


def material(name, rgb, metal, rough, alpha=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*rgb, 1.0)
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    if alpha < 1.0:
        b.inputs["Alpha"].default_value = alpha
    return m


skin = material("F16 skin", (0.50, 0.54, 0.58), 0.3, 0.45)
glass = material("F16 canopy", (0.10, 0.12, 0.14), 0.8, 0.08)
rail = material("F16 launcher", (0.32, 0.34, 0.36), 0.5, 0.4)
smooth_parts = {"fuselage", "canopy"}
for ob in list(bpy.context.scene.objects):
    if ob.type != "MESH":
        continue
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.remove_doubles(threshold=1e-4)
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    if ob.name in smooth_parts:
        mod = ob.modifiers.new("smooth", "SUBSURF")
        mod.levels = 1
        mod.render_levels = 1
        bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.ops.object.shade_smooth_by_angle(angle=0.6)
    ob.data.materials.clear()
    ob.data.materials.append(glass if ob.name == "canopy" else rail if ob.name.startswith("launcher") else skin)
    ob.select_set(False)

lo = [min(v.co[k] for ob in bpy.context.scene.objects if ob.type == "MESH" for v in ob.data.vertices) for k in range(3)]
hi = [max(v.co[k] for ob in bpy.context.scene.objects if ob.type == "MESH" for v in ob.data.vertices) for k in range(3)]
tris = sum(len(p.vertices) - 2 for ob in bpy.context.scene.objects if ob.type == "MESH" for p in ob.data.polygons)
print(f"F16 bounds m: length {hi[0]-lo[0]:.3f} span {hi[1]-lo[1]:.3f} height {hi[2]-lo[2]:.3f} triangles {tris}")
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", export_yup=True, export_apply=True, export_materials="EXPORT")
print("wrote", dst)
