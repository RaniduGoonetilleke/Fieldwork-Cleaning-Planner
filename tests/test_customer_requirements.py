"""Customer inputs change the request without creating new robot evidence."""
from copy import deepcopy
from pathlib import Path
import sys
import unittest
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import planner_service as service


def request(force=None, contact='PASS'):
    return {'scenario': 'tested_contexts', 'robots': ['G1'], 'sharedSafety': 'PASS',
            'taskRequirements': {'T-WS-D': {'force': force or {'min': 7, 'max': 7},
                                         'contactPermission': contact}}, 'declarations': {}}


def row(result, task='T-WS-D'):
    return next(t for t in result['plan']['tasks'] if t['id'] == task)


class CustomerRequirementTests(unittest.TestCase):
    def test_exact_and_interval_requests_keep_their_meanings(self):
        for force, expected, offered in [({'min': 7, 'max': 7}, 'PENDING_CONFIRMATION', {'G1_D_7N'}),
                                        ({'min': 8, 'max': 8}, 'PENDING_CONFIRMATION', {'G1_D_8N'}),
                                        ({'min': 7.5, 'max': 7.5}, 'BLOCKED_EVIDENCE', set()),
                                        ({'min': 6, 'max': 8}, 'PENDING_CHOICE', {'G1_D_7N', 'G1_D_8N'}),
                                        ({'min': 7.5, 'max': 8}, 'PENDING_CONFIRMATION', {'G1_D_8N'}),
                                        ({'min': 9, 'max': 11}, 'BLOCKED_EVIDENCE', set())]:
            with self.subTest(force=force):
                result = service.plan_job(request(force))
                self.assertEqual(row(result)['state'], expected)
                self.assertEqual({a['candidateId'] for a in result['availableActions'] if a['taskId'] == 'T-WS-D'}, offered)
                self.assertFalse(result['scope']['dispatch'])

    def test_force_changes_only_the_named_task(self):
        result = service.plan_job(request({'min': 8, 'max': 8}))
        for actual, original in zip(result['scenario']['tasks'], service.SCENARIOS['tested_contexts']['tasks']):
            if actual['id'] == 'T-WS-D':
                self.assertEqual(actual['request']['force']['minimum_n'], 8)
                self.assertEqual(actual['request']['allowed_targets'], ['D'])
            else: self.assertEqual(actual, original)
        self.assertEqual(service.SCENARIOS['tested_contexts']['tasks'][1]['request']['force']['minimum_n'], 6)

    def test_permission_is_a_separate_check(self):
        for permission, expected in [('UNKNOWN', 'WITHHELD_TASK_CONDITION'), ('CONFLICTING', 'WITHHELD_TASK_CONDITION'),
                                     ('FAIL', 'BLOCKED_TASK_CONDITION'), ('PASS', 'PENDING_CONFIRMATION')]:
            with self.subTest(permission=permission):
                result = service.plan_job(request(contact=permission))
                self.assertEqual(row(result)['state'], expected)
                if permission != 'PASS':
                    self.assertIsNone(row(result)['robot'])
                    self.assertFalse([a for a in result['availableActions'] if a['taskId'] == 'T-WS-D'])

    def test_permission_cannot_override_area_safety(self):
        for safety, expected in [('UNKNOWN', 'WITHHELD_SHARED'), ('FAIL', 'BLOCKED_SHARED')]:
            payload = request(); payload['sharedSafety'] = safety
            result = service.plan_job(payload)
            self.assertEqual(row(result)['state'], expected)
            self.assertIsNone(row(result)['person']); self.assertIsNone(row(result)['robot'])

    def test_permission_stays_tied_to_the_place(self):
        result = service.plan_job(request(contact='FAIL'))
        for conditions in result['scenario']['conditions'].values():
            self.assertEqual(conditions['locations']['g1_wall_location_D']['contact_permission'], 'FAIL')
            self.assertEqual(conditions['locations']['g1_wall_between_A_and_B']['contact_permission'], 'PASS')
            self.assertEqual(conditions['areas'], service.SCENARIOS['tested_contexts']['conditions']['slot-1']['areas'])
            self.assertEqual(conditions['locations']['g1_wall_location_D']['safety'], 'PASS')

    def test_changed_requirement_invalidates_prior_confirmation(self):
        payload = request(); result = service.plan_job(payload)
        action = next(a for a in result['availableActions'] if a['taskId'] == 'T-WS-D')
        payload['declarations']['T-WS-D'] = deepcopy(action['declaration'])
        self.assertEqual(row(service.plan_job(payload))['state'], 'RECOMMENDED')
        for new in ({'force': {'min': 8, 'max': 8}, 'contactPermission': 'PASS'},
                    {'force': {'min': 7, 'max': 7}, 'contactPermission': 'UNKNOWN'}):
            changed = deepcopy(payload); changed['taskRequirements']['T-WS-D'] = new
            with self.assertRaises(service.InputError): service.plan_job(changed)
            changed['declarations'] = {}
            self.assertNotEqual(row(service.plan_job(changed))['state'], 'RECOMMENDED')

    def test_free_robot_still_needs_free_helper(self):
        payload = request({'min': 8, 'max': 8}); payload['peopleAvailability'] = {'H1': {'slot-1': 'BUSY'}}
        self.assertEqual(row(service.plan_job(payload))['state'], 'WAITING_FOR_PERSON')

    def test_customer_building_keeps_physical_context_and_gap(self):
        payload = {'scenario': 'customer_building', 'robots': ['G1'], 'sharedSafety': 'PASS',
                   'taskRequirements': {'WS1': {'force': {'min': 7, 'max': 8}, 'contactPermission': 'PASS'}}}
        result = service.plan_job(payload)
        self.assertEqual(row(result, 'WS1')['state'], 'BLOCKED_EVIDENCE')
        task = next(t for t in result['scenario']['tasks'] if t['id'] == 'WS1')
        self.assertEqual(task['request']['domain'], 'physical'); self.assertEqual(task['location'], 'wall_spot_1')

    def test_bad_customer_fields_rejected(self):
        for overrides in ({'missing': {}}, {'T-WS-D': {'location': 'g1_wall_between_A_and_B'}},
                          {'T-WS-D': {'contactPermission': True}}, {'T-WB-L': {'force': {'min': 7, 'max': 7}}},
                          {'T-WS-D': {'force': {'min': 8, 'max': 7}}}, {'T-WS-D': {'force': {'min': True, 'max': 8}}}):
            with self.subTest(overrides=overrides), self.assertRaises(service.InputError):
                service.plan_job({'scenario': 'tested_contexts', 'taskRequirements': overrides})

    def test_manual_route_obeys_place_permission(self):
        for permission, expected in [('PASS', 'MANUAL_ASSIGNED'), ('FAIL', 'BLOCKED_TASK_CONDITION'),
                                     ('UNKNOWN', 'WITHHELD_TASK_CONDITION')]:
            result = service.plan_job({'scenario': 'customer_building', 'robots': [], 'sharedSafety': 'PASS',
                                      'taskRequirements': {'GP1': {'contactPermission': permission}}})
            self.assertEqual(row(result, 'GP1')['state'], expected)


    def test_conflicting_permissions_at_one_place_are_refused_in_both_orders(self):
        pairs = [('T-WB-L', {'contactPermission': 'PASS'}), ('T-WB-W', {'contactPermission': 'FAIL'})]
        before = deepcopy(service.SCENARIOS['tested_contexts'])
        for ordered in (pairs, list(reversed(pairs))):
            with self.subTest(order=[k for k, _ in ordered]), self.assertRaisesRegex(service.InputError, 'same place'):
                service.plan_job({'scenario': 'tested_contexts', 'taskRequirements': dict(ordered)})
        self.assertEqual(service.SCENARIOS['tested_contexts'], before)

    def test_same_permission_for_shared_place_is_order_independent(self):
        for permission in ('UNKNOWN', 'FAIL', 'PASS'):
            pairs = [('T-WB-L', {'contactPermission': permission}), ('T-WB-W', {'contactPermission': permission})]
            results = [service.plan_job({'scenario': 'tested_contexts', 'taskRequirements': dict(ordered)})
                       for ordered in (pairs, list(reversed(pairs)))]
            self.assertEqual(results[0]['plan'], results[1]['plan'])
            self.assertEqual(results[0]['jobBinding'], results[1]['jobBinding'])
            for conditions in results[0]['scenario']['conditions'].values():
                self.assertEqual(conditions['locations']['ur5_tested_whiteboard']['contact_permission'], permission)


if __name__ == '__main__': unittest.main(verbosity=2)
