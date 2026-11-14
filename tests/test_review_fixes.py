"""Test counterexamples identified during the independent review."""
from copy import deepcopy
from datetime import datetime, timezone
import itertools
import unittest
from unittest.mock import patch

from test_customer_jobs import task, request, assessed, redigest
import customer_service as service
from planner_service import InputError, plan_job
from replay_plan import build_export, verify_export


class ReviewFixTests(unittest.TestCase):
    def test_glass_and_whiteboard_both_staffed_in_both_click_orders(self):
        for names in (('glass', 'whiteboard'), ('whiteboard', 'glass')):
            result = service.plan_customer(request(*[task(name, kind=name) for name in names]))
            self.assertEqual({row['id']: row['person'] for row in result['rows']}, {'glass': 'H2', 'whiteboard': 'H1'})
            self.assertEqual(result['allocationPolicy']['maximumAssignmentsByStage']['round-1'], 2)
            self.assertEqual([row['id'] for row in result['rows']], list(names))
            self.assertEqual(result['allocationPolicy']['effectiveOrder'], [t['id'] for t in result['scenario']['tasks']])

    def test_matching_count_matches_exhaustive_assignments_for_small_ready_jobs(self):
        for length in range(1, 5):
            for kinds in itertools.product(('glass', 'whiteboard', 'floor'), repeat=length):
                value = request(*[task('T'+str(i), kind=kind) for i, kind in enumerate(kinds)])
                result = service.plan_customer(value)
                edges = [{0, 1} if kind == 'glass' else {0} if kind == 'whiteboard' else set() for kind in kinds]
                best = 0
                for assigned in itertools.product((None, 0, 1), repeat=length):
                    used = [p for p in assigned if p is not None]
                    if len(set(used)) == len(used) and all(p is None or p in edges[i] for i, p in enumerate(assigned)):
                        best = max(best, len(used))
                self.assertEqual(result['summary']['manualPlanned'], best, kinds)

    def test_matching_does_not_staff_unknown_forbidden_or_dependent_tasks(self):
        for update in ('contact', 'manual', 'access', 'method'):
            value = request(task('g', 'glass'), task('w', 'whiteboard'))
            t = value['tasks'][1]
            if update == 'contact': t['checks']['surface']['permission'] = 'FAIL'
            if update == 'manual': t['checks']['manual']['permission'] = 'UNKNOWN'
            if update == 'access': t['access'] = 'SPECIALIST'
            if update == 'method': t['method'] = ''
            result = service.plan_customer(assessed(value))
            self.assertIsNone(result['rows'][1]['person'])
            self.assertEqual(result['summary']['manualPlanned'], 1)
        value = request(task('g'), task('w', 'whiteboard', round=2, dependsOn='g'))
        result = service.plan_customer(value)
        self.assertEqual(result['rows'][1]['state'], 'CONDITIONAL_ON_INPUT')
        self.assertEqual(result['allocationPolicy']['maximumAssignmentsByStage']['round-2'], 0)

    def test_staffing_explanations_distinguish_missing_skills_availability_and_contention(self):
        value = request(task(kind='floor'))
        self.assertIn('No one', service.plan_customer(value)['rows'][0]['reason'])
        value = request(); value['people'][0]['availability']['round-1'] = 'BUSY'; value['people'][1]['availability']['round-1'] = 'UNKNOWN'
        self.assertIn('availability', service.plan_customer(assessed(value))['rows'][0]['reason'])
        result = service.plan_customer(request(task('a'), task('b'), task('c')))
        self.assertIn('other jobs', result['rows'][2]['reason'])

    def test_shared_room_failed_exit_blocks_every_panel_but_not_another_room(self):
        value = request(task('a', place='Panel 1'), task('b', place='Panel 2'), task('c', room='Other', place='Panel 3'))
        room = next(room for room in value['rooms'] if room['id'] == value['tasks'][0]['roomId'])
        room['checks']['routes'] = 'FAIL'
        result = service.plan_customer(assessed(value))
        self.assertEqual([r['state'] for r in result['rows']], ['BLOCKED_SHARED', 'BLOCKED_SHARED', 'MANUAL_ASSIGNED'])

    def test_duplicate_room_and_place_names_are_refused_without_fuzzy_merging(self):
        for duplicate in ('OFFICE', ' Office. ', 'office!'):
            value = request(); room = deepcopy(value['rooms'][0]); room.update(id='other', name=duplicate); value['rooms'].append(room)
            with self.subTest(duplicate=duplicate), self.assertRaisesRegex(InputError, 'Room IDs'):
                service.plan_customer(assessed(value))
        value = request(task('a', place='Panel 1'), task('b', place='Panel 2'))
        value['tasks'][1]['place'] = 'Panel 1.'
        with self.assertRaisesRegex(InputError, 'Duplicate place'):
            service.plan_customer(assessed(value))

    def test_place_id_cannot_borrow_another_room_and_names_cannot_rebind_it(self):
        value = request(task('a', place='Panel 1'), task('b', room='Other', place='Panel 2'))
        value['tasks'][1]['placeId'] = value['tasks'][0]['placeId']
        with self.assertRaisesRegex(InputError, 'same place ID'): service.plan_customer(assessed(value))
        value = request(task('a', place='Panel 1'), task('b', place='Panel 1'))
        value['tasks'][1]['place'] = 'Changed surface'
        with self.assertRaisesRegex(InputError, 'same place ID'): service.plan_customer(assessed(value))

    def test_room_and_place_id_changes_invalidate_exact_review_scope(self):
        for field in ('roomId', 'placeId'):
            value = request()
            if field == 'roomId':
                extra = deepcopy(value['rooms'][0]); extra.update(id='newroom', name='Other');value['rooms'].append(extra)
            value['tasks'][0][field] = 'newroom' if field == 'roomId' else 'newplace'
            self.assertEqual(service.plan_customer(value)['reviewStatus']['status'], 'stale')

    def test_labels_do_not_change_skills_or_add_workers(self):
        value = request(task(kind='whiteboard'));value['people'][0]['label'] = 'Sam';value['people'][1]['label'] = 'Alex'
        result = service.plan_customer(assessed(value))
        self.assertEqual(result['rows'][0]['person'], 'H1')
        self.assertEqual(result['effectiveInputs']['people'][0]['label'], 'Sam')
        value['people'].append({'id':'H3','label':'Lee','availability':{'round-1':'AVAILABLE','round-2':'AVAILABLE'},'additionalTraining':[]})
        with self.assertRaises(InputError):service.plan_customer(assessed(value))

    def test_replay_uses_recorded_utc_date_when_current_clock_is_earlier(self):
        value = request();value['review']['date'] = '2026-11-10'
        result = service.plan_customer(value, evaluation={'admissionDateUtc':'2026-11-10'})
        exported = build_export('customer', value, result)
        class EarlierClock:
            @classmethod
            def now(cls, zone):return datetime(2026,11,9,tzinfo=timezone.utc)
        with patch.object(service,'datetime',EarlierClock):
            with self.assertRaisesRegex(InputError,'future'):service.plan_customer(value)
            self.assertTrue(verify_export(exported)['sameResult'])
        self.assertEqual(exported['evaluationContext'], {'admissionDateUtc':'2026-11-10'})

    def test_replay_context_and_outputs_are_recomputed_not_trusted(self):
        value = request();result=service.plan_customer(value)
        exported=build_export('customer',value,result)
        for change in ('date','policy','assignment'):
            forged=deepcopy(exported)
            if change=='date':forged['evaluationContext']['admissionDateUtc']='2099-01-01'
            if change=='policy':forged['output']['allocationPolicy']['maximumAssignmentsByStage']['round-1']=2
            if change=='assignment':forged['output']['rows'][0]['person']='H2'
            redigest(forged)
            with self.subTest(change=change),self.assertRaises(InputError):verify_export(forged)

    def test_customer_cannot_supply_admission_date_or_legacy_room_checks(self):
        value=request();value['evaluationContext']={'admissionDateUtc':'2099-01-01'}
        with self.assertRaises(InputError):service.plan_customer(value)
        value=request();value['tasks'][0]['checks']['area']={'routes':'PASS','people':'PASS','hazards':'PASS'}
        with self.assertRaises(InputError):service.plan_customer(value)
        value=request();value['schemaVersion']=2
        with self.assertRaises(InputError):service.plan_customer(value)

    def test_computed_coverage_never_presents_detection_or_simulation_as_cleaning(self):
        value=request(task('board','whiteboard'),task('wall','wall'))
        result=service.plan_customer(value)
        self.assertEqual(result['plan']['selector_calls'],0)
        for check in result['robotChecks'].values():
            self.assertEqual(check['operation'],'part_by_part_evidence_check')
            self.assertEqual(check['status'],'NO_QUALIFIED_BUILDING_ROUTE')
            self.assertEqual(len(check['profilesInspected']),len(service.CATALOGUE))
            for part in check['parts']:
                self.assertEqual(part['status'],'NOT_SUPPORTED_HERE')
                if part['selector']['called']:
                    self.assertEqual(part['selector']['decision'],'WITHHOLD')
        # Only the detection part can be put to the decision rule truthfully; a wipe request needs an owner-stated force.
        self.assertEqual(result['robotChecks']['board']['selectorCalls'],1)
        self.assertEqual(result['robotChecks']['wall']['selectorCalls'],0)
        board={r['platform']:r for r in result['robotChecks']['board']['robots']}
        self.assertEqual(board['UR5']['status'],'SUBTASK_ONLY')
        self.assertEqual(board['G1']['status'],'SIMULATION_ONLY')
        value['robots']=[];result=service.plan_customer(assessed(value))
        self.assertTrue(all(r['status']=='NOT_ON_TEAM' for r in result['robotChecks']['board']['robots']))

    def test_original_paper_customer_example_stays_unchanged(self):
        result=plan_job({'scenario':'customer_building'})['plan']
        counts={state:sum(t['state']==state for t in result['tasks']) for state in ('BLOCKED_EVIDENCE','BLOCKED_INPUT','MANUAL_ASSIGNED')}
        self.assertEqual(counts,{'BLOCKED_EVIDENCE':7,'BLOCKED_INPUT':3,'MANUAL_ASSIGNED':2})
        self.assertEqual(result['selector_calls'],9)


if __name__=='__main__':unittest.main(verbosity=2)
