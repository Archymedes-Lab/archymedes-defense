"""Synthetic permission records; no real dataset or rights determination."""
import copy
import json
from pathlib import Path
from typing import Any

AT = '2026-11-18T00:00:00Z'


def scenario(count: int = 2) -> dict[str, Any]:
    if not 1 <= count <= 256:
        raise ValueError('COUNT_INVALID')
    datasets = []
    permissions = []
    for i in range(count):
        key = f'synthetic-data-{i}'
        content = f'{i:064x}'
        datasets.append({'id': key, 'content_digest': content, 'source_id': 'synthetic-source',
                         'permission_id': f'permission-{i}',
                         'derived_from': [f'synthetic-data-{i-1}'] if i else []})
        permissions.append({'id': f'permission-{i}', 'source_id': 'synthetic-source',
                            'content_digest': content, 'grantor_record': 'synthetic-grant',
                            'allowed_purposes': ['evaluation', 'training'], 'allow_derivation': True,
                            'expires_at': '2026-12-01T00:00:00Z', 'reviewer_id': 'synthetic-reviewer',
                            'reviewed_at': '2026-11-17T23:59:50Z', 'decision': 'approved'})
    return {'schema_version': 1, 'request': {'dataset_id': f'synthetic-data-{count-1}', 'purpose': 'evaluation'},
            'datasets': datasets, 'permissions': permissions,
            'sources': [{'id': 'synthetic-source', 'available': True,
                         'checked_at': '2026-11-17T23:59:50Z', 'max_age_seconds': 86400}],
            'max_review_age_seconds': 86400}


def examples(destination: Path) -> None:
    destination.mkdir(exist_ok=True)
    clean = scenario()
    denied = copy.deepcopy(clean)
    denied['permissions'][0]['allowed_purposes'] = ['training']
    pending = copy.deepcopy(clean)
    pending['permissions'][0]['decision'] = 'pending'
    for name, value in [('matching', clean), ('restricted-parent', denied), ('pending-review', pending)]:
        (destination / f'{name}.json').write_text(json.dumps(value, indent=2) + '\n')


if __name__ == '__main__':
    examples(Path('examples'))
