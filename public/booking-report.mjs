import {validateState, assessJob, quantities, requiredResources, availability, RESOURCE_IDS, CHECK_KEYS, SCOPE} from './booking-core.mjs';

export const BOOKING_EXPORT_SCHEMA = 'fieldwork-booking-export-v1';
export const BOOKING_RELEASE = 'building-planner-20261115';
const resourceNames = {UR3: 'UR3', UR5: 'UR5', G1: 'G1', H1: 'Robot helper', H2: 'Cleaner'};
const jobNames = {windows: 'Windows', whiteboards: 'Whiteboards', walls: 'Walls', desks: 'Desks', floors: 'Floors', bins: 'Bins', facade: 'Building facade'};
const checkNames = {area: 'Area check', permission: 'Permission to work', surface: 'Surface check', people: 'People and roles', equipment: 'Equipment check', access: 'Access check'};
const checkWords = {yes: 'Checked', no: 'Needs attention', unknown: 'Not checked'};
const faceWords = {inside: 'inside face', outside: 'outside face', both: 'both faces'};
const block = (kind, text) => ({kind, text: String(text)});
const body = text => block('body', text);
const note = text => block('note', text);
const names = ids => ids.map(id => resourceNames[id]).join(' + ');
const modeName = job => job.mode === 'manual' ? 'Manual work' : job.mode + ' with a robot helper';
const areaText = value => String(Number(value.toFixed(6)));

// Object key order is immaterial. List order, values and types remain exact.
export function canonicalBookingJSON(value) {
  if (value === null || ['string', 'boolean'].includes(typeof value)) return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalBookingJSON).join(',') + ']';
  if (value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalBookingJSON(value[key])).join(',') + '}';
  }
  throw new Error('The booking export contains a value that is not plain JSON.');
}

async function fingerprint(value) {
  if (!globalThis.crypto?.subtle) throw new Error('Exact exports need a secure browser connection or a supported Node.js version.');
  const bytes = new TextEncoder().encode(canonicalBookingJSON(value));
  return [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
}

function payload(input) {
  const state = validateState(input);
  return {
    schema: BOOKING_EXPORT_SCHEMA,
    release: BOOKING_RELEASE,
    state,
    assessments: state.jobs.map(job => ({jobId: job.id, ...assessJob(state, job)})),
  };
}

export async function exactBookingExport(input) {
  const data = payload(input);
  return JSON.stringify({...data, digest: await fingerprint(data)}, null, 2) + '\n';
}

/** Recompute a saved draft without importing it into the browser's bookings. */
export async function verifyBookingExport(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > 2_000_000) throw new Error('Choose a booking JSON export smaller than 2 MB.');
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('The selected file is not valid JSON.'); }
  const expected = ['schema', 'release', 'state', 'assessments', 'digest'];
  if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).length !== expected.length || expected.some(key => !Object.hasOwn(data, key))) throw new Error('The file is not an exact booking export.');
  if (data.schema !== BOOKING_EXPORT_SCHEMA) throw new Error('This booking export format is not supported.');
  if (data.release !== BOOKING_RELEASE) throw new Error('This file belongs to another app release. Use that release to replay it.');
  if (typeof data.digest !== 'string' || !/^[0-9a-f]{64}$/.test(data.digest)) throw new Error('The export fingerprint is missing or invalid.');
  const recomputed = payload(data.state);
  if (canonicalBookingJSON(data.state) !== canonicalBookingJSON(recomputed.state)) throw new Error('The saved inputs are not in the form this release exports.');
  if (canonicalBookingJSON(data.assessments) !== canonicalBookingJSON(recomputed.assessments)) throw new Error('The saved job assessments do not match the entered answers.');
  if (await fingerprint(recomputed) !== data.digest) throw new Error('The export fingerprint does not match its inputs and assessments.');
  return {ok: true, ...recomputed, digest: data.digest};
}

function bookingText(job) {
  if (job.status === 'reserved') return 'Provisional booking saved';
  if (job.status === 'released') return 'Booking released: no resources held';
  return 'Draft: no resources reserved';
}

export function bookingReport(input) {
  const state = validateState(input);
  const title = state.context.building ? state.context.building + ' — draft resource plan' : 'Draft resource plan';
  const blocks = [block('kicker', 'ENTERED BUILDING JOBS'), block('title', title)];
  for (const field of ['company', 'customer']) if (state.context[field]) blocks.push(body((field === 'company' ? 'Cleaning company' : 'Customer') + ': ' + state.context[field]));
  blocks.push(note(SCOPE), body('Bookings are local to this browser. Availability is a planning assumption or user declaration, not live status from robots or a shared company calendar.'), body('Jobs in the same stage compete for the same resources. The two stages express order, without measured durations, travel times or costs.'));
  if (!state.jobs.length) blocks.push(body('No jobs have been saved.'));
  for (const stage of [1, 2]) {
    blocks.push(block('section', 'Stage ' + stage + ' resources'));
    for (const id of RESOURCE_IDS) blocks.push(body(resourceNames[id] + ': ' + availability(state, id, stage).label + '.'));
  }
  for (const job of state.jobs) {
    const assessment = assessJob(state, job), total = quantities(job);
    blocks.push(block('section', job.name), body(jobNames[job.kind] + ' / ' + job.place + ' / Stage ' + job.stage), block('label', bookingText(job)), body('Requested team: ' + names(requiredResources(job)) + '. Method: ' + modeName(job) + '.'), body('Access: ' + (job.access === 'floor' ? 'from the floor' : 'specialist access') + '.'));
    if (job.groups.length) {
      blocks.push(block('label', 'Window quantities and approximate sizes'));
      job.groups.forEach((group, index) => blocks.push(body('Group ' + (index + 1) + ': ' + group.count + ' windows, about ' + group.width + ' m wide × ' + group.height + ' m high, ' + faceWords[group.faces] + '.')));
      blocks.push(body('Total: ' + total.windows + ' windows; about ' + areaText(total.area) + ' m² across the requested faces.'), note('Area assumes rectangular windows: count × width × height, doubled for both faces. These quantities do not establish robot capacity, reach, cleaning speed or suitability.'));
    }
    blocks.push(block('label', 'Entered checks'));
    for (const key of CHECK_KEYS) blocks.push(body(checkNames[key] + ': ' + checkWords[job.checks[key]] + '.'));
    if (assessment.reasons.length) blocks.push(block('label', 'What needs attention'), ...assessment.reasons.map(body));
    else blocks.push(body('The entered checks allow a provisional resource reservation. Suitability still needs separate confirmation.'));
    if (job.notes) blocks.push(block('label', 'Job notes'), body(job.notes));
  }
  blocks.push(block('section', 'Using this report'), body('This is a readable snapshot. A later edit needs a new report. The optional exact JSON export can be recomputed with this release, but the PDF itself is not a replay file.'), note('The app has not inspected the building or verified these answers. A saved outcome or supervisor check does not qualify a robot or release a booking.'));
  return {title, blocks};
}

function compactMethod(job) {
  const total = quantities(job);
  const groups = job.groups.map((group, index) => `${index + 1}:${group.count}×${group.width}×${group.height}m/${group.faces}`).join('; ');
  const lines = ['Requested: ' + modeName(job) + '; access: ' + job.access + '.', 'Requested team: ' + names(requiredResources(job)) + '.'];
  if (groups) lines.push('Window groups (count×width×height; faces): ' + groups + '.', 'Total: ' + total.windows + ' windows, approx. ' + areaText(total.area) + ' m².');
  if (job.notes) lines.push('Job notes: ' + job.notes);
  lines.push('Draft resource plan only; suitability unconfirmed. No work is approved by this snapshot.');
  const value = lines.join('\n');
  if (value.length > 1000) throw new Error('This job is too long for a linked outcome note. Keep the exact JSON export as its full record.');
  return value;
}

export async function planSnapshots(input) {
  const data = payload(input), digest = await fingerprint(data);
  const buildingId = 'building-' + await fingerprint(data.state.context);
  return Promise.all(data.state.jobs.map(async job => {
    const placeKey = (await fingerprint({building: buildingId, place: job.place})).slice(0, 32);
    const plannedState = {draft: 'DRAFT', reserved: 'PROVISIONAL_BOOKING', released: 'RELEASED'}[job.status];
    const plannedText = bookingText(job) + '. Suitability remains to be confirmed; this does not approve work or establish new robot capability.';
    return {
      digest, release: BOOKING_RELEASE, buildingId, buildingName: data.state.context.building || 'Building not entered',
      taskId: job.id, jobType: job.kind, jobLabel: job.name, roomId: 'area-' + placeKey, roomName: 'Declared job location',
      placeId: 'place-' + placeKey, placeName: job.place,
      plannedState, plannedText, customer: data.state.context.customer, company: data.state.context.company,
      method: compactMethod(job), stage: job.stage, inventedExample: false,
    };
  }));
}
