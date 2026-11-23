"""Minimal deterministic glTF 2.0 binary writer (positions, indices, uv, normals, colours, feature ids, one texture)."""

from __future__ import annotations

import json
import struct
from dataclasses import dataclass, field

import numpy as np


@dataclass
class Mesh:
    positions: np.ndarray  # float32 (N, 3), glTF y-up
    indices: np.ndarray  # uint16 or uint32 (M,)
    uv: np.ndarray | None = None
    normals: np.ndarray | None = None
    colors: np.ndarray | None = None  # uint8 (N, 4), normalised
    feature_ids: np.ndarray | None = None  # float32 (N,)
    feature_count: int = 0
    texture_jpeg: bytes | None = None
    unlit: bool = False
    double_sided: bool = False
    base_color: tuple[float, float, float, float] = (1.0, 1.0, 1.0, 1.0)
    name: str = ""
    extras: dict = field(default_factory=dict)


def _pad(b: bytes, fill: bytes = b"\x00") -> bytes:
    return b + fill * ((4 - len(b) % 4) % 4)


def write(meshes: list[Mesh], extras: dict | None = None) -> bytes:
    views, accessors, buf = [], [], bytearray()
    images, textures, samplers, materials, gl_meshes, nodes = [], [], [], [], [], []
    ext_used: set[str] = set()

    def add_view(data: bytes, target: int | None = None) -> int:
        nonlocal buf
        off = len(buf)
        buf += _pad(data)
        v = {"buffer": 0, "byteOffset": off, "byteLength": len(data)}
        if target:
            v["target"] = target
        views.append(v)
        return len(views) - 1

    def add_acc(arr: np.ndarray, typ: str, comp: int, target: int | None, normalized=False, minmax=False) -> int:
        a = np.ascontiguousarray(arr)
        acc = {"bufferView": add_view(a.tobytes(), target), "componentType": comp, "count": int(a.shape[0]),
               "type": typ}
        if normalized:
            acc["normalized"] = True
        if minmax:
            acc["min"] = [float(v) for v in a.min(axis=0)]
            acc["max"] = [float(v) for v in a.max(axis=0)]
        accessors.append(acc)
        return len(accessors) - 1

    for m in meshes:
        attrs = {"POSITION": add_acc(m.positions.astype(np.float32), "VEC3", 5126, 34962, minmax=True)}
        if m.normals is not None:
            attrs["NORMAL"] = add_acc(m.normals.astype(np.float32), "VEC3", 5126, 34962)
        if m.uv is not None:
            attrs["TEXCOORD_0"] = add_acc(m.uv.astype(np.float32), "VEC2", 5126, 34962)
        if m.colors is not None:
            attrs["COLOR_0"] = add_acc(m.colors.astype(np.uint8), "VEC4", 5121, 34962, normalized=True)
        prim_ext = {}
        if m.feature_ids is not None:
            attrs["_FEATURE_ID_0"] = add_acc(m.feature_ids.astype(np.float32), "SCALAR", 5126, 34962)
            prim_ext["EXT_mesh_features"] = {"featureIds": [{"featureCount": int(m.feature_count), "attribute": 0}]}
            ext_used.add("EXT_mesh_features")
        comp = 5123 if m.indices.dtype == np.uint16 else 5125
        ind = add_acc(m.indices.reshape(-1, 1), "SCALAR", comp, 34963)
        mat: dict = {"pbrMetallicRoughness": {"baseColorFactor": list(m.base_color), "metallicFactor": 0.0,
                                              "roughnessFactor": 1.0}}
        if m.double_sided:
            mat["doubleSided"] = True
        if m.texture_jpeg is not None:
            images.append({"bufferView": add_view(m.texture_jpeg), "mimeType": "image/jpeg"})
            if not samplers:
                samplers.append({"magFilter": 9729, "minFilter": 9987, "wrapS": 33071, "wrapT": 33071})
            textures.append({"source": len(images) - 1, "sampler": 0})
            mat["pbrMetallicRoughness"]["baseColorTexture"] = {"index": len(textures) - 1}
        if m.unlit:
            mat["extensions"] = {"KHR_materials_unlit": {}}
            ext_used.add("KHR_materials_unlit")
        materials.append(mat)
        prim = {"attributes": attrs, "indices": ind, "material": len(materials) - 1, "mode": 4}
        if prim_ext:
            prim["extensions"] = prim_ext
        gl_meshes.append({"name": m.name, "primitives": [prim]} | ({"extras": m.extras} if m.extras else {}))
        nodes.append({"mesh": len(gl_meshes) - 1})

    doc: dict = {
        "asset": {"version": "2.0", "generator": "archworld 0.1"},
        "scene": 0,
        "scenes": [{"nodes": list(range(len(nodes)))}],
        "nodes": nodes,
        "meshes": gl_meshes,
        "materials": materials,
        "accessors": accessors,
        "bufferViews": views,
        "buffers": [{"byteLength": len(buf)}],
    }
    if images:
        doc |= {"images": images, "textures": textures, "samplers": samplers}
    if ext_used:
        doc["extensionsUsed"] = sorted(ext_used)
    if extras:
        doc["asset"]["extras"] = extras
    js = _pad(json.dumps(doc, sort_keys=True, separators=(",", ":")).encode(), b" ")
    bb = _pad(bytes(buf))
    total = 12 + 8 + len(js) + 8 + len(bb)
    return (struct.pack("<4sII", b"glTF", 2, total) + struct.pack("<I4s", len(js), b"JSON") + js
            + struct.pack("<I4s", len(bb), b"BIN\x00") + bb)
