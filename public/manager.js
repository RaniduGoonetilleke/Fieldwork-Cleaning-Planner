import {timeEstimate, durationLabel, timingDescription} from './booking-time.mjs';
import {initialState, CHECK_KEYS, normalizeJob, availability, assessJob} from './booking-core.mjs';
import {createBookingStore} from './booking-store.mjs';
import {bookingReport, exactBookingExport, verifyBookingExport, planSnapshots} from './booking-report.mjs';
import {downloadPlanPdf} from './plan-report.mjs';
import {mountPortrait} from './resource-portraits.mjs';
import {initRegistry} from './registry-ui.js';

const $ = id => document.getElementById(id);
const names = {UR3:'UR3',UR5:'UR5',G1:'G1',H1:'Robot helper',H2:'Cleaner'};
const kinds = {windows:'Windows',whiteboards:'Whiteboards',walls:'Walls',desks:'Desks',floors:'Floors',bins:'Bins',facade:'Facade'};
const areaLabel=value=>value>0&&value<.01?'<0.01':value.toLocaleString(undefined,{maximumFractionDigits:2});
const stages = {1:'Stage 1 · first jobs',2:'Stage 2 · afterwards'};
const checkLabels = {
 area:['Is the work area ready?','Check for people, obstacles and other hazards.'],
 permission:['Do you have permission?','Confirm the work and contact with this surface are allowed.'],
 surface:['Is this method suitable here?','Check the surface and the chosen person or robot for this job.'],
 people:['Are the people ready?','Confirm training, willingness and the help this job needs.'],
 equipment:['Has the equipment been checked?','Check the tools, cleaning products and any robot setup.'],
 access:['Can the work be reached safely?','Check access and the arrangements for working here.']
};
const el = (tag,cls='',text='') => {const n=document.createElement(tag);if(cls)n.className=cls;if(text)n.textContent=text;return n;};
const button=(text,fn,cls='secondary')=>{const b=el('button',cls,text);b.type='button';b.addEventListener('click',fn);return b;};
const unknown=()=>Object.fromEntries(CHECK_KEYS.map(key=>[key,'unknown']));
const newDraft=()=>({id:crypto.randomUUID(),name:'',kind:'windows',place:'',stage:1,mode:'manual',workerId:'H2',groups:[{count:'',width:'',height:'',faces:'inside'}],access:'floor',checks:unknown(),notes:'',status:'draft'});
let state=initialState(),context={...state.context},draft=newDraft(),step=1,store=null,storageError=null,committing=false,stale=false,cleanups=[];
let highestSeen=0;
const storeStatus=()=>{$('saved-state').textContent=storageError?'Browser storage unavailable':stale?'Another tab changed the draft':state.jobs.length?`${state.jobs.length} saved job${state.jobs.length===1?'':'s'} · on this browser`:'Your draft stays on this browser';};
function message(text){$('manager-alert').textContent=text;$('manager-alert').hidden=!text;}
function markStale(){stale=true;$('manager-stale').hidden=false;storeStatus();document.querySelectorAll('[data-write]').forEach(n=>n.disabled=true);}
function invalidate(){draft.checks=unknown();if(draft.status==='reserved')draft.status='draft';}
function setField(key,value){if(draft[key]!==value){invalidate();draft[key]=value;if(['mode','workerId','kind'].includes(key))delete draft.timeEstimate;}}
function heading(kicker,title,text){const div=el('div');div.append(el('p','eyebrow',kicker),el('h1','',title),el('p','intro',text));return div;}
function field(label,value,onChange,options={}){
 const wrap=el('label','field'+(options.full?' full':''));wrap.append(el('span','',label));const input=el(options.options?'select':options.multiline?'textarea':'input');
 if(options.options)for(const [val,text] of Object.entries(options.options)){const opt=el('option','',text);opt.value=val;input.append(opt);}
 else {if(!options.multiline)input.type=options.type||'text';if(options.maxLength)input.maxLength=options.maxLength;for(const key of ['min','max','step','placeholder'])if(options[key]!==undefined)input[key]=options[key];}
 input.value=value;input.addEventListener(options.options?'change':'input',()=>onChange(input.type==='number'?(input.value===''?'':input.valueAsNumber):input.value));wrap.append(input);return wrap;
}
const choice=(text,selected,fn)=>{const b=button(text,fn,'choice');b.setAttribute('aria-pressed',String(selected));return b;};
function currentJob(){return normalizeJob(draft);}
function safeAssessment(){try{return assessJob(state,currentJob());}catch(error){return {canReserve:false,reasons:[error.message],resources:[],status:'incomplete'};}}
function stageControl(onChange=render){const bar=el('div','stage-bar');bar.append(el('strong','',draft.name||'Your next job'));const select=el('select');select.setAttribute('aria-label','When this job happens');for(const [value,text] of Object.entries(stages)){const op=el('option','',text);op.value=value;select.append(op);}select.value=draft.stage;select.addEventListener('change',()=>{setField('stage',Number(select.value));onChange();});bar.append(select);return bar;}
function portrait(id,interactionElement=null,selected=false){const host=el('div','resource-portrait');const cleanup=mountPortrait(host,id,{interactionElement,selected});cleanups.push(cleanup);return {element:host,setSelected:value=>cleanup.setSelected?.(value)};}
function stateChip(id,exclude=true){const status=availability(state,id,draft.stage,exclude?draft.id:'');return el('span','status-chip '+status.status,status.status==='free'?'Available':status.label);}
function navigation(back,next,label){const nav=el('div','manager-actions');nav.append(back?button('← Back',()=>{step=back;render(true);},'text-button'):el('span','small-note','Add an optional time estimate after choosing the team.'));if(next)nav.append(button(label,()=>go(next),'primary'));return nav;}
async function commit(command){
 if(storageError)throw storageError;
 if(stale)throw new Error('This plan changed in another tab. Reload and check the team before saving.');
 if(committing)throw new Error('A change is still being saved. Please wait.');
 committing=true;const disabledBefore=new Map([...document.querySelectorAll('[data-write]')].map(n=>[n,n.disabled]));disabledBefore.forEach((_,n)=>n.disabled=true);
 try{state=await store.commit(command,state.revision);highestSeen=Math.max(highestSeen,state.revision);if(highestSeen>state.revision)markStale();storeStatus();return state;}
 catch(error){if(error.code==='STALE_REVISION')markStale();throw error;}
 finally{committing=false;disabledBefore.forEach((wasDisabled,n)=>{if(n.isConnected)n.disabled=wasDisabled||!!(stale||storageError);});}
}
async function saveContext(){
 if(JSON.stringify(context)!==JSON.stringify(state.context)){
  await commit({type:'setContext',context});context={...state.context};invalidate();
 }
}
async function go(next){
 message('');try{if(step===1){currentJob();await saveContext();}if(next>=3)currentJob();if(next===3&&state.jobs.some(j=>j.id===draft.id)){await commit({type:'saveJob',job:currentJob()});draft=structuredClone(state.jobs.find(j=>j.id===draft.id));}step=next;render(true);}catch(error){message(error.message);}
}
function renderJob(){
 const out=el('div');out.append(heading('01 / THE JOB','What needs cleaning?','Start with the building and the amount of work.'));
 const grid=el('div','form-grid');
 for(const [key,label] of [['company','Your cleaning company (optional)'],['customer','Customer (optional)'],['building','Building name']])grid.append(field(label,context[key],v=>{context[key]=v;}, {maxLength:160,full:key==='building'}));
 out.append(grid);
 if(state.jobs.length)out.append(el('p','small-note','Changing the building details releases existing bookings and resets their checks.'));
 const sec=el('section','form-section');sec.append(el('h2','','The work'));const types=el('div','task-kinds');types.setAttribute('role','group');types.setAttribute('aria-label','Type of cleaning');
 for(const [id,label] of Object.entries(kinds))types.append(choice(label,draft.kind===id,()=>{setField('kind',id);draft.groups=['windows','facade'].includes(id)?[{count:'',width:'',height:'',faces:'inside'}]:[];render();}));
 sec.append(types);const details=el('div','form-grid');details.append(field('Job name',draft.name,v=>setField('name',v),{maxLength:160,placeholder:'e.g. Reception windows'}),field('Room or place',draft.place,v=>setField('place',v),{maxLength:160,placeholder:'e.g. Ground-floor reception'}),field('When',draft.stage,v=>setField('stage',Number(v)),{options:stages}),field('Access needed',draft.access,v=>{setField('access',v);render();},{options:{floor:'Reachable from floor level',specialist:'Specialist access or work at height'}}));sec.append(details,field('Notes (optional)',draft.notes,v=>setField('notes',v),{maxLength:200,full:true}));out.append(sec);
 if(['windows','facade'].includes(draft.kind)){
  const sizes=el('section','form-section');sizes.append(el('h2','','How many windows?'),el('p','small-note','Group similar windows together. Rough sizes in metres are enough.'));
  draft.groups.forEach((group,i)=>{const row=el('div','window-group');
   for(const [key,label] of [['count','Windows'],['width','Width (m)'],['height','Height (m)']])row.append(field(label,group[key],v=>{invalidate();group[key]=v;updateTotals();},{type:'number',min:key==='count'?1:.001,max:key==='count'?100000:1000,step:key==='count'?1:.001}));
   row.append(field('Sides',group.faces,v=>{invalidate();group.faces=v;updateTotals();},{options:{inside:'Inside',outside:'Outside',both:'Both sides'}}));const remove=button('×',()=>{invalidate();draft.groups.splice(i,1);render();},'icon-button');remove.setAttribute('aria-label',`Remove window group ${i+1}`);remove.disabled=draft.kind==='windows'&&draft.groups.length===1;row.append(remove);sizes.append(row);
  });
  const add=button('+ Another window size',()=>{invalidate();draft.groups.push({count:'',width:'',height:'',faces:'inside'});render();},'text-button');add.disabled=draft.groups.length>=10;sizes.append(add);const totals=el('div','totals');totals.id='job-totals';sizes.append(totals);out.append(sizes);
 }
 if(draft.kind==='facade'||draft.access==='specialist')out.append(el('p','scope-note','Keep this as a draft for specialist planning. This app cannot reserve resources for facade work or work at height.'));
 out.append(navigation(null,2,'Choose the team →'));return out;
}
function updateTotals(){const target=$('job-totals');if(!target)return;target.replaceChildren();let windows=0,area=0;const valid=draft.groups.length&&draft.groups.every(g=>Number.isInteger(g.count)&&g.count>0&&g.count<=100000&&Number.isFinite(g.width)&&g.width>=.001&&g.width<=1000&&Number.isFinite(g.height)&&g.height>=.001&&g.height<=1000);if(valid)for(const g of draft.groups){windows+=g.count;area+=g.count*g.width*g.height*(g.faces==='both'?2:1);}for(const [value,label] of [[valid?windows.toLocaleString():'—','windows'],[valid?`${areaLabel(area)} m²`:'—','approximate area, counting sides']]){const div=el('div');div.append(el('strong','',value),el('span','',label));target.append(div);}}
function renderTeam(){
 const out=el('div'), cardViews=new Map(), busyInputs=new Map();
 const selection=el('div','team-selection-info'), selectionTitle=el('strong'), selectionNote=el('p');
 selection.setAttribute('role','status');selection.setAttribute('aria-live','polite');selection.append(selectionTitle,selectionNote);
 const busyNote=el('p','small-note');
 function choose(id){
  if(id==='H1'||id==='H2'){setField('mode','manual');setField('workerId',id);}else setField('mode',id);
  refreshTeam();refreshTiming?.();
 }
 function refreshTeam(){
  const robotChosen=draft.mode!=='manual', helperFree=availability(state,'H1',draft.stage,draft.id).status==='free';
  for(const [id,view] of cardViews){
   const selected=id===draft.mode||(draft.mode==='manual'&&id===draft.workerId), needed=id==='H1'&&robotChosen;
   view.card.setAttribute('aria-pressed',String(selected));view.card.dataset.needed=String(needed);
   view.tick.hidden=!selected;view.portrait.setSelected(selected);
   const status=availability(state,id,draft.stage,draft.id);
   view.status.className='status-chip '+status.status;view.status.textContent=status.status==='free'?'Available':status.label;
   view.extra.textContent=needed?`Needed for ${draft.mode}`:id.startsWith('H')?'':!helperFree?'Helper already taken':'';
   view.extra.style.visibility=view.extra.textContent?'visible':'hidden';
  }
  selectionTitle.textContent=robotChosen?`${draft.mode} + Robot helper`:`${names[draft.workerId]} selected`;
  selectionNote.textContent=robotChosen?'The robot and its helper must both be free. Continue to check this job.':'This person does the work without a robot. Continue to check this job.';
  busyNote.textContent=`Mark resources unavailable in stage ${draft.stage}. Bookings in this draft are shown automatically.`;
  for(const [id,input] of busyInputs){input.checked=state.busy[id].includes(draft.stage);input.disabled=availability(state,id,draft.stage).status==='booked'||stale||!!storageError||committing;}
 }
 function refreshStage(){refreshTeam();renderBoard();storeStatus();}
 function resourceCard(id,subtitle){
  const card=button('',()=>choose(id),'resource-card');card.dataset.resource=id;card.setAttribute('aria-label',`Choose ${names[id]}`);
  const model=portrait(id,card,false), status=stateChip(id), extra=el('span','card-extra'), tick=el('span','selected-check','✓');tick.setAttribute('aria-hidden','true');
  card.append(model.element,el('strong','',names[id]),el('span','card-note',subtitle),status,extra,tick);
  cardViews.set(id,{card,portrait:model,status,extra,tick});return card;
 }
 out.append(heading('02 / THE TEAM','Who will you reserve?','Choose a robot with its helper, or a person.'),stageControl(refreshStage),el('h2','team-group-title','Robots'));
 const robots=el('div','robot-grid');robots.setAttribute('role','group');robots.setAttribute('aria-label','Robots');
 for(const [id,label] of [['UR3','Small robot arm'],['UR5','Robot arm'],['G1','Humanoid robot']])robots.append(resourceCard(id,label));
 out.append(robots,el('h2','team-group-title people-title','People'));
 const people=el('div','people-grid');people.setAttribute('role','group');people.setAttribute('aria-label','People');
 people.append(resourceCard('H2','Manual cleaning'),resourceCard('H1','Robot support or manual cleaning'));
 out.append(people,selection,el('p','scope-note','Available means free to book. Confirm suitability for this particular job in the next step. This prototype has two people and two work stages.'));
 const timing=timingEditor();const refreshTiming=timing.refresh;out.append(timing.element);
 const busy=el('details','plain-details');busy.append(el('summary','','Is someone already busy elsewhere?'),busyNote);
 for(const id of ['UR3','UR5','G1','H1','H2']){
  const row=el('label','busy-row');row.append(el('span','',names[id]));const check=el('input');check.type='checkbox';check.setAttribute('aria-label',`${names[id]} busy elsewhere`);check.dataset.write='';busyInputs.set(id,check);
  check.addEventListener('change',async()=>{try{await commit({type:'setBusy',id,stage:draft.stage,busy:check.checked});invalidate();refreshStage();}catch(error){refreshTeam();message(error.message);}});row.append(check);busy.append(row);
 }
 out.append(busy,navigation(1,3,'Check the work →'));refreshTeam();return out;
}
function timingEditor(){
 const section=el('section','form-section');section.append(el('h2','','How long might this job take?'),el('p','small-note','Optional: enter your estimate for this team, including setup and finishing checks. Leave it blank if you do not know.'));
 let basis=draft.timeEstimate?.basis||'total';const controls=el('div','form-grid'), preview=el('p','timing-preview');preview.setAttribute('role','status');
 const options={total:'Total minutes for this job'};if(['windows','facade'].includes(draft.kind))options.area='Minutes per square metre';
 const select=field('Estimate using',basis,value=>{basis=value;delete draft.timeEstimate;invalidate();refresh();},{options});
 const amount=field(basis==='area'?'Minutes per m²':'Total minutes',draft.timeEstimate?.minutes??'',value=>{if(value===''){delete draft.timeEstimate;invalidate();}else setField('timeEstimate',{basis,minutes:value});show();},{type:'number',min:0.001,max:1000000,step:'any',placeholder:'Your estimate'});
 controls.append(select,amount);section.append(controls,preview,el('p','small-note','This is your planning assumption, not a measured robot speed. It does not release resources early or set a clock finish time.'));
 function show(){try{const estimate=timeEstimate(draft);preview.textContent=estimate?'Estimated duration: about '+durationLabel(estimate.minutes):'Estimated duration: not entered.';}catch(error){preview.textContent=error.message;}}
 function refresh(){basis=draft.timeEstimate?.basis||basis;select.querySelector('select').value=basis;amount.querySelector('span').textContent=basis==='area'?'Minutes per m²':'Total minutes';amount.querySelector('input').value=draft.timeEstimate?.minutes??'';show();}
 show();return {element:section,refresh};
}
function renderChecks(){
 const out=el('div');out.append(heading('03 / THE CHECKS','Is this job ready?','Record what has been checked. Unknown answers can stay in a draft.'));
 for(const [key,[title,note]] of Object.entries(checkLabels)){const row=el('div','check-row');const words=el('div');words.append(el('h3','',title),el('p','',note));const choices=el('div','check-answers');choices.setAttribute('role','group');choices.setAttribute('aria-label',title);for(const [value,label] of [['unknown','Not checked'],['yes','Yes'],['no','No']]){const b=choice(label,draft.checks[key]===value,()=>{if(draft.checks[key]!==value){draft.checks[key]=value;if(draft.status==='reserved')draft.status='draft';}render();});b.dataset.answer=value;choices.append(b);}row.append(words,choices);out.append(row);}
 out.append(el('p','scope-note','These are your recorded answers. The app does not inspect the place or validate a robot’s capability.'),navigation(2,4,'See the plan →'));return out;
}
async function saveJob(reserve){message('');try{const job=currentJob();await saveContext();await commit({type:reserve?'reserveJob':'saveJob',job:{...job,checks:{...draft.checks}}});draft=structuredClone(state.jobs.find(j=>j.id===job.id));step=4;render(true);message(reserve?'Resources reserved in this draft. Add another job to see who is still free.':draft.status==='reserved'?'Job saved; its existing reservation is unchanged.':'Job saved. Draft jobs do not hold any resources.');}catch(error){message(error.message);}}
function writeButton(text,action,cls='secondary'){const b=button(text,action,cls);b.dataset.write='';b.disabled=stale||!!storageError||committing;return b;}
function startNew(){draft=newDraft();step=1;message('');render(true);}
function downloadText(text,filename){const url=URL.createObjectURL(new Blob([text],{type:'application/json'}));const a=el('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function requireCurrent(){if(stale||storageError)throw new Error('Reload the saved draft before downloading or recording an outcome.');}
async function openReview(id){try{requireCurrent();const snapshots=await planSnapshots(state);const selected=snapshots.filter(j=>j.taskId===id);if(!selected.length)throw new Error('Save this job before recording an outcome.');document.dispatchEvent(new CustomEvent('fieldwork:open-registry',{detail:{tab:'reviews',jobs:selected}}));}catch(error){message(error.message);}}
function renderPlan(){
 const out=el('div');const assessment=safeAssessment();const saved=state.jobs.find(j=>j.id===draft.id);const same=saved&&JSON.stringify(saved)===JSON.stringify(draft);const reserved=same&&saved.status==='reserved';
 out.append(heading('04 / THE PLAN',reserved?'Resources reserved.':'Your job plan.','A booking holds resources in your draft; it does not start the work.'));
 const status=el('section','plan-status');status.append(el('strong','',reserved?'✓ Reserved in this draft':assessment.canReserve?'Ready for a draft booking':'Save now, finish the checks later'),el('p','',reserved?`Stage ${draft.stage}. These resources are unavailable for another job in the same stage.`:assessment.canReserve?'The recorded checks pass and the chosen resources are free.':'The job can stay as a draft while you work through the points below.'));out.append(status);
 const facts=el('div','plan-facts');for(const [label,value] of [['Job',draft.name||'Not named'],['Place',`${state.context.building||'No building'} · ${draft.place||'No place'}`],['Team',draft.mode==='manual'?names[draft.workerId]:`${draft.mode} + Robot helper`],['When',stages[draft.stage]]]){const cell=el('div');cell.append(el('span','',label),el('b','',value));facts.append(cell);}out.append(facts);
 const timing=el('section','plan-status');timing.append(el('h2','','Estimated completion time'));try{timing.append(el('p','',timingDescription(draft)));}catch(error){timing.append(el('p','',error.message));}timing.append(button('Change time estimate',()=>{step=2;render(true);},'text-button'),el('p','small-note','Duration after work starts, not a clock finish time. Include setup and finishing checks in your estimate. Stage bookings are unchanged.'));out.append(timing);
 if(assessment.quantities&&draft.groups.length)out.append(el('p','small-note',`${assessment.quantities.windows} windows · approximately ${areaLabel(assessment.quantities.area)} m² including the chosen sides.`));
 if(assessment.reasons.length){const list=el('ul','reason-list');for(const reason of assessment.reasons)list.append(el('li','',reason.replace(/^H1:/,'Robot helper:').replace(/^H2:/,'Cleaner:')));out.append(list);}
 if(draft.notes)out.append(el('p','small-note',draft.notes));
 const actions=el('div','manager-actions');actions.append(button('← Change checks',()=>{step=3;render(true);},'text-button'));if(!reserved){actions.append(writeButton('Save draft',()=>saveJob(false)));const reserve=writeButton('Reserve resources',()=>saveJob(true),'primary');reserve.disabled||=!assessment.canReserve;actions.append(reserve);}else actions.append(writeButton('Release resources',async()=>{try{await commit({type:'releaseJob',id:draft.id});draft=structuredClone(state.jobs.find(j=>j.id===draft.id));render();}catch(error){message(error.message);}}));out.append(actions);
 out.append(el('p','scope-note','Confirm robot suitability and permission to start outside this app. A draft reservation is not evidence that a robot can clean this building.'));
 if(state.jobs.length){const downloads=el('div','download-row');downloads.append(button('Download plan PDF',async()=>{try{requireCurrent();await downloadPlanPdf(bookingReport(state),'fieldwork-building-plan.pdf');}catch(error){message(error.message);}},'primary'),button('+ Add another job',startNew));out.append(downloads,el('p','small-note','Downloads include saved jobs only. Save your latest changes first.'));if(saved){const after=el('section','form-section');after.append(el('h2','','After the work'),el('p','small-note','Record what happened for this saved job. A supervisor can check the note separately.'),button('Record this job’s outcome',()=>openReview(saved.id)));out.append(after);}
 const exact=el('details','plain-details');exact.append(el('summary','','Optional independent check'),el('p','small-note','Download an exact plan file or check a saved one here. This checks the calculations and bookings; it does not verify your answers.'));
 exact.append(button('Download exact plan file',async()=>{try{requireCurrent();downloadText(await exactBookingExport(state),'fieldwork-booking.json');}catch(error){message(error.message);}}));const label=el('label','field');label.append(el('span','','Check an exact plan file'));const input=el('input');input.type='file';input.accept='.json,application/json';const result=el('p','inline-result');result.setAttribute('role','status');let selection=0;input.addEventListener('change',async()=>{const token=++selection;const file=input.files?.[0];result.textContent='';if(!file)return;result.textContent='Checking this file…';try{if(file.size>2000000)throw new Error('Choose a file smaller than 2 MB.');const checked=await verifyBookingExport(await file.text());if(token!==selection)return;result.textContent=`Check passed: ${checked.state.jobs.length} saved jobs recomputed. Nothing was imported.`;}catch(error){if(token===selection)result.textContent=`Check failed: ${error.message}`;}});label.append(input);exact.append(label,result);out.append(exact);
 }
 return out;
}
function renderBoard(){const board=$('manager-board');board.replaceChildren();const header=el('div','board-heading');header.append(el('h2','','Your saved jobs'),el('span','',`${state.jobs.length} saved`));board.append(header);
 if(!state.jobs.length)board.append(el('div','empty-board','Start with one job. Then add another to see which resources are still free.'));
 for(const job of state.jobs){const card=el('section','board-card'+(job.id===draft.id?' current':''));card.append(el('span','status-chip '+(job.status==='reserved'?'booked':''),job.status==='reserved'?'Resources reserved':job.status==='released'?'Resources released':'Draft · no resources held'),el('h3','',job.name),el('p','',`${job.place} · Stage ${job.stage}`),el('p','',job.mode==='manual'?names[job.workerId]:`${job.mode} + Robot helper`));card.append(el('p','small-note',timingDescription(job)));card.append(button('Open job',()=>{draft=structuredClone(job);step=4;message('');render(true);},'text-button'));card.append(button('Record outcome',()=>openReview(job.id),'text-button'));board.append(card);}
 const resources=el('section','board-card');resources.append(el('h3','',`Resources · Stage ${draft.stage}`));for(const id of ['UR3','UR5','G1','H1','H2']){const row=el('div','board-resource');row.append(el('span','',names[id]),stateChip(id,false));resources.append(row);}board.append(resources,el('p','small-note','Jobs in the same stage happen together. Stage 2 begins after stage 1. Entered time estimates do not change stage bookings.'));
}
function render(focus=false){for(const cleanup of cleanups)cleanup();cleanups=[];const steps=$('manager-steps');steps.replaceChildren();['Job','Team','Checks','Plan'].forEach((label,i)=>{const b=button('',()=>go(i+1),'');b.append(el('b','',String(i+1)),document.createTextNode(label));if(step===i+1)b.setAttribute('aria-current','step');b.disabled=i>0&&!draft.name;b.setAttribute('aria-label',`${i+1}. ${label}`);steps.append(b);});
 $('manager-content').replaceChildren([renderJob,renderTeam,renderChecks,renderPlan][step-1]());renderBoard();updateTotals();storeStatus();if(focus){const title=$('manager-content').querySelector('h1');title.tabIndex=-1;title.focus({preventScroll:true});$('main').scrollIntoView({behavior:'auto',block:'start'});}}
$('reload-plan').addEventListener('click',async()=>{try{const wasSaved=state.jobs.some(j=>j.id===draft.id);state=await store.load();highestSeen=state.revision;context={...state.context};const latest=state.jobs.find(j=>j.id===draft.id);if(latest)draft=structuredClone(latest);else if(wasSaved)draft=newDraft();stale=false;$('manager-stale').hidden=true;invalidate();step=draft.name?2:1;render(true);message('Latest saved version loaded. Unsaved edits to an existing job were replaced. Check the team and answer the work checks again.');}catch(error){message(error.message);}});
document.querySelector('.manager-brand').addEventListener('click',event=>{event.preventDefault();step=1;render(true);});
const help=$('manager-help-dialog');$('manager-help').addEventListener('click',()=>help.showModal());$('close-help').addEventListener('click',()=>help.close());
try{initRegistry();}catch(error){$('manage-registry').disabled=true;message('The results notebook could not open: '+error.message);}
try{store=createBookingStore();state=await store.load();context={...state.context};highestSeen=state.revision;store.subscribe(({revision})=>{if(revision===null){storageError=new Error('Browser storage was closed by another tab. Reload this page.');markStale();return;}highestSeen=Math.max(highestSeen,revision);if(!committing&&revision>state.revision)markStale();});}catch(error){storageError=error;message(error.message);}
render();
