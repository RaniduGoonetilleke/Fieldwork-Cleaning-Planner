import assert from 'node:assert/strict';
import fs from 'node:fs';
import {testedTaskDisplay} from '../public/tested-display.mjs';

const historical = JSON.parse(fs.readFileSync(new URL('../vendor/job_example/scenarios/tested_contexts.json', import.meta.url), 'utf8'));
const effective = structuredClone(historical);
const oldTask = historical.tasks.find(task => task.id === 'T-WS-D');
effective.tasks.find(task => task.id === oldTask.id).request.force = {minimum_n:8, maximum_n:8};
const snapshot = JSON.stringify({historical,effective});
const exact = testedTaskDisplay(oldTask, effective);
assert.equal(exact.title, 'Wipe simulated wall spot D');
assert.equal(exact.requirement, 'Requested force: Exactly 8 N', 'An edited request must override the range embedded in the historical label.');
assert.doesNotMatch(exact.title, /6.?8/);
const other = historical.tasks.find(task => task.id === 'T-WS-AB');
assert.equal(testedTaskDisplay(other,effective).requirement, 'Requested force: 6–8 N accepted', 'A task-specific override must not change the displayed request of another job.');
assert.equal(testedTaskDisplay(oldTask, {}).requirement, '', 'Missing request data must not be inferred from a historical label.');
assert.equal(testedTaskDisplay(historical.tasks.find(task => task.id === 'T-SH'),effective).requirement, '');
assert.equal(JSON.stringify({historical,effective}), snapshot, 'Display formatting must not alter records or requests.');
console.log('Tested-plan headings use the effective per-task request without changing historical records.');
