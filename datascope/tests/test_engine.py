import copy
import unittest
from datetime import timedelta

from datascope.contract import InputError, timestamp
from datascope.demo import AT, scenario
from datascope.engine import analyze


def codes(report):
    return {row['code'] for row in report['findings']}


class ProvenanceTests(unittest.TestCase):
    def setUp(self):
        self.data = scenario()
        self.at = timestamp(AT)

    def failure(self, code):
        result = analyze(self.data, self.at)
        self.assertNotEqual(result['status'], 'DECLARATIONS_MATCH')
        self.assertIn(code, codes(result))
        return result

    def test_matching_transitive_records(self):
        result = analyze(self.data, self.at)
        self.assertEqual(result['status'], 'DECLARATIONS_MATCH')
        self.assertEqual(result['lineage_records_required'], 2)
        self.assertEqual(result, analyze(self.data, self.at))

    def test_parent_cannot_launder_restricted_purpose(self):
        self.data['permissions'][0]['allowed_purposes'] = ['training']
        result = self.failure('PURPOSE_NOT_LISTED')
        self.assertEqual(result['status'], 'DECLARED_RESTRICTION')
        self.assertEqual(result['findings'][0]['scope'], 'synthetic-data-0')

    def test_parent_must_allow_derivation(self):
        self.data['permissions'][0]['allow_derivation'] = False
        self.failure('DERIVATION_NOT_LISTED')
        self.data['permissions'][0]['allow_derivation'] = True
        self.data['permissions'][1]['allow_derivation'] = False
        self.assertEqual(analyze(self.data, self.at)['status'], 'DECLARATIONS_MATCH')

    def test_digest_and_source_bound_to_grant(self):
        self.data['datasets'][0]['content_digest'] = 'f' * 64
        self.failure('PERMISSION_VERSION_MISMATCH')
        self.data = scenario()
        self.data['permissions'][0]['source_id'] = 'other-source'
        self.failure('PERMISSION_SOURCE_MISMATCH')

    def test_review_denied_and_pending(self):
        self.data['permissions'][0]['decision'] = 'denied'
        self.assertEqual(self.failure('DECLARED_REVIEW_DENIAL')['status'], 'DECLARED_RESTRICTION')
        self.data['permissions'][0]['decision'] = 'pending'
        self.assertEqual(self.failure('REVIEW_PENDING')['status'], 'REVIEW_REQUIRED')

    def test_expiry_is_inclusive_and_review_staleness_explicit(self):
        self.data['permissions'][0]['expires_at'] = AT
        self.failure('PERMISSION_EXPIRED')
        self.data = scenario()
        self.at += timedelta(days=2)
        self.failure('REVIEW_STALE')
        self.failure('SOURCE_STALE')

    def test_source_unavailable_or_missing(self):
        self.data['sources'][0]['available'] = False
        self.assertEqual(self.failure('SOURCE_UNAVAILABLE')['status'], 'REVIEW_REQUIRED')
        self.data['sources'] = []
        self.failure('SOURCE_RECORD_MISSING')

    def test_future_metadata_not_trusted(self):
        self.at -= timedelta(hours=1)
        self.failure('SOURCE_IN_FUTURE')
        self.failure('REVIEW_IN_FUTURE')

    def test_missing_parent_permission_and_target(self):
        self.data['datasets'][1]['derived_from'] = ['absent-parent']
        self.failure('DATASET_OR_PARENT_MISSING')
        self.data = scenario()
        self.data['permissions'].pop(0)
        self.failure('PERMISSION_RECORD_MISSING')
        self.data['request']['dataset_id'] = 'absent-target'
        self.failure('DATASET_OR_PARENT_MISSING')

    def test_cycles_including_disconnected_cycle_refused(self):
        self.data['datasets'][0]['derived_from'] = ['synthetic-data-1']
        with self.assertRaisesRegex(InputError, 'LINEAGE_CYCLE'):
            analyze(self.data, self.at)
        self.data = scenario(3)
        self.data['request']['dataset_id'] = 'synthetic-data-0'
        self.data['datasets'][1]['derived_from'] = ['synthetic-data-2']
        with self.assertRaisesRegex(InputError, 'LINEAGE_CYCLE'):
            analyze(self.data, self.at)

    def test_maximum_chain_nonrecursive_and_each_parent_checked(self):
        self.data = scenario(256)
        self.assertEqual(analyze(self.data, self.at)['lineage_records_present'], 256)
        for index in [0, 127, 255]:
            self.data['permissions'][index]['decision'] = 'denied'
            self.failure('DECLARED_REVIEW_DENIAL')
            self.data['permissions'][index]['decision'] = 'approved'

    def test_duplicate_ids_fields_and_limits_refused(self):
        for change in [lambda d:d['datasets'].append(copy.deepcopy(d['datasets'][0])),
                       lambda d:d['datasets'][1].update(derived_from=['synthetic-data-0']*2),
                       lambda d:d['permissions'][0].update(allow_derivation=1),
                       lambda d:d['permissions'][0].update(allowed_purposes=['evaluation']*2),
                       lambda d:d['datasets'][0].update(document='PRIVATE'),
                       lambda d:d.update(datasets=d['datasets']*200),
                       lambda d:d['request'].update(purpose='guessed_permission')]:
            self.data = scenario()
            change(self.data)
            with self.assertRaises(InputError):
                analyze(self.data, self.at)

    def test_findings_capped_but_failure_and_total_preserved(self):
        self.data = scenario(200)
        self.data['permissions'] = []
        result = self.failure('PERMISSION_RECORD_MISSING')
        self.assertEqual(result['finding_count'], 200)
        self.assertEqual(len(result['findings']), 128)
        self.assertTrue(result['findings_truncated'])
