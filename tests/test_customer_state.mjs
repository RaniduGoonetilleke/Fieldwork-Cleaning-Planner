import assert from 'node:assert/strict';
import {requestGate, removeTask, updateTaskRound, updateTaskCheck, freshTaskChecks, clearedDependencies} from '../public/customer-state.mjs';

const gate = requestGate();
const first = gate.next();
assert.equal(gate.accepts(first), true);
gate.invalidate();
assert.equal(gate.accepts(first), false, 'Editing a request must invalidate its pending response.');
const second = gate.next(), third = gate.next();
assert.equal(gate.accepts(second), false, 'An older concurrent response must never replace the current plan.');
assert.equal(gate.accepts(third), true);

const tasks = [
  {id:'a', roomId:'r1', placeId:'p1', place:'Glass 1', round:1, dependsOn:null, checks:freshTaskChecks()},
  {id:'b', roomId:'r1', placeId:'p1', place:'Glass 1', round:2, dependsOn:'a', checks:freshTaskChecks()},
  {id:'c', roomId:'r2', placeId:'p2', place:'Glass 1', round:2, dependsOn:'a', checks:freshTaskChecks()},
];
const snapshot = JSON.stringify(tasks);
let changed = updateTaskCheck(tasks, 'a', 'surface', 'permission', 'PASS');
assert.deepEqual(changed.map(t=>t.checks.surface.permission), ['PASS','PASS','UNKNOWN'], 'Stable place IDs share permission across tasks; another room stays separate.');
changed = updateTaskCheck(changed, 'b', 'manual', 'permission', 'FAIL');
assert.deepEqual(changed.map(t=>t.checks.manual.permission), ['UNKNOWN','FAIL','UNKNOWN'], 'Manual permission remains task-specific.');
assert.throws(()=>updateTaskCheck(tasks, 'a', 'area', 'routes', 'PASS'));
assert.equal(JSON.stringify(tasks), snapshot, 'Updates must not mutate the source snapshot.');

assert.deepEqual(removeTask(tasks,'a').map(t=>t.dependsOn), [null,null], 'Removing a job must remove references to it.');
assert.deepEqual(updateTaskRound(tasks,'a',2).map(t=>t.dependsOn), [null,null,null], 'A prerequisite cannot move into the same stage while retaining dependants.');
assert.equal(updateTaskRound(tasks,'b',1)[1].dependsOn, null);
assert.equal(updateTaskRound(tasks,'c',2)[2].dependsOn, 'a');
console.log('Customer request lifecycle, shared-place checks and dependency checks passed.');

assert.deepEqual(clearedDependencies(tasks, removeTask(tasks, 'a')), ['b','c']);
assert.deepEqual(clearedDependencies(tasks, updateTaskRound(tasks, 'a', 2)), ['b','c']);
assert.deepEqual(clearedDependencies(tasks, updateTaskRound(tasks, 'b', 1)), ['b']);
assert.deepEqual(clearedDependencies(tasks, updateTaskRound(tasks, 'c', 2)), []);
assert.deepEqual(clearedDependencies(tasks, tasks.filter(task => task.id !== 'b')), [], 'Removing a dependant itself does not need acknowledgement.');
console.log('Cleared prerequisites are identified for explicit review before planning.');
