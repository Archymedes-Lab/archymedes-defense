"""Bounded metadata-only Jev review of the wing aerodynamics prototype. Advisory only: it cannot change a criterion."""
import json
import sys

sys.path.insert(0, '/home/chris/jarvis/.archymedes/worktrees/open-source-20261117')
from jarvis.response import jev  # noqa: E402

STATE = {
    'scope': 'thin sharp-edged slender wings at low speed; analysis and teaching on public NASA data; no combat capability',
    'engine': 'planar vortex lattice + Polhamus suction analogy + Wentz-Kohlman breakdown map; one calibrated parameter (vortex lift kept after burst 0.37)',
    'checks': ['34 property/verification tests (scale, translation, odd lift, monotone burst, elliptic bound within mesh tolerance)',
               '7 static rules on the engine (purity, determinism, no casts/any, angle params typed Rad/Deg, every export tested)',
               '6 compile-time unit proofs, mutation-checked'],
    'validation': ['200 digitized points, 13 cases, 3 NASA reports; leave-one-wing-out over 9 in-domain wings',
                   'pre-breakdown RMS 0.012-0.058 except 80 deg wing 0.135 (conflicts with another 80 deg dataset)',
                   'CLmax late on 60-65 deg wings (post-burst lift held too long)',
                   'band coverage: first version 77%; after widening chosen by nested leave-one-wing-out 90% (disclosed)',
                   '2 of 4 pre-registered criteria met; misses published'],
    'not_done': ['no thickness, rounded edges, fuselage, compressibility, Reynolds effects', 'fighter-class layout is generic and outside the domain'],
}
QUESTIONS = {
    'gap': {'type': 'choice', 'instructions': 'Which next step would most raise trust in these error bands for an aircraft or drone engineer?',
            'criteria': {'post_stall': 'model the lift drop after the vortex bursts at the apex', 'more_data': 'add more independent wind-tunnel cases',
                         'rounded_edges': 'support rounded leading edges and thickness', 'cfd': 'fuse a few CFD runs (multi-fidelity)'}},
    'honest': {'type': 'noul', 'instructions': 'Is reporting the widened band coverage, with the first-version 77% and the nested method disclosed, an honest claim?',
               'criteria': {'true': 'honest', 'false': 'misleading'}},
}
try:
    r = jev._call(STATE, QUESTIONS, timeout=20)
    print(json.dumps({'model': r.get('model'), 'answers': r['answers']}))
except jev.JevError:
    print(json.dumps({'unavailable': True}))
