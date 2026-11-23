"""Fail if protected data appears in public build assets (/_next/static is served without sign-in).

Sentinels are taken from the data files themselves, so a new leak path is caught without editing this list.
"""
import json
import sys
from pathlib import Path

WEB = Path(__file__).resolve().parents[1]
data = WEB / 'lib/data'
portfolio = json.loads((data / 'portfolio.json').read_text())
battery = json.loads((data / 'battery.json').read_text())
sentinels = [p['buyer'][:40] for p in portfolio['projects']] + [p['gate'][:40] for p in portfolio['projects']]
sentinels += [battery['source']['authors'][0], battery['source']['doi']]
sentinels += [json.dumps(battery['cells'][0]['q'][:4])[1:-1].replace(' ', '')]
static = WEB / '.next/static'
if not static.is_dir():
    sys.exit('no build output; run bun run build first')
hits = []
for f in static.rglob('*'):
    if f.is_file() and f.suffix in {'.js', '.css', '.json', '.txt', '.map'}:
        text = f.read_text(errors='ignore')
        hits += [(f.relative_to(WEB), s[:30]) for s in sentinels if s and s in text]
for path, s in hits:
    print(f'LEAK {path}: {s!r}')
print(f'checked {len(sentinels)} sentinels; {len(hits)} leaks')
sys.exit(1 if hits else 0)
