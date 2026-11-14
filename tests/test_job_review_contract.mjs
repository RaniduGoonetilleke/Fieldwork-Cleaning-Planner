// Check that job reviews stay local, explain their limits and cannot change planning.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = name => readFileSync(new URL('../public/' + name, import.meta.url), 'utf8');
const store = read('job-review-store.js'), ui = read('job-review-ui.js'), registry = read('registry-ui.js'), customer = read('customer.js'), html = read('index.html');

// 1. No path into planning or onto the network.
for (const [name, text] of [['job-review-store.js', store], ['job-review-ui.js', ui]]) {
  assert.ok(!/\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket|\/api\//.test(text), name + ' makes no network request.');
  assert.ok(!/\beval\(|new Function\(|document\.write\(|innerHTML|insertAdjacentHTML/.test(text), name + ' never executes or injects supplied text.');
}
assert.ok(!/registry-store|planner|customer\.js|^import /m.test(store), 'The job-review store imports nothing and knows nothing of the planner.');
const post = customer.slice(customer.indexOf('async function post('), customer.indexOf('async function checkPlan('));
assert.ok(post.includes("fetch('/api/customer'") && !/review|localStorage/i.test(post), 'The planning request carries no job review.');
assert.ok(!/job-review|createJobReviewStore|fieldwork\.job-reviews/.test(customer), 'The planning page never reads saved job reviews.');

// 2. The pure helpers behave as the forms promise.
const encode = text => 'data:text/javascript;base64,' + Buffer.from(text).toString('base64');
const {outcomeValues, planLines, planOption, samePlan, countsSentence, examplesSentence, pathwayCounts, changedElsewhere, editMessage, exampleReview, WORDS, PATHWAY, LIMIT_NOTE, LINK_NOTE, HISTORY_NOTE,
  EXAMPLE_NOTE, EXAMPLE_LINK_NOTE, STALE_NOTE, RELOADED_NOTE, OUT_OF_DATE_NOTE, CHANGED_ELSEWHERE_NOTE} =
  await import(new URL('../public/job-review-ui.js', import.meta.url));
const raw = {workDate: '2026-11-10', happened: 'COMPLETED', doneBy: 'PERSON', doneByName: 'Sam', difficulties: ['REPEAT'], note: '', evidence: ''};
assert.deepEqual(Object.keys(outcomeValues(raw)), ['workDate', 'happened', 'doneBy', 'doneByName', 'difficulties', 'differed', 'note', 'evidence'], 'The outcome form produces no judgement, plan link or job text of its own.');
const notStarted = outcomeValues({...raw, happened: 'NOT_STARTED'});
assert.deepEqual([notStarted.doneBy, notStarted.doneByName, notStarted.difficulties.length], ['NOBODY', '', 0]);

const plan = {digest: 'ab'.repeat(32), release: 'r', buildingId: 'north', buildingName: 'North office', customer: 'Customer A', company: '', taskId: 'job-1', jobType: 'glass', jobLabel: 'Clean inside glass',
  roomId: 'room-1', roomName: 'Meeting room 1', placeId: 'place-1', placeName: 'Glass panel 1', method: 'Damp cloth', stage: 1, plannedState: 'MANUAL_ASSIGNED', plannedText: 'Assigned: Sam', inventedExample: false};
const lines = Object.fromEntries(planLines(plan));
assert.equal(lines.Building, 'North office (Customer A)'); assert.equal(lines.Place, 'Meeting room 1 / Glass panel 1'); assert.equal(lines['Method asked for'], 'Damp cloth');
assert.equal(lines['The plan said'], 'Assigned: Sam'); assert.ok(!('Plan fingerprint' in lines), 'Internal identity stays stored without being displayed.'); assert.ok(!('Source' in lines));
assert.equal(Object.fromEntries(planLines({...plan, method: ''}))['Method asked for'], 'No method was given in the plan');
assert.match(Object.fromEntries(planLines({...plan, inventedExample: true})).Source, /invented example.*not a record of real work and is left out of the counts/);
assert.equal(planOption(plan), 'Stage 1 · Clean inside glass · Meeting room 1 / Glass panel 1');
const reordered = Object.fromEntries(Object.entries(plan).reverse());
assert.ok(samePlan(plan, reordered) && JSON.stringify(plan) !== JSON.stringify(reordered), 'The same planned job is recognised whatever order its fields arrive in.');
assert.ok(!samePlan(plan, {...plan, taskId: 'job-2'}) && !samePlan(plan, {...plan, buildingId: 'south'}) && !samePlan(plan, null) && !samePlan(plan, {...plan, extra: 1}));
assert.notEqual(Object.fromEntries(planLines({...plan, buildingName: 'South office'})).Building, lines.Building, 'The building is shown, so equal room names in two buildings can be told apart.');

const note = (changes = {}) => ({...outcomeValues(raw), id: 'n1', job: 'Wipe glass', place: 'North / Lobby', plan: null, check: null, checkClearedAt: null, contentVersion: 1, version: 1, example: false, archivedAt: null, ...changes});
const accepted = {acceptance: 'ACCEPTED', checkedBy: 'S', checkedOn: '2026-11-11', note: '', outcomeVersion: 1, recordedAt: 'x'};
assert.equal(countsSentence([]), 'No job reviews yet.');
assert.equal(countsSentence([note({example: true})]), 'No job reviews of your own yet. 1 invented example is shown below and is not counted.');
assert.equal(countsSentence([note({check: accepted}), note({check: {...accepted, acceptance: 'MORE_WORK'}, difficulties: []}), note(), note({example: true})]),
  '3 job reviews: 1 accepted, 1 needs more work, 1 not checked. Extra help was recorded in 2. 1 invented example is shown below and is not counted.');
assert.equal(examplesSentence(0), ''); assert.equal(examplesSentence(2), '2 invented examples are shown below and are not counted.');

// R4. A note from a plan made from an invented example is an example in every count, checked or not, tied or detached.
const inventedPlan = {...plan, inventedExample: true};
const fromInventedPlan = note({plan: inventedPlan, example: true, job: '', place: '', check: accepted});
assert.equal(countsSentence([fromInventedPlan]), 'No job reviews of your own yet. 1 invented example is shown below and is not counted.');
assert.deepEqual(pathwayCounts([fromInventedPlan]), ['0 recorded', '0 checked', 'Not in this app', '0 of your entries'], 'The pathway leaves a checked example out as well.');
assert.deepEqual(pathwayCounts([note({plan: inventedPlan, job: '', place: '', check: accepted})]).slice(0, 2), ['0 recorded', '0 checked'], 'An invented plan is enough, even if the mark were missing.');
assert.deepEqual(pathwayCounts([note({example: true, check: accepted}), note({example: true, plan, job: '', place: ''})]).slice(0, 2), ['0 recorded', '0 checked'], 'A detached or re-linked example stays out.');
assert.deepEqual(pathwayCounts([fromInventedPlan, note({check: accepted}), note({check: {...accepted, acceptance: 'MORE_WORK'}}), note(), note({archivedAt: 'x', check: accepted})]).slice(0, 2), ['3 recorded', '2 checked'], 'Ordinary notes count as before.');
assert.match(EXAMPLE_NOTE, /left out of the counts/); assert.match(EXAMPLE_NOTE, /The mark stays if the note is later detached or linked to another job\./);
assert.match(EXAMPLE_LINK_NOTE, /Linking marks the note as an invented example/); assert.match(EXAMPLE_LINK_NOTE, /cannot be taken off/);
assert.match(LIMIT_NOTE, /Nothing checks that a note describes real work\./, 'Ordinary notes are not presented as proven real work.');
assert.ok(!/real work was|verified work|genuine/i.test(ui.replace(/not a record of real work/g, '').replace(/describes real work/g, '')), 'Nothing on the tab calls a typed note real work.');
assert.match(ui, /const stepCounts = pathwayCounts\(reviews\);/, 'The pathway uses the same summary as the counts.'); assert.ok(!/own\.length|!review\.example/.test(ui));
assert.equal(editMessage(note(), note({contentVersion: 2, plan: inventedPlan, example: true})), 'Job outcome updated. It has not been checked. It is now marked as an invented example and is left out of the counts.');
assert.ok(!/%|percent|rate\b|score|confidence/i.test(countsSentence([note(), note()])), 'Counts are never turned into a rate.');
assert.match(LIMIT_NOTE, /not a success rate/); assert.match(LIMIT_NOTE, /do not change what a robot may be offered/);

// The message after an edit says whether the earlier check survived.
assert.equal(editMessage(note({check: accepted}), note({check: accepted})), 'Nothing was changed. The recorded check is kept.');
assert.equal(editMessage(note(), note()), 'Nothing was changed.');
assert.equal(editMessage(note({check: accepted}), note({contentVersion: 2, checkClearedAt: 'x'})), 'Saved. The note had been checked, and what you changed removed that check. It needs checking again.');
assert.equal(editMessage(note(), note({contentVersion: 2})), 'Job outcome updated. It has not been checked.');

const example = exampleReview('2026-11-12');
assert.equal(example.outcome.example, true); assert.match(example.outcome.job, /^EXAMPLE \(invented\)/); assert.match(example.outcome.place, /No such job was done/);
assert.match(example.check.checkedBy, /invented/); assert.match(example.outcome.note, /^Invented:/); assert.ok(!('plan' in example.outcome), 'The invented example claims no plan link.');

// 3. The wording keeps the supervisor's check apart from the outcome and from qualifying a robot.
assert.equal(PATHWAY.length, 4);
assert.match(PATHWAY[2][1], /^Not in this app\./); assert.match(PATHWAY[2][1], /A supervisor accepting the result does not do this\./);
assert.match(PATHWAY[3][1], /^Not possible in this app\./); assert.match(PATHWAY[3][1], /does not show that a robot can do the job somewhere else/);
assert.match(LINK_NOTE, /does not show that the work happened/); assert.match(LINK_NOTE, /not a verified approval/); assert.match(LINK_NOTE, /does not check that the plan can still be worked out again/);
assert.match(HISTORY_NOTE, /removes the recorded check/); assert.match(HISTORY_NOTE, /Earlier answers and earlier checks are not kept\./);
assert.match(ui, /'0 of your entries'/, 'No job review is ever counted as a capability record.');
assert.match(ui, /A job review never changes a plan or what a robot may be offered\./);
assert.match(ui, /Neither changes the plan or approves a robot for any job\./);
assert.match(ui, /This does not approve a robot for any job\./);
assert.match(ui, /This works for jobs done by people as well as by robots\./);
assert.match(ui, /typed, not verified/); assert.match(ui, /It does not upload a photo\./);
assert.match(ui, /I have checked the result of this job as it is recorded above\./, 'A check needs its own explicit confirmation.');
assert.match(ui, /From the plan \(cannot be edited\)/); assert.match(ui, /Detach: this note is not about a planned job/);
assert.match(ui, /pill\('Not used in plans'\)/); assert.match(ui, /pill\('Invented example · not counted'\)/); assert.match(ui, /pill\('Plan was an invented example'\)/);
assert.equal(WORDS.check.CHECK_AGAIN, 'Changed after its check: check again');
assert.deepEqual(Object.keys(WORDS.judgement), ['ACCEPTED', 'MORE_WORK']);
assert.ok(!/approved|qualified|certified|verified by/i.test(Object.values(WORDS).flatMap(Object.values).join(' ')), 'No answer reads as an approval.');
const outcomeForm = ui.slice(ui.indexOf('function outcomeForm('), ui.indexOf('function checkForm('));
assert.ok(!/store\.check\(|acceptance|checkedBy|checkedOn/.test(outcomeForm), 'The outcome form cannot record or edit a judgement.');
assert.ok(!/name: 'planned'|'planned', \{/.test(outcomeForm), 'The plan’s wording is not an editable field.');

// R3. Every action on a saved note names the version of the note that the page was showing.
const calls = [...ui.matchAll(/store\.(update|check|uncheck|relink|detach|archive|restore)\(([^,)]+)(?:, ([^,)]+))?/g)];
assert.deepEqual(calls.map(call => call[1]).sort(), ['archive', 'check', 'check', 'detach', 'relink', 'restore', 'uncheck', 'update'], 'These are all the actions the tab can take on a saved note.');
for (const call of calls) assert.ok((call[2] === 'review.id' && call[3] === 'review.version') || (call[2] === 'saved.id' && call[3] === 'saved.version'), 'store.' + call[1] + ' is given the version that was shown.');
assert.equal((ui.match(/dataset\.seenVersion = String\(review\.version\)/g) || []).length, 2, 'The outcome form and the check form are each tied to the version they show.');
assert.match(ui, /node\.dataset\.noteVersion = String\(review\.version\)/);
assert.match(store, /if \(review\.version !== seen\) throw new JobReviewError\('stale', STALE_MESSAGE, id\);/, 'The comparison is made in the store, against the saved note.');
for (const action of ['update', 'check', 'relink', 'detach']) assert.match(store, new RegExp('    ' + action + '\\(id, seen, [^)]*\\) \\{\\n      needVersion\\(seen\\);'), action + ' asks for the version before anything else.');
assert.match(store, /uncheck\(id, seen\) \{ return commit\(data => \{ const review = editable\(data, id, seen\);/); assert.match(store, /function archive\(id, seen, archived\) \{ return commit\(data => \{ const review = seenNote\(data, id, seen\);/);
// A refused action reloads the saved notes and is not tried again.
const refused = registry.slice(registry.indexOf('const mutateReviews ='), registry.indexOf('const showSavedReviews ='));
assert.match(refused, /\['stale', 'not_found'\]\.includes\(error\?\.code\)/); assert.match(refused, /loadReviews\(\); openReviewForm = false; openCheckFor = null; reloadedId = error\.reviewId \|\| null;\n      render\(\);/);
assert.equal((refused.match(/action\(\)/g) || []).length, 1, 'The refused action is never run a second time.');
assert.match(STALE_NOTE, /shows what is saved\. Read it again before you record anything\./); assert.match(registry, /\(shownAgain \|\| !reloadedId \? STALE_NOTE : NOT_LISTED_NOTE\)/, 'A refused note that is no longer listed is not described as shown below.'); assert.match(RELOADED_NOTE, /Nothing you had entered for it was saved\./);
// The notice from another tab is a convenience on top of the store's refusal, and it replaces nothing the user is typing.
assert.match(registry, /window\.addEventListener\('storage', onStorage\)/); assert.match(registry, /window\.removeEventListener\('storage', onStorage\)/);
const marker = ui.slice(ui.indexOf('export function markChangedElsewhere('), ui.indexOf('export function renderJobReviews('));
assert.ok(!/replaceChildren|store\.|mutate\(/.test(marker), 'Marking notes as out of date changes no saved data and replaces no form.');
assert.match(OUT_OF_DATE_NOTE, /no longer what is saved/); assert.match(CHANGED_ELSEWHERE_NOTE, /anything recorded from them will be refused/);
assert.deepEqual(changedElsewhere([{id: 'a', version: 1}, {id: 'b', version: 2}], [{id: 'a', version: 1, archivedAt: null}, {id: 'b', version: 2, archivedAt: null}]), {outOfDate: [], added: 0});
assert.deepEqual(changedElsewhere([{id: 'a', version: 1}, {id: 'b', version: 2}], [{id: 'a', version: 2, archivedAt: null}, {id: 'b', version: 2, archivedAt: null}, {id: 'c', version: 1, archivedAt: null}, {id: 'd', version: 4, archivedAt: 'x'}]), {outOfDate: ['a'], added: 1});
assert.deepEqual(changedElsewhere([{id: 'a', version: 1}], []), {outOfDate: ['a'], added: 0}, 'A note that is no longer saved is out of date too.');

// 4. The notebook, the plan screen and the tour are wired to it honestly.
assert.match(registry, /\['reviews', 'Job reviews'\]/); assert.match(registry, /renderJobReviews\(panels\.reviews/);
assert.match(registry, /if \(!fromPlan\) \{ plannedJobs = null; openReviewForm = false; \}/, 'Jobs offered from one plan are not kept for a later visit.');
assert.match(registry, /\/\^\[0-9a-f\]\{64\}\$\/\.test\(job\.digest\)/, 'Only jobs with a well-formed plan fingerprint are offered.');
assert.match(customer, /After the work: record what happened/);
assert.match(customer, /It does not change this plan or what a robot may be offered\./);
assert.match(customer, /detail: \{tab: 'reviews', jobs: planned\}/);
for (const field of ['buildingId: given.context.buildingId', 'buildingName: given.context.buildingName', "method: given.tasks.find(task => task.id === row.id)?.method || ''", 'roomId: row.roomId', 'placeId: row.placeId', 'inventedExample: Boolean(state.example && !state.exampleEdited)'])
  assert.ok(customer.includes(field), 'The plan screen offers the planned job with ' + field.split(':')[0] + '.');
assert.match(html, /See how to make a plan, download its PDF and record what happened afterwards\. The supervisor’s check is a separate step\./);

console.log('job review contract: ok');
