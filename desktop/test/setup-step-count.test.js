// Wizard labels follow the rendered sidebar, including hidden or added entries.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {wizardFixture} from './setup-step-fixture.js';

function assertLabels(view) {
  view.goStep('draft');
  const items = view.list.children.filter(item => !item.hidden && item.style.display !== 'none' && item.style.visibility !== 'hidden');
  for (const [index, item] of items.entries()) {
    const page = view.document.querySelector(`.step[data-step="${item.dataset.step}"]`);
    if (['welcome'].includes(item.dataset.step)) continue;
    const eyebrows = page.querySelectorAll('[data-step-count]');
    assert.ok(eyebrows.length, `${item.dataset.step}: a numbered eyebrow`);
    for (const eyebrow of eyebrows) assert.match(eyebrow.textContent, new RegExp(`^Step ${index + 1} of ${items.length}(?:$| · )`), item.dataset.step);
  }
  const strategyNumber = items.findIndex(item => item.dataset.step === 'draft') + 1;
  for (const node of view.document.querySelectorAll('[data-step-reference="draft"]')) assert.equal(node.textContent, `step ${strategyNumber}`);
}

test('every numbered wizard eyebrow matches its sidebar position with exactly four setup steps', () => {
  const view = wizardFixture();
  assert.equal(view.list.children.length, 4);
  view.goStep('draft');
  assert.equal(view.document.querySelector('.step[data-step="draft"] .eyebrow').textContent, 'Step 4 of 4');
  assertLabels(view);
  assert.equal(view.document.querySelectorAll('[data-step-reference="draft"]').length, 2, 'banner and Welcome share the strategy reference');
});

test('hidden and added sidebar entries renumber every page and both strategy references', () => {
  const view = wizardFixture();
  view.list.querySelector('[data-step="ai"]').hidden = true;
  view.list.querySelector('[data-step="cv"]').style.display = 'none';
  assertLabels(view);
  const item = view.document.createElement('li'); item.dataset.step = 'new'; view.list.insertBefore(item, view.list.children[0]);
  const page = view.document.createElement('div'); page.className = 'step'; page.dataset.step = 'new';
  const eyebrow = view.document.createElement('span'); eyebrow.className = 'eyebrow'; eyebrow.dataset.stepCount = ''; page.append(eyebrow); view.document.body.append(page);
  assertLabels(view);
});

test('the pure numbering function uses only the supplied sidebar order', () => {
  const {labels} = wizardFixture();
  const steps = Object.freeze(['cv', 'draft']);
  assert.equal(JSON.stringify(labels(steps)), JSON.stringify([
    {key: 'cv', eyebrow: 'Step 1 of 2', reference: 'step 1'},
    {key: 'draft', eyebrow: 'Step 2 of 2', reference: 'step 2'},
  ]));
});

test('Welcome keeps its original first-run and completion wording', () => {
  const view = wizardFixture();
  view.goStep('draft');
  assert.deepEqual(view.document.querySelector('.step[data-step="welcome"]').querySelectorAll('.eyebrow').map(node => node.textContent),
    ['Check-in · about 5 minutes', 'Setup complete']);
});

// A setup must end after strategy, with the one finish action saving setupDone and opening Jobs.
test('the simplified wizard loops through exactly four visible steps and finishes after strategy', async () => {
  const view = wizardFixture();
  const wanted = ['welcome', 'ai', 'cv', 'draft'];
  assert.deepEqual(view.list.children.filter(item => !item.hidden).map(item => item.dataset.step), wanted);
  assert.deepEqual(view.list.children.filter(item => !item.hidden).map(item => item.textContent),
    ['Welcome', 'AI', 'Your CV', 'Your strategy']);
  for (const key of wanted) {
    view.goStep(key);
    assert.equal(view.document.querySelector(`.step[data-step="${key}"]`).hidden, false);
  }
  await view.saveDraft();
  const finish = view.document.getElementById('finish');
  assert.equal(finish.closest('.step').dataset.step, 'draft');
  assert.equal(finish.closest('.step').hidden, false);
  assert.equal(finish.parentNode.hidden, false);
  assert.equal(view.settings.setupDone, true, 'the real saveStrategy IPC persists setupDone');
  assert.deepEqual(view.opened, [], 'the finish button still owns opening Jobs');
  await view.click('finish');
  assert.equal(view.settings.setupDone, true);
  assert.equal(view.document.getElementById('wizard').hidden, true);
  assert.equal(view.document.getElementById('app').hidden, false);
  assert.deepEqual(view.opened, ['jobs']);
});


test('returning to a saved first-setup strategy keeps finish without repeating the save', async () => {
  const view = wizardFixture();
  view.goStep('draft');
  await view.saveDraft();
  assert.equal(view.saves.length, 1);
  view.goStep('cv');
  await view.toDraft();
  assert.equal(view.document.getElementById('setup-finish').hidden, false);
  assert.equal(view.document.getElementById('draft-actions').hidden, true);
  assert.equal(view.saves.length, 1, 'navigation never saves or reads CV details again');
  await view.click('finish');
  assert.deepEqual(view.opened, ['jobs']);
});


test('editing a saved setup draft restores Save and hides finish until another save', async () => {
  const view = wizardFixture();
  view.goStep('draft');
  await view.saveDraft();
  view.draftChanged(['profile_markdown']);
  assert.equal(view.document.getElementById('setup-finish').hidden, true);
  assert.equal(view.document.getElementById('draft-actions').hidden, false);
  assert.equal(view.saves.length, 1);
});
