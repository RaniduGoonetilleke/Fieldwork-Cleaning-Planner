import {forceLabel} from './requirements.mjs';

const titles = {
  'T-WB-L': 'Find the taped whiteboard area',
  'T-WS-D': 'Wipe simulated wall spot D',
  'T-WS-AB': 'Wipe the untested spot between A and B',
  'T-SH': 'Pass a registered cube',
  'T-WB-W': 'Wipe the detected whiteboard area',
};

export function testedTaskDisplay(task, scenario) {
  const request = scenario?.tasks?.find(item => item.id === task.id)?.request;
  const force = request?.force;
  const min = force?.minimum_n, max = force?.maximum_n;
  const validForce = Number.isFinite(min) && Number.isFinite(max) && min > 0 && max >= min;
  return {
    title: titles[task.id] || task.label || task.id,
    requirement: validForce ? 'Requested force: ' + forceLabel({min, max}) : '',
  };
}
