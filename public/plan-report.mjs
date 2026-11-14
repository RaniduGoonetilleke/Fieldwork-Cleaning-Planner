/** Readable snapshots of existing plans. This module does not make planning decisions. */
import {rowBadge, decidedLines, peopleLines, roleWords} from './plan-explain.mjs';
import {testedTaskDisplay} from './tested-display.mjs';
import {subject, checkState, isExample} from './job-review-store.js';

const peopleNames = {H1:'Robot helper', H2:'Glass cleaner'};
const valueWords = {PASS:'checked', FAIL:'needs attention', UNKNOWN:'not checked', AVAILABLE:'free', BUSY:'busy', ORDINARY:'from the floor', SPECIALIST:'specialist access'};
const skillWords = {glass_wiping:'glass', whiteboard_wiping:'whiteboards', wall_wiping:'walls', desk_wiping:'desks', floor_cleaning:'floors', ordinary_waste_handling:'ordinary waste', facade_cleaning:'outside building surfaces'};
const reviewWords = {current:'The recorded assessment matches these entries. It is a declaration, not an authenticated approval.', rejected:'The recorded assessment says the job needs attention.', missing:'No assessment is recorded for these entries.', incomplete:'The assessment needs a name, a date and a decision.', stale:'The entries changed after the assessment was recorded, so it no longer counts.'};
const checkLabels = {
  site:{accessArranged:'Access has been arranged',siteRulesReviewed:'Site rules have been reviewed'},
  room:{routes:'Paths and exits are clear',people:'People nearby are protected',hazards:'Cleaning products, wet floors, cables and other hazards have been dealt with'},
  surface:{permission:'Owner allows contact',condition:'Surface condition has been checked',method:'Cleaning method suits this surface'},
  manual:{permission:'Manual work is allowed',equipment:'Suitable equipment and protective gear are ready; lifting has been considered',training:'Training required for this job has been checked'},
};
// Display metadata only; checked against the bundled catalogue by test_plan_report.mjs.
export const configurationWords = {
  G1_A_7N:'G1 / simulated wall spot A / 7 N',G1_A_8N:'G1 / simulated wall spot A / 8 N',
  G1_B_7N:'G1 / simulated wall spot B / 7 N',G1_B_8N:'G1 / simulated wall spot B / 8 N',
  G1_C_7N:'G1 / simulated wall spot C / 7 N',G1_C_8N:'G1 / simulated wall spot C / 8 N',
  G1_D_7N:'G1 / simulated wall spot D / 7 N',G1_D_8N:'G1 / simulated wall spot D / 8 N',
  UR3_registered_handover:'UR3 / registered-cube handover',UR5_whiteboard_detection:'UR5 / taped-whiteboard detection',
};
export const testedPlanWords = {
  RECOMMENDED:['Fits the recorded setting','Keep the stated helper and conditions in place. This is a plan, not a robot command.','good'],
  MANUAL_ASSIGNED:['A person is assigned','Keep this person available for the stated manual task.','good'],
  PENDING_CHOICE:['A setting needs choosing','Choose one of the recorded settings in the app.','waiting'],
  PENDING_CONFIRMATION:['An OK is still needed','Give a separate example confirmation if the request is correct.','waiting'],
  WAITING_FOR_PERSON:['A suitable person is unavailable','Review the helper’s skills and availability.','waiting'],
  WAITING:['The robot is already booked','Change the team or the job. This app does not move jobs to another stage.','waiting'],
  BLOCKED_NOT_IN_TEAM:['The required robot is not on this team','Include it through the relevant job example before planning with it.','waiting'],
  BLOCKED_EVIDENCE:['No matching tested option','Review the task and its evidence. A free person does not supply a missing robot test.','waiting'],
  CONDITIONAL_ON_INPUT:['An earlier result is needed','Wait for the required output. Planning the earlier job does not complete it.','waiting'],
  BLOCKED_INPUT:['An earlier job cannot provide its result','Resolve the earlier job before this one can proceed.','waiting'],
  WITHHELD_SHARED:['The area still needs checking','Review the area conditions.','waiting'],
  BLOCKED_SHARED:['The area check failed','Resolve the unsafe condition before assigning anyone.','bad'],
  WITHHELD_TASK_CONDITION:['A place check is missing','Review this place’s safety and contact permission.','waiting'],
  BLOCKED_TASK_CONDITION:['Work at this place is blocked','Resolve its safety or permission issue before assigning anyone.','bad'],
  WITHHELD_ROBOT_CHECK:['A robot check is missing','Review the robot’s required checks before considering this option.','waiting'],
  BLOCKED_ROBOT_CHECK:['A robot check failed','Review the failed check before considering this option.','bad'],
};
const words = value => valueWords[value] || 'not recorded';
const human = value => String(value || '').replaceAll('_', ' ');
const block = (kind, text) => ({kind, text:String(text ?? '')});
const paragraph = text => block('body', text);
const note = text => block('note', text);
const unique = values => [...new Set(values.filter(Boolean))];
const commonLimits = 'A plan is not finished work or permission to start. Nothing is dispatched. Stages show order only, with no measured duration, travel time or cost.';
const checkText = (values, group) => Object.entries(values || {}).map(([key,value]) => (checkLabels[group]?.[key] || human(key)) + ': ' + words(value)).join('; ');

export function customerPlanReport(result, {exampleTitle='', exampleEdited=false, names={}} = {}) {
  if (!result?.effectiveInputs || !Array.isArray(result.rows)) throw new Error('Build a plan before downloading it.');
  const input = result.effectiveInputs, context = input.context || {};
  const personName = id => names[id] || input.people?.find(p => p.id === id)?.label || peopleNames[id] || 'A person';
  const title = context.jobName || 'Cleaning job';
  const source = exampleTitle ? (exampleEdited ? 'EDITED EXAMPLE - CHECK ALL ENTRIES' : 'EXAMPLE - INVENTED CONDITIONS') : 'PLAN FROM ENTERED ANSWERS';
  const blocks = [block('kicker', source), block('title', title), block('subtitle', context.buildingName || 'Building name not entered')];
  for (const [label, value] of [['Company',context.company],['Customer',context.customer]]) if (value) blocks.push(paragraph(label + ': ' + value));
  if (exampleTitle) blocks.push(note('Started from: ' + exampleTitle + '. ' + (exampleEdited ? 'Example entries may remain; check them before using this plan.' : 'These conditions were invented to demonstrate the planner.')));
  blocks.push(block('section','Plan at a glance'), paragraph(result.summary?.sentence || 'See the job results below.'));
  for(const row of result.rows) blocks.push(paragraph('Stage ' + row.round + ': ' + row.label + ' / ' + [row.room,row.place].filter(Boolean).join(' / ') + ' - ' + rowBadge(row,row.person?personName(row.person):null).text));
  blocks.push(note(commonLimits), note('The app has not inspected this workplace or verified the entered facts, skills or assessment. No robot is qualified by this route for these new-building cleaning tasks.'));
  blocks.push(paragraph(reviewWords[result.reviewStatus?.status] || 'Assessment status not recorded.'));
  const review = input.review || {};
  if (review.by || review.date || review.reference) blocks.push(paragraph('Assessment declaration: ' + [review.by, review.date, review.reference].filter(Boolean).join(' / ')));
  if (input.siteChecks) blocks.push(block('section','Declared building and room checks'),paragraph(checkText(input.siteChecks,'site')));
  for (const room of input.rooms || []) blocks.push(block('label',room.name),paragraph(checkText(room.checks,'room')));
  blocks.push(block('section','People and availability'));
  for (const person of input.people || []) {
    const training = result.scenario?.team?.people?.find(p => p.id === person.id)?.training || [];
    blocks.push(block('label',personName(person.id)), paragraph('Stage 1: ' + words(person.availability?.['round-1']) + '. Stage 2: ' + words(person.availability?.['round-2']) + '.'), paragraph('Declared cleaning skills: ' + (training.map(s => skillWords[s] || human(s)).join(', ') || 'not recorded') + '.'));
  }
  blocks.push(paragraph('Robots listed on the team: ' + (input.robots?.join(', ') || 'none') + '.'));
  const rounds = unique(result.rows.map(row => Number(row.round))).sort((a,b) => a-b);
  for (const round of rounds) {
    blocks.push(block('section','Stage ' + round));
    for (const row of result.rows.filter(item => Number(item.round) === round)) {
      const task = input.tasks?.find(item => item.id === row.id) || {};
      const dependency = result.rows.find(item => item.id === task.dependsOn);
      blocks.push(block('task',row.label || 'Cleaning task'), paragraph([row.room,row.place].filter(Boolean).join(' / ')), block('label',rowBadge(row, row.person ? personName(row.person) : null).text), paragraph('Why: ' + row.reason), paragraph('Next: ' + row.nextAction));
      blocks.push(paragraph('Requested method: ' + (task.method || 'not entered') + '. Access: ' + words(task.access) + '.'));
      if (task.checks) blocks.push(paragraph('Declared surface checks: ' + checkText(task.checks.surface,'surface') + '.'),paragraph('Declared manual-work checks: ' + checkText(task.checks.manual,'manual') + '.'));
      if (task.type==='facade' || task.access==='SPECIALIST' || task.specialist?.accessPlan) blocks.push(paragraph('Specialist access plan: ' + (task.specialist?.accessPlan || 'not entered')),paragraph('Specialist notes: weather ' + words(task.specialist?.weather) + '; ground ' + words(task.specialist?.ground) + '; public protection ' + words(task.specialist?.publicProtection) + '.'),note('Specialist work needs a plan outside this app. These answers cannot approve it.'));
      if (dependency) blocks.push(paragraph('Waits for: ' + dependency.label + ' at ' + dependency.place + '. A planned earlier job is not completed work.'));
      const checks = decidedLines(row); if (checks.length) blocks.push(paragraph('Answers behind this result: ' + checks.join('; ') + '.'));
      const people = peopleLines(row); if (people.length) blocks.push(paragraph(people.join(' ')));
      if (row.robotStatus) blocks.push(note('Robot scope: ' + row.robotStatus));
    }
  }
  // Keep material diagnostic qualifications, without repeating record IDs or raw decisions.
  const evidence = [];
  for (const coverage of Object.values(result.robotChecks || {})) {
    evidence.push(coverage.wholeJob, coverage.gapsNote, coverage.routeNote);
    for (const part of coverage.parts || []) evidence.push(part.summary, part.recordsNote, part.selector?.called ? part.selector.assumption : part.selector?.reason, part.selector?.called ? part.selector.note : '', ...(part.evidenceNeeded || []));
  }
  if (evidence.some(Boolean)) blocks.push(block('section','Robot evidence limits'), ...unique(evidence).map(note));
  blocks.push(block('section','Using this copy'), paragraph('This is a snapshot of the plan when Download PDF was pressed. Changed entries need a fresh plan and a fresh download. The optional research JSON in About this plan keeps the exact record for replay.'), note('The responsible person must resolve outstanding checks and make the real work decision. A named assessment in this app is not authentication, legal approval or a verified safety assessment.'));
  return {title, blocks};
}

export function testedPlanReport(data, {original=false} = {}) {
  if (!Array.isArray(data?.plan?.tasks) || !data.scenario) throw new Error('Check an example before downloading it.');
  const scenario = data.scenario, tested = scenario.id === 'tested_contexts';
  const title = original ? 'Original paper building plan' : tested ? 'Tested setups: example plan' : 'Paper building: edited example plan';
  const blocks = [block('kicker','EXAMPLE - INVENTED CONDITIONS'), block('title',title), block('subtitle',tested ? 'Separate robot study settings' : 'Illustrative office and teaching floor'), paragraph(scenario.description || 'A planning example, not a record of a real cleaning job.'), note(commonLimits), note('The area checks, availability and confirmations are example inputs. They are not a real workplace inspection, worker consent or authenticated safety approval. The three robot studies were carried out separately; this plan does not demonstrate connected or simultaneous operation.')];
  blocks.push(block('section','People and stages'));
  const slots = scenario.slots || unique(data.plan.tasks.map(task => task.slot));
  for (const person of scenario.team?.people || []) {
    blocks.push(block('label',peopleNames[person.id] || person.label || 'Person'), paragraph(slots.map((slot,i) => 'Stage ' + (i+1) + ': ' + words(person.availability?.[slot])).join('. ') + '.'), paragraph('Declared cleaning skills: ' + ((person.training || []).map(s => skillWords[s] || human(s)).join(', ') || 'none') + '. ' + roleWords(person.roles)));
  }
  blocks.push(paragraph('Robots on this example team: ' + (scenario.team?.robots?.join(', ') || 'none') + '.'));
  for (const [index,slot] of slots.entries()) {
    const tasks = data.plan.tasks.filter(task => task.slot === slot); if (!tasks.length) continue;
    blocks.push(block('section','Stage ' + (index+1)));
    for (const task of tasks) {
      const requestTask = scenario.tasks?.find(item => item.id === task.id) || {};
      const display = testedTaskDisplay(task, scenario);
      const [result,next] = testedPlanWords[task.state] || ['This task needs review','Review the task, its conditions and evidence before proceeding.'];
      blocks.push(block('task',display.title), paragraph('Place: ' + (human(requestTask.location) || 'not recorded')), block('label',result));
      if (display.requirement) blocks.push(paragraph(display.requirement));
      const assigned = [task.robot?.platform,task.person ? peopleNames[task.person] || 'A person' : null].filter(Boolean);
      if (assigned.length) blocks.push(paragraph('Planned team: ' + assigned.join(' + ') + (Number.isFinite(task.robot?.setpoint_n) ? '. Selected setting: ' + task.robot.setpoint_n + ' N' : '') + '.'));
      const configured = configurationWords[task.selector?.configuration];
      if (configured && !task.robot) blocks.push(paragraph('Configured option: ' + configured + '. This is not a robot assignment.'));
      if (task.selector?.decision==='CONFIRM') blocks.push(note('A separate example confirmation is still required. Choosing a setting or having a free helper does not give that confirmation.'));
      if (task.synthetic?.some(value => value.startsWith('confirmation of '))) blocks.push(note('An example confirmation was applied for this plan. It is not an authenticated approval or a robot command.'));
      blocks.push(paragraph('Next: ' + next));
      const conditions = scenario.conditions?.[slot], location = conditions?.locations?.[requestTask.location];
      if (conditions) blocks.push(paragraph('Example answers: shared area ' + words(conditions.shared_safety) + '; local area ' + words(conditions.areas?.[requestTask.area]) + '; place safety ' + words(location?.safety) + '; contact permission ' + words(location?.contact_permission) + '.'));
      const needs = (requestTask.needs || []).map(([id]) => scenario.tasks?.find(item => item.id === id)).filter(Boolean);
      if (needs.length) blocks.push(paragraph('Earlier work needed: ' + needs.map(item => testedTaskDisplay(item,scenario).title).join('; ') + '. Planning it does not complete it.'));
      if (task.state === 'MANUAL_ASSIGNED' && requestTask.manual_alternative) blocks.push(note('This is a permitted manual alternative. It does not fulfil the original request for force-regulated wiping.'));
      if (task.state === 'PENDING_CHOICE') blocks.push(note('A range can include a recorded setting; it does not make every value in that range tested. Neither setting was shown to clean better.'));
      if (task.state === 'PENDING_CONFIRMATION') blocks.push(note('Being free is different from giving permission. An example OK in this app does not start a robot or recognise a hand gesture.'));
    }
  }
  blocks.push(block('section','What the robot records cover'), note('G1: a robot held at its pelvis in simulation. Wall spot D has recorded right-pad settings of 7 and 8 N, with 7 N on the left. These records show a wipe and final hold, not dirt removal or physical G1 performance. An untested spot does not become supported by being between tested spots.'), note('UR5: finding the taped whiteboard region in the studied setup. This registered option does not qualify a complete force-controlled cleaning job. A trained attendant starts the program and watches.'), note('UR3: registered-cube handover in its studied setup, with a trained person commanding and confirming. Cleaning supplies in another building are not automatically covered.'), note('The force ranges in these examples were authored as illustrative permitted settings. They are not measured cleaning requirements. A free helper cannot supply missing robot evidence.'), paragraph('This PDF is a snapshot of the computed example. The optional research JSON keeps its exact inputs and results for replay.'));
  return {title, blocks};
}

export function notebookReport(data, builtins=[]) {
  const title='Robot and result notebook';
  const blocks=[block('kicker','SAVED BROWSER NOTES'),block('title',title),paragraph('Your saved robots, test results and recorded reviews, including archived entries. Built-in robot names are included for reference; the read-only research evidence register is not copied into this notebook report.'),note('These are user-entered notes. A recorded review does not verify the evidence, change a plan or qualify a robot for a job. Job outcomes and supervisor checks have their own PDF on the Job reviews tab.')];
  const robots=[...builtins,...(data.robots||[])];
  blocks.push(block('section','Robots'));
  for (const robot of robots) blocks.push(block('task',robot.name),paragraph((robot.domain==='simulation'?'Simulation':'Physical robot')+' / '+robot.type),note(builtins.includes(robot)?'Built-in robot: read-only example.':robot.archivedAt?'Your saved robot - archived.':'Your saved robot.'),...(robot.notes?[paragraph(robot.notes)]:[]));
  blocks.push(block('section','Saved results'));
  if (!data.results?.length) blocks.push(paragraph('No test results are saved in this browser.'));
  for (const result of data.results||[]) {
    const robot=robots.find(item=>item.id===result.robotId);
    blocks.push(block('task',result.task),paragraph((robot?.name||'Robot')+' / '+(result.domain==='simulation'?'Simulation':'Physical robot')+' / '+result.date),paragraph(result.context+' / '+result.location),block('label','Recorded outcome: '+({PASS:'Passed',FAIL:'Failed',INCONCLUSIVE:'Unclear'}[result.outcome]||'Unclear')));
    if(result.archivedAt||robot?.archivedAt) blocks.push(note([result.archivedAt?'Result archived.':'',robot?.archivedAt?'Robot archived.':''].filter(Boolean).join(' ')));
    const settings=result.settings||{};
    const lines=[Number.isFinite(settings.rightForceN)?'Right: '+settings.rightForceN+' N':'',Number.isFinite(settings.leftForceN)?'Left: '+settings.leftForceN+' N':'',settings.description].filter(Boolean);
    if(lines.length)blocks.push(paragraph('Recorded settings: '+lines.join('; ')));
    if(result.notes)blocks.push(paragraph('Note: '+result.notes));
    blocks.push(paragraph('Evidence reference: '+result.evidence));
    if(result.review)blocks.push(block('label','Review recorded - not used in plans'),paragraph('Typed reviewer: '+result.review.reviewer+'. Recorded: '+result.review.reviewedAt),...(result.review.note?[paragraph(result.review.note)]:[]));
    else blocks.push(note('No review recorded. Not used in plans.'));
  }
  return {title,blocks,kind:'notes'};
}

export function jobReviewsReport(reviews,{words,planLines,summary}) {
  const title='Job outcomes and supervisor checks';
  const blocks=[block('kicker','SAVED BROWSER NOTES'),block('title',title),paragraph(summary),note('These are typed notes, not verified work records or success rates. Outcomes and supervisor checks are separate. Names are not verified. Neither changes a plan or qualifies a robot for a job.'),note('This copy includes archived notes, labelled below. Invented examples are labelled and excluded from the ordinary counts. Earlier answers and checks are not kept when a note changes.')];
  if(!reviews.length)blocks.push(paragraph('No job reviews are saved in this browser.'));
  for(const review of reviews){
    const about=subject(review),state=checkState(review);
    blocks.push(block('task',about.job),paragraph(about.place));
    if(isExample(review))blocks.push(block('label','INVENTED EXAMPLE - NOT COUNTED'));
    if(review.archivedAt)blocks.push(note('Archived note.'));
    blocks.push(block('label','Outcome as recorded'),paragraph('Work date: '+review.workDate),paragraph('What happened: '+(words.happened[review.happened]||'Not known')),paragraph('Done by: '+(words.doneBy[review.doneBy]||'Not known')+(review.doneByName?' ('+review.doneByName+')':'')),paragraph(review.difficulties?.length?'Extra help recorded: '+review.difficulties.map(key=>words.difficulties[key]).join('; ')+'.':'No extra help recorded.'));
    for(const [label,value] of [['Different from the plan',review.differed],['Outcome note',review.note],['Evidence reference',review.evidence]])if(value)blocks.push(paragraph(label+': '+value));
    if(review.plan){blocks.push(block('label','Copy of the linked plan'));for(const [label,value]of planLines(review.plan))blocks.push(paragraph(label+': '+value));blocks.push(note('The plan link does not show that work happened or give verified approval. The app has not checked that this saved plan can still be replayed.'));}
    else blocks.push(note('No plan link. The job and place were typed.'));
    blocks.push(block('label','Separate supervisor check: '+(words.check[state]||'Not checked')));
    if(review.check){blocks.push(paragraph('Typed name: '+review.check.checkedBy+'. Check date: '+review.check.checkedOn));if(review.check.note)blocks.push(paragraph('Check note: '+review.check.note));}
    else blocks.push(paragraph('No supervisor check is recorded for this outcome.'));
    blocks.push(note('A supervisor accepting this result is not a technical review of robot capability or permission to offer it for another job.'));
  }
  return {title,blocks,kind:'notes'};
}

/** Wrap literal text, including long unbroken names, without HTML or ASCII substitution. */
export function wrapReportText(text, measure, width) {
  const lines = [];
  const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined,{granularity:'grapheme'}) : null;
  const graphemes = word => segmenter ? [...segmenter.segment(word)].map(item => item.segment) : Array.from(word);
  for (const paragraph of String(text).split(/\r?\n/)) {
    let line = '';
    for (const word of paragraph.split(/\s+/u).filter(Boolean)) {
      const candidate = line ? line + ' ' + word : word;
      if (measure(candidate) <= width) {line = candidate; continue;}
      if (line) {lines.push(line); line = '';}
      if (measure(word) <= width) {line = word; continue;}
      for (const letter of graphemes(word)) {
        if (line && measure(line + letter) > width) {lines.push(line);line = '';}
        line += letter;
      }
    }
    lines.push(line);
  }
  return lines;
}

const PAGE = {width:595.28,height:841.89,margin:43,top:66,bottom:787,scale:3};
const styles = {kicker:{size:9,weight:700,color:'#47675b',after:12},title:{size:26,weight:700,color:'#183e31',after:9},subtitle:{size:14,weight:400,color:'#52675f',after:17},section:{size:15,weight:700,color:'#183e31',before:17,after:9},task:{size:13,weight:700,color:'#233d34',before:13,after:7},label:{size:11,weight:700,color:'#233d34',before:4,after:5},body:{size:10.5,weight:400,color:'#253b32',after:7},note:{size:9.5,weight:400,color:'#52645c',after:7}};
const font = style => style.weight + ' ' + style.size + 'px Arial, "Noto Sans", sans-serif';

export function* renderReportPages(report) {
  if (!Array.isArray(report?.blocks)) throw new Error('The readable plan is missing.');
  const measureCanvas = document.createElement('canvas'), measureContext = measureCanvas.getContext('2d');
  if (!measureContext) throw new Error('This browser cannot create a PDF preview.');
  const width = PAGE.width - 2*PAGE.margin;
  const prepared = report.blocks.filter(item => item.text).map(item => {
    const style = styles[item.kind] || styles.body; measureContext.font = font(style);
    return {...item,style,lines:wrapReportText(item.text,text => measureContext.measureText(text).width,width)};
  });
  // Lay out text first, then rasterise one page at a time. A large notebook must
  // not retain hundreds of full-resolution canvases in browser memory.
  const pages = [[]]; let y=PAGE.top;
  const newPage=()=>{pages.push([]);y=PAGE.top;};
  for (const item of prepared) {
    const {style,lines} = item, lineHeight = style.size*1.42;
    const keepNext = item.kind==='task' ? 85 : ['section','label'].includes(item.kind) ? 38 : 0;
    const height = (style.before||0) + lines.length*lineHeight + style.after;
    if (y > PAGE.top && y + Math.min(height+keepNext,PAGE.bottom-PAGE.top) > PAGE.bottom) newPage();
    y += style.before||0;
    for (const line of lines) {
      if (y+lineHeight > PAGE.bottom) newPage();
      pages.at(-1).push({style,line,y});y+=lineHeight;
    }
    y+=style.after;
  }
  for (const [index,lines] of pages.entries()) {
    const canvas=document.createElement('canvas');canvas.width=Math.ceil(PAGE.width*PAGE.scale);canvas.height=Math.ceil(PAGE.height*PAGE.scale);
    const ctx=canvas.getContext('2d');ctx.scale(PAGE.scale,PAGE.scale);ctx.fillStyle='#ffffff';ctx.fillRect(0,0,PAGE.width,PAGE.height);ctx.textBaseline='top';
    ctx.font='700 9px Arial, sans-serif';ctx.fillStyle='#47675b';ctx.fillText('FIELDWORK / READABLE COPY',PAGE.margin,30);
    ctx.strokeStyle='#dbe4df';ctx.lineWidth=0.7;ctx.beginPath();ctx.moveTo(PAGE.margin,49);ctx.lineTo(PAGE.width-PAGE.margin,49);ctx.stroke();
    for(const {style,line,y} of lines){ctx.font=font(style);ctx.fillStyle=style.color;ctx.fillText(line,PAGE.margin,y);}
    ctx.font='400 8px Arial, sans-serif';ctx.fillStyle='#617068';
    ctx.fillText(report.kind==='notes'?'Saved browser notes - not independently verified':'Saved copy - no work is approved or dispatched',PAGE.margin,809);
    ctx.textAlign='right';ctx.fillText((index+1)+' / '+pages.length,PAGE.width-PAGE.margin,809);ctx.textAlign='left';
    yield canvas;
  }
}

export async function createPlanPdf(report) {
  // The bundled library is loaded only when asked for a PDF. Canvas uses the browser's
  // Unicode shaping/font fallback and passes literal text, never executable markup.
  await document.fonts?.ready;
  const {PDFDocument} = await import('./vendor/pdf-lib/pdf-lib.esm.min.js');
  const documentPdf = await PDFDocument.create();
  documentPdf.setTitle(report.title);documentPdf.setSubject(report.kind==='notes'?'Saved browser notes; not independently verified':'Readable planning snapshot; no work approved or dispatched');documentPdf.setCreator('Fieldwork readable report');
  const pages=renderReportPages(report);
  for (const canvas of pages) {
    const picture=await documentPdf.embedPng(canvas.toDataURL('image/png'));
    documentPdf.addPage([PAGE.width,PAGE.height]).drawImage(picture,{x:0,y:0,width:PAGE.width,height:PAGE.height});
    canvas.width=1;canvas.height=1;
  }
  return documentPdf.save();
}

export async function downloadPlanPdf(report, filename='fieldwork-plan.pdf') {
  const bytes=await createPlanPdf(report), url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));
  const link=document.createElement('a');link.href=url;link.download=filename;link.hidden=true;document.body.append(link);link.click();
  setTimeout(()=>{link.remove();URL.revokeObjectURL(url);},10000);
}

export function planPdfButton(reportFactory, filename, {label='Download PDF',className='customer-button'}={}) {
  const button=document.createElement('button');button.type='button';button.className=className;button.textContent=label;
  let error;
  button.addEventListener('click',async()=>{
    if(button.disabled)return;button.disabled=true;button.textContent='Preparing PDF…';error?.remove();
    try {const report=reportFactory();await downloadPlanPdf(report,filename);}
    catch (problem) {error=document.createElement('p');error.className='error-panel';error.setAttribute('role','alert');error.textContent='The PDF could not be saved. '+problem.message;button.after(error);}
    finally {button.disabled=false;button.textContent=label;}
  });
  return button;
}
