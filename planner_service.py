"""Browser-facing inputs for the unchanged, offline research decision code.

All current conditions are supplied by the user. The application neither
observes a robot nor grants permission to execute a task.
"""
from copy import deepcopy
from hashlib import sha256
import json
import math
from pathlib import Path
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent
VENDOR = ROOT / 'vendor'


def verify_sources():
    manifest = json.loads((ROOT / 'provenance/SOURCE_MANIFEST.json').read_text())
    for entry in manifest['files']:
        file = ROOT / entry['path']
        if sha256(file.read_bytes()).hexdigest() != entry['sha256']:
            raise RuntimeError('An application source differs from its recorded version: ' + entry['path'])
    return manifest


MANIFEST = verify_sources()
sys.path.insert(0, str(VENDOR / 'selector'))
sys.path.insert(0, str(VENDOR / 'job_example'))
from selector import select, LIVE, STATES, AVAILABILITY, digest  # noqa: E402
from build_examples import request_for, live_for  # noqa: E402
from job_plan import plan, load_catalogue, load_human_roles, declaration_from_plan  # noqa: E402

CATALOGUE = load_catalogue()
ROLES = load_human_roles()
BY_ID = {p['id']: p for p in CATALOGUE}
CASES = [
    {'id': 'G1', 'title': 'Supported humanoid wipe', 'capability': 'regulated_wipe',
     'domain': 'simulation', 'target': 'B', 'context': BY_ID['G1_B_7N']['context'],
     'description': 'Recorded wall wipe and final hold with the G1 held at the pelvis.',
     'limits': 'Four discrete sites at 7 N and 8 N. This does not establish dirt removal, a maximum force or physical G1 performance.'},
    {'id': 'UR3', 'title': 'Registered cube handover', 'capability': 'gesture_handover',
     'domain': 'physical', 'target': 'registered_cube', 'context': BY_ID['UR3_registered_handover']['context'],
     'description': 'Human command, confirmation and handover in the published UR3 cell.',
     'limits': 'The profile applies to the published registered-cube context. The browser confirmation is an authored declaration, not a detected gesture.'},
    {'id': 'UR5', 'title': 'Visual target detection', 'capability': 'target_detection',
     'domain': 'physical', 'target': 'taped_region', 'context': BY_ID['UR5_whiteboard_detection']['context'],
     'description': 'Visual targeting within the documented automatic wiping prototype.',
     'limits': 'This catalogue supports target detection only. It does not qualify regulated wiping. Our reported methods and operating account retain the qualifications in the source records.'},
]
CASE_BY_ID = {c['id']: c for c in CASES}
SCENARIOS = {name: json.loads((VENDOR / 'job_example/scenarios' / (name + '.json')).read_text())
             for name in ('tested_contexts', 'customer_building')}
SCOPE = {'mode': 'offline_proof_of_concept', 'facts': 'Authored demonstration inputs; no live observations.',
         'robotConnection': False, 'dispatch': False, 'releaseAuthority': False,
         'confirmation': 'A browser declaration for this demonstration. It is not a robot gesture, authentication or execution authority.',
         'qualification': 'Stored assessments are used unchanged. A successful software decision does not validate the real world.'}
PROVENANCE = {'catalogue': 'catalogue_r4/CANDIDATE_MAPPING_R4.json',
              'catalogueSha256': sha256((VENDOR / 'catalogue_r4/CANDIDATE_MAPPING_R4.json').read_bytes()).hexdigest(),
              'selectorSha256': sha256((VENDOR / 'selector/selector.py').read_bytes()).hexdigest(),
              'plannerSha256': sha256((VENDOR / 'job_example/job_plan.py').read_bytes()).hexdigest(),
              'source': 'Corrected local source package prepared on 6 November 2026 and checked for this app on 10 November 2026; exact source copies bundled.',
              'sourcePublicCommit': MANIFEST['source_public_commit'], 'sourceFilesVerified': len(MANIFEST['files']),
              'notes': 'The corrected source package updates portable source labels and their dependent identities together. Scientific values and planning decisions are unchanged; this app has its own local checks.'}


class InputError(ValueError):
    pass


def _object(value, fields, required=()):
    if type(value) is not dict:
        raise InputError('Expected a JSON object.')
    unknown = set(value) - set(fields)
    missing = set(required) - set(value)
    if unknown:
        raise InputError('Unknown fields: ' + ', '.join(sorted(unknown)))
    if missing:
        raise InputError('Missing fields: ' + ', '.join(sorted(missing)))
    return value


def _enum(value, choices, name):
    if type(value) is not str or value not in choices:
        raise InputError(name + ' must be one of: ' + ', '.join(sorted(choices)))
    return value


def _boolean(value, name):
    if type(value) is not bool:
        raise InputError(name + ' must be true or false.')
    return value


def _force(value):
    _object(value, {'min', 'max'}, {'min', 'max'})
    for v in value.values():
        try:
            finite = type(v) in (int, float) and math.isfinite(v)
        except OverflowError:
            finite = False
        if not finite:
            raise InputError('Force values must be finite numbers, not true/false.')
    if not 0 < value['min'] <= value['max'] <= 100:
        raise InputError('Use 0 < minimum <= maximum <= 100 N. This is an input range, not a robot capability.')
    return {'min': float(value['min']), 'max': float(value['max'])}


def _declaration(value, kind):
    if value is None:
        return None
    _object(value, {'kind', 'binding', 'candidate_id'}, {'kind', 'binding', 'candidate_id'})
    if value['kind'] != kind or type(value['binding']) is not str or len(value['binding']) != 64 \
            or any(x not in '0123456789abcdef' for x in value['binding']):
        raise InputError('Use the unchanged ' + kind + ' binding returned by the previous decision.')
    if type(value['candidate_id']) is not str or value['candidate_id'] not in BY_ID:
        raise InputError('The declaration names an unknown profile.')
    return deepcopy(value)


CONDITION_FIELDS = {'sharedSafety': 'UNKNOWN', 'visibility': 'UNKNOWN', 'path': 'UNKNOWN',
                    'contact': 'UNKNOWN', 'platformSafety': 'UNKNOWN', 'localSafety': 'UNKNOWN',
                    'validInput': 'UNKNOWN'}


def decide(payload):
    _object(payload, {'robot', 'target', 'domain', 'context', 'force', 'availability', 'choice', 'confirmation'}
            | set(CONDITION_FIELDS), {'robot'})
    robot = _enum(payload['robot'], CASE_BY_ID, 'robot')
    case = CASE_BY_ID[robot]
    inputs = {'robot': robot, 'domain': _enum(payload.get('domain', case['domain']), {'physical', 'simulation'}, 'domain'),
              'context': _enum(payload.get('context', 'tested'), {'tested', 'customer'}, 'context')}
    for field, default in CONDITION_FIELDS.items():
        inputs[field] = _enum(payload.get(field, default), STATES, field)
    inputs['availability'] = _enum(payload.get('availability', 'UNKNOWN'), AVAILABILITY, 'availability')
    if robot == 'G1':
        inputs['target'] = _enum(payload.get('target', 'B'), set('ABCDEF'), 'target')
        inputs['force'] = _force(payload.get('force', {'min': 7, 'max': 7}))
    else:
        if 'target' in payload and payload['target'] != case['target']:
            raise InputError('This case has the single recorded target ' + case['target'] + '.')
        if 'force' in payload and payload['force'] is not None:
            raise InputError('This recorded capability has no regulated-force setting.')
        inputs['target'] = case['target']
        inputs['force'] = None
    profiles = [deepcopy(p) for p in CATALOGUE if p['platform'] == robot]
    request = request_for(profiles[0])
    request['id'] = 'browser_' + robot
    request['domain'] = inputs['domain']
    request['context'] = case['context'] if inputs['context'] == 'tested' else 'customer_building_new_context'
    request['allowed_targets'] = [inputs['target']]
    request['required_settings'] = deepcopy(profiles[0]['settings'])
    if inputs['force'] is not None:
        request['force'] = {'minimum_n': inputs['force']['min'], 'maximum_n': inputs['force']['max'],
                            'basis': 'User-authored browser demonstration requirement; not a measured dirt-removal requirement.'}
    live = live_for(profiles)
    live['snapshot_id'] = 'AUTHORED_BROWSER_DEMONSTRATION'
    live['shared_safety'] = inputs['sharedSafety']
    live['platforms'][robot] = {'availability': inputs['availability'], 'safety': inputs['platformSafety']}
    names = {'valid_input': 'validInput', 'visible_target': 'visibility', 'path': 'path', 'contact_authorized': 'contact'}
    for entry in live['candidates'].values():
        entry['safety'] = inputs['localSafety']
        entry['checks'] = {name: inputs[names[name]] for name in entry['checks']}
    choice = _declaration(payload.get('choice'), 'choice')
    confirmation = _declaration(payload.get('confirmation'), 'confirmation')
    result = select(request, profiles, live, choice=choice, confirmation=confirmation)
    historical = None
    if robot == 'G1' and inputs['target'] in ('E', 'F'):
        historical = {'target': inputs['target'], 'stage': 'earlier test-admission process',
                      'explanation': ('E was refused before wiping because the target was hidden.' if inputs['target'] == 'E'
                                      else 'F failed the offline joint-margin screen and was never run.'),
                      'distinction': 'The current deployment selector has no qualified profile at this target. It answers a different question from the earlier test-admission program.'}
    return {'result': result, 'request': request, 'live': live, 'inputs': inputs, 'profiles': profiles,
            'humanRoles': {p['mode']: deepcopy(ROLES[p['mode']]) for p in profiles},
            'roleNote': 'The single-task selector does not reserve a person. The worked-job planner checks and reserves declared people.',
            'historicalAdmission': historical, 'scope': deepcopy(SCOPE), 'provenance': deepcopy(PROVENANCE)}


def _hex(value, name):
    if type(value) is not str or len(value) != 64 or any(c not in '0123456789abcdef' for c in value):
        raise InputError(name + ' must be an unchanged 64-character binding returned by the planner.')
    return value


def _browser_declarations(value, scenario, browser_binding):
    if type(value) is not dict:
        raise InputError('declarations must be an object keyed by robot task ID.')
    tasks = {t['id']: t for t in scenario['tasks'] if t.get('request') is not None}
    people = {p['id'] for p in scenario['team']['people']}
    clean = {}
    for tid, declaration in value.items():
        if tid not in tasks:
            raise InputError('The declaration names an unknown robot task: ' + str(tid))
        _object(declaration, {'browser_binding', 'snapshot_id', 'job_context', 'basis', 'authored_from', 'choice', 'confirm'},
                {'browser_binding', 'snapshot_id', 'job_context', 'basis', 'authored_from'})
        if _hex(declaration['browser_binding'], 'browser_binding') != browser_binding:
            raise InputError('This example action is out of date. Clear its declaration and inspect the new plan before choosing or confirming again.')
        _hex(declaration['job_context'], 'job_context')
        if declaration['snapshot_id'] != scenario['live']['snapshot_id']:
            raise InputError('The declaration belongs to a different example snapshot.')
        for name in ('basis', 'authored_from'):
            if type(declaration[name]) is not str or not declaration[name].strip() or len(declaration[name]) > 512:
                raise InputError('The declaration needs a short, nonempty ' + name + '.')
        if 'choice' not in declaration and 'confirm' not in declaration:
            raise InputError('An example declaration must explicitly choose or confirm an option.')
        for kind in ('choice', 'confirm'):
            if kind not in declaration:
                continue
            item = declaration[kind]
            _object(item, {'candidate_id', 'by', 'binding'}, {'candidate_id', 'by', 'binding'})
            _hex(item['binding'], kind + '.binding')
            if type(item['candidate_id']) is not str or item['candidate_id'] not in BY_ID:
                raise InputError('The example action names an unknown candidate.')
            if kind == 'choice' and item['by'] != 'owner':
                raise InputError('A demonstration choice must be attributed to owner.')
            if kind == 'confirm' and (type(item['by']) is not str or item['by'] not in people):
                raise InputError('A demonstration confirmation must name a declared person.')
        clean[tid] = {k: deepcopy(v) for k, v in declaration.items() if k != 'browser_binding'}
    return clean


def _job_actions(result, scenario, declarations, browser_binding):
    actions = []
    for row in result['tasks']:
        selector_result = row.get('selector')
        if not selector_result:
            continue
        if row['state'] == 'PENDING_CHOICE':
            for cid in selector_result['remaining']:
                candidate = BY_ID[cid]
                declaration = declaration_from_plan(row, snapshot_id=scenario['live']['snapshot_id'],
                    choice=(cid, 'owner'), basis='Explicit owner choice entered in the browser demonstration.',
                    authored_from='Current browser plan for task ' + row['id'])
                declaration['browser_binding'] = browser_binding
                label = 'Choose ' + (str(candidate['force_setpoint_n']).removesuffix('.0') + ' N' if candidate['force_setpoint_n'] is not None else candidate['platform'])
                actions.append({'taskId': row['id'], 'kind': 'choice', 'label': label, 'candidateId': cid,
                                'personId': 'owner', 'declaration': declaration})
        if row['state'] == 'PENDING_CONFIRMATION' and row['person']:
            cid, person = selector_result['configuration'], row['person']
            declaration = declaration_from_plan(row, snapshot_id=scenario['live']['snapshot_id'],
                confirm=(cid, person), basis='Explicit hypothetical confirmation entered in the browser demonstration.',
                authored_from='Current browser plan for task ' + row['id'])
            earlier_choice = (declarations.get(row['id']) or {}).get('choice')
            if earlier_choice is not None:
                declaration['choice'] = deepcopy(earlier_choice)
            declaration['browser_binding'] = browser_binding
            actions.append({'taskId': row['id'], 'kind': 'confirm', 'label': 'Record example confirmation by ' + person,
                            'candidateId': cid, 'personId': person, 'declaration': declaration})
    return actions


def plan_job(payload):
    _object(payload, {'scenario', 'peopleAvailable', 'peopleAvailability', 'robots', 'sharedSafety', 'force',
                      'useRecordedDeclarations', 'declarations', 'taskRequirements'}, {'scenario'})
    name = _enum(payload['scenario'], SCENARIOS, 'scenario')
    scenario = deepcopy(SCENARIOS[name])
    if 'peopleAvailable' in payload and 'peopleAvailability' in payload:
        raise InputError('Use either peopleAvailable or per-person peopleAvailability, not both.')
    people = _boolean(payload.get('peopleAvailable', True), 'peopleAvailable')
    declared = _boolean(payload.get('useRecordedDeclarations', False), 'useRecordedDeclarations')
    if declared and 'declarations' in payload:
        raise InputError('Use either recorded example declarations or explicit browser actions, not both.')
    if not people:
        for person in scenario['team']['people']:
            person['availability'] = {slot: 'BUSY' for slot in person['availability']}
    if 'peopleAvailability' in payload:
        by_person = {person['id']: person for person in scenario['team']['people']}
        values = _object(payload['peopleAvailability'], set(by_person))
        for person_id, availability in values.items():
            _object(availability, set(scenario['slots']))
            for slot, status in availability.items():
                by_person[person_id]['availability'][slot] = _enum(status, AVAILABILITY, 'peopleAvailability.' + person_id + '.' + slot)
    if 'robots' in payload:
        robots = payload['robots']
        if type(robots) is not list or not all(type(r) is str and r in CASE_BY_ID for r in robots) or len(set(robots)) != len(robots):
            raise InputError('robots must be a list of distinct known platform names: G1, UR3, UR5.')
        scenario['team']['robots'] = deepcopy(robots)
    if 'sharedSafety' in payload:
        state = _enum(payload['sharedSafety'], STATES, 'sharedSafety')
        for cond in scenario['conditions'].values():
            cond['shared_safety'] = state
    if 'force' in payload:
        force = _force(payload['force'])
        for task in scenario['tasks']:
            if (task.get('request') or {}).get('force'):
                task['request']['force'].update(minimum_n=force['min'], maximum_n=force['max'])
    if 'taskRequirements' in payload:
        by_task = {task['id']: task for task in scenario['tasks']}
        overrides = _object(payload['taskRequirements'], set(by_task))
        task_forces, place_permissions = {}, {}
        for task_id, requirement in overrides.items():
            _object(requirement, {'force', 'contactPermission'})
            task = by_task[task_id]
            if 'force' in requirement:
                if not (task.get('request') or {}).get('force'):
                    raise InputError('This task does not have a regulated-force requirement.')
                task_forces[task_id] = _force(requirement['force'])
            if 'contactPermission' in requirement:
                permission = _enum(requirement['contactPermission'], STATES, 'contactPermission')
                place = task['location']
                if place in place_permissions and place_permissions[place] != permission:
                    raise InputError('Tasks at the same place must use the same contact permission.')
                place_permissions[place] = permission
        for task_id, force in task_forces.items():
            by_task[task_id]['request']['force'].update(minimum_n=force['min'], maximum_n=force['max'])
            by_task[task_id]['request']['force']['basis'] = 'Customer requirement entered for this browser example; not a measured cleaning requirement.'
        # Permission belongs to a place, so all tasks there share the same value.
        for place, permission in place_permissions.items():
            for conditions in scenario['conditions'].values():
                conditions['locations'][place]['contact_permission'] = permission
    context = {k: v for k, v in scenario.items() if k != 'synthetic_declarations'}
    browser_binding = digest({'scenario': context, 'catalogue': CATALOGUE, 'human_roles': ROLES})
    if 'declarations' in payload:
        declarations = _browser_declarations(payload['declarations'], scenario, browser_binding)
    else:
        declarations = deepcopy(scenario.get('synthetic_declarations', {})) if declared else {}
    result = plan(scenario, deepcopy(CATALOGUE), declarations=declarations, human_roles=deepcopy(ROLES))
    return {'plan': result, 'scenario': scenario, 'inputs': deepcopy(payload),
            'people': deepcopy(scenario['team']['people']), 'robots': deepcopy(scenario['team']['robots']),
            'slots': deepcopy(scenario['slots']), 'jobBinding': browser_binding,
            'availableActions': _job_actions(result, scenario, declarations, browser_binding),
            'declarationNote': 'Each browser action is a hypothetical choice or confirmation for this exact authored plan. It is not an authenticated approval or a robot command. Changes to the team or conditions require a new action.',
            'scope': deepcopy(SCOPE), 'provenance': deepcopy(PROVENANCE)}


JOB_PRESETS = [
    {'id': 'team_free', 'label': 'Tested contexts · everyone available',
     'description': 'H1 has the attendant, operator and confirmer roles. H2 can perform trained glass wiping. Availability is an authored input.',
     'inputs': {'scenario': 'tested_contexts', 'peopleAvailability': {'H1': {'slot-1': 'AVAILABLE', 'slot-2': 'AVAILABLE'}, 'H2': {'slot-1': 'AVAILABLE', 'slot-2': 'AVAILABLE'}}}},
    {'id': 'h1_later', 'label': 'H1 busy first, available later',
     'description': 'H1 is busy in logical slot 1 and available in slot 2. These slots have no measured duration.',
     'inputs': {'scenario': 'tested_contexts', 'peopleAvailability': {'H1': {'slot-1': 'BUSY', 'slot-2': 'AVAILABLE'}}}},
    {'id': 'h1_busy', 'label': 'H1 unavailable throughout',
     'description': 'The person with the robot roles is unavailable in both logical slots. H2 does not inherit those roles.',
     'inputs': {'scenario': 'tested_contexts', 'peopleAvailability': {'H1': {'slot-1': 'BUSY', 'slot-2': 'BUSY'}}}},
    {'id': 'customer_h2_busy', 'label': 'New building · H2 unavailable',
     'description': 'Customer tasks still need supporting robot records. A shortage of people also affects the declared manual alternatives.',
     'inputs': {'scenario': 'customer_building', 'peopleAvailability': {'H2': {'slot-1': 'BUSY', 'slot-2': 'BUSY'}}}}
]


def bootstrap():
    passed = {k: 'PASS' for k in CONDITION_FIELDS}
    passed['availability'] = 'AVAILABLE'
    presets = []
    for name, label, extra in [('g1_7', 'G1 · tested 7 N', {'robot': 'G1', 'target': 'B', 'force': {'min': 7, 'max': 7}}),
                               ('g1_range', 'G1 · owner accepts 6–8 N', {'robot': 'G1', 'target': 'D', 'force': {'min': 6, 'max': 8}}),
                               ('g1_gap', 'G1 · untested exact 7.5 N', {'robot': 'G1', 'target': 'B', 'force': {'min': 7.5, 'max': 7.5}}),
                               ('g1_physical', 'G1 · physical evidence gap', {'robot': 'G1', 'domain': 'physical', 'target': 'B'}),
                               ('ur3', 'UR3 · registered handover', {'robot': 'UR3'}),
                               ('ur5', 'UR5 · target detection', {'robot': 'UR5'})]:
        presets.append({'id': name, 'label': label, 'inputs': dict(passed, **extra),
                        'notice': 'This preset assumes passing conditions for an authored demonstration. No sensor verified them.'})
    return {'profiles': deepcopy(CATALOGUE), 'humanRoles': deepcopy(ROLES), 'cases': deepcopy(CASES),
            'presets': presets, 'jobPresets': deepcopy(JOB_PRESETS), 'scenarios': [{'id': name, 'label': 'Tested contexts' if name == 'tested_contexts' else 'Customer building',
                                              'description': s['description']} for name, s in SCENARIOS.items()],
            'scope': deepcopy(SCOPE), 'provenance': deepcopy(PROVENANCE)}


def evidence(profile_id):
    if type(profile_id) is not str or profile_id not in BY_ID:
        raise InputError('Unknown evidence profile.')
    profile = deepcopy(BY_ID[profile_id])
    record_doc = json.loads((VENDOR / 'records/CASE_CAPABILITY_RECORDS.json').read_text())
    records = [r for r in record_doc['records'] if r['id'] in profile['evidence_ids']]
    extra = []
    if profile['platform'] == 'UR5':
        for name in ('UR5_OPERATION_CLARIFICATION.json', 'UR5_OPERATION_CONFIRMATION_R37.json'):
            extra.append({'file': 'records/' + name, 'record': json.loads((VENDOR / 'records' / name).read_text())})
    return {'profile': profile, 'records': records, 'additionalRecords': extra,
            'sourceNote': 'Profile and record text are exact copies. Historical source references may point to archives outside this small app; source references are not assertions that every raw file ships here.',
            'provenance': deepcopy(PROVENANCE)}
