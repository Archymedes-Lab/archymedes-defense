"""Bounded metadata-only Jev review of the hosted sign-in. Advisory only; tests and live checks decide."""
import json
import sys

sys.path.insert(0, '/home/chris/jarvis/.archymedes/worktrees/open-source-20261117')
from jarvis.response import jev  # noqa: E402

STATE = {
    'deployment': 'Next.js 16 on Vercel production, single shared password, no user accounts',
    'controls': ['proxy gates every route and public file except login, logout, icon and hashed /_next/static',
                 'build fails if data sentinels appear in /_next/static',
                 'scrypt N=2^15 password hash in env, ~99-bit generated password',
                 'stateless HMAC session cookie, __Host- Secure HttpOnly SameSite=Lax, 7-day expiry',
                 'session key derived from secret and password hash: rotation revokes all sessions',
                 'Origin check on login and logout, safe relative redirect only',
                 'per-instance best-effort throttle 10 fails/10 min, 600 ms floor on failures',
                 'hosted without config fails closed with 503'],
    'measured': ['bun unit tests 9/9', 'local e2e: redirects, 401 JSON, tamper, logout, throttle, open redirect refused',
                 'production: signed-out 303/401, signed-in 200, cookie Secure+HttpOnly'],
    'not_done': ['no shared rate-limit store across instances', 'no per-user identity or audit log',
                 'no server-side session revocation list'],
}
QUESTIONS = {
    'gap': {'type': 'choice', 'instructions': 'Which remaining gap matters most for a small private team site?',
            'criteria': {'shared_limit': 'shared rate limiting across instances', 'identity': 'per-user accounts and audit',
                         'revocation': 'server-side session revocation', 'none': 'no material gap at this scope'}},
    'adequate': {'type': 'noul', 'instructions': 'Is this sign-in adequate for a private site holding non-secret research prototypes?',
                 'criteria': {'true': 'adequate', 'false': 'not adequate'}},
}
try:
    r = jev._call(STATE, QUESTIONS, timeout=20)
    print(json.dumps({'model': r.get('model'), 'answers': r['answers']}))
except jev.JevError:
    print(json.dumps({'unavailable': True}))
