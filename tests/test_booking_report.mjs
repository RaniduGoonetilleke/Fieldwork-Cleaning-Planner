import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {webcrypto, createHash} from 'node:crypto';
import {initialState, applyCommand, CHECK_KEYS} from '../public/booking-core.mjs';
import {bookingReport, exactBookingExport, verifyBookingExport, planSnapshots, canonicalBookingJSON, BOOKING_RELEASE, BOOKING_EXPORT_SCHEMA} from '../public/booking-report.mjs';

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const storeSource = await readFile(new URL('../public/job-review-store.js', import.meta.url), 'utf8');
const {createJobReviewStore} = await import('data:text/javascript;base64,' + Buffer.from(storeSource).toString('base64'));
const allChecks = value => Object.fromEntries(CHECK_KEYS.map(key => [key, value]));
const job = (changes = {}) => ({id: 'job-1', name: 'Ground-floor windows', kind: 'windows', place: 'Entrance lobby', stage: 1, mode: 'UR5', workerId: 'H2', groups: [{count: 6, width: 1, height: 1.5, faces: 'inside'}, {count: 2, width: 1.2, height: 0.5, faces: 'both'}], access: 'floor', checks: allChecks('yes'), notes: '', status: 'draft', ...changes});
const command = (state, action) => applyCommand(state, action, state.revision);
function fixture(first = job(), reserve = false) {
  let state = command(initialState(), {type: 'setContext', context: {company: 'Example Cleaning', customer: 'Example Owner', building: 'North office'}});
  return command(state, {type: reserve ? 'reserveJob' : 'saveJob', job: first});
}
const words = report => report.blocks.map(block => block.text).join('\n');
const sign = data => {
  const {digest, ...payload} = data;
  return {...payload, digest: createHash('sha256').update(canonicalBookingJSON(payload)).digest('hex')};
};
const outcome = {workDate: '2026-11-13', happened: 'NOT_STARTED', doneBy: 'NOBODY'};
class MemoryStorage { map = new Map(); getItem(key) {return this.map.get(key) ?? null;} setItem(key, value) {this.map.set(key, value);} }

test('readable report includes mixed sizes, requested faces, resource reservations and unresolved suitability', () => {
  const state = fixture(job(), true), before = structuredClone(state), report = bookingReport(state), text = words(report);
  for (const phrase of ['6 windows, about 1 m wide × 1.5 m high, inside face', '2 windows, about 1.2 m wide × 0.5 m high, both faces', '8 windows; about 11.4 m²', 'Provisional booking saved', 'UR5 + Robot helper', 'Suitability must be confirmed separately', 'not a replay file', 'planning assumption or user declaration, not live status']) assert.ok(text.includes(phrase), phrase);
  assert.match(text, /UR5: Booked for Ground-floor windows/);
  assert.match(text, /Robot helper: Booked for Ground-floor windows/);
  assert.doesNotMatch(text, /99\.5|7 N|taped|whiteboard region|PASS_AT_SETTING/);
  assert.deepEqual(state, before);
});

test('unknown or failed checks remain visible and never become permission in a PDF', () => {
  const state = fixture(job({checks: {...allChecks('unknown'), permission: 'no'}}));
  const text = words(bookingReport(state));
  assert.match(text, /Permission to work: Needs attention/);
  assert.match(text, /Area check: Not checked/);
  assert.match(text, /Permission to work needs attention/);
  assert.match(text, /Draft: no resources reserved/);
  assert.doesNotMatch(text, /The entered checks allow a provisional/);
});

test('manual and specialist jobs retain their entered access and resource limits', () => {
  const manual = fixture(job({kind: 'floors', groups: [], mode: 'manual', workerId: 'H2'}));
  assert.match(words(bookingReport(manual)), /Requested team: Cleaner\. Method: Manual work/);
  const facade = fixture(job({kind: 'facade', access: 'specialist'}));
  assert.match(words(bookingReport(facade)), /needs specialist access planning outside this app/);
  assert.match(words(bookingReport(facade)), /Access: specialist access/);
});

test('every job and stage is exported and recomputed without changing input or browser storage', async () => {
  let state = fixture(job(), true);
  state = command(state, {type: 'saveJob', job: job({id: 'job-2', name: 'Later windows', stage: 2, mode: 'G1', checks: allChecks('unknown')})});
  state = command(state, {type: 'setBusy', id: 'UR3', stage: 2, busy: true});
  const before = structuredClone(state), text = await exactBookingExport(state), file = JSON.parse(text);
  assert.equal(file.schema, BOOKING_EXPORT_SCHEMA); assert.equal(file.release, BOOKING_RELEASE);
  assert.deepEqual(file.state, state); assert.equal(file.assessments.length, 2);
  assert.deepEqual(file.assessments.map(item => item.jobId), ['job-1', 'job-2']);
  assert.equal(file.assessments[0].canReserve, true); assert.equal(file.assessments[1].canReserve, false);
  assert.equal(file.digest, sign(file).digest);
  const existing = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {configurable: true, get() {throw new Error('Replay accessed browser storage.');}});
  try {
    const result = await verifyBookingExport(text);
    assert.equal(result.ok, true); assert.deepEqual(result.state, state); assert.deepEqual(state, before);
  } finally {
    if (existing) Object.defineProperty(globalThis, 'localStorage', existing); else delete globalThis.localStorage;
  }
});

test('replay rejects changed results even with a recomputed fingerprint', async () => {
  const data = JSON.parse(await exactBookingExport(fixture(job({checks: allChecks('unknown')}))));
  for (const alter of [
    value => {value.assessments[0].canReserve = true;},
    value => {value.assessments[0].quantities.area = 0;},
    value => {value.assessments[0].resources = ['UR5'];},
    value => {value.assessments[0].scope = 'Approved';},
    value => {value.assessments = [];},
  ]) {
    const changed = structuredClone(data); alter(changed);
    await assert.rejects(verifyBookingExport(JSON.stringify(sign(changed))), /assessments do not match/);
  }
});

test('replay rejects altered or unsupported release, schema, invalid state and mismatched fingerprint', async () => {
  const data = JSON.parse(await exactBookingExport(fixture()));
  for (const [alter, expected] of [
    [value => {value.release = 'another-release';}, /another app release/],
    [value => {value.schema = 'another-schema';}, /format is not supported/],
    [value => {value.state.jobs[0].groups[0].width = 0;}, /Width/],
    [value => {value.state.jobs[0].groups[0].count = 1.5;}, /Number of windows/],
    [value => {value.digest = '00'.repeat(32);}, /fingerprint does not match/],
    [value => {value.state.context.customer = 'Changed owner';}, /fingerprint does not match/],
    [value => {value.state.context.building = ' North office ';}, /inputs are not in the form/],
    [value => {value.importIntoStore = true;}, /not an exact booking export/],
  ]) {
    const changed = structuredClone(data); alter(changed);
    await assert.rejects(verifyBookingExport(JSON.stringify(changed)), expected);
  }
  await assert.rejects(verifyBookingExport('{oops'), /not valid JSON/);
  await assert.rejects(verifyBookingExport('x'.repeat(2_000_001)), /smaller than 2 MB/);
  await assert.rejects(verifyBookingExport('null'), /not an exact booking export/);
});

test('key order does not affect replay but conflicting reservations cannot be signed into validity', async () => {
  const state = fixture(job(), true), exported = JSON.parse(await exactBookingExport(state));
  const reversed = Object.fromEntries(Object.entries(exported).reverse());
  assert.equal((await verifyBookingExport(JSON.stringify(reversed))).ok, true);
  const invalid = structuredClone(exported);
  invalid.state.jobs.push({...job(), id: 'job-2', status: 'reserved'});
  await assert.rejects(verifyBookingExport(JSON.stringify(sign(invalid))), /contradicts/);
});

test('outcome links carry all window quantities and are accepted by the existing strict note store', async () => {
  const state = fixture(job(), true), exported = JSON.parse(await exactBookingExport(state));
  const [snapshot] = await planSnapshots(state);
  assert.equal(snapshot.digest, exported.digest);
  assert.equal(snapshot.plannedState, 'PROVISIONAL_BOOKING');
  assert.equal(snapshot.inventedExample, false, 'Typed answers are not declared to be a known invented example.');
  assert.match(snapshot.method, /1:6×1×1\.5m\/inside; 2:2×1\.2×0\.5m\/both/);
  assert.match(snapshot.method, /8 windows, approx\. 11\.4 m²/);
  assert.match(snapshot.method, /Requested: UR5 with a robot helper/);
  assert.match(snapshot.method, /Requested team: UR5 \+ Robot helper/);
  assert.match(snapshot.plannedText, /does not approve work or establish new robot capability/);
  const store = createJobReviewStore(new MemoryStorage());
  const saved = store.add({...outcome, plan: snapshot});
  assert.deepEqual(saved.plan, snapshot); assert.equal(saved.check, null); assert.equal(saved.example, false);
});

test('manual snapshots name the selected person in readable text', async () => {
  const [helper] = await planSnapshots(fixture(job({mode: 'manual', workerId: 'H1'})));
  const [cleaner] = await planSnapshots(fixture(job({mode: 'manual', workerId: 'H2'})));
  assert.match(helper.method, /Requested team: Robot helper\./);
  assert.match(cleaner.method, /Requested team: Cleaner\./);
  assert.notEqual(helper.method, cleaner.method);
});

test('ten groups, the longest location and all job notes fit a lossless snapshot', async () => {
  const long = job({name: 'N'.repeat(160), place: 'P'.repeat(160), notes: 'R'.repeat(200), groups: Array.from({length: 10}, (_, i) => ({count: 99999, width: 99.999, height: 0.001, faces: ['inside', 'outside', 'both'][i % 3]}))});
  const [snapshot] = await planSnapshots(fixture(long));
  assert.ok(snapshot.method.length <= 1000); assert.ok(snapshot.placeName.length <= 160);
  assert.equal(snapshot.placeName, long.place);
  assert.ok(snapshot.method.includes('Job notes: ' + long.notes));
  for (let i = 1; i <= 10; i++) assert.ok(snapshot.method.includes(i + ':99999×99.999×0.001m/'));
  const store = createJobReviewStore(new MemoryStorage());
  assert.deepEqual(store.add({...outcome, plan: snapshot}).plan, snapshot);
});

test('the smallest accepted positive area stays visible in report and linked snapshot', async () => {
  const state = fixture(job({groups: [{count: 1, width: 0.001, height: 0.001, faces: 'inside'}]}));
  assert.match(words(bookingReport(state)), /about 0\.000001 m²/);
  const [snapshot] = await planSnapshots(state);
  assert.match(snapshot.method, /approx\. 0\.000001 m²/);
});

test('a changed requirement is preserved in the next snapshot and invalidates an old outcome check on relink', async () => {
  const first = fixture(job({notes: 'Use a dry cloth.'}));
  const [oldPlan] = await planSnapshots(first);
  const next = command(first, {type: 'saveJob', job: {...first.jobs[0], notes: 'Use a damp cloth.'}});
  const [newPlan] = await planSnapshots(next);
  assert.match(oldPlan.method, /Use a dry cloth/); assert.match(newPlan.method, /Use a damp cloth/);
  const store = createJobReviewStore(new MemoryStorage());
  const saved = store.add({plan: oldPlan, workDate: '2026-11-13', happened: 'COMPLETED', doneBy: 'PERSON'});
  const checked = store.check(saved.id, saved.version, {acceptance: 'ACCEPTED', checkedBy: 'Supervisor', checkedOn: '2026-11-13'});
  const changed = store.relink(saved.id, checked.version, newPlan);
  assert.equal(changed.check, null);
  assert.ok(changed.checkClearedAt);
});

test('drafts and explicit releases remain distinct, and quantity edits change the linked fingerprint', async () => {
  const first = fixture(job(), true);
  const reserved = (await planSnapshots(first))[0];
  const changed = command(first, {type: 'saveJob', job: job({groups: [{count: 7, width: 1, height: 1.5, faces: 'inside'}]})});
  const draft = (await planSnapshots(changed))[0];
  assert.equal(draft.plannedState, 'DRAFT'); assert.notEqual(draft.digest, reserved.digest);
  assert.match(draft.method, /7×1×1\.5m\/inside/);
  const released = command(first, {type: 'releaseJob', id: 'job-1'});
  assert.equal((await planSnapshots(released))[0].plannedState, 'RELEASED');
  assert.match(words(bookingReport(released)), /Booking released: no resources held/);
});

test('job notes and Unicode remain literal, without interpreting markup', async () => {
  const state = fixture(job({name: '東京 <script>job</script>', notes: '<img src=x onerror=alert(1)>', place: 'École / Αίθουσα'}));
  const report = words(bookingReport(state));
  assert.ok(report.includes('<script>job</script>')); assert.ok(report.includes('<img src=x onerror=alert(1)>'));
  assert.ok(report.includes('École / Αίθουσα'));
  assert.equal((await verifyBookingExport(await exactBookingExport(state))).state.jobs[0].notes, '<img src=x onerror=alert(1)>');
});

test('the command-line replay passes a valid export and fails one with changed results', async context => {
  const directory = await mkdtemp(join(tmpdir(), 'booking-replay-'));
  try {
    const path = join(directory, 'plan.json'), text = await exactBookingExport(fixture());
    await writeFile(path, text);
    const cli = new URL('../replay_booking.mjs', import.meta.url);
    const env = {...process.env}; delete env.NODE_TEST_CONTEXT;
    const good = spawnSync(process.execPath, [cli.pathname, path], {encoding: 'utf8', env});
    if (good.error?.code === 'EPERM') { context.skip('This runtime blocks subprocesses; run replay_booking.mjs directly for the CLI check.'); return; }
    if (good.error) throw good.error;
    assert.equal(good.status, 0, good.stderr); assert.match(good.stdout, /PASS: 1 job assessment/);
    const altered = JSON.parse(text); altered.assessments[0].quantities.area = 500;
    await writeFile(path, JSON.stringify(sign(altered)));
    const bad = spawnSync(process.execPath, [cli.pathname, path], {encoding: 'utf8', env});
    if (bad.error) throw bad.error;
    assert.equal(bad.status, 1); assert.match(bad.stderr, /FAIL:.*assessments do not match/);
    const usage = spawnSync(process.execPath, [cli.pathname], {encoding: 'utf8', env});
    if (usage.error) throw usage.error;
    assert.equal(usage.status, 2);
  } finally { await rm(directory, {recursive: true, force: true}); }
});
