import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = name => fs.readFileSync(new URL('../public/' + name, import.meta.url), 'utf8');
const html = read('index.html'), customer = read('customer.js'), team = read('team.js'), registry = read('registry-ui.js'), css = read('flow.css');

assert.match(html, /<html lang="en" data-theme="dark">/, 'Dark is the first theme.');
assert.match(html, /id="theme-switch"/, 'A light-theme switch stays available.');
assert.ok(html.indexOf('⌂ Plan a job') > 0 && html.indexOf('⌂ Plan a job') < html.indexOf('◈ Tested examples'), 'Plan a job is the first choice.');
assert.match(html, /<link rel="stylesheet" href="\/flow\.css">/);
assert.ok(!/(src|href)="https?:/.test(html), 'The page loads nothing from another site.');
assert.match(html, /<div id="team-stage"[^>]+hidden>/, '3D stays optional and closed.');

assert.equal(customer.match(/innerHTML/g).length, 1, 'Only the fixed icon drawings use innerHTML; typed text is never parsed as HTML.');
assert.match(customer, /holder\.innerHTML = '<svg /);
assert.ok(!/\beval\(|new Function\(|document\.write\(/.test(customer + team + registry), 'No supplied text is executed.');
for (const name of ['CHECKS', 'PERMISSION', 'AVAILABILITY', 'DECISION']) {
  const line = customer.split('\n').find(text => text.startsWith('const ' + name + ' = '));
  const options = Function('return ' + line.slice(line.indexOf('=') + 1).replace(/;$/, ''))();
  assert.equal(options.length, 3);
  assert.equal(options[0][0], 'UNKNOWN', name + ' starts from the unknown answer.');
  options.forEach(([id, text, icon]) => assert.ok(id && text.length > 3 && icon.length === 1, 'Each answer has words and a symbol.'));
}
assert.match(customer, /setAttribute\('aria-pressed', String\(id === value\)\)/, 'The chosen answer is exposed to assistive technology.');
assert.match(css, /\.flow-tri-option\[aria-pressed=true\]\{border-width:2px/, 'The chosen answer differs by border and weight as well as colour.');
assert.match(css, /focus-visible\{outline:3px solid/, 'Keyboard focus is visible.');

assert.match(customer, /fetch\('\/api\/replay'/, 'A plan can be recomputed from the page.');
assert.ok(!customer.includes('python3 verify_release.py'), 'Customer pages do not show terminal commands.');
assert.match(customer, /el\('dialog', 'flow-technical-dialog'\)/, 'Technical details use a keyboard-accessible native dialog.');
assert.match(customer, /setAttribute\('aria-haspopup', 'dialog'\)/);
assert.match(customer, /refs\.technicalDialog\?\.open\) refs\.technicalDialog\.close\(\)/, 'Editing closes stale technical details.');
assert.match(customer, /does not rerun a robot study, a G1 simulation or any cleaning/);
assert.match(customer, /state\.gate\.invalidate\(\); state\.controller\?\.abort\(\)/, 'An edit cancels an answer that is still on its way.');
assert.match(customer, /if \(!state\.gate\.accepts\(token\)\) return;/);
assert.match(customer, /The earlier plan was cleared\./, 'Clearing an old plan is announced.');
assert.match(customer, /Not tested here/);
assert.match(customer, /Not in your team/);
assert.match(customer, /not recommendations to buy/);

assert.match(team, /g1_helper_free:/); assert.match(team, /g1_helper_busy:/);
assert.match(registry, /Admitted to the planner/);
assert.match(registry, /'0 of your entries'/, 'No local entry is ever counted as used in plans.');
assert.match(registry, /EXAMPLE \(invented\)/);
assert.ok(!/planner|\/api\/(customer|job|decision)/.test(read('registry-store.js').replace(/never modify the verified planner/, '')), 'The notebook store has no path into planning.');
assert.ok(!/camera-guided/i.test(customer + team + html), 'The UR5 is not described as guided by its camera.');
assert.match(html, /G1 simulation wipe · helper free/); assert.match(customer, /G1 simulation test with its helper/);
assert.ok(!/cannot be entered twice under a similar name/.test(customer), 'The room-name guard is not overstated.');
assert.match(customer, /if \(view\.assumption\) item\.append\(el\('p', 'flow-assumption', view\.assumption\)\);/, 'The assumption is drawn beside the rule result.');
assert.match(customer, /coverage\.routeNote/); assert.match(customer, /coverage\.gapsNote/);
assert.ok(!/Every answer in an example is invented/.test(customer), 'The G1 examples are not described as invented evidence.');
assert.match(customer, /The G1 examples use recorded simulation results with invented current conditions\./);
assert.ok(!/Python 3\.10 or later/.test(customer + read('../README.md')), 'Only the Python versions actually checked are named.');
assert.match(registry, /a reviewed update to the planner itself/);
// This file checks the page source for required safeguards. How the page behaves is checked in the browser walk-through.
console.log('The page source keeps its flow, safe text handling, visible states, reproduction guide and notebook boundary.');
