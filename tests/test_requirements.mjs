import assert from 'node:assert/strict';
import {forceRequirement, forceLabel} from '../public/requirements.mjs';
let checks = 0;
for (const [mode, a, b, expected] of [['exact','7.5','8',{min:7.5,max:7.5}],['range','6','8',{min:6,max:8}],['range','7.5','8',{min:7.5,max:8}],['exact','8','',{min:8,max:8}]]) {
  assert.deepEqual(forceRequirement(mode,a,b), expected); checks++;
}
for (const values of [['exact','','8'],['range','6',''],['range','8','7'],['range','0','8'],['exact','Infinity','8'],['exact','NaN','8'],['range','1','101'],['other','1','2']]) {
  assert.throws(()=>forceRequirement(...values)); checks++;
}
assert.equal(forceLabel({min:7.5,max:7.5}),'Exactly 7.5 N'); checks++;
assert.equal(forceLabel({min:6,max:8}),'6–8 N accepted'); checks++;
console.log(`${checks} force input checks passed`);
