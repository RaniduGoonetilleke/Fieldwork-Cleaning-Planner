import {requestGate, removeTask, updateTaskRound, planDownload, clearedDependencies, freshTaskChecks, freshSpecialist, invalidateAssessment, updateTaskCheck, resetChangedTask, resetBuildingChecks, recordAssessment, newBuildingReference, freshRoomChecks, updateRoomCheck, renameRoom, renamePlace, moveTaskPlace, nameKey} from './customer-state.mjs';
import {customerPlanReport, planPdfButton} from './plan-report.mjs';
import {STEPS, assessmentState, assessmentWords, rowBadge, decidedLines, peopleLines, partView, orderLines, compareRows, nextCounters, roleWords} from './plan-explain.mjs';

const el = (tag, cls = '', text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};
const button = (label, action, cls = 'customer-button') => {
  const node = el('button', cls, label); node.type = 'button';
  node.addEventListener('click', action); return node;
};
const iconPaths = {
  whiteboard: '<rect x="10" y="11" width="60" height="39" rx="4"/><path d="M40 50v15M24 66h32M24 28l10 10 21-15"/>',
  glass: '<rect x="14" y="9" width="52" height="58" rx="3"/><path d="M40 9v58M14 38h52M22 20l10 10m18 17 8 8"/>',
  wall: '<path d="M12 66V12h56v54M12 30h56M12 48h56M30 12v18m20 0v18M30 48v18"/><path d="m51 50 15-15 8 8-15 15z"/>',
  desks: '<path d="M9 39h62v8H9zM16 47v20m48-20v20M27 16h27v18H27zM40 34v5M18 30h4"/>',
  floor: '<path d="M7 63h66M13 52l12-13h31l12 13M30 39l8-26M25 53h31M16 63l4-10m43 10-4-10"/>',
  bins: '<path d="M23 23h34l-3 43H26zM18 23h44M32 23v-9h16v9M34 34v21m12-21v21"/>',
  facade: '<path d="M14 68V12h52v56M27 12v56m26-56v56M14 30h52M14 48h52"/><path d="M6 68h68M68 8v38m-6-5 6 7 6-7"/>',
  person: '<circle cx="40" cy="21" r="11"/><path d="M20 66V49a20 20 0 0 1 40 0v17M30 51v15m20-15v15"/>',
  robot: '<rect x="20" y="24" width="40" height="30" rx="6"/><path d="M40 24V12M32 66h16M40 54v12M12 34v12m56-12v12"/><circle cx="31" cy="38" r="3"/><circle cx="49" cy="38" r="3"/>',
};
function graphic(name) {
  const holder = el('span', 'customer-icon'); holder.setAttribute('aria-hidden', 'true');
  holder.innerHTML = '<svg viewBox="0 0 80 80" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">' + (iconPaths[name] || iconPaths.person) + '</svg>';
  return holder;
}
const TYPES = ['whiteboard', 'glass', 'wall', 'desks', 'floor', 'bins', 'facade'];
const friendly = {
  whiteboard: ['Wipe whiteboards', 'Boards in meeting rooms', 'Meeting room 1', 'Whiteboard 1'],
  glass: ['Clean glass', 'Reachable glass panels', 'Meeting room 1', 'Glass panel 1'],
  wall: ['Wipe a wall', 'A marked wall surface', 'Corridor', 'Wall section 1'],
  desks: ['Wipe desks', 'Desk and table surfaces', 'Office 1', 'Desk 1'],
  floor: ['Clean floors', 'An ordinary floor area', 'Corridor', 'Floor area 1'],
  bins: ['Empty bins', 'Ordinary waste only', 'Office 1', 'Bin 1'],
  facade: ['Clean a façade', 'Exterior work · specialist access', 'Building exterior', 'Façade section 1'],
};
const skillLabels = {whiteboard_wiping: 'Whiteboards', glass_wiping: 'Glass', wall_wiping: 'Walls', desk_wiping: 'Desks', floor_cleaning: 'Floors', ordinary_waste_handling: 'Ordinary waste'};
const CHECKS = [['UNKNOWN', 'Not checked', '?'], ['PASS', 'Checked', '✓'], ['FAIL', 'Needs attention', '!']];
const PERMISSION = [['UNKNOWN', 'Not checked', '?'], ['PASS', 'Allowed', '✓'], ['FAIL', 'Not allowed', '⊘']];
const AVAILABILITY = [['UNKNOWN', 'Not checked', '?'], ['AVAILABLE', 'Free', '✓'], ['BUSY', 'Busy', '◷']];
const DECISION = [['UNKNOWN', 'Not decided', '?'], ['PASS', 'OK to plan', '✓'], ['FAIL', 'Needs attention', '!']];
const root = document.getElementById('view-customer');
const state = {catalogue: null, input: null, step: 1, counter: 0, pending: false, result: null, error: '', orderReview: [], gate: requestGate(), controller: null, reviewChoice: 'UNKNOWN', robotOptions: null, roomCounter: 0, placeCounter: 0, staleReason: '', example: null, exampleEdited: false, comparison: null};
const refs = {};
function field(label, input, hint) {
  const node = el('label', 'customer-field'); node.append(el('span', '', label), input);
  if (hint) node.append(el('small', '', hint));
  return node;
}
function select(values, value, onChange, label) {
  const input = el('select'); input.setAttribute('aria-label', label);
  values.forEach(([id, name]) => {const option = el('option', '', name); option.value = id; input.append(option);});
  input.value = String(value);
  input.addEventListener('change', () => onChange(input.value));
  return input;
}
function input(value, label, onInput) {
  const node = el('input'); node.type = 'text'; node.value = value; node.maxLength = 80;
  node.setAttribute('aria-label', label);
  node.addEventListener('change', () => onInput(node.value)); return node;
}
/** Three labelled buttons with a symbol each. The pressed one is the current answer. */
function tri(options, value, onChange, label, key) {
  const group = el('div', 'flow-tri'); group.setAttribute('role', 'group'); group.setAttribute('aria-label', label);
  options.forEach(([id, text, icon]) => {
    const option = el('button', 'flow-tri-option'); option.type = 'button'; option.dataset.value = id; option.dataset.focusKey = key + '|' + id;
    option.setAttribute('aria-pressed', String(id === value));
    const mark = el('span', 'flow-tri-icon', icon); mark.setAttribute('aria-hidden', 'true');
    option.append(mark, el('span', '', text));
    option.addEventListener('click', () => {
      if (option.getAttribute('aria-pressed') === 'true') return;
      group.querySelectorAll('button').forEach(node => node.setAttribute('aria-pressed', String(node === option)));
      onChange(id);
    });
    group.append(option);
  });
  return group;
}
function checkRow(label, control, hint) {
  const row = el('div', 'flow-check'); const words = el('div', 'flow-check-label'); words.append(el('span', '', label));
  if (hint) words.append(el('small', '', hint));
  row.append(words, control); return row;
}
function keepFocus(render) {
  const key = document.activeElement?.dataset?.focusKey;
  render();
  if (key) [...root.querySelectorAll('[data-focus-key]')].find(node => node.dataset.focusKey === key)?.focus({preventScroll: true});
}
function refresh(render) { setTimeout(() => keepFocus(render), 0); }
function keyed(node, key) { node.dataset.focusKey = key; return node; }
function syncChecks() {
  refs.places?.querySelectorAll('.flow-tri[data-check-key]').forEach(group => {
    const task = state.input.tasks.find(item => item.id === group.dataset.taskId); if (!task) return;
    const value = task.checks[group.dataset.checkGroup][group.dataset.checkKey];
    group.querySelectorAll('button').forEach(node => node.setAttribute('aria-pressed', String(node.dataset.value === value)));
  });
}
function syncReviewChoice() {
  refs.reviewChoiceBox?.querySelectorAll('button').forEach(node => node.setAttribute('aria-pressed', String(node.dataset.value === state.reviewChoice)));
}
function details(summary, cls = 'customer-details') {
  const node = el('details', cls); node.append(el('summary', '', summary)); return node;
}
function list(items, cls = 'flow-list') {
  const node = el('ul', cls); items.forEach(item => node.append(el('li', '', item))); return node;
}
function invalidate(reason = 'The job or team changed. Check the entries and record the assessment again.', quiet = false) {
  const hadPlan = Boolean(state.result);
  if (refs.technicalDialog?.open) refs.technicalDialog.close();
  refs.technicalBody?.replaceChildren();
  if (!quiet && (state.input?.review.decision !== 'UNKNOWN' || hadPlan)) state.staleReason = reason + (hadPlan ? ' The earlier plan was cleared.' : '');
  if (state.input) state.input = invalidateAssessment(state.input);
  if (state.example) state.exampleEdited = true;
  state.comparison = null;
  state.reviewChoice = 'UNKNOWN';
  refs.reviewChoiceBox?.querySelectorAll('button').forEach(node => node.setAttribute('aria-pressed', String(node.dataset.value === 'UNKNOWN')));
  if (refs.reviewSaved) refs.reviewSaved.textContent = '';
  updateReviewStatus();
  renderAssessmentNotice();
  state.gate.invalidate(); state.controller?.abort(); state.controller = null;
  state.pending = false; state.result = null; state.error = '';
  if (refs.results) refs.results.replaceChildren();
  if (refs.error) refs.error.hidden = true;
  renderNavigation();
}
function hasTasks() { return Boolean(state.input?.tasks.length); }
function contextValid() { return Boolean(state.input?.context.buildingId.trim() && state.input.context.buildingName.trim()); }
function roomName(task) { return state.input.rooms.find(room => room.id === task.roomId)?.name || ''; }
function personName(id) { return state.input.people.find(person => person.id === id)?.label || state.catalogue.people.find(person => person.id === id)?.label || id; }
function placesValid() {
  if (!hasTasks() || !contextValid() || state.orderReview.length) return false;
  const rooms = state.input.rooms, names = rooms.map(room => nameKey(room.name));
  if (names.some(name => !name) || new Set(names).size !== names.length) return false;
  const places = new Map();
  return state.input.tasks.every(task => {
    if (!rooms.some(room => room.id === task.roomId) || !nameKey(task.place)) return false;
    const key = task.roomId + '\u0000' + nameKey(task.place), old = places.get(key); places.set(key, task.placeId);
    return !old || old === task.placeId;
  });
}
function renderAssessmentNotice() {
  if (!refs.assessmentNotice) return;
  refs.assessmentNotice.replaceChildren(); refs.assessmentNotice.hidden = !state.staleReason;
  if (!state.staleReason) return;
  const mark = el('span', 'flow-notice-icon', '!'); mark.setAttribute('aria-hidden', 'true');
  refs.assessmentNotice.append(mark, el('p', '', state.staleReason), button('Go to the assessment →', () => {showStep(3); refs.review?.scrollIntoView({block: 'center', behavior: 'instant'});}, 'customer-button'));
}
function replaceTasks(tasks) {
  const affected = clearedDependencies(state.input.tasks, tasks);
  state.orderReview = [...new Set([...state.orderReview, ...affected])].filter(id => tasks.some(task => task.id === id));
  state.input.tasks = tasks;
  renderOrderReview();
}
function renderOrderReview() {
  if (!refs.orderReview) return;
  refs.orderReview.replaceChildren(); refs.orderReview.hidden = !state.orderReview.length;
  if (!state.orderReview.length) return;
  const names = state.input.tasks.filter(task => state.orderReview.includes(task.id)).map(task => friendly[task.type][0] + ' · ' + roomName(task) + ' / ' + task.place);
  refs.orderReview.append(el('p', '', 'The order changed. An earlier-job choice was cleared for: ' + names.join('; ') + '. Check “Wait for another job?” before planning again.'));
  if (state.step !== 3) refs.orderReview.append(button('Review the order →', () => showStep(3), 'customer-button'));
  else refs.orderReview.append(button('I have checked the order', () => {state.orderReview = []; renderOrderReview(); renderChecks(); renderNavigation();}, 'customer-button'));
}
function stepAllowed(step) {
  if (step > 1 && (!hasTasks() || !contextValid())) return false;
  if (step === 4 && !state.pending && !state.result && !state.error) return false;
  return true;
}
function showStep(step, focus = true) {
  if (!stepAllowed(step)) return;
  state.step = step;
  refs.panels.forEach((panel, index) => {panel.hidden = index + 1 !== step;});
  if (step === 2) renderTeam();
  if (step === 3) renderChecks();
  renderOrderReview();
  renderNavigation();
  if (focus) {
    refs.panels[step - 1].querySelector('h1').focus({preventScroll: true});
    root.scrollIntoView({block: 'start', behavior: 'instant'});
  }
}
function renderNavigation() {
  if (!refs.steps || !state.input) return;
  refs.steps.querySelectorAll('button').forEach(node => {
    const step = Number(node.dataset.step);
    node.disabled = !stepAllowed(step);
    if (state.step === step) node.setAttribute('aria-current', 'step'); else node.removeAttribute('aria-current');
  });
  refs.jobsNext.disabled = !hasTasks() || !contextValid(); refs.teamNext.disabled = !hasTasks() || !contextValid();
  const count = state.input.tasks.length;
  refs.selection.textContent = !count ? 'Choose one or more jobs.' : !contextValid() ? 'Add the building name to continue.' : count + (count === 1 ? ' job selected' : ' jobs selected');
  refs.check.disabled = !placesValid() || state.pending;
  if (refs.checkHint) refs.checkHint.textContent = placesValid() ? '' : state.orderReview.length ? 'Confirm the order of work above first.' : 'Give every room and place a different name first.';
}
function newRoom(name) {
  const room = {id: 'room-' + (++state.roomCounter), name, checks: freshRoomChecks()}; state.input.rooms.push(room); return room;
}
function newPlaceName(roomId, base) {
  const occupied = new Set(state.input.tasks.filter(task => task.roomId === roomId).map(task => nameKey(task.place)));
  let suffix = 1, name = base;
  while (occupied.has(nameKey(name))) {suffix++; name = base.replace(/ 1$/, '') + ' ' + suffix;}
  return name;
}
function addTask(type) {
  const limit = state.catalogue.limits?.maxTasks || 12;
  if (state.input.tasks.length >= limit) {refs.selection.textContent = 'This example holds up to ' + limit + ' jobs.'; return;}
  invalidate('A job was added. Check its place and record the assessment again.');
  const room = state.input.rooms.find(item => nameKey(item.name) === nameKey(friendly[type][2])) || newRoom(friendly[type][2]);
  state.input.tasks.push({id: 'job-' + (++state.counter), type, roomId: room.id, placeId: 'place-' + (++state.placeCounter), place: newPlaceName(room.id, friendly[type][3]), round: 1, dependsOn: null, method: '', access: 'UNKNOWN', checks: freshTaskChecks(), specialist: freshSpecialist()});
  renderCards(); renderNavigation();
}
function removeJob(task) {
  if (!window.confirm('Remove this job and its answers?')) return;
  invalidate('A job was removed. Check the remaining work and record the assessment again.');
  replaceTasks(removeTask(state.input.tasks, task.id));
  state.input.rooms = state.input.rooms.filter(room => state.input.tasks.some(item => item.roomId === room.id));
  renderCards(); renderSelected();
  if (!hasTasks()) showStep(1); else if (state.step === 3) renderChecks();
  renderNavigation();
}
function renderCards() {
  refs.cards.replaceChildren();
  TYPES.filter(type => state.catalogue.taskTypes.some(item => item.id === type)).forEach(type => {
    const count = state.input.tasks.filter(task => task.type === type).length;
    const card = button('', () => {addTask(type); renderSelected();}, 'customer-task-card');
    card.dataset.taskType = type; card.dataset.selected = String(count > 0);
    card.setAttribute('aria-label', friendly[type][0] + '. ' + (count ? count + ' selected. Add another.' : 'Add this job.'));
    card.append(graphic(type), el('strong', '', friendly[type][0]), el('small', '', friendly[type][1]), el('span', 'customer-task-check', count ? '✓ ' + count + ' · add another' : '+ Add job'));
    refs.cards.append(card);
  });
  renderSelected();
}
function renderSelected() {
  if (!refs.selected) return;
  refs.selected.replaceChildren(); refs.selected.hidden = !hasTasks();
  if (!hasTasks()) return;
  refs.selected.append(el('strong', '', 'Your jobs'));
  const items = el('ul', 'flow-selected-list');
  state.input.tasks.forEach(task => {
    const item = el('li'); item.append(el('span', '', friendly[task.type][0] + ' · ' + roomName(task) + ' / ' + task.place));
    const remove = button('Remove', () => removeJob(task), 'customer-remove'); remove.setAttribute('aria-label', 'Remove ' + friendly[task.type][0] + ' at ' + task.place);
    item.append(remove); items.append(item);
  });
  refs.selected.append(items, el('small', 'customer-footnote', 'You name the rooms and places in step 3.'));
}
function heading(panel, kicker, title, copy) {
  const box = el('div', 'customer-heading'); const h1 = el('h1', '', title); h1.tabIndex = -1;
  box.append(el('span', 'guide-kicker', kicker), h1, el('p', '', copy)); panel.append(box);
}
function build() {
  root.replaceChildren(); Object.keys(refs).forEach(key => delete refs[key]);
  refs.steps = el('nav', 'customer-steps'); refs.steps.setAttribute('aria-label', 'Planning steps');
  STEPS.forEach((label, index) => {
    const step = button('', () => showStep(index + 1), 'customer-step'); step.dataset.step = index + 1;
    step.append(el('span', '', index + 1), el('strong', '', label)); refs.steps.append(step);
  });
  root.append(refs.steps);
  refs.assessmentNotice = el('div', 'customer-assessment-stale'); refs.assessmentNotice.hidden = true; refs.assessmentNotice.setAttribute('role', 'status'); root.append(refs.assessmentNotice);
  refs.orderReview = el('div', 'customer-order-review'); refs.orderReview.hidden = true; refs.orderReview.setAttribute('role', 'status'); root.append(refs.orderReview);
  refs.panels = [];
  for (let i = 1; i <= 4; i++) {const panel = el('section', 'customer-panel'); panel.id = 'customer-step-' + i; panel.hidden = i !== 1; refs.panels.push(panel); root.append(panel);}

  heading(refs.panels[0], 'STEP 1 · THE CUSTOMER’S JOB', 'What needs cleaning?', 'Pick the jobs. Next you choose the team, answer a few checks and get a plan.');
  refs.examples = el('section', 'flow-examples'); refs.examples.setAttribute('aria-label', 'Examples'); refs.panels[0].append(refs.examples); renderExamples();
  buildContextFields(refs.panels[0]);
  refs.cards = el('div', 'customer-task-grid'); refs.cards.setAttribute('role', 'group'); refs.cards.setAttribute('aria-label', 'Cleaning jobs'); refs.panels[0].append(refs.cards);
  refs.selected = el('div', 'flow-selected'); refs.selected.hidden = true; refs.panels[0].append(refs.selected);
  const n1 = el('div', 'customer-navigation'); refs.selection = el('span'); refs.selection.setAttribute('role', 'status');
  refs.jobsNext = button('Next: choose the team →', () => showStep(2), 'guide-primary'); n1.append(refs.selection, refs.jobsNext); refs.panels[0].append(n1);

  heading(refs.panels[1], 'STEP 2 · PEOPLE AND ROBOTS', 'Who is available?', 'Say who is free. Each robot needs a person with a named role.');
  refs.people = el('div', 'customer-people'); refs.panels[1].append(refs.people);
  refs.robots = el('div', 'customer-robots'); refs.panels[1].append(refs.robots);
  refs.panels[1].append(el('p', 'customer-capacity', 'This version plans with two people and two stages, so at most two jobs get a person in each stage. Stages show order, not working hours.'));
  refs.teamSuggestions = el('div'); refs.panels[1].append(refs.teamSuggestions);
  const n2 = el('div', 'customer-navigation'); refs.teamNext = button('Next: check the places →', () => showStep(3), 'guide-primary'); n2.append(button('← Change jobs', () => showStep(1), 'guide-back'), refs.teamNext); refs.panels[1].append(n2);

  heading(refs.panels[2], 'STEP 3 · PLACE AND WORK CHECKS', 'Is each place ready?', 'Answer what you know. Anything left as “Not checked” stays open in the plan.');
  const declared = el('div', 'customer-note'); const symbol = el('span', 'customer-note-symbol', '✎'); symbol.setAttribute('aria-hidden', 'true');
  declared.append(symbol, el('p', '', 'These answers record what you say. The app cannot inspect a building, and a plan is not a safety certificate.')); refs.panels[2].append(declared);
  refs.siteChecks = el('div', 'customer-site-checks'); refs.panels[2].append(refs.siteChecks);
  refs.places = el('div', 'customer-places'); refs.panels[2].append(refs.places);
  refs.review = el('section', 'customer-review flow-assessment'); refs.panels[2].append(refs.review);
  const n3 = el('div', 'customer-navigation'); refs.check = button('Build my plan →', checkPlan, 'guide-primary'); refs.checkHint = el('span', 'customer-footnote'); refs.checkHint.setAttribute('role', 'status');
  n3.append(button('← Change the team', () => showStep(2), 'guide-back'), refs.checkHint, refs.check); refs.panels[2].append(n3);

  heading(refs.panels[3], 'STEP 4 · THE PLAN', 'Here is your plan.', 'See who can do each job, what must wait and what to do next.');
  refs.error = el('div', 'error-panel'); refs.error.setAttribute('role', 'alert'); refs.error.hidden = true;
  refs.results = el('div', 'customer-results'); refs.results.setAttribute('aria-live', 'polite');
  refs.panels[3].append(refs.error, refs.results);

  const footer = el('div', 'customer-note customer-scope-note'); footer.append(el('p', '', 'Planning demonstration only. The app uses your answers without inspecting the workplace. It cannot start a robot.'));
  root.append(footer); root.append(buildAbout());
  renderCards(); renderSiteChecks(); renderNavigation(); renderAssessmentNotice();
}
function buildAbout() {
  const box = el('div', 'flow-about flow-technical-entry');
  const open = button('About this plan', openTechnicalDetails, 'customer-text-link');
  open.setAttribute('aria-haspopup', 'dialog'); open.setAttribute('aria-controls', 'customer-technical-dialog');
  box.append(open);
  const dialog = el('dialog', 'flow-technical-dialog'); dialog.id = 'customer-technical-dialog';
  dialog.setAttribute('aria-labelledby', 'customer-technical-title');
  const head = el('div', 'flow-technical-head');
  const title = el('h2', '', 'About this plan'); title.id = 'customer-technical-title';
  const close = button('Close', () => dialog.close(), 'customer-button');
  head.append(title, close);
  refs.technicalBody = el('div', 'flow-technical-body');
  dialog.append(head, refs.technicalBody); box.append(dialog); refs.technicalDialog = dialog;
  return box;
}
function openTechnicalDetails() {
  const body = refs.technicalBody;
  if (!body || !refs.technicalDialog) return;
  body.replaceChildren(el('p', '', 'See how this plan is made and what it can tell you.'));
  if (state.result) {
    const reproduce = renderReproduce(state.result); reproduce.open = true; body.append(reproduce);
    const records = details('Robot evidence for each job', 'customer-exact');
    state.result.rows.forEach(row => {
      const record = details(rowLabel(row), 'customer-exact');
      const coverage = state.result.robotChecks?.[row.id];
      if (coverage) record.append(robotSection(coverage));
      records.append(record);
    });
    body.append(records);
    const order = details('Check whether the listed job order changes the plan');
    order.append(list(orderLines(state.result.orderCheck))); body.append(order);
  } else body.append(el('p', 'customer-footnote', 'Build a plan to check its answers and see the evidence behind them.'));
  const how = details('How this plan is made', 'customer-exact');
  how.append(el('p', '', 'Your job → the team you have → the checks you declare → a plan. For each job the planner checks the building, the room, the place and the work, then looks for a free person with the declared skill. For robots it compares each part of the job with the recorded tests.'));
  how.append(list([
    'A robot is offered only in Tested examples, where a recorded test covers the same setting. The building flow plans manual work only. Offering a robot there would need applicable reviewed evidence and a reviewed update to this app.',
    'With two people, the planner fills as many ready jobs as it can in each stage. It does not work out times, travel or cost.',
    'Nothing here measures how well anything is cleaned, and no comparison with another planner has been measured.',
    'The checks record your answers. They do not verify who made the assessment or prove that a workplace is safe.',
    'The same room or place cannot be entered twice with only different capitals, spaces or punctuation. The app cannot tell that two differently named rooms are really one room. The person answering is responsible for that.',
  ]));
  const checked = details('Software checks and test counts', 'customer-exact'); const checksBody = el('div'); checked.append(checksBody);
  checked.addEventListener('toggle', () => {if (checked.open && !checksBody.childElementCount) loadVerification(checksBody);});
  const release = el('p', 'customer-footnote', 'Save the plan if you want to keep its answers. Checking it again needs the same version of the app.');
  body.append(how, checked, release);
  if (!refs.technicalDialog.open) refs.technicalDialog.showModal();
}
async function loadVerification(body) {
  body.replaceChildren(el('p', '', 'Loading…'));
  try {
    const response = await fetch('/verification-summary.json', {cache: 'no-store'}); const value = await response.json();
    if (!response.ok || value.schemaVersion !== 1 || !Array.isArray(value.checks)) throw new Error();
    body.replaceChildren(el('p', '', value.summary));
    const table = el('table', 'flow-table'); const head = el('tr'); ['Check', 'Result', 'What it shows'].forEach(text => head.append(el('th', '', text))); table.append(head);
    value.checks.forEach(check => {const row = el('tr'); [check.name, check.result, check.shows].forEach(text => row.append(el('td', '', text))); table.append(row);});
    body.append(table, el('strong', '', 'What these checks do not show'), list(value.notShown), el('p', 'customer-footnote', 'Checked on ' + value.checkedOn + ' for release ' + value.release + '.'));
  } catch {
    body.replaceChildren(el('p', '', 'The summary of checks could not be loaded. Planning still works.'));
  }
}
function renderExamples() {
  refs.examples.replaceChildren();
  const head = el('div', 'flow-examples-head'); head.append(el('strong', '', 'New here? Try an example'), el('span', '', 'One click each. The building examples use invented answers. The G1 examples use recorded simulation results with invented current conditions. The notebook example is invented and holds no test evidence.')); refs.examples.append(head);
  const row = el('div', 'flow-example-list');
  const add = (title, action) => {const node = button('', action, 'flow-example'); const mark = el('span', 'flow-example-icon', '▸'); mark.setAttribute('aria-hidden', 'true'); node.append(mark, el('span', '', title)); row.append(node);};
  (state.catalogue.examples || []).forEach(example => add(example.title, () => loadExample(example.id)));
  add('G1 simulation test with its helper', () => document.dispatchEvent(new CustomEvent('fieldwork:tested-preset', {detail: 'g1_helper_free'})));
  add('G1 simulation test, helper busy', () => document.dispatchEvent(new CustomEvent('fieldwork:tested-preset', {detail: 'g1_helper_busy'})));
  add('A new robot result waiting for review', () => document.dispatchEvent(new CustomEvent('fieldwork:open-registry', {detail: 'admission'})));
  refs.examples.append(row);
  if (state.input.tasks.length || state.example) refs.examples.append(button('Start again with an empty job', startEmpty, 'customer-text-link'));
}
function adopt(value, example) {
  state.gate.invalidate(); state.controller?.abort(); state.controller = null;
  state.input = value; state.example = example; state.exampleEdited = false; state.comparison = null;
  const counters = nextCounters(value); state.counter = counters.job; state.roomCounter = counters.room; state.placeCounter = counters.place;
  state.pending = false; state.result = null; state.error = ''; state.orderReview = []; state.staleReason = ''; state.step = 1;
  state.reviewChoice = value.review.decision;
  build();
}
function startEmpty() {
  const value = structuredClone(state.catalogue.defaultInputs); value.context.buildingId = newBuildingReference();
  adopt(value, null); showStep(1);
}
function loadExample(id) {
  const example = state.catalogue.examples.find(item => item.id === id); if (!example) return;
  adopt(structuredClone(example.inputs), example);
  checkPlan();
}
function buildContextFields(panel) {
  const box = el('div', 'customer-context');
  const grid = el('div', 'customer-context-grid');
  [['buildingName', 'Building name', 'needed'], ['customer', 'Customer', 'identifies the building'], ['company', 'Cleaning company', 'identifies the building'], ['jobName', 'Job name', 'a note']].forEach(([key, label, role]) => {
    const required = role === 'needed';
    const control = input(state.input.context[key] || '', label, value => {
      invalidate(key === 'jobName' ? 'The job name changed. Record the assessment again.' : 'The company, customer or building changed. The checks belong to that place, so they were cleared.');
      if (['company', 'customer', 'buildingId', 'buildingName'].includes(key)) {
        const answered = [...Object.values(state.input.siteChecks), ...state.input.rooms.flatMap(room => Object.values(room.checks)), ...state.input.tasks.flatMap(task => [task.access, ...Object.values(task.checks.surface), ...Object.values(task.checks.manual)])].some(answer => answer !== 'UNKNOWN');
        state.input = resetBuildingChecks(state.input, key, value);
        refs.contextNotice.hidden = !answered; renderSiteChecks();
      } else state.input.context[key] = value;
      renderNavigation();
    });
    control.required = required; if (required) control.placeholder = 'For example: Riverside House';
    grid.append(field(label + ' (' + role + ')', control));
  });
  box.append(grid, el('p', 'customer-footnote', 'The building name, customer and company together identify the place. Changing any of them clears the checks, because the answers belong to that place. The job name is a note. The names themselves do not change who is assigned.'));
  const reference = details('Building reference', 'customer-building-reference');
  const identifier = input(state.input.context.buildingId, 'Automatically created building reference', () => {}); identifier.readOnly = true;
  reference.append(field('Automatically created for this plan', identifier, 'This keeps the building separate in your saved plan. You do not need to enter it.')); box.append(reference);
  refs.contextNotice = el('p', 'customer-footnote', 'The building or its owner changed. Its checks and access answers have been cleared.'); refs.contextNotice.hidden = true; refs.contextNotice.setAttribute('role', 'status'); box.append(refs.contextNotice); panel.append(box);
}
function labelFor(group, key) { return state.catalogue.checkLabels?.[group]?.[key] || key; }
function renderSiteChecks() {
  if (!refs.siteChecks) return;
  refs.siteChecks.replaceChildren();
  const title = el('div'); title.append(el('h2', '', 'The whole building'), el('p', 'customer-footnote', 'These two answers apply to every job.'));
  refs.siteChecks.append(title);
  ['accessArranged', 'siteRulesReviewed'].forEach(key => {
    const label = labelFor('site', key);
    refs.siteChecks.append(checkRow(label, tri(CHECKS, state.input.siteChecks[key], value => {invalidate('A building check changed. Record the assessment again.'); state.input.siteChecks[key] = value;}, label, 'site|' + key)));
  });
}
function updateReviewStatus() {
  if (!refs.reviewStatus || !state.input) return;
  const status = assessmentState(state.input);
  refs.reviewStatus.textContent = assessmentWords[status]; refs.reviewStatus.dataset.status = status;
}
function recordCurrentAssessment() {
  // The visible choice wins, so a pressed button and the saved decision can never disagree.
  const decision = refs.reviewChoice?.value ?? state.reviewChoice;
  // Read visible fields too, so browser autofill does not leave the saved declaration behind.
  const entered = Object.fromEntries(Object.entries(refs.reviewFields || {}).map(([key, control]) => [key, control.value]));
  state.input = {...state.input, review: {...state.input.review, ...entered}};
  invalidate('', true);
  state.reviewChoice = decision;
  try {
    state.input = recordAssessment(state.input, decision); state.staleReason = ''; renderAssessmentNotice(); refs.reviewError.hidden = true;
    if (refs.reviewSaved) refs.reviewSaved.textContent = decision === 'UNKNOWN' ? 'Nothing recorded. Choose “OK to plan” or “Needs attention” first.' : 'Saved for the entries as they are now. Any later change means recording it again.';
  } catch (error) {refs.reviewError.textContent = error.message; refs.reviewError.hidden = false; if (refs.reviewSaved) refs.reviewSaved.textContent = 'Not saved. Nothing is recorded until the problem below is fixed.';}
  refs.reviewChoiceBox?.querySelectorAll('button').forEach(node => node.setAttribute('aria-pressed', String(node.dataset.value === state.reviewChoice)));
  updateReviewStatus(); renderNavigation();
}
function renderReviewChoice() {
  refs.reviewChoice = {get value() { return refs.reviewChoiceBox.querySelector('button[aria-pressed="true"]')?.dataset.value || 'UNKNOWN'; }};
  refs.reviewChoiceBox.replaceChildren(tri(DECISION, state.reviewChoice, value => {
    invalidate('The assessment decision changed. Save the assessment again.');
    state.reviewChoice = value; syncReviewChoice(); refs.reviewSaved.textContent = 'Not saved yet. Press “Save this assessment”.';
  }, 'Assessment decision', 'review|decision'));
}
function renderReview() {
  refs.review.replaceChildren();
  const head = el('div', 'flow-assessment-head'); head.append(el('h2', '', 'Record the assessment')); refs.reviewStatus = el('span', 'customer-check-count'); head.append(refs.reviewStatus); refs.review.append(head);
  refs.review.append(el('p', 'customer-footnote', 'Last step before the plan. The person responsible says whether the entries above are right. This is a typed declaration for this example. It is not a signature or a safety approval.'));
  if (!state.input.review.date) state.input.review.date = new Date().toISOString().slice(0, 10);
  const grid = el('div', 'customer-context-grid'); refs.reviewFields = {};
  [['by', 'Checked by (typed name)'], ['date', 'Date checked'], ['reference', 'Assessment reference (a note)']].forEach(([key, label]) => {
    const update = value => {invalidate('The assessment details changed. Save the assessment again.'); state.input.review[key] = value;};
    const control = input(state.input.review[key] || '', label, update); control.addEventListener('input', () => update(control.value)); refs.reviewFields[key] = control;
    if (key === 'date') control.type = 'date'; grid.append(field(label, control));
  });
  refs.review.append(grid);
  refs.reviewChoiceBox = el('div'); refs.review.append(checkRow('Decision', refs.reviewChoiceBox));
  refs.reviewError = el('p', 'guide-input-error'); refs.reviewError.hidden = true; refs.reviewError.setAttribute('role', 'alert');
  refs.reviewSaved = el('p', 'customer-footnote'); refs.reviewSaved.setAttribute('role', 'status');
  refs.review.append(button('Save this assessment', recordCurrentAssessment, 'customer-button flow-save'), refs.reviewSaved, refs.reviewError);
  renderReviewChoice(); updateReviewStatus();
}
function renderRobotSuggestions(container) {
  container.replaceChildren(); const box = details('Other robot types to research', 'customer-robot-research');
  const types = new Set(state.input.tasks.map(task => task.type));
  const options = (state.robotOptions?.options || []).filter(option => option.taskTypes.some(type => types.has(type)));
  box.append(el('p', 'customer-footnote', 'These are products their makers describe. They are outside this team and this plan, and they are not recommendations to buy. Each would need its own site, task and safety checks.'));
  if (!state.robotOptions) box.append(el('p', '', 'The product shortlist is unavailable. Planning still works.'));
  else if (!options.length) box.append(el('p', '', 'No product match has been verified in this shortlist. A custom system would need its own design and tests.'));
  options.forEach(option => {
    const card = el('article', 'customer-research-card'); card.append(el('h3', '', option.name));
    const badges = el('div', 'customer-research-badges'); badges.append(el('span', '', 'Not in your team'), el('span', '', 'Not tested here')); card.append(badges);
    card.append(el('p', '', option.summary));
    if (option.checks?.length) card.append(list(option.checks, ''));
    try {const url = new URL(option.sourceUrl); if (url.protocol === 'https:') {const link = el('a', '', option.sourceTitle || 'Manufacturer source'); link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; card.append(link);}} catch {}
    card.append(el('p', 'customer-footnote', option.manufacturer + ' · Source checked ' + (state.robotOptions.researchedOn || 'as listed'))); box.append(card);
  });
  container.append(box);
}
function renderRooms() {
  const box = el('section', 'customer-room-list'); box.append(el('h2', '', 'Each room, once'), el('p', 'customer-footnote', 'Every job in a room shares these answers. If one needs attention, all jobs in that room stop.'));
  state.input.rooms.forEach(room => {
    const card = el('article', 'customer-room'); card.dataset.roomId = room.id;
    const name = input(room.name, 'Name for ' + room.name, value => {
      if (!value.trim() || state.input.rooms.some(other => other.id !== room.id && nameKey(other.name) === nameKey(value))) {name.setCustomValidity('Use a different room name, or choose the existing room.'); name.reportValidity(); name.value = room.name; return;}
      name.setCustomValidity(''); invalidate('A room was renamed. Its shared checks and the checks for its jobs were cleared.'); state.input = renameRoom(state.input, room.id, value); refresh(renderChecks);
    });
    card.append(field('Room or area name', keyed(name, 'roomname|' + room.id)));
    ['routes', 'people', 'hazards'].forEach(key => {
      const label = labelFor('room', key);
      const control = tri(CHECKS, room.checks[key], value => {invalidate('A shared room check changed. Record the assessment again.'); state.input.rooms = updateRoomCheck(state.input.rooms, room.id, key, value);}, label + ' — ' + room.name, 'room|' + room.id + '|' + key);
      control.dataset.roomId = room.id; control.dataset.roomCheck = key; card.append(checkRow(label, control));
    });
    box.append(card);
  });
  refs.places.append(box);
}
function chooseTaskPlace(task, roomId, placeId, place) {
  invalidate('A job moved to another place. Its access, method and person answers were cleared.');
  state.input.tasks = moveTaskPlace(state.input.tasks, task.id, roomId, placeId, place); refresh(renderChecks);
}
function addRoomForTask(task) {
  let n = state.roomCounter + 1; while (state.input.rooms.some(room => nameKey(room.name) === nameKey('Room ' + n))) n++;
  const room = newRoom('Room ' + n); chooseTaskPlace(task, room.id, 'place-' + (++state.placeCounter), friendly[task.type][3]);
}
function jobCard(task, index) {
  const card = el('article', 'customer-place'); card.dataset.taskId = task.id; const top = el('div', 'customer-place-head');
  top.append(graphic(task.type), el('h2', '', friendly[task.type][0]), button('Remove', () => removeJob(task), 'customer-remove'));
  card.append(top);
  const current = () => state.input.tasks.find(item => item.id === task.id);
  const changeTask = (key, value) => {
    invalidate(key === 'method' ? 'A cleaning method changed. Its method and person answers were cleared.' : 'The way a place is reached changed. That job’s answers were cleared.');
    state.input.tasks = resetChangedTask(state.input.tasks, task.id, key, value);
    if (key === 'access') refresh(renderChecks); else {syncChecks(); card.querySelector('[data-reset-note]').hidden = false; renderNavigation();}
  };
  const grid = el('div', 'customer-location-fields');
  const rooms = select(state.input.rooms.map(room => [room.id, room.name]), task.roomId, value => {
    const existing = state.input.tasks.find(other => other.roomId === value); chooseTaskPlace(task, value, existing?.placeId || 'place-' + (++state.placeCounter), existing?.place || friendly[task.type][3]);
  }, 'Room for job ' + (index + 1));
  const roomField = field('Room or area', keyed(rooms, 'roomsel|' + task.id)); roomField.append(keyed(button('+ Add another room', () => addRoomForTask(task), 'customer-text-link'), 'addroom|' + task.id));
  const available = [...new Map(state.input.tasks.filter(other => other.roomId === task.roomId).map(other => [other.placeId, other.place])).entries()];
  const places = select(available, task.placeId, value => chooseTaskPlace(task, task.roomId, value, available.find(([id]) => id === value)[1]), 'Place for job ' + (index + 1));
  const placeField = field('Exact place', keyed(places, 'placesel|' + task.id)); placeField.append(keyed(button('+ Add another place', () => chooseTaskPlace(task, task.roomId, 'place-' + (++state.placeCounter), newPlaceName(task.roomId, 'Place 1')), 'customer-text-link'), 'addplace|' + task.id));
  grid.append(roomField, placeField); card.append(grid);
  const name = input(task.place, 'Place name for job ' + (index + 1), value => {
    if (!value.trim() || state.input.tasks.some(other => other.roomId === task.roomId && other.placeId !== task.placeId && nameKey(other.place) === nameKey(value))) {name.setCustomValidity('This place already has an entry. Choose it from the list.'); name.reportValidity(); name.value = task.place; return;}
    name.setCustomValidity(''); invalidate('A place was renamed. The answers for that place were cleared.'); state.input.tasks = renamePlace(state.input.tasks, task.id, value); refresh(renderChecks);
  });
  card.append(field('Name of this place', keyed(name, 'placename|' + task.id), 'A rename updates every job at this same place.'));
  const method = input(task.method, 'Cleaning method for job ' + (index + 1), value => changeTask('method', value)); method.maxLength = 300; method.placeholder = 'For example: damp cloth and the agreed cleaning product';
  card.append(field('How will this be cleaned?', keyed(method, 'method|' + task.id)));
  const resetNote = el('p', 'customer-footnote', 'The method changed, so this job’s method and person answers below were cleared.'); resetNote.dataset.resetNote = ''; resetNote.hidden = true; resetNote.setAttribute('role', 'status'); card.append(resetNote);
  const accessOptions = task.type === 'facade' ? [['UNKNOWN', 'Not checked'], ['SPECIALIST', 'Specialist access']] : [['UNKNOWN', 'Not checked'], ['ORDINARY', 'From the floor, ordinary access'], ['SPECIALIST', 'Specialist access needed']];
  card.append(field('How is this place reached?', keyed(select(accessOptions, task.access, value => changeTask('access', value), 'Access for job ' + (index + 1)), 'access|' + task.id)));
  const groups = el('div', 'flow-check-groups');
  [['surface', 'The surface', ['permission', 'condition', 'method']], ['manual', 'A person doing this by hand', ['permission', 'equipment', 'training']]].forEach(([group, title, keys]) => {
    const box = el('div', 'flow-check-group'); box.append(el('h3', '', title));
    keys.forEach(key => {
      const label = labelFor(group, key), shared = group === 'surface' && key !== 'method';
      const control = tri(key === 'permission' ? PERMISSION : CHECKS, task.checks[group][key], value => {
        invalidate('A check changed. Record the assessment again.'); state.input.tasks = updateTaskCheck(state.input.tasks, task.id, group, key, value);
        if (shared) syncChecks();
      }, label + ' — job ' + (index + 1), 'job|' + task.id + '|' + group + '|' + key);
      control.dataset.taskId = task.id; control.dataset.checkGroup = group; control.dataset.checkKey = key;
      box.append(checkRow(label, control, shared ? 'Shared by every job at this place.' : ''));
    });
    groups.append(box);
  });
  card.append(groups);
  if (task.type === 'facade' || task.access === 'SPECIALIST') {
    const special = el('div', 'customer-specialist'); special.append(el('strong', '', 'Specialist access is needed'), el('p', 'customer-footnote', 'This work needs a specialist plan made outside this app. No answer here can approve it. Robot and drone products listed later are leads to research, not assignments.'));
    const accessPlan = input(task.specialist.accessPlan, 'Specialist access plan', value => {invalidate(); current().specialist.accessPlan = value;}); accessPlan.maxLength = 300; accessPlan.dataset.specialistPlan = task.id;
    special.append(field('Proposed access plan (a note)', accessPlan));
    [['weather', 'Weather has been checked'], ['ground', 'Ground and set-up area have been checked'], ['publicProtection', 'People outside the work area are protected']].forEach(([key, label]) => {
      special.append(checkRow(label, tri(CHECKS, task.specialist[key], value => {invalidate(); current().specialist[key] = value;}, label, 'special|' + task.id + '|' + key), 'Recorded as a note for the specialist.'));
    });
    card.append(special);
  } else if (task.access === 'UNKNOWN') card.append(el('p', 'customer-footnote', 'How this place is reached is not checked yet, so nobody can be assigned.'));
  const order = details('Order of work');
  card.dataset.orderReview = String(state.orderReview.includes(task.id));
  order.open = state.orderReview.includes(task.id) || task.round !== 1 || Boolean(task.dependsOn);
  const fields = el('div', 'customer-order-fields');
  fields.append(field('When in the plan?', keyed(select([['1', 'Stage 1'], ['2', 'Stage 2']], task.round, value => {invalidate(); replaceTasks(updateTaskRound(state.input.tasks, task.id, Number(value))); refresh(renderChecks);}, 'Stage for job ' + (index + 1)), 'stage|' + task.id)));
  const options = [['', 'No earlier job needed'], ...state.input.tasks.filter(row => row.round < task.round).map(row => [row.id, friendly[row.type][0] + ' · ' + roomName(row) + ' / ' + row.place])];
  fields.append(field('Wait for another job?', select(options, task.dependsOn || '', value => {invalidate(); current().dependsOn = value || null;}, 'Dependency for job ' + (index + 1))));
  order.append(fields, el('p', 'customer-footnote', 'A job that waits for an earlier one stays unassigned. The app cannot know when real work is finished.'));
  card.append(order);
  return card;
}
function renderChecks() {
  state.input.rooms = state.input.rooms.filter(room => state.input.tasks.some(task => task.roomId === room.id));
  renderSiteChecks();
  refs.places.replaceChildren(); renderRooms();
  refs.places.append(el('h2', 'flow-section-title', 'Each job'));
  state.input.tasks.forEach((task, index) => refs.places.append(jobCard(task, index)));
  const add = el('div', 'customer-add-jobs'); add.append(el('span', '', 'Same job at another place?'));
  [...new Set(state.input.tasks.map(task => task.type))].forEach(type => {
    const another = button('+ ' + friendly[type][0].replace(/^Wipe /, '').replace(/^Clean /, '').replace(/^Empty /, ''), () => {addTask(type); renderChecks();}, 'customer-add');
    another.disabled = state.input.tasks.length >= (state.catalogue.limits?.maxTasks || 12); add.append(another);
  });
  refs.places.append(add); renderReview(); renderNavigation();
}
function renderTeam() {
  refs.people.replaceChildren();
  refs.people.append(el('h2', 'flow-section-title', 'People'));
  const peopleGrid = el('div', 'flow-people-grid'); refs.people.append(peopleGrid);
  state.input.people.forEach(person => {
    const source = state.catalogue.people.find(item => item.id === person.id), roles = state.catalogue.personRoles?.[person.id] || [];
    const card = el('article', 'customer-person'); const head = el('div', 'customer-person-head'); head.append(graphic('person'), el('h2', '', person.label || source?.label || person.id)); card.append(head);
    const skills = el('p', 'customer-skills');
    const updateSkills = () => {
      const known = [...new Set([...(source?.baseTraining || []), ...person.additionalTraining])].map(skill => skillLabels[skill] || skill.replaceAll('_', ' '));
      skills.textContent = 'Can clean by hand: ' + (known.length ? known.join(', ') : 'nothing declared');
    };
    updateSkills(); card.append(skills, el('p', 'customer-skills', 'With robots: ' + roleWords(roles)));
    [1, 2].forEach(round => card.append(checkRow('Stage ' + round, tri(AVAILABILITY, person.availability['round-' + round], value => {invalidate('A person’s availability changed. Record the assessment again.'); person.availability['round-' + round] = value;}, (person.label || source?.label || person.id) + ' in stage ' + round, 'person|' + person.id + '|' + round))));
    card.append(el('p', 'customer-footnote', 'Free means available. It is not an OK to start, and it is not the person’s consent.'));
    const more = details('Change the name or declared skills');
    more.append(field('Name in this example', input(person.label || source?.label || person.id, 'Name for ' + person.id, value => {invalidate('A person’s details changed. Record the assessment again.'); person.label = value; head.querySelector('h2').textContent = value || source?.label || person.id; renderRobots();}), 'A label only. It does not verify who the person is.'));
    more.append(el('p', 'customer-footnote', 'A tick records your statement that the person has this skill. It does not certify them.'));
    const options = el('div', 'customer-skill-options');
    Object.entries(skillLabels).forEach(([skill, label]) => {
      const row = el('label', 'customer-checkbox'); const check = el('input'); check.type = 'checkbox';
      check.checked = person.additionalTraining.includes(skill) || (source?.baseTraining || []).includes(skill);
      check.disabled = (source?.baseTraining || []).includes(skill);
      check.addEventListener('change', () => {invalidate('A declared skill changed. Record the assessment again.'); person.additionalTraining = check.checked ? [...new Set([...person.additionalTraining, skill])] : person.additionalTraining.filter(value => value !== skill); updateSkills();});
      row.append(check, el('span', '', label + (check.disabled ? ' · already declared' : ''))); options.append(row);
    });
    more.append(options); card.append(more); peopleGrid.append(card);
  });
  renderRobots(); renderRobotSuggestions(refs.teamSuggestions);
}
function renderRobots() {
  refs.robots.replaceChildren();
  const title = el('div', 'customer-robot-heading'); title.append(el('h2', '', 'Robots'), el('p', '', 'Each robot needs a person with a named role, shown on its card. The robot evidence in this app does not cover a new building, so only people can be assigned when the checks pass. You can still record which robots you have.'));
  refs.robots.append(title); const choices = el('div', 'flow-robot-grid');
  (state.catalogue.robotProfiles || []).forEach(profile => {
    const selected = state.input.robots.includes(profile.platform);
    const card = el('article', 'flow-robot'); card.dataset.selected = String(selected);
    const head = el('div', 'customer-person-head'); head.append(graphic('robot'), el('h3', '', profile.platform + ' · ' + profile.label)); card.append(head);
    card.append(el('p', '', profile.shown));
    const helpers = profile.peopleWithRoles.map(personName);
    const pair = el('p', 'flow-pair'); const plus = el('span', 'flow-pair-icon', '+'); plus.setAttribute('aria-hidden', 'true');
    pair.append(plus, el('span', '', 'Needs ' + (helpers.join(' or ') || 'a trained person') + '. ' + profile.needsPerson.join(' ')));
    card.append(pair, el('p', 'flow-robot-limit', '⌂ ' + profile.newBuilding));
    const toggle = button(selected ? '✓ On this team' : '+ Add to this team', () => {invalidate('The robots on the team changed. Record the assessment again.'); state.input.robots = selected ? state.input.robots.filter(value => value !== profile.platform) : [...state.input.robots, profile.platform]; keepFocus(renderRobots);}, 'flow-robot-toggle');
    toggle.setAttribute('aria-pressed', String(selected)); toggle.setAttribute('aria-label', profile.platform + (selected ? ': on this team' : ': add to this team')); toggle.dataset.focusKey = 'robot|' + profile.platform;
    card.append(toggle); choices.append(card);
  });
  refs.robots.append(choices, button('See these robots in their tested examples →', () => document.dispatchEvent(new CustomEvent('fieldwork:open-tested')), 'customer-text-link'));
}
async function post(payload, signal) {
  const response = await fetch('/api/customer', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload), cache: 'no-store', signal});
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'The planner could not check this job.');
  return result;
}
async function checkPlan() {
  if (!placesValid()) {showStep(3); return;}
  state.controller?.abort(); const controller = new AbortController(); state.controller = controller;
  const token = state.gate.next(); const submitted = structuredClone(state.input);
  state.result = null; state.error = ''; state.pending = true; state.comparison = null; refs.error.hidden = true;
  renderResult(); showStep(4);
  try {
    const result = await post(submitted, controller.signal); if (!state.gate.accepts(token)) return;
    if (!Array.isArray(result.rows) || result.rows.length !== submitted.tasks.length || !result.export || typeof result.exportText !== 'string') throw new Error('The service returned an incomplete plan.');
    if (result.rows.some(row => !submitted.tasks.some(task => task.id === row.id))) throw new Error('The answer does not match these jobs.');
    let comparison = null; const example = state.example;
    if (example?.compareWith && !state.exampleEdited) {
      const base = state.catalogue.examples.find(item => item.id === example.compareWith);
      if (base) {
        try {const before = await post(base.inputs, controller.signal); comparison = {title: base.title, rows: before.rows};} catch (error) {if (error.name === 'AbortError') throw error;}
        if (!state.gate.accepts(token)) return;
      }
    }
    state.result = result; state.comparison = comparison; state.pending = false; state.staleReason = ''; renderAssessmentNotice(); renderResult(); renderNavigation();
  } catch (error) {
    if (!state.gate.accepts(token)) return;
    state.result = null; state.pending = false; state.error = error.name === 'TypeError' ? 'The planning service could not be reached. Nothing was planned.' : (error.message || 'Please try again.');
    renderResult(); refs.error.textContent = 'No plan is available. ' + state.error; refs.error.hidden = false; renderNavigation();
  }
}
function rowLabel(row) { return (friendly[row.type]?.[0] || row.label) + ' · ' + row.place; }
function renderExampleBanner(result) {
  if (!state.example) return;
  const banner = el('section', 'flow-example-banner'); banner.setAttribute('aria-label', 'About this example');
  banner.append(el('span', 'guide-kicker', state.exampleEdited ? 'STARTED FROM AN EXAMPLE · YOU CHANGED IT' : 'EXAMPLE · INVENTED ANSWERS'), el('h2', '', state.example.title));
  if (!state.exampleEdited) {
    banner.append(el('p', '', 'What is set: ' + state.example.changed), el('p', '', 'Look for: ' + state.example.lookFor));
    if (state.comparison) {
      const withNames = rows => rows.map(row => ({...row, personLabel: row.person ? personName(row.person) : null}));
      const rows = compareRows(withNames(state.comparison.rows), withNames(result.rows), rowLabel);
      const table = el('table', 'flow-table'); const head = el('tr'); ['Job', 'In “' + state.comparison.title + '”', 'In this example'].forEach(text => head.append(el('th', '', text))); table.append(head);
      rows.forEach(row => {const line = el('tr'); line.dataset.changed = String(row.changed); [row.job, row.before, (row.changed ? '→ ' : '') + row.after].forEach(text => line.append(el('td', '', text))); table.append(line);});
      banner.append(table);
    }
  }
  banner.append(button('Change the answers yourself →', () => showStep(3), 'customer-text-link'));
  refs.results.append(banner);
}
function robotSection(coverage) {
  const box = el('div', 'flow-why-block'); box.append(el('h4', '', 'Could a robot do it?'), el('p', '', 'Not here. ' + coverage.wholeJob));
  (coverage.parts || []).forEach(part => {
    const view = partView(part), item = details(view.title + ' · ' + view.status, 'flow-part');
    item.append(el('p', '', view.summary));
    if (view.assumption) item.append(el('p', 'flow-assumption', view.assumption));
    if (view.recordsNote) item.append(el('p', 'customer-footnote', view.recordsNote));
    if (part.selector?.called === false && part.selector.reason) item.append(el('p', 'customer-footnote', part.selector.reason));
    if (view.ruleNote) item.append(el('p', 'customer-footnote', view.ruleNote));
    item.append(el('strong', '', 'Evidence gaps'), list(view.needed));
    box.append(item);
  });
  if (coverage.gapsNote) box.append(el('p', 'customer-footnote', coverage.gapsNote));
  if (coverage.routeNote) box.append(el('p', 'flow-route-note', coverage.routeNote));
  box.append(el('p', 'customer-footnote', 'A detection record or a simulated wipe never counts as a tested cleaning job in this building. Team robots: ' + (state.input.robots.join(', ') || 'none') + '.'));
  return box;
}
function resultRow(row, result, sharedBlocked) {
  const card = el('article', 'customer-result-row'); const badge = rowBadge(row, row.person ? personName(row.person) : null);
  card.dataset.tone = badge.tone; card.dataset.state = row.state;
  const top = el('div', 'customer-result-top'); const title = el('div'); title.append(el('h3', '', friendly[row.type]?.[0] || row.label), el('p', 'customer-result-place', row.room + ' / ' + row.place));
  const mark = el('span', 'customer-result-badge'); const icon = el('span', '', badge.icon + ' '); icon.setAttribute('aria-hidden', 'true'); mark.append(icon, document.createTextNode(badge.text));
  top.append(title, mark); card.append(top);
  card.append(el('p', 'customer-result-reason', row.reason));
  const next = el('p', 'customer-next-action'); next.append(el('strong', '', 'Next: '), document.createTextNode(row.nextAction));
  if (row.fixStep && !(sharedBlocked && ['BLOCKED_SHARED', 'WITHHELD_SHARED'].includes(row.state))) next.append(document.createTextNode(' '), button('Go to ' + STEPS[row.fixStep - 1] + ' →', () => showStep(row.fixStep), 'customer-text-link'));
  card.append(next);
  const proof = details('Why this result?');
  const decided = decidedLines(row), people = peopleLines(row);
  if (decided.length) {const box = el('div', 'flow-why-block'); box.append(el('h4', '', 'The answers that decided it'), list(decided)); proof.append(box);}
  if (people.length) {const box = el('div', 'flow-why-block'); box.append(el('h4', '', 'Each person'), list(people), el('p', 'customer-footnote', 'Skill needed: ' + (skillLabels[row.requiredTraining] || row.requiredTraining) + '. Skills and availability are your declarations.')); proof.append(box);}
  const coverage = result.robotChecks?.[row.id]; if (coverage) proof.append(robotSection(coverage));
  card.append(proof); return card;
}
async function verifyDownload(status) {
  status.textContent = 'Checking…';
  try {
    const response = await fetch('/api/replay', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({exportText: state.result.exportText}), cache: 'no-store'});
    const value = await response.json();
    if (!response.ok || value.verified !== true) throw new Error(value.error || 'The check could not be completed.');
    status.textContent = '✓ Worked out again from your saved answers. The result is the same. This does not check whether the answers are true or whether work is safe.';
  } catch (error) {status.textContent = 'Not confirmed. ' + (error.name === 'TypeError' ? 'The planning service could not be reached.' : error.message);}
}
function customerPdfControl() {
  return planPdfButton(() => customerPlanReport(state.result, {exampleTitle: state.example?.title || '', exampleEdited: state.exampleEdited, names: Object.fromEntries((state.result?.effectiveInputs?.people || []).map(person => [person.id, personName(person.id)]))}), 'fieldwork-building-plan.pdf');
}
function renderReproduce(result) {
  const box = details('Save and check this plan'); box.classList.add('flow-reproduce');
  box.append(el('p', '', 'Save a copy of your answers and plan. Or check that the same answers give the same plan.'));
  const actions = el('div', 'flow-actions'); const status = el('p', 'customer-footnote'); status.setAttribute('role', 'status');
  actions.append(customerPdfControl(), button('Check it now', () => verifyDownload(status), 'customer-button'));
  const research = details('Research export (JSON)');
  research.append(el('p', 'customer-footnote', 'The exact planning data for research and replay. Use Download PDF for a readable copy.'), button('Download research JSON', () => {if (state.result?.exportText) planDownload(state.result.exportText, 'fieldwork-building-plan.json');}, 'customer-button'));
  box.append(research);
  box.append(actions, status, el('p', 'customer-footnote', 'This repeats the planning calculation only. It does not rerun a robot study, a G1 simulation or any cleaning.'));
  return box;
}
function renderResult() {
  refs.results.replaceChildren(); refs.results.setAttribute('aria-busy', String(state.pending));
  if (state.pending) {refs.results.append(el('div', 'customer-loading', 'Checking your jobs, team and answers…')); return;}
  if (!state.result) {refs.results.append(button('Try again', checkPlan, 'guide-primary'), button('← Check my answers', () => showStep(3), 'guide-back')); return;}
  const result = state.result;
  renderExampleBanner(result);
  const context = result.effectiveInputs?.context || state.input.context;
  const identity = el('div', 'customer-plan-identity');
  identity.append(el('h2', '', context.jobName || 'Cleaning job'), el('p', '', context.buildingName));
  const parties = [context.company ? 'Company: ' + context.company : null, context.customer ? 'Customer: ' + context.customer : null].filter(Boolean);
  if (parties.length) identity.append(el('p', '', parties.join(' · '))); refs.results.append(identity);
  const headline = el('p', 'flow-headline', result.summary?.sentence || ''); headline.setAttribute('role', 'status'); refs.results.append(headline);
  const summary = el('div', 'customer-plan-summary');
  [[result.summary.manualPlanned, 'assigned to people'], [result.summary.needAttention, 'need attention'], [result.summary.robotAssigned, 'assigned to robots']].forEach(([count, label]) => {const item = el('div'); item.append(el('strong', '', count), el('span', '', label)); summary.append(item);});
  refs.results.append(summary);
  const reviewMessages = {current: 'The recorded assessment matches these answers. It is a declaration, not an authenticated approval.', rejected: 'The recorded assessment says this job needs attention.', missing: 'No assessment is recorded for these answers.', incomplete: 'The assessment needs a name, a date and a decision.', stale: 'The entries changed after the assessment was recorded, so it no longer counts.'};
  const sharedBlocked = result.assessment?.siteSafety && result.assessment.siteSafety !== 'PASS';
  if (sharedBlocked) {
    const banner = el('div', 'customer-assessment-stale'); const mark = el('span', 'flow-notice-icon', '!'); mark.setAttribute('aria-hidden', 'true');
    banner.append(mark, el('p', '', 'The whole plan waits. ' + (reviewMessages[result.reviewStatus?.status] || '') + ' Finish the building checks and record the assessment in Checks.'), button('Go to Checks →', () => showStep(3), 'customer-button')); refs.results.append(banner);
  } else refs.results.append(el('p', 'customer-assessment-note', reviewMessages[result.reviewStatus?.status] || ''));
  [1, 2].forEach(round => {
    const rows = result.rows.filter(row => Number(row.round) === round); if (!rows.length) return;
    const group = el('section', 'customer-plan-stage'); group.append(el('h2', '', 'Stage ' + round));
    rows.forEach(row => group.append(resultRow(row, result, sharedBlocked))); refs.results.append(group);
  });
  refs.results.append(el('p', 'customer-footnote', 'An assignment is a plan. It is not finished work and not an instruction to start. Stages show order only.'));
  const more = el('section', 'flow-more');
  const asked = details('What did I ask for?'); const given = result.effectiveInputs;
  const words = {UNKNOWN: 'not checked', AVAILABLE: 'free', BUSY: 'busy', ORDINARY: 'from the floor', SPECIALIST: 'specialist access'};
  asked.append(el('strong', '', 'Jobs'), list(given.tasks.map(task => (friendly[task.type]?.[0] || task.type) + ' at ' + (given.rooms.find(room => room.id === task.roomId)?.name || '') + ' / ' + task.place + ' · stage ' + task.round + ' · ' + (task.method ? 'method: ' + task.method : 'no method given') + ' · reached: ' + words[task.access] + (task.dependsOn ? ' · waits for an earlier job' : ''))));
  asked.append(el('strong', '', 'Team'), list([...given.people.map(person => personName(person.id) + ': stage 1 ' + words[person.availability['round-1']] + ', stage 2 ' + words[person.availability['round-2']]), 'Robots on the team: ' + (given.robots.join(', ') || 'none')]));
  asked.append(el('p', 'customer-footnote', 'The answers that changed a result are listed under that job’s “Why this result?”.')); more.append(asked);
  const after = details('After the work: record what happened');
  after.append(el('p', '', 'When a job is finished, you can record what happened. The supervisor’s check is recorded separately. The record stays in this browser. It does not change this plan or what a robot may be offered.'));
  // Each job is offered with a complete copy of how it was planned, so a saved note keeps the building, place and method asked for.
  const planned = typeof result.export?.digest === 'string' ? result.rows.map(row => ({digest: result.export.digest, release: String(result.release || ''), buildingId: given.context.buildingId, buildingName: given.context.buildingName, customer: given.context.customer || '', company: given.context.company || '',
    taskId: row.id, jobType: row.type, jobLabel: friendly[row.type]?.[0] || row.label, roomId: row.roomId, roomName: row.room, placeId: row.placeId, placeName: row.place, method: given.tasks.find(task => task.id === row.id)?.method || '', stage: Number(row.round),
    plannedState: row.state, plannedText: rowBadge(row, row.person ? personName(row.person) : null).text, inventedExample: Boolean(state.example && !state.exampleEdited)})) : [];
  after.append(button('Record a job outcome', () => document.dispatchEvent(new CustomEvent('fieldwork:open-registry', {detail: {tab: 'reviews', jobs: planned}})), 'customer-button'));
  more.append(after);
  refs.results.append(more);
  const saved = el('div', 'flow-actions flow-plan-actions');
  const save = customerPdfControl();
  const technical = button('About this plan', openTechnicalDetails, 'customer-text-link');
  technical.setAttribute('aria-haspopup', 'dialog'); technical.setAttribute('aria-controls', 'customer-technical-dialog');
  saved.append(save, technical); refs.results.append(saved);
  const suggestions = el('div'); renderRobotSuggestions(suggestions); refs.results.append(suggestions);
  const actions = el('div', 'customer-navigation'); actions.append(button('← Change my answers', () => showStep(3), 'guide-back'), button('Plan another job', startEmpty, 'guide-secondary')); refs.results.append(actions);
}
async function load() {
  try {
    const response = await fetch('/api/customer', {cache: 'no-store'}); const catalogue = await response.json();
    if (!response.ok || !Array.isArray(catalogue.taskTypes) || !catalogue.defaultInputs) throw new Error('The job planner is not available yet.');
    if (catalogue.schemaVersion !== 3 || catalogue.defaultInputs.schemaVersion !== 3 || !Array.isArray(catalogue.robotProfiles)) throw new Error('This page needs the matching planning service. Refresh after updating the app.');
    state.catalogue = catalogue; state.input = structuredClone(catalogue.defaultInputs);
    if (!state.input.context.buildingId.trim()) state.input.context.buildingId = newBuildingReference();
    state.input.robots ??= []; state.input.tasks ??= []; state.input.rooms ??= [];
    state.counter = state.input.tasks.length; build();
  } catch (error) {
    root.replaceChildren(); const message = el('div', 'error-panel', 'The planning service could not load, so no plan can be made. ' + (error.name === 'TypeError' ? 'It could not be reached.' : error.message)); message.setAttribute('role', 'alert'); root.append(message, button('Try again', load, 'guide-primary'));
  }
}
document.addEventListener('fieldwork:customer-home', () => {if (state.input) showStep(1);});
fetch('/robot-options.json', {cache: 'no-store'}).then(response => response.ok ? response.json() : null).then(value => {if (value?.schemaVersion === 1 && Array.isArray(value.options)) {state.robotOptions = value; if (refs.teamSuggestions) renderRobotSuggestions(refs.teamSuggestions);}}).catch(() => {});
load();
