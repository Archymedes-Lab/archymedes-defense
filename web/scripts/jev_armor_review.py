"""Bounded metadata-only Jev review of the armor screening + test planner. Advisory only."""
import json
import sys

sys.path.insert(0, '/home/chris/jarvis/.archymedes/worktrees/open-source-20261117')
from jarvis.response import jev  # noqa: E402

STATE = {
    'scope': 'soft armor vs NIJ 0123.00 HG1/HG2 only; protective; outputs are V50 ratios to a tested reference and test plans',
    'models': 'Phoenix-Porwal and Cunniff from NIST 2020; NIST Tables 1-2 reproduced in tests; relative V50 only',
    'planner': ['NIJ 0101.07 up-and-down (steps verified by hand)', '3POD-style with doubling search; DoD 2014 grid bias 5.8 vs paper ~12.5',
                'physics prior + D-optimal; prior steers shots only after data overlap; MLE reported'],
    'measured': ['31/31 tests', 'prior gives an estimate in 100% of tests at 6 shots vs NIJ 57-63%',
                 'NIJ up-and-down is as accurate or better where it has an estimate',
                 'prior off 2 sigma: bias < 0.1 sigma at 20 shots; off 10 sigma: < 0.25 sigma',
                 'two earlier versions failed robustness tests and were changed'],
    'not_done': ['no validation on NIST raw data (repository down)', 'fibre presets are datasheet values', 'no backface deformation model'],
}
QUESTIONS = {
    'gap': {'type': 'choice', 'instructions': 'Which gap most limits trust in this prototype for an armor maker or test lab?',
            'criteria': {'raw_data': 'validation against measured V50 data', 'fibre': 'real extracted-yarn properties',
                         'bfd': 'backface deformation prediction', 'none': 'no material gap for a screening prototype'}},
    'honest': {'type': 'noul', 'instructions': 'Does the page state the planner benefit honestly (earlier estimate, not fewer shots than NIJ)?',
               'criteria': {'true': 'honest', 'false': 'overstated'}},
}
try:
    r = jev._call(STATE, QUESTIONS, timeout=20)
    print(json.dumps({'model': r.get('model'), 'answers': r['answers']}))
except jev.JevError:
    print(json.dumps({'unavailable': True}))
