"""Audit the source building solids: are they closed, consistently oriented, free of degenerate faces?
Run: uv run python scripts/audit_buildings.py ch-lauterbrunnen"""
import json
import sys
from collections import Counter
from pathlib import Path

import numpy as np

from archworld.sites import SITES
from archworld.sources_ch import load_buildings

site = SITES[sys.argv[1]]
B = load_buildings(Path("data/raw") / site.id)
st = Counter()
tris_per, vols, open_edges_per = [], [], []
for b in B:
    T = []
    for face in b["faces"]:
        ring = np.asarray(face[0], float)
        if len(face) > 1:
            st["faces_with_holes"] += 1
        if np.array_equal(ring[0], ring[-1]):
            ring = ring[:-1]
        if len(ring) != 3:
            st["non_triangle_faces"] += 1
            continue
        T.append(ring)
    T = np.array(T)
    st["buildings"] += 1
    st["triangles"] += len(T)
    tris_per.append(len(T))
    area = 0.5 * np.linalg.norm(np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0]), axis=1)
    st["degenerate_tris(<1mm2)"] += int((area < 1e-6).sum())
    # welded topology at 1 mm
    keys = np.round(T.reshape(-1, 3) * 1000).astype(np.int64)
    _, inv = np.unique(keys, axis=0, return_inverse=True)
    idx = inv.reshape(-1, 3)
    edges = Counter()
    directed = Counter()
    for a, c, d in idx:
        for u, v in ((a, c), (c, d), (d, a)):
            if u == v:
                continue
            edges[(min(u, v), max(u, v))] += 1
            directed[(u, v)] += 1
    bad = sum(1 for n in edges.values() if n != 2)
    open_edges_per.append(bad)
    closed = bad == 0
    st["closed_solids"] += closed
    oriented = closed and all(n == 1 for n in directed.values())
    st["consistently_oriented"] += oriented
    c0 = T.mean((0, 1))
    vol = float(np.einsum("ij,ij->i", T[:, 0] - c0, np.cross(T[:, 1] - c0, T[:, 2] - c0)).sum() / 6)
    if oriented:
        vols.append(vol)
        st["outward(positive volume)"] += vol > 0
    dup = len(idx) - len({tuple(sorted(t)) for t in idx.tolist()})
    st["duplicate_tris"] += dup
tp = {"median": int(np.median(tris_per)), "p95": int(np.quantile(tris_per, 0.95)), "max": int(max(tris_per))}
out = {**st, "tris_per_building": tp,
       "buildings_with_open_edges": int(sum(1 for x in open_edges_per if x)),
       "volume_m3": {"median": round(float(np.median(vols)), 1)} if vols else {}}
print(json.dumps(out, indent=1))
