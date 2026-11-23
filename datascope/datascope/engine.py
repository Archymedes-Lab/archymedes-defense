"""Check caller-declared lineage and permission records, never legal clearance."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from .contract import Findings, InputError, array, boolean, choice, digest, fields, identifier, integer, timestamp

MAX_DATASETS = 256
PURPOSES = {'evaluation', 'training', 'internal_analysis', 'commercial_distribution'}


def index(rows: list[Any], schema: set[str]) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for item in rows:
        row = fields(item, schema)
        key = identifier(row['id'])
        if key in result:
            raise InputError('DUPLICATE_RECORD_ID')
        result[key] = row
    return result


def analyze(value: Any, at: datetime) -> dict[str, Any]:
    root = fields(value, {'schema_version', 'request', 'datasets', 'sources', 'permissions',
                          'max_review_age_seconds'})
    integer(root['schema_version'], 1, 1)
    request = fields(root['request'], {'dataset_id', 'purpose'})
    target = identifier(request['dataset_id'])
    purpose = choice(request['purpose'], PURPOSES)
    max_review_age = integer(root['max_review_age_seconds'], 1, 365 * 86400)
    datasets = index(array(root['datasets'], MAX_DATASETS),
                     {'id', 'content_digest', 'source_id', 'permission_id', 'derived_from'})
    sources = index(array(root['sources'], 64), {'id', 'available', 'checked_at', 'max_age_seconds'})
    permissions = index(array(root['permissions'], MAX_DATASETS),
                        {'id', 'source_id', 'content_digest', 'grantor_record', 'allowed_purposes',
                         'allow_derivation', 'expires_at', 'reviewer_id', 'reviewed_at', 'decision'})
    for dataset in datasets.values():
        digest(dataset['content_digest'])
        identifier(dataset['source_id'])
        identifier(dataset['permission_id'])
        parents = array(dataset['derived_from'], 16)
        for parent in parents:
            identifier(parent)
        if len(set(parents)) != len(parents):
            raise InputError('DUPLICATE_PARENT')
    for source in sources.values():
        boolean(source['available'])
        timestamp(source['checked_at'])
        integer(source['max_age_seconds'], 1, 30 * 86400)
    for permission in permissions.values():
        for key in ['source_id', 'grantor_record', 'reviewer_id']:
            identifier(permission[key])
        digest(permission['content_digest'])
        boolean(permission['allow_derivation'])
        timestamp(permission['expires_at'])
        timestamp(permission['reviewed_at'])
        choice(permission['decision'], {'approved', 'pending', 'denied'})
        purposes = array(permission['allowed_purposes'], len(PURPOSES))
        for item in purposes:
            choice(item, PURPOSES)
        if len(set(purposes)) != len(purposes):
            raise InputError('DUPLICATE_PURPOSE')
    # Kahn's algorithm over known nodes: bounded and non-recursive, including disconnected records.
    degree = {key: sum(parent in datasets for parent in row['derived_from']) for key, row in datasets.items()}
    children: dict[str, list[str]] = {key: [] for key in datasets}
    for key, row in datasets.items():
        for parent in row['derived_from']:
            if parent in children:
                children[parent].append(key)
    ready = [key for key, amount in degree.items() if amount == 0]
    visited = 0
    while ready:
        key = ready.pop()
        visited += 1
        for child in children[key]:
            degree[child] -= 1
            if degree[child] == 0:
                ready.append(child)
    if visited != len(datasets):
        raise InputError('LINEAGE_CYCLE')
    f = Findings()
    reachable: set[str] = set()
    required_derivation: set[str] = set()
    pending = [target]
    while pending:
        key = pending.pop()
        if key in reachable:
            continue
        reachable.add(key)
        if key not in datasets:
            f.add('DATASET_OR_PARENT_MISSING', key)
            continue
        for parent in datasets[key]['derived_from']:
            required_derivation.add(parent)
            pending.append(parent)
    for key in sorted(reachable):
        dataset = datasets.get(key)
        if dataset is None:
            continue
        source = sources.get(dataset['source_id'])
        if source is None:
            f.add('SOURCE_RECORD_MISSING', key)
        else:
            age = (at - timestamp(source['checked_at'])).total_seconds()
            if not source['available']:
                f.add('SOURCE_UNAVAILABLE', key)
            if age > source['max_age_seconds']:
                f.add('SOURCE_STALE', key)
            if age < -5:
                f.add('SOURCE_IN_FUTURE', key)
        permission = permissions.get(dataset['permission_id'])
        if permission is None:
            f.add('PERMISSION_RECORD_MISSING', key)
            continue
        if permission['source_id'] != dataset['source_id']:
            f.add('PERMISSION_SOURCE_MISMATCH', key)
        if permission['content_digest'] != dataset['content_digest']:
            f.add('PERMISSION_VERSION_MISMATCH', key)
        review_age = (at - timestamp(permission['reviewed_at'])).total_seconds()
        if review_age > max_review_age:
            f.add('REVIEW_STALE', key)
        if review_age < -5:
            f.add('REVIEW_IN_FUTURE', key)
        if timestamp(permission['expires_at']) <= at:
            f.add('PERMISSION_EXPIRED', key)
        if permission['decision'] == 'pending':
            f.add('REVIEW_PENDING', key)
        if permission['decision'] == 'denied':
            f.add('DECLARED_REVIEW_DENIAL', key)
        if purpose not in permission['allowed_purposes']:
            f.add('PURPOSE_NOT_LISTED', key)
        if key in required_derivation and not permission['allow_derivation']:
            f.add('DERIVATION_NOT_LISTED', key)
    restrictions = {'DECLARED_REVIEW_DENIAL', 'PURPOSE_NOT_LISTED', 'DERIVATION_NOT_LISTED'}
    status = ('DECLARED_RESTRICTION' if f.codes & restrictions else 'REVIEW_REQUIRED' if f.codes
              else 'DECLARATIONS_MATCH')
    return {'tool': 'datascope', 'status': status, 'requested_dataset': target, 'purpose': purpose,
            'lineage_records_required': len(reachable), 'lineage_records_present': len(reachable & datasets.keys()),
            **f.report(), 'limitations': [
                'Matches caller-declared records only; no rights document or grantor identity is verified.',
                'A matching record is not legal clearance, ownership evidence or authority to use actual data.',
                'Unavailable or stale metadata requests review; it does not determine whether legal rights exist.']}
