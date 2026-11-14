"""Check the saved-example contract used by the beginner's guided screens."""
from copy import deepcopy
from pathlib import Path
import sys
import unittest

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import planner_service as service


TESTED_TASKS = {'UR3': 'T-SH', 'UR5': 'T-WB-L', 'G1': 'T-WS-D'}
CUSTOMER_TASKS = {'UR3': 'SH1', 'UR5': 'WB1-L', 'G1': 'WS1'}


def example(robot=None, *, context='tested_contexts', helper='AVAILABLE', cleaner='AVAILABLE', force=7):
    payload = {
        'scenario': context,
        'robots': [robot] if robot else [],
        'sharedSafety': 'PASS',
        'peopleAvailability': {
            'H1': {'slot-1': helper, 'slot-2': helper},
            'H2': {'slot-1': cleaner, 'slot-2': cleaner},
        },
        'declarations': {},
    }
    if robot == 'G1':
        payload['force'] = {'min': force, 'max': force}
    return payload


def task(response, task_id):
    return next(row for row in response['plan']['tasks'] if row['id'] == task_id)


def actions(response, task_id):
    return [a for a in response['availableActions'] if a['taskId'] == task_id]


class BeginnerContractTests(unittest.TestCase):
    def test_each_task_has_its_own_recorded_context_and_next_step(self):
        for robot, task_id in TESTED_TASKS.items():
            with self.subTest(robot=robot):
                response = service.plan_job(example(robot))
                row = task(response, task_id)
                expected = 'RECOMMENDED' if robot == 'UR5' else 'PENDING_CONFIRMATION'
                self.assertEqual(row['state'], expected)
                self.assertEqual(row['person'], 'H1')
                self.assertEqual([a['kind'] for a in actions(response, task_id)],
                                 [] if robot == 'UR5' else ['confirm'])
                self.assertFalse(response['scope']['dispatch'])
                self.assertFalse(response['scope']['robotConnection'])

    def test_worker_busy_overrides_display_even_when_selector_says_select(self):
        for robot, task_id in TESTED_TASKS.items():
            with self.subTest(robot=robot):
                response = service.plan_job(example(robot, helper='BUSY'))
                row = task(response, task_id)
                self.assertEqual(row['state'], 'WAITING_FOR_PERSON')
                self.assertIsNone(row['person'])
                self.assertFalse(actions(response, task_id))
                if robot == 'UR5':
                    self.assertEqual(row['selector']['decision'], 'SELECT')

    def test_g1_exact_7_and_8_n_require_a_separate_explicit_confirmation(self):
        for force in (7, 8):
            with self.subTest(force=force):
                payload = example('G1', force=force)
                first = service.plan_job(payload)
                row = task(first, 'T-WS-D')
                self.assertEqual(row['state'], 'PENDING_CONFIRMATION')
                self.assertEqual(row['selector']['configuration'], f'G1_D_{force}N')
                action, = actions(first, 'T-WS-D')
                payload['declarations'][action['taskId']] = deepcopy(action['declaration'])
                second = service.plan_job(payload)
                row = task(second, 'T-WS-D')
                self.assertEqual(row['state'], 'RECOMMENDED')
                self.assertEqual(row['person'], 'H1')
                self.assertEqual(row['robot']['setpoint_n'], force)
                self.assertFalse(second['scope']['releaseAuthority'])

    def test_customer_task_mapping_never_inherits_the_tested_context(self):
        for robot, task_id in CUSTOMER_TASKS.items():
            for helper in ('AVAILABLE', 'BUSY'):
                with self.subTest(robot=robot, helper=helper):
                    response = service.plan_job(example(robot, context='customer_building', helper=helper))
                    row = task(response, task_id)
                    self.assertEqual(row['state'], 'BLOCKED_EVIDENCE')
                    self.assertIsNone(row['robot'])
                    self.assertIsNone(row['person'])
                    self.assertFalse(actions(response, task_id))
                    if robot == 'G1':
                        request = next(t['request'] for t in response['scenario']['tasks'] if t['id'] == task_id)
                        self.assertEqual(request['domain'], 'physical')

    def test_glass_cleaning_uses_actual_training_and_available_person(self):
        for helper, cleaner, expected_state, person in (
            ('AVAILABLE', 'AVAILABLE', 'MANUAL_ASSIGNED', 'H1'),
            ('BUSY', 'AVAILABLE', 'MANUAL_ASSIGNED', 'H2'),
            ('AVAILABLE', 'BUSY', 'MANUAL_ASSIGNED', 'H1'),
            ('BUSY', 'BUSY', 'WAITING_FOR_PERSON', None),
        ):
            with self.subTest(helper=helper, cleaner=cleaner):
                response = service.plan_job(example(context='customer_building', helper=helper, cleaner=cleaner))
                row = task(response, 'GP1')
                self.assertEqual(row['state'], expected_state)
                self.assertEqual(row['person'], person)
                self.assertIsNone(row['robot'])
                self.assertEqual(row['route'], 'manual')
                self.assertFalse(actions(response, 'GP1'))

    def test_glass_cleaner_never_replaces_robot_helper(self):
        for robot, task_id in TESTED_TASKS.items():
            with self.subTest(robot=robot):
                response = service.plan_job(example(robot, helper='BUSY', cleaner='AVAILABLE'))
                self.assertEqual(task(response, task_id)['state'], 'WAITING_FOR_PERSON')
                self.assertIsNone(task(response, task_id)['person'])
                self.assertFalse(actions(response, task_id))

    def test_unknown_and_unsafe_area_block_human_and_robot_routes(self):
        for safety, expected in [('UNKNOWN', 'WITHHELD_SHARED'),
                                 ('CONFLICTING', 'WITHHELD_SHARED'), ('FAIL', 'BLOCKED_SHARED')]:
            for robot, task_id in [(None, 'GP1'), *TESTED_TASKS.items()]:
                with self.subTest(safety=safety, robot=robot):
                    payload = example(robot, context='customer_building' if robot is None else 'tested_contexts')
                    payload['sharedSafety'] = safety
                    response = service.plan_job(payload)
                    row = task(response, task_id)
                    self.assertEqual(row['state'], expected)
                    self.assertIsNone(row['person'])
                    self.assertIsNone(row['robot'])
                    self.assertFalse(response['availableActions'])
                    self.assertTrue(all(t['person'] is None and t['robot'] is None for t in response['plan']['tasks']))

    def test_ur5_on_same_roster_books_helper_before_g1(self):
        payload = example('G1')
        payload['robots'] = ['G1', 'UR5']
        response = service.plan_job(payload)
        self.assertEqual(task(response, 'T-WB-L')['state'], 'RECOMMENDED')
        self.assertEqual(task(response, 'T-WB-L')['person'], 'H1')
        self.assertEqual(task(response, 'T-WS-D')['state'], 'WAITING_FOR_PERSON')
        self.assertFalse(actions(response, 'T-WS-D'))
        self.assertEqual(response['plan']['reservations']['people']['slot-1:H1'], 'T-WB-L')

    def test_changed_guided_answers_require_a_new_confirmation(self):
        payload = example('G1')
        first = service.plan_job(payload)
        action, = actions(first, 'T-WS-D')
        payload['declarations'][action['taskId']] = deepcopy(action['declaration'])
        for change in ({'force': {'min': 8, 'max': 8}}, {'robots': ['G1', 'UR5']},
                       {'peopleAvailability': {'H1': {'slot-1': 'BUSY', 'slot-2': 'AVAILABLE'}}},
                       {'sharedSafety': 'UNKNOWN'}, {'scenario': 'customer_building'}):
            with self.subTest(change=change), self.assertRaises(service.InputError):
                service.plan_job({**deepcopy(payload), **change})
        changed = {**deepcopy(payload), 'force': {'min': 8, 'max': 8}, 'declarations': {}}
        self.assertEqual(task(service.plan_job(changed), 'T-WS-D')['state'], 'PENDING_CONFIRMATION')

    def test_optional_range_choice_is_not_an_automatic_best_force(self):
        payload = example('G1')
        payload['force'] = {'min': 6, 'max': 8}
        first = service.plan_job(payload)
        self.assertEqual(task(first, 'T-WS-D')['state'], 'PENDING_CHOICE')
        offered = actions(first, 'T-WS-D')
        self.assertEqual({a['candidateId'] for a in offered}, {'G1_D_7N', 'G1_D_8N'})
        self.assertTrue(all(a['kind'] == 'choice' for a in offered))
        choice = next(a for a in offered if a['candidateId'] == 'G1_D_8N')
        payload['declarations'][choice['taskId']] = deepcopy(choice['declaration'])
        second = service.plan_job(payload)
        self.assertEqual(task(second, 'T-WS-D')['state'], 'PENDING_CONFIRMATION')
        confirmation, = actions(second, 'T-WS-D')
        self.assertIn('choice', confirmation['declaration'])
        self.assertEqual(confirmation['kind'], 'confirm')


if __name__ == '__main__':
    unittest.main(verbosity=2)
