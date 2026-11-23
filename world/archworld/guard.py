"""Raw-data access by purpose. Layers that serve as hidden ground truth cannot be opened for deduction.

Milestone 1 uses swissBUILDINGS3D as the measured building layer ("world"). Milestone 2's deduction engine rebuilds
buildings from OSM-level facts and is scored against it ("score"); it must never read it while deducing.
"""

from __future__ import annotations

from pathlib import Path

TRUTH_LAYERS = frozenset({"buildings3d", "lidar", "dsm"})  # the surface model carries roof heights too
PURPOSES = frozenset({"world", "deduce", "score"})


class TruthLeak(PermissionError):
    pass


def raw_path(raw: Path, layer: str, purpose: str) -> Path:
    if purpose not in PURPOSES:
        raise ValueError(f"unknown purpose {purpose!r}")
    if purpose == "deduce" and layer in TRUTH_LAYERS:
        raise TruthLeak(f"{layer} is held-out truth and cannot be read for deduction")
    return Path(raw) / layer
