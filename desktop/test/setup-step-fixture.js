// Shared mounted wizard fixture for sidebar numbering tests, without a browser, IPC calls or real data.
import fs from 'node:fs';
import vm from 'node:vm';
import {install} from './tiny-dom.js';
install();
const {el} = await import('../renderer/components.js');
const {emailField} = await import('../renderer/hosted-step-parts.js');

const read = file => fs.readFileSync(new URL(`../renderer/${file}`, import.meta.url), 'utf8');
const script = file => read(file).replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
const html = read('index.html');
const keys = [...html.matchAll(/<li data-step="([a-z]+)"/g)].map(match => match[1]);
const blocks = [...html.matchAll(/<div class="step" data-step="([a-z]+)"[^>]*>([\s\S]*?)(?=\n    <div class="step" data-step=|\n  <\/div>\n)/g)];

/** Mount the real wizard sidebar, runtime Always on step and navigation against a tiny DOM. */
export function wizardFixture() {
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
  const {mountStep} = vm.runInNewContext(`${script('pages/hosted.js')}\n({mountStep})`, {...context, alwaysOnCard: () => el('div'), emailField, NEWS: '', NEWS_HINT: '', STORED: ''});
  mountStep();
  const wizard = vm.runInNewContext(`${script('pages/wizard.js')}\n({goStep, labels: typeof setupStepLabels === 'function' ? setupStepLabels : null})`, context);
  return {document, list, ...wizard};
}

