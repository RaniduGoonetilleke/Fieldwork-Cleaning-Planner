import assert from 'node:assert/strict';
import fs from 'node:fs';
import {customerPlanReport,testedPlanReport,notebookReport,jobReviewsReport,wrapReportText,renderReportPages,configurationWords} from '../public/plan-report.mjs';
import {WORDS,planLines,countsSentence} from '../public/job-review-ui.js';

const text=report=>report.blocks.map(item=>item.text).join('\n');
const person={id:'H1',label:'Zoë 李',availability:{'round-1':'AVAILABLE','round-2':'BUSY'}};
const result={effectiveInputs:{context:{jobName:'École <script>test</script>',buildingName:'東京 / Αθήνα'},people:[person],robots:['G1'],tasks:[{id:'a',method:'Cloth <img onerror=alert(1)>',access:'ORDINARY'}]},scenario:{team:{people:[{id:'H1',training:['glass_wiping']}]}},rows:[{id:'a',label:'Clean glass',room:'Room',place:'Glass',round:1,state:'MANUAL_ASSIGNED',person:'H1',reason:'A free person is listed as trained.',nextAction:'This is only a plan.',decidedBy:[],peopleConsidered:[]}],summary:{sentence:'1 job is assigned to a person.'},reviewStatus:{status:'current'},robotChecks:{a:{wholeJob:'No qualified route.',parts:[{summary:'Simulation only.',recordsNote:'Force and settings were not compared.',selector:{called:false,reason:'No force was entered.'},evidenceNeeded:['Evidence of cleaning effectiveness.']}]}}};
const frozen=structuredClone(result),report=customerPlanReport(result,{exampleTitle:'Two jobs'}),words=text(report);
for(const value of ['École <script>test</script>','東京 / Αθήνα','Zoë 李','Cloth <img onerror=alert(1)>','EXAMPLE - INVENTED CONDITIONS','not an authenticated approval','Force and settings were not compared.','No force was entered.','Evidence of cleaning effectiveness.','Stages show order only'])assert.ok(words.includes(value),value);
assert.deepEqual(result,frozen,'A readable report never changes input or plan data.');
assert.match(text(customerPlanReport(result,{exampleTitle:'Two jobs',exampleEdited:true})),/Example entries may remain/);
assert.throws(()=>customerPlanReport(null),/Build a plan/);

const scenario=JSON.parse(fs.readFileSync(new URL('../vendor/job_example/scenarios/customer_building.json',import.meta.url),'utf8'));
const glass=scenario.tasks.find(task=>task.id==='GP1');
const data={scenario,plan:{tasks:[{...glass,state:'MANUAL_ASSIGNED',person:'H2'}]}};
const tested=text(testedPlanReport(data,{original:true}));
for(const value of ['Original paper building plan','EXAMPLE - INVENTED CONDITIONS','Requested force: 6–8 N','permitted manual alternative','does not fulfil the original request','separately','not dirt removal or physical G1 performance'])assert.ok(tested.includes(value),value);
const configured=testedPlanReport({scenario,plan:{tasks:[{...glass,state:'WAITING_FOR_PERSON',robot:null,person:null,selector:{decision:'CONFIRM',configuration:'G1_D_8N'}}]}});
assert.match(text(configured),/Configured option: G1 \/ simulated wall spot D \/ 8 N/);assert.match(text(configured),/not a robot assignment/);assert.match(text(configured),/separate example confirmation is still required/);
const catalogue=JSON.parse(fs.readFileSync(new URL('../vendor/catalogue_r4/CANDIDATE_MAPPING_R4.json',import.meta.url),'utf8'));
const records=catalogue.records||catalogue.profiles||catalogue.candidates;assert.ok(Array.isArray(records));
for(const [id,label]of Object.entries(configurationWords)){const record=records.find(row=>row.id===id);assert.ok(record);if(record.force_setpoint_n!==null)assert.ok(label.endsWith(record.force_setpoint_n+' N'));}
const checkedInputs=structuredClone(result);checkedInputs.effectiveInputs.siteChecks={accessArranged:'PASS',siteRulesReviewed:'FAIL'};checkedInputs.effectiveInputs.rooms=[{name:'Lobby',checks:{routes:'PASS',people:'UNKNOWN',hazards:'PASS'}}];checkedInputs.effectiveInputs.tasks[0].checks={surface:{permission:'PASS',condition:'PASS',method:'PASS'},manual:{permission:'PASS',equipment:'PASS',training:'PASS'}};
const checks=text(customerPlanReport(checkedInputs));for(const value of ['Access has been arranged: checked','Site rules have been reviewed: needs attention','People nearby are protected: not checked','Cleaning method suits this surface: checked','Manual work is allowed: checked'])assert.ok(checks.includes(value),value);
const modified=structuredClone(data);modified.scenario.tasks.find(task=>task.id==='GP1').request.force={minimum_n:8,maximum_n:8};
assert.match(text(testedPlanReport(modified)),/Requested force: Exactly 8 N/,'The report uses the effective request, not an old task label.');

const review={job:'Glass',place:'Office',workDate:'2026-11-13',happened:'COMPLETED',doneBy:'PERSON',doneByName:'Zoë',difficulties:['REPEAT'],note:'Corner repeated',evidence:'Photo note',differed:'Different cloth',plan:null,check:null,contentVersion:1,version:1,example:true,archivedAt:null};
const reviews=[review],options={words:WORDS,planLines,summary:countsSentence(reviews)};
const unchecked=text(jobReviewsReport(reviews,options));
for(const value of ['INVENTED EXAMPLE - NOT COUNTED','No supervisor check is recorded','Different cloth','Photo note','Part was cleaned again'])assert.ok(unchecked.includes(value),value);
review.check={acceptance:'MORE_WORK',checkedBy:'Supervisor',checkedOn:'2026-11-13',note:'Do the corner again',outcomeVersion:1};
const checked=text(jobReviewsReport(reviews,options));
assert.match(checked,/Separate supervisor check: Result: Needs more work/);assert.match(checked,/Do the corner again/);assert.match(checked,/not a technical review/);
const notebook=text(notebookReport({robots:[],results:[{robotId:'G1',task:'Wipe',domain:'simulation',date:'2026-11-13',context:'Test wall',location:'D',outcome:'FAIL',evidence:'A saved log',settings:{rightForceN:7,leftForceN:7},review:{reviewer:'A name',reviewedAt:'2026-11-13',note:'A failure was recorded.'}}]},[{id:'G1',name:'G1',type:'Humanoid',domain:'simulation'}]));
assert.match(notebook,/Recorded outcome: Failed/);assert.match(notebook,/Review recorded - not used in plans/);assert.match(notebook,/Right: 7 N/);

const wrapped=wrapReportText('e\u0301'.repeat(20)+' 👩‍🔬 東京 <script>',value=>Array.from(value).length,8);
assert.equal(wrapped.join('').replaceAll(' ',''),('e\u0301'.repeat(20)+'👩‍🔬東京<script>'));
assert.ok(wrapped.every(line=>!line.startsWith('\u0301')),'Combining accents stay with their letters.');
// Layout uses literal drawText and wraps very long names/notes instead of truncating or overflowing.
const drawn=[],canvases=[];const previous=globalThis.document;
globalThis.document={createElement:()=>{const canvas={getContext:()=>({scale(){},fillRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},measureText(value){return{width:[...value].length*6};},fillText(value,x,y){drawn.push({value,x,y});}})};canvases.push(canvas);return canvas;}};
try {
  const pages=[...renderReportPages({blocks:[{kind:'title',text:'名'.repeat(200)},{kind:'body',text:('Long literal <script> note. ').repeat(1500)}]})];
  assert.ok(pages.length>2);assert.ok(pages.every(page=>page.width>1700),'Three-times A4 canvas resolution is retained.');
  assert.ok(drawn.every(line=>line.y>=0&&line.y<=809),'Text stays inside the page and footer bounds.');
  assert.ok(drawn.some(line=>line.value.includes('<script>')),'Markup is literal text, not DOM.');
}finally{globalThis.document=previous;}
const source=fs.readFileSync(new URL('../public/plan-report.mjs',import.meta.url),'utf8');
assert.doesNotMatch(source,/innerHTML|document\.write|new Function|\beval\(/);
assert.match(source,/import\('\.\/vendor\/pdf-lib\/pdf-lib\.esm\.min\.js'\)/,'PDF generation uses a local, lazy dependency.');
console.log('Readable plan/notebook reports preserve requests, example and evidence limits, separate checks, Unicode and literal user text; long text paginates.');
