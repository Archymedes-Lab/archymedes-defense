"""Bounded metadata-only Jev review of the subsea exposure model. Advisory only."""
import json
import sys

sys.path.insert(0, '/home/chris/jarvis/.archymedes/worktrees/open-source-20261117')
from jarvis.response import jev  # noqa: E402

STATE = {
    'model': 'Gulf of Finland cables (OSM) sampled per km; exposed = water <= anchor depth AND cargo+tanker density >= p90 (EMODnet 2024); watched = within fiber range of a shore landing along cable',
    'live': 'Digitraffic AIS every 60 s; flag over-cable within ~1 km in 10-100 m water, not moored; attention = at-anchor while 1.5-8 kn, or cargo/tanker 0.3-3 kn over cable',
    'measured': ['6712 km mapped, 99% within 100 m reach, 399 km exposed, 33% of exposed watched at 50 km',
                 'live: 361 ships, 30 over cables, 0 attention; earlier rule flagged 143 mostly moored ships',
                 'Estlink 2 and Balticconnector lengths match public figures (145, 77 km)'],
    'not_done': ['no validation of flags against known incident tracks', 'cable routes from volunteer mapping',
                 'traffic is annual average, not seasonal or by draught', 'no anchor-drag physics'],
}
QUESTIONS = {
    'next': {'type': 'choice', 'instructions': 'Which next step most improves trust in this model for a cable operator?',
             'criteria': {'replay': 'replay historical AIS for the 2023 and 2024 incidents and check the flags fire',
                          'routes': 'verify cable routes against operator or charted data',
                          'traffic': 'use draught-filtered or seasonal traffic',
                          'physics': 'model anchor drag physics'}},
    'honest': {'type': 'noul', 'instructions': 'Does the page present this as a decision aid without overstating it, given it says not a hazard assessment and lists heuristics?',
               'criteria': {'true': 'presented honestly', 'false': 'overstated'}},
}
try:
    r = jev._call(STATE, QUESTIONS, timeout=20)
    print(json.dumps({'model': r.get('model'), 'answers': r['answers']}))
except jev.JevError:
    print(json.dumps({'unavailable': True}))
