'use strict';

const byId = id => document.getElementById(id);
const make = (tag, cls, text) => {const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el;};
const allChecks=['sharedSafety','visibility','path','contact','platformSafety','localSafety','validInput'];
const prettySites={A:'y −80, z +20 mm',B:'y +80, z 0 mm',C:'y −80, z 0 mm',D:'y 0, z +80 mm',E:'y 0, z 0 mm',F:'y 0, z −80 mm'};
const local={scene:null,sceneReady:false,data:null,pending:true,playing:false,pinned:null,tour:-1,traces:null,chartSite:'B',sample:0,chartScale:null,initialized:false};
const fw=()=>window.Fieldwork;
function action(text,callback,cls='button primary'){const b=make('button',cls,text);b.type='button';b.addEventListener('click',callback);return b;}
function stopPreview(){local.playing=false;local.scene?.setPlaying(false);byId('preview-play').textContent='▶';byId('preview-play').setAttribute('aria-label','Play illustrative sequence');}
function sceneFailure(message){local.sceneReady=false;local.scene=null;byId('scene-loading').hidden=true;byId('scene-fallback').hidden=false;byId('preview-play').disabled=true;byId('preview-scrub').disabled=true;byId('preview-phase-note').textContent='3D preview unavailable';console.warn('3D preview unavailable:',message);}
async function loadScene(){
  try{
    const {PlanningScene}=await import('./scene.js');
    local.scene=new PlanningScene(byId('scene-stage'),{
      onSelectTarget:site=>{stopPreview();fw().update({target:site});},
      onReady:()=>{local.sceneReady=true;byId('scene-loading').hidden=true;if(local.data)updateScene(local.data);},
      onError:error=>sceneFailure(String(error))
    });
    if(local.data)updateScene(local.data);
  }catch(error){sceneFailure(error.message);}
}
function updateScene(data){
  const i=data.inputs;
  const selectedForce=data.result.configuration?.force_setpoint_n;
  const exact=i.force?.min===i.force?.max;
  const force=selectedForce??(exact?i.force?.min:null);
  const forceLabel=force==null&&i.force?i.force.min+'–'+i.force.max+' N accepted range':undefined;
  if(local.sceneReady){local.scene.setRobot(i.robot);local.scene.setTarget(i.target||'B');local.scene.setForce(force,forceLabel);local.scene.setDecision(data.result.decision);}
  const names={G1:'G1 / pelvis-supported wall',UR3:'UR3 / registered-cube handover',UR5:'UR5 / taped-region detection'};
  byId('scene-caption-title').textContent=names[i.robot];
  byId('scene-caption-scope').textContent='Illustrative geometry and camera · no robot connection';
  byId('scene-fallback').querySelector('img').src='/assets/'+(i.robot==='UR3'?'ur3-case.png':'g1-case.png');
  byId('scene-fallback').querySelector('img').hidden=i.robot==='UR5';
  const unavailable=data.result.decision!=='SELECT'||(i.robot==='G1'&&(!'ABCD'.includes(i.target)||![7,8].includes(force)));
  byId('preview-play').disabled=unavailable||!local.sceneReady||local.pending;
  byId('preview-scrub').disabled=unavailable||!local.sceneReady||local.pending;
  if(unavailable){stopPreview();if(local.sceneReady)local.scene.setProgress(0);byId('preview-scrub').value=0;byId('preview-phase').textContent='Preview waits for a selected option';byId('preview-phase-note').textContent='Resolve the request and any confirmation first';}
  else if(!local.playing){byId('preview-phase').textContent='Illustrative sequence';byId('preview-phase-note').textContent='Play to explore the workflow';}
}
function render(data){
  local.data=data;const i=data.inputs,r=data.result;
  const history=byId('studio-history');history.hidden=!data.historicalAdmission;history.replaceChildren();
  if(data.historicalAdmission)history.append(make('strong','','Earlier test admission'),make('p','',data.historicalAdmission.explanation),make('p','',data.historicalAdmission.distinction));
  document.querySelectorAll('[data-studio-robot]').forEach(b=>{const active=b.dataset.studioRobot===i.robot;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});
  document.querySelectorAll('[data-studio-target]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.studioTarget===i.target)));
  byId('studio-g1-controls').hidden=i.robot!=='G1';byId('studio-arm-scope').hidden=i.robot==='G1';
  byId('studio-arm-scope').textContent=i.robot==='UR3'?'The registered capability is cube handover in the published cell. An operator gives the command and confirmation. The illustrative scene is not a replay of a trial.':'The catalogue supports target detection in the documented whiteboard context. An attendant starts the program and watches. This profile does not qualify force-regulated wiping.';
  if(i.robot==='G1'){
    byId('studio-target-note').textContent=i.target+' · '+prettySites[i.target];
    const range=i.force.min!==i.force.max;byId('studio-range').checked=range;byId('studio-force').disabled=range;
    byId('studio-force').value=i.force.min;byId('studio-force-value').replaceChildren(document.createTextNode(range?i.force.min+'–'+i.force.max:String(i.force.min)),make('small','','N'));
    if('ABCD'.includes(i.target)&&local.chartSite!==i.target){local.chartSite=i.target;drawChart();}
  }
  const assumed=allChecks.every(k=>i[k]==='PASS')&&i.availability==='AVAILABLE';
  byId('studio-assumptions').textContent=assumed?'Example conditions: all checks are assumed passing and the robot is available. These are entered assumptions.':allChecks.every(k=>i[k]==='UNKNOWN')?'Current checks are unknown. Load an example to try invented passing conditions.':'Custom demonstration conditions. The current checks are entered assumptions, not sensor measurements.';
  [['studio-occluded',i.visibility==='FAIL'],['studio-hazard',i.sharedSafety==='FAIL'],['studio-busy',i.availability==='BUSY']].forEach(([id,active])=>byId(id).setAttribute('aria-pressed',String(active)));
  const box=byId('studio-result');box.className='studio-result'+(r.decision==='SELECT'?' selected':r.decision==='REFUSE'?' refused':r.decision==='WAIT'?' waiting':'');
  byId('studio-code').textContent=r.decision;byId('studio-result-title').textContent=byId('decision-title').textContent;byId('studio-explanation').textContent=byId('decision-explanation').textContent;
  const actions=byId('studio-actions');actions.replaceChildren();
  if(r.decision==='ASK')r.remaining.forEach(id=>{const p=data.profiles.find(p=>p.id===id);actions.append(action('Choose '+p.force_setpoint_n+' N',()=>fw().choose(id),'button subtle'));});
  if(r.decision==='CONFIRM')actions.append(action('Confirm this example →',()=>fw().confirm()));
  if(['ASK','CONFIRM','SELECT'].includes(r.decision))actions.append(make('p','studio-confirm-note','Browser declaration only; it does not start a robot.'));
  renderRoute(data);renderPinned();updateScene(data);setPending(local.pending);
}
function setPending(value){local.pending=value;byId('studio-result').classList.toggle('pending',value);byId('studio-result').setAttribute('aria-busy',String(value));byId('studio-actions').querySelectorAll('button').forEach(b=>b.disabled=value);byId('studio-pin').disabled=value||!local.data;if(value){stopPreview();byId('preview-play').disabled=true;byId('preview-scrub').disabled=true;}else if(local.data)updateScene(local.data);}
function invalidateDecision(message){local.data=null;byId('studio-history').hidden=true;stopPreview();if(local.sceneReady){local.scene.setDecision(null);local.scene.setProgress(0);}byId('studio-code').textContent='NO CURRENT RESULT';byId('studio-result-title').textContent='The request could not be evaluated.';byId('studio-explanation').textContent=message;byId('studio-result').className='studio-result';byId('studio-actions').replaceChildren();byId('studio-route').replaceChildren(make('p','','Correct the request or restore the planner connection.'));byId('studio-pin').disabled=true;byId('pinned-panel').hidden=true;byId('preview-play').disabled=true;byId('preview-scrub').disabled=true;byId('preview-scrub').value=0;byId('preview-phase').textContent='No current decision';byId('preview-phase-note').textContent='Preview is paused until a new result is available';}
function renderRoute(data){
  const r=data.result,i=data.inputs,n=data.profiles.length-Object.keys(r.not_applicable).length;
  const reasons=Object.values(r.candidate_reasons),failed=reasons.some(x=>x.failed.length)||i.sharedSafety==='FAIL',unknown=i.sharedSafety!=='PASS'||reasons.some(x=>x.unresolved.length)||!n;
  const roles=[...new Set(Object.values(data.humanRoles).flatMap(x=>x.roles))].join(', ');
  const rows=[['Task match',n?n+' applicable profile'+(n===1?'':'s'):'No profile covers this request',n?'pass':'unknown'],['Conditions',failed?'A required check failed':unknown?'Information is missing':'Checks assumed passing',failed?'failed':unknown?'unknown':'pass'],['Human role',roles+' · requires booking in job planner','unknown'],['Decision',r.decision,r.decision==='SELECT'?'pass':r.decision==='REFUSE'?'failed':'unknown']];
  const root=byId('studio-route');root.replaceChildren();rows.forEach(([title,text,status],idx)=>{const el=make('div','route-step '+status);el.append(make('i','',status==='pass'?'✓':status==='failed'?'×':String(idx+1)),make('strong','',title),make('p','',text));root.append(el);});
}
function snapshot(data){return {inputs:structuredClone(data.inputs),decision:data.result.decision,explanation:byId('decision-explanation').textContent};}
function renderPinned(){
  byId('pinned-panel').hidden=!local.pinned;if(!local.pinned||!local.data)return;
  const root=byId('pinned-comparison');root.replaceChildren();
  [['PINNED REQUEST',local.pinned],['CURRENT REQUEST',snapshot(local.data)]].forEach(([label,s])=>{const el=make('div');const i=s.inputs;el.append(make('span','small-label',label),make('strong','',i.robot+(i.target?' · '+i.target:'')+(i.force?' · '+(i.force.min===i.force.max?i.force.min:i.force.min+'–'+i.force.max)+' N':'')),make('b','',s.decision),make('p','',s.explanation));root.append(el);});
}
function selectRobot(robot){stopPreview();fw().preset(robot==='G1'?'g1_7':robot.toLowerCase());}
function condition(id,key,on,off){byId(id).addEventListener('click',()=>{stopPreview();const active=byId(id).getAttribute('aria-pressed')==='true';fw().update({[key]:active?off:on});});}
function discover(which){stopPreview();const presets={force:'g1_gap',physical:'g1_physical',choice:'g1_range'};if(which==='hidden'){fw().preset('g1_7');fw().update({target:'E'});}else fw().preset(presets[which]);byId('view-studio').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});}
const tourSteps=[
  {title:'Start with a task we have evidence for.',text:'Location B has a recorded 7 N wipe. This example uses invented passing checks. The rule asks for confirmation; the browser does not move a robot.',load:()=>fw().preset('g1_7')},
  {title:'Change only the force request.',text:'Exactly 7.5 N is now withheld. Passing 7 N and 8 N records do not establish every setting between them. The plotted traces below remain those two recorded runs.',load:()=>fw().preset('g1_gap')},
  {title:'Let the owner accept a range.',text:'A 6–8 N requirement admits two recorded settings. Choose one, then confirm it. The framework does not rank their cleaning performance.',load:()=>fw().preset('g1_range')},
  {title:'Ask why a location has no record.',text:'At E, the earlier admission process found that the target was hidden and refused wiping. The deployment rule withholds because there is no qualified E profile. Those are two different questions.',load:()=>{fw().preset('g1_7');fw().update({target:'E'});}}
];
function showTour(index){local.tour=index;byId('tour-card').hidden=index<0;if(index<0)return;stopPreview();const step=tourSteps[index];byId('tour-step').textContent='GUIDED TOUR / '+(index+1)+' OF '+tourSteps.length;byId('tour-title').textContent=step.title;byId('tour-text').textContent=step.text;byId('tour-next').textContent=index===tourSteps.length-1?'Finish ✓':'Next →';step.load();}
const svgNS='http://www.w3.org/2000/svg';
function svgEl(tag,attributes,text){const el=document.createElementNS(svgNS,tag);Object.entries(attributes).forEach(([k,v])=>el.setAttribute(k,String(v)));if(text!==undefined)el.textContent=text;return el;}
function drawChart(){
  if(!local.traces)return;const records=local.traces.sites[local.chartSite],a=records['7'],b=records['8'];const svg=byId('force-svg');svg.replaceChildren();
  const min=Math.floor((Math.min(a.statistics.minimumN,b.statistics.minimumN)-.12)*4)/4,max=Math.ceil((Math.max(a.statistics.maximumN,b.statistics.maximumN)+.12)*4)/4;
  const x=t=>48+t/3.995*692,y=n=>202-(n-min)/(max-min)*178;local.chartScale={x,y,min,max};
  for(let v=min;v<=max+.01;v+=.25){svg.append(svgEl('line',{x1:48,x2:740,y1:y(v),y2:y(v),stroke:'#eaf0e1','stroke-width':1}));svg.append(svgEl('text',{x:37,y:y(v)+3,'text-anchor':'end',fill:'#9aab89','font-size':10,'font-family':'system-ui'},v.toFixed(2)));}
  [0,1,2,3,3.995].forEach(t=>svg.append(svgEl('text',{x:x(t),y:225,'text-anchor':'middle',fill:'#9aab89','font-size':10,'font-family':'system-ui'},t===3.995?'4 s':t+' s')));
  svg.append(svgEl('text',{x:19,y:13,fill:'#8ea17b','font-size':10,'font-family':'system-ui'},'N'));
  [['7','#5d976c'],['8','#c29c56']].forEach(([key,color])=>{const rec=records[key];svg.append(svgEl('line',{x1:48,x2:740,y1:y(rec.targetN),y2:y(rec.targetN),stroke:color,'stroke-width':1,'stroke-dasharray':'4 5',opacity:.45}));const path=rec.rightNormalForceN.map((v,i)=>(i?'L':'M')+x(rec.timeFromFirstSampleS[i]).toFixed(2)+','+y(v).toFixed(2)).join(' ');svg.append(svgEl('path',{d:path,fill:'none',stroke:color,'stroke-width':1.5,'vector-effect':'non-scaling-stroke'}));});
  svg.append(svgEl('line',{id:'chart-cursor',x1:x(0),x2:x(0),y1:19,y2:203,stroke:'#718263','stroke-width':1,'stroke-dasharray':'2 3'}));
  ['7','8'].forEach((key,j)=>svg.append(svgEl('circle',{id:'chart-dot-'+key,cx:x(0),cy:y(records[key].rightNormalForceN[0]),r:3.2,fill:j?'#c29c56':'#5d976c',stroke:'white','stroke-width':1.5})));
  document.querySelectorAll('[data-chart-site]').forEach(el=>{const active=el.dataset.chartSite===local.chartSite;el.classList.toggle('active',active);el.setAttribute('aria-pressed',String(active));});
  const stats=byId('trace-statistics');stats.replaceChildren();[['7','7 N run'],['8','8 N run']].forEach(([key,label])=>{const el=make('div');el.append(make('span','',label+' · force RMSE'),make('strong','',records[key].statistics.rmseN.toFixed(3)+' N'));stats.append(el);});
  byId('trace-note').textContent='Location '+local.chartSite+'. 800 saved samples per trace, without smoothing. Only the 4 s scored window is shown, not the complete wipe or final hold.'+(local.chartSite==='A'?' A was the earlier fix-development location, 20 mm from C.':'');
  updateSample(local.sample,false);
}
function updateSample(index,tooltip){
  if(!local.traces||!local.chartScale)return;local.sample=Math.max(0,Math.min(799,Math.round(index)));byId('chart-scrub').value=local.sample;
  const a=local.traces.sites[local.chartSite]['7'],b=local.traces.sites[local.chartSite]['8'],t=a.timeFromFirstSampleS[local.sample],x=local.chartScale.x(t);
  byId('chart-cursor')?.setAttribute('x1',x);byId('chart-cursor')?.setAttribute('x2',x);
  [['7',a],['8',b]].forEach(([key,r])=>{byId('chart-dot-'+key)?.setAttribute('cx',x);byId('chart-dot-'+key)?.setAttribute('cy',local.chartScale.y(r.rightNormalForceN[local.sample]));});
  const text='t '+t.toFixed(3)+' s  ·  7 N run: '+a.rightNormalForceN[local.sample].toFixed(3)+' N  ·  8 N run: '+b.rightNormalForceN[local.sample].toFixed(3)+' N';
  byId('chart-readout').textContent=text;byId('chart-tooltip').textContent=text;byId('chart-tooltip').hidden=!tooltip;
}
async function loadTraces(){try{const r=await fetch('/assets/force-traces.json');if(!r.ok)throw new Error('Force records could not be loaded.');local.traces=await r.json();drawChart();}catch(error){byId('chart-readout').textContent=error.message;}}
function init(){
  if(local.initialized||!fw())return;local.initialized=true;
  document.querySelectorAll('[data-studio-robot]').forEach(b=>b.addEventListener('click',()=>selectRobot(b.dataset.studioRobot)));
  document.querySelectorAll('[data-studio-target]').forEach(b=>b.addEventListener('click',()=>{stopPreview();fw().update({target:b.dataset.studioTarget});}));
  byId('studio-force').addEventListener('input',()=>{stopPreview();const n=Number(byId('studio-force').value);fw().update({force:{min:n,max:n}});});
  byId('studio-range').addEventListener('change',()=>{stopPreview();const n=Number(byId('studio-force').value);fw().update({force:byId('studio-range').checked?{min:6,max:8}:{min:n,max:n}});});
  condition('studio-occluded','visibility','FAIL','PASS');condition('studio-hazard','sharedSafety','FAIL','PASS');condition('studio-busy','availability','BUSY','AVAILABLE');
  byId('studio-unknown').addEventListener('click',()=>{stopPreview();fw().update({...Object.fromEntries(allChecks.map(k=>[k,'UNKNOWN'])),availability:'UNKNOWN'});});
  byId('studio-reset').addEventListener('click',()=>selectRobot(local.data?.inputs.robot||'G1'));
  byId('studio-details').addEventListener('click',()=>fw().view('planner'));
  byId('studio-pin').addEventListener('click',()=>{if(!local.data||local.pending)return;local.pinned=snapshot(local.data);renderPinned();fw().toast('Pinned this request. Change a setting to compare the decisions.');});
  byId('clear-pin').addEventListener('click',()=>{local.pinned=null;renderPinned();});
  document.querySelectorAll('[data-camera]').forEach(b=>b.addEventListener('click',()=>{local.scene?.setCamera(b.dataset.camera);document.querySelectorAll('[data-camera]').forEach(x=>x.classList.toggle('active',x===b));}));
  document.querySelectorAll('[data-layer]').forEach(b=>b.addEventListener('click',()=>{const on=b.getAttribute('aria-pressed')!=='true';b.setAttribute('aria-pressed',String(on));local.scene?.setLayer(b.dataset.layer,on);}));
  byId('preview-play').addEventListener('click',()=>{local.playing=!local.playing;local.scene?.setPlaying(local.playing);byId('preview-play').textContent=local.playing?'Ⅱ':'▶';byId('preview-play').setAttribute('aria-label',local.playing?'Pause illustrative sequence':'Play illustrative sequence');});
  byId('preview-reset').addEventListener('click',()=>{stopPreview();local.scene?.setProgress(0);byId('preview-scrub').value=0;});
  byId('preview-scrub').addEventListener('input',()=>{stopPreview();local.scene?.setProgress(Number(byId('preview-scrub').value)/1000);});
  byId('scene-stage').addEventListener('scene-progress',event=>{byId('preview-scrub').value=Math.round(event.detail.progress*1000);byId('preview-phase').textContent=event.detail.label||'Illustrative sequence';byId('preview-phase-note').textContent='Animation progress, not measured time';if(event.detail.progress>=1&&local.playing)stopPreview();});
  byId('scene-stage').addEventListener('scene-preview-blocked',()=>{stopPreview();fw().toast('There is no recorded wipe at this location. Inspect its admission history instead.');});
  document.querySelectorAll('[data-discover]').forEach(b=>b.addEventListener('click',()=>discover(b.dataset.discover)));
  byId('studio-tour').addEventListener('click',()=>showTour(0));byId('tour-next').addEventListener('click',()=>showTour(local.tour===tourSteps.length-1?-1:local.tour+1));byId('tour-stop').addEventListener('click',()=>showTour(-1));
  document.querySelectorAll('[data-chart-site]').forEach(b=>b.addEventListener('click',()=>{local.chartSite=b.dataset.chartSite;drawChart();}));
  byId('chart-scrub').addEventListener('input',()=>updateSample(Number(byId('chart-scrub').value),false));
  byId('force-chart').addEventListener('pointermove',event=>{const rect=byId('force-svg').getBoundingClientRect();const pos=(event.clientX-rect.left)/rect.width*760;updateSample((pos-48)/692*799,true);});
  byId('force-chart').addEventListener('pointerleave',()=>{byId('chart-tooltip').hidden=true;});
  byId('force-chart').addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();updateSample(event.key==='Home'?0:event.key==='End'?799:local.sample+(event.key==='ArrowRight'?1:-1),false);}});
  if(fw().getState().decision)render(fw().getState().decision);setPending(fw().getState().pending);
  loadScene();loadTraces();
}
document.addEventListener('fieldwork:decision',event=>{if(local.playing)stopPreview();render(event.detail);});
document.addEventListener('fieldwork:pending',event=>setPending(event.detail));
document.addEventListener('fieldwork:error',event=>invalidateDecision(event.detail));
document.addEventListener('fieldwork:view',event=>{if(event.detail!=='studio')stopPreview();else requestAnimationFrame(()=>local.scene?.resize());});
document.addEventListener('fieldwork:ready',init);
if(window.Fieldwork)init();else document.addEventListener('DOMContentLoaded',init,{once:true});
