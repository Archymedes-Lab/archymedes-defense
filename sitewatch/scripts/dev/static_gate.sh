#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.."
uvx ruff@0.17.3 check sitewatch tests scripts
uvx mypy@2.4.1 sitewatch
python3 -m compileall -q sitewatch
