// Job reviews are browser-local notes about work after it happened.
// They are never sent to the planning service and never change what a robot may be offered.
//
// A note has three separate parts:
//   plan     a read-only copy of the planned job it was started from, or null for a typed note;
//   outcome  what the user says happened;
//   check    the supervisor's stated judgement of that outcome, recorded by its own action.
// Changing the outcome, or the job a note is about, removes the check. A check never carries over to different facts.
//
// Two counters are kept for each note:
//   contentVersion  counts real changes to the plan copy and the outcome, which are the facts a check judges;
//   version         counts every saved change to the note, of any kind.
// Every action on a saved note must name the version it was looking at. If the saved note has moved on,
// for example because it was changed in another tab, the action is refused and nothing is written.
//
// A note known to be an invented example keeps that mark for good and is left out of the ordinary counts.
export const STORAGE_KEY = 'fieldwork.job-reviews.v3';
export const SCHEMA_VERSION = 3;
export const HAPPENED = Object.freeze(['COMPLETED', 'PARTLY', 'STOPPED', 'NOT_STARTED', 'UNKNOWN']);
export const DONE_BY = Object.freeze(['PERSON', 'ROBOT', 'ROBOT_WITH_HELP', 'NOBODY', 'UNKNOWN']);
export const DIFFICULTIES = Object.freeze(['INTERVENTION', 'REPEAT', 'EQUIPMENT', 'OTHER']);
export const JUDGEMENTS = Object.freeze(['ACCEPTED', 'MORE_WORK']);

const MAX_BYTES = 1_000_000;
const MAX_REVIEWS = 2000;
const OUTCOME_FIELDS = ['job', 'place', 'workDate', 'happened', 'doneBy', 'doneByName', 'difficulties', 'differed', 'note', 'evidence'];
const PLAN_TEXT = {digest: 64, release: 80, buildingId: 200, buildingName: 200, taskId: 80, jobType: 80, jobLabel: 160, roomId: 80, roomName: 160, placeId: 80, placeName: 160, plannedState: 60, plannedText: 240};
const PLAN_OPTIONAL_TEXT = {customer: 200, company: 200, method: 1000};
const PLAN_FIELDS = [...Object.keys(PLAN_TEXT), ...Object.keys(PLAN_OPTIONAL_TEXT), 'stage', 'inventedExample'];
const CHECK_INPUT = ['acceptance', 'checkedBy', 'checkedOn', 'note'];
const CHECK_FIELDS = [...CHECK_INPUT, 'outcomeVersion', 'recordedAt'];
const STORED = [...OUTCOME_FIELDS, 'plan', 'check', 'checkClearedAt', 'contentVersion', 'version', 'example', 'id', 'declaration', 'createdAt', 'updatedAt', 'archivedAt'];
export const STALE_MESSAGE = 'This note was changed in another tab or window after it was shown here, so nothing was saved.';
const clone = value => JSON.parse(JSON.stringify(value));
const now = () => new Date().toISOString();
const blank = () => ({schemaVersion: SCHEMA_VERSION, revision: 0, reviews: []});
const pick = (value, keys) => Object.fromEntries(keys.filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]]));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export class JobReviewError extends Error {
  constructor(code, message, reviewId = null) { super(message); this.name = 'JobReviewError'; this.code = code; this.reviewId = reviewId; }
}
const fail = (message, code = 'validation') => { throw new JobReviewError(code, message); };

function object(value, allowed, required, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(label + ' must be an object.');
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(label + ' contains an unknown field: ' + key + '.');
  for (const key of required) if (!Object.hasOwn(value, key)) fail(label + ' needs ' + key + '.');
  return value;
}
function text(value, max, label, required = false, multiline = false) {
  if (typeof value !== 'string') fail(label + ' must be text.');
  const clean = value.trim();
  if (required && !clean) fail('Enter ' + label.toLowerCase() + '.');
  if (clean.length > max) fail(label + ' is too long (maximum ' + max + ' characters).');
  if ((multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(clean)) fail(label + ' contains unsupported control characters.');
  return clean;
}
function oneOf(value, options, label) {
  if (!options.includes(value)) fail(label + ' must be one of ' + options.join(', ') + '.');
  return value;
}
function day(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(label + ' must use YYYY-MM-DD.');
  const date = new Date(value + 'T00:00:00.000Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value || Number(value.slice(0, 4)) < 1900) fail('Enter a valid ' + label.toLowerCase() + '.');
  // One day of tolerance: the browser's local date can be a day ahead of UTC.
  if (value > new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)) fail(label + ' cannot be in the future.');
  return value;
}
function timestamp(value, nullable = false) {
  if (nullable && value === null) return;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
      !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail('Stored timestamp is invalid.');
}
function difficulties(value) {
  if (!Array.isArray(value)) fail('Extra help must be a list.');
  const seen = new Set();
  for (const item of value) {
    oneOf(item, DIFFICULTIES, 'Extra help');
    if (seen.has(item)) fail('Extra help lists the same item twice.');
    seen.add(item);
  }
  return DIFFICULTIES.filter(item => seen.has(item));
}

// The read-only copy of a planned job. Every field is required, so a note cannot name a job without its plan, or the reverse.
function planFields(value) {
  object(value, PLAN_FIELDS, PLAN_FIELDS, 'Plan link');
  const plan = {};
  for (const [key, max] of Object.entries(PLAN_TEXT)) {
    plan[key] = text(value[key], max, 'Plan link ' + key);
    if (!plan[key]) fail('The plan link is incomplete: ' + key + ' is missing.');
  }
  for (const [key, max] of Object.entries(PLAN_OPTIONAL_TEXT)) plan[key] = text(value[key], max, 'Plan link ' + key, false, key === 'method');
  if (!/^[0-9a-f]{64}$/.test(plan.digest)) fail('Plan fingerprint is not in the expected format.');
  if (!/^[A-Z_]+$/.test(plan.plannedState)) fail('Plan link state is not in the expected format.');
  if (![1, 2].includes(value.stage)) fail('Plan link stage must be 1 or 2.');
  if (typeof value.inventedExample !== 'boolean') fail('Plan link example marker must be true or false.');
  plan.stage = value.stage; plan.inventedExample = value.inventedExample;
  return Object.fromEntries(PLAN_FIELDS.map(key => [key, plan[key]]));
}

// What the user says happened. A note tied to a plan takes its job and place from the plan, so it cannot type its own.
function outcomeFields(value, linked) {
  object(value, OUTCOME_FIELDS, ['workDate', 'happened', 'doneBy'], 'Job outcome');
  const outcome = {
    job: text(value.job ?? '', 160, 'The job', !linked),
    place: text(value.place ?? '', 240, 'The place', !linked),
    workDate: day(value.workDate, 'Date of the work'),
    happened: oneOf(value.happened, HAPPENED, 'What happened'),
    doneBy: oneOf(value.doneBy, DONE_BY, 'Who did it'),
    doneByName: text(value.doneByName ?? '', 120, 'Name of the person or robot'),
    difficulties: difficulties(value.difficulties ?? []),
    differed: text(value.differed ?? '', 1000, 'What was done differently', false, true),
    note: text(value.note ?? '', 2000, 'Note', false, true),
    evidence: text(value.evidence ?? '', 2000, 'Photo or file reference', false, true),
  };
  if (linked && (outcome.job || outcome.place)) fail('This note is tied to a planned job, so its job and place come from the plan. Link it to another planned job, or detach it, to change them.');
  if ((outcome.happened === 'NOT_STARTED') !== (outcome.doneBy === 'NOBODY')) fail('Choose “Nobody” for a job that was not started, and only for that.');
  if (outcome.happened === 'NOT_STARTED' && (outcome.difficulties.length || outcome.doneByName)) fail('A job that was not started has nobody who did it and no extra help to record. Use the note to say why it did not start.');
  return outcome;
}

// The supervisor's stated judgement of one version of the outcome.
function checkFields(value, review) {
  object(value, CHECK_INPUT, ['acceptance', 'checkedBy', 'checkedOn'], 'Check');
  if (review.happened === 'NOT_STARTED') fail('A job that was not started has no result to check.');
  const check = {
    acceptance: oneOf(value.acceptance, JUDGEMENTS, 'The judgement'),
    checkedBy: text(value.checkedBy, 120, 'Name of the person who checked', true),
    checkedOn: day(value.checkedOn, 'Date of the check'),
    note: text(value.note ?? '', 2000, 'Check note', false, true),
  };
  if (check.checkedOn < review.workDate) fail('The check cannot be dated before the work.');
  return check;
}

function validateDocument(data) {
  object(data, ['schemaVersion', 'revision', 'reviews'], ['schemaVersion', 'revision', 'reviews'], 'Saved job reviews');
  if (data.schemaVersion !== SCHEMA_VERSION) fail('These saved job reviews use an unsupported version.');
  if (!Number.isSafeInteger(data.revision) || data.revision < 0) fail('Stored revision is invalid.');
  if (!Array.isArray(data.reviews) || data.reviews.length > MAX_REVIEWS) fail('Stored job reviews exceed the record limit.');
  const ids = new Set();
  for (const review of data.reviews) {
    object(review, STORED, STORED, 'Saved job review');
    if (typeof review.id !== 'string' || !/^jobreview_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(review.id) || ids.has(review.id)) fail('Stored job review ID is invalid or duplicated.');
    ids.add(review.id);
    if (review.plan !== null && !same(planFields(review.plan), review.plan)) fail('Stored plan link is invalid.');
    if (!same(outcomeFields(pick(review, OUTCOME_FIELDS), review.plan !== null), pick(review, OUTCOME_FIELDS))) fail('Stored job outcome is invalid.');
    if (!Number.isSafeInteger(review.contentVersion) || review.contentVersion < 1) fail('Stored outcome version is invalid.');
    // Every change to the facts is also a saved change, so the note's version can never be behind its outcome version.
    if (!Number.isSafeInteger(review.version) || review.version < review.contentVersion) fail('Stored note version is invalid.');
    if (typeof review.example !== 'boolean' || review.declaration !== 'user-entered') fail('Stored job review has an unexpected marker.');
    if (review.plan?.inventedExample && !review.example) fail('A stored note from an invented example plan is not marked as an example.');
    timestamp(review.createdAt); timestamp(review.updatedAt); timestamp(review.archivedAt, true); timestamp(review.checkClearedAt, true);
    if (review.check !== null) {
      object(review.check, CHECK_FIELDS, CHECK_FIELDS, 'Saved check');
      if (!same(checkFields(pick(review.check, CHECK_INPUT), review), pick(review.check, CHECK_INPUT))) fail('Stored check is invalid.');
      timestamp(review.check.recordedAt);
      // A check belongs to one version of the outcome. One left on a later version is refused.
      if (review.check.outcomeVersion !== review.contentVersion) fail('Stored check does not match this version of the outcome.');
      if (review.checkClearedAt !== null) fail('Stored check markers contradict each other.');
    }
  }
  return data;
}

// The job, place and plan status to show for a note, whichever kind it is.
export function subject(review) {
  if (!review.plan) return {linked: false, job: review.job, place: review.place};
  const plan = review.plan;
  return {linked: true, job: plan.jobLabel, place: plan.buildingName + ' · ' + plan.roomName + ' / ' + plan.placeName};
}
export function checkState(review) {
  if (review.check) return review.check.acceptance;
  return review.checkClearedAt ? 'CHECK_AGAIN' : 'NOT_CHECKED';
}

// A note known to be invented: made by the example button, or started from or linked to a plan made from an invented example.
export const isExample = review => review.example === true || review.plan?.inventedExample === true;

// Counts of notes only. This deliberately returns no rate, score or percentage.
// Known invented examples are counted on their own and never in the ordinary counts.
export function summarise(reviews) {
  const active = reviews.filter(review => !review.archivedAt && !isExample(review));
  const count = test => active.filter(test).length;
  return {
    total: active.length,
    accepted: count(review => review.check?.acceptance === 'ACCEPTED'),
    moreWork: count(review => review.check?.acceptance === 'MORE_WORK'),
    notChecked: count(review => !review.check),
    extraHelp: count(review => review.difficulties.length > 0),
    examples: reviews.filter(review => !review.archivedAt && isExample(review)).length,
  };
}

export function createJobReviewStore(storage) {
  if (arguments.length === 0) { try { storage = globalThis.localStorage; } catch { fail('This browser has blocked local storage. Nothing has been saved.', 'storage'); } }
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') fail('Local storage is unavailable. Nothing has been saved.', 'storage');
  function readRaw() { try { return storage.getItem(STORAGE_KEY); } catch { fail('The browser could not read local storage. Nothing has been changed.', 'storage'); } }
  function read() {
    const raw = readRaw(); if (raw === null) return {raw, data: blank()};
    try {
      if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > MAX_BYTES) throw new Error();
      return {raw, data: validateDocument(JSON.parse(raw))};
    } catch (error) { fail('The saved job reviews are damaged or use an unsupported format. They have not been overwritten. ' + (error instanceof JobReviewError ? error.message : ''), 'corrupt'); }
  }
  function commit(mutator) {
    const {raw, data} = read(); const value = mutator(data); data.revision++;
    validateDocument(data);
    const encoded = JSON.stringify(data);
    if (new TextEncoder().encode(encoded).length > MAX_BYTES) fail('The job reviews in this browser are full. Download a copy before adding more.', 'storage');
    if (readRaw() !== raw) fail('The job reviews were changed in another tab or window while this was being saved, so nothing was saved. Check what is shown, then try again.', 'conflict');
    try { storage.setItem(STORAGE_KEY, encoded); } catch { fail('The browser could not save this change. Storage may be blocked or full.', 'storage'); }
    if (readRaw() !== encoded) fail('The browser did not confirm the saved change. Reload before continuing.', 'storage');
    return clone(value);
  }
  function find(data, id) { const review = data.reviews.find(row => row.id === id); if (!review) fail('Job review not found.', 'not_found'); return review; }
  // The saved note, but only if it is still the version the caller was looking at. This runs before anything is changed.
  function needVersion(seen) { if (!Number.isSafeInteger(seen) || seen < 1) fail('This action did not say which saved version of the note it was looking at. Nothing was changed.', 'version_required'); }
  function seenNote(data, id, seen) {
    needVersion(seen);
    const review = find(data, id);
    if (review.version !== seen) throw new JobReviewError('stale', STALE_MESSAGE, id);
    return review;
  }
  function editable(data, id, seen) { const review = seenNote(data, id, seen); if (review.archivedAt) fail('Restore this job review before changing it.'); return review; }
  function newId(data) {
    if (!globalThis.crypto?.randomUUID) fail('This browser cannot create record IDs. Open the app on localhost or HTTPS.', 'storage');
    let value; do { value = 'jobreview_' + globalThis.crypto.randomUUID(); } while (data.reviews.some(row => row.id === value));
    return value;
  }
  // Any saved change moves the note to a new version, so forms opened on the earlier version stop working.
  function touched(review) { review.version++; review.updatedAt = now(); }
  // The facts changed, so any judgement of the earlier facts is removed. Nothing of the old judgement is kept.
  function changed(review) {
    touched(review); review.contentVersion++;
    if (review.check) { review.check = null; review.checkClearedAt = review.updatedAt; }
  }
  function archive(id, seen, archived) { return commit(data => { const review = seenNote(data, id, seen); review.archivedAt = archived ? now() : null; touched(review); return review; }); }
  return Object.freeze({
    load() { return clone(read().data); },
    // Save an outcome. A new note is never checked: the check is a separate action.
    // A note started from a plan made from an invented example is marked as an example, whatever the caller says.
    add(value) {
      object(value, [...OUTCOME_FIELDS, 'plan', 'example'], [], 'Job review');
      const plan = value.plan == null ? null : planFields(value.plan), marker = value.example ?? false;
      if (typeof marker !== 'boolean') fail('The example marker must be true or false.');
      const example = marker || Boolean(plan?.inventedExample);
      const outcome = outcomeFields(pick(value, OUTCOME_FIELDS), plan !== null);
      return commit(data => {
        if (data.reviews.length >= MAX_REVIEWS) fail('This browser already holds 2,000 job reviews.');
        const time = now(), review = {id: newId(data), ...outcome, plan, check: null, checkClearedAt: null, contentVersion: 1, version: 1, example, declaration: 'user-entered', createdAt: time, updatedAt: time, archivedAt: null};
        data.reviews.push(review); return review;
      });
    },
    // Change the outcome. A real change removes the check. Saving with nothing changed writes nothing and keeps it.
    // A form opened on an earlier version of the note is refused first, whatever it contains.
    update(id, seen, patch) {
      needVersion(seen); object(patch, OUTCOME_FIELDS, [], 'Job outcome changes');
      const current = editable(read().data, id, seen);
      const next = outcomeFields({...pick(current, OUTCOME_FIELDS), ...patch}, current.plan !== null);
      if (same(next, pick(current, OUTCOME_FIELDS))) return clone(current);
      return commit(data => { const review = editable(data, id, seen); Object.assign(review, next); changed(review); return review; });
    },
    // Record the supervisor's judgement of the version of the note the supervisor was shown, and of no other.
    check(id, seen, value) {
      needVersion(seen);
      return commit(data => {
        const review = editable(data, id, seen);
        review.check = {...checkFields(value, review), outcomeVersion: review.contentVersion, recordedAt: now()};
        review.checkClearedAt = null; touched(review); return review;
      });
    },
    uncheck(id, seen) { return commit(data => { const review = editable(data, id, seen); review.check = null; touched(review); return review; }); },
    // Point the note at a different planned job. The new copy replaces the old one whole, and the check is removed.
    // Outcome changes made in the same edit are saved in the same step.
    // Linking to a plan made from an invented example marks the note as an example. The mark is never taken off.
    relink(id, seen, plan, patch = {}) {
      needVersion(seen); const next = planFields(plan); object(patch, OUTCOME_FIELDS, [], 'Job outcome changes');
      if (Object.hasOwn(patch, 'job') || Object.hasOwn(patch, 'place')) fail('A note tied to a planned job takes its job and place from the plan.');
      const current = editable(read().data, id, seen);
      const outcome = outcomeFields({...pick(current, OUTCOME_FIELDS), ...patch, job: '', place: ''}, true);
      if (current.plan && same(current.plan, next) && same(outcome, pick(current, OUTCOME_FIELDS))) return clone(current);
      return commit(data => { const review = editable(data, id, seen); review.plan = next; review.example = review.example || next.inventedExample; Object.assign(review, outcome); changed(review); return review; });
    },
    // Cut the note loose from its plan. It keeps no plan link, takes a typed job and place, and loses its check.
    // A note that was a known invented example stays one.
    detach(id, seen, value, patch = {}) {
      needVersion(seen); object(value, ['job', 'place'], ['job', 'place'], 'Detached note'); object(patch, OUTCOME_FIELDS, [], 'Job outcome changes');
      if (Object.hasOwn(patch, 'job') || Object.hasOwn(patch, 'place')) fail('Give the typed job and place once.');
      return commit(data => {
        const review = editable(data, id, seen); if (!review.plan) fail('This note is not tied to a plan.');
        const outcome = outcomeFields({...pick(review, OUTCOME_FIELDS), ...patch, job: value.job, place: value.place}, false);
        review.plan = null; Object.assign(review, outcome); changed(review); return review;
      });
    },
    archive(id, seen) { return archive(id, seen, true); },
    restore(id, seen) { return archive(id, seen, false); },
    exportJSON() { return JSON.stringify(read().data, null, 2) + '\n'; },
  });
}
