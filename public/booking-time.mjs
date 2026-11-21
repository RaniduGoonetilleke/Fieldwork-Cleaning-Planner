/** Manager-entered timing assumptions; no robot performance model. */
export function timeEstimate(job) {
  const value = job.timeEstimate;
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 2 || !Object.hasOwn(value, 'basis') || !Object.hasOwn(value, 'minutes')) throw new Error('Enter a timing basis and a positive number of minutes.');
  if (!['total', 'area'].includes(value.basis) || typeof value.minutes !== 'number' || !Number.isFinite(value.minutes) || value.minutes <= 0 || value.minutes > 1000000) throw new Error('Enter a positive time no larger than 1,000,000 minutes.');
  let units = 1;
  if (value.basis === 'area') {
    if (!['windows', 'facade'].includes(job.kind) || !job.groups?.length) throw new Error('Minutes per square metre needs window dimensions.');
    units = job.groups.reduce((total, g) => total + g.count * g.width * g.height * (g.faces === 'both' ? 2 : 1), 0);
    if (!Number.isFinite(units) || units <= 0) throw new Error('Enter the window numbers and sizes first.');
  }
  const minutes = units * value.minutes;
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 1000000000) throw new Error('The calculated duration is too large for this draft.');
  return {minutes, basis: value.basis, enteredMinutes: value.minutes, area: value.basis === 'area' ? units : null};
}
export function durationLabel(minutes) {
  const rounded = Math.ceil(minutes), hours = Math.floor(rounded / 60), remainder = rounded % 60;
  return hours ? hours + ' h' + (remainder ? ' ' + remainder + ' min' : '') : rounded + ' min';
}
export function timingDescription(job) {
  const estimate = timeEstimate(job);
  if (!estimate) return 'Estimated duration: not entered.';
  const source = estimate.basis === 'area' ? Number(estimate.area.toFixed(6)) + ' m² × ' + estimate.enteredMinutes + ' min/m²' : 'total time entered for the selected team';
  return 'Estimated duration: about ' + durationLabel(estimate.minutes) + ' (' + source + '). Manager estimate, not measured robot performance.';
}
