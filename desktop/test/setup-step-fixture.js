// Shared mounted wizard fixture: real navigation, strategy save and finish, with fictional IPC and no browser or real data.
import fs from 'node:fs';
import vm from 'node:vm';
import {install} from './tiny-dom.js';
install();
const {el} = await import('../renderer/components.js');

const read = file => fs.readFileSync(new URL(`../renderer/${file}`, import.meta.url), 'utf8');
const script = file => read(file).replace(/^import .*;\n/gm, '').replace(/^export \{.*\};.*\n/gm, '').replace(/^export /gm, '');
const html = read('index.html');
const keys = [...html.matchAll(/<li data-step="([a-z]+)"[^>]*>([^<]+)/g)];
const blocks = [...html.matchAll(/<div class="step" data-step="([a-z]+)"[^>]*>([\s\S]*?)(?=\n    <div class="step" data-step=|\n  <\/div>\n)/g)];

/** Mount the real wizard order and handlers; no hosted or letter step is mounted. */
export function wizardFixture() {
  install();
  const {document, window} = globalThis;
  // tiny-dom appends without moving; this fixture needs the browser's move semantics for the shared finish footer.
  const create = document.createElement;
  document.createElement = tag => {
    const node = create(tag), append = node.append.bind(node);
    node.append = (...nodes) => { for (const child of nodes) if (child?.parentNode) child.remove(); append(...nodes); };
    return node;
  };
  const wizardRoot = el('section'); wizardRoot.id = 'wizard';
  const list = el('ol'); list.id = 'step-list';
  const body = el('div', 'step-body'); wizardRoot.append(list, body); document.body.append(wizardRoot);
  for (const [, key, label] of keys) { const item = el('li', '', label); item.dataset.step = key; list.append(item); }
  for (const [, key, content] of blocks) {
    const page = el('div', 'step'); page.dataset.step = key; body.append(page);
    for (const [, attrs, text] of content.matchAll(/<span([^>]*class="eyebrow"[^>]*)>([^<]*)<\/span>/g)) {
      const label = el('span', 'eyebrow', text);
      if (attrs.includes('data-step-count')) label.dataset.stepCount = '';
      const suffix = attrs.match(/data-step-suffix="([^"]*)"/);
      if (suffix) label.dataset.stepSuffix = suffix[1];
      page.append(label);
    }
  }
  for (const [, , text] of html.matchAll(/<span([^>]*data-step-reference="draft"[^>]*)>([^<]*)<\/span>/g)) {
    const reference = el('span', '', text); reference.dataset.stepReference = 'draft'; body.append(reference);
  }
  for (const [, id] of html.matchAll(/ id="([^"]+)"/g)) if (!document.getElementById(id)) document.body.append(Object.assign(el('div'), {id}));
  const $ = id => document.getElementById(id);
  $('setup-finish').className = 'actions sticky'; $('setup-finish').hidden = true;
  $('setup-finish').append($('finish')); body.append($('setup-finish'));
  $('draft-actions').className = 'actions'; document.querySelector('.step[data-step="draft"]').append($('draft-actions'));
  for (const [, key] of html.matchAll(/data-save-step="([^"]+)"/g)) { const li = el('li'); li.dataset.saveStep = key; document.body.append(li); }
  $('save-dialog').showModal = () => { $('save-dialog').open = true; };
  $('save-dialog').close = () => { $('save-dialog').open = false; };
  const settings = {}, opened = [], state = {settings, secrets: {}};
  window.pilot = {saveSettings: async patch => Object.assign(settings, patch), saveStrategy: async () => ({ok: true}), state: async () => state};
  const context = {document, window, el, $, show: (node, on = true) => { node.hidden = !on; },
    shared: {state, draft: {}}, STEPS: [...read('pages/core.js').match(/STEPS = \[([^\]]*)\]/)[1].matchAll(/'([a-z]+)'/g)].map(m => m[1]),
    hideCards() {}, refreshCv() {}, mountEngine: () => ({picked: () => null, status: () => null}), canContinue: () => false, setTimeout: fn => fn(), saveState: {},
    message() {}, byStore: (_, local) => local, osText: text => text, loadJobs() {}, openView: name => opened.push(name),
    getComputedStyle: node => ({display: node.style.display || 'list-item', visibility: node.style.visibility || 'visible'})};
  const wizard = vm.runInNewContext(`${script('pages/wizard.js')}\n({goStep, showSetupFinish, labels: setupStepLabels})`, context);
  const review = vm.runInNewContext(`${script('pages/strategy-review.js')}\n({saveDraft, init})`, {...context, ...wizard,
    buildDraft() {}, currentAnswers: () => ({anything_else: ''}), toDraft() {}, titleCase: text => text});
  review.init();
  const click = async id => { for (const listener of $(id).listeners.click || []) await listener({}); };
  return {document, list, settings, opened, click, saveDraft: review.saveDraft, ...wizard};
}
