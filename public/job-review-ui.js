import {jobReviewsReport, planPdfButton} from './plan-report.mjs';
// The "Job reviews" tab of the notebook: what happened after a job, and the supervisor's check of it.
// Nothing here is sent anywhere. A job review never changes a plan or what a robot may be offered.
import { HAPPENED, DONE_BY, DIFFICULTIES, JUDGEMENTS, summarise, subject, checkState, isExample } from './job-review-store.js';

export const WORDS = Object.freeze({
  happened: {COMPLETED: 'Completed', PARTLY: 'Partly completed', STOPPED: 'Stopped', NOT_STARTED: 'Not started', UNKNOWN: 'Not known'},
  doneBy: {PERSON: 'A person', ROBOT: 'A robot', ROBOT_WITH_HELP: 'A robot with human help', NOBODY: 'Nobody (not started)', UNKNOWN: 'Not known'},
  difficulties: {INTERVENTION: 'Someone had to step in', REPEAT: 'Part was cleaned again', EQUIPMENT: 'Equipment problem', OTHER: 'Another difficulty'},
  check: {ACCEPTED: 'Result: Accepted', MORE_WORK: 'Result: Needs more work', NOT_CHECKED: 'Not checked', CHECK_AGAIN: 'Changed after its check: check again'},
  judgement: {ACCEPTED: 'Accepted', MORE_WORK: 'Needs more work'},
});
export const LIMIT_NOTE = 'These are counts of typed notes. Nothing checks that a note describes real work. They are not a success rate, and they do not change what a robot may be offered.';
export const EXAMPLE_NOTE = 'This note is marked as an invented example, so it is left out of the counts. A note gets this mark from the example button, or by being started from or linked to a plan made from an invented example. The mark stays if the note is later detached or linked to another job.';
export const EXAMPLE_LINK_NOTE = 'This plan was made from an invented example. Linking marks the note as an invented example and leaves it out of the counts. That mark cannot be taken off.';
export const STALE_NOTE = 'The note below now shows what is saved. Read it again before you record anything.';
export const NOT_LISTED_NOTE = 'The note is not in the list now. It may have been archived in another tab or window. Tick “Show archived” to see it.';
export const RELOADED_NOTE = 'This note was changed in another tab or window. It now shows what is saved. Nothing you had entered for it was saved.';
export const OUT_OF_DATE_NOTE = 'Out of date: this note was changed in another tab or window. What is shown here is no longer what is saved.';
export const CHANGED_ELSEWHERE_NOTE = 'Job reviews were changed in another tab or window. Notes marked “Out of date” no longer show what is saved, and anything recorded from them will be refused.';
export const LINK_NOTE = 'This is a copy of the planned job the note was started from. It does not show that the work happened, and it is not a verified approval. The app does not check that the plan can still be worked out again.';
export const HISTORY_NOTE = 'Changing what happened, or which job a note is about, removes the recorded check. Earlier answers and earlier checks are not kept.';
export const PATHWAY = Object.freeze([
  ['Outcome recorded here', 'A note in this browser about what happened.'],
  ['Result checked by the supervisor', 'The supervisor’s typed judgement of the result against what the job asked for. The name is not verified.'],
  ['Technical review of the evidence', 'Not in this app. A technical reviewer decides what the evidence shows and under which conditions. A supervisor accepting the result does not do this.'],
  ['Reviewed capability record', 'Not possible in this app. An accepted job in one place does not show that a robot can do the job somewhere else.'],
]);

// Turn the form's answers into one consistent outcome. A job that was not started has nobody who did it and no extra help.
export function outcomeValues(raw) {
  const notStarted = raw.happened === 'NOT_STARTED';
  return {
    workDate: raw.workDate || '', happened: raw.happened, doneBy: notStarted ? 'NOBODY' : raw.doneBy, doneByName: notStarted ? '' : raw.doneByName || '',
    difficulties: notStarted ? [] : [...(raw.difficulties || [])], differed: raw.differed || '', note: raw.note || '', evidence: raw.evidence || '',
  };
}

// The read-only lines shown for a note that is tied to a planned job.
export function planLines(plan) {
  const who = [plan.customer, plan.company].filter(Boolean).join(' · ');
  return [
    ['Building', plan.buildingName + (who ? ' (' + who + ')' : '')],
    ['Place', plan.roomName + ' / ' + plan.placeName],
    ['Job', plan.jobLabel],
    ['Method asked for', plan.method || 'No method was given in the plan'],
    ['Stage', String(plan.stage)],
    ['The plan said', plan.plannedText],
    ...(plan.inventedExample ? [['Source', 'This plan was made from an invented example. A note started from it is not a record of real work and is left out of the counts.']] : []),
  ];
}
// Two copies describe the same planned job when every field agrees, whatever order the fields are in.
export const samePlan = (a, b) => Boolean(a && b) && Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(key => a[key] === b[key]);
export const planOption = plan => 'Stage ' + plan.stage + ' · ' + plan.jobLabel + ' · ' + plan.roomName + ' / ' + plan.placeName;

// Known invented examples are named on their own and never added to the ordinary counts.
export function examplesSentence(count) {
  if (!count) return '';
  return count === 1 ? '1 invented example is shown below and is not counted.' : count + ' invented examples are shown below and are not counted.';
}
export function countsSentence(reviews) {
  const counts = summarise(reviews), examples = examplesSentence(counts.examples);
  if (!counts.total) return examples ? 'No job reviews of your own yet. ' + examples : 'No job reviews yet.';
  const plural = counts.total === 1 ? '1 job review' : counts.total + ' job reviews';
  const needs = counts.moreWork === 1 ? '1 needs more work' : counts.moreWork + ' need more work';
  return plural + ': ' + counts.accepted + ' accepted, ' + needs + ', ' + counts.notChecked + ' not checked. Extra help was recorded in ' + counts.extraHelp + '.' + (examples ? ' ' + examples : '');
}
// The counts beside the first two steps of the pathway. They come from the same summary, so examples are left out here too.
export function pathwayCounts(reviews) {
  const counts = summarise(reviews);
  return [counts.total + ' recorded', (counts.accepted + counts.moreWork) + ' checked', 'Not in this app', '0 of your entries'];
}

// The message after an edit says plainly whether the earlier check survived.
export function editMessage(before, after) {
  if (after.contentVersion === before.contentVersion) return 'Nothing was changed.' + (after.check ? ' The recorded check is kept.' : '');
  const marked = !isExample(before) && isExample(after) ? ' It is now marked as an invented example and is left out of the counts.' : '';
  if (before.check) return 'Saved. The note had been checked, and what you changed removed that check. It needs checking again.' + marked;
  return 'Job outcome updated. It has not been checked.' + marked;
}

export function exampleReview(date) {
  return {
    outcome: {job: 'EXAMPLE (invented): wipe a whiteboard', place: 'Invented example. No such job was done.', workDate: date, happened: 'COMPLETED', doneBy: 'ROBOT_WITH_HELP',
      doneByName: 'Invented robot', difficulties: ['REPEAT'], differed: '', evidence: '', example: true,
      note: 'Invented: the robot finished, but the supervisor wiped one corner again. A plain “completed” tick would have hidden that help.'},
    check: {acceptance: 'ACCEPTED', checkedBy: 'Example supervisor (invented)', checkedOn: date, note: 'Invented check.'},
  };
}

// Which notes on screen no longer match what is saved, and how many saved notes are not on screen at all.
export function changedElsewhere(shown, saved) {
  const latest = new Map(saved.map(review => [review.id, review.version])), onScreen = new Set(shown.map(note => note.id));
  return {outOfDate: shown.filter(note => latest.get(note.id) !== note.version).map(note => note.id), added: saved.filter(review => !onScreen.has(review.id) && !review.archivedAt).length};
}

// Called when another tab or window has saved job reviews. Nothing on the page is replaced, so nothing being typed is lost.
// Cards that no longer show what is saved are marked, and one notice offers to show the saved notes.
export function markChangedElsewhere(panel, saved, {el, button, reload}) {
  const cards = [...panel.querySelectorAll('article[data-review-id]')];
  const {outOfDate, added} = changedElsewhere(cards.map(card => ({id: card.dataset.reviewId, version: Number(card.dataset.noteVersion)})), saved);
  for (const card of cards) {
    if (!outOfDate.includes(card.dataset.reviewId)) continue;
    card.classList.add('registry-jobreview-out-of-date');
    if (!card.querySelector('.registry-out-of-date-note')) { const note = el('p', 'registry-form-note registry-out-of-date-note', OUT_OF_DATE_NOTE); note.setAttribute('role', 'status'); card.prepend(note); }
  }
  if (!outOfDate.length && !added) return 0;
  if (!panel.querySelector('#registry-jobreview-changed-elsewhere')) {
    const notice = el('div', 'registry-form-note registry-changed-elsewhere'); notice.id = 'registry-jobreview-changed-elsewhere'; notice.setAttribute('role', 'status');
    notice.append(el('span', '', CHANGED_ELSEWHERE_NOTE), button('Show what is saved now', reload));
    (panel.querySelector('#registry-jobreview-counts') || panel.firstChild).before(notice);
  }
  return outOfDate.length + added;
}

export function renderJobReviews(panel, ctx) {
  const {el, button, pill, field, formActions, disclosure, today, store, reviews, planned, showArchived, error, mutate, download, openAdd, openCheckFor, reloadedId} = ctx;
  const offered = Array.isArray(planned) ? planned : [];

  function planBlock(plan) {
    const box = el('div', 'registry-plan-context'); box.append(el('strong', '', 'From the plan (cannot be edited)'));
    const list = el('dl', 'registry-plan-lines');
    planLines(plan).forEach(([label, value]) => { list.append(el('dt', '', label), el('dd', '', value)); });
    box.append(list); return box;
  }

  // One form for a new outcome and for changing one. It never records or edits a check.
  function outcomeForm(review = null) {
    const node = el('form', 'registry-form'), about = review ? subject(review) : null;
    // A form for a saved note is tied to the version of the note it shows. The store refuses it once the saved note has moved on.
    if (review) node.dataset.seenVersion = String(review.version);
    const choices = [];
    if (review) choices.push(['keep', 'Keep: ' + about.job + ' · ' + about.place]);
    offered.forEach((plan, index) => { if (!review || !samePlan(plan, review.plan)) choices.push(['plan:' + index, (review ? 'Link to: ' : '') + planOption(plan)]); });
    if (!review) choices.push(['typed', offered.length ? 'A job that is not in this plan' : 'A job I will type in']);
    else if (review.plan) choices.push(['typed', 'Detach: this note is not about a planned job']);
    const pickJob = choices.length > 1 ? field(node, 'Which job is this about?', 'pick', {wide: true, choices, value: choices[0][0]}) : null;
    if (!review && !offered.length) node.append(el('p', 'registry-form-note registry-wide', 'Tip: open this from a finished plan and the note is tied to that planned job, with its building, place and method.'));
    const context = el('div', 'registry-wide'); node.append(context);
    const job = field(node, 'The job', 'job', {maxLength: 160, value: review && !review.plan ? review.job : '', placeholder: 'e.g. Wipe a whiteboard'});
    const place = field(node, 'The place, with the building', 'place', {maxLength: 240, value: review && !review.plan ? review.place : '', placeholder: 'e.g. North office / Meeting room 2 / Whiteboard 1'});
    const workDate = field(node, 'Date of the work', 'workDate', {required: true, type: 'date', value: review?.workDate || today()});
    const happened = field(node, 'What happened?', 'happened', {required: true, choices: HAPPENED.map(key => [key, WORDS.happened[key]]), value: review?.happened || 'UNKNOWN'});
    const doneBy = field(node, 'Who actually did it?', 'doneBy', {required: true, choices: DONE_BY.map(key => [key, WORDS.doneBy[key]]), value: review?.doneBy || 'UNKNOWN'});
    const doneByName = field(node, 'Name of the person or robot (optional)', 'doneByName', {maxLength: 120, value: review?.doneByName || ''});
    const help = el('fieldset', 'registry-fieldset registry-wide'); help.append(el('legend', '', 'Was extra help needed? Tick any that apply.'));
    const helpBoxes = DIFFICULTIES.map(key => {
      const label = el('label', 'registry-check'), box = document.createElement('input');
      box.type = 'checkbox'; box.value = key; box.checked = Boolean(review?.difficulties.includes(key));
      label.append(box, el('span', '', WORDS.difficulties[key])); help.append(label); return box;
    });
    help.append(el('small', '', 'Leave all empty if no extra help was recorded.')); node.append(help);
    const more = disclosure('More details (optional)', 'registry-wide'), moreFields = el('div', 'registry-form registry-subform');
    const differed = field(moreFields, 'What was actually done differently from the plan?', 'differed', {multiline: true, maxLength: 1000, wide: true, value: review?.differed || '', placeholder: 'e.g. a different method, person, place or settings'});
    const note = field(moreFields, 'Note', 'note', {multiline: true, maxLength: 2000, wide: true, value: review?.note || ''});
    const evidence = field(moreFields, 'Photo or file reference', 'evidence', {maxLength: 2000, wide: true, value: review?.evidence || '', hint: 'This saves a reference. It does not upload a photo.'});
    more.append(moreFields); node.append(more);
    const chosen = () => {
      const value = pickJob ? pickJob.value : review ? 'keep' : 'typed';
      if (value.startsWith('plan:')) return {kind: 'plan', plan: offered[Number(value.slice(5))]};
      if (value === 'keep') return review.plan ? {kind: 'keep', plan: review.plan} : {kind: 'keep', plan: null};
      return {kind: 'typed', plan: null};
    };
    const sync = (prefill = false) => {
      const target = chosen(), typed = !target.plan;
      context.replaceChildren(); if (target.plan) context.append(planBlock(target.plan));
      if (review && target.kind === 'plan' && target.plan.inventedExample && !isExample(review)) context.append(el('p', 'registry-form-note', EXAMPLE_LINK_NOTE));
      job.closest('label').hidden = place.closest('label').hidden = !typed; job.required = place.required = typed; job.disabled = place.disabled = !typed;
      if (prefill && typed && review?.plan && target.kind === 'typed') { job.value = about.job; place.value = about.place; }
      const notStarted = happened.value === 'NOT_STARTED';
      [...doneBy.options].forEach(option => { if (option.value === 'NOBODY') option.disabled = !notStarted; });
      if (notStarted) { doneBy.value = 'NOBODY'; doneByName.value = ''; helpBoxes.forEach(box => { box.checked = false; }); }
      else if (doneBy.value === 'NOBODY') doneBy.value = 'UNKNOWN';
      doneBy.disabled = doneByName.disabled = notStarted; helpBoxes.forEach(box => { box.disabled = notStarted; });
    };
    pickJob?.addEventListener('change', () => sync(true)); happened.addEventListener('change', () => sync()); sync();
    node.append(el('p', 'registry-form-note registry-wide', review
      ? (review.check ? 'This note has a recorded check. Saving a change removes that check. Saving with nothing changed keeps it.' : 'Saving records the outcome only. The supervisor’s check is recorded separately.')
      : 'Saving records the outcome only. The supervisor’s check is recorded separately, on the saved note. Neither changes the plan or approves a robot for any job.'));
    formActions(node, review ? 'Save changes' : 'Save job outcome');
    node.addEventListener('submit', event => {
      event.preventDefault();
      if (!node.reportValidity()) return;
      const target = chosen();
      const outcome = outcomeValues({workDate: workDate.value, happened: happened.value, doneBy: doneBy.value, doneByName: doneByName.value,
        difficulties: helpBoxes.filter(box => box.checked).map(box => box.value), differed: differed.value, note: note.value, evidence: evidence.value});
      const typed = {job: job.value, place: place.value};
      if (!review) {
        mutate(() => store.add(target.plan ? {...outcome, plan: target.plan} : {...outcome, ...typed}), saved => ({
          message: 'Job outcome saved in this browser. It has not been checked yet, and it is not used in plans.' + (isExample(saved) ? ' It is marked as an invented example and is left out of the counts.' : ''), openCheck: saved.happened === 'NOT_STARTED' ? null : saved.id}));
        return;
      }
      mutate(() => {
        if (target.kind === 'plan') return store.relink(review.id, review.version, target.plan, outcome);
        if (target.kind === 'typed' && review.plan) return store.detach(review.id, review.version, typed, outcome);
        return store.update(review.id, review.version, review.plan ? outcome : {...outcome, ...typed});
      }, saved => ({message: editMessage(review, saved)}));
    });
    return node;
  }

  // The supervisor's check is its own action on the note as it stands.
  function checkForm(review) {
    const node = el('form', 'registry-form'); node.dataset.seenVersion = String(review.version);
    node.append(el('p', 'registry-form-note registry-wide', 'Record the supervisor’s judgement of the outcome as it is written above, against what the job asked for. The name is typed and not verified. This does not approve a robot for any job.'));
    const acceptance = field(node, 'Was the result acceptable?', 'acceptance', {required: true, choices: [['', 'Choose…'], ...JUDGEMENTS.map(key => [key, WORDS.judgement[key]])], value: ''});
    const checkedBy = field(node, 'Who checked it? (typed, not verified)', 'checkedBy', {required: true, maxLength: 120, placeholder: 'e.g. the building supervisor'});
    const checkedOn = field(node, 'Date of the check', 'checkedOn', {required: true, type: 'date', value: today() < review.workDate ? review.workDate : today()});
    const note = field(node, 'Check note (optional)', 'checkNote', {multiline: true, maxLength: 2000, wide: true});
    const consent = el('label', 'registry-check registry-wide'), box = document.createElement('input'); box.type = 'checkbox'; box.required = true;
    consent.append(box, el('span', '', 'I have checked the result of this job as it is recorded above.')); node.append(consent);
    formActions(node, 'Record check');
    node.addEventListener('submit', event => {
      event.preventDefault();
      if (!node.reportValidity()) return;
      mutate(() => store.check(review.id, review.version, {acceptance: acceptance.value, checkedBy: checkedBy.value, checkedOn: checkedOn.value, note: note.value}),
        () => ({message: 'Check recorded for the outcome as it stands. It is still not used in plans.'}));
    });
    return node;
  }

  function card(review) {
    const node = el('article', 'registry-card registry-jobreview-card'), about = subject(review), state = checkState(review);
    node.dataset.reviewId = review.id; node.dataset.noteVersion = String(review.version);
    if (reloadedId === review.id) { node.classList.add('registry-jobreview-reloaded'); const note = el('p', 'registry-form-note registry-reloaded-note', RELOADED_NOTE); note.tabIndex = -1; node.append(note); }
    const heading = el('div', 'registry-card-heading');
    heading.append(el('h3', '', about.job), pill(WORDS.happened[review.happened], 'registry-happened-' + review.happened.toLowerCase().replace('_', '-')));
    const who = WORDS.doneBy[review.doneBy] + (review.doneByName ? ' (' + review.doneByName + ')' : '');
    node.append(heading, el('p', 'registry-meta', review.workDate + ' · Done by: ' + who), el('p', 'registry-place', about.place));
    const line = el('div', 'registry-review-line');
    const checkPill = pill(WORDS.check[state], {ACCEPTED: 'registry-outcome-pass', MORE_WORK: 'registry-outcome-inconclusive', CHECK_AGAIN: 'registry-outcome-fail'}[state] || ''); checkPill.classList.add('registry-check-state');
    line.append(checkPill, pill('Not used in plans'), pill(about.linked ? 'Tied to a planned job' : 'Not tied to a plan'));
    if (review.plan?.inventedExample) line.append(pill('Plan was an invented example'));
    if (isExample(review)) line.append(pill('Invented example · not counted'));
    if (review.archivedAt) line.append(pill('Archived'));
    node.append(line);
    node.append(el('p', 'registry-small', review.difficulties.length ? 'Extra help recorded: ' + review.difficulties.map(key => WORDS.difficulties[key]).join('; ') + '.' : 'No extra help recorded.'));
    const details = disclosure('Details'), body = el('div', 'registry-detail-body');
    const add = (label, value) => { if (value) body.append(el('strong', '', label), el('p', 'registry-record-note', value)); };
    if (review.plan) body.append(planBlock(review.plan), el('p', 'registry-small', LINK_NOTE));
    else body.append(el('p', 'registry-small', 'This note has no plan link. Its job and place were typed.'));
    if (isExample(review)) body.append(el('p', 'registry-small registry-example-note', EXAMPLE_NOTE));
    add('Done differently from the plan', review.differed);
    add('Note', review.note);
    add('Photo or file reference', review.evidence);
    if (review.check) {
      add('Checked by', review.check.checkedBy + ' on ' + review.check.checkedOn + ' (typed, not verified)');
      add('Check note', review.check.note);
    } else if (state === 'CHECK_AGAIN') body.append(el('p', 'registry-small', 'This note was changed after it had been checked, so that check was removed.'));
    body.append(el('p', 'registry-small', HISTORY_NOTE));
    details.append(body); node.append(details);
    if (!review.archivedAt) {
      if (review.happened === 'NOT_STARTED') node.append(el('p', 'registry-small', 'A job that was not started has no result to check.'));
      else if (!review.check) { const check = disclosure('Record the supervisor’s check', 'registry-jobreview-check'); check.open = openCheckFor === review.id; check.append(checkForm(review)); node.append(check); }
      const edit = disclosure('Change this note', 'registry-jobreview-edit'); edit.append(outcomeForm(review)); node.append(edit);
    }
    const actions = el('div', 'registry-card-actions');
    if (review.archivedAt) actions.append(button('Restore job review', () => mutate(() => store.restore(review.id, review.version), () => ({message: 'Job review restored.'}))));
    else {
      actions.append(button('Archive', () => mutate(() => store.archive(review.id, review.version), () => ({message: 'Job review archived. Use “Show archived” to restore it.'})), 'registry-text-button'));
      if (review.check) actions.append(button('Remove check', () => mutate(() => store.uncheck(review.id, review.version), () => ({message: 'Check removed. The outcome is unchanged and is no longer checked.'})), 'registry-text-button'));
    }
    node.append(actions);
    return node;
  }

  panel.append(el('p', 'registry-jobreview-intro', 'After a job, record what happened. The supervisor’s check of the result is recorded separately. This works for jobs done by people as well as by robots.'));
  const scope = el('p', 'registry-small'); scope.id = 'registry-jobreview-scope';
  scope.textContent = 'A job review never changes a plan or what a robot may be offered.'; panel.append(scope);
  if (error) { panel.append(el('p', 'registry-form-note', error.message || 'Job reviews cannot be saved in this browser.')); return; }
  const add = disclosure('+ Record a job outcome', 'registry-add'); add.id = 'registry-jobreview-add'; add.open = Boolean(openAdd);
  add.append(outcomeForm()); panel.append(add);
  const shown = reviews.filter(review => showArchived || !review.archivedAt).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const counts = el('p', 'registry-jobreview-counts', countsSentence(reviews)); counts.id = 'registry-jobreview-counts'; panel.append(counts);
  if (reviews.some(review => !review.archivedAt)) panel.append(el('p', 'registry-small', LIMIT_NOTE));
  const list = el('div', 'registry-record-list'); shown.forEach(review => list.append(card(review))); panel.append(list);
  const pathway = el('section', 'registry-admission'); pathway.setAttribute('aria-label', 'What a job review can lead to');
  pathway.append(el('h3', 'registry-section-title', 'What can a job review lead to?'));
  const stepCounts = pathwayCounts(reviews);
  const steps = el('ol', 'registry-ladder');
  PATHWAY.forEach(([name, words], index) => {
    const item = el('li'), mark = el('span', 'registry-ladder-number', String(index + 1)); mark.setAttribute('aria-hidden', 'true');
    const text = el('div'); text.append(el('strong', '', name), el('span', 'registry-ladder-count', stepCounts[index]), el('p', 'registry-small', words));
    item.append(mark, text); steps.append(item);
  });
  pathway.append(steps);
  const example = button('Add an invented example review', () => mutate(() => { const made = exampleReview(today()), saved = store.add(made.outcome); return store.check(saved.id, saved.version, made.check); },
    () => ({message: 'Invented example saved. It is labelled as an example and is not used in plans.'})));
  const copy = planPdfButton(() => {const saved = store.load().reviews; return jobReviewsReport(saved, {words: WORDS, planLines, summary: countsSentence(saved)});}, 'job-reviews-' + today() + '.pdf', {label: 'Download job reviews PDF', className: 'registry-button'});
  const backup = disclosure('Data backup (JSON)');
  backup.append(el('p', 'registry-small', 'The complete saved job reviews as data. Use the PDF for a readable copy.'), button('Download data backup', () => download(store.exportJSON(), 'job-reviews-' + today() + '.json', 'Download started. It contains the job reviews saved in this browser.')));
  const tools = el('div', 'registry-card-actions'); tools.append(example, copy); pathway.append(tools, backup);
  pathway.append(el('p', 'registry-small', 'Try it: save the example, then check a plan again. The plan does not change.'));
  panel.append(pathway);
}
