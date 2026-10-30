// Wizard labels follow the rendered sidebar, including the runtime Always on step and hidden or added entries.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {wizardFixture} from './setup-step-fixture.js';

function assertLabels(view) {
  view.goStep('draft');
  const items = view.list.children.filter(item => !item.hidden && item.style.display !== 'none' && item.style.visibility !== 'hidden');
  for (const [index, item] of items.entries()) {
    const page = view.document.querySelector(`.step[data-step="${item.dataset.step}"]`);
    if (['welcome', 'letter'].includes(item.dataset.step)) continue;
    const eyebrows = page.querySelectorAll('[data-step-count]');
    assert.ok(eyebrows.length, `${item.dataset.step}: a numbered eyebrow`);
    for (const eyebrow of eyebrows) assert.match(eyebrow.textContent, new RegExp(`^Step ${index + 1} of ${items.length}(?:$| · )`), item.dataset.step);
  }
  const strategyNumber = items.findIndex(item => item.dataset.step === 'draft') + 1;
  for (const node of view.document.querySelectorAll('[data-step-reference="draft"]')) assert.equal(node.textContent, `step ${strategyNumber}`);
}

test('every numbered wizard eyebrow matches its sidebar position after Always on mounts', () => {
  const view = wizardFixture();
  assert.equal(view.list.children.length, 7);
  view.goStep('draft');
  assert.equal(view.document.querySelector('.step[data-step="draft"] .eyebrow').textContent, 'Step 4 of 7');
  assertLabels(view);
  assert.equal(view.document.querySelector('.step[data-step="extras"] .eyebrow').textContent, 'Step 7 of 7 · optional');
  assert.equal(view.document.querySelectorAll('[data-step-reference="draft"]').length, 2, 'banner and Welcome share the strategy reference');
});

test('hidden and added sidebar entries renumber every page and both strategy references', () => {
  const view = wizardFixture();
  view.list.querySelector('[data-step="ai"]').hidden = true;
  view.list.querySelector('[data-step="letter"]').style.display = 'none';
  assertLabels(view);
  const item = view.document.createElement('li'); item.dataset.step = 'new'; view.list.insertBefore(item, view.list.children[0]);
  const page = view.document.createElement('div'); page.className = 'step'; page.dataset.step = 'new';
  const eyebrow = view.document.createElement('span'); eyebrow.className = 'eyebrow'; eyebrow.dataset.stepCount = ''; page.append(eyebrow); view.document.body.append(page);
  assertLabels(view);
});

test('the pure numbering function uses only the supplied sidebar order', () => {
  const {labels} = wizardFixture();
  const steps = Object.freeze(['extras', 'draft']);
  assert.equal(JSON.stringify(labels(steps)), JSON.stringify([
    {key: 'extras', eyebrow: 'Step 1 of 2', reference: 'step 1'},
    {key: 'draft', eyebrow: 'Step 2 of 2', reference: 'step 2'},
  ]));
});

test('Welcome keeps its original first-run and completion wording; Cover letter has no eyebrow', () => {
  const view = wizardFixture();
  view.goStep('draft');
  assert.deepEqual(view.document.querySelector('.step[data-step="welcome"]').querySelectorAll('.eyebrow').map(node => node.textContent),
    ['Check-in · about 5 minutes', 'Setup complete']);
  assert.equal(view.document.querySelector('.step[data-step="letter"]').querySelectorAll('.eyebrow').length, 0);
});
