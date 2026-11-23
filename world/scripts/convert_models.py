"""Convert the fetched models (scripts/fetch_models.sh) to compact glb files for the viewer.

Run: uv run --python 3.12 --no-project --with trimesh --with fast-simplification --with numpy --with pillow \
         python scripts/convert_models.py data/models_src ../web/public/world/models

Go2: the MJCF body tree is kept as glTF nodes named after the bodies, so the viewer can turn the leg joints.
Local frames stay as in MuJoCo (x forward, y left, z up); one root node rotates the model to glTF's y-up, which
leaves +x as forward. Meshes are decimated to a total face budget; shapes and colours are otherwise unchanged.
These are visual models only: the sim's speed, battery and sensor figures are class numbers, not these products'.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import numpy as np
import trimesh
from PIL import Image

SRC, OUT = Path(sys.argv[1]), Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)
Y_UP = np.array([[1, 0, 0, 0], [0, 0, 1, 0], [0, -1, 0, 0], [0, 0, 0, 1]], float)  # (x, y, z) -> (x, z, -y)
GO2_FACES = 70_000


def vec(s: str | None, default):
    return np.array([float(v) for v in s.split()]) if s else np.array(default, float)


def pose(pos, quat=(1, 0, 0, 0)) -> np.ndarray:
    m = trimesh.transformations.quaternion_matrix(quat)  # w, x, y, z as in MJCF
    m[:3, 3] = pos
    return m


def go2() -> bytes:
    d = SRC / "menagerie" / "unitree_go2"
    root = ET.parse(d / "go2.xml").getroot()
    rgba = {m.get("name"): vec(m.get("rgba"), [1, 1, 1, 1]) for m in root.iter("material")}
    names = [Path(m.get("file")).stem for m in root.iter("mesh")]
    raw = {n: trimesh.load(d / "assets" / f"{n}.obj", force="mesh", process=True) for n in names}
    total = sum(len(m.faces) for m in raw.values())
    meshes = {}
    for n, m in raw.items():
        want = max(200, int(len(m.faces) * GO2_FACES / total))
        meshes[n] = m.simplify_quadric_decimation(face_count=want) if len(m.faces) > want else m
    scene = trimesh.Scene()
    scene.graph.update(frame_to="go2", frame_from=scene.graph.base_frame, matrix=Y_UP)
    count = 0

    def walk(el, parent):
        nonlocal count
        name = el.get("name")
        # the base sits at the origin; the viewer sets its height from the leg pose
        m = np.eye(4) if name == "base" else pose(vec(el.get("pos"), [0, 0, 0]), vec(el.get("quat"), [1, 0, 0, 0]))
        scene.graph.update(frame_to=name, frame_from=parent, matrix=m)
        for g in el.findall("geom"):
            if g.get("class") != "visual" or g.get("mesh") is None:
                continue
            mesh = meshes[g.get("mesh")].copy()
            c = rgba[g.get("material")]
            metal = g.get("material") == "metal"
            mesh.visual = trimesh.visual.TextureVisuals(material=trimesh.visual.material.PBRMaterial(
                name=g.get("material"), baseColorFactor=(np.clip(c, 0.03, 1) * 255).astype(np.uint8),
                metallicFactor=0.6 if metal else 0.1, roughnessFactor=0.35 if metal else 0.6))
            count += 1
            scene.add_geometry(mesh, node_name=f"{name}_v{count}", geom_name=f"{name}_{g.get('mesh')}_{count}",
                               parent_node_name=name, transform=pose(vec(g.get("pos"), [0, 0, 0])))
        for child in el.findall("body"):
            walk(child, name)

    walk(root.find("worldbody").find("body"), "go2")
    print("go2: faces", total, "->", sum(len(g.faces) for g in scene.geometry.values()), "parts", count)
    return scene.export(file_type="glb", include_normals=True)  # smooth shading; without normals viewers shade flat


def x2() -> bytes:
    d = SRC / "menagerie" / "skydio_x2"
    mesh = trimesh.load(d / "assets" / "X2_lowpoly.obj", force="mesh", process=False)
    tex = Image.open(d / "assets" / "X2_lowpoly_texture_SpinningProps_1024.png").convert("RGBA")
    mesh.visual = trimesh.visual.TextureVisuals(uv=mesh.visual.uv, material=trimesh.visual.material.PBRMaterial(
        name="x2", baseColorTexture=tex, metallicFactor=0.1, roughnessFactor=0.6, alphaMode="BLEND"))
    m = pose([0, 0, 0], [0, 0, 1, 1] / np.sqrt(2)) @ np.diag([0.01, 0.01, 0.01, 1.0])  # MJCF: scale 0.01, quat 0 0 1 1
    mesh.apply_transform(Y_UP @ m)
    print("x2: faces", len(mesh.faces), "size m", np.round(mesh.extents, 3).tolist())
    scene = trimesh.Scene()
    scene.add_geometry(mesh, node_name="x2", geom_name="x2")
    return scene.export(file_type="glb", include_normals=True)


files = {"go2.glb": go2(), "x2.glb": x2(), "man.glb": (SRC / "khronos" / "CesiumMan.glb").read_bytes()}
lic = OUT / "licenses"
lic.mkdir(exist_ok=True)
shutil.copyfile(SRC / "menagerie" / "unitree_go2" / "LICENSE", lic / "unitree_go2-BSD-3-Clause.txt")
shutil.copyfile(SRC / "menagerie" / "skydio_x2" / "LICENSE", lic / "skydio_x2-Apache-2.0.txt")
credits = {"note": "Visual models only. Sim performance figures are class assumptions, not these products' data.", "models": [
    {"file": "go2.glb", "name": "Unitree Go2", "licence": "BSD-3-Clause", "copyright": "(c) Unitree Robotics",
     "source": "google-deepmind/mujoco_menagerie unitree_go2", "changes": "meshes decimated, converted to glTF"},
    {"file": "x2.glb", "name": "Skydio X2", "licence": "Apache-2.0", "source": "google-deepmind/mujoco_menagerie skydio_x2",
     "changes": "converted to glTF"},
    {"file": "man.glb", "name": "CesiumMan", "licence": "CC BY 4.0", "copyright": "(c) 2017 Cesium",
     "source": "KhronosGroup/glTF-Sample-Assets", "changes": "file unchanged; the viewer replaces its texture with plain colours"},
]}
for name, data in files.items():
    (OUT / name).write_bytes(data)
    next(m for m in credits["models"] if m["file"] == name)["sha256"] = hashlib.sha256(data).hexdigest()
    print(name, round(len(data) / 1e6, 2), "MB")
(OUT / "CREDITS.json").write_text(json.dumps(credits, indent=1) + "\n")
