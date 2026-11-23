"""Bounded public research for the 2026-11-20 aerodynamics candidates. Key read from its 0600 file; never printed or stored."""
import concurrent.futures
import json
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path('/home/chris/archymedes-defense/plans/20261120-aero')
KEY_FILE = Path.home() / '.config/argus-research/exa.key'


def main() -> None:
    key = KEY_FILE.read_text().strip()
    if not key or any(c.isspace() for c in key):
        raise SystemExit('Exa key format invalid; not sent')
    cands = json.loads((ROOT / 'candidates.json').read_text())['candidates']
    jobs = [(c['id'], q) for c in cands for q in c['queries']]

    def search(job):
        cid, query = job
        body = {'query': query, 'type': 'auto', 'numResults': 4, 'startPublishedDate': '2023-01-01',
                'contents': {'highlights': {'maxCharacters': 900}}}
        req = urllib.request.Request('https://api.exa.ai/search', data=json.dumps(body).encode(),
                                     headers={'x-api-key': key, 'Content-Type': 'application/json'}, method='POST')
        try:
            with urllib.request.urlopen(req, timeout=40) as r:
                raw = r.read(512 * 1024 + 1)
            if len(raw) > 512 * 1024:
                return {'id': cid, 'query': query, 'error': 'response_limit'}
            v = json.loads(raw)
            return {'id': cid, 'query': query, 'costDollars': v.get('costDollars'),
                    'results': [{k: x.get(k) for k in ('title', 'url', 'publishedDate', 'highlights')} for x in v.get('results', [])[:4]]}
        except urllib.error.HTTPError as e:
            return {'id': cid, 'query': query, 'error': f'http_{e.code}'}
        except (OSError, ValueError):
            return {'id': cid, 'query': query, 'error': 'request_failed'}

    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        out = list(pool.map(search, jobs))
    text = json.dumps({'provider': 'Exa', 'searches': out}, indent=1)
    if key in text:
        raise SystemExit('refused: key echoed in response')
    (ROOT / 'exa-results.json').write_text(text + '\n')
    cost = sum((x.get('costDollars') or {}).get('total', 0) for x in out)
    print(json.dumps({'searches': len(out), 'ok': sum('error' not in x for x in out), 'results': sum(len(x.get('results', [])) for x in out),
                      'errors': [x['error'] for x in out if 'error' in x], 'cost_usd': round(cost, 3)}))


if __name__ == '__main__':
    main()
