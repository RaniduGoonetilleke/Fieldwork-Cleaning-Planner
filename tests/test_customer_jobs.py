"""Exercise complete customer plans and deterministic export/replay."""
from copy import deepcopy
from datetime import date, timedelta
from hashlib import sha256
import http.client
import json
from pathlib import Path
import sys
import threading
import unittest
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import customer_service as service
from planner_service import InputError, plan_job
from replay_plan import build_export, verify_export
from server import Handler, ThreadingHTTPServer


def task(tid='T1', kind='glass', round=1, **changes):
    return {'id': tid, 'type': kind, 'room': 'Office', 'place': tid, 'round': round,
            'dependsOn': None, 'method': 'Use a suitable cloth and cleaner.', 'access': 'ORDINARY',
            'checks': {'area': {k: 'PASS' for k in ('routes', 'people', 'hazards')},
                       'surface': {k: 'PASS' for k in ('permission', 'condition', 'method')},
                       'manual': {k: 'PASS' for k in ('permission', 'equipment', 'training')}},
            'specialist': {'accessPlan': '', 'weather': 'UNKNOWN', 'ground': 'UNKNOWN', 'publicProtection': 'UNKNOWN'}, **changes}


def assessed(value):
    value['review'] = {'by': 'Example reviewer', 'date': date.today().isoformat(), 'reference': '',
                       'decision': 'PASS', 'scope': deepcopy({k: v for k, v in value.items() if k != 'review'})}
    return value


def layout(tasks):
    """Convert readable test construction labels into explicit schema-3 identities."""
    rooms, rows = {}, []
    duplicates = []
    for original in tasks:
        t = deepcopy(original)
        name = t.pop('room')
        rid = 'room_' + sha256(' '.join(name.casefold().split()).encode()).hexdigest()[:12]
        checks = t['checks'].pop('area')
        room = {'id': rid, 'name': name.strip(), 'checks': checks}
        if rid in rooms and rooms[rid]['checks'] != checks:
            duplicates.append(room)
        else:
            rooms.setdefault(rid, room)
        t['roomId'] = rid
        t['placeId'] = 'place_' + sha256((rid + ' '.join(t['place'].casefold().split())).encode()).hexdigest()[:12]
        rows.append(t)
    return list(rooms.values()) + duplicates, rows


def request(*tasks):
    value = service.customer_bootstrap()['defaultInputs']
    value['context'].update({'company': 'Example company', 'buildingId': 'building-1', 'buildingName': 'Example building'})
    value['siteChecks'] = {'accessArranged': 'PASS', 'siteRulesReviewed': 'PASS'}
    value['rooms'], value['tasks'] = layout(tasks or [task()])
    for person in value['people']: person['availability'] = {'round-1': 'AVAILABLE', 'round-2': 'AVAILABLE'}
    return assessed(value)


def redigest(export):
    export['digest'] = sha256(json.dumps({k: v for k, v in export.items() if k != 'digest'}, sort_keys=True,
        separators=(',', ':'), ensure_ascii=False, allow_nan=False).encode()).hexdigest()
    return export


class CustomerJobsTests(unittest.TestCase):
    def test_defaults_do_not_claim_safety_or_availability(self):
        value = service.customer_bootstrap()['defaultInputs'];self.assertTrue(all(v == 'UNKNOWN' for v in value['siteChecks'].values()))
        self.assertEqual(value['review']['decision'], 'UNKNOWN')
        self.assertTrue(all(v == 'UNKNOWN' for p in value['people'] for v in p['availability'].values()))
        with self.assertRaises(InputError): service.plan_customer(value)
    def test_new_skills_need_declaration_and_never_create_robot_evidence(self):
        for kind in ('wall', 'desks', 'floor', 'bins'):
            value = request(task(kind=kind))
            self.assertEqual(service.plan_customer(value)['rows'][0]['state'], 'WAITING_FOR_PERSON')
            value['people'][0]['additionalTraining'] = [service.TYPES[kind]['training']]
            result = service.plan_customer(assessed(value))
            self.assertEqual(result['rows'][0]['person'], 'H1')
            self.assertEqual(result['summary']['robotAssigned'], 0)
            self.assertTrue(all(t['request'] is None for t in result['scenario']['tasks']))
    def test_no_double_booking_and_later_round_reuses_person(self):
        result = service.plan_customer(request(task('T1'), task('T2'), task('T3'), task('T4', round=2)))
        self.assertEqual([r['person'] for r in result['rows']], ['H1', 'H2', None, 'H1'])
    def test_permission_and_access_do_not_become_automatic_assignments(self):
        for condition in ('UNKNOWN', 'FAIL', 'SPECIALIST'):
            t = task()
            if condition == 'SPECIALIST': t['access'] = condition
            else: t['checks']['manual']['permission'] = condition
            result = service.plan_customer(request(t))
            self.assertIsNone(result['rows'][0]['person']);self.assertNotIn('manual_alternative', result['scenario']['tasks'][0])
    def test_dependency_remains_pending_and_blocked_permission_cannot_release_it(self):
        value = request(task('A'), task('B', round=2, dependsOn='A'))
        self.assertEqual([r['state'] for r in service.plan_customer(value)['rows']], ['MANUAL_ASSIGNED','CONDITIONAL_ON_INPUT'])
        value['tasks'][0]['checks']['manual']['permission'] = 'UNKNOWN';result = service.plan_customer(assessed(value))
        self.assertFalse(any(r['person'] for r in result['rows']));self.assertIn('earlier job', result['rows'][1]['reason'])
    def test_bad_and_injected_fields_are_refused(self):
        candidates = []
        for key in ('profiles', 'dispatch', 'completions', 'output'):
            value=request();value[key]={};candidates.append(value)
        for field,value in [('round',True),('type','disinfection'),('room',''),('dependsOn','unknown'),('access',True)]:
            q=request();q['tasks'][0][field]=value;candidates.append(q)
        q=request();q['tasks']=[task(str(i)) for i in range(13)];candidates.append(q)
        q=request();q['people'][0]['roles']=['certified'];candidates.append(q)
        for value in candidates:
            with self.subTest(value=value),self.assertRaises(InputError):service.plan_customer(value)
    def test_job_and_customer_replay_equal_without_export_recursion(self):
        for operation,value,function in [('customer',request(),service.plan_customer),('job',{'scenario':'tested_contexts'},plan_job)]:
            export=build_export(operation,value,function(value));before=deepcopy(export)
            self.assertTrue(verify_export(export)['sameResult']);self.assertEqual(export,before);self.assertNotIn('export',export['output'])
    def test_forged_output_rejected_even_after_redigest(self):
        value=request();export=build_export('customer',value,service.plan_customer(value))
        export['output']['rows'][0]['person']='H2';redigest(export)
        with self.assertRaisesRegex(InputError,'fresh computation'):verify_export(export)
    def test_stale_release_and_changed_input_with_old_result_refused(self):
        value=request();export=build_export('customer',value,service.plan_customer(value))
        stale=deepcopy(export);stale['software']['catalogueSha256']='0'*64;redigest(stale)
        with self.assertRaisesRegex(InputError,'different software'):verify_export(stale)
        stale=deepcopy(export);stale['inputs']['tasks'][0]['checks']['manual']['permission']='FAIL';redigest(stale)
        with self.assertRaisesRegex(InputError,'fresh computation'):verify_export(stale)


class QuietHandler(Handler):
    def log_message(self,*args):pass


class CustomerHTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server=ThreadingHTTPServer(('127.0.0.1',0),QuietHandler)
        cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True);cls.thread.start()
    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown();cls.server.server_close();cls.thread.join()
    def call(self,method,path,value=None,ensure_ascii=True):
        connection=http.client.HTTPConnection('127.0.0.1',self.server.server_port,timeout=10)
        connection.request(method,path,json.dumps(value,ensure_ascii=ensure_ascii).encode('utf-8') if value is not None else None,{'Content-Type':'application/json'})
        response=connection.getresponse();result=(response.status,json.loads(response.read()));connection.close();return result
    def test_twelve_task_export_roundtrip_http(self):
        value=request(*[task('T'+str(i),room='Office '+str(i),place='Long pane name '*6,round=1+i%2) for i in range(12)])
        code,result=self.call('POST','/api/customer',value);self.assertEqual(code,200)
        code,replay=self.call('POST','/api/replay',{'export':result['export']});self.assertEqual(code,200);self.assertTrue(replay['sameResult'])
    def test_original_job_http_exports_and_replays(self):
        code,result=self.call('POST','/api/job',{'scenario':'customer_building'});self.assertEqual(code,200)
        code,replay=self.call('POST','/api/replay',{'export':result['export']});self.assertEqual(code,200);self.assertTrue(replay['sameResult'])
    def test_maximum_unicode_twelve_tasks_and_exact_text_replay(self):
        value=request(*[task('T'+str(i),room='🌐'*100,place='🌐'*99+str(i%10),method='🌐'*300,
            specialist={'accessPlan':'🌐'*300,'weather':'PASS','ground':'PASS','publicProtection':'PASS'}) for i in range(12)])
        for key in value['context']: value['context'][key]='🌐'*100
        assessed(value);value['review']['by']='🌐'*100;value['review']['reference']='🌐'*100
        for ensure_ascii in (True,False):
            with self.subTest(ensure_ascii=ensure_ascii):
                code,result=self.call('POST','/api/customer',value,ensure_ascii=ensure_ascii)
                self.assertEqual(code,200,result)
                self.assertLess(len(result['exportText'].encode('utf-8')),1024*1024)
                code,replay=self.call('POST','/api/replay',{'exportText':result['exportText']},ensure_ascii=False)
                self.assertEqual(code,200,replay);self.assertTrue(replay['sameResult'])
    def test_exact_server_text_preserves_float_identity_and_replays(self):
        code,result=self.call('POST','/api/job',{'scenario':'tested_contexts','force':{'min':8.0,'max':8.0}})
        self.assertEqual(code,200)
        self.assertIn('8.0',result['exportText'])
        self.assertEqual(json.loads(result['exportText']),result['export'])
        code,replay=self.call('POST','/api/replay',{'exportText':result['exportText']})
        self.assertEqual(code,200);self.assertTrue(replay['sameResult'])
        self.assertEqual(self.call('POST','/api/replay',{'exportText':{'not':'text'}})[0],400)
        self.assertEqual(self.call('POST','/api/replay',{'exportText':'{"a":1,"a":2}'})[0],400)
    def test_bootstrap_and_bad_replay_schema(self):
        code,result=self.call('GET','/api/customer');self.assertEqual(code,200);self.assertEqual(len(result['taskTypes']),7)
        self.assertEqual(self.call('POST','/api/replay',{'export':{},'verified':True})[0],400)


if __name__=='__main__':unittest.main(verbosity=2)
