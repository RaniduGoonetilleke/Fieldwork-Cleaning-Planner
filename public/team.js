'use strict';
import {forceRequirement, forceLabel} from './requirements.mjs';
import {planDownload} from './customer-state.mjs';
import {testedPlanReport, testedPlanWords, planPdfButton} from './plan-report.mjs';
import {testedTaskDisplay} from './tested-display.mjs';

const $ = id => document.getElementById(id);
const el = (tag, cls, text) => { const n=document.createElement(tag); if(cls)n.className=cls; if(text!==undefined)n.textContent=text; return n; };
const names={UR3:'UR3',UR5:'UR5',G1:'G1',H1:'Robot helper',H2:'Glass cleaner'};
const jobs={
  UR3:{title:'Pass a cube',customer:'Pass cleaning supplies',sub:'UR3 · handover arm',tested:'T-SH',building:'SH1'},
  UR5:{title:'Find a cleaning area',customer:'Find a cleaning area',sub:'UR5 · finds marked areas',tested:'T-WB-L',building:'WB1-L'},
  G1:{title:'Try a wall wipe',customer:'Wipe a wall',sub:'G1 · wall spot D',tested:'T-WS-D',building:'WS1'},
  glass:{title:'Wipe glass by hand',customer:'Wipe glass by hand',sub:'A trained person',building:'GP1'}
};
const descriptions={
  UR3:'Passes a registered cube. A trained person commands it and gives the OK.',
  UR5:'Finds the taped area. A trained person starts it and watches.',
  G1:'Wipes the wall in simulation, held at the pelvis. A trained helper is required in the plan.',
  H1:'Can support the robots, clean glass and wipe whiteboards.',
  H2:'Can clean glass. Has no robot-support training in this example.'
};
const icons={
  UR3:'<path d="M24 106h75M57 102V82l32-28-22-23"/><path d="M48 81h19M59 31h16M88 47v15"/><circle cx="58" cy="84" r="10"/><circle cx="89" cy="54" r="9"/><circle cx="66" cy="31" r="8"/><path d="m66 23 17-8m-6-7 8 8-8 8"/><path d="m123 62 20-11 20 11-20 12zM123 62v25l20 12 20-12V62m-20 12v25"/><path d="M108 29h37m-9-7 9 7-9 7"/>',
  UR5:'<rect x="94" y="18" width="73" height="79" rx="5"/><path d="M129 97v12M105 109h48M101 35v-9h12m35 0h11v9m0 44v10h-11m-35 0h-12V79"/><circle cx="130" cy="58" r="9"/><path d="M20 108h63M48 104V79l28-28 21 7"/><circle cx="48" cy="80" r="9"/><circle cx="76" cy="51" r="9"/><path d="m97 58 24-1" stroke-dasharray="3 6"/>',
  G1:'<rect x="131" y="18" width="37" height="89" rx="3"/><circle cx="79" cy="26" r="12"/><path d="M65 43h28v35H65zM67 78l-6 30m29-30 6 30M65 49 47 64l-4 20M93 49l18 15 25-9M55 110h12m24 0h12"/><path d="M137 45v21M146 40v32" stroke-width="7"/><path d="m150 50 8 8-8 8"/>',
  glass:'<rect x="73" y="15" width="92" height="94" rx="4"/><path d="M119 15v94M73 62h92"/><circle cx="39" cy="39" r="12"/><path d="M26 58h25l7 49M28 58l-7 49M48 61l22 13 26-27M90 39l17 16M133 33l12 11m-7 31 12 11"/>'
};
const state={step:1,context:'tested_contexts',job:null,people:{H1:'AVAILABLE',H2:'AVAILABLE'},safety:'UNKNOWN',contact:'UNKNOWN',forceMode:'range',force:{min:6,max:8},forceValid:true,otherJob:false,declarations:{},data:null,pending:false,requestId:0,scene:null,sceneReady:false,selected:'G1',started:false};
const isTested=()=>state.context==='tested_contexts';
const jobTitle=()=>state.job?(isTested()?jobs[state.job].title:jobs[state.job].customer):'';
const taskId=()=>state.job?(isTested()?jobs[state.job].tested:jobs[state.job].building):null;
const currentTask=()=>state.data?.plan.tasks.find(t=>t.id===taskId());
const roster=()=>state.job==='glass'?[]:[state.job,...(state.otherJob&&state.job==='G1'&&isTested()?['UR5']:[])];
const contextLabel=()=>isTested()?'Tested setup':'Paper’s building example';
const neededTeam=()=>!state.job?[]:state.job==='glass'?['H1','H2']:[state.job,'H1'];

function invalidate(){state.requestId++;state.preset=null;state.declarations={};state.data=null;state.pending=false;$('guide-error').hidden=true;$('guide-why').open=false;$('guide-whole-plan').hidden=true;$('guide-whole-plan').replaceChildren();}
function showStep(step,focus=true){
  if(step>1&&(!state.job||!state.forceValid))return;
  state.step=step;
  [1,2,3].forEach(n=>{ $('guide-step-'+n).hidden=n!==step; const b=document.querySelector('[data-guide-step="'+n+'"]'); b.disabled=n>1&&(!state.job||!state.forceValid)||n===3&&!state.data&&!state.pending; if(n===step)b.setAttribute('aria-current','step');else b.removeAttribute('aria-current'); });
  if(step===2){renderTeam();requestAnimationFrame(()=>state.scene?.resize());}
  if(focus){$('guide-step-'+step).querySelector('h1').focus({preventScroll:true});$('view-team').scrollIntoView({block:'start',behavior:'instant'});}
}
function setContext(value){
  if(value===state.context)return;
  invalidate();state.context=value;state.safety='UNKNOWN';state.contact='UNKNOWN';state.otherJob=false;
  if(state.job==='glass'&&isTested())state.job=null;
  renderJobs();renderTeam();showStep(1,false);
}
function selectJob(id){invalidate();state.preset=null;state.job=id;state.contact='UNKNOWN';state.selected=id==='glass'?'H2':id;state.otherJob=false;renderJobs();showStep(1,false);}
function renderJobs(){
  document.querySelectorAll('[data-context]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.context===state.context)));
  $('guide-paper-example').hidden=isTested();
  $('guide-context-note').textContent=isTested()?'Each robot stays in the setting where it was studied.':'The paper’s supplied office example. Choose a task to see its evidence gap, or a manual glass job. This is separate from your own plan under Plan a job.';
  const root=$('guide-jobs');root.replaceChildren();
  (isTested()?['UR3','UR5','G1']:['UR3','UR5','G1','glass']).forEach(id=>{
    const j=jobs[id],button=el('button','guide-job');button.type='button';button.dataset.job=id;button.setAttribute('aria-pressed',String(state.job===id));
    button.innerHTML='<svg viewBox="0 0 190 125" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+icons[id]+'</svg>';
    button.append(el('strong','',isTested()?j.title:j.customer),el('small','',id==='G1'&&!isTested()?'G1 · a physical robot':j.sub));
    if(id==='G1'&&isTested())button.append(el('span','guide-job-tag','SIMULATION'));
    const tick=el('span','guide-card-check','✓');tick.setAttribute('aria-hidden','true');button.append(tick);button.addEventListener('click',()=>selectJob(id));root.append(button);
  });
  renderRequirements();
  $('guide-next').disabled=!state.job||!state.forceValid;
  $('guide-selection-hint').textContent=state.job?'Selected: '+jobTitle():'Choose a card to begin.';
}
const placeNames={tested_contexts:{UR3:'UR3 cell · cube handover point',UR5:'UR5 cell · taped whiteboard',G1:'Simulated wall · spot D'},customer_building:{UR3:'Corridor · supply handover point',UR5:'Meeting room 1 · whiteboard 1',G1:'Corridor · wall spot 1',glass:'Glass partition 1'}};
function requestPlace(){return state.job?placeNames[state.context][state.job]:'';}
function renderRequirements(){
  $('guide-requirements').hidden=!state.job;
  if(!state.job)return;
  $('guide-location').textContent=requestPlace();
  $('guide-task-scope').textContent=state.job==='G1'?(isTested()?'A wipe and final hold at this recorded simulation spot.':'A physical wall wipe in the example building.'):
    state.job==='UR5'?'Find the marked cleaning area. The registered option covers detection.':
    state.job==='UR3'?(isTested()?'Pass a registered cube to a person.':'Pass a cleaning supply to a person.'):'A trained person wipes this glass by hand.';
  $('guide-force-controls').hidden=state.job!=='G1';
  document.querySelectorAll('[data-force-mode]').forEach(b=>b.setAttribute('aria-pressed',String(state.forceMode===b.dataset.forceMode)));
  $('guide-force-min-label').textContent=state.forceMode==='exact'?'Required setting':'At least';
  $('guide-force-max-wrap').hidden=state.forceMode==='exact';
  if(state.job!=='G1'){state.forceValid=true;}else{
    try{state.force=forceRequirement(state.forceMode,$('guide-force-min').value,$('guide-force-max').value);state.forceValid=true;$('guide-force-error').hidden=true;}
    catch(error){state.forceValid=false;$('guide-force-error').textContent=error.message;$('guide-force-error').hidden=false;}
  }
}
function readForce(){
  invalidate();
  try{state.force=forceRequirement(state.forceMode,$('guide-force-min').value,$('guide-force-max').value);state.forceValid=true;$('guide-force-error').hidden=true;}
  catch(error){state.forceValid=false;$('guide-force-error').textContent=error.message;$('guide-force-error').hidden=false;}
  $('guide-next').disabled=!state.job||!state.forceValid;renderRequirements();showStep(1,false);
}
function renderRequestSummary(){
  const root=$('guide-request-summary');root.replaceChildren();
  const label=el('span','guide-kicker','YOUR REQUEST');root.append(label);
  [jobTitle(),requestPlace(),...(state.job==='G1'?[forceLabel(state.force)]:[]),...(state.job==='glass'?[state.people.H1==='BUSY'?'Robot helper busy':'Robot helper free',state.people.H2==='BUSY'?'Glass cleaner busy':'Glass cleaner free']:[state.people.H1==='BUSY'?'Robot helper busy':'Robot helper free'])].forEach(text=>root.append(el('span','guide-summary-item',text)));
}
function renderTeam(){
  $('guide-job-recap').textContent=contextLabel()+' / '+jobTitle();
  $('guide-contact-wrap').hidden=state.job==='UR5';
  document.querySelectorAll('[data-contact]').forEach(b=>b.setAttribute('aria-pressed',String(state.contact===b.dataset.contact)));
  renderTeamPair();
  document.querySelectorAll('[data-availability]').forEach(b=>b.setAttribute('aria-pressed',String(state.people[b.dataset.person]===b.dataset.availability)));
  document.querySelectorAll('[data-area]').forEach(b=>b.setAttribute('aria-pressed',String(state.safety===b.dataset.area)));
  $('guide-other-job-wrap').hidden=state.job!=='G1'||!isTested();$('guide-other-job').checked=state.otherJob;
  const tabs=$('guide-model-tabs');
  if(!tabs.childElementCount)Object.keys(names).forEach(id=>{const b=el('button','',names[id]);b.dataset.member=id;b.setAttribute('aria-label','View '+names[id]);b.addEventListener('click',()=>{state.selected=id;renderTeam();});tabs.append(b);});
  tabs.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(state.selected===b.dataset.member)));
  $('guide-viewing-label').textContent='About '+names[state.selected];
  document.querySelectorAll('.guide-person').forEach(card=>card.dataset.needed=String(neededTeam().includes(card.dataset.person)));
  $('guide-model-description').textContent=descriptions[state.selected];updateScene();
}
function renderTeamPair(){
  const manual=state.job==='glass', ids=neededTeam(), pair=$('guide-team-pair');
  $('guide-team-label').textContent=manual?'ONE PERSON NEEDED':'THIS JOB NEEDS BOTH';
  $('guide-team-intro').textContent=manual?'Either trained person can do this hand wipe.':'The robot and its helper work together.';
  $('guide-helper-role').textContent=manual?'Trained for this hand wipe':'Needed for this robot job';
  $('guide-cleaner-role').textContent=manual?'Trained for this hand wipe':'Not trained to help this robot';
  pair.replaceChildren();
  ids.forEach((id,i)=>{
    if(i)pair.append(el('span','guide-team-join',manual?'or':'+'));
    const card=el('div','guide-needed-member');card.dataset.neededMember=id;
    const graphic=el('span','guide-needed-icon');graphic.setAttribute('aria-hidden','true');
    if(icons[id])graphic.innerHTML='<svg viewBox="0 0 190 125" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">'+icons[id]+'</svg>';
    else graphic.innerHTML='<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><circle cx="24" cy="12" r="6"/><path d="M13 39v-9a11 11 0 0 1 22 0v9M18 32v9m12-9v9"/></svg>';
    const label=el('div');label.append(el('strong','',names[id]));
    const status=id.startsWith('H')?(state.people[id]==='BUSY'?'Busy':state.otherJob&&id==='H1'?'Also needed by UR5':'Free'):id==='G1'&&isTested()?'Simulation':'Robot';
    label.append(el('small','',status));card.dataset.busy=String(state.people[id]==='BUSY');card.append(graphic,label);pair.append(card);
  });
  $('guide-team-note').textContent=manual?'The plan can assign one free person.':state.people.H1==='BUSY'?'The helper is busy. The robot cannot do this job alone.':state.otherJob?'One helper cannot cover both robots in the same round.':'Now check that the helper is free and the area is safe.';
  document.querySelector('.guide-scene-tools>span').textContent=manual?'Highlighted = trained for this hand wipe':'Highlighted together = needed together';
}
function updateScene(){
  if(!state.sceneReady)return;
  const slot=currentTask()?.slot || ((state.job==='UR3'||(state.job==='G1'&&!isTested()))?'slot-2':'slot-1');
  state.scene.setMembers(Object.keys(names).map(id=>{
    let status='excluded';
    if(id.startsWith('H'))status=state.people[id]==='BUSY'?'busy':'available';else if(roster().includes(id))status='available';
    if(state.data){const res=state.data.plan.reservations;if(id.startsWith('H')&&res.people[slot+':'+id])status='booked';if(!id.startsWith('H')&&res.robots.includes(slot+':'+id))status='booked';}
    return {id,status,label:names[id]};
  }));
  state.scene.setTeam(neededTeam(),state.job==='glass'?'CAN HELP':'NEEDED');
  state.scene.setSelected(state.selected);
}
async function initScene(){
  if(state.scene||state.sceneLoading||$('team-stage').hidden)return;
  state.sceneLoading=true;
  try{
    const {TeamScene}=await import('./team-scene.js');
    if(state.scene||$('team-stage').hidden)return;
    state.scene=new TeamScene($('team-stage'),{onSelect:id=>{state.selected=id;$('guide-meet').open=true;renderTeam();},onReady:()=>queueMicrotask(()=>{state.sceneReady=true;$('team-model-loading').hidden=true;state.scene.setTheme(document.documentElement.dataset.theme);updateScene();}),onError:()=>{$('team-model-loading').hidden=true;$('team-model-fallback').hidden=false;}});
  }catch{$('team-model-loading').hidden=true;$('team-model-fallback').hidden=false;}
  finally{state.sceneLoading=false;}
}
function toggleScene(){
  const show=$('team-stage').hidden;
  $('team-stage').hidden=!show;
  $('guide-scene-tools').hidden=!show;
  $('guide-show-3d').setAttribute('aria-expanded',String(show));
  $('guide-show-3d').textContent=show?'Hide 3D team':'Show 3D team';
  if(show)requestAnimationFrame(()=>setTimeout(()=>{if(state.scene)state.scene.resize();else initScene();},0));
}
function payload(){
  return {scenario:state.context,robots:roster(),sharedSafety:state.safety,taskRequirements:{[taskId()]:{...(state.job==='UR5'?{}:{contactPermission:state.contact}),...(state.job==='G1'?{force:{...state.force}}:{})}},peopleAvailability:Object.fromEntries(Object.entries(state.people).map(([id,value])=>[id,{'slot-1':value,'slot-2':value}])),declarations:state.declarations};
}
async function checkPlan(){
  if(!state.forceValid){showStep(1);return;}
  const id=++state.requestId;state.pending=true;state.data=null;$('guide-error').hidden=true;renderResult();showStep(3);
  try{
    const response=await fetch('/api/job',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload()),cache:'no-store'});
    const data=await response.json();if(id!==state.requestId)return;
    if(!response.ok)throw new Error(data.error||'The planner could not check this example.');
    if(!data.plan?.tasks.some(t=>t.id===taskId()))throw new Error('The selected job was missing from the answer.');
    if(typeof data.exportText!=='string')throw new Error('The service did not provide the exact plan text. Reload the matching app release.');
    state.data=data;state.pending=false;renderResult();showStep(3,false);updateScene();
  }catch(error){
    if(id!==state.requestId)return;
    state.pending=false;state.data=null;renderResult();$('guide-error').textContent='No answer is available. '+error.message;$('guide-error').hidden=false;
  }
}
function button(text,handler,cls='guide-primary'){const b=el('button',cls,text);b.addEventListener('click',handler);return b;}
function taskWords(task){
  switch(task.state){
    case 'PENDING_CHOICE':return ['↔','Pick how hard to press','Both 7 N and 8 N were tested at this wall spot. Choose one.','warn'];
    case 'PENDING_CONFIRMATION':return ['✓?','Needs an OK','The helper is available. This task still needs their confirmation.','warn'];
    case 'RECOMMENDED':return ['✓','Fits this example',task.robot.platform==='UR5'?'UR5 can find the taped area. The robot helper must start it and watch.':task.robot.platform==='UR3'?'UR3 can pass the registered cube with the robot helper.':'G1 can do this wipe in the tested simulation with the robot helper.','good'];
    case 'MANUAL_ASSIGNED':return ['♙','A person can do it',names[task.person]+' is free and trained to clean this glass by hand.','good'];
    case 'WAITING_FOR_PERSON':{
      if(task.route==='manual')return ['◷','A cleaner needs to be free','Both trained people are busy. This hand wipe has to wait.','warn'];
      const booking=state.data.plan.reservations.people[task.slot+':H1'];
      return ['◷','The robot helper is busy',booking?'The helper is booked for the UR5 job. The glass cleaner cannot take over a robot job.':'The glass cleaner cannot cover a robot job. They have different training.','warn'];
    }
    case 'BLOCKED_EVIDENCE':return ['⌂',isTested()?'No tested option fits':'No matching evidence',isTested()?'No recorded setting at this place meets your request. Change the request or add suitable evidence after review.':'The robot’s existing tests do not cover this job in the new building.','warn'];
    case 'WITHHELD_SHARED':return ['?','Check the area first','The area checks must pass before anyone can be assigned.','warn'];
    case 'BLOCKED_SHARED':return ['⊘','Stop: the area is unsafe','No person or robot can be assigned while the area is marked unsafe.','bad'];
    case 'BLOCKED_TASK_CONDITION':return ['⊘','Work here is not allowed','The location safety or permission check did not pass. No one can be assigned here.','bad'];
    case 'WITHHELD_TASK_CONDITION':return ['?','Check permission for this place','The plan needs the location safety and touch-permission checks before assigning anyone.','warn'];
    case 'WAITING':return ['◷','The robot is busy','This task has to wait for the robot. The app does not reschedule it.','warn'];
    case 'CONDITIONAL_ON_INPUT':return ['◷','An earlier job comes first','This job needs something from an earlier task. A plan does not mean that task has finished.','warn'];
    case 'BLOCKED_INPUT':return ['!','An earlier job needs help','The earlier task cannot yet provide what this job needs.','warn'];
    case 'BLOCKED_NOT_IN_TEAM':return ['?','The robot is not on this team','Add the required robot before checking the job again.','warn'];
    default:return task.state.startsWith('BLOCKED')?['⊘','A check did not pass','This job cannot be assigned. See the reason below.','bad']:['?','We need another check','Some information is still missing. See the reason below.','warn'];
  }
}
function renderResult(){
  renderPresetNote();
  $('guide-answer-recap').textContent=contextLabel()+' / '+jobTitle();
  renderRequestSummary();
  const root=$('guide-result');root.replaceChildren();root.setAttribute('aria-busy',String(state.pending));$('guide-why').hidden=!state.data;
  $('guide-whole-plan').hidden=!state.data;$('guide-whole-plan').replaceChildren();
  if(state.pending){root.dataset.tone='';root.append(el('div','guide-result-symbol','…'),el('h2','','Checking your example…'),el('p','','Looking at the job, the people and the recorded tests.'));return;}
  const task=currentTask();
  if(!task){root.dataset.tone='warn';root.append(el('div','guide-result-symbol','?'),el('h2','','Could not check this plan'),button('Try the check again',checkPlan));return;}
  const [symbol,title,text,tone]=taskWords(task);root.dataset.tone=tone;root.dataset.state=task.state;
  root.append(el('div','guide-result-symbol',symbol),el('h2','',title),el('p','',text));
  const chips=el('div','guide-result-chips');
  if(task.robot)chips.append(el('span','',task.robot.platform+(task.robot.setpoint_n?' · '+task.robot.setpoint_n+' N':'')));
  if(task.person)chips.append(el('span','',names[task.person]));
  if(state.job==='G1'&&isTested())chips.append(el('span','','Simulation · spot D'));
  if(chips.childNodes.length)root.append(chips);
  const actions=el('div','guide-actions');
  (state.data.availableActions||[]).filter(a=>a.taskId===task.id).forEach(action=>{
    const isChoice=action.kind==='choice';
    const b=button(isChoice?'':'Give example OK',()=>{
      if(state.pending)return;
      state.declarations={...state.declarations,[action.taskId]:structuredClone(action.declaration)};checkPlan();
    },isChoice?'guide-force':'guide-primary');
    if(isChoice){b.append(el('strong','',action.label.replace(/^Choose /,'')),el('small','','Tested setting'));b.setAttribute('aria-label',action.label);}
    actions.append(b);
  });
  if(task.state==='WAITING_FOR_PERSON')actions.append(button('Change availability',()=>showStep(2)));
  if(['WITHHELD_SHARED','BLOCKED_SHARED','WITHHELD_TASK_CONDITION','BLOCKED_TASK_CONDITION'].includes(task.state))actions.append(button('Review the area',()=>{showStep(2);document.querySelector('[data-area="UNKNOWN"]').focus();}));
  if(task.state==='BLOCKED_EVIDENCE')actions.append(button(isTested()?'Change the request':'Compare with the tested setup',()=>isTested()?showStep(1):setContext('tested_contexts')));
  root.append(actions);
  const note=task.state==='MANUAL_ASSIGNED'?'This hand wipe does not control the pushing force.':task.state==='PENDING_CHOICE'?'Neither setting was shown to clean better. The helper must also be free.':task.state==='PENDING_CONFIRMATION'?'A practice click only. It does not start a robot.':'Plan only. Nothing starts.';
  root.append(el('p','guide-result-note',note));
  renderExplanation(task);
  renderWholePlan();
}
function renderWholePlan(){
  const root=$('guide-whole-plan');root.replaceChildren();root.hidden=!state.data;
  if(!state.data)return;
  root.append(el('h2','','All jobs in this example'),el('p','','The full saved plan is below. These stages show order, with no measured duration. The robot studies were carried out separately.'));
  const words=testedPlanWords;
  const slots=[...new Set(state.data.plan.tasks.map(t=>t.slot))];
  slots.forEach((slot,index)=>{
    const group=el('section','customer-plan-stage');group.append(el('h2','','Stage '+(index+1)));
    state.data.plan.tasks.filter(t=>t.slot===slot).forEach(task=>{
      const [reason,next,tone]=words[task.state]||['This task needs review','Review the task, its conditions and supporting evidence before proceeding.','waiting'];
      const row=el('article','customer-result-row');row.dataset.state=task.state;row.dataset.tone=tone;
      const display=testedTaskDisplay(task,state.data.scenario);
      const head=el('div','customer-result-top');head.append(el('h3','',display.title),el('span','customer-result-badge',reason));row.append(head);
      if(display.requirement)row.append(el('p','customer-result-place',display.requirement));
      const assignments=[task.robot?.platform,task.person?(names[task.person]||task.person):null].filter(Boolean);
      row.append(el('p','customer-result-reason',assignments.length?'Planned team: '+assignments.join(' + '):reason));
      const instruction=el('p','customer-next-action');instruction.append(el('strong','','Next: '),document.createTextNode(next));row.append(instruction);
      const actions=el('div','guide-actions');
      (state.data.availableActions||[]).filter(a=>a.taskId===task.id).forEach(action=>actions.append(button(action.kind==='choice'?action.label:'Give example OK',()=>{
        if(state.pending)return;state.declarations={...state.declarations,[action.taskId]:structuredClone(action.declaration)};checkPlan();
      },'guide-secondary')));
      if(actions.childElementCount)row.append(actions);
      group.append(row);
    });root.append(group);
  });
  if(state.data.exportText){const nav=el('div','customer-navigation');nav.append(planPdfButton(()=>testedPlanReport(state.data),'fieldwork-tested-plan.pdf',{label:'Download whole plan PDF',className:'guide-primary'}));root.append(nav, researchDownload(state.data,'fieldwork-tested-plan.json'));}
}
function researchDownload(data,filename){
  const box=el('details');box.append(el('summary','','Research export (JSON)'),el('p','customer-footnote','Exact planning data for research and replay. Use the PDF for a readable copy.'),button('Download research JSON',()=>planDownload(data.exportText,filename),'customer-button'));return box;
}
async function showPaperPlan(){
  const root=$('guide-paper-results'),control=$('guide-paper-load');control.disabled=true;root.replaceChildren(el('p','','Checking the saved plan…'));
  try{
    const response=await fetch('/api/job',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scenario:'customer_building'}),cache:'no-store'});
    const data=await response.json();if(!response.ok)throw new Error(data.error||'The saved plan is not available.');
    if(!Array.isArray(data.plan?.tasks)||typeof data.exportText!=='string')throw new Error('The saved plan response is incomplete.');
    root.replaceChildren();
    const counts={};data.plan.tasks.forEach(task=>counts[task.state]=(counts[task.state]||0)+1);
    root.append(el('p','customer-capacity',data.plan.tasks.length+' jobs: '+(counts.MANUAL_ASSIGNED||0)+' assigned to people; '+(data.plan.tasks.length-(counts.MANUAL_ASSIGNED||0))+' need evidence or an earlier result.'));
    root.append(el('p','customer-footnote','The manual glass wipes are permitted alternatives. They do not fulfil the original requests for force-regulated wiping. Nothing is dispatched.'));
    const reasons={MANUAL_ASSIGNED:'Person assigned',BLOCKED_EVIDENCE:'Robot evidence missing',BLOCKED_INPUT:'Earlier result missing',CONDITIONAL_ON_INPUT:'Waiting for an earlier result',WAITING_FOR_PERSON:'Person needed'};
    data.plan.tasks.forEach(task=>{
      const row=el('article','customer-result-row');row.dataset.state=task.state;row.dataset.tone=task.state==='MANUAL_ASSIGNED'?'good':'waiting';
      row.append(el('h3','',testedTaskDisplay(task,data.scenario).title),el('p','customer-result-reason',(reasons[task.state]||'This task needs review')+(task.person?' · '+(names[task.person]||task.person):'')));
      root.append(row);
    });
    root.append(planPdfButton(()=>testedPlanReport(data,{original:true}),'fieldwork-paper-building-plan.pdf',{label:'Download original plan PDF'}),researchDownload(data,'fieldwork-paper-building-plan.json'));
  }catch(error){root.replaceChildren(el('p','error-panel',error.message));}
  finally{control.disabled=false;}
}
function renderExplanation(task){
  const d=$('guide-explanation');d.replaceChildren();
  if(task.state==='BLOCKED_EVIDENCE')d.append(el('p','','Next: check the requested place, task and settings against the records. A free helper cannot fill a missing test. A range can admit a tested setting inside it; it does not make every value in the range tested.'));
  if(task.state==='PENDING_CONFIRMATION')d.append(el('p','','Being free is different from giving permission. The button adds a pretend confirmation for this exact example. It is not a recognised hand gesture or a real safety approval.'));
  if(task.state==='WITHHELD_SHARED'||task.state==='BLOCKED_SHARED')d.append(el('p','','The area condition here is a pretend input. This app cannot inspect a real workplace. In real work, the responsible person must assess and resolve the conditions.'));
  if(task.state==='WAITING_FOR_PERSON')d.append(el('p','','People keep the skills declared in this example. The robot helper can support all three robots and clean glass or whiteboards. The glass cleaner is trained only for glass. Each can take one job per planning round.'));
  if(state.job==='G1')d.append(el('p','','The G1 records cover a robot held at its pelvis in simulation. This tested example uses wall spot D. The records contain right-pad settings of 7 and 8 N, with 7 N on the left. They show a wipe and final hold, not dirt removal or real G1 performance.'));
  if(state.job==='UR5')d.append(el('p','','This registered option covers finding the taped whiteboard region. It does not qualify a complete force-controlled cleaning job. A trained attendant starts the program and watches.'));
  if(state.job==='UR3')d.append(el('p','','The recorded task is registered-cube handover in the UR3 setup. The new-building request concerns cleaning supplies; those are not automatically covered by the cube test.'));
  if(['WITHHELD_TASK_CONDITION','BLOCKED_TASK_CONDITION'].includes(task.state))d.append(el('p','','The location permission is a pretend input in this example. It cannot override an unsafe area or supply missing robot evidence.'));
  d.append(el('p','','You are viewing one task from a saved example plan. Other conditions in that example are assumed to pass. The three robot cases were studied separately. The planning rounds have no measured duration.'));
  d.append(el('p','','Planner answer: '+taskWords(task)[1]+'.'));
  const full=el('details');full.append(el('summary','','Other jobs in this saved example'));
  state.data.plan.tasks.filter(t=>t.id!==task.id).forEach(t=>{const display=testedTaskDisplay(t,state.data.scenario);full.append(el('p','',display.title+(display.requirement?' ('+display.requirement+')':'')+' — '+taskWords(t)[1]));});d.append(full);
}
async function credits(){
  try{const response=await fetch('/models/credits.json');const value=await response.json();const models=Array.isArray(value)?value:value.models;const root=$('team-model-credits');
    for(const m of models||[]){const p=el('p','guide-credit',(m.name||m.id||'Model')+' · '+(m.credit||'')+' · '+(m.license||''));if(m.url){const a=el('a','',' Source');a.href=m.url;a.target='_blank';a.rel='noopener noreferrer';p.append(a);}root.append(p);}
  }catch{$('team-model-credits').textContent='Model licences and sources are supplied in the app’s models folder.';}
}
const presets={
  g1_helper_free:{title:'G1 simulation wipe · helper free',note:'This is the recorded simulation setting, with the robot held at its pelvis. The conditions are invented: checks passed, work allowed, helper free, exactly 7 N. The plan asks for the helper’s OK. Press “Give example OK” to see the next state.',people:{H1:'AVAILABLE',H2:'AVAILABLE'}},
  g1_helper_busy:{title:'G1 simulation wipe · helper busy',note:'The same simulation request with the robot helper busy. The robot cannot be planned alone, and the glass cleaner does not hold the robot role.',people:{H1:'BUSY',H2:'AVAILABLE'}}
};
function applyPreset(id){
  const preset=presets[id];if(!preset)return;
  invalidate();state.context='tested_contexts';state.job='G1';state.selected='G1';state.otherJob=false;
  state.people={...preset.people};state.safety='PASS';state.contact='PASS';state.forceMode='exact';
  $('guide-force-min').value=7;$('guide-force-max').value=7;state.force={min:7,max:7};state.forceValid=true;state.preset=id;
  renderJobs();renderTeam();checkPlan();
}
function renderPresetNote(){
  const note=$('guide-preset-note');if(!note)return;
  const preset=presets[state.preset];note.hidden=!preset;note.replaceChildren();
  if(preset)note.append(el('span','guide-kicker','EXAMPLE · INVENTED CONDITIONS'),el('strong','',preset.title),el('p','',preset.note));
}
function init(){
  if(state.started)return;state.started=true;
  document.querySelectorAll('[data-tested-preset]').forEach(b=>b.addEventListener('click',()=>applyPreset(b.dataset.testedPreset)));
  document.addEventListener('fieldwork:tested-preset',e=>{document.dispatchEvent(new CustomEvent('fieldwork:open-tested'));applyPreset(e.detail);});
  document.querySelectorAll('[data-context]').forEach(b=>b.addEventListener('click',()=>setContext(b.dataset.context)));
  document.querySelectorAll('[data-guide-step]').forEach(b=>b.addEventListener('click',()=>showStep(Number(b.dataset.guideStep))));
  document.querySelectorAll('[data-back]').forEach(b=>b.addEventListener('click',()=>showStep(Number(b.dataset.back))));
  document.querySelectorAll('[data-availability]').forEach(b=>b.addEventListener('click',()=>{invalidate();state.people[b.dataset.person]=b.dataset.availability;state.selected=b.dataset.person;renderTeam();showStep(2,false);}));
  document.querySelectorAll('[data-area]').forEach(b=>b.addEventListener('click',()=>{invalidate();state.safety=b.dataset.area;renderTeam();showStep(2,false);}));
  document.querySelectorAll('[data-contact]').forEach(b=>b.addEventListener('click',()=>{invalidate();state.contact=b.dataset.contact;renderTeam();showStep(2,false);}));
  document.querySelectorAll('[data-force-mode]').forEach(b=>b.addEventListener('click',()=>{state.forceMode=b.dataset.forceMode;readForce();}));
  document.querySelectorAll('[data-force-preset]').forEach(b=>b.addEventListener('click',()=>{const preset=b.dataset.forcePreset;state.forceMode=preset==='6-8'?'range':'exact';$('guide-force-min').value=preset==='6-8'?6:preset;$('guide-force-max').value=preset==='6-8'?8:preset;readForce();}));
  ['guide-force-min','guide-force-max'].forEach(id=>$(id).addEventListener('input',readForce));
  $('guide-other-job').addEventListener('change',()=>{invalidate();state.otherJob=$('guide-other-job').checked;renderTeam();showStep(2,false);});
  $('guide-next').addEventListener('click',()=>showStep(2));$('guide-check').addEventListener('click',checkPlan);
  $('guide-show-3d').addEventListener('click',toggleScene);
  $('guide-paper-load').addEventListener('click',showPaperPlan);
  $('guide-again').addEventListener('click',()=>{invalidate();state.job=null;state.otherJob=false;renderJobs();showStep(1);});
  $('guide-home').addEventListener('click',e=>{e.preventDefault();showStep(1);});
  renderJobs();renderTeam();showStep(1,false);credits();
}
init();
document.addEventListener('fieldwork:theme',e=>state.scene?.setTheme(e.detail));
document.addEventListener('fieldwork:view',e=>{if(e.detail==='team')requestAnimationFrame(()=>state.scene?.resize());});
