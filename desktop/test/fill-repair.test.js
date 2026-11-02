// The fill ladder's repair question (lib/ladder/fill-repair.js) and the value class it and the fill check read (amendment 3): the model sees numbered controls, the kind of value the fill
// has for each (never the value), a menu's numbered options and the layer on top's numbered buttons; it names a closed widget and verb per control that needs repair; the code keeps only
// those controls, at most 3, and the floors: a legal question or a password is the person's, an option must be one the control or the layer lists. The value class list is one list
// on both ends (extension/page/value-class.js).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import {askRepair, CAP, digestText, INSTRUCTIONS, missesOf, validRepairs, VERBS, WIDGETS} from '../lib/ladder/fill-repair.js';
import {judgeFill, REASONS} from '../lib/ladder/fill-verify.js';
import {VALUE_CLASSES} from '../lib/ladder/value-class.js';
import {accountSketch} from '../lib/account-judge.js';

const raw = {url: 'https://jobs.example.com/apply/1', title: 'Apply', controls: [
  {type: 'text', label: 'First name', required: true, state: 'filled', match: 'yes', answer: 'free_text'},
  {type: 'select-one', label: 'Country', required: true, state: 'empty', match: 'no', answer: 'dial_code', options: ['Select…', 'Germany (+49)', 'Switzerland (+41)'], tried: 2},
  {type: 'checkbox', label: 'I accept the terms', required: true, state: 'unchecked', match: 'no', legal: true},
  {type: 'password', label: 'Password', required: true, state: 'empty', match: 'no'},
  {type: 'text', label: 'Middle name', required: false, state: 'empty', match: ''},
  {type: 'text', label: 'City', required: true, state: 'empty', match: 'no', answer: 'free_text'}],
  buttons: ['Submit application'], texts: [], frames: [], onTop: {shape: 'dialog', role: 'dialog', text: 'Get our newsletter', buttons: ['Subscribe', 'No thanks', '×']}};
const client = answer => {
  const sent = [];
  return {sent, messages: {create: async body => { sent.push(body); return {stop_reason: 'end_turn', content: [{type: 'text', text: JSON.stringify(answer)}]}; }}};
};

test('one value class list on both ends; the sketch keeps a known class only, a legal mark and a try count, never a value', () => {
  const window = {};
  vm.runInNewContext(fs.readFileSync(new URL('../../extension/page/value-class.js', import.meta.url), 'utf8'), {window, document: {documentElement: {lang: 'en'}}, Intl});
  assert.deepEqual([...window.__jobadabraValueClass.CLASSES], VALUE_CLASSES, 'extension/page/value-class.js and lib/ladder/value-class.js name the same classes');
  const sketch = accountSketch({...raw, controls: [...raw.controls, {type: 'text', label: 'x', answer: 'ssn', legal: 'yes', tried: 99, value: 'secret'}]});
  assert.deepEqual(sketch.controls.map(item => item.answer), ['free_text', 'dial_code', '', '', '', 'free_text', '']);
  assert.deepEqual(sketch.controls.map(item => item.legal), [false, false, true, false, false, false, false]);
  assert.equal(sketch.controls[1].tried, 2);
  assert.equal(sketch.controls[6].tried, 20, 'tries capped');
  assert.ok(!JSON.stringify(sketch).includes('secret'));
});

test('the fill check sees the kind of value and a menu\'s options, and may say wrong_class', async () => {
  assert.ok(REASONS.includes('wrong_class'));
  const fake = client({controls: [{n: 2, verdict: 'wrong', reason: 'wrong_class'}]});
  const found = await judgeFill(fake, raw);
  assert.match(fake.sent[0].messages[0].content, /\[2\] select-one · Country · required · empty · match no · answer dial_code · options: Select… \| Germany \(\+49\) \| Switzerland \(\+41\)/);
  assert.deepEqual(found.verdicts.map(row => [row.n, row.verdict, row.reason]), [[2, 'wrong', 'wrong_class']]);
});

test('the controls that need repair: a miss on a control the fill touched; without verdicts every match no', () => {
  const sketch = accountSketch(raw);
  const verdicts = [{n: 1, verdict: 'ok'}, {n: 2, verdict: 'wrong', reason: 'wrong_class'}, {n: 5, verdict: 'empty', reason: 'not_kept'}, {n: 6, verdict: 'unreachable', reason: 'covered'}];
  assert.deepEqual(missesOf(sketch, verdicts), [{n: 2, verdict: 'wrong', reason: 'wrong_class'}, {n: 6, verdict: 'unreachable', reason: 'covered'}], 'Middle name: the fill had no answer, never a repair');
  assert.deepEqual(missesOf(sketch, []).map(miss => miss.n), [2, 3, 4, 6]);
});

test('the digest numbers each menu\'s options and the layer\'s buttons, says the tries and the legal mark, and lists what needs repair', () => {
  const sketch = accountSketch(raw), text = digestText(sketch, missesOf(sketch, []));
  assert.match(text, /\[2\] select-one · Country · required · empty · match no · answer dial_code · options: 1 Select… \| 2 Germany \(\+49\) \| 3 Switzerland \(\+41\) · tried 2/);
  assert.match(text, /\[3\] checkbox · I accept the terms · required · unchecked · match no · legal/);
  assert.match(text, /ON TOP of the form: dialog \(dialog\): Get our newsletter; its buttons: 1 Subscribe \| 2 No thanks \| 3 ×/);
  assert.match(text, /Needs repair:\n\[2\] empty \(not_kept\)\n\[3\]/);
  assert.match(INSTRUCTIONS, /never WHAT/);
});

test('floors: a legal question or a password is the person\'s; an option must be listed; only controls that need repair, the first answer each, at most 3', () => {
  const sketch = accountSketch(raw), misses = missesOf(sketch, []);
  const rows = validRepairs({repairs: [
    {n: 2, widget: 'native_select', verb: 'choose_option', option: 3},
    {n: 2, widget: 'native_select', verb: 'retype', option: 0},
    {n: 3, widget: 'checkbox_group', verb: 'toggle', option: 0},
    {n: 4, widget: 'text', verb: 'retype', option: 0},
    {n: 5, widget: 'text', verb: 'retype', option: 0},
    {n: 6, widget: 'text', verb: 'dismiss_layer', option: 2}]}, sketch, misses);
  assert.deepEqual(rows.map(row => [row.n, row.verb, row.option, row.refused]), [
    [2, 'choose_option', 3, ''], [3, 'ask_person', 0, 'floor: legal or password'], [4, 'ask_person', 0, 'floor: legal or password']], 'cap 3: City is not reached; Middle name never (no miss)');
  assert.equal(CAP, 3);
  const more = validRepairs({repairs: [{n: 2, widget: 'native_select', verb: 'choose_option', option: 4}, {n: 6, widget: 'magic', verb: 'dismiss_layer', option: 7}]}, sketch, misses);
  assert.deepEqual(more.map(row => [row.n, row.widget, row.verb, row.refused]), [[2, 'native_select', 'ask_person', 'no such option'], [6, 'other', 'ask_person', 'no such layer button']]);
  assert.deepEqual(validRepairs({repairs: [{n: 2, widget: 'native_select', verb: 'choose_option', option: 0}]}, sketch, misses).map(row => [row.verb, row.option, row.refused]), [['choose_option', 0, '']], 'option 0: the computer finds the option from the answer (the model never sees it)');
  const noLayer = accountSketch({...raw, onTop: null});
  assert.equal(validRepairs({repairs: [{n: 6, widget: 'text', verb: 'dismiss_layer', option: 1}]}, noLayer, missesOf(noLayer, []))[0].refused, 'no such layer button');
  assert.deepEqual(validRepairs({repairs: [{n: 6, widget: 'text', verb: 'type', option: 0}]}, sketch, misses), [], 'a verb outside the list is dropped');
  assert.ok(VERBS.every(verb => !/type_text|press_key|submit/.test(verb)) && WIDGETS.includes('other'), 'no verb types model text, presses a key or submits');
});

test('askRepair asks once with the digest and keeps the valid repairs; no AI or nothing to repair asks nothing', async () => {
  const fake = client({repairs: [{n: 2, widget: 'native_select', verb: 'choose_option', option: 3}]});
  const found = await askRepair(fake, raw, [{n: 2, verdict: 'wrong', reason: 'wrong_class'}]);
  assert.equal(fake.sent.length, 1);
  assert.deepEqual(found, {repairs: [{n: 2, label: 'Country', widget: 'native_select', verb: 'choose_option', option: 3, refused: ''}], counts: {choose_option: 1}, asked: true});
  assert.deepEqual(await askRepair(null, raw), {error: 'no AI'});
  const none = client({repairs: []});
  assert.deepEqual(await askRepair(none, {...raw, controls: raw.controls.slice(0, 1)}), {error: 'nothing to repair'});
  assert.equal(none.sent.length, 0);
});

test('the app\'s route asks the repair question with the fill check\'s verdicts and logs numbers and verbs only', async () => {
  const {decideAccountJudge} = await import('../lib/server-pages.js');
  const fake = client({repairs: [{n: 2, widget: 'native_select', verb: 'choose_option', option: 0}, {n: 3, widget: 'checkbox_group', verb: 'toggle', option: 0}]});
  const found = await decideAccountJudge({}, {phase: 'repair', sketch: raw, verdicts: [{n: 2, verdict: 'wrong', reason: 'wrong_class'}, {n: 3, verdict: 'empty', reason: 'not_selected'}]}, {client: fake});
  assert.equal(found.answer, 'repair');
  assert.deepEqual(found.repairs.map(row => [row.n, row.verb, row.refused]), [[2, 'choose_option', ''], [3, 'ask_person', 'floor: legal or password']]);
  assert.deepEqual(await decideAccountJudge({}, {phase: 'repair', sketch: raw}, {client: null}), {ok: true, answer: '', error: 'no AI'});
});
