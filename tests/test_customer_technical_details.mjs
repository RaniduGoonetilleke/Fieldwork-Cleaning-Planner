import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {partView, rowBadge, decidedLines, peopleLines, orderLines, STEPS} from '../public/plan-explain.mjs';

const source = fs.readFileSync(new URL('../public/customer.js', import.meta.url), 'utf8');
const extract = name => {
  const start = source.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name + ' exists');
  const rest = source.slice(start), next = /\n(?:async )?function /.exec(rest);
  return rest.slice(0, next ? next.index : undefined);
};
class Node {
  constructor(tag, cls = '', text = '') {this.tag = tag; this.className = cls; this.textContent = text; this.children = []; this.attrs = {}; this.listeners = {}; this.dataset = {}; this.open = false; this.classList = {add: value => {this.className += ' ' + value;}};}
  append(...children) {this.children.push(...children);}
  replaceChildren(...children) {this.children = [...children]; this.textContent = '';}
  setAttribute(name, value) {this.attrs[name] = value;}
  addEventListener(name, fn) {this.listeners[name] = fn;}
  showModal() {this.open = true; this.modalOpens = (this.modalOpens || 0) + 1;}
  close() {this.open = false;}
  get childElementCount() {return this.children.length;}
}
const text = node => typeof node === 'string' ? node : String(node.textContent || '') + node.children.map(text).join('\n');
const all = node => [node, ...node.children.filter(item => typeof item !== 'string').flatMap(all)];
const el = (tag, cls = '', words = '') => new Node(tag, cls, words);
const button = (label, action, cls = '') => {const node = el('button', cls, label); node.listeners.click = action; return node;};
const refs = {}, downloads = []; let checksLoaded = 0, invalidations = 0;
const row = {id:'job-1', type:'wall', room:'Room 1', place:'Wall 1', round:1, state:'MANUAL_ASSIGNED', person:'H1', reason:'The checks passed and Alex is free.', nextAction:'Review this plan before work starts.', requiredTraining:'wall_wiping', decidedBy:[{label:'Touch permission', valueWords:'allowed'}], peopleConsidered:[{label:'Alex',outcome:'ASSIGNED_HERE'}]};
const coverage = {wholeJob:'No tested cleaning record exists for this building.', gapsNote:'Closing these gaps alone would not qualify a robot.', routeNote:'Robot assignment needs a reviewed update to this route.', parts:[{label:'Wiping', summary:'The available wipe was tested in simulation.', records:[{id:'PRIVATE_RECORD_123',platform:'G1',onTeam:true,differsWords:['place']}], evidenceNeeded:['Test this place and cleaning method.'], selector:{called:true,decision:'WITHHOLD',reasons:['CONTEXT_MISMATCH'],assumption:'Other live checks are synthetic assumptions.',note:'This does not support physical cleaning.'}}]};
const state = {input:{robots:['G1'],review:{decision:'PASS'}},catalogue:{release:'test-release'},result:null,gate:{invalidate(){invalidations++;}},controller:null,example:null};
const context = {el,button,refs,state,document:{createTextNode:words=>words},partView,rowBadge,decidedLines,peopleLines,orderLines,STEPS,JSON,
  friendly:{wall:['Wipe a wall']},skillLabels:{wall_wiping:'Walls'},personName:()=> 'Alex',showStep(){},
  planDownload:(value,name)=>downloads.push({value,name}),customerPdfControl:()=>button('Download PDF',()=>{}),
  loadVerification:body=>{checksLoaded++;body.append(el('p','','285 software tests'));},verifyDownload(){},
  invalidateAssessment:input=>({...input,review:{decision:'UNKNOWN'}}),updateReviewStatus(){},renderAssessmentNotice(){},renderNavigation(){}};
vm.createContext(context);
for (const name of ['details','list','buildAbout','openTechnicalDetails','rowLabel','robotSection','resultRow','renderReproduce','invalidate']) vm.runInContext(extract(name), context);

const entry = context.buildAbout();
assert.equal(refs.technicalDialog.open,false);
assert.equal(refs.technicalBody.childElementCount,0,'Technical content is not built into the ordinary view.');
assert.equal(entry.children[0].textContent,'About this plan');
assert.equal(entry.children[0].attrs['aria-haspopup'],'dialog');
assert.equal(entry.children[0].attrs['aria-controls'],refs.technicalDialog.id);
assert.equal(refs.technicalDialog.attrs['aria-labelledby'],'customer-technical-title');
entry.children[0].listeners.click();
assert.equal(refs.technicalDialog.open,true);
assert.match(text(refs.technicalBody),/Build a plan to check its answers/);
assert.equal(checksLoaded,0,'Software checks load only when explicitly expanded.');
all(refs.technicalDialog).find(node=>node.tag==='button'&&node.textContent==='Close').listeners.click();
assert.equal(refs.technicalDialog.open,false);

state.result = {rows:[row],robotChecks:{'job-1':coverage},effectiveInputs:{tasks:[{id:'job-1',type:'wall'}]},plan:{tasks:[{id:'job-1',state:'MANUAL_ASSIGNED'}]},orderCheck:{sameStates:true,samePeople:true},release:'test-release',exportText:'EXACT_EXPORT_BYTES'};
const ordinary = context.resultRow(row,state.result,false), ordinaryWords = text(ordinary);
for (const needed of ['Touch permission: allowed','Alex: assigned to this job','Not supported here','Test this place and cleaning method.','No tested cleaning record exists','Other live checks are synthetic assumptions.','Closing these gaps alone would not qualify a robot.','Robot assignment needs a reviewed update to this route.','Evidence gaps']) assert.ok(ordinaryWords.includes(needed),needed+' remains visible in ordinary explanations.');
const ordinaryPart = all(ordinary).find(node=>node.className==='flow-part');
assert.equal(ordinaryPart.children[1].textContent,coverage.parts[0].summary);
assert.equal(ordinaryPart.children[2].textContent,coverage.parts[0].selector.assumption,'The assumption directly follows the ordinary part summary.');
for (const technical of ['PRIVATE_RECORD_123','CONTEXT_MISMATCH','EXACT_EXPORT_BYTES','python3','Fingerprint']) assert.ok(!ordinaryWords.includes(technical),technical+' stays out of ordinary result cards.');
assert.equal(all(ordinary).filter(node=>node.tag==='pre').length,0,'Ordinary cards have no raw JSON.');

const uncalled = context.robotSection({wholeJob:'No tested cleaning record exists.',parts:[{label:'Wiping',summary:'Simulation only',recordsNote:'Force and settings were not compared.',selector:{called:false,reason:'This form does not ask for a pressing force.'},evidenceNeeded:[]}]});
assert.match(text(uncalled),/Force and settings were not compared/);
assert.match(text(uncalled),/This form does not ask for a pressing force/);
context.openTechnicalDetails();
const technicalWords = text(refs.technicalBody);
for (const needed of ['Other live checks are synthetic assumptions.','Robot assignment needs a reviewed update','does not rerun a robot study']) assert.ok(technicalWords.includes(needed),needed+' remains available in the plain explanation.');
for (const hidden of ['PRIVATE_RECORD_123','CONTEXT_MISMATCH','EXACT_EXPORT_BYTES','python3','Fingerprint']) assert.ok(!technicalWords.includes(hidden),hidden+' is not displayed.');
assert.equal(all(refs.technicalBody).filter(node => ['pre','code','textarea'].includes(node.tag)).length,0,'No code or raw plan viewer appears in the dialog.');
all(refs.technicalBody).find(node=>node.tag==='button'&&node.textContent==='Download research JSON').listeners.click();
assert.deepEqual(downloads,[{value:'EXACT_EXPORT_BYTES',name:'fieldwork-building-plan.json'}]);
const checkDetails = all(refs.technicalBody).find(node=>node.tag==='details'&&node.children[0]?.textContent==='Software checks and test counts');
checkDetails.open=true;checkDetails.listeners.toggle();checkDetails.listeners.toggle();
assert.equal(checksLoaded,1,'Test counts load once per opened dialog.');
context.invalidate();
assert.equal(refs.technicalDialog.open,false,'Editing closes the old plan details.');
assert.equal(refs.technicalBody.childElementCount,0,'Editing clears stale technical records.');
assert.equal(state.result,null);assert.equal(invalidations,1);
context.openTechnicalDetails();
assert.ok(!text(refs.technicalBody).includes('EXACT_EXPORT_BYTES'),'Reopening after an edit cannot show the old export.');
const normalPlan = extract('renderResult');
assert.ok(!/renderReproduce\(|orderLines\(|JSON\.stringify/.test(normalPlan),'The ordinary plan does not render technical blocks.');
assert.match(normalPlan,/customerPdfControl/);
assert.match(normalPlan,/About this plan/);
console.log('PASS: plain plan details, preserved reasons and limits, no raw data or commands, exact downloads, lazy test counts, and stale-record clearing.');
