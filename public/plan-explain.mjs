/** Turn a computed plan into short explanations. Pure functions: no page access and no decisions of their own. */

export const STEPS = ['Job', 'Team', 'Checks', 'Plan'];

/** JSON text with sorted keys, so two equal objects always compare equal. */
export function stableText(value) {
  if (Array.isArray(value)) return '[' + value.map(stableText).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stableText(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

/** Does the recorded assessment still describe the entries on screen? */
export function assessmentState(input) {
  const review = input?.review;
  if (!review || review.decision === 'UNKNOWN') return 'none';
  if (review.decision === 'FAIL') return 'attention';
  const scope = {...input}; delete scope.review;
  if (!review.by?.trim() || !review.date || review.scope === null) return 'incomplete';
  return stableText(review.scope) === stableText(scope) ? 'current' : 'stale';
}

export const assessmentWords = {
  none: 'Not recorded for the current entries',
  attention: 'Recorded: needs attention',
  incomplete: 'Incomplete: add a name and a date',
  current: 'Recorded for these entries',
  stale: 'Out of date: the entries changed after it was recorded',
};

/** The label shown on a job in the plan: a symbol, words and a tone. Colour is never the only signal. */
export function rowBadge(row, personLabel) {
  const state = row.state, decided = row.decidedBy || [];
  if (state === 'MANUAL_ASSIGNED') return {icon: '✓', text: 'Assigned: ' + (personLabel || row.person || 'a person'), tone: 'good'};
  if (state === 'WAITING_FOR_PERSON') return {icon: '◷', text: 'Needs a person', tone: 'waiting'};
  if (state === 'CONDITIONAL_ON_INPUT') return {icon: '◷', text: 'Waits for an earlier job', tone: 'waiting'};
  if (state === 'BLOCKED_INPUT' || decided.some(item => item.scope === 'order')) return {icon: '◷', text: 'Earlier job is not ready', tone: 'waiting'};
  // "Stopped" is kept for an answer that says no. An answer that is only missing reads "Needs a check".
  if (state === 'BLOCKED_SHARED' || state === 'BLOCKED_TASK_CONDITION' || decided.some(item => item.value === 'FAIL')) return {icon: '⊘', text: 'Stopped by a check', tone: 'bad'};
  if (decided.some(item => item.check === 'access' && item.value === 'SPECIALIST')) return {icon: '⊘', text: 'Needs a specialist plan', tone: 'bad'};
  return {icon: '?', text: 'Needs a check', tone: 'waiting'};
}

/** The exact declared answers that produced this result. */
export function decidedLines(row) {
  return (row.decidedBy || []).map(item => {
    const where = item.where ? ' (' + item.where + ')' : '';
    return item.label + where + ': ' + item.valueWords;
  });
}

const outcomeWords = {
  ASSIGNED_HERE: 'assigned to this job',
  NOT_TRAINED: 'not listed as trained for this job',
  BUSY: 'trained, but marked busy in this stage',
  AVAILABILITY_NOT_CHECKED: 'trained, but availability is not checked',
  NEEDED_BY_ANOTHER_JOB: 'trained and free, but planned on another job in this stage',
  FREE_NOT_NEEDED: 'trained and free, not needed here',
};

/** Why each person was or was not given this job. */
export function peopleLines(row) {
  return (row.peopleConsidered || []).map(person => {
    const other = person.outcome === 'NEEDED_BY_ANOTHER_JOB' && person.reservedForLabel ? ': ' + person.reservedForLabel : '';
    return person.label + ': ' + (outcomeWords[person.outcome] || person.outcome) + other + '.';
  });
}

/** One part of the robot work for a job, with the records it was compared against. */
export function partView(part) {
  const records = (part.records || []).map(record => {
    const team = record.onTeam ? 'on your team' : 'not on your team';
    const differs = record.differsWords?.length ? 'differs in ' + record.differsWords.join(', ') : 'matches';
    return record.id + ' (' + record.platform + ', ' + team + '): ' + differs + '.';
  });
  const rule = part.selector?.called
    ? 'Decision rule asked. Answer: ' + part.selector.decision + ' (' + (part.selector.reasons || []).join('; ') + ').'
    : 'Decision rule not asked. ' + (part.selector?.reason || '');
  return {title: part.label, status: 'Not supported here', summary: part.summary, records, recordsNote: part.recordsNote || '', rule,
    assumption: part.selector?.called ? (part.selector.assumption || '') : '',
    ruleNote: part.selector?.called ? (part.selector.note || '') : '', needed: part.evidenceNeeded || []};
}

/** What recomputing the plan in the opposite listed order showed. */
export function orderLines(check) {
  if (!check) return [];
  const lines = ['The planner worked the plan out twice: once in your order and once with the jobs listed in the opposite order.'];
  if (check.sameStates && check.samePeople) lines.push('Both orders give every job the same result and the same person.');
  else if (check.sameJobsAssigned) lines.push('Both orders staff the same jobs. The person given to a job can differ.');
  else lines.push('Both orders staff the same number of jobs. Which job waits depends on the order, because more ready jobs than people compete in one stage.');
  lines.push('The number of jobs given a person in each stage never depends on the order.');
  return lines;
}

/** For a one-click example: how each job differs from the comparison example. */
export function compareRows(before, after, label = row => row.label) {
  const earlier = new Map((before || []).map(row => [row.id, row]));
  return (after || []).map(row => {
    const old = earlier.get(row.id);
    const was = old ? rowBadge(old, old.personLabel).text : 'not in the comparison';
    const now = rowBadge(row, row.personLabel).text;
    return {id: row.id, job: label(row), before: was, after: now, changed: was !== now};
  });
}

/** Continue numbering after ids such as job-3, so loaded examples never collide with new entries. */
export function nextCounters(input) {
  const highest = (values, prefix) => values.reduce((max, value) => {
    const match = new RegExp('^' + prefix + '-(\\d+)$').exec(String(value));
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return {
    job: highest((input.tasks || []).map(task => task.id), 'job'),
    room: highest((input.rooms || []).map(room => room.id), 'room'),
    place: highest((input.tasks || []).map(task => task.placeId), 'place'),
  };
}

/** Plain words for which of the two people can stand beside a robot. */
export function roleWords(roles) {
  if (!roles?.length) return 'No robot role in this example.';
  const words = {attendant: 'start a robot and watch it', operator: 'command a robot', confirmer: 'give a robot its OK'};
  return 'Can ' + roles.map(role => words[role] || role).join(', ') + '.';
}
