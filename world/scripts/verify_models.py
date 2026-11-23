"""Independent check of a built world: parse every published file from disk and verify structure and geometry.

It shares no geometry code with the builder (own glb parser, own maths), so a builder bug cannot hide itself.
Run: uv run python scripts/verify_models.py data/out/ch-lauterbrunnen   (exit 1 on any failure)
"""

from __future__ import annotations

import io
import json
import struct
import sys
from pathlib import Path

import numpy as np
from PIL import Image

OUT = Path(sys.argv[1])
fails: list[str] = []
facts: dict[str, object] = {}
DT = {5121: np.uint8, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


def check(ok: bool, msg: str) -> None:
    if not ok:
        fails.append(msg)


def parse_glb(path: Path) -> list[dict]:
    raw = path.read_bytes()
    magic, ver, total = struct.unpack("<4sII", raw[:12])
    check(magic == b"glTF" and ver == 2 and total == len(raw) and total % 4 == 0, f"{path.name}: header")
    jl, jt = struct.unpack("<I4s", raw[12:20])
    doc = json.loads(raw[20:20 + jl])
    bl, bt = struct.unpack("<I4s", raw[20 + jl:28 + jl])
    check(jt == b"JSON" and bt == b"BIN\x00" and 28 + jl + bl == total, f"{path.name}: chunks")
    buf = raw[28 + jl:]
    check(doc["buffers"][0]["byteLength"] <= len(buf), f"{path.name}: buffer length")

    def acc(i: int) -> np.ndarray:
        a = doc["accessors"][i]
        v = doc["bufferViews"][a["bufferView"]]
        n = NC[a["type"]]
        dt = DT[a["componentType"]]
        size = a["count"] * n * np.dtype(dt).itemsize
        check(size <= v["byteLength"] and v["byteOffset"] % 4 == 0, f"{path.name}: accessor {i} bounds/alignment")
        arr = np.frombuffer(buf, dt, a["count"] * n, v["byteOffset"]).reshape(a["count"], n)
        if "min" in a:
            check(np.allclose(arr.min(0), a["min"]) and np.allclose(arr.max(0), a["max"]), f"{path.name}: min/max")
        return arr

    meshes = []
    for m in doc["meshes"]:
        pr = m["primitives"][0]
        at = pr["attributes"]
        d = {"extras": m.get("extras", {}), "name": m["name"], "pos": acc(at["POSITION"]).astype(np.float64), "idx": acc(pr["indices"]).ravel().astype(np.int64),
             "attrs": sorted(at), "material": doc["materials"][pr["material"]]}
        for k, key in (("uv", "TEXCOORD_0"), ("col", "COLOR_0"), ("fid", "_FEATURE_ID_0")):
            if key in at:
                d[k] = acc(at[key])
                check(len(d[k]) == len(d["pos"]), f"{path.name}/{m['name']}: {key} count")
        check(np.isfinite(d["pos"]).all(), f"{path.name}/{m['name']}: non-finite positions")
        check(len(d["idx"]) % 3 == 0 and d["idx"].min() >= 0 and d["idx"].max() < len(d["pos"]), f"{path.name}/{m['name']}: indices")
        check(len(np.unique(d["idx"])) == len(d["pos"]), f"{path.name}/{m['name']}: unreferenced vertices")
        tex = d["material"]["pbrMetallicRoughness"].get("baseColorTexture")
        if tex is not None:
            v = doc["bufferViews"][doc["images"][doc["textures"][tex["index"]]["source"]]["bufferView"]]
            img = Image.open(io.BytesIO(buf[v["byteOffset"]:v["byteOffset"] + v["byteLength"]]))
            img.load()
            d["tex"] = img.size
            check(img.format == "JPEG" and img.size[0] == img.size[1] and img.size[0] & (img.size[0] - 1) == 0,
                  f"{path.name}: texture {img.format} {img.size} (want square power-of-two JPEG)")
        # y-up (e, u, -n) -> ENU
        d["enu"] = np.column_stack([d["pos"][:, 0], -d["pos"][:, 2], d["pos"][:, 1]])
        meshes.append(d)
    return meshes


def tri_normals(p: np.ndarray, idx: np.ndarray) -> np.ndarray:
    t = p[idx.reshape(-1, 3)]
    return np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 0])


def solid(p: np.ndarray, tri: np.ndarray) -> tuple[bool, float]:
    """Closed and oriented: every directed edge once, with its reverse. Volume sign: + outward."""
    keys = np.round(p * 1000).astype(np.int64)
    _, inv = np.unique(keys, axis=0, return_inverse=True)
    t = inv[tri]
    t = t[(t[:, 0] != t[:, 1]) & (t[:, 1] != t[:, 2]) & (t[:, 2] != t[:, 0])]
    e = np.concatenate([t[:, [0, 1]], t[:, [1, 2]], t[:, [2, 0]]])
    n = int(inv.max()) + 1
    f, r = np.sort(e[:, 0] * n + e[:, 1]), np.sort(e[:, 1] * n + e[:, 0])
    closed = len(f) > 0 and len(np.unique(f)) == len(f) and np.array_equal(f, r)
    q = p[tri]
    c = q.mean((0, 1))
    return bool(closed), float(np.einsum("ij,ij->i", q[:, 0] - c, np.cross(q[:, 1] - c, q[:, 2] - c)).sum() / 6)


def in_box(pts: np.ndarray, box: list[float], tol: float = 0.02) -> bool:
    c = np.array(box[:3])
    half = np.array([box[3], box[7], box[11]])
    return bool((np.abs(pts - c) <= half + tol).all())


ts = json.loads((OUT / "tileset.json").read_text())
report = json.loads((OUT / "report.json").read_text())
feats = json.loads((OUT / "buildings.json").read_text())["features"]
root = ts["root"]
step, tile, size = report["grid"]["leaf_step_m"], report["site"]["tile_m"], report["site"]["size_m"]
n = round(tile / step)
check(ts["asset"]["version"] == "1.1" and root["refine"] == "REPLACE", "tileset: version/refine")
check(ts["geometricError"] > root["geometricError"] > 0, "tileset: geometric error order")
M = np.array(root["transform"]).reshape(4, 4).T
R = M[:3, :3]
check(np.allclose(R @ R.T, np.eye(3), atol=1e-12) and np.linalg.det(R) > 0, "root transform: not a proper rotation")
up = M[:3, 3] / np.linalg.norm(M[:3, 3])
check(float(R[:, 2] @ up) > 0.99999, "root transform: ENU up is not the local vertical")  # geocentric vs geodetic < 0.2 deg
check(abs(R[2, 0]) < 1e-12, "root transform: ENU east is not horizontal (no z component in ECEF)")

leaf, mids, seen_fids, tri_total, vert_total, skirt_tris = {}, {}, {}, 0, 0, 0
mid_fids: dict[str, tuple] = {}
crack_worst = 0.0
for node in root["children"]:
    T = np.array(node["transform"]).reshape(4, 4).T
    check(np.allclose(T[:3, :3], np.eye(3)), f"{node['content']['uri']}: transform must be a translation")
    check(len(node.get("children", [])) == 1 and "transform" not in node["children"][0], f"{node['content']['uri']}: one fine child, no transform")
    fine_node = node["children"][0]
    check(root["geometricError"] > node["geometricError"] > fine_node["geometricError"] == 0, f"{node['content']['uri']}: GE order")
    per_level = {}
    for level, ch in (("mid", node), ("fine", fine_node)):
        path = OUT / ch["content"]["uri"]
        check(path.exists(), f"{path.name}: missing")
        ms = parse_glb(path)
        name = path.stem.removeprefix("m_")
        for m in ms:
            check(in_box(m["enu"], ch["boundingVolume"]["box"]), f"{path.stem}/{m['name']}: content outside its bounding box")
            m["world"] = m["enu"] + T[:3, 3]
            if level == "fine":
                tri_total += len(m["idx"]) // 3
                vert_total += len(m["pos"])
        ter = next(m for m in ms if m["name"] == "terrain")
        rows, cols = ter["extras"]["grid"]
        nv, nt = rows * cols, 6 * (rows - 1) * (cols - 1)
        want_n = n if level == "fine" else round(tile / report["lod"]["mid_step_m"])
        check(rows == cols == want_n + 1, f"{path.stem}: grid {rows}x{cols}, want {want_n + 1}")
        perim = 4 * (rows - 1)
        check(len(ter["pos"]) == nv + perim and len(ter["idx"]) == nt + 6 * perim, f"{path.stem}: terrain + skirt size")
        check("KHR_materials_unlit" in ter["material"].get("extensions", {}), f"{path.stem}: terrain must be unlit")
        check(ter["uv"].min() >= -1e-6 and ter["uv"].max() <= 1 + 1e-6, f"{path.stem}: uv outside [0, 1]")
        nz = tri_normals(ter["world"], ter["idx"][:nt])[:, 2]
        check((nz > 0).all(), f"{path.stem}: {int((nz <= 0).sum())} terrain triangles not facing up")
        g = ter["world"][:nv].reshape(rows, cols, 3)
        uvg = ter["uv"][:nv].reshape(rows, cols, 2)
        check(np.allclose(uvg[0, :, 1], 1, atol=1e-6) and np.allclose(uvg[-1, :, 1], 0, atol=1e-6)
              and np.allclose(uvg[:, 0, 0], 0, atol=1e-6) and np.allclose(uvg[:, -1, 0], 1, atol=1e-6), f"{path.stem}: uv corners")
        check((np.diff(g[:, :, 0], axis=1) > 0).all() and (np.diff(g[:, :, 1], axis=0) > 0).all(), f"{path.stem}: grid not monotone E/N")
        # skirt: vertical walls that face away from the tile centre and hang skirt_m below the edge
        sk = ter["idx"][nt:].reshape(-1, 3)
        skirt_tris += len(sk)
        sn = np.cross(ter["world"][sk[:, 1]] - ter["world"][sk[:, 0]], ter["world"][sk[:, 2]] - ter["world"][sk[:, 0]])
        mid_pt = ter["world"][sk].mean(1)
        centre2 = g[:, :, :2].mean((0, 1))
        flat = np.abs(sn[:, 2]) <= 2e-3 * np.linalg.norm(sn, axis=1) + 1e-9
        outw = np.einsum("ij,ij->i", sn[:, :2], mid_pt[:, :2] - centre2) > 0
        check(bool(flat.all()), f"{path.stem}: {int((~flat).sum())} skirt triangles not vertical")
        check(bool(outw.all()), f"{path.stem}: {int((~outw).sum())} skirt triangles facing inward")
        drop = ter["world"][nv:, 2]
        ring = np.concatenate([np.arange(cols - 1), (np.arange(rows - 1)) * cols + cols - 1,
                               (rows - 1) * cols + np.arange(cols - 1, 0, -1), np.arange(rows - 1, 0, -1) * cols])
        check(np.allclose(ter["world"][ring, 2] - drop, ter["extras"]["skirt_m"], atol=2e-3), f"{path.stem}: skirt depth != {ter['extras']['skirt_m']}")
        per_level[level] = (g, ter["extras"]["skirt_m"])
        for m in ms:
            if m["name"] != "buildings":
                continue
            check("NORMAL" not in m["attrs"] and not m["material"].get("doubleSided", False), f"{path.stem}: buildings should be single-sided, flat")
            fid = np.round(m["fid"].ravel()).astype(int)
            tri = m["idx"].reshape(-1, 3)
            check((fid[tri] == fid[tri[:, :1]]).all(), f"{path.stem}: a triangle spans two buildings")
            if level == "mid":
                mid_fids[name] = (len(tri), tuple(np.unique(fid)))
                continue
            check(mid_fids.get(name) == (len(tri), tuple(np.unique(fid))), f"{name}: mid and fine buildings differ")
            for f in np.unique(fid):
                check(0 <= f < len(feats) and feats[f]["tile"] == [int(x) for x in name.split("_")], f"{name}: feature {f} not in buildings.json for this tile")
                sel = tri[fid[tri[:, 0]] == f]
                zz = m["world"][np.unique(sel)][:, 2]
                seen_fids[int(f)] = solid(m["world"], sel) + (float(zz.max() - zz.min()),)
        if level == "fine":
            leaf[name] = ter
    # crack between the levels, measured from the files: fine border vs the mid border's straight segments
    (gf, skirt_f), (gm, skirt_m) = per_level["fine"], per_level["mid"]
    check(skirt_f == skirt_m, f"{name}: skirt depth differs between levels")
    step_ratio = (gf.shape[0] - 1) // (gm.shape[0] - 1)
    crack = 0.0
    for ef, em in ((gf[0], gm[0]), (gf[-1], gm[-1]), (gf[:, 0], gm[:, 0]), (gf[:, -1], gm[:, -1])):
        t = np.arange(len(ef)) / step_ratio
        k = np.minimum(t.astype(int), len(em) - 2)
        interp = em[k, 2] + (em[k + 1, 2] - em[k, 2]) * (t - k)
        crack = max(crack, float(np.abs(ef[:, 2] - interp).max()))
    crack_worst = max(crack_worst, crack)
    check(skirt_f >= crack + 0.45, f"{name}: skirt {skirt_f} m does not cover the {crack:.2f} m crack")

# seams, straight from the files: neighbouring leaves must meet within 1 mm
seam = 0.0
for name, ter in leaf.items():
    i, j = (int(x) for x in name.split("_"))
    nv = (n + 1) ** 2  # grid vertices come first, skirt bottoms after
    g = ter["world"][:nv].reshape(n + 1, n + 1, 3)
    for other, a, b in ((f"{i + 1}_{j}", g[:, -1], lambda h: h[:, 0]), (f"{i}_{j + 1}", g[-1, :], lambda h: h[0, :])):
        if other in leaf:
            seam = max(seam, float(np.abs(a - b(leaf[other]["world"][:nv].reshape(n + 1, n + 1, 3))).max()))
check(seam < 1e-3, f"seams: {seam * 1000:.3f} mm")
check(len(leaf) == round(size / tile) ** 2, "leaf count")

# buildings: every feature present exactly once in the leaves; closed, outward, height as recorded
check(sorted(seen_fids) == list(range(len(feats))), f"buildings in leaves {len(seen_fids)} vs records {len(feats)}")
gaps = {g["fid"]: g for g in report["buildings"]["gaps"]}
closed = sum(1 for c, _, _ in seen_fids.values() if c)
outward = sum(1 for c, v, _ in seen_fids.values() if c and v > 0)
check(outward == closed, f"{closed - outward} closed solids wound inward")
skirted = sum(1 for g in gaps.values() if g["skirted"])  # a skirt is an open collar, so these are not closed here
check(closed == len(feats) - skirted, f"closed {closed} != buildings {len(feats)} - skirted {skirted}")
check(report["buildings"]["closed_solids"] == len(feats), "builder: some source solids are not closed")
hbad = 0
for f, (_c, _v, h) in seen_fids.items():
    want = feats[f]["top_z"] - (gaps[f]["skirt_bottom"] if gaps[f]["skirted"] else feats[f]["base_z"])
    hbad += abs(h - want) > 0.05  # ENU up vs LN02 height over one building: millimetres
check(hbad == 0, f"{hbad} buildings whose model height differs from the record by > 5 cm")
vols = np.array([v for c, v, _ in seen_fids.values() if c])
foot = np.array([feats[f]["footprint"]["value"] for f, (c, _, _) in seen_fids.items() if c])
hh = np.array([feats[f]["height"]["value"] for f, (c, _, _) in seen_fids.items() if c])
ratio = vols / (foot * hh)  # a solid cannot exceed its footprint prism; pitched roofs give 0.5-1
check(bool((ratio <= 1.001).all() and (ratio > 0.2).all()), f"volume/prism ratio out of range: {ratio.min():.2f}-{ratio.max():.2f}")

# root: coarse terrain + the same buildings
rms = parse_glb(OUT / root["content"]["uri"])
rt = next(m for m in rms if m["name"] == "terrain-root")
check(in_box(np.concatenate([m["enu"] for m in rms]), root["boundingVolume"]["box"]), "root content outside root box")
for ch in root["children"]:
    b = np.array(ch["boundingVolume"]["box"])
    c = b[:3] + np.array(ch["transform"][12:15])  # the fine child shares this box and transform
    half = np.array([b[3], b[7], b[11]])
    check(in_box(np.array([c - half, c + half]), root["boundingVolume"]["box"]), f"{ch['content']['uri']}: box outside root box")
check((tri_normals(rt["enu"], rt["idx"])[:, 2] > 0).all(), "root terrain triangles not facing up")
rb = [m for m in rms if m["name"] == "buildings"]
if feats:
    check(len(rb) == 1 and len(np.unique(np.round(rb[0]["fid"]))) == len(feats), "root buildings != records")

# lines (ODbL file): inside the site, sane heights
lines = json.loads((OUT / "lines.json").read_text())
zs = np.concatenate([np.array(w["p"]).reshape(-1, 3) for w in lines["ways"]]) / 10
zmin, zmax = rt["enu"][:, 2].min(), rt["enu"][:, 2].max()
# the site is a square in the national grid, slightly rotated in ENU: test against the terrain's own outline
g0 = rt["enu"].reshape(round(len(rt["enu"]) ** 0.5), -1, 3)  # the root has no skirt
corners = np.array([g0[0, 0, :2], g0[0, -1, :2], g0[-1, -1, :2], g0[-1, 0, :2]])  # SW, SE, NE, NW: counter-clockwise
edge = np.roll(corners, -1, 0) - corners
inside = np.all([(edge[k, 0] * (zs[:, 1] - corners[k, 1]) - edge[k, 1] * (zs[:, 0] - corners[k, 0])) >= -1.0 * np.hypot(*edge[k])
                 for k in range(4)], axis=0)
check(bool(inside.all()), f"{int((~inside).sum())} line points more than 1 m outside the site")
facts["grid_rotation_deg"] = round(float(np.degrees(np.arctan2(edge[0, 1], edge[0, 0]))), 4)
check(bool((zs[:, 2] > zmin - 50).all() and (zs[:, 2] < zmax + 50).all()), "lines outside the terrain height range")

for rel, digest in report["digests"].items():
    import hashlib
    check(hashlib.sha256((OUT / rel).read_bytes()).hexdigest() == digest, f"{rel}: digest differs from report")

facts |= {"leaves": len(leaf), "leaf_triangles": tri_total, "leaf_vertices": vert_total, "terrain_grid": f"{n + 1}x{n + 1}",
         "texture": list(next(iter(leaf.values()))["tex"]), "root_texture": list(rt["tex"]), "seam_mm": round(seam * 1000, 4),
         "levels": "root > 16 mid > 16 fine", "skirt_triangles": skirt_tris, "worst_lod_crack_m": round(crack_worst, 2),
         "buildings": len(seen_fids), "closed": closed, "outward": outward, "skirted_open_collar": skirted,
         "volume_to_prism_ratio": {"min": round(float(ratio.min()), 2), "median": round(float(np.median(ratio)), 2),
                                   "max": round(float(ratio.max()), 2)},
         "line_points": int(len(zs)), "files_digest_checked": len(report["digests"]), "failures": fails}
print(json.dumps(facts, indent=1))
(OUT / "verify.json").write_text(json.dumps(facts, indent=1) + "\n")
sys.exit(1 if fails else 0)
