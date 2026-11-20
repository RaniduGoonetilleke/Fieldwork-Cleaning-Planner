import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState, normalizeJob, validateState, quantities, requiredResources, availability, assessJob, applyCommand, CHECK_KEYS, RESOURCE_IDS, SCOPE} from '../public/booking-core.mjs';

const yes = () => Object.fromEntries(CHECK_KEYS.map(key => [key, 'yes']));
const job = (changes = {}) => ({id: 'job-1', name: 'Lobby windows', kind: 'windows', place: 'Lobby', stage: 1, mode: 'UR5', workerId: 'H2', groups: [{count: 6, width: 1, height: 1.5, faces: 'inside'}], access: 'floor', checks: yes(), notes: '', status: 'draft', ...changes});
const building = () => applyCommand(initialState(), {type: 'setContext', context: {company: 'Cleaning Co', customer: 'Customer', building: 'North building'}}, 0);
const apply = (state, command) => applyCommand(state, command, state.revision);
const code = (fn, expected) => assert.throws(fn, error => error.code === expected);

test('initial resources are unbooked, with empty building and no implicit approval', () => {
  const state = initialState();
  for (const id of RESOURCE_IDS) for (const stage of [1, 2]) assert.equal(availability(state, id, stage).status, 'free');
  assert.deepEqual(state.jobs, []);
  assert.equal(assessJob(state, job()).canReserve, false);
  assert.match(assessJob(state, job()).reasons.join(' '), /building name/);
  assert.match(SCOPE, /does not approve work/);
});

test('window totals distinguish one face, both faces and mixed groups', () => {
  assert.deepEqual(quantities(job()), {windows: 6, area: 9});
  assert.deepEqual(quantities(job({groups: [{count: 6, width: 1, height: 1.5, faces: 'both'}, {count: 2, width: 2, height: 3, faces: 'outside'}]})), {windows: 8, area: 30});
  assert.deepEqual(quantities(job({kind: 'desks', groups: []})), {windows: 0, area: 0});
});

test('dimensions and counts reject coercion, invalid numbers, excess precision and oversized totals', () => {
  for (const value of [0, -1, NaN, Infinity, -Infinity, '1', null, 1001, 1e-300, 0.123456789]) code(() => normalizeJob(job({groups: [{count: 1, width: value, height: 1, faces: 'inside'}]})), 'VALIDATION');
  for (const value of [0, -1, 1.2, '2', null, Infinity, 100001]) code(() => normalizeJob(job({groups: [{count: value, width: 1, height: 1, faces: 'inside'}]})), 'VALIDATION');
  code(() => normalizeJob(job({groups: [{count: 100000, width: 1000, height: 1000, faces: 'both'}]})), 'VALIDATION');
  code(() => normalizeJob(job({groups: Array.from({length: 11}, () => ({count: 1, width: 1, height: 1, faces: 'inside'}))})), 'VALIDATION');
  assert.equal(normalizeJob(job({groups: [{count: 1, width: 0.001, height: 1.234, faces: 'inside'}]})).groups[0].height, 1.234);
  assert.equal(normalizeJob(job({groups: [{count: 1, width: 0.12300000000009, height: 1, faces: 'inside'}]})).groups[0].width, 0.123);
});

test('short single-line job notes stay complete and longer or multiline notes are refused', () => {
  const notes = 'N'.repeat(200);
  assert.equal(normalizeJob(job({notes})).notes, notes);
  code(() => normalizeJob(job({notes: notes + 'N'})), 'VALIDATION');
  code(() => normalizeJob(job({notes: 'First line\nSecond line'})), 'VALIDATION');
  code(() => normalizeJob(job({notes: 'First line\rSecond line'})), 'VALIDATION');
  assert.equal(normalizeJob(job({notes: 'Use the agreed glass product.'})).notes, 'Use the agreed glass product.');
});

test('strict input schema rejects fake resource ids, stages, checks and injected fields', () => {
  for (const value of [{mode: 'Drone'}, {workerId: 'H3'}, {stage: '1'}, {stage: 3}, {checks: {...yes(), area: true}}, {dispatch: true}, {name: ''}, {place: 'x'.repeat(161)}, {notes: 'bad\u202etext'}, {id: '__proto__'}, {kind: 'glass'}, {groups: []}]) code(() => normalizeJob(job(value)), 'VALIDATION');
  code(() => normalizeJob(job({groups: [{count: 1, width: 1, height: 1, faces: 'both', approved: true}]})), 'VALIDATION');
  code(() => normalizeJob(job({kind: 'bins'})), 'VALIDATION');
  code(() => apply(building(), {type: 'approveRobot', job: job()}), 'VALIDATION');
});

test('every robot has its fixed helper, while manual jobs use their chosen worker', () => {
  for (const mode of ['UR3', 'UR5', 'G1']) assert.deepEqual(requiredResources(job({mode, workerId: 'H2'})), [mode, 'H1']);
  assert.deepEqual(requiredResources(job({mode: 'manual', workerId: 'H2'})), ['H2']);
});

test('unchecked or failed checks can be saved but never reserved', () => {
  for (const key of CHECK_KEYS) for (const value of ['unknown', 'no']) {
    const candidate = job({checks: {...yes(), [key]: value}}), state = building();
    const assessment = assessJob(state, candidate);
    assert.equal(assessment.canReserve, false);
    assert.equal(assessment.status, value === 'no' ? 'blocked' : 'incomplete');
    const saved = apply(state, {type: 'saveJob', job: candidate});
    assert.equal(saved.jobs[0].status, 'draft');
    assert.equal(availability(saved, 'UR5', 1).status, 'free');
    code(() => apply(state, {type: 'reserveJob', job: candidate}), 'RESERVATION_BLOCKED');
  }
});

test('specialist and facade tasks never gain a reservation through checked answers', () => {
  for (const candidate of [job({access: 'specialist'}), job({kind: 'facade'})]) {
    assert.equal(assessJob(building(), candidate).status, 'blocked');
    code(() => apply(building(), {type: 'reserveJob', job: candidate}), 'RESERVATION_BLOCKED');
  }
});

test('saving or assessing does not book a resource even if input claims reserved status', () => {
  const state = building(), before = structuredClone(state);
  assert.equal(assessJob(state, job()).canReserve, true);
  assert.deepEqual(state, before);
  const saved = apply(state, {type: 'saveJob', job: job({status: 'reserved'})});
  assert.equal(saved.jobs[0].status, 'draft');
  assert.equal(availability(saved, 'UR5', 1).status, 'free');
  assert.deepEqual(state, before);
});

test('first reservation books robot and helper, leaving other resources free', () => {
  const state = apply(building(), {type: 'reserveJob', job: job()});
  assert.equal(state.jobs[0].status, 'reserved');
  for (const id of ['UR5', 'H1']) assert.deepEqual(availability(state, id, 1), {status: 'booked', jobId: 'job-1', label: 'Booked for Lobby windows'});
  for (const id of ['UR3', 'G1', 'H2']) assert.equal(availability(state, id, 1).status, 'free');
  assert.equal(assessJob(state, job()).canReserve, true);
});

test('second same-stage job conflicts with a robot or its shared helper, while a later stage can reuse them', () => {
  const state = apply(building(), {type: 'reserveJob', job: job()});
  for (const mode of ['UR3', 'UR5', 'G1']) code(() => apply(state, {type: 'reserveJob', job: job({id: 'job-2', mode})}), 'RESERVATION_BLOCKED');
  const manual = apply(state, {type: 'reserveJob', job: job({id: 'manual', mode: 'manual', workerId: 'H2'})});
  assert.equal(manual.jobs.length, 2);
  const later = apply(state, {type: 'reserveJob', job: job({id: 'job-2', stage: 2})});
  assert.equal(later.jobs.filter(value => value.status === 'reserved').length, 2);
});

test('busy elsewhere stays distinct from booked and cannot overwrite a saved booking', () => {
  const state = apply(building(), {type: 'setBusy', id: 'UR5', stage: 1, busy: true});
  assert.deepEqual(availability(state, 'UR5', 1), {status: 'busy', label: 'Busy elsewhere'});
  assert.equal(availability(state, 'UR5', 2).status, 'free');
  code(() => apply(state, {type: 'reserveJob', job: job()}), 'RESERVATION_BLOCKED');
  const free = apply(state, {type: 'setBusy', id: 'UR5', stage: 1, busy: false});
  const reserved = apply(free, {type: 'reserveJob', job: job()});
  code(() => apply(reserved, {type: 'setBusy', id: 'H1', stage: 1, busy: true}), 'RESOURCE_BOOKED');
  code(() => apply(reserved, {type: 'setBusy', id: 'UR5', stage: 1, busy: true}), 'RESOURCE_BOOKED');
});

test('an unchanged save keeps its booking, but a changed scope clears checks and releases it', () => {
  const state = apply(building(), {type: 'reserveJob', job: job()});
  assert.equal(apply(state, {type: 'saveJob', job: job()}).jobs[0].status, 'reserved');
  for (const changes of [{name: 'Changed name'}, {place: 'Upstairs'}, {kind: 'facade'}, {access: 'specialist'}, {stage: 2}, {mode: 'G1'}, {workerId: 'H1'}, {notes: 'A changed requirement'}, {groups: [{count: 7, width: 1, height: 1.5, faces: 'inside'}]}]) {
    const changed = apply(state, {type: 'saveJob', job: job(changes)});
    assert.equal(changed.jobs[0].status, 'draft');
    assert.equal(availability(changed, 'H1', 1).status, 'free');
    assert.deepEqual(changed.jobs[0].checks, Object.fromEntries(CHECK_KEYS.map(key => [key, 'unknown'])));
    code(() => apply(state, {type: 'reserveJob', job: job(changes)}), 'CHANGED_SCOPE');
  }
});

test('changed draft details also clear checks, and only a saved and rechecked scope can be reserved', () => {
  const state = apply(building(), {type: 'saveJob', job: job()});
  const moved = job({place: 'Second floor'});
  code(() => apply(state, {type: 'reserveJob', job: moved}), 'CHANGED_SCOPE');
  const saved = apply(state, {type: 'saveJob', job: moved});
  assert.ok(Object.values(saved.jobs[0].checks).every(value => value === 'unknown'));
  code(() => apply(saved, {type: 'reserveJob', job: saved.jobs[0]}), 'RESERVATION_BLOCKED');
  const rechecked = {...saved.jobs[0], checks: yes()};
  const reserved = apply(saved, {type: 'reserveJob', job: rechecked});
  assert.equal(reserved.jobs[0].status, 'reserved');
  assert.equal(reserved.jobs[0].place, 'Second floor');
});

test('same-scope check edits remain possible, but a changed check does not keep an old reservation', () => {
  const state = apply(building(), {type: 'reserveJob', job: job()});
  const changed = apply(state, {type: 'saveJob', job: job({checks: {...yes(), area: 'no'}})});
  assert.equal(changed.jobs[0].status, 'draft');
  assert.equal(changed.jobs[0].checks.area, 'no');
  assert.equal(changed.jobs[0].checks.surface, 'yes');
  code(() => apply(changed, {type: 'reserveJob', job: changed.jobs[0]}), 'RESERVATION_BLOCKED');
  const rechecked = apply(changed, {type: 'reserveJob', job: {...changed.jobs[0], checks: yes()}});
  assert.equal(rechecked.jobs[0].status, 'reserved');
});

test('cancelling, deleting and changing building release resources; old building checks are cleared', () => {
  const state = apply(building(), {type: 'reserveJob', job: job()});
  assert.equal(availability(apply(state, {type: 'releaseJob', id: 'job-1'}), 'UR5', 1).status, 'free');
  assert.equal(apply(state, {type: 'deleteJob', id: 'job-1'}).jobs.length, 0);
  const changed = apply(state, {type: 'setContext', context: {...state.context, building: 'South building'}});
  assert.equal(changed.jobs[0].status, 'draft');
  assert.deepEqual(Object.values(changed.jobs[0].checks), CHECK_KEYS.map(() => 'unknown'));
  assert.equal(availability(changed, 'H1', 1).status, 'free');
  assert.equal(apply(state, {type: 'setContext', context: state.context}).jobs[0].status, 'reserved');
});

test('every mutation is refused from an old form and does not change its input state', () => {
  const state = apply(building(), {type: 'reserveJob', job: job()}), before = structuredClone(state);
  const commands = [{type: 'saveJob', job: job()}, {type: 'reserveJob', job: job()}, {type: 'releaseJob', id: 'job-1'}, {type: 'deleteJob', id: 'job-1'}, {type: 'setBusy', id: 'H2', stage: 1, busy: true}, {type: 'setContext', context: state.context}];
  for (const command of commands) { code(() => applyCommand(state, command, state.revision - 1), 'STALE_REVISION'); assert.deepEqual(state, before); }
});

test('corrupt saved state fails closed, including collisions and a fabricated reservation over unknown checks', () => {
  const state = apply(building(), {type: 'reserveJob', job: job()});
  const corruptions = [value => {value.schema = 'future';}, value => {value.revision = -1;}, value => {value.jobs.push({...value.jobs[0], id: 'second'});}, value => {value.jobs[0].checks.area = 'unknown';}, value => {value.busy.H1 = [1];}, value => {value.busy.H3 = [];}, value => {value.context.building = '';}];
  for (const corrupt of corruptions) { const copy = structuredClone(state); corrupt(copy); assert.throws(() => validateState(copy)); }
});
