"""Check that declarations, places and task methods cannot borrow a review."""
from copy import deepcopy
from datetime import date, timedelta
import json
from pathlib import Path
import sys
import unittest

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import customer_service as service
from planner_service import InputError
from replay_plan import build_export, verify_export
from test_customer_jobs import task, request, assessed, redigest


class SiteChecksTests(unittest.TestCase):
    def unassigned(self, value):
        result = service.plan_customer(value)
        self.assertTrue(all(row['person'] is None and row['robot'] is None for row in result['rows']))
        return result

    def test_complete_checks_and_explicit_review_allow_the_existing_manual_route(self):
        result = service.plan_customer(request())
        self.assertEqual(result['reviewStatus'], {'status': 'current', 'state': 'PASS'})
        self.assertEqual(result['assessment']['siteSafety'], 'PASS')
        self.assertEqual(result['rows'][0]['state'], 'MANUAL_ASSIGNED')
        self.assertFalse(result['scope']['releaseAuthority'])

    def test_ticks_alone_do_not_create_a_review(self):
        value = request()
        value['review'] = {'decision': 'UNKNOWN', 'scope': None}
        result = self.unassigned(value)
        self.assertEqual(result['reviewStatus']['status'], 'missing')
        self.assertEqual(result['rows'][0]['state'], 'WITHHELD_SHARED')

    def test_incomplete_pass_review_withholds(self):
        for key, replacement in (('by', ''), ('date', ''), ('scope', None)):
            with self.subTest(key=key):
                value = request(); value['review'][key] = replacement
                self.assertEqual(self.unassigned(value)['reviewStatus']['status'], 'incomplete')

    def test_review_failure_cannot_be_bypassed_by_scope_or_missing_checks(self):
        value = request(); value['review']['decision'] = 'FAIL'; value['review']['scope'] = None
        value['siteChecks']['accessArranged'] = 'UNKNOWN'
        result = self.unassigned(value)
        self.assertEqual(result['assessment']['siteSafety'], 'FAIL')
        self.assertEqual(result['rows'][0]['state'], 'BLOCKED_SHARED')

    def test_negative_shared_and_place_checks_remain_negative_without_review(self):
        value = request(); value['review']['decision'] = 'UNKNOWN'
        value['siteChecks']['siteRulesReviewed'] = 'FAIL'
        value['rooms'][0]['checks']['hazards'] = 'FAIL'
        value['tasks'][0]['checks']['surface']['permission'] = 'FAIL'
        result = self.unassigned(value)
        self.assertEqual(result['assessment']['siteSafety'], 'FAIL')
        self.assertEqual(result['assessment']['tasks']['T1']['placeSafety'], 'FAIL')
        self.assertEqual(result['assessment']['tasks']['T1']['contactPermission'], 'FAIL')

    def test_each_check_is_required_even_after_a_current_review(self):
        for group, fields in (('area', ('routes', 'people', 'hazards')),
                              ('surface', ('permission', 'condition', 'method')),
                              ('manual', ('permission', 'equipment', 'training'))):
            for key in fields:
                for answer in ('UNKNOWN', 'FAIL'):
                    with self.subTest(group=group, key=key, answer=answer):
                        value = request()
                        target = value['rooms'][0]['checks'] if group == 'area' else value['tasks'][0]['checks'][group]
                        target[key] = answer
                        self.unassigned(assessed(value))
        for key in ('accessArranged', 'siteRulesReviewed'):
            for answer in ('UNKNOWN', 'FAIL'):
                value = request(); value['siteChecks'][key] = answer
                self.unassigned(assessed(value))

    def test_same_place_conflicting_facts_are_refused_in_both_orders(self):
        for group, key in (('area', 'routes'), ('area', 'people'), ('area', 'hazards'),
                           ('surface', 'permission'), ('surface', 'condition')):
            for reverse in (False, True):
                a, b = task('A', place='Pane'), task('B', place='  PANE ', room=' office ')
                b['checks'][group][key] = 'FAIL'
                value = request(*([b, a] if reverse else [a, b]))
                with self.subTest(group=group, key=key, reverse=reverse), self.assertRaisesRegex(InputError, 'same place|Room IDs'):
                    service.plan_customer(value)

    def test_same_place_matching_checks_share_location_but_not_methods(self):
        for missing in ('', 'different method'):
            a, b = task('A', place='Pane'), task('B', place='Pane', method=missing)
            if missing: b['checks']['surface']['method'] = 'FAIL'
            result = service.plan_customer(request(a, b))
            self.assertEqual(result['rows'][0]['state'], 'MANUAL_ASSIGNED')
            self.assertIsNone(result['rows'][1]['person'])
            self.assertIn('method', result['rows'][1]['reason'])
            self.assertEqual(result['scenario']['tasks'][0]['location'], result['scenario']['tasks'][1]['location'])
            self.assertEqual(result['assessment']['tasks']['B']['contactPermission'], 'PASS')
            self.assertNotEqual(result['assessment']['tasks']['B']['manualPermission'], 'PASS')

    def test_unsafe_room_does_not_borrow_other_room_checks(self):
        a, b = task('A', place='Pane A'), task('B', room='Other room', place='Pane B')
        b['checks']['area']['hazards'] = 'FAIL'
        result = service.plan_customer(request(a, b))
        self.assertEqual(result['rows'][0]['state'], 'MANUAL_ASSIGNED')
        self.assertEqual(result['rows'][1]['state'], 'BLOCKED_SHARED')

    def test_changed_building_company_method_team_or_task_makes_review_stale(self):
        mutations = [lambda q: q['context'].update(buildingId='other'),
                     lambda q: q['context'].update(buildingName='Other name'),
                     lambda q: q['context'].update(company='Other company'),
                     lambda q: q['context'].update(customer='Other customer'),
                     lambda q: q['tasks'][0].update(method='Use another tool'),
                     lambda q: q['tasks'][0].update(place='Other pane'),
                     lambda q: q['tasks'][0].update(round=2),
                     lambda q: q['people'][0]['availability'].update({'round-1': 'BUSY'}),
                     lambda q: q['robots'].remove('G1')]
        for mutation in mutations:
            value = request(); mutation(value)
            result = self.unassigned(value)
            self.assertEqual(result['reviewStatus']['status'], 'stale')
            self.assertEqual(result['rows'][0]['state'], 'WITHHELD_SHARED')

    def test_scope_equality_preserves_types_and_raw_whitespace(self):
        for mutation in (lambda q: q['review']['scope']['tasks'][0].update(round=True),
                         lambda q: q['review']['scope']['tasks'][0].update(round=1.0),
                         lambda q: q['review']['scope']['tasks'][0].update(room=' Office ')):
            value = request(); mutation(value)
            self.assertEqual(self.unassigned(value)['reviewStatus']['status'], 'stale')

    def test_fresh_review_does_not_cross_building_identity(self):
        a = request(); b = deepcopy(a); b['context']['buildingId'] = 'building-2'; assessed(b)
        first, second = service.plan_customer(a), service.plan_customer(b)
        for key in ('location', 'area'):
            self.assertNotEqual(first['scenario']['tasks'][0][key], second['scenario']['tasks'][0][key])
        self.assertNotEqual(first['scenario']['id'], second['scenario']['id'])
        self.assertEqual(second['rows'][0]['state'], 'MANUAL_ASSIGNED')

    def test_unknown_specialist_access_and_facade_never_assign(self):
        for kind, access in (('glass', 'UNKNOWN'), ('glass', 'SPECIALIST'),
                             ('facade', 'ORDINARY'), ('facade', 'SPECIALIST'), ('facade', 'UNKNOWN')):
            value = request(task(kind=kind, access=access))
            value['people'][0]['additionalTraining'] = list(service.TRAINING)
            value['tasks'][0]['specialist'] = {'accessPlan': 'A described plan', 'weather': 'PASS', 'ground': 'PASS', 'publicProtection': 'PASS'}
            result = self.unassigned(assessed(value))
            self.assertNotIn('manual_alternative', result['scenario']['tasks'][0])

    def test_missing_method_prevents_route_even_when_all_check_answers_pass(self):
        result = self.unassigned(request(task(method='')))
        self.assertEqual(result['rows'][0]['reason'], 'The cleaning method is missing.')
        self.assertNotIn('manual_alternative', result['scenario']['tasks'][0])

    def test_legacy_direct_guards_and_unknown_fields_are_refused(self):
        old = {'siteSafety': 'PASS', 'robots': [], 'people': [], 'tasks': []}
        with self.assertRaises(InputError): service.plan_customer(old)
        for key in ('siteSafety', 'dispatch', 'evidence', 'reviewed'):
            value = request(); value[key] = 'PASS'
            with self.assertRaises(InputError): service.plan_customer(value)
        for key in ('manualPermission', 'contactPermission', 'placeSafety', 'requiresSpecialAccess'):
            value = request(); value['tasks'][0][key] = 'PASS'
            with self.assertRaises(InputError): service.plan_customer(value)

    def test_invalid_dates_and_future_dates_are_rejected_without_an_export(self):
        for invalid in ('2026-02-30', '2026/11/09', '99-01-01', (date.today() + timedelta(days=1)).isoformat()):
            value = request(); value['review']['date'] = invalid
            with self.subTest(invalid=invalid), self.assertRaises(InputError): service.plan_customer(value)

    def test_invalid_nested_shapes_and_na_cannot_skip_checks(self):
        mutations = [lambda q: q['rooms'][0]['checks'].update(routes='N/A'),
                     lambda q: q['tasks'][0]['checks']['surface'].update(extra='PASS'),
                     lambda q: q['tasks'][0]['specialist'].update(weather=True),
                     lambda q: q['context'].update(buildingId=''),
                     lambda q: q['review'].update(scope=[]),
                     lambda q: q.update(schemaVersion=True)]
        for mutation in mutations:
            value = request(); mutation(value)
            with self.assertRaises(InputError): service.plan_customer(value)

    def test_new_schema_exports_every_check_and_rejects_rehashed_forged_review(self):
        value = request(); result = service.plan_customer(value)
        exported = build_export('customer', value, result)
        self.assertTrue(verify_export(exported)['sameResult'])
        self.assertEqual(exported['effectiveInputs']['review']['scope'], value['review']['scope'])
        self.assertEqual(exported['output']['assessment'], result['assessment'])
        forged = deepcopy(exported); forged['inputs']['tasks'][0]['method'] = 'Changed method'
        redigest(forged)
        with self.assertRaisesRegex(InputError, 'fresh computation'): verify_export(forged)

    def test_twelve_maximum_ascii_tasks_fit_existing_body_bound(self):
        value = request(*[task('T'+str(i), room='r'*100, place='p'*99+str(i % 10), method='m'*300,
            specialist={'accessPlan': 'a'*300, 'weather': 'UNKNOWN', 'ground': 'UNKNOWN', 'publicProtection': 'UNKNOWN'})
            for i in range(12)])
        for key in value['context']: value['context'][key] = 'a'*100
        assessed(value)
        self.assertLess(len(json.dumps(value).encode()), 65536)
        self.assertEqual(len(service.plan_customer(value)['rows']), 12)


if __name__ == '__main__':
    unittest.main(verbosity=2)
