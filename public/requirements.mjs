/** Turn the customer's contact-force fields into one exact value or an interval. */
export function forceRequirement(mode, minimum, maximum) {
  if (!['exact', 'range'].includes(mode)) throw new Error('Choose an exact setting or a range.');
  if (String(minimum).trim() === '' || (mode === 'range' && String(maximum).trim() === '')) {
    throw new Error('Enter a force value in each box.');
  }
  const min = Number(minimum), max = mode === 'exact' ? min : Number(maximum);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max > 100 || min > max) {
    throw new Error('Use a value above 0 and up to 100 N. The first value cannot be larger than the second.');
  }
  return {min, max};
}

export function forceLabel(force) {
  return force.min === force.max ? `Exactly ${force.min} N` : `${force.min}–${force.max} N accepted`;
}
