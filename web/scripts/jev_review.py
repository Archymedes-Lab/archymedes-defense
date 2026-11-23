"""Bounded metadata-only Jev review of the web app's engine route. Advisory only."""
import json
import sys
from pathlib import Path

sys.path.insert(0, '/home/chris/jarvis/.archymedes/worktrees/open-source-20261117')
from jarvis.response import jev  # noqa: E402

STATE = {
    'route': 'POST /api/sitewatch spawns python3 -I runner via execFile (no shell), fixed script path',
    'controls': ['bound to 127.0.0.1', 'same-origin check (Origin host == Host)', 'integer seed/hours bounds',
                 'upload caps 256KB/32MB', 'temp dir 0600 removed in finally', 'timeout 60s', 'max 2 concurrent',
                 'env reduced to PATH and LANG', 'engine refuses symlinks/oversize/bad lines'],
    'measured': ['403 no/foreign origin', '400 bad seed/hours/injection string', '415 wrong type',
                 '422 malformed telemetry with line number', 'no temp dirs left', 'synthetic run 9/9 classified'],
    'not_done': ['no automated test suite for the route', 'no auth (single-user local app)', 'not deployed'],
}
QUESTIONS = {
    'gap': {'type': 'choice', 'instructions': 'Which gap most needs closing before others use this app?',
            'criteria': {'route_tests': 'automated route tests for refusal paths', 'auth': 'authentication before any non-loopback exposure',
                         'rate': 'stronger rate limiting', 'none': 'no material gap for local single-user use'}},
    'safe_exposed': {'type': 'noul', 'instructions': 'Would it be safe to expose this route on a public host as is?',
                     'criteria': {'true': 'safe to expose publicly', 'false': 'not safe without auth and limits'}},
}
try:
    r = jev._call(STATE, QUESTIONS, timeout=20)
    result = {'model': r.get('model'), 'answers': r['answers']}
except jev.JevError:
    result = {'unavailable': True}
print(json.dumps(result))
