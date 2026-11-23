"""Exact statistics for yes/no drill results.

A drill result is k successes in n seeded runs. Operators read such results the way Sandia's tables do: as a
confidence statement, not a point estimate (40/40 only shows the rate is at least about 0.91 at 95 %). Measures run
on the same seeds, so two of them are compared run by run (exact McNemar test), and options that the runs cannot
tell apart are labelled tied rather than ranked.
"""
from __future__ import annotations

from math import comb


def _binom_cdf(k: int, n: int, p: float) -> float:
    if k < 0:
        return 0.0
    if k >= n:
        return 1.0
    return sum(comb(n, i) * p ** i * (1 - p) ** (n - i) for i in range(k + 1))


def _solve(f, lo: float = 0.0, hi: float = 1.0) -> float:
    """Root of an increasing function on [lo, hi] by bisection."""
    for _ in range(80):
        mid = (lo + hi) / 2
        if f(mid) < 0:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def clopper_pearson(k: int, n: int, conf: float = 0.95) -> tuple[float, float]:
    """Exact two-sided interval for a success rate from k successes in n runs."""
    if not 0 <= k <= n or n == 0:
        raise ValueError("need 0 <= k <= n and n > 0")
    a = (1 - conf) / 2
    lo = 0.0 if k == 0 else _solve(lambda p: (1 - _binom_cdf(k - 1, n, p)) - a)  # P(X >= k) rises with p
    hi = 1.0 if k == n else _solve(lambda p: a - _binom_cdf(k, n, p))  # P(X <= k) falls with p
    return lo, hi


def mcnemar(a: list[bool], b: list[bool]) -> float:
    """Exact two-sided McNemar p-value for paired yes/no runs (same seeds, two variants)."""
    if len(a) != len(b):
        raise ValueError("paired runs must have the same length")
    only_a = sum(x and not y for x, y in zip(a, b, strict=True))
    only_b = sum(y and not x for x, y in zip(a, b, strict=True))
    d = only_a + only_b
    if d == 0:
        return 1.0
    return min(1.0, 2 * _binom_cdf(min(only_a, only_b), d, 0.5))


def rate(runs: list[bool], conf: float = 0.95) -> dict:
    k, n = sum(runs), len(runs)
    lo, hi = clopper_pearson(k, n, conf)
    return {"k": k, "n": n, "share": round(k / n, 4), "lo": round(lo, 4), "hi": round(hi, 4)}


def tie_groups(runs: dict[str, list[bool]], alpha: float = 0.05) -> dict[str, int]:
    """Group options whose paired runs cannot be told apart. Options are taken best first; each joins the group
    of the best option it is not significantly different from, or starts a new group."""
    order = sorted(runs, key=lambda k: (-sum(runs[k]), k))
    group: dict[str, int] = {}
    leaders: list[str] = []
    for k in order:
        for g, lead in enumerate(leaders):
            if mcnemar(runs[k], runs[lead]) >= alpha:
                group[k] = g
                break
        else:
            group[k] = len(leaders)
            leaders.append(k)
    return group
