// Wizard labels follow the rendered sidebar, including the runtime Always on step and hidden or added entries.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import {install} from './tiny-dom.js';
install();
const {el} = await import('../renderer/components.js');

const read = file => fs.readFileSync(new URL(`../renderer/${file}`, import.meta.url), 'utf8');
const script = file => read(file).replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
const html = read('index.html');
const keys = [...html.matchAll(/<li data-step="([a-z]+)"/g)].map(match => match[1]);
const blocks = [...html.matchAll(/<div class="step" data-step="([a-z]+)"[^>]*>([\s\S]*?)(?=\n    <div class="step" data-step=|\n  <\/div>\n)/g)];

function fixture() {
  install();
  const {document, window} = globalThis;
  const list = el('ol'); list.id = 'step-list'; document.body.append(list);
  for (const key of keys) { const item = el('li'); item.dataset.step = key; list.append(item); }
  for (const [, key, body] of blocks) {
    const page = el('div', 'step'); page.dataset.step = key; document.body.append(page);
    for (const [, attrs, text] of body.matchAll(/<span([^>]*class="eyebrow"[^>]*)>([^<]*)<\/span>/g)) {
      const label = el('span', 'eyebrow', text);
      if (attrs.includes('data-step-count')) label.dataset.stepCount = '';
      const suffix = attrs.match(/data-step-suffix="([^"]*)"/);
      if (suffix) label.dataset.stepSuffix = suffix[1];
      page.append(label);
    }
  }
  for (const [, , text] of html.matchAll(/<span([^>]*data-step-reference="draft"[^>]*)>([^<]*)<\/span>/g)) {
    const reference = el('span', '', text); reference.dataset.stepReference = 'draft'; document.body.append(reference);
  }
  for (const id of ['wizard-exit', 'review-mode', 'draft-save']) document.body.append(Object.assign(el('div'), {id}));
  // tiny-dom's insertBefore is the same operation used by before() in the mounted Always on step.
  for (const node of [list.querySelector('[data-step="extras"]'), document.querySelector('.step[data-step="extras"]')]) node.before = other => node.parentNode.insertBefore(other, node);
  window.pilot = {saveSettings() {}};
  const context = {document, window, el, $, show: (node, on = true) => { node.hidden = !on; },
    shared: {state: {settings: {setupDone: true}, secrets: {}}}, STEPS: [...keys.slice(0, -1), 'hosted', 'extras'],
    hideLetterStep() {}, showLetterStep() {}, hideCards() {},
    getComputedStyle: node => ({display: node.style.display || 'list-item', visibility: node.style.visibility || 'visible'})};
  function $(id) { return document.getElementById(id); }
  const {mountStep} = vm.runInNewContext(`${script('pages/hosted.js')}\n({mountStep})`, {...context, alwaysOnCard: () => el('div'), HELPER: '', NEWS: '', NEWS_HINT: '', STORED: ''});
  mountStep();
  const wizard = vm.runInNewContext(`${script('pages/wizard.js')}\n({goStep, labels: typeof setupStepLabels === 'function' ? setupStepLabels : null})`, context);
  return {document, list, ...wizard};
}

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
  const view = fixture();
  assert.equal(view.list.children.length, 7);
  view.goStep('draft');
  assert.equal(view.document.querySelector('.step[data-step="draft"] .eyebrow').textContent, 'Step 4 of 7');
  assertLabels(view);
  assert.equal(view.document.querySelector('.step[data-step="extras"] .eyebrow').textContent, 'Step 7 of 7 · optional');
  assert.equal(view.document.querySelectorAll('[data-step-reference="draft"]').length, 2, 'banner and Welcome share the strategy reference');
});

test('hidden and added sidebar entries renumber every page and both strategy references', () => {
  const view = fixture();
  view.list.querySelector('[data-step="ai"]').hidden = true;
  view.list.querySelector('[data-step="letter"]').style.display = 'none';
  assertLabels(view);
  const item = el('li'); item.dataset.step = 'new'; view.list.insertBefore(item, view.list.children[0]);
  const page = el('div', 'step'); page.dataset.step = 'new';
  const eyebrow = el('span', 'eyebrow'); eyebrow.dataset.stepCount = ''; page.append(eyebrow); view.document.body.append(page);
  assertLabels(view);
});

test('the pure numbering function uses only the supplied sidebar order', () => {
  const {labels} = fixture();
  const steps = Object.freeze(['extras', 'draft']);
  assert.equal(JSON.stringify(labels(steps)), JSON.stringify([
    {key: 'extras', eyebrow: 'Step 1 of 2', reference: 'step 1'},
    {key: 'draft', eyebrow: 'Step 2 of 2', reference: 'step 2'},
  ]));
});

test('Welcome keeps its original first-run and completion wording; Cover letter has no eyebrow', () => {
  const view = fixture();
  view.goStep('draft');
  assert.deepEqual(view.document.querySelector('.step[data-step="welcome"]').querySelectorAll('.eyebrow').map(node => node.textContent),
    ['Check-in · about 5 minutes', 'Setup complete']);
  assert.equal(view.document.querySelector('.step[data-step="letter"]').querySelectorAll('.eyebrow').length, 0);
});
