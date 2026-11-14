"""Map declared customer jobs to the offline planner's manual routes.

Inputs are hypothetical declarations, not verified site assessments or worker records.
No customer-building task gains a robot capability from this form.
"""
from copy import deepcopy
from datetime import date, datetime, timezone
from functools import lru_cache
from itertools import permutations
from hashlib import sha256
import re
import unicodedata

from planner_service import CATALOGUE, ROLES, PROVENANCE, InputError, plan, digest, select, live_for
from selector import EVIDENCE_LEVELS

RELEASE = 'manager-pack-r5-20261114'
MAX_TASKS = 12
STATES = ('UNKNOWN', 'PASS', 'FAIL')
AVAILABILITY = ('UNKNOWN', 'AVAILABLE', 'BUSY')
ROUNDS = ('round-1', 'round-2')
ROBOTS = ('UR3', 'UR5', 'G1')
TASK_TYPES = [
    {'id': 'whiteboard', 'label': 'Wipe a whiteboard', 'training': 'whiteboard_wiping',
     'robotStatus': 'No qualified robot wipe for this new board. The UR5 record covers target detection in its tested cell.'},
    {'id': 'glass', 'label': 'Clean inside glass', 'training': 'glass_wiping',
     'robotStatus': 'No recorded robot glass-wiping capability for this new place.'},
    {'id': 'wall', 'label': 'Remove wall marks', 'training': 'wall_wiping',
     'robotStatus': 'No physical wall-wiping record for this place. G1 evidence is simulation only.'},
    {'id': 'desks', 'label': 'Wipe desks and worktops', 'training': 'desk_wiping',
     'robotStatus': 'No recorded robot desk-cleaning capability.'},
    {'id': 'floor', 'label': 'Clean a floor', 'training': 'floor_cleaning',
     'robotStatus': 'No recorded floor-cleaning or mobile robot route.'},
    {'id': 'bins', 'label': 'Empty ordinary bins', 'training': 'ordinary_waste_handling',
     'robotStatus': 'No recorded robot bin-handling route. Hazardous waste and sharps need separate review.'},
    {'id': 'facade', 'label': 'Clean outside building surfaces', 'training': 'facade_cleaning',
     'robotStatus': 'No qualified robot or ordinary manual route. Outside building surfaces need specialist planning.'},
]
TYPES = {t['id']: t for t in TASK_TYPES}
TRAINING = {t['training'] for t in TASK_TYPES}
PEOPLE = [
    {'id': 'H1', 'label': 'Robot helper', 'baseTraining': ['glass_wiping', 'whiteboard_wiping']},
    {'id': 'H2', 'label': 'Glass cleaner', 'baseTraining': ['glass_wiping']},
]
SCOPE = {
    'mode': 'authored_customer_planning_example', 'domain': 'physical',
    'robotConnection': False, 'dispatch': False, 'releaseAuthority': False,
    'factsVerified': False, 'newRobotEvidence': False, 'timedScheduling': False,
    'note': 'A conditional manual-work plan from user declarations. No real work is approved or completed.',
    'manualPermission': 'Permission to consider a manual route in this example; not worker consent or a safety certificate.',
    'training': 'Additional skills are user declarations, not independently verified qualifications.',
    'rounds': 'Two ordering rounds with no measured duration, travel or cost model.',
    'dependencies': 'A dependent task stays unassigned until completion evidence exists. If no upstream manual route is permitted, the compiler also withholds the dependent route; the original dependency remains in effective inputs and display rows.',
    'robotScope': 'No qualified robot route is modelled for these new-building tasks. Task cards do not create capability evidence.',
    'review': 'A named review is a user declaration bound to the entered job, not authentication, legal approval or a verified safety assessment.',
    'specialist': 'Facade work and unknown or specialist access never gain an ordinary manual assignment here, even when every answer is marked checked.',
}
# Shared check labels for the form and its explanations.
CHECK_LABELS = {
    'site': {'accessArranged': 'Access has been arranged', 'siteRulesReviewed': 'Site rules have been reviewed'},
    'room': {'routes': 'Paths and exits are clear', 'people': 'People nearby are protected',
             'hazards': 'Cleaning products, wet floors, cables and other hazards have been dealt with'},
    'surface': {'permission': 'Owner allows contact', 'condition': 'Surface condition has been checked',
                'method': 'Cleaning method suits this surface'},
    'manual': {'permission': 'Manual work is allowed',
               'equipment': 'Suitable equipment and protective gear are ready; lifting has been considered',
               'training': 'Training required for this job has been checked'},
}
STATE_WORDS = {'PASS': 'Checked', 'FAIL': 'Needs attention', 'UNKNOWN': 'Not checked'}
ASSESSMENT_WORDS = {'missing': 'Not recorded', 'incomplete': 'Incomplete: it needs a name, a date and a decision',
                    'stale': 'Out of date: the entries changed after it was recorded', 'rejected': 'Recorded as needs attention',
                    'current': 'Recorded for these entries'}
PERMISSION_WORDS = {'PASS': 'Allowed', 'FAIL': 'Not allowed', 'UNKNOWN': 'Not checked'}
# Capabilities each job needs, expressed using the register's capability types.
# None means the register contains no matching capability for any robot.
RESULT_PART = ('result', 'Show that the surface ends up clean', None)
ROBOT_PARTS = {
    'whiteboard': [('locate', 'Find the marked area', 'target_detection'),
                   ('wipe', 'Wipe it with a set pressing force', 'regulated_wipe'), RESULT_PART],
    'glass': [('wipe', 'Wipe the glass with a set pressing force', 'regulated_wipe'), RESULT_PART],
    'wall': [('wipe', 'Wipe the wall with a set pressing force', 'regulated_wipe'), RESULT_PART],
    'desks': [('wipe', 'Wipe the surface with a set pressing force', 'regulated_wipe'), RESULT_PART],
    'floor': [('floor', 'Move across the floor and clean it', None)],
    'bins': [('bins', 'Pick up, carry and empty the bin', None)],
    'facade': [('access', 'Reach the outside surface', None),
               ('wipe', 'Wipe the surface with a set pressing force', 'regulated_wipe'), RESULT_PART],
}
NO_RECORD = {
    'result': ('No record measures how clean a surface ends up, for any robot.', 'A measured cleaning result for this kind of surface.'),
    'floor': ('No record shows a robot moving across a floor and cleaning it.', 'A capability record for floor cleaning. None exists for any robot in the register.'),
    'bins': ('No record shows a robot picking up or emptying a bin.', 'A capability record for handling bins. None exists for any robot in the register.'),
    'access': ('No record shows a robot reaching an outside building surface.', 'A specialist access plan and a capability record for outside work. Ordinary checklist answers cannot supply either.'),
}
FIELD_WORDS = {'capability': 'kind of ability', 'domain': 'real or simulated', 'context': 'test place',
               'target': 'target', 'mode': 'way of working', 'evidence_level': 'kind of evidence',
               'settings': 'settings', 'setpoint': 'pressing force'}
EVIDENCE_NEEDED = {
    'domain': 'A physical test. The existing record is a simulation.',
    'context': 'A recorded test in this building. The app never treats another place as the same.',
    'target': 'A recorded test on this kind of target at this place.',
    'evidence_level': 'Evidence of a kind accepted for physical work.',
    'mode': 'A recorded test using a way of working that this job allows.',
}
MODE_WORDS = {
    'attended_start_automatic_detection': 'A person starts it and watches. No OK is needed for each target.',
    'explicit_command_confirmation_STOP': 'A person gives each command, confirms with an OK and can stop it.',
    'virtual_confirmation_then_bounded_wipe': 'In the simulation a scripted hand pointed and gave the OK. A real job in this mode would need a person to point and confirm.',
}
ROBOT_WORDS = {
    'UR3': ('Handover arm', 'Passed registered cubes to one operator in its published test cell.'),
    'UR5': ('Camera detection arm', 'Our UR5 study reports finding a taped area on a whiteboard in its test setting. Detection only.'),
    'G1': ('Humanoid', 'In simulation, wiped a small circle at each of four marked spots on one test wall and held still, with the robot held at its pelvis. No dirt removal was measured.'),
}
PERSON_ROLES = {'H1': ['attendant', 'confirmer', 'operator'], 'H2': []}
# The evidence check assumes passing current conditions; the job plan uses the entered checks.
EVIDENCE_CHECK_ASSUMPTION = 'For this evidence check only, all current conditions are assumed to pass. Your actual place checks are applied separately to the job plan.'
ROUTE_NOTE = 'The current building flow only plans manual work. Robot assignment would need applicable reviewed evidence and a reviewed update to this planning route.'
GAPS_NOTE = 'These are evidence gaps we can name. Closing them would not, by itself, qualify a robot for this job.'
# A bundled research record whose wording is stronger than our sources. It is an exact copy, so it is corrected in the
# research release first. Until then the supported wording is given wherever the record is served.
PENDING_RECORD_CORRECTIONS = [{
    'file': 'records/UR5_OPERATION_CONFIRMATION_R37.json',
    'recordSays': 'Active contact-force regulation was not implemented and no contact-force value was measured.',
    'alsoSays': 'active contact-force regulation was not implemented and no force value was measured, although a brush in contact still exerts force',
    'supported': 'We did not implement active contact-force regulation in our UR5 prototype, and we report no measured contact-force value.',
    'why': 'Our sources support that we report no measured value. They do not establish that no measurement was ever made.',
    'status': 'The bundled record is an unchanged copy. A corrected successor record is pending review in the research release.'}]


def _object(value, keys, label):
    if type(value) is not dict or set(value) != set(keys):
        raise InputError(label + ' must contain exactly: ' + ', '.join(sorted(keys)))
    return value


def _enum(value, choices, label):
    if type(value) is not str or value not in choices:
        raise InputError(label + ' has an unsupported value.')
    return value


def _text(value, label, maximum=100):
    if type(value) is not str or not value.strip() or len(value) > maximum or any(unicodedata.category(c) in ('Cc', 'Cf', 'Cs') for c in value):
        raise InputError(label + ' needs short, nonempty text without control characters.')
    return unicodedata.normalize('NFKC', value).strip()


def _identity(value):
    return ' '.join(unicodedata.normalize('NFKC', value).casefold().split())


def _label_identity(value):
    return _identity(''.join(' ' if unicodedata.category(c).startswith('P') else c for c in value))


def _identifier(value, label):
    if type(value) is not str or not re.fullmatch(r'[A-Za-z0-9_-]{1,32}', value):
        raise InputError(label + ' needs a short ID using letters, digits, underscores or hyphens.')
    return value


def evaluation_context(value=None):
    if value is None:
        return {'admissionDateUtc': datetime.now(timezone.utc).date().isoformat()}
    _object(value, {'admissionDateUtc'}, 'Evaluation context')
    text = value['admissionDateUtc']
    if type(text) is not str or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', text):
        raise InputError('Admission date must use YYYY-MM-DD.')
    try:
        date.fromisoformat(text)
    except ValueError as exc:
        raise InputError('Admission date must be a real calendar date.') from exc
    return {'admissionDateUtc': text}


def _fields(value, required, optional, label):
    if type(value) is not dict or not set(required).issubset(value) or set(value) - set(required) - set(optional):
        raise InputError(label + ' has missing or unsupported fields.')
    return value


def _optional_text(value, label, maximum=100):
    if value == '' and type(value) is str:
        return ''
    return _text(value, label, maximum)


def _checks(value, keys, label):
    _object(value, keys, label)
    return {key: _enum(value[key], STATES, label + ' / ' + key) for key in keys}


def _combined(values):
    return 'FAIL' if 'FAIL' in values else 'UNKNOWN' if 'UNKNOWN' in values else 'PASS'


def robot_profiles():
    """Describe each robot's recorded capability, test setting and required human roles."""
    profiles = []
    for platform in ROBOTS:
        records = [record for record in CATALOGUE if record['platform'] == platform]
        modes = sorted({record['mode'] for record in records})
        # The original planner also asks for the confirmer role when a record needs a confirmation.
        roles = sorted({role for mode in modes for role in ROLES[mode]['roles']}
                       | ({'confirmer'} if any(record['confirmation_required'] for record in records) else set()))
        profiles.append({
            'platform': platform, 'label': ROBOT_WORDS[platform][0], 'shown': ROBOT_WORDS[platform][1],
            'capabilities': sorted({record['capability'] for record in records}),
            'domains': sorted({record['domain'] for record in records}),
            'evidenceLevels': sorted({record['evidence_level'] for record in records}),
            'profileIds': [record['id'] for record in records],
            'needsRoles': roles, 'needsPerson': [MODE_WORDS[mode] for mode in modes],
            'confirmationPerTarget': any(ROLES[mode]['per_target_confirmation'] for mode in modes),
            'peopleWithRoles': [p['id'] for p in PEOPLE if set(roles) <= set(PERSON_ROLES[p['id']])],
            'newBuilding': 'The app has no evidence for this building. This robot cannot be assigned here.'})
    return profiles


def customer_bootstrap():
    return {
        'schemaVersion': 3, 'release': RELEASE, 'taskTypes': deepcopy(TASK_TYPES), 'people': deepcopy(PEOPLE),
        'robots': list(ROBOTS), 'limits': {'maxTasks': MAX_TASKS, 'rounds': [1, 2], 'people': len(PEOPLE)},
        'checkLabels': deepcopy(CHECK_LABELS), 'robotProfiles': robot_profiles(),
        'personRoles': deepcopy(PERSON_ROLES), 'examples': customer_examples(),
        'scope': deepcopy(SCOPE),
        'defaultInputs': {'schemaVersion': 3,
                         'context': {'company': '', 'customer': '', 'buildingId': '', 'buildingName': '', 'jobName': ''},
                         'siteChecks': {'accessArranged': 'UNKNOWN', 'siteRulesReviewed': 'UNKNOWN'},
                         'review': {'by': '', 'date': '', 'reference': '', 'decision': 'UNKNOWN', 'scope': None},
                         'robots': list(ROBOTS), 'rooms': [], 'tasks': [],
                         'people': [{'id': p['id'], 'availability': {r: 'UNKNOWN' for r in ROUNDS},
                                     'additionalTraining': []} for p in PEOPLE]},
    }


def validate_customer(payload, *, evaluation=None):
    evaluation = evaluation_context(evaluation)
    _object(payload, {'schemaVersion', 'context', 'siteChecks', 'review', 'robots', 'tasks', 'people', 'rooms'}, 'Customer request')
    if type(payload['schemaVersion']) is not int or payload['schemaVersion'] != 3:
        raise InputError('Customer request needs schema version 3.')
    _fields(payload['context'], {'buildingId', 'buildingName'}, {'company', 'customer', 'jobName'}, 'Job details')
    context = {key: _text(payload['context'][key], key) for key in ('buildingId', 'buildingName')}
    context.update({key: _optional_text(payload['context'].get(key, ''), key) for key in ('company', 'customer', 'jobName')})
    site_checks = _checks(payload['siteChecks'], ('accessArranged', 'siteRulesReviewed'), 'Building checks')
    _fields(payload['review'], {'decision', 'scope'}, {'by', 'date', 'reference'}, 'Review')
    review = {key: _optional_text(payload['review'].get(key, ''), 'Review ' + key) for key in ('by', 'date', 'reference')}
    review['decision'] = _enum(payload['review']['decision'], STATES, 'Review decision')
    if review['date']:
        if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', review['date']):
            raise InputError('Review date must use YYYY-MM-DD.')
        try:
            recorded_date = date.fromisoformat(review['date'])
        except ValueError as exc:
            raise InputError('Review date must be a real calendar date.') from exc
        if recorded_date > date.fromisoformat(evaluation['admissionDateUtc']):
            raise InputError('Review date cannot be in the future.')
    if payload['review']['scope'] is not None and type(payload['review']['scope']) is not dict:
        raise InputError('Review scope must be a job object or null.')
    review['scope'] = deepcopy(payload['review']['scope'])
    robots = payload['robots']
    if type(robots) is not list or any(type(r) is not str or r not in ROBOTS for r in robots) or len(set(robots)) != len(robots):
        raise InputError('Robots must list distinct known platform names.')
    people = payload['people']
    if type(people) is not list or len(people) != 2:
        raise InputError('Declare H1 and H2 once each.')
    by_person = {}
    for p in people:
        _fields(p, {'id', 'availability', 'additionalTraining'}, {'label'}, 'Person')
        pid = _enum(p['id'], ('H1', 'H2'), 'Person ID')
        if pid in by_person:
            raise InputError('People must have distinct IDs.')
        _object(p['availability'], ROUNDS, 'Availability')
        availability = {r: _enum(p['availability'][r], AVAILABILITY, 'Availability') for r in ROUNDS}
        extra = p['additionalTraining']
        if type(extra) is not list or any(type(t) is not str or t not in TRAINING for t in extra) or len(set(extra)) != len(extra):
            raise InputError('Additional training must list distinct known skills.')
        by_person[pid] = {'id': pid, 'availability': availability, 'additionalTraining': sorted(extra)}
        if 'label' in p:
            by_person[pid]['label'] = _optional_text(p['label'], 'Person label')
    if set(by_person) != {'H1', 'H2'}:
        raise InputError('Declare H1 and H2 once each.')
    if type(payload['rooms']) is not list or not 1 <= len(payload['rooms']) <= MAX_TASKS:
        raise InputError('Declare between 1 and 12 rooms.')
    rooms, room_names = {}, set()
    for room in payload['rooms']:
        _object(room, {'id', 'name', 'checks'}, 'Room')
        rid, name = _identifier(room['id'], 'Room ID'), _text(room['name'], 'Room name')
        normal = _label_identity(name)
        if rid in rooms or not normal or normal in room_names:
            raise InputError('Room IDs and room names must be distinct; choose the existing room instead of an alias.')
        room_names.add(normal)
        rooms[rid] = {'id': rid, 'name': name, 'checks': _checks(room['checks'], ('routes', 'people', 'hazards'), 'Room checks')}
    tasks = payload['tasks']
    if type(tasks) is not list or not 1 <= len(tasks) <= MAX_TASKS:
        raise InputError('Choose between 1 and 12 tasks.')
    cleaned, ids, places, place_names = [], set(), {}, {}
    fields = {'id', 'type', 'roomId', 'placeId', 'place', 'round', 'dependsOn', 'access', 'checks', 'specialist'}
    for task in tasks:
        _fields(task, fields, {'method'}, 'Task')
        tid = task['id']
        if type(tid) is not str or not re.fullmatch(r'[A-Za-z0-9_-]{1,32}', tid) or tid in ids:
            raise InputError('Task IDs must be distinct short letters, digits, underscores or hyphens.')
        ids.add(tid)
        t = deepcopy(task)
        t['type'] = _enum(t['type'], TYPES, 'Task type')
        t['roomId'] = _identifier(t['roomId'], 'Room ID')
        t['placeId'] = _identifier(t['placeId'], 'Place ID')
        if t['roomId'] not in rooms:
            raise InputError('Each task must name a declared room ID.')
        t['place'] = _text(t['place'], 'Place')
        if type(t['round']) is not int or t['round'] not in (1, 2):
            raise InputError('Round must be 1 or 2.')
        if t['dependsOn'] is not None and (type(t['dependsOn']) is not str or not re.fullmatch(r'[A-Za-z0-9_-]{1,32}', t['dependsOn'])):
            raise InputError('Dependency must name one earlier task or be null.')
        t['method'] = _optional_text(t.get('method', ''), 'Cleaning method', 300)
        t['access'] = _enum(t['access'], ('UNKNOWN', 'ORDINARY', 'SPECIALIST'), 'Access')
        _object(t['checks'], ('surface', 'manual'), 'Task checks')
        t['checks'] = {key: _checks(t['checks'][key], names, key + ' checks') for key, names in (
            ('surface', ('permission', 'condition', 'method')),
            ('manual', ('permission', 'equipment', 'training')))}
        _fields(t['specialist'], {'weather', 'ground', 'publicProtection'}, {'accessPlan'}, 'Specialist details')
        t['specialist'] = {'accessPlan': _optional_text(t['specialist'].get('accessPlan', ''), 'Access plan', 300),
            **{key: _enum(t['specialist'][key], STATES, key) for key in ('weather', 'ground', 'publicProtection')}}
        key = t['placeId']
        guards = (t['roomId'], _identity(t['place']), {key: t['checks']['surface'][key] for key in ('permission', 'condition')})
        if key in places and places[key] != guards:
            raise InputError('Tasks at the same place ID must agree on room, name and contact permission.')
        label_key = (t['roomId'], _label_identity(t['place']))
        if not label_key[1] or (label_key in place_names and place_names[label_key] != key):
            raise InputError('Duplicate place names need the existing place ID; do not create aliases.')
        place_names[label_key] = key
        places[key] = guards
        cleaned.append(t)
    by_task = {t['id']: t for t in cleaned}
    for t in cleaned:
        dep = t['dependsOn']
        if dep is not None and (dep not in by_task or by_task[dep]['round'] >= t['round']):
            raise InputError('A dependency must name an existing task in an earlier round.')
    return {'schemaVersion': 3, 'context': context, 'siteChecks': site_checks, 'review': review,
            'robots': list(robots), 'rooms': list(rooms.values()), 'tasks': cleaned,
            'people': [by_person[p['id']] for p in PEOPLE]}


def _assessment(inputs, raw):
    review = inputs['review']
    scope = {key: value for key, value in raw.items() if key != 'review'}
    if review['decision'] == 'FAIL':
        status, state = 'rejected', 'FAIL'
    elif review['decision'] != 'PASS':
        status, state = 'missing', 'UNKNOWN'
    elif not review['by'] or not review['date'] or review['scope'] is None:
        status, state = 'incomplete', 'UNKNOWN'
    elif digest(review['scope']) != digest(scope):
        status, state = 'stale', 'UNKNOWN'
    else:
        status, state = 'current', 'PASS'
    tasks = {}
    rooms = {room['id']: _combined(list(room['checks'].values())) for room in inputs['rooms']}
    for task in inputs['tasks']:
        checks = task['checks']
        tasks[task['id']] = {
            'placeSafety': rooms[task['roomId']],
            'contactPermission': _combined([checks['surface']['permission'], checks['surface']['condition']]),
            'manualPermission': _combined(list(checks['manual'].values()) + [checks['surface']['method'], 'PASS' if task['method'] else 'UNKNOWN']),
            'specialAccess': task['type'] == 'facade' or task['access'] != 'ORDINARY',
        }
    return {'review': {'status': status, 'state': state},
            'siteSafety': _combined(list(inputs['siteChecks'].values()) + [state]), 'rooms': rooms, 'tasks': tasks}


def _scenario(inputs, assessment):
    places, task_places = {}, {}
    room_names = {room['id']: room['name'] for room in inputs['rooms']}
    areas = {}
    for t in inputs['tasks']:
        building = [_identity(inputs['context'][key]) for key in ('company', 'customer', 'buildingId')]
        area_id = 'area_' + digest([building, t['roomId']])[:24]
        place_id = 'place_' + digest([building, t['roomId'], t['placeId']])[:24]
        task_places[t['id']] = (area_id, place_id)
        places[place_id] = {'area': area_id, 'targets': [], 'description': room_names[t['roomId']] + ' / ' + t['place']}
        areas[area_id] = assessment['rooms'][t['roomId']]
    locations = {}
    for t in inputs['tasks']:
        guards = assessment['tasks'][t['id']]
        locations[task_places[t['id']][1]] = {'safety': guards['placeSafety'], 'contact_permission': guards['contactPermission']}
    conditions = {r: {'shared_safety': assessment['siteSafety'], 'areas': deepcopy(areas),
                      'locations': deepcopy(locations)} for r in ROUNDS}
    people = []
    for p, base in zip(inputs['people'], PEOPLE):
        people.append({'id': p['id'], 'training': sorted(set(base['baseTraining'] + p['additionalTraining'])),
                       'roles': ['attendant', 'confirmer', 'operator'] if p['id'] == 'H1' else [],
                       'availability': deepcopy(p['availability'])})
    tasks = []
    for t in inputs['tasks']:
        area, place = task_places[t['id']]
        task = {'id': t['id'], 'label': TYPES[t['type']]['label'] + ' — ' + room_names[t['roomId']] + ' / ' + t['place'],
                'slot': 'round-' + str(t['round']), 'area': area, 'location': place, 'contact': True, 'request': None}
        # A withheld manual route has no outputs. A dependent task cannot invent them.
        guards = assessment['tasks'][t['id']]
        if guards['manualPermission'] == 'PASS' and not guards['specialAccess']:
            task['manual_alternative'] = {'mode': 'manual_' + t['type'], 'training': TYPES[t['type']]['training'],
                'contact': True, 'criteria': 'User permits this ordinary manual task in an authored example; completion must be checked separately.',
                'produces': ['completed']}
        tasks.append(task)
    # All declared dependencies must be representable even when the upstream manual route is withheld.
    for t, task in zip(inputs['tasks'], tasks):
        if t['dependsOn'] is not None:
            producer = next(x for x in tasks if x['id'] == t['dependsOn'])
            if producer.get('manual_alternative') is not None:
                task['needs'] = [[t['dependsOn'], 'completed']]
    return {'id': 'customer_job_' + digest(inputs)[:24],
            'description': 'User-authored physical building tasks; hypothetical conditions and manual routes only.',
            'places': places, 'slots': list(ROUNDS), 'conditions': conditions,
            'team': {'robots': deepcopy(inputs['robots']), 'people': people},
            'live': {'snapshot_id': 'AUTHORED_CUSTOMER_' + digest(inputs),
                     'platform_availability': {r: 'UNKNOWN' for r in ROBOTS}},
            'tasks': tasks}


def _maximum_manual_order(scenario, guarded):
    """Match ready manual tasks, then let the original planner apply every guard again."""
    ready = {row['id'] for row in guarded['tasks'] if row['state'] in ('MANUAL_ASSIGNED', 'WAITING_FOR_PERSON') and row['route'] == 'manual'}
    people = scenario['team']['people']
    if len(people) != 2:
        raise InputError('This staffing policy supports exactly two declared people.')
    ordered, maxima = [], {}
    for slot in scenario['slots']:
        stage = [task for task in scenario['tasks'] if task['slot'] == slot]
        candidates = [task for task in stage if task['id'] in ready]
        edges = [{i for i, person in enumerate(people) if person['availability'][slot] == 'AVAILABLE'
                  and task['manual_alternative']['training'] in person['training']} for task in candidates]

        @lru_cache(None)
        def matching(index, used):
            if index == len(candidates):
                return ()
            alternatives = [matching(index + 1, used)]
            for person in sorted(edges[index]):
                if not used & (1 << person):
                    alternatives.append(((index, person),) + matching(index + 1, used | (1 << person)))
            return min(alternatives, key=lambda pairs: (-len(pairs), tuple(task for task, unused in pairs), pairs))

        chosen = matching(0, 0)
        maxima[slot] = len(chosen)
        chosen_tasks = tuple(index for index, unused in chosen)
        # With two workers, one of these at most two orders realizes the matching.
        prefix = None
        for trial in permutations(chosen_tasks):
            used = set()
            for index in trial:
                person = next((i for i in range(2) if i in edges[index] and i not in used), None)
                if person is not None:
                    used.add(person)
            if len(used) == len(chosen):
                prefix = [candidates[index] for index in trial]
                break
        if prefix is None:
            raise InputError('The staffing arrangement cannot be realized by this bounded adapter.')
        selected = {task['id'] for task in prefix}
        ordered.extend(prefix + [task for task in stage if task['id'] not in selected])
    result = deepcopy(scenario)
    result['tasks'] = ordered
    policy = {'id': 'maximum_ready_manual_matching_two_people_v1',
              'declaredOrder': [task['id'] for task in scenario['tasks']],
              'effectiveOrder': [task['id'] for task in ordered],
              'maximumAssignmentsByStage': maxima,
              'tieBreak': 'Prefer the earliest listed ready tasks that can be staffed together, then earlier declared people; realize these reservations through effective processing order.',
              'scope': 'Maximum assignment count for ready independent manual tasks within each stage and the two declared people. No duration, travel, cost or cross-stage dependency optimization. The canonical planner reruns all guards.'}
    return result, policy


def _part_scope(inputs, task, capability):
    """State what this building job asks of one recorded ability, without borrowing a tested setting."""
    building = [_identity(inputs['context'][key]) for key in ('company', 'customer', 'buildingId')]
    context = 'customer_building_' + digest([building, task['roomId']])[:24]
    target = 'customer_place_' + digest([building, task['roomId'], task['placeId']])[:24]
    if any(record['context'] == context or record['target'] == target for record in CATALOGUE):
        raise InputError('A customer place must not share an identity with a tested record.')
    records = [record for record in CATALOGUE if record['capability'] == capability]
    return {'capability': capability, 'domain': 'physical', 'context': context, 'allowed_targets': [target],
            'allowed_modes': sorted({record['mode'] for record in records}),
            'accepted_evidence_levels': sorted(level for level in EVIDENCE_LEVELS if level.startswith('physical'))}


def _scope_gap(scope, record):
    """Compare scope fields in the same way as the decision rule, without a force setpoint."""
    gap = [field for field in ('capability', 'domain', 'context') if record[field] != scope[field]]
    if record['target'] not in scope['allowed_targets']:
        gap.append('target')
    if record['mode'] not in scope['allowed_modes']:
        gap.append('mode')
    if record['evidence_level'] not in scope['accepted_evidence_levels']:
        gap.append('evidence_level')
    return sorted(gap)


def _robot_parts(inputs, task):
    """Check each part of a job against the records. Call the decision rule only for requests consistent with the entered job."""
    parts, calls = [], 0
    for part_id, label, capability in ROBOT_PARTS[task['type']]:
        part = {'id': part_id, 'label': label, 'capability': capability, 'status': 'NOT_SUPPORTED_HERE'}
        if capability is None:
            part.update(selector={'called': False, 'reason': 'The register holds no ability of this kind for any robot, so no request can be formed.'},
                        records=[], summary=NO_RECORD[part_id][0], evidenceNeeded=[NO_RECORD[part_id][1]])
            parts.append(part)
            continue
        scope = _part_scope(inputs, task, capability)
        records = []
        for record in CATALOGUE:
            if record['capability'] != capability:
                continue
            gap = _scope_gap(scope, record)
            records.append({'id': record['id'], 'platform': record['platform'], 'onTeam': record['platform'] in inputs['robots'],
                            'domain': record['domain'], 'evidenceLevel': record['evidence_level'],
                            'differs': gap, 'differsWords': [FIELD_WORDS[field] for field in gap],
                            'evidenceIds': list(record['evidence_ids'])})
        fields = {field for record in records for field in record['differs']}
        needed = [EVIDENCE_NEEDED[field] for field in ('domain', 'context', 'target', 'evidence_level', 'mode') if field in fields]
        matching = [record for record in CATALOGUE if record['capability'] == capability]
        roles = sorted({role for record in matching for role in ROLES[record['mode']]['roles']}
                       | ({'confirmer'} if any(record['confirmation_required'] for record in matching) else set()))
        needed.append('A free person who holds the ' + ' and '.join(roles) + (' roles' if len(roles) > 1 else ' role') + ' for the robot.')
        if capability == 'regulated_wipe':
            needed.insert(0, 'A pressing force stated by the owner, which a tested setting meets.')
            part['selector'] = {'called': False, 'reason': 'A wiping request must state the pressing force the owner allows. This form does not ask for one, because no physical wiping record exists that it could match.'}
            part['recordsNote'] = 'Pressing force and settings were not compared, because no force was stated. The differences listed are the least that apply.'
            simulated = {record['domain'] for record in records} == {'simulation'}
            part['summary'] = ('The wiping records are simulations at a test wall. None is a physical test, and none covers this building.'
                               if simulated else 'The wiping records do not cover this building.')
        else:
            request = dict(scope, id='customer_part_' + task['id'] + '_' + part_id, force=None, required_settings={}, metrics=[],
                           mode_priority=[], mode_priority_basis='', candidate_priority=[], candidate_priority_basis='')
            outcome = select(request, deepcopy(CATALOGUE), live_for(CATALOGUE, 'PASS'))
            calls += 1
            # A new building can never inherit a tested setting through this path.
            if outcome['decision'] != 'WITHHOLD' or outcome['remaining'] or outcome['configuration'] is not None:
                raise InputError('A new-building request unexpectedly matched a tested record.')
            if any(outcome['not_applicable'].get(record['id']) != record['differs'] for record in records):
                raise InputError('The scope comparison disagrees with the decision rule.')
            part['selector'] = {'called': True, 'decision': outcome['decision'], 'reasons': list(outcome['reasons']),
                                'assumption': EVIDENCE_CHECK_ASSUMPTION,
                                'note': 'This is the most permissive request the form can truthfully make: every recorded way of working and every kind of physical evidence is allowed. The different test place and target prevent a matching record.',
                                'request': request, 'binding': outcome['binding'],
                                'notApplicable': {key: list(value) for key, value in sorted(outcome['not_applicable'].items())}}
            part['summary'] = 'A record of this kind exists for another test place only. The decision rule withholds it for this building.'
        part['records'] = records
        part['evidenceNeeded'] = needed
        parts.append(part)
    return parts, calls


def _robot_coverage(inputs):
    """Compare each job with the recorded scope. No request is altered to obtain a recommendation."""
    coverage = {}
    for task in inputs['tasks']:
        robots = []
        for platform in ROBOTS:
            records = [record for record in CATALOGUE if record['platform'] == platform]
            capabilities = sorted({record['capability'] for record in records})
            if platform not in inputs['robots']:
                status, reason = 'NOT_ON_TEAM', 'This robot is not on the declared team.'
            elif task['type'] == 'whiteboard' and 'target_detection' in capabilities:
                status, reason = 'SUBTASK_ONLY', 'The UR5 record covers finding a target in its tested cell. It does not qualify this full cleaning task at this building.'
            elif task['type'] in ('wall', 'whiteboard', 'glass', 'desks', 'facade') and 'regulated_wipe' in capabilities:
                domains = {record['domain'] for record in records if record['capability'] == 'regulated_wipe'}
                status = 'SIMULATION_ONLY' if domains == {'simulation'} else 'CONTEXT_NOT_QUALIFIED'
                reason = 'The recorded force-controlled wipes do not qualify this physical building. The form also gives no owner-specified force requirement.'
            else:
                status, reason = 'TASK_NOT_RECORDED', 'No recorded capability represents this complete cleaning task for this robot.'
            robots.append({'platform': platform, 'inTeam': platform in inputs['robots'], 'status': status,
                           'recordedCapabilities': capabilities, 'profileIds': [record['id'] for record in records], 'reason': reason})
        missing = ['Evidence for the complete requested cleaning task in this physical building.']
        if task['type'] in ('wall', 'whiteboard', 'glass', 'desks', 'facade'):
            missing.append('An owner-specified force requirement and applicable settings before a regulated-wipe selector request could be formed.')
        summary = 'The recorded abilities do not qualify a robot for this full cleaning task here.' if inputs['robots'] else 'No robots are on the declared team.'
        parts, calls = _robot_parts(inputs, task)
        coverage[task['id']] = {'status': 'NO_QUALIFIED_BUILDING_ROUTE', 'operation': 'part_by_part_evidence_check',
            'selectorCalls': calls, 'summary': summary, 'profilesInspected': [record['id'] for record in CATALOGUE],
            'wholeJob': 'A robot would need every part below. None is supported in this building, so no robot is assigned.',
            'routeNote': ROUTE_NOTE, 'gapsNote': GAPS_NOTE,
            'parts': parts, 'missingRequirements': missing, 'robots': robots}
    return coverage


def _plan_once(inputs, assessment):
    """Run the guarded planner for one listed order of the same validated jobs."""
    scenario = _scenario(inputs, assessment)
    # An unresolved prerequisite cannot be dropped merely because no route can produce it.
    blocked = {t['id'] for t in inputs['tasks'] if assessment['tasks'][t['id']]['manualPermission'] != 'PASS' or assessment['tasks'][t['id']]['specialAccess']}
    for t in sorted(inputs['tasks'], key=lambda x: x['round']):
        if t['dependsOn'] in blocked:
            blocked.add(t['id'])
            target = next(x for x in scenario['tasks'] if x['id'] == t['id'])
            target.pop('manual_alternative', None)
    initial = plan(scenario, deepcopy(CATALOGUE), human_roles=deepcopy(ROLES))
    scenario, allocation = _maximum_manual_order(scenario, initial)
    result = plan(scenario, deepcopy(CATALOGUE), human_roles=deepcopy(ROLES))
    for slot, expected in allocation['maximumAssignmentsByStage'].items():
        if sum(row['slot'] == slot and row['state'] == 'MANUAL_ASSIGNED' for row in result['tasks']) != expected:
            raise InputError('The guarded planner did not reproduce the proposed staffing arrangement.')
    return scenario, allocation, result, blocked


def _order_check(inputs, assessment, allocation, result):
    """Recompute with the jobs listed in the opposite order and report what stays the same."""
    reversed_inputs = dict(inputs, tasks=list(reversed(inputs['tasks'])))
    unused, other_allocation, other, unused_blocked = _plan_once(reversed_inputs, assessment)
    assigned = {row['id']: row['person'] for row in result['tasks'] if row['state'] == 'MANUAL_ASSIGNED'}
    other_assigned = {row['id']: row['person'] for row in other['tasks'] if row['state'] == 'MANUAL_ASSIGNED'}
    def per_stage(rows):
        return {slot: sum(row['slot'] == slot and row['state'] == 'MANUAL_ASSIGNED' for row in rows) for slot in ROUNDS}
    same_number = per_stage(result['tasks']) == per_stage(other['tasks'])
    if not same_number:
        # A largest matching has one size whatever the order, so this would be a fault in the software, not in the input.
        raise RuntimeError('The number of staffed jobs changed with the listed order.')
    states = {row['id']: row['state'] for row in result['tasks']}
    other_states = {row['id']: row['state'] for row in other['tasks']}
    return {'method': 'The same jobs, checks and team, with the jobs listed in the opposite order.',
            'assignedByStage': per_stage(result['tasks']), 'sameNumberAssigned': same_number,
            'sameJobsAssigned': set(assigned) == set(other_assigned), 'samePeople': assigned == other_assigned,
            'sameStates': states == other_states, 'oppositeOrderAssignments': dict(sorted(other_assigned.items())),
            'scope': 'The number of jobs given a person in each stage does not depend on the listed order. When more ready jobs than people compete in a stage, the earliest listed jobs that can be staffed together are preferred, so which job waits can depend on the order.'}


def _words(key, value):
    return (PERMISSION_WORDS if key == 'permission' else STATE_WORDS)[value]


def _summary_sentence(assigned, total):
    waiting = total - assigned
    first = ('No job is assigned yet' if not assigned else
             '1 job is assigned to a person' if assigned == 1 else str(assigned) + ' jobs are assigned to people')
    second = ('' if not waiting else '; 1 needs attention' if waiting == 1 else '; ' + str(waiting) + ' need attention')
    return first + second + '. No robot is assigned in a new building.'


def plan_customer(payload, *, evaluation=None):
    evaluation = evaluation_context(evaluation)
    inputs = validate_customer(payload, evaluation=evaluation)
    assessment = _assessment(inputs, payload)
    scenario, allocation, result, blocked = _plan_once(inputs, assessment)
    order_check = _order_check(inputs, assessment, allocation, result)
    room_names = {room['id']: room['name'] for room in inputs['rooms']}
    rooms = {room['id']: room for room in inputs['rooms']}
    labels = {p['id']: p.get('label') or base['label'] for p, base in zip(inputs['people'], PEOPLE)}
    task_names = {t['id']: TYPES[t['type']]['label'] + ' at ' + room_names[t['roomId']] + ' / ' + t['place'] for t in inputs['tasks']}
    robot_checks = _robot_coverage(inputs)
    rows = []
    for t in inputs['tasks']:
        row = next(r for r in result['tasks'] if r['id'] == t['id'])
        state = row['state']
        person = row['person']
        guards = assessment['tasks'][t['id']]
        slot = 'round-' + str(t['round'])
        decided, fix_step = [], 3

        def unmet(scope, group, values, where):
            for key, value in values.items():
                if value != 'PASS':
                    decided.append({'scope': scope, 'check': key, 'label': CHECK_LABELS[group][key], 'value': value,
                                    'valueWords': _words(key, value), 'where': where})

        reason, action = 'Someone needs to check whether a person can do this task.', 'Ask the responsible person to check the task and give permission.'
        if state in ('BLOCKED_SHARED', 'WITHHELD_SHARED'):
            reason, action = ('A building check, a room check or the recorded assessment says work must stop.' if state == 'BLOCKED_SHARED' else 'The building checks or the assessment of these exact entries are still missing.'), 'Finish the building and room checks, then record the assessment. Both are in Checks.'
            unmet('building', 'site', inputs['siteChecks'], inputs['context']['buildingName'])
            if assessment['review']['state'] != 'PASS':
                decided.append({'scope': 'assessment', 'check': 'review', 'label': 'Recorded assessment for these exact entries',
                                'value': assessment['review']['state'], 'valueWords': ASSESSMENT_WORDS[assessment['review']['status']], 'where': 'Checks'})
            unmet('room', 'room', rooms[t['roomId']]['checks'], room_names[t['roomId']])
            if state == 'WITHHELD_SHARED' and assessment['review']['status'] == 'stale':
                reason, action = 'The entries changed after the assessment was recorded, so it no longer counts.', 'Ask the responsible person to check the changed entries, then record the assessment again in Checks.'
            elif assessment['siteSafety'] == 'PASS' and assessment['rooms'][t['roomId']] != 'PASS':
                reason, action = ('A shared check for this room needs attention.' if assessment['rooms'][t['roomId']] == 'FAIL' else 'The shared checks for this room are not complete.'), 'Review the room in Checks. Its answers apply to every job in that room.'
        elif state in ('BLOCKED_TASK_CONDITION', 'WITHHELD_TASK_CONDITION'):
            reason, action = ('This place is marked unsafe, or touching it is not allowed.' if state == 'BLOCKED_TASK_CONDITION' else 'Safety or permission to touch this place is still unknown.'), 'Ask the responsible person to check this place, then record their answers in Checks.'
            unmet('place', 'surface', {key: t['checks']['surface'][key] for key in ('permission', 'condition')}, t['place'])
        elif t['dependsOn'] in blocked:
            reason, action = 'The earlier job cannot be planned yet.', 'Look at what is stopping the earlier job first.'
            decided.append({'scope': 'order', 'check': 'dependsOn', 'label': 'Waits for an earlier job', 'value': t['dependsOn'],
                            'valueWords': task_names[t['dependsOn']] + ' cannot be planned yet', 'where': 'Order of work'})
        elif guards['specialAccess']:
            reason, action = ('We do not yet know how this place will be reached.' if t['access'] == 'UNKNOWN' and t['type'] != 'facade' else 'This job needs specialist planning outside this app.'), 'Ask the responsible person to arrange an access assessment. No person is assigned here.'
            decided.append({'scope': 'job', 'check': 'access', 'label': 'How this place is reached', 'value': 'SPECIALIST' if t['type'] == 'facade' else t['access'],
                            'valueWords': 'Outside building surface' if t['type'] == 'facade' else {'UNKNOWN': 'Not checked', 'SPECIALIST': 'Specialist access needed'}.get(t['access'], t['access']), 'where': t['place']})
        elif not t['method'] or t['checks']['surface']['method'] != 'PASS':
            reason, action = ('The cleaning method is missing.' if not t['method'] else 'The cleaning method has not passed its check.'), 'Describe the method in Checks and ask the responsible person to check it.'
            if not t['method']:
                decided.append({'scope': 'job', 'check': 'methodText', 'label': 'How will this be cleaned?', 'value': 'UNKNOWN', 'valueWords': 'Not described', 'where': t['place']})
            unmet('job', 'surface', {'method': t['checks']['surface']['method']}, t['place'])
        elif guards['manualPermission'] != 'PASS':
            reason, action = ('A check says a person must not do this job yet.' if guards['manualPermission'] == 'FAIL' else 'Permission, equipment or training checks for a person are still missing.'), 'Ask the responsible person to check these answers in Checks.'
            unmet('job', 'manual', t['checks']['manual'], t['place'])
        elif state == 'MANUAL_ASSIGNED':
            reason, action = 'A free person is listed as trained for this job.', 'This is only a plan. The app has not checked that the work is done.'
            fix_step = None
        elif state == 'WAITING_FOR_PERSON':
            trained = [p for p in scenario['team']['people'] if TYPES[t['type']]['training'] in p['training']]
            available = [p for p in trained if p['availability'][slot] == 'AVAILABLE']
            fix_step = 2
            if not trained:
                reason, action = 'No one on this team is listed as trained for this job.', 'Check the declared skills in Team. Do not add a skill unless the person has it.'
            elif not available:
                reason, action = 'The trained people are busy, or their availability is still unknown.', 'Check when the trained people are free in Team.'
            else:
                reason, action = 'The free trained people are already needed by other jobs in this stage.', 'Change the team or the stages if these jobs all need to be done.'
        elif state == 'CONDITIONAL_ON_INPUT':
            earlier = next(r['state'] for r in result['tasks'] if r['id'] == t['dependsOn'])
            if earlier == 'MANUAL_ASSIGNED':
                reason, action, words = 'The earlier job is planned, but we do not know if it is finished.', 'Wait until that work is finished. This app cannot check real work.', ' is planned but not recorded as finished'
            elif earlier == 'WAITING_FOR_PERSON':
                reason, action, words, fix_step = 'The earlier job has no person yet, so this job waits for it.', 'Find a free trained person for the earlier job in Team.', ' has no person yet', 2
            else:
                reason, action, words = 'The earlier job is not settled yet, so this job waits for it.', 'Look at what the earlier job needs first.', ' is not settled yet'
            decided.append({'scope': 'order', 'check': 'dependsOn', 'label': 'Waits for an earlier job', 'value': t['dependsOn'],
                            'valueWords': task_names[t['dependsOn']] + words, 'where': 'Order of work'})
        elif state == 'BLOCKED_INPUT':
            reason, action = 'The earlier job cannot be completed under this plan.', 'Look at what is stopping the earlier job first.'
            decided.append({'scope': 'order', 'check': 'dependsOn', 'label': 'Waits for an earlier job', 'value': t['dependsOn'],
                            'valueWords': task_names[t['dependsOn']] + ' cannot be completed under this plan', 'where': 'Order of work'})
        considered = []
        if state in ('MANUAL_ASSIGNED', 'WAITING_FOR_PERSON'):
            skill = TYPES[t['type']]['training']
            for p in scenario['team']['people']:
                reserved = result['reservations']['people'].get(slot + ':' + p['id'])
                has_skill, free = skill in p['training'], p['availability'][slot]
                outcome = ('ASSIGNED_HERE' if reserved == t['id'] else 'NOT_TRAINED' if not has_skill else
                           'BUSY' if free == 'BUSY' else 'AVAILABILITY_NOT_CHECKED' if free != 'AVAILABLE' else
                           'NEEDED_BY_ANOTHER_JOB' if reserved else 'FREE_NOT_NEEDED')
                considered.append({'id': p['id'], 'label': labels[p['id']], 'trained': has_skill, 'availability': free,
                                   'outcome': outcome, 'reservedFor': reserved if reserved and reserved != t['id'] else None,
                                   'reservedForLabel': task_names[reserved] if reserved and reserved != t['id'] else None})
        rows.append({'id': t['id'], 'label': TYPES[t['type']]['label'], 'type': t['type'], 'room': room_names[t['roomId']],
                     'roomId': t['roomId'], 'placeId': t['placeId'],
                     'place': t['place'], 'round': t['round'], 'state': state, 'person': person,
                     'requiredTraining': TYPES[t['type']]['training'], 'dependsOn': t['dependsOn'], 'reason': reason, 'nextAction': action,
                     'decidedBy': decided, 'peopleConsidered': considered, 'fixStep': fix_step,
                     'robotStatus': robot_checks[t['id']]['summary'], 'robot': None})
    assigned = sum(r['state'] == 'MANUAL_ASSIGNED' for r in rows)
    summary = {'total': len(rows), 'manualPlanned': assigned,
               'waitingForPerson': sum(r['state'] == 'WAITING_FOR_PERSON' for r in rows),
               'needsCondition': sum(r['state'] in ('BLOCKED_SHARED', 'WITHHELD_SHARED', 'BLOCKED_TASK_CONDITION', 'WITHHELD_TASK_CONDITION') for r in rows),
               'needsReview': sum(r['state'] in ('BLOCKED_EVIDENCE', 'BLOCKED_INPUT') for r in rows),
               'conditional': sum(r['state'] == 'CONDITIONAL_ON_INPUT' for r in rows), 'robotAssigned': 0,
               'needAttention': len(rows) - assigned, 'sentence': _summary_sentence(assigned, len(rows))}
    return {'schemaVersion': 3, 'release': RELEASE, 'inputs': deepcopy(payload), 'effectiveInputs': inputs, 'assessment': assessment,
            'evaluationContext': evaluation, 'allocationPolicy': allocation, 'orderCheck': order_check,
            'robotChecks': robot_checks, 'catalogueSource': {'path': PROVENANCE['catalogue'], 'sha256': PROVENANCE['catalogueSha256'],
                'note': 'Each part of a job is compared with the unchanged bundled records. The decision rule is called only where a truthful request can be formed. No request is altered to obtain a recommendation.'},
            'reviewStatus': deepcopy(assessment['review']), 'scenario': scenario,
            'plan': result, 'rows': rows, 'summary': summary, 'scope': deepcopy(SCOPE),
            'compilationNotes': {'withheldManualRoutes': sorted(blocked),
                'dependencies': {t['id']: t['dependsOn'] for t in inputs['tasks'] if t['dependsOn'] is not None},
                'note': 'Manual permission and special access are input-admission conditions. A missing permitted upstream route also withholds its dependent route before the unchanged planner runs.'}}


def _example_request(evaluation):
    """Two ordinary jobs in one room with invented, fully declared answers."""
    def job(number, kind, place, method):
        return {'id': 'job-' + str(number), 'type': kind, 'roomId': 'room-1', 'placeId': 'place-' + str(number), 'place': place,
                'round': 1, 'dependsOn': None, 'method': method, 'access': 'ORDINARY',
                'checks': {'surface': {'permission': 'PASS', 'condition': 'PASS', 'method': 'PASS'},
                           'manual': {'permission': 'PASS', 'equipment': 'PASS', 'training': 'PASS'}},
                'specialist': {'accessPlan': '', 'weather': 'UNKNOWN', 'ground': 'UNKNOWN', 'publicProtection': 'UNKNOWN'}}
    return {'schemaVersion': 3,
            'context': {'company': 'Example Cleaning Co', 'customer': 'Example Customer', 'buildingId': 'example-building',
                        'buildingName': 'Example office', 'jobName': 'Example evening clean'},
            'siteChecks': {'accessArranged': 'PASS', 'siteRulesReviewed': 'PASS'},
            'review': {'by': 'Example assessor (invented)', 'date': evaluation['admissionDateUtc'], 'reference': 'EXAMPLE',
                       'decision': 'PASS', 'scope': None},
            'robots': list(ROBOTS),
            'rooms': [{'id': 'room-1', 'name': 'Meeting room 1', 'checks': {'routes': 'PASS', 'people': 'PASS', 'hazards': 'PASS'}}],
            'tasks': [job(1, 'glass', 'Glass panel 1', 'Damp cloth and the agreed glass cleaner'),
                      job(2, 'whiteboard', 'Whiteboard 1', 'Dry whiteboard eraser')],
            'people': [{'id': p['id'], 'availability': {'round-1': 'AVAILABLE', 'round-2': 'UNKNOWN'}, 'additionalTraining': []} for p in PEOPLE]}


def _bind_review(value):
    value['review']['scope'] = deepcopy({key: item for key, item in value.items() if key != 'review'})
    return value


def customer_examples(evaluation=None):
    """One-click situations for the planning flow. Every answer in them is invented for illustration."""
    evaluation = evaluation_context(evaluation)
    base = _bind_review(_example_request(evaluation))
    busy = _example_request(evaluation)
    busy['people'][0]['availability']['round-1'] = 'BUSY'
    _bind_review(busy)
    failed = _example_request(evaluation)
    failed['rooms'][0]['checks']['routes'] = 'FAIL'
    _bind_review(failed)
    changed = _bind_review(_example_request(evaluation))
    changed['tasks'][1]['method'] = 'Wet cloth and a different product'
    return [
        {'id': 'both_free', 'title': 'Two jobs, both people free', 'compareWith': None, 'inputs': base,
         'changed': 'Glass and a whiteboard in one room. Every check is marked as done and both people are free.',
         'lookFor': 'Each job gets a person. The glass was entered first, and the whiteboard still gets the only person trained for it.'},
        {'id': 'helper_busy', 'title': 'A helper is already busy', 'compareWith': 'both_free', 'inputs': busy,
         'changed': 'The Robot helper is busy in stage 1.',
         'lookFor': 'The glass still gets a person. The whiteboard waits, because only the Robot helper is trained for whiteboards.'},
        {'id': 'room_check_failed', 'title': 'A shared room check failed', 'compareWith': 'both_free', 'inputs': failed,
         'changed': '“Paths and exits are clear” is marked Needs attention for the room.',
         'lookFor': 'Every job in that room stops, although the assessment says OK. Set the check to Not checked and save the assessment again: the jobs then wait instead of stopping.'},
        {'id': 'changed_after_assessment', 'title': 'A job changed after its assessment', 'compareWith': 'both_free', 'inputs': changed,
         'changed': 'The whiteboard cleaning method was edited after the assessment was recorded.',
         'lookFor': 'The earlier assessment no longer matches the entries. Nothing is assigned, in either job, until the assessment is recorded again.'},
    ]
