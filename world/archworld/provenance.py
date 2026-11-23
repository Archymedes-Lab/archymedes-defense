"""Per-feature provenance. Every value in the world says where it came from and how much to trust it.

Methods are ranked: measured > tagged > inferred > default > synthetic. A lower-ranked value never replaces a
higher-ranked one, and each method has a confidence cap, so a deduced value can never claim to be as good as a
measured one.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import asdict, dataclass
from typing import Any

SWISSTOPO = "swisstopo-OGD"  # free use with attribution "(c) swisstopo"
ODBL = "ODbL-1.0"  # (c) OpenStreetMap contributors; share-alike, so kept in separate files
USGS_PD = "USGS-public-domain"

METHODS = ("measured", "tagged", "inferred", "default", "synthetic")
RANK = {"measured": 3, "tagged": 2, "inferred": 1, "default": 0, "synthetic": -1}
# "synthetic" = placed by us (the warehouse compound): not a claim about the real place, so confidence 0
CAP = {"measured": 1.0, "tagged": 0.9, "inferred": 0.7, "default": 0.4, "synthetic": 0.0}


class ProvenanceError(ValueError):
    pass


@dataclass(frozen=True)
class Record:
    value: Any
    source: str
    licence: str
    method: str
    confidence: float

    def __post_init__(self) -> None:
        if not isinstance(self.source, str) or not self.source:
            raise ProvenanceError("source required")
        if not isinstance(self.licence, str) or not self.licence:
            raise ProvenanceError("licence required")
        if self.method not in RANK:
            raise ProvenanceError(f"unknown method {self.method!r}")
        c = self.confidence
        if not isinstance(c, int | float) or not 0.0 <= c <= CAP[self.method]:
            raise ProvenanceError(f"confidence {c!r} outside [0, {CAP[self.method]}] for {self.method}")

    def dict(self) -> dict:
        return asdict(self)


class Ledger:
    """Key -> Record, refusing downgrades."""

    def __init__(self) -> None:
        self._d: dict[str, Record] = {}
        self._layer: dict[str, str] = {}

    def put(self, key: str, rec: Record, layer: str = "") -> None:
        old = self._d.get(key)
        if old is not None and RANK[rec.method] < RANK[old.method]:
            raise ProvenanceError(f"{key}: {rec.method} cannot replace {old.method}")
        self._d[key] = rec
        if layer:
            self._layer[key] = layer

    def get(self, key: str) -> Record:
        return self._d[key]

    def coverage(self) -> dict[str, dict[str, int]]:
        out: dict[str, Counter] = defaultdict(Counter)
        for k, r in self._d.items():
            out[self._layer.get(k, "")][r.method] += 1
        return {layer: dict(sorted(c.items())) for layer, c in sorted(out.items())}
