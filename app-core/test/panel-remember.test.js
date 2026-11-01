// The panel's Remember switch for what you typed (extension/panel-learn.js): on by default, off where the app's verdict says the question is one employer's,
// the person's own switch wins, and Submit sends each answer with it. A tiny fake DOM: the panel is a content script with no imports.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const SOURCE = fs.readFileSync(new URL('../../extension/panel-learn.js', import.meta.url), 'utf8');
const element = tag => ({tag, children: [], listeners: {}, hidden: false, append(...nodes) { this.children.push(...nodes); }, replaceChildren(...nodes) { this.children = nodes; },
  addEventListener(type, fn) { this.listeners[type] = fn; }});

function setup(defaultsReply) {
  const listeners = {}, sent = [];
  const document = {addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); }, createElement: element, querySelectorAll: () => [], querySelector: () => null, title: '', documentElement: {dataset: {}}, body: {}};
  const window = {};
  new Function('window', 'document', 'location', 'Element', SOURCE)(window, document, {href: 'https://acme.test/apply'}, class {});
  const box = element('div'), list = element('div');
  const send = async message => { sent.push(message); return message.type === 'rememberDefaults' ? defaultsReply : {ok: true}; };
  const field = (label, value) => ({isConnected: true, disabled: false, type: 'text', tagName: 'INPUT', value, labels: [], matches: () => true, _label: label});
  const learn = window.__jobPilottoPanelLearn.start({send, alive: () => true, mine: {box, list},
    form: {fields: () => [], question: el => el._label, visible: () => true, clean: text => String(text).trim()}});
  const type = el => (listeners.input || []).forEach(fn => fn({isTrusted: true, target: el}));
  return {learn, box, list, sent, field, type, listeners};
}

test('typed answers are listed with Remember on; the app\'s one-employer verdict starts it off; the person\'s switch wins; Submit sends it', async () => {
  const {learn, box, list, sent, field, type, listeners} = setup({remember: {'Notice period': true, 'Why Northwind?': false}});
  type(field('Notice period', '1 month')); type(field('Why Northwind?', 'The mission'));
  learn.showMine();
  await new Promise(resolve => setTimeout(resolve, 0));
  const asked = sent.find(message => message.type === 'rememberDefaults');
  assert.deepEqual(asked.labels, ['Notice period', 'Why Northwind?'], 'the app is asked once per question');
  learn.showMine();
  const switches = () => list.children.map(row => row.children[1].children[0]);
  assert.equal(box.hidden, false);
  assert.deepEqual(switches().map(input => input.checked), [true, false]);
  switches()[0].listeners.change.call(null); // unchanged value: no throw
  const first = switches()[0]; first.checked = false; first.listeners.change();
  learn.showMine();
  assert.deepEqual(switches().map(input => input.checked), [false, false], 'the person\'s own choice is kept across redraws');
  listeners.submit.forEach(fn => fn({isTrusted: true}));
  const learned = sent.find(message => message.type === 'learned');
  assert.deepEqual(learned.items.map(item => [item.label, item.remember]), [['Notice period', false], ['Why Northwind?', false]]);
});

test('a question the app has not judged stays on', () => {
  const {learn, list, field, type} = setup({});
  type(field('Driving licence', 'B'));
  learn.showMine();
  assert.equal(list.children[0].children[1].children[0].checked, true);
});
