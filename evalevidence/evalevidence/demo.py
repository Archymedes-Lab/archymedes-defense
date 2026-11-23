"""Reproducible synthetic metadata only, never actual prompts or responses."""
import copy
import json
from pathlib import Path
from typing import Any

from .contract import canonical_digest
from .engine import receipt_digest

AT = '2026-11-18T00:00:00Z'


def scenario(count: int = 3) -> dict[str, Any]:
    if not 1 <= count <= 2000:
        raise ValueError('COUNT_INVALID')
    suite: dict[str, Any] = {'id': 'synthetic-defense-eval', 'dataset_digest': 'a' * 64,
                             'evaluator_digest': 'b' * 64, 'policy_digest': 'c' * 64,
                             'cases': [{'id': f'case-{i}', 'critical': i == 0} for i in range(count)]}
    suite['digest'] = canonical_digest(suite)
    runs = []
    for label, model in [('baseline', 'd'), ('candidate', 'e')]:
        run: dict[str, Any] = {'id': f'synthetic-{label}', 'model_id': f'model-{label}',
                               'model_digest': model * 64, 'suite_digest': suite['digest'],
                               'created_at': '2026-11-17T23:59:50Z', 'results': []}
        for case in suite['cases']:
            row = {'case_id': case['id'], 'outcome': 'pass', 'latency_ms': 100}
            row['receipt_digest'] = receipt_digest(run, row)
            run['results'].append(row)
        runs.append(run)
    return {'schema_version': 1, 'suite': suite, 'baseline': runs[0], 'candidate': runs[1],
            'max_age_seconds': 86400, 'max_latency_increase_ms': 50}


def examples(destination: Path) -> None:
    destination.mkdir(exist_ok=True)
    clean = scenario()
    regression = copy.deepcopy(clean)
    row = regression['candidate']['results'][0]
    row['outcome'] = 'fail'
    row['receipt_digest'] = receipt_digest(regression['candidate'], row)
    missing = copy.deepcopy(clean)
    missing['candidate']['results'].pop()
    for name, value in [('clean', clean), ('regression', regression), ('missing', missing)]:
        (destination / f'{name}.json').write_text(json.dumps(value, indent=2) + '\n')


if __name__ == '__main__':
    examples(Path('examples'))
