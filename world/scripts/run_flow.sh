#!/usr/bin/env bash
# The whole flow for one site, in order. Each step reads the previous step's files.
#   1 build     open data -> 3D tiles + sim inputs
#   2 sim       drills, operations, 30-day run       -> web/lib/data/world-sim-<site>.json + replays
#   3 measures  candidate improvements, in the sim   -> web/lib/data/world-measures-<site>.json
#   4 coverage  what the cameras see: shares, fence gaps, maps -> web/lib/data/world-coverage-<site>.json
#   5 orion     ORION ranks the improvements on that evidence -> web/lib/data/world-orion-<site>.json
#   6 yard      the warehouse site as its own scene
#   7 report    the site assessment as a document           -> reports/<site>-site-assessment.md
# Step 5 needs ~/orion and TYPESAFE_API_KEY in its .env; the key is never printed. Skip it with ORION=0.
set -euo pipefail
SITE=${1:-ch-lauterbrunnen}
HERE="$(cd "$(dirname "$0")/.." && pwd)"
WEB="$HERE/../web"; OUT="$HERE/data/out/$SITE"; PUB="$WEB/public/world/$SITE"
cd "$HERE"
[ "${BUILD:-1}" = 1 ] && uv run python -m archworld build "$SITE" --out "$OUT" --publish "$PUB" --summary "$WEB/lib/data/world-$SITE.json"
uv run python -m archworld sim "$SITE" --out "$OUT" --seeds "${SEEDS:-40}" --days "${DAYS:-30}" --publish "$PUB/sim" --summary "$WEB/lib/data/world-sim-$SITE.json"
uv run python -m archworld measures "$SITE" --out "$OUT" --seeds "${MEASURE_SEEDS:-120}" --days "${DAYS:-30}" --summary "$WEB/lib/data/world-measures-$SITE.json"
# coverage comes before ORION, which uses it as evidence
uv run python -m archworld coverage "$SITE" --out "$OUT" --publish "$PUB/report" --summary "$WEB/lib/data/world-coverage-$SITE.json"
if [ "${ORION:-1}" = 1 ]; then (cd "$HOME/orion" && bun "$HERE/../plans/20261122-synthetic-world/orion_site.ts"); fi
uv run python -m archworld yard "$SITE" --out "$OUT" --publish "$PUB/yard"
# 7 report: Markdown from the result files; it needs every step above
uv run python scripts/make_report.py "$SITE"
