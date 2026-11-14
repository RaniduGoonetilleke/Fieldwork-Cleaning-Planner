import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const source = await readFile(new URL('../public/job-review-store.js', import.meta.url), 'utf8');
const {createJobReviewStore, JobReviewError, STORAGE_KEY, SCHEMA_VERSION, STALE_MESSAGE, summarise, subject, checkState, isExample, HAPPENED, DONE_BY, DIFFICULTIES, JUDGEMENTS} =
  await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

class MemoryStorage {
  map = new Map(); writes = 0;
  getItem(key) { return this.map.get(key) ?? null; }
  setItem(key, value) { this.map.set(key, String(value)); this.writes++; }
}
const fixture = () => { const storage = new MemoryStorage(); return {storage, store: createJobReviewStore(storage)}; };
// Two stores over one storage stand for two tabs of the same browser.
const twoTabs = () => { const storage = new MemoryStorage(); return {storage, tabA: createJobReviewStore(storage), tabB: createJobReviewStore(storage)}; };
const plan = (changes = {}) => ({digest: 'ab'.repeat(32), release: 'test-release', buildingId: 'north-office', buildingName: 'North office', customer: 'Example Customer', company: 'Example Cleaning Co',
  taskId: 'job-1', jobType: 'glass', jobLabel: 'Clean inside glass', roomId: 'room-1', roomName: 'Meeting room 1', placeId: 'place-1', placeName: 'Glass panel 1',
  method: 'Damp cloth and the agreed glass cleaner', stage: 1, plannedState: 'MANUAL_ASSIGNED', plannedText: 'Assigned: Sam', inventedExample: false, ...changes});
const otherPlan = (changes = {}) => plan({digest: 'cd'.repeat(32), buildingId: 'south-office', buildingName: 'South office', taskId: 'job-2', jobType: 'wall', jobLabel: 'Remove wall marks', roomId: 'room-9', roomName: 'Corridor',
  placeId: 'place-4', placeName: 'Wall 4', method: 'Soft sponge', stage: 2, plannedText: 'Needs a person', plannedState: 'WAITING_FOR_PERSON', ...changes});
const outcome = (changes = {}) => ({workDate: '2026-11-10', happened: 'COMPLETED', doneBy: 'PERSON', doneByName: 'Sam', difficulties: [], ...changes});
const typed = (changes = {}) => outcome({job: 'Wipe a whiteboard', place: 'North office / Meeting room 2 / Whiteboard 1', ...changes});
const linked = (changes = {}) => ({...outcome(changes), plan: plan()});
const accept = (changes = {}) => ({acceptance: 'ACCEPTED', checkedBy: 'Building supervisor', checkedOn: '2026-11-11', ...changes});
const throwsCode = (fn, code) => assert.throws(fn, error => error instanceof JobReviewError && error.code === code);
const stored = (store, id) => store.load().reviews.find(row => row.id === id);
// The version a page would be showing after it re-read the saved note.
const shown = (store, id) => stored(store, id).version;
const facts = review => [review.happened, review.doneBy, review.note, review.check?.acceptance ?? null];

test('nothing is saved until an outcome is added, under its own key, and earlier formats are never touched', () => {
  const {store, storage} = fixture(); storage.map.set('fieldwork.job-reviews.v1', 'earlier notes'); storage.map.set('fieldwork.job-reviews.v2', 'notes from the last release');
  assert.deepEqual(store.load(), {schemaVersion: 3, revision: 0, reviews: []}); assert.equal(storage.writes, 0);
  store.add(typed());
  assert.equal(STORAGE_KEY, 'fieldwork.job-reviews.v3'); assert.equal(SCHEMA_VERSION, 3);
  assert.deepEqual([...storage.map.keys()].sort(), ['fieldwork.job-reviews.v1', 'fieldwork.job-reviews.v2', 'fieldwork.job-reviews.v3']);
  assert.equal(storage.map.get('fieldwork.job-reviews.v1'), 'earlier notes'); assert.equal(storage.map.get('fieldwork.job-reviews.v2'), 'notes from the last release');
});

test('the answer lists are the ones the forms offer', () => {
  assert.deepEqual(HAPPENED, ['COMPLETED', 'PARTLY', 'STOPPED', 'NOT_STARTED', 'UNKNOWN']);
  assert.deepEqual(DONE_BY, ['PERSON', 'ROBOT', 'ROBOT_WITH_HELP', 'NOBODY', 'UNKNOWN']);
  assert.deepEqual(DIFFICULTIES, ['INTERVENTION', 'REPEAT', 'EQUIPMENT', 'OTHER']);
  assert.deepEqual(JUDGEMENTS, ['ACCEPTED', 'MORE_WORK']);
});

test('a new note is saved unchecked, and no judgement can be slipped in while saving the outcome', () => {
  const {store, storage} = fixture(); const saved = store.add(typed({difficulties: ['REPEAT', 'INTERVENTION'], note: '  Corner wiped again.  '}));
  assert.match(saved.id, /^jobreview_[0-9a-f-]{36}$/); assert.equal(saved.declaration, 'user-entered'); assert.equal(saved.example, false);
  assert.deepEqual([saved.check, saved.checkClearedAt, saved.contentVersion, saved.version, saved.plan], [null, null, 1, 1, null]);
  assert.deepEqual(saved.difficulties, ['INTERVENTION', 'REPEAT']); assert.equal(saved.note, 'Corner wiped again.'); assert.equal(checkState(saved), 'NOT_CHECKED');
  const writes = storage.writes;
  for (const extra of [{acceptance: 'ACCEPTED'}, {checkedBy: 'A'}, {checkedOn: '2026-11-11'}, {check: accept()}, {contentVersion: 5}, {version: 5}, {checkClearedAt: null}])
    throwsCode(() => store.add(typed(extra)), 'validation');
  assert.equal(storage.writes, writes);
});

test('the check is its own action: a named checker, a date not before the work, and one of two judgements', () => {
  const {store} = fixture(); const saved = store.add(typed());
  throwsCode(() => store.check(saved.id, 1, accept({checkedBy: '  '})), 'validation');
  throwsCode(() => store.check(saved.id, 1, {acceptance: 'ACCEPTED', checkedBy: 'A'}), 'validation');
  throwsCode(() => store.check(saved.id, 1, accept({checkedOn: '2026-11-09'})), 'validation');
  throwsCode(() => store.check(saved.id, 1, accept({acceptance: 'NOT_CHECKED'})), 'validation');
  throwsCode(() => store.check(saved.id, 1, accept({acceptance: 'APPROVED'})), 'validation');
  throwsCode(() => store.check(saved.id, 1, accept({robotApproved: true})), 'validation');
  throwsCode(() => store.check('jobreview_missing', 1, accept()), 'not_found');
  const checked = store.check(saved.id, 1, accept({note: ' Looked clean. '}));
  assert.deepEqual([checked.check.acceptance, checked.check.checkedBy, checked.check.checkedOn, checked.check.note, checked.check.outcomeVersion], ['ACCEPTED', 'Building supervisor', '2026-11-11', 'Looked clean.', 1]);
  assert.equal(checkState(checked), 'ACCEPTED'); assert.deepEqual([checked.contentVersion, checked.version], [1, 2], 'a check is a saved change, but it does not change the facts');
  const removed = store.uncheck(saved.id, 2); assert.deepEqual([removed.check, removed.checkClearedAt, checkState(removed), removed.contentVersion, removed.version], [null, null, 'NOT_CHECKED', 1, 3]);
});

test('R1: every real change to what happened removes the earlier check', () => {
  const changes = {happened: {happened: 'PARTLY'}, performer: {doneBy: 'ROBOT'}, name: {doneByName: 'Alex'}, help: {difficulties: ['EQUIPMENT']}, date: {workDate: '2026-11-09'},
    actualSettings: {differed: 'A different cloth was used.'}, evidence: {evidence: 'photos/after-2.jpg'}, note: {note: 'One corner was missed.'}, job: {job: 'Wipe a wall'}, place: {place: 'South office / Corridor / Wall'}};
  for (const [name, patch] of Object.entries(changes)) {
    const {store} = fixture(); const saved = store.add(typed()); const checked = store.check(saved.id, saved.version, accept());
    const after = store.update(saved.id, checked.version, patch);
    assert.equal(after.check, null, name); assert.ok(after.checkClearedAt, name); assert.equal(after.contentVersion, 2, name); assert.equal(checkState(after), 'CHECK_AGAIN', name);
    assert.ok(!JSON.stringify(after).includes('Building supervisor'), name + ': nothing of the earlier judgement is kept');
  }
});

test('R1, the first reviewed counterexample: an accepted human job edited into a stopped robot job is no longer accepted', () => {
  const {store} = fixture(); const first = store.add(linked()); const checked = store.check(first.id, first.version, accept());
  const changed = store.update(first.id, checked.version, {happened: 'STOPPED', doneBy: 'ROBOT', doneByName: 'Invented robot', difficulties: ['EQUIPMENT']});
  assert.equal(changed.check, null); assert.equal(checkState(changed), 'CHECK_AGAIN'); assert.equal(summarise(store.load().reviews).accepted, 0);
});

test('R1: saving with nothing changed writes nothing and keeps the check', () => {
  const {store, storage} = fixture(); const saved = store.add(typed({note: 'Fine.'})); const checked = store.check(saved.id, saved.version, accept());
  const writes = storage.writes, revision = store.load().revision;
  for (const patch of [{}, typed({note: 'Fine.'}), {note: '  Fine.  '}, {difficulties: []}, {happened: 'COMPLETED', doneBy: 'PERSON'}])
    assert.deepEqual(store.update(saved.id, checked.version, patch), checked);
  throwsCode(() => store.update(saved.id, checked.version, 5), 'validation');
  assert.equal(storage.writes, writes); assert.equal(store.load().revision, revision);
  assert.equal(stored(store, saved.id).check.checkedBy, 'Building supervisor'); assert.equal(stored(store, saved.id).version, checked.version, 'an unchanged save leaves the version alone, so the open forms keep working');
});

test('R1: a changed outcome is checked again by a new action, which belongs to the new version', () => {
  const {store} = fixture(); const saved = store.add(typed()); const checked = store.check(saved.id, saved.version, accept());
  const changed = store.update(saved.id, checked.version, {happened: 'PARTLY'}); assert.equal(changed.check, null);
  const again = store.check(saved.id, changed.version, accept({acceptance: 'MORE_WORK', checkedBy: 'Second supervisor', checkedOn: '2026-11-12'}));
  assert.deepEqual([again.check.acceptance, again.check.checkedBy, again.check.outcomeVersion, again.checkClearedAt, checkState(again)], ['MORE_WORK', 'Second supervisor', 2, null, 'MORE_WORK']);
});

test('R1: an outcome edit cannot set, keep or forge a judgement', () => {
  const {store} = fixture(); const saved = store.add(typed()); const checked = store.check(saved.id, saved.version, accept());
  for (const patch of [{acceptance: 'ACCEPTED'}, {checkedBy: 'A'}, {check: accept()}, {checkClearedAt: null}, {contentVersion: 1}, {version: 1}, {example: true}, {plan: plan()}, {id: 'jobreview_x'}])
    throwsCode(() => store.update(saved.id, checked.version, patch), 'validation');
  assert.equal(stored(store, saved.id).check.acceptance, 'ACCEPTED');
});

test('R2: a note tied to a plan keeps a complete, read-only copy of the planned job', () => {
  const {store} = fixture(); const saved = store.add(linked());
  assert.deepEqual(saved.plan, plan()); assert.deepEqual([saved.job, saved.place], ['', '']);
  assert.deepEqual(subject(saved), {linked: true, job: 'Clean inside glass', place: 'North office · Meeting room 1 / Glass panel 1'});
  assert.equal(saved.plan.method, 'Damp cloth and the agreed glass cleaner'); assert.equal(saved.plan.buildingId, 'north-office');
  const edited = store.update(saved.id, saved.version, {happened: 'PARTLY', differed: 'A dry cloth was used instead.'});
  assert.deepEqual(edited.plan, plan(), 'outcome edits leave the plan copy as it was'); assert.equal(edited.differed, 'A dry cloth was used instead.');
});

test('R2, the second reviewed counterexample: the job and place of a tied note cannot be retyped under the old plan link', () => {
  const {store, storage} = fixture(); const saved = store.add(linked()); const seen = store.check(saved.id, saved.version, accept()).version; const writes = storage.writes;
  throwsCode(() => store.update(saved.id, seen, {job: 'TEST ONLY: different wall task', place: 'TEST ONLY: Building B / Corridor / Wall'}), 'validation');
  throwsCode(() => store.update(saved.id, seen, {place: 'Building B'}), 'validation');
  throwsCode(() => store.update(saved.id, seen, {planned: 'Different claimed plan'}), 'validation');
  throwsCode(() => store.add({...linked(), job: 'Something else'}), 'validation');
  assert.equal(storage.writes, writes); assert.deepEqual(stored(store, saved.id).plan, plan()); assert.equal(stored(store, saved.id).check.acceptance, 'ACCEPTED');
});

test('R2: plan references come as one complete set, so a job reference cannot exist without its plan', () => {
  const {store, storage} = fixture();
  for (const key of Object.keys(plan())) { const partial = plan(); delete partial[key]; throwsCode(() => store.add({...outcome(), plan: partial}), 'validation'); }
  for (const bad of [plan({digest: ''}), plan({digest: 'not-a-fingerprint'}), plan({taskId: ''}), plan({buildingId: ''}), plan({buildingName: ' '}), plan({roomName: ''}), plan({jobLabel: ''}),
    plan({stage: 3}), plan({stage: '1'}), plan({plannedState: 'assigned'}), plan({inventedExample: 'no'}), plan({approved: true}), 'job-1', []])
    throwsCode(() => store.add({...outcome(), plan: bad}), 'validation');
  for (const old of [{planDigest: 'ab'.repeat(32), planTask: 'job-1'}, {planDigest: '', planTask: 'job-999'}, {planTask: 'job-1'}, {planned: 'Assigned: Sam'}])
    throwsCode(() => store.add(typed(old)), 'validation');
  assert.equal(storage.writes, 0);
  assert.equal(store.add({...outcome(), plan: plan({method: '', customer: '', company: ''})}).plan.method, '', 'a plan with no method given is still a complete reference');
});

test('R2: two buildings with the same room and place names stay two different jobs', () => {
  const {store} = fixture();
  const north = store.add(linked()), south = store.add({...outcome(), plan: plan({buildingId: 'south-office', buildingName: 'South office', digest: 'cd'.repeat(32)})});
  assert.equal(subject(north).place, 'North office · Meeting room 1 / Glass panel 1'); assert.equal(subject(south).place, 'South office · Meeting room 1 / Glass panel 1');
  assert.notDeepEqual(north.plan, south.plan); assert.equal(north.plan.roomName, south.plan.roomName);
});

test('R2: linking to another planned job replaces the whole copy and removes the check', () => {
  const {store, storage} = fixture(); const saved = store.add(linked()); const seen = store.check(saved.id, saved.version, accept()).version;
  const writes = storage.writes;
  assert.equal(store.relink(saved.id, seen, plan()).check.acceptance, 'ACCEPTED', 'choosing the same planned job changes nothing'); assert.equal(storage.writes, writes);
  const moved = store.relink(saved.id, seen, otherPlan(), {happened: 'STOPPED'});
  assert.deepEqual(moved.plan, otherPlan()); assert.ok(!JSON.stringify(moved).includes('north-office') && !JSON.stringify(moved).includes('ab'.repeat(32)), 'nothing of the old link remains');
  assert.deepEqual([moved.check, checkState(moved), moved.happened, moved.contentVersion], [null, 'CHECK_AGAIN', 'STOPPED', 2]);
  throwsCode(() => store.relink(saved.id, moved.version, plan({taskId: ''})), 'validation');
  throwsCode(() => store.relink(saved.id, moved.version, plan(), {job: 'Typed job'}), 'validation');
  const wasTyped = store.add(typed()); const tied = store.relink(wasTyped.id, wasTyped.version, plan());
  assert.deepEqual([tied.job, tied.place, tied.plan.taskId], ['', '', 'job-1']);
});

test('R2: a detached note has no plan link, takes a typed job and place, and needs a fresh check', () => {
  const {store} = fixture(); const saved = store.add(linked()); const seen = store.check(saved.id, saved.version, accept()).version;
  throwsCode(() => store.detach(saved.id, seen, {job: '', place: 'Somewhere'}), 'validation');
  throwsCode(() => store.detach(saved.id, seen, {job: 'A job'}), 'validation');
  throwsCode(() => store.detach(saved.id, seen, {job: 'A job', place: 'A place'}, {job: 'Twice'}), 'validation');
  const loose = store.detach(saved.id, seen, {job: 'Wipe a wall', place: 'South office / Corridor / Wall 4'}, {doneBy: 'ROBOT_WITH_HELP'});
  assert.deepEqual([loose.plan, loose.job, loose.place, loose.check, checkState(loose), loose.doneBy], [null, 'Wipe a wall', 'South office / Corridor / Wall 4', null, 'CHECK_AGAIN', 'ROBOT_WITH_HELP']);
  assert.ok(!JSON.stringify(loose).includes('ab'.repeat(32)) && !JSON.stringify(loose).includes('job-1'), 'no old fingerprint or job reference is left');
  assert.deepEqual(subject(loose), {linked: false, job: 'Wipe a wall', place: 'South office / Corridor / Wall 4'});
  throwsCode(() => store.detach(saved.id, loose.version, {job: 'Again', place: 'Again'}), 'validation');
  assert.equal(store.check(saved.id, loose.version, accept()).check.outcomeVersion, 2);
});

test('R3, the third reviewed counterexample: a check form opened on older facts cannot accept the newer facts', () => {
  const {tabA, tabB, storage} = twoTabs();
  const created = tabA.add(typed()); const displayedInA = stored(tabA, created.id);
  const editedInB = tabB.update(created.id, displayedInA.version, {happened: 'STOPPED', doneBy: 'ROBOT', doneByName: 'Robot', note: 'Work stopped before the glass was cleaned.'});
  const writes = storage.writes, before = storage.map.get(STORAGE_KEY);
  assert.throws(() => tabA.check(displayedInA.id, displayedInA.version, accept({checkedBy: 'Supervisor looking at tab A'})),
    error => error instanceof JobReviewError && error.code === 'stale' && error.reviewId === created.id && error.message === STALE_MESSAGE);
  assert.equal(storage.writes, writes); assert.equal(storage.map.get(STORAGE_KEY), before, 'the refused check wrote nothing');
  const saved = stored(tabA, created.id);
  assert.deepEqual(facts(saved), ['STOPPED', 'ROBOT', 'Work stopped before the glass was cleaned.', null]); assert.equal(checkState(saved), 'NOT_CHECKED');
  assert.ok(!storage.map.get(STORAGE_KEY).includes('Supervisor looking at tab A'), 'nothing of the refused acceptance was kept');
  assert.equal(summarise(tabA.load().reviews).accepted, 0);
  // Having read the saved note, the supervisor can check it by a new action that names the version now shown.
  const fresh = tabA.check(created.id, saved.version, accept({acceptance: 'MORE_WORK', checkedBy: 'Supervisor after reading it again'}));
  assert.deepEqual([fresh.check.acceptance, fresh.check.outcomeVersion, fresh.contentVersion, editedInB.contentVersion], ['MORE_WORK', 2, 2, 2]);
});

test('R3: an outcome form opened on older facts cannot overwrite a newer edit, even when it would change nothing', () => {
  const {tabA, tabB, storage} = twoTabs();
  const created = tabA.add(typed()); const old = stored(tabA, created.id);
  tabB.update(created.id, old.version, {happened: 'STOPPED', note: 'Work stopped before finishing.'});
  const before = storage.map.get(STORAGE_KEY);
  const oldForm = Object.fromEntries(['job', 'place', 'workDate', 'happened', 'doneBy', 'doneByName', 'difficulties', 'differed', 'note', 'evidence'].map(key => [key, old[key]]));
  throwsCode(() => tabA.update(created.id, old.version, oldForm), 'stale');
  throwsCode(() => tabA.update(created.id, old.version, {note: 'Typed in tab A.'}), 'stale');
  throwsCode(() => tabA.update(created.id, old.version, {}), 'stale');
  // A form that happens to hold exactly what is now saved is still an old form.
  throwsCode(() => tabA.update(created.id, old.version, {happened: 'STOPPED', note: 'Work stopped before finishing.'}), 'stale');
  assert.equal(storage.map.get(STORAGE_KEY), before);
  assert.deepEqual(facts(stored(tabA, created.id)), ['STOPPED', 'PERSON', 'Work stopped before finishing.', null], 'the newer edit is still there');
});

test('R3: linking and detaching from a form opened on older facts are refused', () => {
  const {tabA, tabB, storage} = twoTabs();
  const created = tabA.add(linked()); const old = stored(tabA, created.id);
  tabB.update(created.id, old.version, {happened: 'PARTLY'});
  const before = storage.map.get(STORAGE_KEY);
  throwsCode(() => tabA.relink(created.id, old.version, otherPlan()), 'stale');
  throwsCode(() => tabA.relink(created.id, old.version, otherPlan(), {happened: 'COMPLETED'}), 'stale');
  throwsCode(() => tabA.relink(created.id, old.version, plan()), 'stale');
  throwsCode(() => tabA.detach(created.id, old.version, {job: 'Wipe a wall', place: 'South office / Corridor / Wall 4'}), 'stale');
  assert.equal(storage.map.get(STORAGE_KEY), before);
  const saved = stored(tabA, created.id); assert.deepEqual(saved.plan, plan()); assert.equal(saved.happened, 'PARTLY');
  // The other tab re-pointed the note: an old outcome form must not save onto the newly chosen job either.
  const moved = tabB.relink(created.id, saved.version, otherPlan());
  throwsCode(() => tabA.update(created.id, saved.version, {note: 'Meant for the glass job.'}), 'stale');
  throwsCode(() => tabA.check(created.id, saved.version, accept()), 'stale');
  assert.deepEqual(stored(tabA, created.id).plan, otherPlan()); assert.equal(stored(tabA, created.id).version, moved.version);
});

test('R3: a check recorded or removed in another tab also makes the open forms and buttons out of date', () => {
  const {tabA, tabB} = twoTabs();
  const created = tabA.add(typed()); const old = stored(tabA, created.id);
  const checkedInB = tabB.check(created.id, old.version, accept({acceptance: 'MORE_WORK', checkedBy: 'Supervisor in tab B'}));
  assert.equal(checkedInB.contentVersion, old.contentVersion, 'the facts did not change');
  throwsCode(() => tabA.check(created.id, old.version, accept({checkedBy: 'Supervisor in tab A'})), 'stale');
  throwsCode(() => tabA.update(created.id, old.version, {note: 'Typed without seeing the check.'}), 'stale');
  assert.deepEqual([stored(tabA, created.id).check.acceptance, stored(tabA, created.id).check.checkedBy], ['MORE_WORK', 'Supervisor in tab B'], 'the other supervisor’s judgement was not replaced unseen');
  // Tab A shows the check by B. Tab B replaces it. Tab A's "Remove check" was for the check it showed, so it is refused.
  const shownInA = stored(tabA, created.id);
  const cleared = tabB.uncheck(created.id, shownInA.version); const replaced = tabB.check(created.id, cleared.version, accept({checkedBy: 'A later supervisor'}));
  throwsCode(() => tabA.uncheck(created.id, shownInA.version), 'stale');
  throwsCode(() => tabA.archive(created.id, shownInA.version), 'stale');
  assert.equal(stored(tabA, created.id).check.checkedBy, 'A later supervisor'); assert.equal(stored(tabA, created.id).archivedAt, null);
  const archived = tabB.archive(created.id, replaced.version);
  throwsCode(() => tabA.restore(created.id, replaced.version), 'stale');
  assert.equal(tabA.restore(created.id, archived.version).archivedAt, null);
});

test('R3: every action on a saved note must say which version it saw, and only a whole number will do', () => {
  const {store, storage} = fixture(); const saved = store.add(linked()); const writes = storage.writes;
  const acts = seen => [() => store.update(saved.id, seen, {note: 'x'}), () => store.check(saved.id, seen, accept()), () => store.uncheck(saved.id, seen),
    () => store.relink(saved.id, seen, otherPlan()), () => store.detach(saved.id, seen, {job: 'a', place: 'b'}), () => store.archive(saved.id, seen), () => store.restore(saved.id, seen)];
  for (const missing of [undefined, null, '1', 1.5, 0, -1, NaN, {}, true]) for (const act of acts(missing)) throwsCode(act, 'version_required');
  // The old call shapes, without a version, are refused rather than guessed at.
  throwsCode(() => store.update(saved.id, {note: 'x'}), 'version_required'); throwsCode(() => store.check(saved.id, accept()), 'version_required');
  throwsCode(() => store.relink(saved.id, otherPlan()), 'version_required'); throwsCode(() => store.detach(saved.id, {job: 'a', place: 'b'}), 'version_required');
  throwsCode(() => store.uncheck(saved.id), 'version_required'); throwsCode(() => store.archive(saved.id), 'version_required');
  for (const wrong of [2, 99]) for (const act of acts(wrong)) throwsCode(act, 'stale');
  assert.equal(storage.writes, writes); assert.deepEqual(stored(store, saved.id), saved);
});

test('R3: every saved change moves the note to a new version, and an unchanged save does not', () => {
  const {store} = fixture(); const a = store.add(linked()); assert.deepEqual([a.version, a.contentVersion], [1, 1]);
  const b = store.update(a.id, 1, {note: 'One corner was missed.'}); assert.deepEqual([b.version, b.contentVersion], [2, 2]);
  const c = store.check(a.id, 2, accept()); assert.deepEqual([c.version, c.contentVersion, c.check.outcomeVersion], [3, 2, 2]);
  const same = store.update(a.id, 3, {note: 'One corner was missed.'}); assert.deepEqual([same.version, same.contentVersion, same.check.acceptance], [3, 2, 'ACCEPTED']);
  const d = store.uncheck(a.id, 3); assert.deepEqual([d.version, d.contentVersion], [4, 2]);
  const e = store.relink(a.id, 4, otherPlan()); assert.deepEqual([e.version, e.contentVersion], [5, 3]);
  const f = store.detach(a.id, 5, {job: 'Wipe a wall', place: 'South office'}); assert.deepEqual([f.version, f.contentVersion], [6, 4]);
  const g = store.archive(a.id, 6); assert.deepEqual([g.version, g.contentVersion], [7, 4]);
  const h = store.restore(a.id, 7); assert.deepEqual([h.version, h.contentVersion], [8, 4]);
  for (const earlier of [1, 2, 3, 4, 5, 6, 7]) throwsCode(() => store.check(a.id, earlier, accept()), 'stale');
  assert.equal(store.check(a.id, 8, accept()).check.outcomeVersion, 4);
});

test('R3: the ordinary one-tab sequence still works: save, check, change, check again, remove the check', () => {
  const {store} = fixture(); const id = store.add(typed()).id;
  store.check(id, shown(store, id), accept());
  assert.equal(checkState(store.update(id, shown(store, id), {happened: 'PARTLY'})), 'CHECK_AGAIN');
  assert.equal(checkState(store.check(id, shown(store, id), accept({acceptance: 'MORE_WORK'}))), 'MORE_WORK');
  assert.equal(checkState(store.uncheck(id, shown(store, id))), 'NOT_CHECKED');
  assert.equal(checkState(store.check(id, shown(store, id), accept())), 'ACCEPTED');
  // A second note is not disturbed by changes to the first.
  const other = store.add(typed({job: 'Wipe a table'})); store.update(id, shown(store, id), {note: 'Later note.'});
  assert.equal(store.check(other.id, other.version, accept()).check.acceptance, 'ACCEPTED');
});

test('a typed note needs its own job and place and has no plan link', () => {
  const {store} = fixture();
  throwsCode(() => store.add(outcome()), 'validation'); throwsCode(() => store.add(typed({job: ' '})), 'validation'); throwsCode(() => store.add(typed({place: ''})), 'validation');
  const saved = store.add(typed()); assert.equal(saved.plan, null); assert.deepEqual(subject(saved), {linked: false, job: 'Wipe a whiteboard', place: 'North office / Meeting room 2 / Whiteboard 1'});
  throwsCode(() => store.update(saved.id, saved.version, {job: ''}), 'validation');
});

test('a job that was not started has nobody who did it, no extra help and nothing to check', () => {
  const {store} = fixture(); const notStarted = {happened: 'NOT_STARTED', doneBy: 'NOBODY', doneByName: ''};
  throwsCode(() => store.add(typed({happened: 'NOT_STARTED'})), 'validation');
  throwsCode(() => store.add(typed({doneBy: 'NOBODY'})), 'validation');
  throwsCode(() => store.add(typed({...notStarted, difficulties: ['EQUIPMENT']})), 'validation');
  throwsCode(() => store.add(typed({...notStarted, doneByName: 'Sam'})), 'validation');
  const saved = store.add(typed(notStarted)); throwsCode(() => store.check(saved.id, saved.version, accept()), 'validation');
  const done = store.add(typed()); const checked = store.check(done.id, done.version, accept());
  assert.equal(store.update(done.id, checked.version, notStarted).check, null, 'an accepted job changed to not started is no longer accepted');
});

test('unknown answers, unknown fields, repeated help items and bad dates are refused', () => {
  const {store, storage} = fixture();
  for (const bad of [{happened: 'DONE'}, {doneBy: 'G1'}, {difficulties: ['REPEAT', 'REPEAT']}, {difficulties: 'REPEAT'}, {confidence: 0.9}, {robotApproved: true}, {successRate: 1},
    {workDate: '2026-02-30'}, {workDate: '2999-01-01'}, {place: 'x'.repeat(241)}, {example: 'yes'}, {note: 5}])
    throwsCode(() => store.add(typed(bad)), 'validation');
  throwsCode(() => store.add(JSON.parse('{"__proto__":{"polluted":true}}')), 'validation'); assert.equal({}.polluted, undefined);
  assert.equal(storage.writes, 0);
});

test('archive hides a note without deleting it, and an archived note cannot be changed or checked', () => {
  const {store} = fixture(); const saved = store.add(linked());
  const archived = store.archive(saved.id, saved.version); assert.ok(archived.archivedAt); const seen = archived.version;
  for (const act of [() => store.update(saved.id, seen, {note: 'x'}), () => store.check(saved.id, seen, accept()), () => store.uncheck(saved.id, seen), () => store.relink(saved.id, seen, plan({taskId: 'job-2'})), () => store.detach(saved.id, seen, {job: 'a', place: 'b'})])
    throwsCode(act, 'validation');
  assert.equal(store.restore(saved.id, seen).archivedAt, null); assert.equal(store.load().reviews.length, 1);
});

test('the summary gives counts only, leaves out invented examples and archived notes, and holds no rate', () => {
  const {store} = fixture();
  const a = store.add(typed()); store.check(a.id, a.version, accept());
  const b = store.add(typed({difficulties: ['REPEAT']})); store.check(b.id, b.version, accept({acceptance: 'MORE_WORK'}));
  store.add(linked({doneBy: 'ROBOT_WITH_HELP', difficulties: ['INTERVENTION']}));
  const changed = store.add(typed()); store.update(changed.id, store.check(changed.id, changed.version, accept()).version, {happened: 'STOPPED'});
  const example = store.add(typed({example: true})); store.check(example.id, example.version, accept());
  const gone = store.add(typed()); store.archive(gone.id, gone.version);
  const counts = summarise(store.load().reviews);
  assert.deepEqual(counts, {total: 4, accepted: 1, moreWork: 1, notChecked: 2, extraHelp: 2, examples: 1});
  assert.ok(Object.values(counts).every(Number.isInteger)); assert.ok(!Object.keys(counts).some(key => /rate|percent|score|confidence/i.test(key)));
});

test('R4, the fourth reviewed finding: a note from a plan made from an invented example is an example and is never in the ordinary counts', () => {
  const {store} = fixture(); const none = {total: 0, accepted: 0, moreWork: 0, notChecked: 0, extraHelp: 0};
  const counts = () => summarise(store.load().reviews), ordinary = () => { const {examples, ...rest} = counts(); return rest; };
  const invented = plan({inventedExample: true});
  let note = store.add({...outcome({difficulties: ['REPEAT']}), plan: invented});
  assert.deepEqual([note.example, note.plan.inventedExample, isExample(note)], [true, true, true]); assert.deepEqual(counts(), {...none, examples: 1}, 'saved');
  note = store.check(note.id, note.version, accept()); assert.deepEqual(counts(), {...none, examples: 1}, 'checked');
  note = store.update(note.id, note.version, {happened: 'PARTLY'}); assert.equal(note.example, true); assert.deepEqual(counts(), {...none, examples: 1}, 'edited');
  note = store.check(note.id, note.version, accept({acceptance: 'MORE_WORK'})); assert.deepEqual(counts(), {...none, examples: 1}, 'checked again');
  // Linking the demonstration to a plan that is not marked as invented does not turn it into an ordinary note.
  note = store.relink(note.id, note.version, otherPlan()); assert.deepEqual([note.example, note.plan.inventedExample, isExample(note)], [true, false, true]); assert.deepEqual(counts(), {...none, examples: 1}, 'linked to another plan');
  note = store.check(note.id, note.version, accept()); assert.deepEqual(counts(), {...none, examples: 1}, 'checked after linking');
  note = store.detach(note.id, note.version, {job: 'Wipe a wall', place: 'South office / Corridor / Wall 4'}); assert.deepEqual([note.example, note.plan, isExample(note)], [true, null, true]); assert.deepEqual(counts(), {...none, examples: 1}, 'detached');
  note = store.check(note.id, note.version, accept()); assert.deepEqual(counts(), {...none, examples: 1}, 'checked after detaching');
  note = store.archive(note.id, note.version); assert.deepEqual(counts(), {...none, examples: 0}, 'archived');
  note = store.restore(note.id, note.version); assert.equal(note.example, true); assert.deepEqual(counts(), {...none, examples: 1}, 'restored');
  // Ordinary notes still count as before, beside the example.
  const own = store.add(linked()); store.check(own.id, own.version, accept()); const typedNote = store.add(typed({difficulties: ['OTHER']}));
  assert.deepEqual(counts(), {total: 2, accepted: 1, moreWork: 0, notChecked: 1, extraHelp: 1, examples: 1});
  assert.equal(typedNote.example, false, 'a typed note is not marked as an example, and nothing marks it as real work either');
  assert.ok(!Object.keys(typedNote).some(key => /real|verified|genuine/i.test(key)));
  assert.deepEqual(ordinary(), {total: 2, accepted: 1, moreWork: 0, notChecked: 1, extraHelp: 1});
});

test('R4: the example mark cannot be avoided or taken off, and an ordinary note linked to an invented plan gains it', () => {
  const {store} = fixture(); const invented = plan({inventedExample: true});
  assert.equal(store.add({...outcome(), plan: invented, example: false}).example, true, 'saying "not an example" does not override an invented plan');
  const marked = store.add({...outcome(), plan: invented});
  throwsCode(() => store.update(marked.id, marked.version, {example: false}), 'validation');
  for (const way of [id => store.relink(id, 1, otherPlan()), id => store.detach(id, 1, {job: 'A job', place: 'A place'}), id => store.update(id, 1, {note: 'Edited.'})])
    assert.equal(way(store.add({...outcome(), plan: invented}).id).example, true);
  const button = store.add(typed({example: true})); assert.equal(store.relink(button.id, button.version, plan()).example, true, 'an example from the example button stays one when linked to a plan');
  // An ordinary note pointed at an invented plan becomes an example, and stays one after it is pointed away again.
  const own = store.add(linked()); assert.equal(own.example, false); assert.equal(summarise(store.load().reviews).total, 1);
  const pointed = store.relink(own.id, own.version, invented); assert.equal(pointed.example, true); assert.equal(summarise(store.load().reviews).total, 0);
  const back = store.relink(own.id, pointed.version, plan()); assert.deepEqual([back.example, back.plan.inventedExample], [true, false]); assert.equal(summarise(store.load().reviews).total, 0);
});

test('damaged, foreign or earlier-format saved data is reported and never overwritten', () => {
  const earlier = '{"schemaVersion":2,"revision":1,"reviews":[]}';
  for (const bad of ['{', '[]', '{"schemaVersion":1,"revision":0,"reviews":[]}', earlier, '{"schemaVersion":4,"revision":0,"reviews":[]}', '{"schemaVersion":3,"revision":0,"reviews":[{"id":"x"}]}', '{"schemaVersion":3,"revision":0,"reviews":[],"robots":[]}']) {
    const storage = new MemoryStorage(); storage.map.set(STORAGE_KEY, bad); const store = createJobReviewStore(storage);
    throwsCode(() => store.load(), 'corrupt'); throwsCode(() => store.add(typed()), 'corrupt');
    assert.equal(storage.map.get(STORAGE_KEY), bad); assert.equal(storage.writes, 0);
  }
});

test('saved notes edited by hand into a dishonest state are refused on load', () => {
  const tamper = (change, first = linked()) => { const {store, storage} = fixture(); const saved = store.add(first); store.check(saved.id, saved.version, accept());
    const data = JSON.parse(storage.map.get(STORAGE_KEY)); change(data.reviews[0]); storage.map.set(STORAGE_KEY, JSON.stringify(data)); return store; };
  const cases = {
    'a check left on a later version of the outcome': review => { review.happened = 'STOPPED'; review.contentVersion = 2; },
    'a check claimed for a version that never existed': review => { review.check.outcomeVersion = 7; },
    'a typed job placed over a plan link': review => { review.job = 'Wall task'; review.place = 'Building B'; },
    'a plan link with its fingerprint removed': review => { review.plan.digest = ''; },
    'a plan link with its job reference removed': review => { delete review.plan.taskId; },
    'a plan link with an approval added': review => { review.plan.approved = true; },
    'a check on a job that was not started': review => { review.happened = 'NOT_STARTED'; review.doneBy = 'NOBODY'; review.doneByName = ''; },
    'a check dated before the work': review => { review.check.checkedOn = '2026-11-01'; },
    'a check and a removed-check marker together': review => { review.checkClearedAt = review.createdAt; },
    'a judgement outside the two allowed': review => { review.check.acceptance = 'APPROVED'; },
    'a score added to the note': review => { review.confidence = 0.9; },
    'a note with its version removed': review => { delete review.version; },
    'a note version that is not a whole number': review => { review.version = '2'; },
    'a note version behind its outcome version': review => { review.contentVersion = 5; review.check.outcomeVersion = 5; },
    'a note from an invented plan with its example mark taken off': review => { review.plan.inventedExample = true; },
  };
  for (const [name, change] of Object.entries(cases)) assert.throws(() => tamper(change).load(), error => error instanceof JobReviewError && error.code === 'corrupt', name);
  assert.throws(() => tamper(review => { review.example = false; }, {...outcome(), plan: plan({inventedExample: true})}).load(), error => error.code === 'corrupt', 'an invented-plan note relabelled as ordinary');
  assert.equal(tamper(() => {}).load().reviews.length, 1, 'the untouched note still loads');
});

test('a change made in another tab while a save is under way is detected instead of being overwritten', () => {
  const storage = new MemoryStorage(); const first = createJobReviewStore(storage); first.add(typed());
  const original = storage.getItem.bind(storage); let reads = 0;
  storage.getItem = key => { reads++; if (reads === 2) storage.map.set(STORAGE_KEY, JSON.stringify({schemaVersion: 3, revision: 9, reviews: []})); return original(key); };
  throwsCode(() => first.add(typed()), 'conflict');
});

test('missing or blocked storage fails with a clear message', () => {
  throwsCode(() => createJobReviewStore(null), 'storage');
  const blocked = {getItem() { throw new Error('blocked'); }, setItem() {}};
  throwsCode(() => createJobReviewStore(blocked).load(), 'storage');
});

test('returned values and the download are copies of the saved notes only', () => {
  const {store} = fixture(); const offered = plan(); const saved = store.add({...outcome({difficulties: ['OTHER']}), plan: offered});
  offered.buildingName = 'Changed afterwards'; saved.plan.buildingName = 'Changed in the returned copy'; saved.difficulties.push('REPEAT'); saved.version = 40;
  const loaded = store.load(); loaded.reviews[0].plan.taskId = 'job-77'; loaded.reviews[0].version = 41;
  assert.deepEqual(store.load().reviews[0].plan, plan()); assert.deepEqual(store.load().reviews[0].difficulties, ['OTHER']); assert.equal(store.load().reviews[0].version, 1);
  const exported = JSON.parse(store.exportJSON()); assert.deepEqual(exported, store.load()); assert.deepEqual(Object.keys(exported), ['schemaVersion', 'revision', 'reviews']);
});
