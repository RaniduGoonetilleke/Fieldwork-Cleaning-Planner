import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';

if(!globalThis.crypto)globalThis.crypto=webcrypto;
const moduleSource=await readFile(new URL('../public/registry-store.js',import.meta.url),'utf8');
const {createStore,RegistryError,STORAGE_KEY,BUILTIN_ROBOTS}=await import('data:text/javascript;base64,'+Buffer.from(moduleSource).toString('base64'));

class MemoryStorage {
  map=new Map();writes=0;
  getItem(key){return this.map.get(key)??null;}
  setItem(key,value){this.map.set(key,String(value));this.writes++;}
}
const robotInput=()=>({name:'Extra arm',type:'Robot arm',domain:'physical',notes:'A user-added example.'});
const resultInput=(robotId='G1')=>({robotId,task:'Wall wipe',context:'Supported original wall',location:'D',date:'2026-11-06',outcome:'PASS',evidence:'Recorded log: run-001.json',notes:'Recorded wipe and hold.',settings:{rightForceN:8,leftForceN:7,description:'Held at the pelvis'}});
const fixture=()=>{const storage=new MemoryStorage();return {storage,store:createStore(storage)};};
function throwsCode(fn,code){assert.throws(fn,error=>error instanceof RegistryError&&error.code===code);}

test('empty register is readable without claiming or writing a save',()=>{
  const {store,storage}=fixture();assert.deepEqual(store.load(),{schemaVersion:1,revision:0,robots:[],results:[]});assert.equal(storage.writes,0);
});
test('built-in robots are recognised, frozen, and cannot be overwritten or archived',()=>{
  const {store}=fixture();assert.equal(BUILTIN_ROBOTS.length,3);assert.ok(Object.isFrozen(BUILTIN_ROBOTS[0]));
  for(const robot of BUILTIN_ROBOTS){
    throwsCode(()=>store.updateRobot(robot.id,{name:'Changed'}),'immutable');
    throwsCode(()=>store.archiveRobot(robot.id),'immutable');
    throwsCode(()=>store.restoreRobot(robot.id),'immutable');
    assert.equal(store.addResult(resultInput(robot.id)).domain,robot.domain);
  }
});
test('custom robot IDs are generated and the saved domain follows that robot',()=>{
  const {store}=fixture();const robot=store.addRobot(robotInput());assert.match(robot.id,/^robot_[0-9a-f-]{36}$/);
  const result=store.addResult(resultInput(robot.id));assert.equal(result.domain,'physical');assert.equal(result.review,null);
  assert.equal(store.load().results[0].id,result.id);
});
test('input, returned values, and load results do not alias the persisted document',()=>{
  const {store}=fixture();const input=resultInput();const added=store.addResult(input);input.settings.rightForceN=900;added.settings.rightForceN=901;
  const loaded=store.load();loaded.results[0].settings.rightForceN=902;assert.equal(store.load().results[0].settings.rightForceN,8);
});
test('results require supporting evidence and an existing robot',()=>{
  const {store,storage}=fixture();
  for(const evidence of ['', '  ',null,undefined])throwsCode(()=>store.addResult({...resultInput(),evidence}),'validation');
  throwsCode(()=>store.addResult(resultInput('unknown')),'not_found');assert.equal(storage.writes,0);
});
test('result inputs cannot forge review, identity, derived domain, or planner eligibility',()=>{
  const {store}=fixture();
  for(const key of ['review','id','domain','usable','qualified','plannerEligible'])throwsCode(()=>store.addResult({...resultInput(),[key]:true}),'validation');
  throwsCode(()=>store.addRobot({...robotInput(),id:'G1'}),'validation');
});
test('force values must be finite positive numbers and not booleans or strings',()=>{
  const {store}=fixture();
  for(const value of [NaN,Infinity,-Infinity,true,false,'8',null,0,-7,1_000_001]){
    for(const key of ['rightForceN','leftForceN'])throwsCode(()=>store.addResult({...resultInput(),settings:{[key]:value}}),'validation');
  }
  assert.equal(store.addResult({...resultInput(),settings:{rightForceN:7.5}}).settings.rightForceN,7.5);
});
test('dates are checked against the calendar, including leap years',()=>{
  const {store}=fixture();
  for(const date of ['2026-02-29','2026-04-31','2026-13-01','06/11/2026','2026-11-06T00:00:00Z','0000-01-01','2026-1-1','9999-01-01'])throwsCode(()=>store.addResult({...resultInput(),date}),'validation');
  assert.equal(store.addResult({...resultInput(),date:'2024-02-29'}).date,'2024-02-29');
});
test('required fields, valid outcomes/domains and length limits are enforced',()=>{
  const {store}=fixture();
  for(const field of ['task','context','location'])throwsCode(()=>store.addResult({...resultInput(),[field]:''}),'validation');
  throwsCode(()=>store.addResult({...resultInput(),outcome:'VERIFIED'}),'validation');
  throwsCode(()=>store.addRobot({...robotInput(),domain:'real'}),'validation');
  throwsCode(()=>store.addRobot({...robotInput(),name:'a'.repeat(121)}),'validation');
  throwsCode(()=>store.addResult({...resultInput(),evidence:'a'.repeat(4001)}),'validation');
  throwsCode(()=>store.addResult({...resultInput(),notes:'bad\u0000text'}),'validation');
});
test('review is a separate named user declaration and is bound to this content version',()=>{
  const {store}=fixture();const result=store.addResult(resultInput());
  throwsCode(()=>store.reviewResult(result.id,{reviewer:' '}),'validation');
  const reviewed=store.reviewResult(result.id,{reviewer:'Reviewer name',note:'I checked the linked log.'});
  assert.deepEqual(Object.keys(reviewed.review).sort(),['declaration','note','reviewedAt','reviewer','resultVersion'].sort());
  assert.equal(reviewed.review.declaration,'user-entered');assert.equal(reviewed.review.resultVersion,reviewed.contentVersion);
  assert.equal(store.load().results[0].review.reviewer,'Reviewer name');
});
test('reviewing a failure or inconclusive record never changes its outcome or enables it',()=>{
  const {store}=fixture();
  for(const outcome of ['FAIL','INCONCLUSIVE']){
    const result=store.addResult({...resultInput(),outcome});const reviewed=store.reviewResult(result.id,{reviewer:'Test reviewer'});
    assert.equal(reviewed.outcome,outcome);assert.ok(reviewed.review);assert.equal('usable'in reviewed,false);assert.equal('qualified'in reviewed,false);assert.equal('plannerEligible'in reviewed,false);
  }
});
test('editing any result content clears its review and advances its version',()=>{
  const {store}=fixture();const result=store.addResult(resultInput());store.reviewResult(result.id,{reviewer:'Test reviewer'});
  const changed=store.updateResult(result.id,{notes:'Corrected the record.'});assert.equal(changed.review,null);assert.equal(changed.contentVersion,2);
  assert.equal(changed.outcome,'PASS');assert.equal(changed.settings.rightForceN,8);
});
test('switching a result to another robot derives its domain and removes prior review',()=>{
  const {store}=fixture();const result=store.addResult(resultInput());store.reviewResult(result.id,{reviewer:'Test reviewer'});
  const changed=store.updateResult(result.id,{robotId:'UR5'});assert.equal(changed.domain,'physical');assert.equal(changed.review,null);
});
test('robot edits clear reviews on active and archived linked results',()=>{
  const {store}=fixture();const robot=store.addRobot(robotInput());const a=store.addResult(resultInput(robot.id));const b=store.addResult(resultInput(robot.id));
  for(const result of [a,b])store.reviewResult(result.id,{reviewer:'Test reviewer'});store.archiveResult(b.id);
  store.updateRobot(robot.id,{name:'Corrected robot name'});const restored=store.restoreResult(b.id);assert.equal(restored.review,null);
  assert.ok(store.load().results.every(result=>result.review===null&&result.contentVersion===2));
});
test('domain cannot silently change once a robot has any evidence records',()=>{
  const {store}=fixture();const robot=store.addRobot(robotInput());const result=store.addResult(resultInput(robot.id));store.archiveResult(result.id);
  throwsCode(()=>store.updateRobot(robot.id,{domain:'simulation'}),'validation');assert.equal(store.load().robots[0].domain,'physical');
});
test('archive/restore is reversible without deleting records or creating new reviews',()=>{
  const {store}=fixture();const robot=store.addRobot(robotInput());const result=store.addResult(resultInput(robot.id));
  assert.ok(store.archiveResult(result.id).archivedAt);throwsCode(()=>store.updateResult(result.id,{notes:'Edit'}),'validation');
  throwsCode(()=>store.reviewResult(result.id,{reviewer:'Test reviewer'}),'validation');
  assert.equal(store.restoreResult(result.id).review,null);assert.equal(store.load().results.length,1);
  store.archiveRobot(robot.id);throwsCode(()=>store.addResult(resultInput(robot.id)),'validation');throwsCode(()=>store.reviewResult(result.id,{reviewer:'Test reviewer'}),'validation');
  assert.equal(store.restoreRobot(robot.id).archivedAt,null);assert.equal(store.load().results[0].review,null);
});
test('an unchanged review survives reversible archival but explicit removal stays removed',()=>{
  const {store}=fixture();const result=store.addResult(resultInput());store.reviewResult(result.id,{reviewer:'Test reviewer'});
  store.archiveResult(result.id);assert.equal(store.restoreResult(result.id).review.reviewer,'Test reviewer');
  store.unreviewResult(result.id);store.archiveResult(result.id);assert.equal(store.restoreResult(result.id).review,null);
});
test('full and blocked storage report failure without claiming saved data',()=>{
  const blocked={getItem(){throw Error('denied');},setItem(){throw Error('denied');}};throwsCode(()=>createStore(blocked).load(),'storage');
  const full=new MemoryStorage();full.setItem=()=>{throw Error('QuotaExceededError');};throwsCode(()=>createStore(full).addRobot(robotInput()),'storage');assert.equal(full.getItem(STORAGE_KEY),null);
  throwsCode(()=>createStore(null),'storage');
});
test('silently dropped writes are detected',()=>{
  const storage=new MemoryStorage();storage.setItem=()=>{};throwsCode(()=>createStore(storage).addRobot(robotInput()),'storage');assert.equal(storage.getItem(STORAGE_KEY),null);
});
test('corrupt saved JSON is never overwritten by a new entry',()=>{
  const {store,storage}=fixture();storage.map.set(STORAGE_KEY,'{broken');throwsCode(()=>store.load(),'corrupt');throwsCode(()=>store.addRobot(robotInput()),'corrupt');assert.equal(storage.getItem(STORAGE_KEY),'{broken');assert.equal(storage.writes,0);
});
test('unsupported schema and forged stale reviews are rejected on load',()=>{
  const {store,storage}=fixture();const result=store.addResult(resultInput());store.reviewResult(result.id,{reviewer:'Test reviewer'});
  const saved=JSON.parse(storage.getItem(STORAGE_KEY));saved.results[0].review.resultVersion=0;storage.map.set(STORAGE_KEY,JSON.stringify(saved));throwsCode(()=>store.load(),'corrupt');
  saved.results[0].review.resultVersion=1;saved.schemaVersion=2;storage.map.set(STORAGE_KEY,JSON.stringify(saved));throwsCode(()=>store.load(),'corrupt');
});
test('missing robots, duplicate IDs and mismatched domains are rejected on load',()=>{
  for(const mutate of [data=>{data.results[0].robotId='missing';},data=>{data.results.push({...data.results[0]});},data=>{data.results[0].domain='physical';}]){
    const {store,storage}=fixture();store.addResult(resultInput());const data=store.load();mutate(data);storage.map.set(STORAGE_KEY,JSON.stringify(data));throwsCode(()=>store.load(),'corrupt');
  }
});
test('an intervening tab update is not overwritten',()=>{
  const storage=new MemoryStorage();let reads=0;const originalGet=storage.getItem.bind(storage);
  storage.getItem=key=>{reads++;if(reads===2)storage.map.set(key,JSON.stringify({schemaVersion:1,revision:1,robots:[],results:[]}));return originalGet(key);};
  throwsCode(()=>createStore(storage).addRobot(robotInput()),'conflict');assert.equal(storage.writes,0);
});
test('HTML-looking text stays inert string data and prototype fields are refused',()=>{
  const {store}=fixture();const note='<img src=x onerror=alert(1)> & </script>';
  const result=store.addResult({...resultInput(),notes:note});assert.equal(store.load().results[0].notes,note);assert.equal(JSON.parse(store.exportJSON()).results[0].notes,note);
  const malicious=JSON.parse('{"__proto__":{"polluted":true}}');throwsCode(()=>store.updateResult(result.id,malicious),'validation');assert.equal({}.polluted,undefined);
});
test('export is a complete portable JSON backup of the local register only',()=>{
  const {store}=fixture();const robot=store.addRobot(robotInput());store.addResult(resultInput(robot.id));const exported=JSON.parse(store.exportJSON());assert.deepEqual(exported,store.load());assert.equal(exported.robots.length,1);assert.equal(exported.results.length,1);assert.equal(exported.results[0].review,null);
});
