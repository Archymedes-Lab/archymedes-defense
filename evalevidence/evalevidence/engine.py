"""Compare declared evaluation receipts; never judge raw model responses."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from .contract import Findings, InputError, array, boolean, canonical_digest, choice, digest, fields, identifier, integer, timestamp

MAX_CASES = 2000
OUTCOMES = {'pass', 'fail', 'error', 'skipped'}


def receipt_digest(run: dict[str, Any], result: dict[str, Any]) -> str:
    return canonical_digest({'run_id': run['id'], 'model_digest': run['model_digest'],
                             'model_id': run['model_id'], 'created_at': run['created_at'],
                             'suite_digest': run['suite_digest'], 'case_id': result['case_id'],
                             'outcome': result['outcome'], 'latency_ms': result['latency_ms']})


def parse_suite(value: Any) -> dict[str, Any]:
    suite = fields(value, {'id', 'dataset_digest', 'evaluator_digest', 'policy_digest', 'cases', 'digest'})
    identifier(suite['id'])
    for key in ['dataset_digest', 'evaluator_digest', 'policy_digest', 'digest']:
        digest(suite[key])
    seen: set[str] = set()
    for item in array(suite['cases'], MAX_CASES, 1):
        row = fields(item, {'id', 'critical'})
        key = identifier(row['id'])
        boolean(row['critical'])
        if key in seen:
            raise InputError('DUPLICATE_EXPECTED_CASE')
        seen.add(key)
    return suite


def parse_run(value: Any) -> dict[str, Any]:
    run = fields(value, {'id', 'model_id', 'model_digest', 'suite_digest', 'created_at', 'results'})
    identifier(run['id'])
    identifier(run['model_id'])
    digest(run['model_digest'])
    digest(run['suite_digest'])
    timestamp(run['created_at'])
    for item in array(run['results'], MAX_CASES):
        row = fields(item, {'case_id', 'outcome', 'latency_ms', 'receipt_digest'})
        identifier(row['case_id'])
        choice(row['outcome'], OUTCOMES)
        integer(row['latency_ms'], 0, 86_400_000)
        digest(row['receipt_digest'])
    return run


def analyze(value: Any, at: datetime) -> dict[str, Any]:
    root = fields(value, {'schema_version', 'suite', 'baseline', 'candidate', 'max_age_seconds',
                          'max_latency_increase_ms'})
    integer(root['schema_version'], 1, 1)
    suite = parse_suite(root['suite'])
    baseline, candidate = parse_run(root['baseline']), parse_run(root['candidate'])
    age_limit = integer(root['max_age_seconds'], 1, 30 * 86400)
    latency_limit = integer(root['max_latency_increase_ms'], 0, 86_400_000)
    expected = {x['id']: x['critical'] for x in suite['cases']}
    f = Findings()
    if suite['digest'] != canonical_digest({k: v for k, v in suite.items() if k != 'digest'}):
        f.add('SUITE_DIGEST_MISMATCH', 'suite')
    if baseline['id'] == candidate['id']:
        f.add('RUN_ID_REUSED', 'runs')
    indexed: list[dict[str, dict[str, Any]]] = []
    for label, run in [('baseline', baseline), ('candidate', candidate)]:
        if run['suite_digest'] != suite['digest']:
            f.add('SUITE_BINDING_MISMATCH', label)
        age = (at - timestamp(run['created_at'])).total_seconds()
        if age > age_limit:
            f.add('STALE_RUN', label)
        if age < -5:
            f.add('FUTURE_RUN', label)
        rows: dict[str, dict[str, Any]] = {}
        for result in run['results']:
            key = result['case_id']
            if key not in expected:
                f.add('UNEXPECTED_CASE', label)
                continue
            if key in rows:
                f.add('DUPLICATE_RESULT', label)
                continue
            if result['receipt_digest'] != receipt_digest(run, result):
                f.add('RECEIPT_DIGEST_MISMATCH', label)
                continue
            rows[key] = result
            if result['outcome'] in {'error', 'skipped'}:
                f.add('INCOMPLETE_RESULT', label)
        for key in expected:
            if key not in rows:
                f.add('MISSING_RESULT', label)
        indexed.append(rows)
    incomparable = {'SUITE_DIGEST_MISMATCH', 'SUITE_BINDING_MISMATCH', 'RUN_ID_REUSED'}
    comparable = not bool(f.codes & incomparable)
    compared = regressed = improved = persisting_failures = 0
    for key, critical in expected.items():
        old, new = indexed[0].get(key), indexed[1].get(key)
        if new and new['outcome'] == 'fail' and critical:
            f.add('CRITICAL_FAILURE', key)
        if not comparable or not old or not new or old['outcome'] not in {'pass', 'fail'} or new['outcome'] not in {'pass', 'fail'}:
            continue
        compared += 1
        if old['outcome'] == 'pass' and new['outcome'] == 'fail':
            regressed += 1
            f.add('OUTCOME_REGRESSION', key)
        if old['outcome'] == 'fail' and new['outcome'] == 'pass':
            improved += 1
        if old['outcome'] == new['outcome'] == 'fail':
            persisting_failures += 1
            f.add('PERSISTING_FAILURE', key)
        if new['latency_ms'] - old['latency_ms'] > latency_limit:
            f.add('LATENCY_INCREASE', key)
    incomplete = {'STALE_RUN', 'FUTURE_RUN', 'MISSING_RESULT', 'DUPLICATE_RESULT', 'UNEXPECTED_CASE',
                  'RECEIPT_DIGEST_MISMATCH', 'INCOMPLETE_RESULT'}
    status = ('INCOMPARABLE' if f.codes & incomparable else 'INCOMPLETE' if f.codes & incomplete
              else 'REGRESSION' if f.codes & {'CRITICAL_FAILURE', 'OUTCOME_REGRESSION', 'LATENCY_INCREASE'}
              else 'REVIEW_REQUIRED' if f.codes else 'NO_RECORDED_REGRESSION')
    return {'tool': 'evalevidence', 'status': status, 'suite_id': suite['id'],
            'expected_cases': len(expected), 'compared_cases': compared, 'regressed_cases': regressed,
            'improved_cases': improved, 'persisting_failures': persisting_failures, **f.report(),
            'limitations': ['Compares declared outcomes only; no prompt, completion or model behavior is evaluated.',
                            'Caller-controlled hashes do not authenticate runs or dataset/evaluator contents.',
                            'No recorded regression is not a safety, quality or deployment approval.']}
