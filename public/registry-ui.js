import {notebookReport, planPdfButton} from './plan-report.mjs';
import { createStore, BUILTIN_ROBOTS } from './registry-store.js';
import { createJobReviewStore, STORAGE_KEY as JOB_REVIEW_KEY } from './job-review-store.js';
import { renderJobReviews, markChangedElsewhere, STALE_NOTE, NOT_LISTED_NOTE } from './job-review-ui.js';

const OUTCOMES = { PASS: 'Passed', FAIL: 'Failed', INCONCLUSIVE: 'Unclear' };
const DOMAIN = { simulation: 'Simulation', physical: 'Physical robot' };
const TABS = [['robots', 'Robots'], ['results', 'Results'], ['reviews', 'Job reviews']];
const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const button = (text, onClick, className = 'registry-button') => {
  const node = el('button', className, text); node.type = 'button';
  if (onClick) node.addEventListener('click', onClick);
  return node;
};
const pill = (text, tone = '') => el('span', `registry-pill ${tone}`, text);
const field = (form, label, name, options = {}) => {
  const wrapper = el('label', `registry-field${options.wide ? ' registry-wide' : ''}`);
  wrapper.append(el('span', '', label));
  let input;
  if (options.choices) {
    input = document.createElement('select');
    options.choices.forEach(([value, text]) => { const option = el('option', '', text); option.value = value; input.append(option); });
  } else input = document.createElement(options.multiline ? 'textarea' : 'input');
  if (!options.choices && !options.multiline) input.type = options.type || 'text';
  input.name = name; input.setAttribute('aria-label', label);
  if (options.required) input.required = true;
  if (options.placeholder) input.placeholder = options.placeholder;
  if (options.maxLength) input.maxLength = options.maxLength;
  if (options.min !== undefined) input.min = options.min;
  if (options.step !== undefined) input.step = options.step;
  if (options.disabled) input.disabled = true;
  if (options.multiline) input.rows = 3;
  if (options.value !== undefined) input.value = String(options.value);
  wrapper.append(input);
  if (options.hint) wrapper.append(el('small', '', options.hint));
  form.append(wrapper);
  return input;
};
const formActions = (form, label) => {
  const actions = el('div', 'registry-form-actions registry-wide');
  const submit = button(label, null, 'registry-button registry-primary'); submit.type = 'submit';
  actions.append(submit); form.append(actions);
  return actions;
};
const disclosure = (label, className = '') => {
  const details = el('details', `registry-disclosure ${className}`);
  details.append(el('summary', '', label));
  return details;
};

export function initRegistry({ dialogId = 'registry-dialog' } = {}) {
  const dialog = document.getElementById(dialogId);
  const content = dialog?.querySelector('#registry-content');
  if (!dialog || !content) throw new Error('The robot and results dialog is missing.');
  dialog.classList.add('registry-dialog'); dialog.setAttribute('aria-labelledby', 'registry-title');
  const closeButton = dialog.querySelector('#registry-close');
  const launcher = document.getElementById('manage-registry');
  let store, storeError = null, data = { robots: [], results: [] };
  let activeTab = 'robots', showArchived = false, opener = null, destroyed = false;
  let messageNode, errorNode, panels, tabButtons, addResultDetails, resultRobotInput, backupButton;
  let includedData = null, includedRequest = null, includedController = null;
  let reviewStore, reviewError = null, reviews = [], plannedJobs = null, openReviewForm = false, openCheckFor = null, reloadedId = null;
  try { store = createStore(window.localStorage); data = store.load(); }
  catch (error) { storeError = error; }
  const loadReviews = () => {
    try { if (!reviewStore) reviewStore = createJobReviewStore(window.localStorage); reviews = reviewStore.load().reviews; reviewError = null; }
    catch (error) { reviewError = error; }
  };
  loadReviews();

  const robotById = id => [...BUILTIN_ROBOTS, ...data.robots].find(robot => robot.id === id);
  const robotName = id => robotById(id)?.name || id;
  const errorText = error => error?.message || 'The change could not be saved. Please try again.';
  const showError = error => {
    errorNode.textContent = errorText(error); errorNode.hidden = false;
    errorNode.focus();
  };
  const announce = text => { messageNode.textContent = text; messageNode.focus(); };
  const mutate = (action, success) => {
    try {
      action(); data = store.load(); storeError = null;
      render(); announce(success);
      return true;
    } catch (error) { showError(error); return false; }
  };
  // Job reviews live in their own store. Saving one reloads only that store.
  const mutateReviews = (action, success) => {
    try {
      const result = action(), outcome = success(result);
      reviews = reviewStore.load().reviews; reviewError = null; openReviewForm = false; openCheckFor = outcome.openCheck || null; reloadedId = null;
      render(); announce(outcome.message);
      return true;
    } catch (error) {
      // Any other refusal, including a save that collided with another tab's save, leaves the form as it is. Nothing was
      // saved, and pressing the button again is checked by the store against the saved note like any other action.
      if (!['stale', 'not_found'].includes(error?.code)) { showError(error); return false; }
      // The store refused because the saved note is not the one this page was showing. Show what is saved, with every form
      // closed and empty. The refused action is never tried again against the newer note: the user has to act again.
      loadReviews(); openReviewForm = false; openCheckFor = null; reloadedId = error.reviewId || null;
      render();
      const shownAgain = content.querySelector('.registry-reloaded-note');
      errorNode.textContent = error.code === 'not_found' ? 'This note is no longer saved in this browser, so nothing was saved. The notes below show what is saved.' : errorText(error) + ' ' + (shownAgain || !reloadedId ? STALE_NOTE : NOT_LISTED_NOTE);
      errorNode.hidden = false; (shownAgain || errorNode).focus();
      return false;
    }
  };
  // Another tab or window saved job reviews. Mark what is out of date here without replacing anything being typed.
  // This is a convenience only. The store refuses an out-of-date form whether or not this notice was shown.
  const showSavedReviews = () => { reloadedId = null; refresh(); announce('These are the job reviews as they are saved now.'); };
  const onStorage = event => {
    if (destroyed || !dialog.open || !panels?.reviews || !reviewStore) return;
    if (event.storageArea !== window.localStorage || (event.key !== null && event.key !== JOB_REVIEW_KEY)) return;
    let saved; try { saved = reviewStore.load().reviews; } catch { refresh(); return; }
    markChangedElsewhere(panels.reviews, saved, { el, button, reload: showSavedReviews });
  };
  const download = (text, filename, success) => {
    try {
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      announce(success);
    } catch (error) { showError(error); }
  };
  const switchTab = (name, focus = false) => {
    activeTab = name;
    Object.entries(panels).forEach(([id, panel]) => { panel.hidden = id !== name; });
    Object.entries(tabButtons).forEach(([id, tab]) => {
      tab.setAttribute('aria-selected', String(id === name)); tab.tabIndex = id === name ? 0 : -1;
    });
    // This button copies robots and results. Job reviews have their own download on their tab.
    if (backupButton) backupButton.hidden = name === 'reviews';
    if (focus) tabButtons[name].focus();
  };
  const openResultFor = id => {
    switchTab('results'); addResultDetails.open = true;
    if (id) resultRobotInput.value = id;
    resultRobotInput.focus(); addResultDetails.scrollIntoView({ block: 'nearest' });
  };

  function robotForm(robot = null) {
    const form = el('form', 'registry-form');
    field(form, 'Robot name', 'name', { value: robot?.name || '', required: true, maxLength: 120, placeholder: 'e.g. Lab arm' });
    field(form, 'Robot type', 'type', { value: robot?.type || '', required: true, maxLength: 80, placeholder: 'e.g. Robot arm or humanoid' });
    field(form, 'Where it works', 'domain', { choices: [['physical', 'Physical robot'], ['simulation', 'Simulation']], value: robot?.domain || 'physical' });
    field(form, 'Notes (optional)', 'notes', { value: robot?.notes || '', multiline: true, maxLength: 2000, wide: true });
    if (robot && data.results.some(result => result.robotId === robot.id && result.review)) form.append(el('p', 'registry-form-note registry-wide', 'Saving changes removes the reviews recorded for this robot’s results.'));
    formActions(form, robot ? 'Save changes' : 'Add robot');
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const values = Object.fromEntries(new FormData(form));
      mutate(() => robot ? store.updateRobot(robot.id, values) : store.addRobot(values), robot ? 'Robot updated.' : 'Robot saved in this browser.');
    });
    return form;
  }

  function resultForm(result = null) {
    const form = el('form', 'registry-form');
    const choices = [...BUILTIN_ROBOTS, ...data.robots.filter(robot => !robot.archivedAt)]
      .map(robot => [robot.id, `${robot.name} · ${DOMAIN[robot.domain]}`]);
    if (result && !choices.some(([id]) => id === result.robotId)) choices.push([result.robotId, `${robotName(result.robotId)} · archived`]);
    const robotInput = field(form, 'Robot', 'robotId', { choices, required: true, value: result?.robotId || choices[0]?.[0] || '' });
    if (!result) resultRobotInput = robotInput;
    field(form, 'What was tested?', 'task', { required: true, maxLength: 160, value: result?.task || '', placeholder: 'e.g. Wipe a whiteboard' });
    field(form, 'Test setting', 'context', { required: true, maxLength: 240, value: result?.context || '', placeholder: 'e.g. Lab whiteboard setup' });
    field(form, 'Test location', 'location', { required: true, maxLength: 160, value: result?.location || '', placeholder: 'e.g. Whiteboard 1 or wall spot B' });
    field(form, 'Test date', 'date', { required: true, type: 'date', value: result?.date || today() });
    field(form, 'What happened?', 'outcome', { required: true, choices: [['PASS', 'Passed'], ['FAIL', 'Failed'], ['INCONCLUSIVE', 'Unclear']], value: result?.outcome || 'INCONCLUSIVE' });
    field(form, 'Evidence link or file reference', 'evidence', { required: true, maxLength: 4000, wide: true, value: result?.evidence || '', placeholder: 'https://… or results/run-01.json', hint: 'This saves a reference. It does not upload the file.' });
    const extra = disclosure('Settings and notes (optional)', 'registry-wide');
    const extraFields = el('div', 'registry-form registry-subform');
    field(extraFields, 'Right force (N)', 'rightForceN', { type: 'number', min: 0, step: 'any', value: result?.settings?.rightForceN ?? '' });
    field(extraFields, 'Left force (N)', 'leftForceN', { type: 'number', min: 0, step: 'any', value: result?.settings?.leftForceN ?? '' });
    field(extraFields, 'Other settings', 'settingsDescription', { value: result?.settings?.description || '', maxLength: 1000, wide: true });
    field(extraFields, 'Notes', 'notes', { multiline: true, value: result?.notes || '', maxLength: 4000, wide: true });
    extra.append(extraFields); form.append(extra);
    if (result?.review) form.append(el('p', 'registry-form-note registry-wide', 'Saving changes removes the recorded review. Check the updated evidence before recording another review.'));
    formActions(form, result ? 'Save changes' : 'Save result');
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const fields = Object.fromEntries(new FormData(form));
      const settings = {};
      ['rightForceN', 'leftForceN'].forEach(name => { if (fields[name] !== '') settings[name] = Number(fields[name]); });
      if (fields.settingsDescription?.trim()) settings.description = fields.settingsDescription.trim();
      const values = Object.fromEntries(['robotId', 'task', 'context', 'location', 'date', 'outcome', 'evidence', 'notes'].map(name => [name, fields[name] || '']));
      values.settings = settings;
      mutate(() => result ? store.updateResult(result.id, values) : store.addResult(values), result ? 'Result updated. It is ready to be checked again.' : 'Result saved. You can record a review after checking its evidence.');
    });
    return form;
  }

  function reviewForm(result) {
    const form = el('form', 'registry-form');
    form.append(el('p', 'registry-form-note registry-wide', 'Record who checked the saved evidence. This does not approve the robot for a job or independently verify the result.'));
    field(form, 'Reviewer’s name (typed, not verified)', 'reviewer', { required: true, maxLength: 120, wide: true });
    field(form, 'Review note (optional)', 'note', { multiline: true, maxLength: 2000, wide: true });
    const consent = el('label', 'registry-check registry-wide');
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.required = true;
    consent.append(checkbox, el('span', '', 'I have checked the evidence for this saved result.'));
    form.append(consent); formActions(form, 'Record review');
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const values = Object.fromEntries(new FormData(form));
      mutate(() => store.reviewResult(result.id, values), 'Review recorded. This result is not used in job plans.');
    });
    return form;
  }

  function robotCard(robot, builtin = false) {
    const card = el('article', `registry-card${builtin ? ' registry-builtin' : ''}`);
    const heading = el('div', 'registry-card-heading'); heading.append(el('h3', '', robot.name), pill(builtin ? 'Built in' : robot.archivedAt ? 'Archived' : 'Your robot'));
    card.append(heading, el('p', 'registry-meta', `${robot.type} · ${DOMAIN[robot.domain]}`));
    if (builtin) {
      card.append(el('p', 'registry-small', 'Example records · read-only.'));
      const add = button('Add a test result', () => openResultFor(robot.id), 'registry-text-button'); add.disabled = Boolean(storeError); card.append(add);
      return card;
    }
    if (robot.notes) card.append(el('p', 'registry-record-note', robot.notes));
    const actions = el('div', 'registry-card-actions');
    if (robot.archivedAt) actions.append(button('Restore robot', () => mutate(() => store.restoreRobot(robot.id), 'Robot restored.')));
    else {
      actions.append(button('Add result', () => openResultFor(robot.id)));
      actions.append(button('Archive', () => mutate(() => store.archiveRobot(robot.id), 'Robot archived. Use “Show archived” to restore it.'), 'registry-text-button'));
    }
    card.append(actions);
    if (!robot.archivedAt) { const edit = disclosure('Edit robot'); edit.append(robotForm(robot)); card.append(edit); }
    return card;
  }

  function resultCard(result) {
    const card = el('article', 'registry-card registry-result-card');
    const heading = el('div', 'registry-card-heading');
    heading.append(el('h3', '', result.task), pill(OUTCOMES[result.outcome] || 'Unclear', `registry-outcome-${result.outcome.toLowerCase()}`));
    card.append(heading, el('p', 'registry-meta', `${robotName(result.robotId)} · ${DOMAIN[result.domain]} · ${result.date}`));
    card.append(el('p', 'registry-place', `${result.context} · ${result.location}`));
    const reviewLine = el('div', 'registry-review-line');
    reviewLine.append(pill(result.review ? 'Review recorded · not used in plans' : 'Not reviewed · not used in plans'));
    if (result.archivedAt) reviewLine.append(pill('Archived'));
    if (robotById(result.robotId)?.archivedAt) reviewLine.append(pill('Robot archived'));
    card.append(reviewLine);
    const details = disclosure('Evidence and details');
    const detailBody = el('div', 'registry-detail-body');
    detailBody.append(el('strong', '', 'Evidence'));
    let evidenceURL = null;
    try { const url = new URL(result.evidence); if (['http:', 'https:'].includes(url.protocol)) evidenceURL = url.href; } catch {}
    if (evidenceURL) {
      const link = el('a', 'registry-evidence-link', result.evidence); link.href = evidenceURL; link.target = '_blank'; link.rel = 'noopener noreferrer'; detailBody.append(link);
    } else detailBody.append(el('p', 'registry-evidence-reference', result.evidence));
    const settings = [];
    if (result.settings?.rightForceN !== undefined) settings.push(`Right: ${result.settings.rightForceN} N`);
    if (result.settings?.leftForceN !== undefined) settings.push(`Left: ${result.settings.leftForceN} N`);
    if (result.settings?.description) settings.push(result.settings.description);
    if (settings.length) detailBody.append(el('p', '', settings.join(' · ')));
    if (result.notes) detailBody.append(el('p', 'registry-record-note', result.notes));
    if (result.review) {
      detailBody.append(el('strong', '', `Review recorded by ${result.review.reviewer}`));
      detailBody.append(el('p', 'registry-small', result.review.reviewedAt));
      if (result.review.note) detailBody.append(el('p', 'registry-record-note', result.review.note));
    }
    details.append(detailBody); card.append(details);
    const archived = result.archivedAt || robotById(result.robotId)?.archivedAt;
    if (!archived) {
      if (!result.review) { const review = disclosure('Record a review'); review.append(reviewForm(result)); card.append(review); }
      const edit = disclosure('Edit result'); edit.append(resultForm(result)); card.append(edit);
    }
    const actions = el('div', 'registry-card-actions');
    if (result.archivedAt) actions.append(button('Restore result', () => mutate(() => store.restoreResult(result.id), 'Result restored.')));
    else {
      actions.append(button('Archive', () => mutate(() => store.archiveResult(result.id), 'Result archived. Use “Show archived” to restore it.'), 'registry-text-button'));
      if (result.review && !archived) actions.append(button('Remove review', () => mutate(() => store.unreviewResult(result.id), 'Review removed. The saved result is unchanged.'), 'registry-text-button'));
    }
    card.append(actions);
    return card;
  }

  function exportBackup() {
    try {
      const blob = new Blob([store.exportJSON()], { type: 'application/json' });
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = `robot-results-${today()}.json`; document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      announce('Download started. It contains your saved robots, results and recorded reviews.');
    } catch (error) { showError(error); }
  }

  function includedCard(profile, cases) {
    const names = { regulated_wipe: 'Wall wipe and final hold', gesture_handover: 'Registered cube handover', target_detection: 'Target detection' };
    const contexts = { supported_original_wall_point_pilot: 'Original wall with the G1 held at its pelvis', published_single_operator_registered_cubes: 'Published UR3 cell with one operator and registered cubes', reported_indoor_whiteboard_taped_target: 'Indoor whiteboard with a taped frame' };
    const words = value => String(value).replaceAll('_', ' ');
    const settingText = value => Array.isArray(value) ? value.map(settingText).join(', ') : value && typeof value === 'object' ? Object.entries(value).map(([key, item]) => words(key) + ': ' + settingText(item)).join('; ') : value === true ? 'Yes' : value === false ? 'No' : value == null ? 'Not recorded' : words(value);
    const card = el('article', 'registry-card registry-included-card');
    const heading = el('div', 'registry-card-heading');
    const setting = typeof profile.force_setpoint_n === 'number' ? ` · ${profile.force_setpoint_n} N` : '';
    heading.append(el('h3', '', `${profile.platform} · ${names[profile.capability] || words(profile.capability)}${setting}`), pill('Read-only'));
    const evidenceLabel = { 'physical-published': 'Published study', 'physical-report': 'Project records' }[profile.evidence_level];
    const meta = [DOMAIN[profile.domain] || profile.domain, evidenceLabel].filter(Boolean).join(' · ');
    card.append(heading, el('p', 'registry-meta', meta));
    card.append(el('p', 'registry-place', `${contexts[profile.context] || words(profile.context)} · ${profile.platform === 'G1' ? 'Location ' : ''}${words(profile.target)}`));
    const settings = [];
    if (typeof profile.force_setpoint_n === 'number') settings.push(`${profile.settings?.active_pad === 'right' ? 'Right pad' : 'Force setting'}: ${profile.force_setpoint_n} N`);
    if (typeof profile.settings?.idle_pad_force_n === 'number') settings.push(`Idle pad: ${profile.settings.idle_pad_force_n} N`);
    settings.push(profile.confirmation_required ? 'Confirmation required' : 'No per-target confirmation in this profile');
    card.append(el('p', 'registry-included-settings', settings.join(' · ')));
    const limits = cases.find(item => item.id === profile.platform)?.limits;
    if (limits) card.append(el('p', 'registry-small', limits));
    if (profile.platform === 'UR5' && !limits) card.append(el('p', 'registry-small', 'This is a detection record. It does not qualify a wiping task.'));
    const source = disclosure('Recorded settings and limits');
    const body = el('div', 'registry-detail-body');
    const list = el('ul', 'registry-source-list');
    Object.entries(profile.settings || {}).forEach(([key, value]) => list.append(el('li', '', `${words(key)}: ${settingText(value)}`)));
    (profile.qualifiers || []).forEach(qualifier => list.append(el('li', '', qualifier)));
    body.append(list); source.append(body); card.append(source);
    return card;
  }

  async function loadIncluded() {
    if (includedData) return includedData;
    if (!includedRequest) {
      includedController = new AbortController();
      includedRequest = fetch('/api/bootstrap', { signal: includedController.signal })
        .then(response => { if (!response.ok) throw new Error('The included records could not be loaded.'); return response.json(); })
        .then(value => {
          if (!Array.isArray(value.profiles) || !Array.isArray(value.cases) || value.profiles.some(profile => !profile || typeof profile.id !== 'string' || typeof profile.platform !== 'string' || typeof profile.capability !== 'string' || typeof profile.context !== 'string' || typeof profile.target !== 'string')) throw new Error('The included records were not in the expected format.');
          includedData = value; return value;
        })
        .finally(() => { includedRequest = null; });
    }
    return includedRequest;
  }

  function includedResults() {
    const details = disclosure(`Included example results${includedData ? ` (${includedData.profiles.length})` : ''}`, 'registry-included');
    const summary = details.querySelector('summary'), body = el('div', 'registry-included-body');
    details.append(body);
    const show = async () => {
      body.replaceChildren(el('p', 'registry-small', 'Loading included records…')); body.setAttribute('aria-busy', 'true');
      try {
        const loaded = await loadIncluded();
        if (destroyed || !body.isConnected) return;
        summary.textContent = `Included example results (${loaded.profiles.length})`;
        body.replaceChildren(el('p', 'registry-small', 'These are the unchanged example records used by the planner. Their limits still apply.'));
        if (!loaded.profiles.length) body.append(el('p', 'registry-empty', 'No included records were returned.'));
        const list = el('div', 'registry-record-list'); loaded.profiles.forEach(profile => list.append(includedCard(profile, loaded.cases))); body.append(list);
      } catch (error) {
        if (destroyed || !body.isConnected) return;
        body.replaceChildren(el('p', 'registry-small', errorText(error)), button('Try again', show));
      } finally { body.removeAttribute('aria-busy'); }
    };
    details.addEventListener('toggle', () => { if (details.open && !body.childNodes.length) show(); });
    return details;
  }

  function render() {
    content.replaceChildren();
    const header = el('header', 'registry-header');
    header.append(el('span', 'registry-kicker', 'Your workspace'));
    const title = el('h2', '', 'Robots & results'); title.id = 'registry-title'; title.tabIndex = -1;
    header.append(title, el('p', '', 'Keep a record of your robots, tests and finished jobs.'));
    content.append(header);
    const scope = el('div', 'registry-scope');
    scope.append(el('strong', '', 'Saved in this browser only'), el('span', '', 'New entries are not used in job plans.'));
    content.append(scope);
    content.append(admissionPanel());
    const tabs = el('div', 'registry-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Manage records');
    tabButtons = {}; panels = {};
    TABS.forEach(([name, label], index) => {
      const tab = button(label, () => switchTab(name), 'registry-tab');
      tab.id = `registry-tab-${name}`; tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', `registry-panel-${name}`);
      tab.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        const step = event.key === 'ArrowLeft' ? TABS.length - 1 : 1;
        event.preventDefault(); switchTab(event.key === 'Home' ? TABS[0][0] : event.key === 'End' ? TABS[TABS.length - 1][0] : TABS[(index + step) % TABS.length][0], true);
      });
      tabs.append(tab); tabButtons[name] = tab;
    });
    content.append(tabs);
    errorNode = el('div', 'registry-alert'); errorNode.setAttribute('role', 'alert'); errorNode.tabIndex = -1; errorNode.hidden = true; content.append(errorNode);
    messageNode = el('p', 'registry-message'); messageNode.setAttribute('role', 'status'); messageNode.setAttribute('aria-live', 'polite'); messageNode.tabIndex = -1; content.append(messageNode);
    const toolbar = el('div', 'registry-toolbar');
    const archivedLabel = el('label', 'registry-check'); const archivedInput = document.createElement('input'); archivedInput.type = 'checkbox'; archivedInput.checked = showArchived;
    archivedInput.addEventListener('change', () => { showArchived = archivedInput.checked; render(); });
    archivedLabel.append(archivedInput, el('span', '', 'Show archived')); toolbar.append(archivedLabel);
    const copies = el('div', 'registry-card-actions'); backupButton = copies;
    const readable = planPdfButton(() => notebookReport(store.load(), BUILTIN_ROBOTS), 'robot-results-' + today() + '.pdf', {label: 'Download notebook PDF', className: 'registry-button'}); readable.disabled = Boolean(storeError);
    const backup = disclosure('Data backup (JSON)');
    const backupCopy = button('Download data backup', exportBackup); backupCopy.disabled = Boolean(storeError);
    backup.append(el('p', 'registry-small', 'All saved robots, results and their reviews as data. Use the PDF for a readable copy. Job reviews have a separate download on their tab.'), backupCopy);
    copies.append(readable, backup); toolbar.append(copies); content.append(toolbar);
    TABS.forEach(([name]) => {
      const panel = el('section', 'registry-panel'); panel.id = `registry-panel-${name}`; panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', `registry-tab-${name}`);
      panels[name] = panel; content.append(panel);
    });
    const robots = panels.robots;
    robots.append(el('h3', 'registry-section-title', 'Built-in robots'));
    const builtinGrid = el('div', 'registry-robot-grid'); BUILTIN_ROBOTS.forEach(robot => builtinGrid.append(robotCard(robot, true))); robots.append(builtinGrid);
    robots.append(el('h3', 'registry-section-title', 'Your robots'));
    const addRobot = disclosure('+ Add a robot', 'registry-add'); if (!storeError) addRobot.append(robotForm()); else addRobot.append(el('p', 'registry-form-note', 'Saving is unavailable until the storage problem is resolved.')); robots.append(addRobot);
    const custom = data.robots.filter(robot => showArchived || !robot.archivedAt);
    if (!custom.length) robots.append(el('p', 'registry-empty', 'No added robots yet. You can still record tests for the three built-in robots.'));
    const customList = el('div', 'registry-record-list'); custom.forEach(robot => customList.append(robotCard(robot))); robots.append(customList);
    const results = panels.results;
    results.append(includedResults());
    addResultDetails = disclosure('+ Add a test result', 'registry-add');
    if (!storeError) addResultDetails.append(resultForm()); else addResultDetails.append(el('p', 'registry-form-note', 'Saving is unavailable until the storage problem is resolved.'));
    results.append(addResultDetails);
    const saved = data.results.filter(result => showArchived || !result.archivedAt).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (!saved.length) results.append(el('p', 'registry-empty', 'No local results yet. Save a test and its evidence first, then record who reviewed it.'));
    const resultList = el('div', 'registry-record-list'); saved.forEach(result => resultList.append(resultCard(result))); results.append(resultList);
    results.append(el('p', 'registry-small registry-bottom-note', 'The planner’s built-in example records stay unchanged. Saving or reviewing a result does not add it to plans.'));
    renderJobReviews(panels.reviews, { el, button, pill, field, formActions, disclosure, today, store: reviewStore, reviews, planned: plannedJobs, showArchived, error: reviewError, mutate: mutateReviews, download, openAdd: openReviewForm, openCheckFor, reloadedId });
    switchTab(activeTab);
    if (storeError) { errorNode.textContent = errorText(storeError); errorNode.hidden = false; }
  }

  function admissionPanel() {
    const local = data.results.filter(result => !result.archivedAt);
    const reviewed = local.filter(result => result.review).length, waiting = local.length - reviewed;
    const panel = el('section', 'registry-admission'); panel.id = 'registry-admission'; panel.tabIndex = -1; panel.setAttribute('aria-label', 'How a result gets into planning');
    panel.append(el('h3', 'registry-section-title', 'How does a new result get into planning?'));
    const steps = el('ol', 'registry-ladder');
    [['1', 'Saved here', waiting + ' waiting for review', 'A note in this browser. Typing “Passed” does not make it evidence.'],
     ['2', 'Reviewed here', reviewed + ' reviewed', 'The typed name records who says they reviewed it. The app does not verify the review.'],
     ['3', 'Admitted to the planner', '0 of your entries', 'Not possible in this app. It needs evidence the research team has reviewed, and a reviewed update to the planner itself.']].forEach(([number, name, count, text]) => {
      const item = el('li'); const mark = el('span', 'registry-ladder-number', number); mark.setAttribute('aria-hidden', 'true');
      const words = el('div'); words.append(el('strong', '', name), el('span', 'registry-ladder-count', count), el('p', 'registry-small', text));
      item.append(mark, words); steps.append(item);
    });
    panel.append(steps);
    const example = button('Add an invented example result', () => {
      const added = mutate(() => store.addResult({robotId: 'G1', task: 'EXAMPLE (invented): wall wipe at a new height', context: 'Invented example. No such test was run.', location: 'Nowhere: example only', date: today(), outcome: 'PASS', evidence: 'EXAMPLE-ONLY. There is no evidence behind this entry.', notes: 'Added by the example button to show that a typed “Passed” is not used in plans. Safe to archive.'}), 'Example saved as “Passed”. It is waiting for review and is still not used in plans.');
      if (added) { switchTab('results'); content.querySelector('#registry-admission')?.focus(); }
    });
    example.disabled = Boolean(storeError);
    panel.append(example, el('p', 'registry-small', 'Try it: the example is saved as “Passed”, you can record a review, and the job plans do not change.'));
    return panel;
  }

  function refresh() {
    if (destroyed) return;
    try { if (!store) store = createStore(window.localStorage); data = store.load(); storeError = null; }
    catch (error) { storeError = error; }
    loadReviews();
    render();
  }
  function open(event, fromPlan = false) {
    event?.preventDefault(); if (destroyed) return;
    // Jobs offered from a plan belong to that visit only. Any other way in starts without them.
    if (!fromPlan) { plannedJobs = null; openReviewForm = false; }
    openCheckFor = null; reloadedId = null;
    opener = document.activeElement; refresh();
    if (!dialog.open) dialog.showModal();
    content.querySelector('#registry-title')?.focus();
  }
  function openFromEvent(event) {
    const detail = event?.detail;
    if (detail && typeof detail === 'object' && detail.tab === 'reviews') {
      // Opened from a plan: offer that plan's jobs so the review is tied to the job, place and planned method.
      // Each offered job is a complete copy of its planned job. The store checks every field again when a note is saved.
      plannedJobs = Array.isArray(detail.jobs) ? detail.jobs.filter(job => job && typeof job === 'object' && /^[0-9a-f]{64}$/.test(job.digest) && typeof job.taskId === 'string' && typeof job.jobLabel === 'string' && typeof job.buildingName === 'string').slice(0, 12) : null;
      activeTab = 'reviews'; openReviewForm = true;
      open(undefined, true);
      content.querySelector('#registry-jobreview-add select, #registry-jobreview-add input')?.focus();
      return;
    }
    open();
    if (event?.detail === 'admission') { switchTab('results'); content.querySelector('#registry-admission')?.focus(); content.querySelector('#registry-admission')?.scrollIntoView({ block: 'start' }); }
  }
  function close() { if (dialog.open) dialog.close(); }
  const onClose = () => { if (opener?.isConnected) opener.focus(); };
  closeButton?.addEventListener('click', close); launcher?.addEventListener('click', open); dialog.addEventListener('close', onClose);
  document.addEventListener('fieldwork:open-registry', openFromEvent); window.addEventListener('storage', onStorage);
  render();
  return {
    open, close, refresh,
    destroy() {
      destroyed = true; includedController?.abort(); close(); document.removeEventListener('fieldwork:open-registry', openFromEvent); window.removeEventListener('storage', onStorage); closeButton?.removeEventListener('click', close); launcher?.removeEventListener('click', open); dialog.removeEventListener('close', onClose); content.replaceChildren();
    }
  };
}
