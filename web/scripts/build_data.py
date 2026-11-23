"""Build the app's static data from recorded sources. Every value traces to a hashed input file.

Inputs (read-only): Compass scores, the Sitewatch evaluation, the ISU-ILCC capacity_fade archive and its readme.
Outputs: lib/data/{portfolio,battery,sitewatch-eval}.json
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import re
import subprocess
import sys
import zipfile
from pathlib import Path

WEB = Path(__file__).resolve().parents[1]
ROOT = WEB.parent
MOATS = Path('/home/chris/jarvis/.archymedes/defense-moats-20261118')
FEAS = ROOT / '.feasibility/20261118'
OUT = WEB / 'lib/data'

# slug, short label, moat assets (owner's table), status, status note
PROJECTS = {
    'site-fault-network': ('sitewatch', 'Sitewatch', 'Supported device integrations, integrator distribution and confirmed failure and maintenance histories', 'built', 'Diagnoser prototype runs. 450 of 450 causes named on synthetic traces.'),
    'private-eval-network': ('ai-evaluation', 'AI evaluation', 'Confidential benchmarks, trusted independent evaluations and recurring supplier integrations', 'partial', 'EvalEvidence and DataScope first passes, 13 engine tests each.'),
    'battery-outcomes': ('battery', 'Battery outcomes', 'Longitudinal aging data, reference measurements and equipment-specific diagnostic models', 'data', 'Public aging data for 251 cells loaded (CC BY 4.0).'),
    'cable-sensing': ('subsea', 'Subsea monitoring', 'Operator access, installed sensing infrastructure and site-specific, confirmed event histories', 'data', 'Open-source threat picture with live AIS built. Needs operator fiber and DAS interrogators.'),
    'component-trace': ('provenance', 'Component provenance', 'Verified manufacturer relationships, chain-of-custody records and laboratory inspection outcomes', 'research', 'Research only. VisA PCB images identified (CC BY 4.0).'),
    'qualification-graph': ('qualification', 'Qualification graph', 'Supplier and test-lab integrations and accumulated qualification evidence', 'research', 'Research only. NIST AM-Bench identified.'),
    'fleet-reliability': ('fleet', 'Fleet repair outcomes', 'Equipment-specific maintenance histories, confirmed repairs and embedded customer workflows', 'research', 'Research only.'),
}
DIMS = ['defensibility', 'leverage', 'impact', 'quality', 'confidence', 'urgency', 'reach', 'reversibility', 'effort']


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def portfolio() -> dict:
    results = json.loads((MOATS / 'results.json').read_text())
    rows = {s: {r['optionId']: r for r in results['scenarios'][s]['rows']} for s in ('prototype', 'asset_milestone')}
    projects = []
    with open(MOATS / 'SCORES.csv', newline='') as handle:
        for row in csv.DictReader(handle):
            pid = row['id']
            slug, short, moat, status, note = PROJECTS[pid]
            projects.append({
                'id': pid, 'slug': slug, 'short': short, 'name': row['name'], 'moat': moat,
                'status': status, 'statusNote': note,
                'prototype': round(float(row['first_prototype_defensibility_0_to_4']), 3),
                'conditional': round(float(row['conditional_asset_defensibility_0_to_4']), 3),
                'effort': round(float(row['conditional_asset_effort_0_to_4']), 3),
                'milestone': row['required_asset_milestone'], 'gate': row['unverified_access_gate'],
                'buyer': row['buyer_hypothesis'], 'offer': row['commercial_offer'], 'sources': row['sources'].split(),
                'dims': {('prototype' if s == 'prototype' else 'milestone'): {d: round(rows[s][pid]['level'][d], 3) for d in DIMS}
                         for s in rows},
            })
    return {'levels': results['criteria']['levels'], 'criteria': results['criteria']['criteria'],
            'question': results['criteria']['question'],
            'agreement': {'prototype': results['scenarios']['prototype']['agreement'],
                          'milestone': results['scenarios']['asset_milestone']['agreement']},
            'projects': projects}


def conditions(readme: str) -> dict[int, dict]:
    table = {}
    for line in readme.splitlines():
        m = re.fullmatch(r'\s*(\d{1,2}) (\d\.\d{3}) (\d\.\d{3}) (\d{1,3}\.\d{2})%\s*', line)
        if m:
            g = int(m.group(1))
            table[g] = {'group': g, 'chargeC': float(m.group(2)), 'dischargeC': float(m.group(3)),
                        'dod': float(m.group(4)) / 100}
    return table


def battery() -> dict:
    zpath, readme_txt = FEAS / 'capacity_fade.zip', FEAS / 'isu-docs/readme.txt'
    table = conditions(readme_txt.read_text())
    cells = []
    with zipfile.ZipFile(zpath) as archive:
        for info in sorted(archive.infolist(), key=lambda i: i.filename):
            m = re.search(r'Release (\d)\.0/G(\d+)C(\d+)\.csv$', info.filename)
            if not m or info.file_size > 100_000:
                continue
            release, group, index = int(m.group(1)), int(m.group(2)), int(m.group(3))
            text = archive.read(info).decode('utf-8')
            reader = csv.reader(io.StringIO(text))
            if next(reader) != ['Time', 'Capacity']:
                raise SystemExit(f'unexpected header in {info.filename}')
            pts = [(float(t), float(q)) for t, q in reader if t and q]
            if not pts:
                continue
            q0 = pts[0][1]
            to80 = None
            for (t1, a), (t2, b) in zip(pts, pts[1:]):
                if a / q0 >= 0.8 > b / q0:
                    to80 = round(t1 + (a / q0 - 0.8) / ((a - b) / q0) * (t2 - t1), 2)
                    break
            cells.append({'id': f'G{group}C{index}', 'group': group, 'release': release,
                          't': [round(t, 3) for t, _ in pts], 'q': [round(q, 5) for _, q in pts],
                          'q0': round(q0, 5), 'retention': round(pts[-1][1] / q0, 4), 'weeks': round(pts[-1][0], 2),
                          'weeksTo80': to80})
    missing = sorted({c['group'] for c in cells} - set(table))
    return {'source': {'title': 'ISU-ILCC Battery Aging Dataset', 'doi': '10.25380/iastate.22582234.v2',
                       'url': 'https://iastate.figshare.com/articles/dataset/_b_ISU-ILCC_Battery_Aging_Dataset_b_/22582234',
                       'license': 'CC BY 4.0', 'licenseUrl': 'https://creativecommons.org/licenses/by/4.0/',
                       'authors': ['Adam Thelen', 'Tingkai Li', 'Jinqiang Liu', 'Chad Tischer', 'Chao Hu'],
                       'ratedAh': 0.25,
                       'timeUnit': 'weeks on test (inferred: readme says capacity checks run every 7 days)',
                       'modified': 'Parsed and summarized; weeks-to-80% is linearly interpolated by Archymedes.'},
            'conditions': [table[g] for g in sorted(table)], 'groupsWithoutCondition': missing, 'cells': cells}


RUN_SET = [(seed, 6) for seed in range(1, 13)] + [(7, 3), (7, 12), (7, 24)]


def precompute_runs() -> list[dict]:
    """Same runner the live API uses, so hosted output equals local output."""
    runs_dir = WEB / 'public/runs'
    runs_dir.mkdir(parents=True, exist_ok=True)
    index = []
    for seed, hours in RUN_SET:
        out = subprocess.run([sys.executable, '-I', str(WEB / 'scripts/sitewatch_run.py'), '--seed', str(seed),
                              '--hours', str(hours)], capture_output=True, check=True, timeout=120).stdout
        (runs_dir / f'seed-{seed}-{hours}h.json').write_bytes(out)
        index.append({'seed': seed, 'hours': hours, 'file': f'/runs/seed-{seed}-{hours}h.json'})
    return index


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    evaluation = ROOT / 'sitewatch/scripts/dev/evaluation.json'
    outputs = {'portfolio.json': portfolio(), 'battery.json': battery(),
               'sitewatch-eval.json': json.loads(evaluation.read_text())}
    inputs = [MOATS / 'results.json', MOATS / 'SCORES.csv', evaluation, FEAS / 'capacity_fade.zip',
              FEAS / 'isu-docs/README_V2.0.pdf']
    outputs['runs.json'] = {'runs': precompute_runs()}
    outputs['provenance.json'] = {'built': '2026-11-18', 'inputs': {p.name: sha(p) for p in inputs}}
    for name, data in outputs.items():
        (OUT / name).write_text(json.dumps(data, separators=(',', ':'), sort_keys=True))
        print(name, (OUT / name).stat().st_size)
    b = outputs['battery.json']
    print('cells', len(b['cells']), 'conditions', len(b['conditions']), 'groups without condition', b['groupsWithoutCondition'])


if __name__ == '__main__':
    main()
