import {normalizeBilling, billEstimate} from './booking-bill.mjs';
import {timeEstimate} from './booking-time.mjs';
/** Provisional resource bookings for a local planning draft. No robot is authorised here. */
export const SCHEMA = 'fieldwork-bookings-v1';
export const RESOURCE_IDS = Object.freeze(['UR3', 'UR5', 'G1', 'H1', 'H2']);
export const CHECK_KEYS = Object.freeze(['area', 'permission', 'surface', 'people', 'equipment', 'access']);
export const KINDS = Object.freeze(['windows', 'whiteboards', 'walls', 'desks', 'floors', 'bins', 'facade']);
export const SCOPE = 'Provisional resource booking only. Suitability must be confirmed separately. This plan does not approve work, verify capability or start a robot.';
export const LIMITS = Object.freeze({jobs: 100, groups: 10, count: 100000, dimension: 1000, totalWindows: 1000000, area: 1000000000});
const MODES = ['manual', 'UR3', 'UR5', 'G1'];
const STATUSES = ['draft', 'reserved', 'released'];
const CHECK_LABELS = {area: 'Area check', permission: 'Permission to work', surface: 'Surface check', people: 'People and roles', equipment: 'Equipment check', access: 'Access check'};
const JOB_KEYS = ['id', 'name', 'kind', 'place', 'stage', 'mode', 'workerId', 'groups', 'access', 'checks', 'notes', 'status', 'timeEstimate', 'billing'];
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

export class BookingError extends Error {
  constructor(code, message) { super(message); this.name = 'BookingError'; this.code = code; }
}
const fail = (message, code = 'VALIDATION') => { throw new BookingError(code, message); };
function object(value, keys, name, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(name + ' must be an object.');
  if (Object.keys(value).some(key => !keys.includes(key)) || keys.some(key => !optional.includes(key) && !own(value, key))) fail(name + ' has missing or unexpected fields.');
  return value;
}
function text(value, name, max, empty = false) {
  if (typeof value !== 'string' || value.length > max || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(value)) fail(name + ' needs plain text, at most ' + max + ' characters.');
  const cleaned = value.normalize('NFKC').trim();
  if ((!empty && !cleaned) || cleaned.length > max) fail(name + ' needs short text.');
  return cleaned;
}
function enumeration(value, allowed, name) { if (!allowed.includes(value)) fail(name + ' has an unsupported value.'); return value; }
function number(value, name, max, integer = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > max || (integer && !Number.isSafeInteger(value))) fail(name + ' must be a positive ' + (integer ? 'whole ' : '') + 'number no larger than ' + max + '.');
  return value;
}
function dimension(value, name) {
  number(value, name, LIMITS.dimension);
  if (value < 0.001 || Math.abs(value * 1000 - Math.round(value * 1000)) > 0.0000001) fail(name + ' must be at least 0.001 metres, with at most three decimal places.');
  return Math.round(value * 1000) / 1000;
}
function stage(value) { return enumeration(value, [1, 2], 'Stage'); }
function identifier(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value)) fail('Job ID must contain 1–80 letters, numbers, underscores or hyphens.');
  return value;
}
function context(value) {
  object(value, ['company', 'customer', 'building'], 'Building details');
  return Object.fromEntries(['company', 'customer', 'building'].map(key => [key, text(value[key], key, 160, true)]));
}
export function initialState() {
  return {schema: SCHEMA, revision: 0, context: {company: '', customer: '', building: ''}, busy: Object.fromEntries(RESOURCE_IDS.map(id => [id, []])), jobs: []};
}
export function normalizeJob(input) {
  object(input, JOB_KEYS, 'Job', ['status', 'timeEstimate', 'billing']);
  const kind = enumeration(input.kind, KINDS, 'Job kind');
  if (!Array.isArray(input.groups) || input.groups.length > LIMITS.groups) fail('Use at most ' + LIMITS.groups + ' window size groups.');
  if (kind === 'windows' && !input.groups.length) fail('Add at least one window size group.');
  if (!['windows', 'facade'].includes(kind) && input.groups.length) fail('Only window and facade jobs use window size groups.');
  const groups = input.groups.map(group => {
    object(group, ['count', 'width', 'height', 'faces'], 'Window size group');
    return {count: number(group.count, 'Number of windows', LIMITS.count, true), width: dimension(group.width, 'Width'), height: dimension(group.height, 'Height'), faces: enumeration(group.faces, ['inside', 'outside', 'both'], 'Window face')};
  });
  object(input.checks, CHECK_KEYS, 'Checks');
  const job = {id: identifier(input.id), name: text(input.name, 'Job name', 160), kind, place: text(input.place, 'Place', 160), stage: stage(input.stage), mode: enumeration(input.mode, MODES, 'Work method'), workerId: enumeration(input.workerId, ['H1', 'H2'], 'Worker'), groups, access: enumeration(input.access, ['floor', 'specialist'], 'Access'), checks: Object.fromEntries(CHECK_KEYS.map(key => [key, enumeration(input.checks[key], ['unknown', 'yes', 'no'], CHECK_LABELS[key])])), notes: text(input.notes, 'Notes', 200, true), status: enumeration(input.status ?? 'draft', STATUSES, 'Booking status')};
  if (input.timeEstimate !== undefined && input.timeEstimate !== null) {
    job.timeEstimate = input.timeEstimate;
    try { timeEstimate(job); } catch (error) { fail(error.message); }
    job.timeEstimate = {basis: input.timeEstimate.basis, minutes: input.timeEstimate.minutes};
  }
  if (input.billing !== undefined && input.billing !== null) {
    try { job.billing = normalizeBilling({...job,billing:input.billing}); billEstimate(job); } catch (error) { fail(error.message); }
  }
  const total = quantitiesUnchecked(job);
  if (total.windows > LIMITS.totalWindows || total.area > LIMITS.area) fail('The total window count or area is too large for this planning draft.');
  return job;
}
function quantitiesUnchecked(job) {
  return job.groups.reduce((total, group) => ({windows: total.windows + group.count, area: total.area + group.count * group.width * group.height * (group.faces === 'both' ? 2 : 1)}), {windows: 0, area: 0});
}
export function quantities(job) { return quantitiesUnchecked(normalizeJob(job)); }
function resourcesUnchecked(job) { return job.mode === 'manual' ? [job.workerId] : [job.mode, 'H1']; }
export function requiredResources(job) { return resourcesUnchecked(normalizeJob(job)); }
function availabilityUnchecked(state, id, requestedStage, excludeJobId = '') {
  if (state.busy[id].includes(requestedStage)) return {status: 'busy', label: 'Busy elsewhere'};
  const job = state.jobs.find(item => item.id !== excludeJobId && item.status === 'reserved' && item.stage === requestedStage && resourcesUnchecked(item).includes(id));
  return job ? {status: 'booked', jobId: job.id, label: 'Booked for ' + job.name} : {status: 'free', label: 'Available for a draft booking'};
}
function assessmentUnchecked(state, job) {
  const reasons = [];
  let blocked = false;
  const resources = resourcesUnchecked(job);
  if (!state.context.building) reasons.push('Enter the building name before reserving resources.');
  if (job.kind === 'facade' || job.access === 'specialist') { blocked = true; reasons.push('This work needs specialist access planning outside this app. Keep it as a draft.'); }
  for (const key of CHECK_KEYS) {
    if (job.checks[key] === 'no') { blocked = true; reasons.push(CHECK_LABELS[key] + ' needs attention.'); }
    else if (job.checks[key] !== 'yes') reasons.push(CHECK_LABELS[key] + ' has not been checked.');
  }
  for (const id of resources) {
    const status = availabilityUnchecked(state, id, job.stage, job.id);
    if (status.status !== 'free') { blocked = true; reasons.push(id + ': ' + status.label + ' in stage ' + job.stage + '.'); }
  }
  return {status: blocked ? 'blocked' : reasons.length ? 'incomplete' : 'ready', canReserve: reasons.length === 0, reasons, resources, quantities: quantitiesUnchecked(job), scope: SCOPE};
}

/** Validate stored state too: malformed or contradictory reservations are never repaired silently. */
export function validateState(input) {
  object(input, ['schema', 'revision', 'context', 'busy', 'jobs'], 'Saved bookings');
  if (input.schema !== SCHEMA) fail('The saved booking format is not supported.', 'SCHEMA');
  if (!Number.isSafeInteger(input.revision) || input.revision < 0 || input.revision >= Number.MAX_SAFE_INTEGER) fail('The saved booking revision is invalid.');
  object(input.busy, RESOURCE_IDS, 'Busy resources');
  const busy = Object.fromEntries(RESOURCE_IDS.map(id => {
    const values = input.busy[id];
    if (!Array.isArray(values) || values.length > 2 || values.some(value => ![1, 2].includes(value)) || new Set(values).size !== values.length) fail('Busy stages must list stage 1 or 2 once each.');
    return [id, [...values].sort()];
  }));
  if (!Array.isArray(input.jobs) || input.jobs.length > LIMITS.jobs) fail('A planning draft holds at most ' + LIMITS.jobs + ' jobs.');
  const jobs = input.jobs.map(normalizeJob);
  if (new Set(jobs.map(job => job.id)).size !== jobs.length) fail('Job IDs must be unique.');
  const state = {schema: SCHEMA, revision: input.revision, context: context(input.context), busy, jobs};
  for (const job of jobs) if (job.status === 'reserved' && !assessmentUnchecked(state, job).canReserve) fail('A saved reservation contradicts its checks, building or resource bookings.', 'CORRUPT_STATE');
  return state;
}
export function availability(state, id, requestedStage, excludeJobId = '') {
  enumeration(id, RESOURCE_IDS, 'Resource'); stage(requestedStage);
  if (excludeJobId !== '') identifier(excludeJobId);
  return availabilityUnchecked(validateState(state), id, requestedStage, excludeJobId);
}
export function assessJob(state, input) { return assessmentUnchecked(validateState(state), normalizeJob(input)); }
const sameJobContent = (a, b) => JSON.stringify({...a, status: 'draft'}) === JSON.stringify({...b, status: 'draft'});
function sameJobScope(a, b) {
  const scope = ({checks, status, ...value}) => value;
  return JSON.stringify(scope(a)) === JSON.stringify(scope(b));
}

/** Compare the version a form read before changing anything. The store repeats this in one transaction. */
export function applyCommand(input, command, expectedRevision) {
  const state = validateState(input);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== state.revision) fail('This plan changed in another tab. Reload it before saving.', 'STALE_REVISION');
  if (!command || typeof command !== 'object' || Array.isArray(command)) fail('Choose a booking action.');
  const commands = {saveJob: ['type', 'job'], reserveJob: ['type', 'job'], releaseJob: ['type', 'id'], deleteJob: ['type', 'id'], setBusy: ['type', 'id', 'stage', 'busy'], setContext: ['type', 'context']};
  if (!own(commands, command.type)) fail('Unknown booking action.');
  object(command, commands[command.type], 'Booking action');
  if (command.type === 'saveJob' || command.type === 'reserveJob') {
    const job = normalizeJob(command.job);
    const previous = state.jobs.find(value => value.id === job.id);
    if (!previous && state.jobs.length >= LIMITS.jobs) fail('This plan already has ' + LIMITS.jobs + ' jobs.');
    const changedScope = Boolean(previous && !sameJobScope(previous, job));
    if (command.type === 'reserveJob' && changedScope) fail('The job details changed. Save the changes first, then check the changed job before reserving resources.', 'CHANGED_SCOPE');
    if (command.type === 'saveJob' && changedScope) job.checks = Object.fromEntries(CHECK_KEYS.map(key => [key, 'unknown']));
    job.status = command.type === 'saveJob' && previous?.status === 'reserved' && sameJobContent(previous, job) ? 'reserved' : 'draft';
    if (command.type === 'reserveJob') {
      const assessment = assessmentUnchecked(state, job);
      if (!assessment.canReserve) fail(assessment.reasons.join(' '), 'RESERVATION_BLOCKED');
      job.status = 'reserved';
    }
    const index = state.jobs.findIndex(value => value.id === job.id);
    if (index >= 0) state.jobs[index] = job; else state.jobs.push(job);
  } else if (command.type === 'releaseJob' || command.type === 'deleteJob') {
    identifier(command.id);
    const job = state.jobs.find(value => value.id === command.id);
    if (!job) fail('The selected job no longer exists.', 'NOT_FOUND');
    if (command.type === 'deleteJob') state.jobs = state.jobs.filter(value => value.id !== job.id);
    else job.status = 'released';
  } else if (command.type === 'setBusy') {
    const id = enumeration(command.id, RESOURCE_IDS, 'Resource'), round = stage(command.stage);
    if (typeof command.busy !== 'boolean') fail('Busy must be true or false.');
    const current = availabilityUnchecked(state, id, round);
    if (command.busy && current.status === 'booked') fail(id + ' is already reserved for ' + current.label.replace(/^Booked for /, '') + '. Release or edit that booking first.', 'RESOURCE_BOOKED');
    state.busy[id] = command.busy ? [...new Set([...state.busy[id], round])].sort() : state.busy[id].filter(value => value !== round);
  } else {
    const nextContext = context(command.context);
    if (JSON.stringify(nextContext) !== JSON.stringify(state.context)) {
      state.context = nextContext;
      state.jobs = state.jobs.map(job => ({...job, status: job.status === 'reserved' ? 'draft' : job.status, checks: Object.fromEntries(CHECK_KEYS.map(key => [key, 'unknown']))}));
    }
  }
  state.revision += 1;
  return validateState(state);
}
