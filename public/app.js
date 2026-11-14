'use strict';

const $ = id => document.getElementById(id);
const conditions = ['sharedSafety', 'visibility', 'path', 'contact', 'platformSafety', 'localSafety', 'validInput'];
const state = {boot: null, robot: 'G1', forceMode: 'exact', view: 'team', decision: null, job: null, choice: null, confirmation: null, requestId: 0, jobId: 0, evidenceId: 0, pending: false, jobPending: false};
const labels = {SELECT: 'An option is selected.', CONFIRM: 'Your confirmation is needed.', ASK: 'You have a choice to make.', WAIT: 'The robot is currently busy.', WITHHOLD: 'There is not enough support yet.', REFUSE: 'This request is refused.'};
const fieldNames = {capability:'capability', domain:'physical or simulation domain', context:'work context', target:'target location', mode:'operating mode', settings:'settings', setpoint:'requested force', evidence_level:'accepted evidence level'};
const siteNotes = {
  A: 'A · (−80, +20) mm · 7 N and 8 N records; diagnostic location, close to C.',
  B: 'B · (+80, 0) mm · completed wipes at 7 N and 8 N.',
  C: 'C · (−80, 0) mm · completed wipes at 7 N and 8 N.',
  D: 'D · (0, +80) mm · completed wipes at 7 N and 8 N.',
  E: 'E · (0, 0) mm · target hidden; historically refused before wiping.',
  F: 'F · (0, −80) mm · offline joint-margin screen failed; never run.'
};
function node(tag, className, text) { const el=document.createElement(tag); if(className)el.className=className; if(text!==undefined)el.textContent=text; return el; }
function button(text, className, action) { const el=node('button', className,text); el.type='button'; el.addEventListener('click',action); return el; }
function textJSON(value) { return JSON.stringify(value,null,2); }
function toast(message) { $('toast').textContent=message; $('toast').hidden=false; clearTimeout(toast.timer); toast.timer=setTimeout(()=>$('toast').hidden=true,4500); }
async function api(path, payload) {
  const response=await fetch('/api/'+path,payload===undefined?{cache:'no-store'}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),cache:'no-store'});
  const data=await response.json();
  if(!response.ok)throw new Error(data.error||'The planner could not complete this request.');
  return data;
}
function setError(message) { $('connection-error').textContent=message; $('connection-error').hidden=!message; }
function syncExport() { $('export-button').disabled=state.view==='jobs'?(!state.job||state.jobPending):['planner','studio'].includes(state.view)?(!state.decision||state.pending):true; }
function setBusy(value) {
  state.pending=value; $('decision-panel').setAttribute('aria-busy',String(value)); $('decision-panel').classList.toggle('loading',value);
  $('decision-actions').querySelectorAll('button').forEach(b=>b.disabled=value); syncExport();document.dispatchEvent(new CustomEvent('fieldwork:pending',{detail:value}));
}
function changeView(view) {
  const names={team:'Plan a job',studio:'3D studio',planner:'Task planner',jobs:'Whole-job plans',evidence:'Evidence library',about:'How it works'};
  if(!names[view])return;
  state.view=view;document.body.dataset.workspace=view==='team'?'simple':'research';$('research-mode').setAttribute('aria-pressed',String(view!=='team'));$('export-button').hidden=view==='team';
  document.querySelectorAll('.view').forEach(el=>el.hidden=el.id!=='view-'+view);
  document.querySelectorAll('.nav-item').forEach(el=>{ const active=el.dataset.view===view;el.classList.toggle('active',active);if(active)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');});
  $('breadcrumb-current').textContent=names[view];
  if(location.hash!=='#'+view)history.replaceState(null,'','#'+view);
  if(view==='jobs'&&!state.job)loadJob();
  if(view==='evidence')renderLibrary();
  syncExport();
  document.dispatchEvent(new CustomEvent('fieldwork:view',{detail:view}));
}
function resetDeclarations(notify=true) {
  const had=state.choice||state.confirmation;state.choice=null;state.confirmation=null;
  if(had&&notify)toast('The request changed. The previous choice and confirmation were cleared.');
}
function updateCase(robot) {
  state.robot=robot;
  document.querySelectorAll('[data-robot]').forEach(el=>{ const yes=el.dataset.robot===robot;el.classList.toggle('selected',yes);el.setAttribute('aria-pressed',String(yes)); });
  $('g1-fields').hidden=robot!=='G1'; $('force-min').disabled=robot!=='G1'; $('force-max').disabled=robot!=='G1'||state.forceMode==='exact'; $('wall-panel').hidden=robot!=='G1'; $('non-g1-task').hidden=robot==='G1';
  $('path-field').hidden=robot==='UR5'; $('contact-field').hidden=robot==='UR5';
  $('non-g1-task').textContent=robot==='UR3'?'Request: hand over a registered cube in the published cell. The mode requires an operator and explicit confirmation.':'Request: detect the taped target region in the documented whiteboard context. The attendant starts the program and watches; this profile does not qualify wiping.';
  updateOtherChecks();
}
function setForceMode(mode) {
  state.forceMode=mode;const range=mode==='range';$('force-max-label').hidden=!range;$('force-max').disabled=!range||state.robot!=='G1';$('force-min-title').textContent=range?'Minimum':'Right pad target';
  $('force-exact').classList.toggle('active',!range);$('force-range').classList.toggle('active',range);$('force-exact').setAttribute('aria-pressed',String(!range));$('force-range').setAttribute('aria-pressed',String(range));
}
function readInputs() {
  const inputs={robot:state.robot,domain:$('domain').value,context:$('context').value,availability:$('availability').value};
  conditions.forEach(name=>inputs[name]=$(name).value);
  if(state.robot==='G1'){
    inputs.target=$('target').value;
    const min=Number($('force-min').value),max=state.forceMode==='range'?Number($('force-max').value):min;
    if(!Number.isFinite(min)||!Number.isFinite(max)||min<=0||min>max||max>100)throw new Error('Enter a positive force, with the minimum no greater than the maximum (up to 100 N input).');
    inputs.force={min,max};
  }
  if(state.choice)inputs.choice=state.choice;if(state.confirmation)inputs.confirmation=state.confirmation;
  return inputs;
}
function updateOtherChecks() {
  const fields=['platformSafety','localSafety','validInput',...(state.robot==='UR5'?[]:['contact'])];
  const unknown=fields.filter(name=>$(name).value==='UNKNOWN'||$(name).value==='CONFLICTING').length;
  const failed=fields.filter(name=>$(name).value==='FAIL').length;
  $('other-checks-count').textContent=failed?failed+' failed':unknown?unknown+' unknown':'All assumed passing';
}
function fillInputs(inputs, origin) {
  resetDeclarations(false);updateCase(inputs.robot||'G1');
  $('domain').value=inputs.domain||(state.robot==='G1'?'simulation':'physical');$('context').value=inputs.context||'tested';
  conditions.forEach(name=>$(name).value=inputs[name]||'UNKNOWN');$('availability').value=inputs.availability||'UNKNOWN';
  if(state.robot==='G1'){$('target').value=inputs.target||'B';const force=inputs.force||{min:7,max:7};$('force-min').value=force.min;$('force-max').value=force.max;setForceMode(force.min===force.max?'exact':'range');updateMap($('target').value);}
  updateOtherChecks();$('input-origin').textContent=origin||'Custom example · conditions initially unknown';
  evaluate();
}
async function evaluate() {
  const id=++state.requestId;setBusy(true);setError('');
  try{
    const data=await api('decision',readInputs());if(id!==state.requestId)return;
    state.decision=data;renderDecision(data);
  }catch(error){if(id!==state.requestId)return;state.decision=null;$('decision-title').textContent='Check the request.';$('decision-explanation').textContent=error.message;$('decision-code').textContent='INPUT ERROR';$('decision-actions').replaceChildren();$('candidate-list').replaceChildren();$('reasoning').replaceChildren();$('raw-decision').textContent='';setError(error.message);document.dispatchEvent(new CustomEvent('fieldwork:error',{detail:error.message}));}
  finally{if(id===state.requestId)setBusy(false);}
}
function profileName(p) {return p.platform==='G1'?'G1 · location '+p.target+' · '+p.force_setpoint_n+' N':p.platform==='UR3'?'UR3 · registered handover':'UR5 · target detection';}
function metricFor(p,q,stat) { return p.metrics.find(m=>m.quantity===q&&(!stat||m.statistic===stat)); }
function reasonLine(title,detail,status) {
  const li=node('li');li.append(node('i','reason-icon '+status,status==='pass'?'✓':status==='fail'?'×':'?'));
  const body=node('div');body.append(node('strong','',title),node('p','',detail));li.append(body);return li;
}
function humanRolesText(data) {return [...new Set(Object.values(data.humanRoles).flatMap(x=>x.roles))].join(', ');}
function renderDecision(data) {
  const r=data.result,i=data.inputs;const panel=$('decision-panel');panel.className='decision-panel'+(r.decision==='SELECT'?' selected':r.decision==='REFUSE'?' refused':r.decision==='WAIT'?' waiting':'');
  $('decision-code').textContent=r.decision;$('decision-title').textContent=labels[r.decision]||r.decision;
  const mismatchGroups=Object.values(r.not_applicable);
  const fewest=mismatchGroups.length?Math.min(...mismatchGroups.map(fields=>fields.length)):0;
  const mismatch=[...new Set(mismatchGroups.filter(fields=>fields.length===fewest).flat())];
  let explanation='';
  if(r.decision==='SELECT')explanation=profileName(r.configuration)+' meets the supplied checks. This is an offline selection; the app does not start a robot.';
  if(r.decision==='CONFIRM')explanation=profileName(r.configuration)+' is supported under the conditions entered for this example. A confirmation must refer to this exact request and situation.';
  if(r.decision==='ASK')explanation=r.remaining.length+' supported options remain. Choose one for this demonstration; the framework does not rank them by cleaning performance.';
  if(r.decision==='WAIT')explanation='A supported configuration exists, but the platform is declared busy. Its availability must change before it can be selected.';
  if(r.decision==='REFUSE')explanation=i.sharedSafety==='FAIL'?'The shared work area is declared unsafe. This blocks the request.':'Every applicable option has a failed check in the supplied evidence or conditions.';
  if(r.decision==='WITHHOLD')explanation=i.sharedSafety!=='PASS'?'The shared work-area check is unresolved. Passing records cannot replace missing information about the current situation.':Object.keys(r.candidate_reasons).length===0?'No catalogue option matches the complete request. The closest catalogue options differ in '+mismatch.map(k=>fieldNames[k]||k).join(', ')+'.':'At least one required check is unknown or conflicting. The framework keeps that uncertainty visible.';
  $('decision-explanation').textContent=explanation;
  $('decision-context').textContent=(i.robot==='G1'?'Location '+i.target+' · ':'')+i.domain+' request · '+(i.context==='tested'?'tested context':'new context');
  const actions=$('decision-actions');actions.replaceChildren();
  if(r.decision==='ASK')r.remaining.forEach(cid=>{const p=data.profiles.find(p=>p.id===cid);actions.append(button('Choose '+(p.force_setpoint_n?p.force_setpoint_n+' N':p.platform),'button subtle',()=>{state.choice={kind:'choice',binding:r.binding,candidate_id:cid};state.confirmation=null;evaluate();}));});
  if(r.decision==='CONFIRM')actions.append(button('Confirm for this demonstration →','button primary',()=>{state.confirmation={kind:'confirmation',binding:r.binding,candidate_id:r.configuration.id};evaluate();}));
  const consent=$('consent-message');consent.hidden=!['CONFIRM','ASK','SELECT'].includes(r.decision);consent.textContent='Browser inputs only. This is not a recognised gesture, execution approval or robot command.';
  const lines=$('reasoning');lines.replaceChildren();
  const applicable=data.profiles.filter(p=>!Object.hasOwn(r.not_applicable,p.id));
  lines.append(reasonLine('Match the requested task',applicable.length?applicable.length+' profile'+(applicable.length===1?' matches':'s match')+' the capability, context, target and permitted setting.':'No profile matches all request fields. '+(mismatch.length?'Closest records differ in: '+mismatch.map(k=>fieldNames[k]||k).join(', ')+'.':''),applicable.length?'pass':'unknown'));
  const failed=[...new Set(Object.values(r.candidate_reasons).flatMap(x=>x.failed))],unresolved=[...new Set(Object.values(r.candidate_reasons).flatMap(x=>x.unresolved))];
  const guardDetail=i.sharedSafety!=='PASS'?'Shared work area: '+i.sharedSafety.toLowerCase()+'.':failed.length?'Failed: '+failed.map(prettyReason).join('; ')+'.':unresolved.length?'Unresolved: '+unresolved.map(prettyReason).join('; ')+'.':applicable.length?'Required checks pass within the conditions entered for this example.':'No applicable profile is available to check.';
  lines.append(reasonLine('Check the conditions',guardDetail,i.sharedSafety==='FAIL'||failed.length?'fail':i.sharedSafety!=='PASS'||unresolved.length||!applicable.length?'unknown':'pass'));
  lines.append(reasonLine('Account for the people involved','Required role: '+humanRolesText(data)+'. The single-task selector does not book a person. Open Whole-job plans to check staffing and dependencies.','unknown'));
  lines.append(reasonLine('Keep the evidence in scope',i.robot==='G1'?'These are pelvis-supported simulation records. They do not establish physical G1 performance, dirt removal or an operating range.':i.robot==='UR5'?'The stored profile covers target detection. Automatic wiping behaviour is documented separately; regulated wiping and cleaning effectiveness are not qualified by this profile.':'The profile covers registered-cube handover in the published UR3 cell. It does not qualify a general cleaning task.','pass'));
  if(data.historicalAdmission)lines.append(reasonLine('Separate the historical test outcome',data.historicalAdmission.explanation+' '+data.historicalAdmission.distinction,'unknown'));
  $('raw-decision').textContent=textJSON(data);
  const relevant=i.robot==='G1'?data.profiles.filter(p=>p.target===i.target):data.profiles;
  $('matching-count').textContent=relevant.length+' location record'+(relevant.length===1?'':'s');const list=$('candidate-list');list.replaceChildren();
  if(!relevant.length)list.append(node('p','empty-evidence','No supported wipe profile is registered at '+i.target+'. The historical reason is shown above.'));
  document.dispatchEvent(new CustomEvent('fieldwork:decision',{detail:data}));
  relevant.forEach(p=>{const row=node('div','candidate-row'),body=node('div');body.append(node('strong','',profileName(p)));const metric=metricFor(p,'normal_force_error','RMSE');body.append(node('p','',metric?'Recorded force RMSE: '+metric.value.toFixed(3)+' N · 4 s scored window':p.platform==='UR5'?'Documented hardware evidence · detection profile only':'Published hardware evidence · registered cubes'));row.append(body,button('Inspect ↗','',()=>openEvidence(p.id)));list.append(row);});
}
function prettyReason(value) {return value.replace(/^live:/,'').replace(/^evidence:/,'evidence ').replaceAll('_',' ');}
function updateMap(site) {$('map-note').textContent=siteNotes[site];document.querySelectorAll('.map-point').forEach(p=>{p.classList.toggle('active',p.dataset.site===site);p.setAttribute('aria-pressed',String(p.dataset.site===site));p.setAttribute('aria-label',siteNotes[p.dataset.site]);});}
async function loadJob() {
  const id=++state.jobId;state.jobPending=true;syncExport();$('job-results').classList.add('loading');setError('');
  try{
    const payload={scenario:$('job-scenario').value,peopleAvailable:$('job-people').checked,sharedSafety:$('job-safety').value,useRecordedDeclarations:$('job-declarations').checked,force:{min:Number($('job-min').value),max:Number($('job-max').value)}};
    const data=await api('job',payload);if(id!==state.jobId)return;state.job=data;renderJob(data);
  }catch(error){if(id!==state.jobId)return;state.job=null;setError(error.message);$('job-results').replaceChildren(node('div','error-panel',error.message));$('raw-job').textContent='';$('job-summary').replaceChildren();}
  finally{if(id===state.jobId){state.jobPending=false;$('job-results').classList.remove('loading');syncExport();}}
}
const jobLabels={RECOMMENDED:'Robot option recommended',PENDING_CONFIRMATION:'Needs confirmation',PENDING_CHOICE:'Owner choice needed',WAITING:'Robot busy',WAITING_FOR_PERSON:'Person unavailable',MANUAL_ASSIGNED:'Manual alternative assigned',CONDITIONAL_ON_INPUT:'Waiting on an input',BLOCKED_INPUT:'Required input unavailable',BLOCKED_SHARED:'Shared check failed',WITHHELD_SHARED:'Shared check unresolved',BLOCKED_EVIDENCE:'Supporting evidence missing',BLOCKED_TASK_CONDITION:'Task condition failed',BLOCKED_NOT_IN_TEAM:'Robot outside team',WITHHELD_TASK_CONDITION:'Task condition unresolved',BLOCKED_ROBOT_CHECK:'Robot check failed',WITHHELD_ROBOT_CHECK:'Robot check unresolved'};
function renderJob(data) {
  const tasks=data.plan.tasks,summary=$('job-summary');summary.replaceChildren();
  const counts=[['Tasks in this example',tasks.length],['Robot recommendations',tasks.filter(t=>t.state==='RECOMMENDED').length],['Human actions listed',data.plan.human_actions.length]];
  counts.forEach(([label,value])=>{const el=node('div');el.append(node('strong','',String(value)),node('span','',label));summary.append(el);});
  const root=$('job-results');root.replaceChildren();
  tasks.forEach(t=>{const card=node('article','job-row');const top=node('div','job-row-top'),heading=node('div');heading.append(node('div','task-id',t.id+' · '+t.slot+' · '+t.area),node('h3','',t.id==='T-WS-D'?'Wipe at simulated wall location D (G1 case context)':t.label));const color=['RECOMMENDED','MANUAL_ASSIGNED'].includes(t.state)?'green':t.state.includes('FAILED')||t.state==='BLOCKED_SHARED'?'red':'';top.append(heading,node('span','state-pill '+color,jobLabels[t.state]||t.state));card.append(top);
    const request=data.scenario.tasks.find(task=>task.id===t.id)?.request;
    if(request?.force){const force=request.force;card.append(node('p','field-help','Requested force: '+(force.minimum_n===force.maximum_n?'exactly '+force.minimum_n:force.minimum_n+'–'+force.maximum_n)+' N.'));}
    if(t.robot)card.append(node('p','',t.robot.platform+' · '+t.robot.configuration+(t.robot.setpoint_n?' · '+t.robot.setpoint_n+' N':'')+' · '+t.robot.evidence_level));
    if(t.person)card.append(node('p','',t.person+' reserved as '+(t.person_role||[]).join(', ')));
    if(t.selector)card.append(node('p','','Per-task check: '+t.selector.decision+' · '+(t.selector.reason||'')));
    if(t.inputs?.length)card.append(node('p','',t.inputs.map(x=>'Needs '+x.output+' from '+x.from+' ('+x.status+')').join('; ')));
    if(t.gap?.length){const fields=[...new Set(t.gap.flatMap(g=>Object.keys(g.mismatch)))];card.append(node('p','',fields.length?'Evidence differs in: '+fields.map(k=>fieldNames[k]||k).join(', ')+'.':'No matching evidence record.'));}
    if(t.reasons?.length)card.append(node('p','',t.reasons.map(prettyReason).join('; ')));
    if(t.manual_alternative&&!t.manual_alternative.original_request_fulfilled)card.append(node('p','', 'This manual alternative does not fulfil the original regulated-force request.'));
    root.append(card);
  });
  $('raw-job').textContent=textJSON(data);
}
function renderLibrary() {
  if(!state.boot)return;const query=$('evidence-search').value.trim().toLowerCase();const profiles=state.boot.profiles.filter(p=>(profileName(p)+' '+p.capability+' '+p.context+' '+p.id).toLowerCase().includes(query));
  $('library-count').textContent=profiles.length+' profile'+(profiles.length===1?'':'s');const root=$('evidence-grid');root.replaceChildren();
  profiles.forEach(p=>{const card=node('article','evidence-card'),top=node('div','case-top');top.append(node('span','small-label',p.id),node('span','pill '+(p.platform==='G1'?'simulation':'hardware'),p.platform==='G1'?'Simulation':'Hardware'));card.append(top,node('h2','',profileName(p)),node('p','',p.platform==='G1'?'Original supported wall · recorded wipe and final hold':p.platform==='UR3'?'Published registered-cube cell':'Documented taped-region detector'));
    const metric=metricFor(p,'normal_force_error','RMSE'),box=node('div','metric');box.append(node('strong','',metric?metric.value.toFixed(3)+' N':p.platform==='UR3'?'Operator':'Attendant'),node('span','',metric?'Recorded force RMSE · 4 s scored window':'Required human role in the planning catalogue'));card.append(box,button('Inspect evidence ↗','button subtle',()=>openEvidence(p.id)));root.append(card);
  });
  if(!profiles.length)root.append(node('p','empty-evidence','No profiles match this search.'));
}
function addDetail(root,label,value){root.append(node('dt','',label),node('dd','',String(value)));}
async function openEvidence(id) {
  const requestId=++state.evidenceId;
  $('dialog-title').textContent='Loading evidence…';$('dialog-content').replaceChildren();$('evidence-dialog').showModal();
  try{const data=await api('evidence?id='+encodeURIComponent(id));if(requestId!==state.evidenceId||!$('evidence-dialog').open)return;const p=data.profile;$('dialog-title').textContent=profileName(p);const content=$('dialog-content');content.replaceChildren();const dl=node('dl','dialog-details');addDetail(dl,'Evidence level',p.evidence_level);addDetail(dl,'Capability',p.capability.replaceAll('_',' '));addDetail(dl,'Context',p.context.replaceAll('_',' '));addDetail(dl,'Operating mode',p.mode.replaceAll('_',' '));addDetail(dl,'Evidence IDs',p.evidence_ids.join(', '));addDetail(dl,'Confirmation',p.confirmation_required?'Required for the exact situation':'No per-target confirmation in this profile');content.append(dl);
    if(p.platform==='UR3'||p.platform==='G1'){const image=node('img','recorded-image');image.src='/assets/'+(p.platform==='UR3'?'ur3-case.png':'g1-case.png');image.alt=p.platform==='UR3'?'Published UR3 case figure':'Recorded G1 simulation figure with location examples';content.append(image,node('p','image-credit',p.platform==='UR3'?'Source: Goonetilleke and Khalid, Frontiers in Robotics and AI (2026), doi:10.3389/frobt.2026.1897261. Reproduced under CC BY.':'Existing manuscript figure from recorded G1 simulation. Not a live view.'));}
    if(p.platform==='UR5')content.append(node('p','evidence-note','These are archived profile statements. Dataset and evaluation matching are under clarification. No independent held-out test has been identified in the evidence reviewed here.'));
    content.append(node('h3','',p.platform==='UR5'?'Limits recorded in the archived profile':'Limits attached to this profile'));const list=node('ul','qualifier-list');p.qualifiers.forEach(q=>list.append(node('li','',q)));content.append(list);
    if(p.metrics.length){content.append(node('h3','','Recorded metrics'));const defs=node('dl','dialog-details');p.metrics.forEach(m=>addDetail(defs,m.quantity.replaceAll('_',' ')+' · '+m.statistic,Number(m.value).toPrecision(6)+' '+m.unit+' | '+m.window.replaceAll('_',' ')+' | '+m.side.replaceAll('_',' ')));content.append(defs,node('p','field-help','Each value keeps its recorded measurement window and side. Sample fractions are not trial-success rates.'));}
    content.append(node('p','field-help',data.sourceNote));const raw=node('details','raw-details source-record');raw.append(node('summary','','Read the exact profile and source records'),node('pre','source-json',textJSON(data)));content.append(raw);
  }catch(error){if(requestId!==state.evidenceId||!$('evidence-dialog').open)return;$('dialog-title').textContent='Evidence could not be opened';$('dialog-content').append(node('p','',error.message));}
}
function exportCurrent() {
  const data=state.view==='jobs'?state.job:state.decision;if(!data||state.pending&&['planner','studio'].includes(state.view)||state.jobPending&&state.view==='jobs')return;
  const record={application:'Fieldwork robot deployment demonstrator',exportedAt:new Date().toISOString(),view:state.view,notice:'Offline decision using entered demonstration conditions. No robot command or real-world approval.',...data};
  state.evidenceId++;
  const content=$('dialog-content');content.replaceChildren();$('dialog-title').textContent='Export this '+(state.view==='jobs'?'job plan':'decision');
  content.append(node('p','field-help','The JSON below contains the request, entered conditions, original decision and evidence identities. Save it or copy it to keep a record of this example.'));
  const field=node('textarea','export-json');field.readOnly=true;field.value=textJSON(record)+'\n';field.setAttribute('aria-label','Decision export JSON');content.append(field);
  const actions=node('div','export-actions');
  actions.append(button('Copy JSON','button subtle',async()=>{try{await navigator.clipboard.writeText(field.value);toast('Copied the decision JSON.');}catch{field.focus();field.select();toast('The JSON is selected. Press Ctrl+C to copy it.');}}));
  const fileName='fieldwork-'+(state.view==='jobs'?'job-plan':'decision')+'-'+new Date().toISOString().replaceAll(':','-')+'.json';
  actions.append(button('Download JSON','button primary',()=>{const url=URL.createObjectURL(new Blob([field.value],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=fileName;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);toast('Download requested. You can also copy the JSON above.');}));
  content.append(actions);$('evidence-dialog').showModal();
}
document.querySelectorAll('.condition-select').forEach(el=>{[['UNKNOWN','Unknown'],['PASS','Assume pass'],['FAIL','Assume failed'],['CONFLICTING','Conflicting']].forEach(([value,label])=>{const option=node('option','',label);option.value=value;el.append(option);});});
document.querySelectorAll('.nav-item').forEach(el=>el.addEventListener('click',()=>changeView(el.dataset.view)));
document.querySelectorAll('.case-card').forEach(el=>el.addEventListener('click',()=>fillInputs({robot:el.dataset.robot})));
document.querySelector('.brand').addEventListener('click',e=>{e.preventDefault();changeView('team');});
$('task-form').addEventListener('submit',e=>{e.preventDefault();evaluate();});
function taskChanged(){resetDeclarations();updateOtherChecks();updateMap($('target').value);$('input-origin').textContent='Custom demonstration conditions';evaluate();}
$('task-form').addEventListener('change',taskChanged);
$('task-form').addEventListener('input',event=>{if(event.target.type==='number')taskChanged();});
$('force-exact').addEventListener('click',()=>{setForceMode('exact');resetDeclarations();evaluate();});
$('force-range').addEventListener('click',()=>{setForceMode('range');if(Number($('force-max').value)<Number($('force-min').value))$('force-max').value=$('force-min').value;resetDeclarations();evaluate();});
$('load-preset').addEventListener('click',()=>{const preset=state.boot?.presets.find(p=>p.id===$('preset').value);if(preset)fillInputs(preset.inputs,'Worked example · all supplied conditions are hypothetical');});
document.querySelectorAll('.map-point').forEach(el=>el.addEventListener('click',()=>{$('target').value=el.dataset.site;updateMap(el.dataset.site);resetDeclarations();evaluate();}));
$('job-form').addEventListener('submit',e=>{e.preventDefault();loadJob();});
$('job-form').addEventListener('change',loadJob);
$('job-form').addEventListener('input',event=>{if(event.target.type==='number')loadJob();});
$('evidence-search').addEventListener('input',renderLibrary);
$('evidence-dialog').addEventListener('close',()=>{state.evidenceId++;});
$('close-dialog').addEventListener('click',()=>$('evidence-dialog').close());
$('evidence-dialog').addEventListener('click',event=>{if(event.target===$('evidence-dialog')){const r=$('evidence-dialog').getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)$('evidence-dialog').close();}});
$('show-provenance').addEventListener('click',()=>{state.evidenceId++;$('dialog-title').textContent='Software provenance';$('dialog-content').replaceChildren(node('p','', 'The app checks the identities of its bundled source files at startup. The rules and catalogue are copied unchanged from the checked source package.'),node('pre','source-json',textJSON(state.boot?.provenance||{})));$('evidence-dialog').showModal();});
$('export-button').addEventListener('click',exportCurrent);
async function init(){
  try{state.boot=await api('bootstrap');$('preset').replaceChildren();state.boot.presets.forEach(p=>{const option=node('option','',p.label);option.value=p.id;$('preset').append(option);});$('load-preset').disabled=false;$('engine-status').textContent='Original Python rules · '+state.boot.profiles.length+' catalogue profiles';updateCase('G1');updateMap('B');await evaluate();changeView(location.hash.slice(1)||'team');document.dispatchEvent(new CustomEvent('fieldwork:ready',{detail:state.boot}));}
  catch(error){setError('Could not connect to the local Python planner. Start the app using run.sh, then reload. '+error.message);$('decision-title').textContent='Planner unavailable';$('decision-explanation').textContent='No decision has been calculated.';$('decision-code').textContent='OFFLINE';$('decision-panel').setAttribute('aria-busy','false');document.dispatchEvent(new CustomEvent('fieldwork:error',{detail:'Planner unavailable. No decision has been calculated.'}));setBusy(false);}
}
window.Fieldwork={
  getState:()=>state,
  update(patch){let old;try{old=readInputs();}catch{old=state.decision?.inputs||{robot:state.robot};}const next={...old,...patch};delete next.choice;delete next.confirmation;fillInputs(next,'Custom demonstration conditions');},
  preset(id){const p=state.boot?.presets.find(p=>p.id===id);if(p)fillInputs(p.inputs,'Worked example · all supplied conditions are hypothetical');},
  choose(id){const r=state.decision?.result;if(state.pending||r?.decision!=='ASK'||!r.remaining.includes(id))return;state.choice={kind:'choice',binding:r.binding,candidate_id:id};state.confirmation=null;evaluate();},
  confirm(){const r=state.decision?.result;if(state.pending||r?.decision!=='CONFIRM')return;state.confirmation={kind:'confirmation',binding:r.binding,candidate_id:r.configuration.id};evaluate();},
  inspect:openEvidence,view:changeView,toast
};
$('research-mode').addEventListener('click',()=>changeView(state.view==='team'?'studio':'team'));
window.addEventListener('hashchange',()=>changeView(location.hash.slice(1)));
init();
