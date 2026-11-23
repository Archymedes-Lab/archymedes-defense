"""Bounded metadata-only Jev review of measured Sitewatch results. Advisory; no authority."""
import json
import sys
from pathlib import Path

sys.path.insert(0, '/home/chris/jarvis/.archymedes/worktrees/open-source-20261117')
from jarvis.response import jev  # noqa: E402

STATE = {
    'measured_50_seeds': {'sitewatch_classified': '450/450', 'sitewatch_false_alarms_all_one_hard_case': 550,
                          'sitewatch_false_alarms_other_devices': 0, 'naive_3hb_classified': 0,
                          'naive_3hb_false_alarms': 10, 'naive_3hb_alarm_overlap': '300/450'},
    'hard_case': 'integer-resolution humidity sensor legitimately flat for minutes; frozen-reading rule fires',
    'provenance': 'generator and diagnoser written by same author; no real device traces',
    'next_steps': {
        'real_traces': 'replay one real device family (vendor virtual access or own hardware) with logged faults',
        'calibrate': 'per-device frozen-reading threshold learned from a healthy baseline period',
        'blender': '3D scene of the site and sensors animated by the alarm timeline',
        'outreach': 'send vendor/integrator outreach now with synthetic results',
    },
}
QUESTIONS = {
    'next': {'type': 'choice', 'instructions': 'Which next step most reduces the main validation gap?',
             'criteria': {k: v for k, v in STATE['next_steps'].items()} | {'unknown': 'insufficient information'}},
    'claim': {'type': 'noul', 'instructions': 'Is it accurate to tell a prospective partner Sitewatch is '
              'field-proven at 100% classification?',
              'criteria': {'true': 'accurate claim', 'false': 'overclaim; synthetic internal consistency only'}},
}
try:
    r = jev._call(STATE, QUESTIONS, timeout=20)
    result = {'model': r.get('model'), 'answers': r['answers']}
except jev.JevError:
    result = {'unavailable': True, 'fallback': 'pursue real traces first'}
Path(__file__).with_name('jev-review.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result))
