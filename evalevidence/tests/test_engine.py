import copy
import unittest
from datetime import timedelta

from evalevidence.contract import InputError, canonical_digest, timestamp
from evalevidence.demo import AT, scenario
from evalevidence.engine import analyze, receipt_digest


def codes(report):
    return {row['code'] for row in report['findings']}


class EvaluationTests(unittest.TestCase):
    def setUp(self):
        self.data = scenario()
        self.at = timestamp(AT)

    def failure(self, code):
        result = analyze(self.data, self.at)
        self.assertNotEqual(result['status'], 'NO_RECORDED_REGRESSION')
        self.assertIn(code, codes(result))
        return result

    def rehash(self, run='candidate'):
        for row in self.data[run]['results']:
            row['receipt_digest'] = receipt_digest(self.data[run], row)

    def test_clean_comparison_and_determinism(self):
        result = analyze(self.data, self.at)
        self.assertEqual(result['status'], 'NO_RECORDED_REGRESSION')
        self.assertEqual(result['compared_cases'], 3)
        self.assertEqual(result, analyze(self.data, self.at))

    def test_every_dropped_case_is_detected(self):
        for count in (1, 3, 17):
            for drop in range(count):
                self.data = scenario(count)
                self.data['candidate']['results'].pop(drop)
                result = self.failure('MISSING_RESULT')
                self.assertEqual(result['compared_cases'], count - 1)

    def test_error_or_skip_is_incomplete(self):
        for outcome in ['error', 'skipped']:
            self.data = scenario()
            self.data['candidate']['results'][0]['outcome'] = outcome
            self.rehash()
            self.assertEqual(self.failure('INCOMPLETE_RESULT')['status'], 'INCOMPLETE')

    def test_critical_failure_not_hidden_by_other_improvements(self):
        self.data['baseline']['results'][1]['outcome'] = 'fail'
        self.data['candidate']['results'][0]['outcome'] = 'fail'
        self.rehash('baseline')
        self.rehash()
        result = self.failure('CRITICAL_FAILURE')
        self.assertEqual(result['status'], 'REGRESSION')
        self.assertEqual(result['improved_cases'], 1)
        self.assertEqual(result['regressed_cases'], 1)

    def test_noncritical_existing_failure_remains_visible(self):
        for label in ['baseline', 'candidate']:
            self.data[label]['results'][1]['outcome'] = 'fail'
            self.rehash(label)
        self.assertEqual(self.failure('PERSISTING_FAILURE')['status'], 'REVIEW_REQUIRED')

    def test_latency_budget_boundary(self):
        self.data['candidate']['results'][1]['latency_ms'] = 150
        self.rehash()
        self.assertEqual(analyze(self.data, self.at)['status'], 'NO_RECORDED_REGRESSION')
        self.data['candidate']['results'][1]['latency_ms'] = 151
        self.rehash()
        self.failure('LATENCY_INCREASE')

    def test_duplicate_and_unknown_result(self):
        self.data['candidate']['results'].append(copy.deepcopy(self.data['candidate']['results'][0]))
        self.failure('DUPLICATE_RESULT')
        self.data = scenario()
        self.data['candidate']['results'][0]['case_id'] = 'UNKNOWN_PRIVATE_MARKER'
        result = self.failure('UNEXPECTED_CASE')
        self.assertNotIn('UNKNOWN_PRIVATE_MARKER', str(result))

    def test_cross_run_replay_and_tamper(self):
        self.data['candidate']['results'][0] = copy.deepcopy(self.data['baseline']['results'][0])
        self.failure('RECEIPT_DIGEST_MISMATCH')
        self.data = scenario()
        self.data['candidate']['results'][0]['latency_ms'] = 1
        self.failure('RECEIPT_DIGEST_MISMATCH')

    def test_scope_mismatch_prevents_comparison(self):
        for change in ['dataset_digest', 'evaluator_digest', 'policy_digest']:
            self.data = scenario()
            self.data['suite'][change] = 'f' * 64
            self.data['suite']['digest'] = canonical_digest({k:v for k,v in self.data['suite'].items() if k != 'digest'})
            result = self.failure('SUITE_BINDING_MISMATCH')
            self.assertEqual(result['status'], 'INCOMPARABLE')
            self.assertEqual(result['compared_cases'], 0)

    def test_suite_tamper_and_run_reuse(self):
        self.data['suite']['cases'][0]['critical'] = False
        self.failure('SUITE_DIGEST_MISMATCH')
        self.data = scenario()
        self.data['candidate']['id'] = self.data['baseline']['id']
        result = self.failure('RUN_ID_REUSED')
        self.assertEqual(result['compared_cases'], 0)

    def test_stale_future_and_timestamp_relabeling(self):
        self.at += timedelta(days=2)
        self.failure('STALE_RUN')
        self.at = timestamp(AT) - timedelta(hours=1)
        self.failure('FUTURE_RUN')
        self.at = timestamp(AT)
        self.data['candidate']['created_at'] = '2026-11-17T23:59:59Z'
        self.failure('RECEIPT_DIGEST_MISMATCH')

    def test_manifest_and_resource_refusals(self):
        for modify in [lambda d:d['suite']['cases'].append(d['suite']['cases'][0]),
                       lambda d:d['candidate']['results'][0].update(latency_ms=True),
                       lambda d:d['candidate'].update(prompt='PRIVATE'),
                       lambda d:d['suite'].update(cases=[]),
                       lambda d:d['candidate'].update(results=d['candidate']['results']*1000)]:
            with self.subTest(modify=modify):
                self.data = scenario()
                modify(self.data)
                with self.assertRaises(InputError):
                    analyze(self.data, self.at)

    def test_truncated_findings_never_clean(self):
        self.data = scenario(200)
        self.data['candidate']['results'] = []
        result = self.failure('MISSING_RESULT')
        self.assertTrue(result['findings_truncated'])
        self.assertEqual(result['finding_count'], 200)
        self.assertEqual(len(result['findings']), 128)
