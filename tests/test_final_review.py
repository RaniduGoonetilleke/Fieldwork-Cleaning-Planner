"""Checks added for the final-review release: part-by-part robot evidence, explanations, order and examples."""
from copy import deepcopy
from hashlib import sha256
import http.client
import json
from pathlib import Path
import sys
import threading
import unittest
from unittest import mock

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import customer_service as service  # noqa: E402
from planner_service import InputError  # noqa: E402
from replay_plan import build_export, verify_export, _hash  # noqa: E402

DAY = {'admissionDateUtc': '2026-11-12'}


def base():
    """The fully answered two-job example, with a review that matches it."""
    return deepcopy(service.customer_examples(DAY)[0]['inputs'])


def rebind(value):
    value['review']['scope'] = None
    return service._bind_review(value)


def job(number, kind, place=None, room='room-1'):
    task = deepcopy(base()['tasks'][0])
    task.update(id='job-' + str(number), type=kind, roomId=room, placeId='place-' + str(number), place=place or kind + ' ' + str(number))
    return task


def plan(value):
    return service.plan_customer(value, evaluation=DAY)


class RobotEvidenceTests(unittest.TestCase):
    def test_every_job_type_lists_its_parts_and_none_is_supported_in_a_new_building(self):
        expected = {'whiteboard': ['locate', 'wipe', 'result'], 'glass': ['wipe', 'result'], 'wall': ['wipe', 'result'],
                    'desks': ['wipe', 'result'], 'floor': ['floor'], 'bins': ['bins'], 'facade': ['access', 'wipe', 'result']}
        self.assertEqual(set(expected), set(service.TYPES))
        for kind, parts in expected.items():
            with self.subTest(kind=kind):
                value = base(); value['tasks'] = [job(1, kind)]
                if kind == 'facade':
                    value['tasks'][0]['access'] = 'SPECIALIST'
                result = plan(rebind(value))
                check = result['robotChecks']['job-1']
                self.assertEqual([part['id'] for part in check['parts']], parts)
                self.assertTrue(all(part['status'] == 'NOT_SUPPORTED_HERE' and part['evidenceNeeded'] for part in check['parts']))
                self.assertEqual(result['summary']['robotAssigned'], 0)
                self.assertTrue(all(row['robot'] is None for row in result['rows']))
                self.assertEqual(result['plan']['reservations']['robots'], [])

    def test_detection_part_is_put_to_the_unchanged_rule_with_the_customers_own_place(self):
        result = plan(base())
        part = result['robotChecks']['job-2']['parts'][0]
        self.assertEqual((part['id'], part['capability']), ('locate', 'target_detection'))
        selector = part['selector']
        self.assertTrue(selector['called'])
        self.assertEqual((selector['decision'], selector['request']['force'], selector['request']['metrics']), ('WITHHOLD', None, []))
        request = selector['request']
        self.assertEqual(request['domain'], 'physical')
        self.assertTrue(request['context'].startswith('customer_building_'))
        self.assertTrue(request['allowed_targets'][0].startswith('customer_place_'))
        contexts = {record['context'] for record in service.CATALOGUE}; targets = {record['target'] for record in service.CATALOGUE}
        self.assertNotIn(request['context'], contexts); self.assertNotIn(request['allowed_targets'][0], targets)
        self.assertEqual(selector['notApplicable']['UR5_whiteboard_detection'], ['context', 'target'])
        self.assertEqual(part['records'][0]['differs'], ['context', 'target'])
        # The allowed modes and evidence levels are not narrowed to force a refusal: the tested record passes both.
        ur5 = next(record for record in service.CATALOGUE if record['id'] == 'UR5_whiteboard_detection')
        self.assertIn(ur5['mode'], request['allowed_modes']); self.assertIn(ur5['evidence_level'], request['accepted_evidence_levels'])
        again = plan(base())['robotChecks']['job-2']['parts'][0]['selector']
        self.assertEqual(again['binding'], selector['binding'])
        other = base(); other['context']['buildingId'] = 'another-building'
        self.assertNotEqual(plan(rebind(other))['robotChecks']['job-2']['parts'][0]['selector']['request']['context'], request['context'])

    def test_wipe_part_is_never_sent_without_an_owner_stated_force_and_simulation_stays_simulation(self):
        part = plan(base())['robotChecks']['job-1']['parts'][0]
        self.assertEqual((part['id'], part['selector']['called']), ('wipe', False))
        self.assertIn('force', part['selector']['reason'])
        self.assertTrue(part['records'])
        for record in part['records']:
            self.assertEqual(record['domain'], 'simulation')
            self.assertTrue({'context', 'domain', 'evidence_level', 'target'} <= set(record['differs']))
        self.assertIn('simulation', part['summary'].lower())
        result_part = plan(base())['robotChecks']['job-1']['parts'][1]
        self.assertEqual((result_part['id'], result_part['records'], result_part['selector']['called']), ('result', [], False))

    def test_a_record_that_shared_a_customer_identity_would_stop_the_plan_instead_of_qualifying_a_robot(self):
        request = plan(base())['robotChecks']['job-2']['parts'][0]['selector']['request']
        forged = deepcopy(service.CATALOGUE)
        clone = deepcopy(next(record for record in forged if record['id'] == 'UR5_whiteboard_detection'))
        clone.update(id='FORGED_MATCH', context=request['context'], target=request['allowed_targets'][0])
        forged.append(clone)
        with mock.patch.object(service, 'CATALOGUE', forged):
            with self.assertRaises(InputError):
                plan(base())

    def test_robot_cards_are_derived_from_the_records_and_roles(self):
        profiles = {profile['platform']: profile for profile in service.customer_bootstrap()['robotProfiles']}
        self.assertEqual(set(profiles), set(service.ROBOTS))
        for platform, profile in profiles.items():
            records = [record for record in service.CATALOGUE if record['platform'] == platform]
            self.assertEqual(profile['capabilities'], sorted({record['capability'] for record in records}))
            self.assertEqual(profile['profileIds'], [record['id'] for record in records])
            roles = {role for record in records for role in service.ROLES[record['mode']]['roles']}
            if any(record['confirmation_required'] for record in records):
                roles.add('confirmer')          # the original planner asks for this role when a confirmation is needed
            self.assertEqual(profile['needsRoles'], sorted(roles))
            self.assertEqual(profile['peopleWithRoles'], ['H1'])
        self.assertIn('confirmer', profiles['G1']['needsRoles']); self.assertIn('confirmer', profiles['UR3']['needsRoles'])
        self.assertNotIn('confirmer', profiles['UR5']['needsRoles'])
        wipe = plan(base())['robotChecks']['job-1']['parts'][0]
        self.assertIn('confirmer and operator roles', wipe['evidenceNeeded'][-1])
        self.assertIn('not compared', wipe['recordsNote'])
        locate = plan(base())['robotChecks']['job-2']['parts'][0]
        self.assertIn('attendant role', locate['evidenceNeeded'][-1])
        self.assertIn('most permissive request', locate['selector']['note'])
        self.assertNotIn('accepts as the same', ' '.join(locate['evidenceNeeded']))
        self.assertEqual(profiles['G1']['domains'], ['simulation'])
        self.assertFalse(profiles['UR5']['confirmationPerTarget']); self.assertTrue(profiles['UR3']['confirmationPerTarget'])


class ExplanationTests(unittest.TestCase):
    def test_a_blocked_job_names_the_exact_answer_that_decided_it(self):
        value = base(); value['rooms'][0]['checks']['routes'] = 'FAIL'
        result = plan(rebind(value))
        for row in result['rows']:
            self.assertEqual(row['state'], 'BLOCKED_SHARED')
            self.assertEqual([(item['scope'], item['check'], item['value']) for item in row['decidedBy']], [('room', 'routes', 'FAIL')])
            self.assertEqual(row['fixStep'], 3)
        value = base(); value['siteChecks']['accessArranged'] = 'UNKNOWN'
        row = plan(rebind(value))['rows'][0]
        self.assertEqual((row['state'], row['decidedBy'][0]['check'], row['decidedBy'][0]['valueWords']), ('WITHHELD_SHARED', 'accessArranged', 'Not checked'))
        value = base(); value['tasks'][0]['checks']['manual']['training'] = 'UNKNOWN'
        row = plan(rebind(value))['rows'][0]
        self.assertEqual([(item['scope'], item['check']) for item in row['decidedBy']], [('job', 'training')])
        value = base(); value['tasks'][0]['checks']['surface']['permission'] = 'FAIL'
        row = plan(rebind(value))['rows'][0]
        self.assertEqual((row['state'], row['decidedBy'][0]['valueWords']), ('BLOCKED_TASK_CONDITION', 'Not allowed'))

    def test_a_changed_job_reports_the_stale_assessment_and_assigns_nobody(self):
        value = base(); value['tasks'][1]['method'] = 'Something else'
        result = plan(value)
        self.assertEqual(result['reviewStatus']['status'], 'stale')
        self.assertEqual(result['summary']['manualPlanned'], 0)
        self.assertTrue(all(any(item['scope'] == 'assessment' for item in row['decidedBy']) for row in result['rows']))
        # The glass job was not edited, so no row may say that "this job" changed.
        for row in result['rows']:
            self.assertEqual(row['reason'], 'The entries changed after the assessment was recorded, so it no longer counts.')
            self.assertNotIn('This job changed', row['reason']); self.assertNotIn('changed job', row['nextAction'])
            self.assertTrue(row['decidedBy'][0]['valueWords'].startswith('Out of date'))
        team_only = base(); team_only['people'][1]['availability']['round-2'] = 'BUSY'
        self.assertEqual({row['reason'] for row in plan(team_only)['rows']}, {'The entries changed after the assessment was recorded, so it no longer counts.'})

    def test_a_failed_room_check_is_named_even_when_the_building_checks_are_unknown(self):
        value = base(); value['rooms'][0]['checks']['routes'] = 'FAIL'
        value['siteChecks'] = {'accessArranged': 'UNKNOWN', 'siteRulesReviewed': 'UNKNOWN'}
        value['review'].update(decision='UNKNOWN', scope=None)
        for row in plan(value)['rows']:
            self.assertEqual(row['state'], 'BLOCKED_SHARED')
            self.assertIn('a room check', row['reason'])
            self.assertIn(('room', 'routes', 'FAIL'), [(item['scope'], item['check'], item['value']) for item in row['decidedBy']])

    def test_a_job_that_waits_for_an_earlier_one_is_explained_from_that_jobs_real_state(self):
        def dependent(helper):
            value = base(); value['tasks'] = [job(1, 'whiteboard'), job(2, 'glass')]
            value['tasks'][1].update(round=2, dependsOn='job-1')
            value['people'][0]['availability']['round-1'] = helper
            value['people'][1]['availability']['round-2'] = 'AVAILABLE'
            return plan(rebind(value))['rows']
        first, second = dependent('AVAILABLE')
        self.assertEqual((first['state'], second['state']), ('MANUAL_ASSIGNED', 'CONDITIONAL_ON_INPUT'))
        self.assertIn('is planned, but we do not know if it is finished', second['reason'])
        first, second = dependent('BUSY')
        self.assertEqual((first['state'], second['state']), ('WAITING_FOR_PERSON', 'CONDITIONAL_ON_INPUT'))
        self.assertEqual(second['reason'], 'The earlier job has no person yet, so this job waits for it.')
        self.assertEqual(second['fixStep'], 2); self.assertNotIn('is planned', second['reason'] + second['decidedBy'][0]['valueWords'])
        self.assertTrue(second['decidedBy'][0]['valueWords'].endswith('has no person yet'))

    def test_each_person_is_explained_for_free_busy_untrained_and_contended_jobs(self):
        result = plan(base())
        board = {person['id']: person['outcome'] for person in result['rows'][1]['peopleConsidered']}
        self.assertEqual(board, {'H1': 'ASSIGNED_HERE', 'H2': 'NOT_TRAINED'})
        glass = {person['id']: person for person in result['rows'][0]['peopleConsidered']}
        self.assertEqual((glass['H1']['outcome'], glass['H1']['reservedFor'], glass['H2']['outcome']), ('NEEDED_BY_ANOTHER_JOB', 'job-2', 'ASSIGNED_HERE'))
        value = base(); value['people'][0]['availability']['round-1'] = 'BUSY'
        row = plan(rebind(value))['rows'][1]
        self.assertEqual((row['state'], row['fixStep'], row['peopleConsidered'][0]['outcome']), ('WAITING_FOR_PERSON', 2, 'BUSY'))
        value = base(); value['people'][0]['availability']['round-1'] = 'UNKNOWN'
        self.assertEqual(plan(rebind(value))['rows'][1]['peopleConsidered'][0]['outcome'], 'AVAILABILITY_NOT_CHECKED')
        value = base(); value['tasks'] = [job(1, 'glass'), job(2, 'glass'), job(3, 'glass')]
        waiting = [row for row in plan(rebind(value))['rows'] if row['state'] == 'WAITING_FOR_PERSON']
        self.assertEqual(len(waiting), 1)
        self.assertTrue(all(person['outcome'] == 'NEEDED_BY_ANOTHER_JOB' and person['reservedForLabel'] for person in waiting[0]['peopleConsidered']))

    def test_summary_counts_and_sentence_agree_with_the_rows(self):
        for example in service.customer_examples(DAY):
            result = plan(example['inputs'])
            assigned = sum(row['state'] == 'MANUAL_ASSIGNED' for row in result['rows'])
            self.assertEqual((result['summary']['manualPlanned'], result['summary']['needAttention']), (assigned, len(result['rows']) - assigned))
            self.assertIn('No robot is assigned in a new building.', result['summary']['sentence'])
            self.assertEqual(result['release'], service.RELEASE)

    def test_specialist_work_is_never_approved_by_ordinary_answers(self):
        value = base(); value['tasks'] = [job(1, 'facade')]; value['tasks'][0]['access'] = 'SPECIALIST'
        value['tasks'][0]['specialist'] = {'accessPlan': 'Cradle', 'weather': 'PASS', 'ground': 'PASS', 'publicProtection': 'PASS'}
        row = plan(rebind(value))['rows'][0]
        self.assertIsNone(row['person']); self.assertNotEqual(row['state'], 'MANUAL_ASSIGNED')
        self.assertEqual((row['decidedBy'][0]['check'], row['decidedBy'][0]['value']), ('access', 'SPECIALIST'))
        value['tasks'][0]['access'] = 'UNKNOWN'
        self.assertEqual(plan(rebind(value))['rows'][0]['decidedBy'][0]['value'], 'SPECIALIST')


class OrderAndPlaceTests(unittest.TestCase):
    def test_listed_order_never_changes_how_many_jobs_get_a_person(self):
        cases = [['glass', 'whiteboard'], ['whiteboard', 'glass'], ['glass', 'glass', 'whiteboard'], ['whiteboard', 'glass', 'glass'], ['glass', 'glass', 'glass']]
        for kinds in cases:
            with self.subTest(kinds=kinds):
                value = base(); value['tasks'] = [job(index + 1, kind) for index, kind in enumerate(kinds)]
                forward = plan(rebind(value))
                value['tasks'].reverse()
                backward = plan(rebind(value))
                self.assertEqual(forward['summary']['manualPlanned'], backward['summary']['manualPlanned'])
                self.assertTrue(forward['orderCheck']['sameNumberAssigned'])
                self.assertEqual(forward['orderCheck']['oppositeOrderAssignments'],
                                 {row['id']: row['person'] for row in backward['rows'] if row['person']})
        both = plan(base())['orderCheck']
        self.assertTrue(both['sameJobsAssigned'] and both['samePeople'] and both['sameStates'])
        value = base(); value['tasks'] = [job(1, 'glass'), job(2, 'glass'), job(3, 'glass')]
        contended = plan(rebind(value))['orderCheck']
        self.assertTrue(contended['sameNumberAssigned']); self.assertFalse(contended['sameJobsAssigned'])

    def test_when_jobs_compete_the_earliest_listed_jobs_that_can_be_staffed_together_are_chosen(self):
        # Glass can go to either person, the whiteboard only to H1, desks only to H2 (declared here).
        value = base(); value['tasks'] = [job(1, 'glass'), job(2, 'whiteboard'), job(3, 'desks')]
        value['people'][1]['additionalTraining'] = ['desk_wiping']
        result = plan(rebind(value))
        self.assertEqual({row['id']: row['person'] for row in result['rows']}, {'job-1': 'H2', 'job-2': 'H1', 'job-3': None})
        self.assertIn('earliest listed', result['allocationPolicy']['tieBreak']); self.assertIn('earliest listed', result['orderCheck']['scope'])
        value['tasks'].reverse()
        self.assertEqual({row['id']: row['person'] for row in plan(rebind(value))['rows']}, {'job-3': 'H2', 'job-2': 'H1', 'job-1': None})

    def test_a_failed_room_check_stops_every_place_in_that_room_and_an_alias_is_refused(self):
        value = base(); value['rooms'][0]['checks']['hazards'] = 'FAIL'
        value['tasks'].append(job(3, 'glass', 'Glass panel 2'))
        self.assertEqual({row['state'] for row in plan(rebind(value))['rows']}, {'BLOCKED_SHARED'})
        for alias in ('Meeting room 1.', 'meeting  ROOM 1', 'Meeting-room 1'):
            value = base(); value['rooms'].append({'id': 'room-2', 'name': alias, 'checks': {'routes': 'PASS', 'people': 'PASS', 'hazards': 'PASS'}})
            value['tasks'][1]['roomId'] = 'room-2'
            with self.assertRaises(InputError):
                plan(rebind(value))
        value = base(); value['tasks'][1]['placeId'] = 'place-1'
        with self.assertRaises(InputError):
            plan(rebind(value))


class ExampleAndReplayTests(unittest.TestCase):
    def test_examples_are_invented_dated_from_the_supplied_day_and_give_their_stated_results(self):
        expected = {'both_free': ['MANUAL_ASSIGNED', 'MANUAL_ASSIGNED'], 'helper_busy': ['MANUAL_ASSIGNED', 'WAITING_FOR_PERSON'],
                    'room_check_failed': ['BLOCKED_SHARED', 'BLOCKED_SHARED'], 'changed_after_assessment': ['WITHHELD_SHARED', 'WITHHELD_SHARED']}
        examples = service.customer_examples({'admissionDateUtc': '2026-01-05'})
        self.assertEqual([example['id'] for example in examples], list(expected))
        for example in examples:
            self.assertEqual(example['inputs']['review']['date'], '2026-01-05')
            self.assertIn('invented', example['inputs']['review']['by'].lower())
            self.assertIn('Example', example['inputs']['context']['buildingName'])
            result = service.plan_customer(example['inputs'], evaluation={'admissionDateUtc': '2026-01-05'})
            self.assertEqual([row['state'] for row in result['rows']], expected[example['id']])
        ids = {example['id'] for example in examples}
        self.assertTrue(all(example['compareWith'] in ids | {None} for example in examples))
        self.assertEqual([example['id'] for example in service.customer_bootstrap()['examples']], list(expected))

    def test_the_new_explanations_are_inside_the_export_and_any_edit_to_them_is_refused(self):
        inputs = service.customer_examples(DAY)[1]['inputs']
        result = plan(inputs)
        envelope = build_export('customer', inputs, result)
        self.assertTrue(verify_export(deepcopy(envelope))['verified'])
        edits = {
            'robot part': lambda out: out['robotChecks']['job-2']['parts'][0].update(status='SUPPORTED'),
            'selector answer': lambda out: out['robotChecks']['job-2']['parts'][0]['selector'].update(decision='SELECT'),
            'order check': lambda out: out['orderCheck'].update(sameJobsAssigned=False),
            'decided by': lambda out: out['rows'][1].update(reason='A robot can do this.'),
            'person': lambda out: out['rows'][1]['peopleConsidered'][0].update(outcome='ASSIGNED_HERE'),
            'sentence': lambda out: out['summary'].update(sentence='2 jobs are assigned to robots.'),
        }
        for name, edit in edits.items():
            with self.subTest(name=name):
                forged = deepcopy(envelope); edit(forged['output'])
                with self.assertRaises(InputError):
                    verify_export(forged)
                forged['digest'] = _hash({key: item for key, item in forged.items() if key != 'digest'})
                with self.assertRaisesRegex(InputError, 'differs from a fresh computation'):
                    verify_export(forged)

    def test_replay_uses_the_recorded_day_and_not_the_replay_computers_clock(self):
        old = {'admissionDateUtc': '2026-03-01'}
        inputs = service.customer_examples(old)[0]['inputs']
        envelope = build_export('customer', inputs, service.plan_customer(inputs, evaluation=old))
        self.assertEqual(envelope['evaluationContext'], old)
        with mock.patch.object(service, 'datetime') as clock:
            clock.now.side_effect = AssertionError('replay must not read the clock')
            self.assertTrue(verify_export(deepcopy(envelope))['verified'])
        later = deepcopy(inputs); later['review']['date'] = '2026-03-02'
        with self.assertRaises(InputError):
            service.plan_customer(rebind(later), evaluation=old)


class EvidenceCheckWordingTests(unittest.TestCase):
    ASSUMPTION = 'For this evidence check only, all current conditions are assumed to pass. Your actual place checks are applied separately to the job plan.'
    ROUTE = 'The current building flow only plans manual work. Robot assignment would need applicable reviewed evidence and a reviewed update to this planning route.'

    def test_the_passing_checks_assumption_travels_with_the_detection_result_whatever_the_place_checks_say(self):
        cases = {'all checked': lambda v: None,
                 'room check failed': lambda v: v['rooms'][0]['checks'].update(routes='FAIL'),
                 'room check unknown': lambda v: v['rooms'][0]['checks'].update(people='UNKNOWN'),
                 'building check unknown': lambda v: v['siteChecks'].update(accessArranged='UNKNOWN'),
                 'contact not allowed': lambda v: v['tasks'][1]['checks']['surface'].update(permission='FAIL')}
        states = {}
        for name, edit in cases.items():
            with self.subTest(name=name):
                value = base(); edit(value)
                result = plan(rebind(value))
                check = result['robotChecks']['job-2']
                selector = check['parts'][0]['selector']
                # The evidence check is the same whatever the place checks say, and it always states its assumption.
                self.assertEqual((selector['called'], selector['decision'], selector['assumption']), (True, 'WITHHOLD', self.ASSUMPTION))
                self.assertEqual((check['routeNote'], check['selectorCalls']), (self.ROUTE, 1))
                self.assertIn('would not, by itself, qualify a robot', check['gapsNote'])
                states[name] = result['rows'][1]['state']
        # The place checks still govern the plan itself.
        self.assertEqual(states, {'all checked': 'MANUAL_ASSIGNED', 'room check failed': 'BLOCKED_SHARED', 'room check unknown': 'WITHHELD_SHARED',
                                  'building check unknown': 'WITHHELD_SHARED', 'contact not allowed': 'BLOCKED_TASK_CONDITION'})

    def test_no_text_calls_withhold_a_refusal_or_says_a_new_record_alone_would_be_enough(self):
        result = plan(base())
        text = json.dumps(result['robotChecks']) + json.dumps(service.customer_bootstrap()['robotProfiles']) + json.dumps(service.EVIDENCE_NEEDED)
        for phrase in ('refusal', 'refused', 'until a record naming', 'newly released record', 'accepts as the same'):
            self.assertNotIn(phrase, text)
        self.assertIn('The different test place and target prevent a matching record.', result['robotChecks']['job-2']['parts'][0]['selector']['note'])
        wipe = result['robotChecks']['job-2']['parts'][1]
        self.assertFalse(wipe['selector']['called']); self.assertNotIn('decision', wipe['selector']); self.assertNotIn('assumption', wipe['selector'])

    def test_the_inherited_force_sentence_is_disclosed_and_the_bundled_record_is_not_silently_edited(self):
        record = ROOT / 'vendor/records/UR5_OPERATION_CONFIRMATION_R37.json'
        self.assertEqual(sha256(record.read_bytes()).hexdigest(), '9ced2b592dcf583bc967c46800120d6b7b52f2b8844799d4936a6a2db9812e2b')
        (note,) = service.PENDING_RECORD_CORRECTIONS
        self.assertIn(note['recordSays'], record.read_text()); self.assertIn(note['alsoSays'], record.read_text())
        self.assertEqual(record.read_text().count('was measured'), 2)   # both overstated sentences are named in the note
        self.assertEqual(note['supported'], 'We did not implement active contact-force regulation in our UR5 prototype, and we report no measured contact-force value.')
        self.assertIn('pending review', note['status'])
        readme = (ROOT / 'README.md').read_text()
        self.assertIn(note['supported'], readme); self.assertIn('pending correction', readme)
        app_text = ''.join((ROOT / name).read_text() for name in ('customer_service.py', 'public/customer.js', 'public/team.js', 'public/registry-ui.js', 'public/index.html'))
        self.assertEqual(app_text.count(note['recordSays']), 1)      # quoted once, as the sentence being corrected
        self.assertNotIn('no contact-force value was measured', app_text.replace(note['recordSays'], ''))

    def test_the_evidence_service_returns_the_correction_beside_the_ur5_record_only(self):
        from server import Handler, ThreadingHTTPServer

        class Quiet(Handler):
            def log_message(self, *args):
                pass
        httpd = ThreadingHTTPServer(('127.0.0.1', 0), Quiet)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True); thread.start()
        try:
            def get(profile):
                conn = http.client.HTTPConnection('127.0.0.1', httpd.server_port, timeout=5)
                conn.request('GET', '/api/evidence?id=' + profile); res = conn.getresponse(); data = json.loads(res.read()); conn.close()
                return res.status, data
            status, ur5 = get('UR5_whiteboard_detection')
            self.assertEqual(status, 200)
            self.assertEqual(ur5['pendingCorrections'], service.PENDING_RECORD_CORRECTIONS)
            served = next(item for item in ur5['additionalRecords'] if item['file'].endswith('R37.json'))
            self.assertIn('no contact-force value was measured', json.dumps(served['record']))   # served unchanged, with the correction beside it
            for other in ('G1_B_7N', 'UR3_registered_handover'):
                self.assertEqual(get(other)[1]['pendingCorrections'], [])
        finally:
            httpd.shutdown(); httpd.server_close(); thread.join()


class VerificationSummaryTests(unittest.TestCase):
    def test_the_published_summary_states_the_real_counts_and_its_limits(self):
        summary = json.loads((ROOT / 'public/verification-summary.json').read_text())
        self.assertEqual((summary['schemaVersion'], summary['release']), (1, service.RELEASE))
        counted = unittest.defaultTestLoader.discover(str(ROOT / 'tests'), pattern='test_*.py', top_level_dir=str(ROOT / 'tests')).countTestCases()
        self.assertEqual(summary['counts']['pythonTests'], counted)
        self.assertEqual(summary['counts']['javascriptTestFiles'], len(list((ROOT / 'tests').glob('*.mjs'))))
        limits = ' '.join(summary['notShown']).lower()
        for phrase in ('reliability', 'user study', 'faster', 'safety', 'cleaning'):
            self.assertIn(phrase, limits)
        self.assertNotIn('%', json.dumps(summary['checks']))


if __name__ == '__main__':
    unittest.main(verbosity=2)
