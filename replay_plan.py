"""Export and recompute offline plans. A matching hash is not an authenticated approval."""
from copy import deepcopy
from hashlib import sha256
import argparse
import json
from pathlib import Path
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent
MAX_EXPORT_BYTES = 1024 * 1024


def _canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False).encode('utf-8')


def _hash(value):
    return sha256(_canonical(value)).hexdigest()


def software_identity():
    from planner_service import verify_sources, PROVENANCE
    manifest = verify_sources()
    files = ['planner_service.py', 'customer_service.py', 'server.py', 'replay_plan.py']
    files += [x['path'] for x in manifest['files']]
    return {'schemaVersion': 1, 'backendFiles': {name: sha256((ROOT / name).read_bytes()).hexdigest() for name in sorted(set(files))},
            'catalogueSha256': PROVENANCE['catalogueSha256'], 'selectorSha256': PROVENANCE['selectorSha256'],
            'plannerSha256': PROVENANCE['plannerSha256']}


def build_export(operation, inputs, result):
    from planner_service import InputError
    if operation not in ('job', 'customer'):
        raise InputError('Unsupported export operation.')
    output = deepcopy(result)
    output.pop('export', None)
    envelope = {'format': 'offline-plan-export', 'schemaVersion': 2, 'operation': operation,
                'evaluationContext': deepcopy(output['evaluationContext']) if operation == 'customer' else None,
                'inputs': deepcopy(inputs), 'effectiveInputs': deepcopy(output['effectiveInputs']) if operation == 'customer' else
                    {'expandedScenario': deepcopy(output['scenario']), 'browserDeclarations': deepcopy(inputs.get('declarations', {})),
                     'usesRecordedDeclarations': inputs.get('useRecordedDeclarations', False)},
                'scenario': deepcopy(output['scenario']), 'software': software_identity(), 'output': output,
                'scope': 'Reproducible hypothetical plan only. No identity authentication, real-world approval or robot dispatch.'}
    envelope['digest'] = _hash(envelope)
    if len(_canonical(envelope)) > MAX_EXPORT_BYTES:
        raise InputError('The complete plan export exceeds the bounded replay size.')
    return envelope


def verify_export(envelope):
    from planner_service import InputError, plan_job
    from customer_service import plan_customer
    keys = {'format', 'schemaVersion', 'operation', 'evaluationContext', 'inputs', 'effectiveInputs', 'scenario', 'software', 'output', 'scope', 'digest'}
    if type(envelope) is not dict or set(envelope) != keys:
        raise InputError('The export must contain the complete supported schema.')
    if envelope['format'] != 'offline-plan-export' or type(envelope['schemaVersion']) is not int or envelope['schemaVersion'] != 2:
        raise InputError('Unsupported export format or schema version.')
    if len(_canonical(envelope)) > MAX_EXPORT_BYTES:
        raise InputError('Export exceeds the replay size limit.')
    value = {k: v for k, v in envelope.items() if k != 'digest'}
    if type(envelope['digest']) is not str or envelope['digest'] != _hash(value):
        raise InputError('Export content does not match its digest.')
    if envelope['software'] != software_identity():
        raise InputError('This export names different software or catalogue files; use its matching release.')
    operation = envelope['operation']
    if type(operation) is not str or operation not in ('job', 'customer'):
        raise InputError('Unsupported export operation.')
    # Recompute from validated inputs; exported statuses and identities are never used as authority.
    if operation == 'job' and envelope['evaluationContext'] is not None:
        raise InputError('The tested-job replay does not use a date evaluation context.')
    if operation == 'customer' and type(envelope['evaluationContext']) is not dict:
        raise InputError('The customer export needs its recorded evaluation context.')
    result = plan_job(envelope['inputs']) if operation == 'job' else plan_customer(envelope['inputs'], evaluation=envelope['evaluationContext'])
    rebuilt = build_export(operation, envelope['inputs'], result)
    if rebuilt != envelope:
        raise InputError('Exported output differs from a fresh computation with these inputs.')
    return {'verified': True, 'sameResult': True, 'operation': operation,
            'resultDigest': _hash(result), 'software': rebuilt['software'],
            'scope': 'The offline computation matches. This is not evidence of real-world safety, approval or task completion.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('export', type=Path, help='JSON plan exported by this exact application release')
    parser.add_argument('--json', action='store_true', help='Print the full machine-readable verification result')
    args = parser.parse_args()
    try:
        if args.export.stat().st_size > MAX_EXPORT_BYTES:
            raise ValueError('Export exceeds the replay size limit.')
        # Use the same duplicate-key, nesting and non-finite-number checks as the HTTP API.
        from server import parse_body
        result = verify_export(parse_body(args.export.read_bytes(), maximum_depth=24))
        if args.json:
            print(json.dumps(result, indent=2))
        else:
            print('PASS: the %s export reproduces the same offline plan.' % result['operation'])
            print('No robot dispatch or real-world approval is established.')
    except (OSError, ValueError, TypeError) as exc:
        parser.exit(1, 'Replay refused: ' + str(exc) + '\n')


if __name__ == '__main__':
    main()
