"""Check that the web adapter preserves the research rules and rejects bad input."""
from copy import deepcopy
import http.client
import importlib.util
import json
from pathlib import Path
import sys
import threading
import unittest

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import planner_service as service
from server import Handler, ThreadingHTTPServer, parse_body


def preset(name):
    return next(p['inputs'] for p in service.bootstrap()['presets'] if p['id'] == name)


class AdapterTests(unittest.TestCase):
    def test_sources_are_exact_byte_copies(self):
        self.assertEqual(len(service.verify_sources()['files']), 19)
        self.assertEqual(service.PROVENANCE['selectorSha256'], '922cb93fa1265a8cc50987812d3c062345b99aa2b676536173a68f21eef22d1e')

    def test_default_does_not_assume_live_checks(self):
        response = service.decide({'robot': 'G1'})
        self.assertEqual(response['result']['decision'], 'WITHHOLD')
        self.assertTrue(all(response['inputs'][key] == 'UNKNOWN' for key in service.CONDITION_FIELDS))
        self.assertEqual(response['inputs']['availability'], 'UNKNOWN')

    def test_all_presets_call_unchanged_selector(self):
        for p in service.bootstrap()['presets']:
            with self.subTest(preset=p['id']):
                response = service.decide(p['inputs'])
                expected = service.select(response['request'], response['profiles'], response['live'])
                self.assertEqual(response['result'], expected)
                self.assertFalse(expected['release_authority'])
                self.assertFalse(expected['dispatch_implemented'])
                self.assertFalse(expected['facts_verified_by_code'])

    def test_exact_settings_and_owner_range(self):
        for name, expected in [('g1_7', 'CONFIRM'), ('g1_range', 'ASK'), ('g1_gap', 'WITHHOLD')]:
            self.assertEqual(service.decide(preset(name))['result']['decision'], expected)
        p = preset('g1_7'); p['force'] = {'min': 8, 'max': 8}
        result = service.decide(p)['result']
        self.assertEqual(result['configuration']['id'], 'G1_B_8N')
        p['force'] = {'min': 9, 'max': 9}
        self.assertEqual(service.decide(p)['result']['decision'], 'WITHHOLD')

    def test_simulation_cannot_qualify_physical_g1(self):
        result = service.decide(preset('g1_physical'))['result']
        self.assertEqual(result['decision'], 'WITHHOLD')
        self.assertTrue(all('domain' in why for why in result['not_applicable'].values()))

    def test_customer_context_does_not_inherit_tested_context(self):
        for name in ('g1_7', 'ur3', 'ur5'):
            p = preset(name); p['context'] = 'customer'
            self.assertEqual(service.decide(p)['result']['decision'], 'WITHHOLD')

    def test_choice_then_confirmation_are_explicit(self):
        p = preset('g1_range')
        first = service.decide(p)['result']
        self.assertEqual(first['decision'], 'ASK')
        p['choice'] = {'kind': 'choice', 'binding': first['binding'], 'candidate_id': 'G1_D_8N'}
        chosen = service.decide(p)['result']
        self.assertEqual(chosen['decision'], 'CONFIRM')
        p['confirmation'] = {'kind': 'confirmation', 'binding': chosen['binding'], 'candidate_id': 'G1_D_8N'}
        approved = service.decide(p)['result']
        self.assertEqual(approved['decision'], 'SELECT')
        self.assertFalse(approved['release_authority'])

    def test_stale_confirmation_cannot_transfer_to_new_request(self):
        p = preset('g1_7'); first = service.decide(p)['result']
        p['confirmation'] = {'kind': 'confirmation', 'binding': first['binding'], 'candidate_id': 'G1_B_7N'}
        p['force'] = {'min': 6, 'max': 7}
        result = service.decide(p)['result']
        self.assertEqual(result['decision'], 'CONFIRM')
        self.assertNotEqual(result['binding'], first['binding'])
        self.assertEqual(result['configuration']['id'], 'G1_B_7N')

    def test_hazard_cannot_be_overridden_by_confirmation(self):
        p = preset('g1_7'); first = service.decide(p)['result']
        p['confirmation'] = {'kind': 'confirmation', 'binding': first['binding'], 'candidate_id': 'G1_B_7N'}
        p['sharedSafety'] = 'FAIL'
        self.assertEqual(service.decide(p)['result']['decision'], 'REFUSE')

    def test_busy_robot_waits(self):
        p = preset('g1_7'); p['availability'] = 'BUSY'
        self.assertEqual(service.decide(p)['result']['decision'], 'WAIT')

    def test_e_f_keep_admission_separate_from_deployment(self):
        for target in 'EF':
            p = preset('g1_7'); p['target'] = target
            response = service.decide(p)
            self.assertEqual(response['result']['decision'], 'WITHHOLD')
            self.assertEqual(response['historicalAdmission']['stage'], 'earlier test-admission process')

    def test_ur5_only_supports_detection_and_keeps_attendant(self):
        response = service.decide(preset('ur5'))
        self.assertEqual(response['result']['configuration']['capability'], 'target_detection')
        self.assertEqual(next(iter(response['humanRoles'].values()))['roles'], ['attendant'])
        with self.assertRaises(service.InputError):
            service.decide(dict(preset('ur5'), force={'min': 7, 'max': 7}))

    def test_profiles_cannot_be_injected(self):
        with self.assertRaises(service.InputError):
            service.decide(dict(preset('ur5'), profiles=[]))

    def test_input_validation(self):
        bad = [{'robot': True}, {'robot': 'X'}, {'robot': 'G1', 'force': {'min': True, 'max': 8}},
               {'robot': 'G1', 'force': {'min': 9, 'max': 8}},
               {'robot': 'G1', 'force': {'min': float('nan'), 'max': 8}},
               {'robot': 'G1', 'force': {'min': 1, 'max': float('inf')}},
               {'robot': 'G1', 'force': {'min': 1, 'max': 10**400}},
               {'robot': 'G1', 'target': ['A', 'D']}, {'robot': 'G1', 'availability': 'PASS'},
               {'robot': 'G1', 'unknown': 1}, {'robot': 'UR3', 'target': 'anything'},
               {'robot': 'G1', 'choice': {'kind': 'choice', 'binding': 'a'*64, 'candidate_id': 'fake'}}]
        for p in bad:
            with self.subTest(payload=p), self.assertRaises(service.InputError):
                service.decide(p)

    def test_job_preserves_authored_original_plans(self):
        for name, scenario in service.SCENARIOS.items():
            for declared in (False, True):
                actual = service.plan_job({'scenario': name, 'useRecordedDeclarations': declared})['plan']
                expected = service.plan(deepcopy(scenario), deepcopy(service.CATALOGUE),
                                        declarations=deepcopy(scenario.get('synthetic_declarations', {})) if declared else {},
                                        human_roles=deepcopy(service.ROLES))
                self.assertEqual(actual, expected)

    def test_no_people_means_no_person_assigned(self):
        result = service.plan_job({'scenario': 'tested_contexts', 'peopleAvailable': False,
                                   'useRecordedDeclarations': True})['plan']
        self.assertTrue(all(row['person'] is None for row in result['tasks']))
        self.assertIn('WAITING_FOR_PERSON', [row['state'] for row in result['tasks']])
        self.assertFalse(any(row['state'] == 'RECOMMENDED' for row in result['tasks']))

    def test_job_hazard_prevents_robot_and_manual_assignment(self):
        result = service.plan_job({'scenario': 'customer_building', 'sharedSafety': 'FAIL'})['plan']
        self.assertTrue(all(row['robot'] is None and row['person'] is None for row in result['tasks']))

    def test_changed_job_force_invalidates_old_declarations(self):
        result = service.plan_job({'scenario': 'tested_contexts', 'force': {'min': 7, 'max': 7},
                                   'useRecordedDeclarations': True})['plan']
        row = next(row for row in result['tasks'] if row['id'] == 'T-WS-D')
        self.assertNotEqual(row['state'], 'RECOMMENDED')
        self.assertTrue(any('context changed' in note for note in row['notes']))

    def test_job_validation(self):
        for p in ({'scenario':'x'}, {'scenario':'tested_contexts','peopleAvailable':1},
                  {'scenario':'tested_contexts','declarations':{'unknown-task':{}}},
                  {'scenario':'tested_contexts','useRecordedDeclarations':'true'}):
            with self.subTest(payload=p), self.assertRaises(service.InputError):
                service.plan_job(p)

    def test_known_evidence_only_and_no_local_path(self):
        e = service.evidence('UR5_whiteboard_detection')
        self.assertEqual(e['profile'], service.BY_ID['UR5_whiteboard_detection'])
        self.assertTrue(e['records'])
        for invalid in ('../../server.py', '/etc/passwd', 'unknown'):
            with self.assertRaises(service.InputError):
                service.evidence(invalid)

    def test_nested_and_ambiguous_json_rejected(self):
        for raw in (b'{"robot":"G1","robot":"UR3"}', b'{"force":NaN}', b'['*18 + b'0' + b']'*18):
            with self.subTest(raw=raw), self.assertRaises(service.InputError):
                parse_body(raw)


class TeamPlanningTests(unittest.TestCase):
    def row(self, response, task):
        return next(row for row in response['plan']['tasks'] if row['id'] == task)

    def action(self, response, task, candidate=None):
        return next(action for action in response['availableActions']
                    if action['taskId'] == task and (candidate is None or action['candidateId'] == candidate))

    def chosen_g1(self):
        payload = {'scenario': 'tested_contexts', 'robots': ['G1', 'UR3']}
        response = service.plan_job(payload)
        action = self.action(response, 'T-WS-D', 'G1_D_8N')
        payload['declarations'] = {'T-WS-D': action['declaration']}
        return payload, service.plan_job(payload)

    def test_presets_reveal_actual_person_shortages(self):
        presets = {p['id']: p['inputs'] for p in service.bootstrap()['jobPresets']}
        responses = {key: service.plan_job(payload) for key, payload in presets.items()}
        self.assertEqual(self.row(responses['team_free'], 'T-WB-L')['state'], 'RECOMMENDED')
        self.assertEqual(self.row(responses['h1_later'], 'T-WB-L')['state'], 'WAITING_FOR_PERSON')
        self.assertEqual(self.row(responses['h1_later'], 'T-SH')['state'], 'PENDING_CONFIRMATION')
        self.assertEqual(self.row(responses['h1_busy'], 'T-SH')['state'], 'WAITING_FOR_PERSON')
        self.assertEqual(self.row(responses['customer_h2_busy'], 'GP1')['state'], 'MANUAL_ASSIGNED')
        self.assertEqual(self.row(responses['customer_h2_busy'], 'GP2')['state'], 'WAITING_FOR_PERSON')
        self.assertFalse(any(a['kind'] == 'confirm' for a in responses['h1_busy']['availableActions']))

    def test_partial_availability_changes_only_named_slot_and_person(self):
        response = service.plan_job({'scenario': 'tested_contexts',
                                     'peopleAvailability': {'H1': {'slot-1': 'BUSY'}}})
        people = {p['id']: p for p in response['people']}
        self.assertEqual(people['H1']['availability']['slot-1'], 'BUSY')
        self.assertEqual(people['H1']['availability']['slot-2'], 'AVAILABLE')
        self.assertEqual(people['H2']['availability']['slot-1'], 'AVAILABLE')
        self.assertEqual(self.row(response, 'T-WB-L')['state'], 'WAITING_FOR_PERSON')
        self.assertIsNone(self.row(response, 'T-WB-L')['person'])

    def test_unknown_person_availability_does_not_qualify(self):
        response = service.plan_job({'scenario': 'tested_contexts',
                                     'peopleAvailability': {'H1': {'slot-1': 'UNKNOWN'}}})
        self.assertEqual(self.row(response, 'T-WB-L')['state'], 'WAITING_FOR_PERSON')

    def test_ur5_booking_prevents_g1_double_booking(self):
        payload = {'scenario': 'tested_contexts'}
        first = service.plan_job(payload)
        action = self.action(first, 'T-WS-D', 'G1_D_8N')
        payload['declarations'] = {'T-WS-D': action['declaration']}
        result = service.plan_job(payload)
        self.assertEqual(self.row(result, 'T-WB-L')['person'], 'H1')
        self.assertEqual(self.row(result, 'T-WS-D')['state'], 'WAITING_FOR_PERSON')
        self.assertFalse(any(a['taskId'] == 'T-WS-D' for a in result['availableActions']))

    def test_explicit_choice_then_confirmation_with_roster_change(self):
        payload, chosen = self.chosen_g1()
        self.assertEqual(self.row(chosen, 'T-WB-L')['state'], 'BLOCKED_NOT_IN_TEAM')
        self.assertEqual(self.row(chosen, 'T-WS-D')['state'], 'PENDING_CONFIRMATION')
        action = self.action(chosen, 'T-WS-D')
        self.assertEqual(action['kind'], 'confirm')
        self.assertEqual(action['personId'], 'H1')
        self.assertIn('choice', action['declaration'])
        payload['declarations']['T-WS-D'] = action['declaration']
        confirmed = service.plan_job(payload)
        self.assertEqual(chosen['jobBinding'], confirmed['jobBinding'])
        self.assertEqual(self.row(confirmed, 'T-WS-D')['state'], 'RECOMMENDED')
        self.assertEqual(self.row(confirmed, 'T-WS-D')['selector']['configuration'], 'G1_D_8N')
        self.assertEqual(self.row(confirmed, 'T-WS-D')['person'], 'H1')

    def test_ur3_action_is_separate_from_g1_action(self):
        payload, chosen = self.chosen_g1()
        g1 = self.action(chosen, 'T-WS-D')
        ur3 = self.action(chosen, 'T-SH')
        payload['declarations'].update({'T-WS-D': g1['declaration'], 'T-SH': ur3['declaration']})
        result = service.plan_job(payload)
        for task in ('T-WS-D', 'T-SH'):
            self.assertEqual(self.row(result, task)['state'], 'RECOMMENDED')
        self.assertEqual(self.row(result, 'T-WS-D')['slot'], 'slot-1')
        self.assertEqual(self.row(result, 'T-SH')['slot'], 'slot-2')

    def test_empty_roster_never_assigns_any_robot(self):
        for name in service.SCENARIOS:
            result = service.plan_job({'scenario': name, 'robots': []})
            self.assertFalse(any(row['robot'] for row in result['plan']['tasks']))
            self.assertFalse(result['availableActions'])

    def test_changed_team_conditions_or_force_reject_stale_browser_action(self):
        payload, _ = self.chosen_g1()
        changes = [{'robots': ['G1']}, {'force': {'min': 7, 'max': 8}},
                   {'sharedSafety': 'UNKNOWN'}, {'peopleAvailability': {'H1': {'slot-2': 'BUSY'}}}]
        for change in changes:
            with self.subTest(change=change), self.assertRaisesRegex(service.InputError, 'out of date'):
                service.plan_job(dict(payload, **change))

    def test_tampered_selector_binding_never_confirms(self):
        payload, chosen = self.chosen_g1()
        action = self.action(chosen, 'T-WS-D')
        action['declaration']['confirm']['binding'] = '0' * 64
        payload['declarations']['T-WS-D'] = action['declaration']
        result = service.plan_job(payload)
        self.assertEqual(self.row(result, 'T-WS-D')['state'], 'PENDING_CONFIRMATION')
        self.assertTrue(any('not applied' in n for n in self.row(result, 'T-WS-D')['notes']))

    def test_cross_task_declaration_cannot_confirm_another_task(self):
        payload, chosen = self.chosen_g1()
        payload['declarations']['T-WS-D'] = self.action(chosen, 'T-SH')['declaration']
        result = service.plan_job(payload)
        self.assertEqual(self.row(result, 'T-WS-D')['state'], 'PENDING_CHOICE')
        self.assertTrue(any('context changed' in n for n in self.row(result, 'T-WS-D')['notes']))

    def test_h2_does_not_gain_confirmation_or_operator_role(self):
        payload, chosen = self.chosen_g1()
        action = self.action(chosen, 'T-WS-D')
        action['declaration']['confirm']['by'] = 'H2'
        payload['declarations']['T-WS-D'] = action['declaration']
        result = service.plan_job(payload)
        self.assertEqual(self.row(result, 'T-WS-D')['state'], 'PENDING_CONFIRMATION')
        self.assertEqual(self.row(result, 'T-WS-D')['person'], 'H1')

    def test_team_input_schema_is_strict(self):
        bad = [{'robots': 'G1'}, {'robots': ['G1', 'G1']}, {'robots': ['G2']}, {'robots': [True]},
               {'robots': [{}]}, {'peopleAvailability': []}, {'peopleAvailability': {'H3': {}}},
               {'peopleAvailability': {'H1': {'slot-3': 'AVAILABLE'}}},
               {'peopleAvailability': {'H1': {'slot-1': 'PASS'}}},
               {'peopleAvailability': {'H1': {'slot-1': True}}},
               {'peopleAvailability': {'H1': []}}, {'peopleAvailability': {}, 'peopleAvailable': True},
               {'declarations': {}, 'useRecordedDeclarations': True}, {'humanRoles': {'H2': ['confirmer']}}]
        for extra in bad:
            with self.subTest(extra=extra), self.assertRaises(service.InputError):
                service.plan_job({'scenario': 'tested_contexts', **extra})

    def test_declarations_schema_is_strict(self):
        payload, chosen = self.chosen_g1()
        valid = self.action(chosen, 'T-WS-D')['declaration']
        bad = [dict(valid, browser_binding='bad'), dict(valid, job_context='bad'),
               dict(valid, snapshot_id='old'), dict(valid, basis=''), dict(valid, authored_from=''),
               dict(valid, extra='hidden permission'), {k:v for k,v in valid.items() if k not in ('choice', 'confirm')}]
        for field, change in [('confirm', {'by':'H3'}), ('choice', {'by':'H1'}),
                              ('confirm', {'candidate_id':'fake'}), ('confirm', {'binding':True}),
                              ('confirm', {'privileged':True})]:
            item = deepcopy(valid); item[field].update(change); bad.append(item)
        for declaration in bad:
            with self.subTest(declaration=declaration), self.assertRaises(service.InputError):
                service.plan_job(dict(payload, declarations={'T-WS-D': declaration}))

    def test_explicit_empty_declarations_match_no_declarations(self):
        plain = service.plan_job({'scenario': 'tested_contexts'})['plan']
        explicit = service.plan_job({'scenario': 'tested_contexts', 'declarations': {}})['plan']
        self.assertEqual(plain, explicit)


class QuietHandler(Handler):
    def log_message(self, *args):
        pass


class HTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = ThreadingHTTPServer(('127.0.0.1', 0), QuietHandler)
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown(); cls.httpd.server_close(); cls.thread.join()

    def call(self, method, path, body=None, content_type='application/json'):
        conn = http.client.HTTPConnection('127.0.0.1', self.httpd.server_port, timeout=5)
        conn.request(method, path, body, {'Content-Type': content_type})
        res = conn.getresponse(); data = res.read(); code = res.status; conn.close()
        return code, json.loads(data)

    def test_http_returns_real_selector_result(self):
        code, body = self.call('POST', '/api/decision', json.dumps(preset('g1_7')))
        self.assertEqual(code, 200); self.assertEqual(body['result']['decision'], 'CONFIRM')

    def test_health(self):
        code, body = self.call('GET', '/api/health')
        self.assertEqual(code, 200); self.assertFalse(body['dispatch'])

    def test_path_traversal(self):
        for path in ('/../planner_service.py', '/%2e%2e/server.py', '/%2fetc/passwd', '/provenance/SOURCE_MANIFEST.json'):
            code, _ = self.call('GET', path)
            self.assertIn(code, (400, 404))

    def test_invalid_api_and_oversize(self):
        self.assertEqual(self.call('POST', '/api/job', '{"scenario":"bad"}')[0], 400)
        self.assertEqual(self.call('POST', '/api/decision', 'x' * 65537)[0], 413)
        self.assertEqual(self.call('POST', '/api/decision', '{}', 'text/plain')[0], 415)
        self.assertEqual(self.call('GET', '/api/evidence?id=../../server.py')[0], 400)
        self.assertEqual(self.call('GET', '/api/evidence?id=G1_B_7N&id=G1_A_7N')[0], 400)


def load_original_tests(loader, path):
    spec = importlib.util.spec_from_file_location('original_' + path.stem, path)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return loader.loadTestsFromModule(module)


def load_tests(loader, tests, pattern):
    tests.addTests(load_original_tests(loader, ROOT/'vendor/selector/test_selector.py'))
    tests.addTests(load_original_tests(loader, ROOT/'vendor/job_example/test_job_plan.py'))
    tests.addTests(load_original_tests(loader, ROOT/'vendor/catalogue_r4/test_catalogue_r4.py'))
    return tests


if __name__ == '__main__':
    unittest.main(verbosity=2)
