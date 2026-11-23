"""Bounded, metadata-only Jev advisory on the Sitewatch design. Advice only; no authority."""
import json
import sys
from pathlib import Path

sys.path.insert(0, '/home/chris/jarvis/.archymedes/worktrees/open-source-20261117')
from jarvis.response import jev  # noqa: E402

STATE = {
    'scope': 'Offline diagnoser of synthetic site-sensor heartbeat traces; classify fault causes; compare to naive baseline',
    'alternatives': {
        'rules': 'deterministic state machine on receive time, sequence, boot id, value runs; hysteresis recovery',
        'naive': 'last-seen threshold on device timestamp, no cause',
        'learned': 'anomaly model trained on our own synthetic faults',
    },
    'invariants': ['truth labels never visible to diagnoser', 'silence never healthy', 'freshness on receive time',
                   'recovery needs contiguous run', 'deterministic', 'bounded input'],
    'data': 'no real device traces yet; generator and diagnoser share author',
}
QUESTIONS = {
    'design': {'type': 'choice', 'instructions': 'Which alternative best fits the scope, invariants and data available?',
               'criteria': {'rules': 'deterministic rules', 'naive': 'naive baseline', 'learned': 'learned model',
                            'unknown': 'insufficient information'}},
    'circular': {'type': 'noul', 'instructions': 'Would a high score on traces from our own generator establish '
                 'field accuracy on real devices?',
                 'criteria': {'true': 'yes, establishes field accuracy', 'false': 'no, only internal consistency'}},
}
try:
    r = jev._call(STATE, QUESTIONS, timeout=20)
    result = {'model': r.get('model'), 'answers': r['answers']}
except jev.JevError:
    result = {'unavailable': True, 'fallback': 'deterministic rules design'}
Path(__file__).with_name('jev-design.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result))
