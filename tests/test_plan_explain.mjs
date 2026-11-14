import assert from 'node:assert/strict';
import {STEPS, stableText, assessmentState, assessmentWords, rowBadge, decidedLines, peopleLines, partView, orderLines, compareRows, nextCounters, roleWords} from '../public/plan-explain.mjs';

assert.deepEqual(STEPS, ['Job', 'Team', 'Checks', 'Plan'], 'The flow is job, team, checks, plan.');
assert.equal(stableText({b: 1, a: [2, {d: 3, c: 4}]}), stableText({a: [2, {c: 4, d: 3}], b: 1}), 'Key order never changes the comparison.');
assert.notEqual(stableText({a: 1}), stableText({a: '1'}));

const input = {schemaVersion: 3, tasks: [{id: 'job-1', method: 'Cloth'}], review: {by: 'A', date: '2026-11-12', decision: 'UNKNOWN', scope: null}};
assert.equal(assessmentState(input), 'none');
const scope = structuredClone(input); delete scope.review;
const recorded = {...input, review: {...input.review, decision: 'PASS', scope}};
assert.equal(assessmentState(recorded), 'current');
assert.equal(assessmentState({...recorded, tasks: [{id: 'job-1', method: 'Other'}]}), 'stale', 'An edit after recording makes the assessment stale.');
assert.equal(assessmentState({...recorded, review: {...recorded.review, by: ' '}}), 'incomplete');
assert.equal(assessmentState({...recorded, review: {...recorded.review, decision: 'FAIL'}}), 'attention');
for (const state of ['none', 'current', 'stale', 'incomplete', 'attention']) assert.ok(assessmentWords[state].length > 10);

const states = ['MANUAL_ASSIGNED', 'WAITING_FOR_PERSON', 'CONDITIONAL_ON_INPUT', 'BLOCKED_SHARED', 'BLOCKED_TASK_CONDITION', 'BLOCKED_INPUT', 'BLOCKED_EVIDENCE', 'WITHHELD_SHARED', 'WITHHELD_TASK_CONDITION'];
for (const state of states) {
  const badge = rowBadge({state, person: 'H1'}, 'Robot helper');
  assert.ok(badge.icon && /[A-Za-z]{4,}/.test(badge.text), 'Each result has a symbol and words, never colour alone: ' + state);
  assert.ok(['good', 'waiting', 'bad'].includes(badge.tone));
}
assert.equal(rowBadge({state: 'MANUAL_ASSIGNED', person: 'H1'}, 'Robot helper').text, 'Assigned: Robot helper');
assert.equal(rowBadge({state: 'BLOCKED_SHARED'}).tone, 'bad');
assert.equal(rowBadge({state: 'WITHHELD_SHARED'}).tone, 'waiting', 'Unknown is shown differently from failed.');
const noRoute = decidedBy => rowBadge({state: 'BLOCKED_EVIDENCE', decidedBy});
assert.equal(noRoute([{check: 'training', value: 'UNKNOWN'}]).text, 'Needs a check', 'A missing answer is not shown as stopped.');
assert.equal(noRoute([{check: 'access', value: 'UNKNOWN'}]).tone, 'waiting');
assert.equal(noRoute([{check: 'equipment', value: 'FAIL'}]).text, 'Stopped by a check');
assert.equal(noRoute([{check: 'access', value: 'SPECIALIST'}]).text, 'Needs a specialist plan');
assert.equal(noRoute([{scope: 'order', check: 'dependsOn', value: 'job-1'}]).text, 'Earlier job is not ready');
assert.match(assessmentWords.stale, /the entries changed/);

assert.deepEqual(decidedLines({decidedBy: [{label: 'Paths and exits are clear', where: 'Meeting room 1', valueWords: 'Needs attention'}]}), ['Paths and exits are clear (Meeting room 1): Needs attention']);
assert.deepEqual(decidedLines({}), []);
const people = peopleLines({peopleConsidered: [
  {label: 'Robot helper', outcome: 'NEEDED_BY_ANOTHER_JOB', reservedForLabel: 'Wipe a whiteboard at Room / Board'},
  {label: 'Glass cleaner', outcome: 'NOT_TRAINED', reservedForLabel: 'Clean inside glass at Room / Glass'},
  {label: 'Third', outcome: 'BUSY'}]});
assert.match(people[0], /another job in this stage: Wipe a whiteboard/);
assert.equal(people[1], 'Glass cleaner: not listed as trained for this job.');
assert.match(people[2], /marked busy/);

const asked = partView({label: 'Find the marked area', summary: 'S', selector: {called: true, decision: 'WITHHOLD', reasons: ['no record']}, evidenceNeeded: ['A test here'],
  records: [{id: 'UR5_whiteboard_detection', platform: 'UR5', onTeam: true, differsWords: ['setting', 'target']}]});
assert.equal(asked.status, 'Not supported here');
assert.match(asked.rule, /^Decision rule asked\. Answer: WITHHOLD \(no record\)/);
assert.equal(asked.records[0], 'UR5_whiteboard_detection (UR5, on your team): differs in setting, target.');
const notAsked = partView({label: 'Wipe', summary: 'S', selector: {called: false, reason: 'Needs a force.'}, records: [{id: 'G1_A_7N', platform: 'G1', onTeam: false, differsWords: ['real or simulated']}]});
assert.match(notAsked.rule, /^Decision rule not asked\. Needs a force\./);
assert.match(notAsked.records[0], /not on your team/);
assert.equal(partView({label: 'Wipe', selector: {called: false, reason: 'x'}, recordsNote: 'Force not compared.'}).recordsNote, 'Force not compared.');
assert.equal(partView({label: 'Find', selector: {called: true, decision: 'WITHHOLD', reasons: [], note: 'Most permissive.'}}).ruleNote, 'Most permissive.');
assert.equal(notAsked.ruleNote, '');
const assumed = partView({label: 'Find', selector: {called: true, decision: 'WITHHOLD', reasons: [], assumption: 'For this evidence check only, all current conditions are assumed to pass.'}});
assert.match(assumed.assumption, /^For this evidence check only/, 'The assumption behind a rule call reaches the visible explanation.');
assert.equal(notAsked.assumption, '', 'A part that was not sent to the rule shows no rule assumption.');
assert.equal(partView({label: 'Wipe', selector: {called: false, reason: 'x', assumption: 'stray'}}).assumption, '');

assert.match(orderLines({sameStates: true, samePeople: true, sameJobsAssigned: true})[1], /same result and the same person/);
assert.match(orderLines({sameStates: false, samePeople: false, sameJobsAssigned: true})[1], /same jobs/);
assert.match(orderLines({sameStates: false, samePeople: false, sameJobsAssigned: false})[1], /Which job waits depends on the order/);
assert.deepEqual(orderLines(null), []);

const diff = compareRows([{id: 'a', state: 'MANUAL_ASSIGNED', personLabel: 'Robot helper'}, {id: 'b', state: 'MANUAL_ASSIGNED', personLabel: 'Glass cleaner'}],
  [{id: 'a', state: 'WAITING_FOR_PERSON'}, {id: 'b', state: 'MANUAL_ASSIGNED', personLabel: 'Glass cleaner'}], row => 'Job ' + row.id);
assert.deepEqual(diff.map(row => [row.job, row.changed]), [['Job a', true], ['Job b', false]]);
assert.equal(diff[0].before, 'Assigned: Robot helper'); assert.equal(diff[0].after, 'Needs a person');

assert.deepEqual(nextCounters({tasks: [{id: 'job-2', placeId: 'place-7'}, {id: 'custom', placeId: 'place-3'}], rooms: [{id: 'room-4'}, {id: 'lobby'}]}), {job: 2, room: 4, place: 7});
assert.deepEqual(nextCounters({tasks: [], rooms: []}), {job: 0, room: 0, place: 0});
assert.match(roleWords(['attendant', 'operator']), /start a robot and watch it, command a robot/);
assert.equal(roleWords([]), 'No robot role in this example.');
console.log('Explanations use words and symbols, stale assessments are detected, and examples continue their numbering.');
