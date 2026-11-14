"""Independent checks of misleading or unsafe interpretations of customer jobs."""
from copy import deepcopy
from hashlib import sha256
import json
from pathlib import Path
import sys
import unittest

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import customer_service as customer
import planner_service as service
import replay_plan as replay
from test_customer_jobs import layout


def task(ident='task-1', kind='glass', place='Window 1', room='Meeting room', **changes):
    legacy = {k: changes.pop(k) for k in ('manualPermission', 'placeSafety', 'contactPermission', 'requiresSpecialAccess') if k in changes}
    result = {
        'id': ident, 'type': kind, 'room': room, 'place': place, 'round': 1,
        'dependsOn': None, 'method': 'Approved damp cloth method', 'access': 'ORDINARY',
        'checks': {'area': dict.fromkeys(('routes','people','hazards'),'PASS'),
                   'surface': dict.fromkeys(('permission','condition','method'),'PASS'),
                   'manual': dict.fromkeys(('permission','equipment','training'),'PASS')},
        'specialist': {'accessPlan':'','weather':'UNKNOWN','ground':'UNKNOWN','publicProtection':'UNKNOWN'},
    }
    for field, group, key in [('manualPermission','manual','permission'),('placeSafety','area','hazards'),('contactPermission','surface','permission')]:
        if field in legacy: result['checks'][group][key] = legacy[field]
    if legacy.get('requiresSpecialAccess'): result['access']='SPECIALIST'
    result.update(changes)
    return result


def person(ident='H1', availability='AVAILABLE', training=()):
    return {
        'id': ident,
        'availability': {'round-1': availability, 'round-2': availability},
        'additionalTraining': list(training),
    }


def reviewed(value):
    """Declare a new assessment for these guard probes; stale scopes have separate tests."""
    value=deepcopy(value)
    value.pop('review',None)
    scope=deepcopy(value)
    value['review']={'by':'Example assessor','date':'2026-11-09','reference':'Probe fixture',
                     'decision':'PASS','scope':scope}
    return value


def planned(value):
    return customer.plan_customer(reviewed(value))


def job(tasks=None, people=None, **changes):
    roster = deepcopy(people) if people is not None else [person()]
    if len(roster) == 1:
        other = 'H2' if roster[0]['id'] == 'H1' else 'H1'
        roster.append(person(other, availability='BUSY'))
    site=changes.pop('siteSafety','PASS')
    result = {
        'schemaVersion':3,
        'context':{'company':'Example Cleaning','customer':'Example client','buildingId':'site-one','buildingName':'Example building','jobName':'Probe'},
        'siteChecks':{'accessArranged':site,'siteRulesReviewed':'PASS'},
        'robots': ['G1', 'UR3', 'UR5'],
        'tasks': tasks if tasks is not None else [task()],
        'people': roster,
    }
    result['rooms'],result['tasks']=layout(result['tasks'])
    result.update(changes)
    return reviewed(result)


def canonical_rows(result):
    return result['plan']['tasks']


class ReviewerCustomerProbes(unittest.TestCase):
    def assert_unassigned(self, result):
        for row in canonical_rows(result):
            self.assertIsNone(row.get('robot'), row)
            self.assertIsNone(row.get('person'), row)
            self.assertNotIn(row['state'], ('MANUAL_ASSIGNED', 'RECOMMENDED'), row)

    def test_all_customer_tasks_keep_new_robot_work_unsupported(self):
        training = ('whiteboard_wiping', 'glass_wiping', 'wall_wiping',
                    'desk_wiping', 'floor_cleaning', 'ordinary_waste_handling')
        for kind in ('whiteboard', 'glass', 'wall', 'desks', 'floor', 'bins'):
            with self.subTest(kind=kind):
                result = planned(job([task(kind=kind)], [person(training=training)]))
                self.assertEqual(len(canonical_rows(result)), 1)
                self.assertEqual(canonical_rows(result)[0]['state'], 'MANUAL_ASSIGNED')
                self.assertIsNone(canonical_rows(result)[0]['robot'])
                self.assertFalse(result['scope']['dispatch'])
                self.assertTrue(result['rows'][0]['robotStatus'])

    def test_having_a_free_person_does_not_invent_training(self):
        for kind in ('wall', 'desks', 'floor', 'bins'):
            with self.subTest(kind=kind):
                self.assert_unassigned(planned(job([task(kind=kind)])))
        result = planned(job([task(kind='floor')], [person(training=['floor_cleaning'])]))
        self.assertEqual(canonical_rows(result)[0]['state'], 'MANUAL_ASSIGNED')

    def test_missing_roster_cannot_invent_people(self):
        with self.assertRaises(ValueError):
            planned(job(people=[]))

    def test_unknown_and_busy_people_are_never_reserved(self):
        for state in ('UNKNOWN', 'BUSY'):
            with self.subTest(state=state):
                self.assert_unassigned(planned(job(people=[person(availability=state)])))

    def test_permission_and_safety_do_not_borrow_from_other_place(self):
        for field in ('manualPermission', 'placeSafety', 'contactPermission'):
            for value in ('UNKNOWN', 'FAIL'):
                with self.subTest(field=field, value=value):
                    payload = job([
                        task('safe', place='Safe pane'),
                        task('other', room='Other room' if field == 'placeSafety' else 'Meeting room', place='Other pane', **{field: value}),
                    ], [person('H1'), person('H2')])
                    result = planned(payload)
                    by_id = {row['id']: row for row in canonical_rows(result)}
                    self.assertEqual(by_id['safe']['state'], 'MANUAL_ASSIGNED')
                    self.assertIsNone(by_id['other']['person'])
                    self.assertIsNone(by_id['other']['robot'])

    def test_unsafe_or_unassessed_site_blocks_every_assignment(self):
        for state in ('FAIL', 'UNKNOWN'):
            with self.subTest(state=state):
                self.assert_unassigned(planned(job(siteSafety=state)))

    def test_same_place_conflicting_safety_cannot_depend_on_task_order(self):
        for field in ('placeSafety', 'contactPermission'):
            first = task('a', **{field: 'PASS'})
            second = task('b', **{field: 'FAIL'})
            for rows in ([first, second], [second, first]):
                with self.subTest(field=field, order=[r['id'] for r in rows]):
                    with self.assertRaises(ValueError):
                        planned(job(rows, [person('H1'), person('H2')]))

    def test_same_place_name_in_different_rooms_stays_separate(self):
        result = planned(job([
            task('safe', room='Office A'),
            task('unsafe', room='Office B', placeSafety='FAIL'),
        ], [person('H1'), person('H2')]))
        rows = {row['id']: row for row in canonical_rows(result)}
        self.assertEqual(rows['safe']['state'], 'MANUAL_ASSIGNED')
        self.assertIsNone(rows['unsafe']['person'])

    def test_spelling_variations_cannot_hide_same_place_conflicts(self):
        for room, place in (('meeting ROOM', ' WINDOW 1 '),
                            ('Ｍｅｅｔｉｎｇ room', 'Window   1')):
            with self.subTest(room=room, place=place), self.assertRaises(ValueError):
                planned(job([
                    task('a'), task('b', room=room, place=place, contactPermission='FAIL'),
                ], [person('H1'), person('H2')]))

    def test_a_worker_cannot_be_assigned_to_two_jobs_in_one_round(self):
        payload = job([task('a', place='Pane A'), task('b', place='Pane B')])
        result = planned(payload)
        assigned = [row for row in canonical_rows(result) if row['person']]
        self.assertEqual(len(assigned), 1)
        self.assertEqual(assigned[0]['person'], 'H1')
        payload['people'][1] = person('H2')
        result = planned(payload)
        assigned = [row for row in canonical_rows(result) if row['person']]
        self.assertEqual({row['person'] for row in assigned}, {'H1', 'H2'})

    def test_previous_round_work_does_not_reserve_the_next_round(self):
        result = planned(job([
            task('a', place='Pane A'), task('b', place='Pane B', round=2),
        ]))
        self.assertEqual([row['person'] for row in canonical_rows(result)], ['H1', 'H1'])
        self.assertTrue(all(row['state'] == 'MANUAL_ASSIGNED' for row in canonical_rows(result)))

    def test_special_access_is_not_authorised_by_basic_training(self):
        result = planned(job([task(requiresSpecialAccess=True)]))
        self.assert_unassigned(result)
        self.assertTrue(result['rows'][0]['reason'])
        self.assertTrue(result['rows'][0]['nextAction'])

    def test_dependency_is_a_condition_not_an_invented_completion(self):
        payload = job([
            task('first', place='Pane A'),
            task('second', place='Pane B', round=2, dependsOn='first'),
        ])
        result = planned(payload)
        second = next(row for row in canonical_rows(result) if row['id'] == 'second')
        self.assertEqual(second['state'], 'CONDITIONAL_ON_INPUT')
        self.assertIsNone(second['person'])
        self.assertTrue(second['inputs'])
        payload['rooms'][0]['checks']['hazards'] = 'FAIL'
        result = planned(payload)
        second = next(row for row in canonical_rows(result) if row['id'] == 'second')
        self.assertEqual(second['state'], 'BLOCKED_SHARED')
        self.assertIsNone(second['person'])

    def test_unavailable_dependency_remains_conditional_instead_of_impossible(self):
        payload = job([
            task('first', place='Pane A'),
            task('second', place='Pane B', round=2, dependsOn='first'),
        ])
        payload['people'][0]['availability']['round-1'] = 'BUSY'
        result = planned(payload)
        rows = {row['id']: row for row in canonical_rows(result)}
        self.assertEqual(rows['first']['state'], 'WAITING_FOR_PERSON')
        self.assertEqual(rows['second']['state'], 'CONDITIONAL_ON_INPUT')

    def test_missing_upstream_manual_route_never_disappears_as_a_dependency(self):
        for reason in ({'manualPermission': 'UNKNOWN'}, {'manualPermission': 'FAIL'},
                       {'requiresSpecialAccess': True}):
            with self.subTest(reason=reason):
                result = planned(job([
                    task('first', place='Pane A', **reason),
                    task('second', place='Pane B', round=2, dependsOn='first'),
                ]))
                self.assert_unassigned(result)
                row = next(row for row in result['rows'] if row['id'] == 'second')
                self.assertIn('earlier job', row['reason'].lower())

    def test_dependency_cannot_name_absent_same_round_or_later_task(self):
        for rows in (
            [task(dependsOn='missing')],
            [task('a'), task('b', place='B', dependsOn='a')],
            [task('a', dependsOn='b'), task('b', place='B', round=2)],
        ):
            with self.subTest(tasks=rows), self.assertRaises(ValueError):
                planned(job(rows))

    def test_clients_cannot_inject_evidence_results_or_authorisations(self):
        for field, value in (
            ('catalogue', []), ('profiles', []), ('plan', {'state': 'RECOMMENDED'}),
            ('completions', [['task-1', 'complete']]), ('dispatch', True),
            ('robots', ['new-robot']), ('approved', True),
        ):
            with self.subTest(field=field), self.assertRaises(ValueError):
                planned(job(**{field: value}))

    def test_duplicate_worker_and_task_ids_cannot_duplicate_capacity(self):
        with self.assertRaises(ValueError):
            planned(job(people=[person('H1'), person('H1')]))
        with self.assertRaises(ValueError):
            planned(job([task('same'), task('same', place='Other')]))

    def test_rendered_explanations_exist_without_claiming_execution(self):
        for payload in (job(), job(siteSafety='UNKNOWN'), job([task(kind='floor')]),
                        job([task(requiresSpecialAccess=True)]),
                        job(people=[person(availability='BUSY')])):
            with self.subTest(payload=payload):
                result = planned(payload)
                self.assertFalse(result['scope']['dispatch'])
                for row in result['rows']:
                    self.assertTrue(row['reason'])
                    self.assertTrue(row['nextAction'])
                    self.assertNotIn('has cleaned', row['reason'].lower())
                    self.assertNotIn('cleaning completed', row['reason'].lower())

    def test_customer_planning_does_not_mutate_the_request(self):
        payload = job([task(kind='floor')], [person(training=['floor_cleaning'])])
        before = deepcopy(payload)
        planned(payload)
        self.assertEqual(payload, before)


def refresh_digest(envelope):
    """A reader can recompute a public hash; that must not legitimise fake results."""
    values = {key: value for key, value in envelope.items() if key != 'digest'}
    raw = json.dumps(values, sort_keys=True, separators=(',', ':'), ensure_ascii=False,
                     allow_nan=False).encode('utf-8')
    envelope['digest'] = sha256(raw).hexdigest()


class ReviewerExportProbes(unittest.TestCase):
    def exported(self):
        payload = job(siteSafety='UNKNOWN')
        return replay.build_export('customer', payload, planned(payload))

    def test_both_real_computation_paths_replay(self):
        for operation, payload, compute in (
            ('customer', job(), customer.plan_customer),
            ('job', {'scenario': 'tested_contexts'}, service.plan_job),
        ):
            with self.subTest(operation=operation):
                envelope = replay.build_export(operation, payload, compute(payload))
                before = deepcopy(envelope)
                verified = replay.verify_export(envelope)
                self.assertTrue(verified['verified'])
                self.assertTrue(verified['sameResult'])
                self.assertEqual(envelope, before)

    def test_forged_assignment_with_recomputed_hash_is_rejected(self):
        envelope = self.exported()
        envelope['output']['plan']['tasks'][0]['state'] = 'MANUAL_ASSIGNED'
        envelope['output']['plan']['tasks'][0]['person'] = 'H1'
        envelope['output']['rows'][0]['state'] = 'MANUAL_ASSIGNED'
        envelope['output']['rows'][0]['person'] = 'H1'
        envelope['output']['summary']['manualPlanned'] = 1
        refresh_digest(envelope)
        with self.assertRaises(ValueError):
            replay.verify_export(envelope)

    def test_changed_inputs_cannot_retain_an_earlier_output(self):
        payload = job()
        envelope = replay.build_export('customer', payload, planned(payload))
        envelope['inputs']['siteChecks']['accessArranged'] = 'FAIL'
        refresh_digest(envelope)
        with self.assertRaises(ValueError):
            replay.verify_export(envelope)

    def test_false_scope_and_missing_software_identity_are_rejected(self):
        base = self.exported()
        for change in ('dispatch', 'missing_file', 'software_hash', 'scenario'):
            envelope = deepcopy(base)
            if change == 'dispatch':
                envelope['output']['scope']['dispatch'] = True
            elif change == 'missing_file':
                envelope['software']['backendFiles'].pop('customer_service.py')
            elif change == 'software_hash':
                envelope['software']['backendFiles']['customer_service.py'] = '0' * 64
            else:
                envelope['scenario']['conditions']['round-1']['shared_safety'] = 'PASS'
            refresh_digest(envelope)
            with self.subTest(change=change), self.assertRaises(ValueError):
                replay.verify_export(envelope)

    def test_unsupported_version_or_operation_is_rejected_even_with_new_hash(self):
        for field, value in (('schemaVersion', True), ('schemaVersion', 1),
                             ('operation', 'dispatch'), ('operation', ['customer'])):
            envelope = self.exported()
            envelope[field] = value
            refresh_digest(envelope)
            with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                replay.verify_export(envelope)

    def test_tampered_input_requires_full_recomputation_not_just_new_hash(self):
        envelope = self.exported()
        envelope['inputs']['tasks'][0]['access'] = 'SPECIALIST'
        refresh_digest(envelope)
        with self.assertRaises(ValueError):
            replay.verify_export(envelope)
        # A new hypothetical job can be exported honestly, but still grants no authority.
        payload = reviewed(envelope['inputs'])
        rebuilt = replay.build_export('customer', payload, planned(payload))
        self.assertTrue(replay.verify_export(rebuilt)['verified'])
        self.assertFalse(rebuilt['output']['scope']['releaseAuthority'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
