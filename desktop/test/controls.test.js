// The generic operators (extension/page/controls.js): each sets one kind of control the way a person would and says whether it
// worked, matched to an answer by field id or by the question, never touching a question that is off limits.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

const module = {exports: {}};
// A control's question comes from the one naming rule (page/label-before.js, tested on a real DOM in app-core/test/label-before.test.js); these fakes have no DOM, so it reads the entry's title.
const groupTitle = el => (title => (title ? {text: title, el: null} : null))(el.parentElement?.querySelector?.()?.textContent);
new Function('module', 'window', fs.readFileSync(new URL('../../extension/page/controls.js', import.meta.url), 'utf8'))(module, {__jobPilottoGroupTitle: groupTitle});
const ops = module.exports;
const noop = () => {};

const toggleBox = (labels = ['Yes', 'No'], pressed = []) => {
  const buttons = labels.map(text => {
    const state = {'aria-pressed': pressed.includes(text) ? 'true' : 'false'};
    const button = {textContent: text, getAttribute: name => state[name] ?? null, getClientRects: () => [1]};
    button.click = () => { for (const other of buttons) other.set('false'); state['aria-pressed'] = 'true'; };
    button.set = value => { state['aria-pressed'] = value; };
    return button;
  });
  return {buttons, querySelectorAll: () => buttons, querySelector: () => null};
};
const entry = (title, box, ids = []) => Object.assign(box, {
  parentElement: {querySelector: () => ({textContent: title}), parentElement: null},
  closest: () => null,
  idsList: ids,
});

test('answers are read as yes or no however they are written', () => {
  assert.deepEqual(['Yes', 'yes, I am', 'Ja', 'oui', 'TRUE'].map(ops.yesNo), ['yes', 'yes', 'yes', 'yes', 'yes']);
  assert.deepEqual(['No', 'no.', 'Nein', 'false'].map(ops.yesNo), ['no', 'no', 'no', 'no']);
  assert.equal(ops.yesNo('Maybe later'), '');
});

test('dates are understood in the usual written forms and given to a field in the shape it asks for', () => {
  assert.deepEqual(ops.parseDate('2026-11-01'), {y: 2026, m: 11, d: 1});
  assert.deepEqual(ops.parseDate('01.11.2026'), {y: 2026, m: 11, d: 1});
  assert.deepEqual(ops.parseDate('1 Nov 2026'), {y: 2026, m: 11, d: 1});
  assert.deepEqual(ops.parseDate('11/25/2026'), {y: 2026, m: 11, d: 25});   // a month above 12 settles a slash date
  assert.equal(ops.parseDate('as soon as possible'), null);
  assert.equal(ops.parseDate('31.13.2026'), null);
  const date = {y: 2026, m: 11, d: 1};
  assert.equal(ops.formatDate(date, {type: 'date'}), '2026-11-01');
  assert.equal(ops.formatDate(date, {type: 'text', placeholder: 'dd.mm.yyyy'}), '01.11.2026');
  assert.equal(ops.formatDate(date, {type: 'text', placeholder: 'yyyy-mm-dd'}), '2026-11-01');
  assert.equal(ops.formatDate(date, {type: 'text', placeholder: 'Pick date...'}), '11/01/2026');
});

test('an answer is matched to a control by its field id first, else by the question text', () => {
  const answers = [{field: 'q1', question: 'Anything else?', value: 'No'}, {field: 'q2', question: 'Are you authorized to work in the country where the job is located?', value: 'Yes'}];
  assert.equal(ops.matchAnswer(answers, {ids: new Set(['q1']), question: 'whatever'}).field, 'q1');
  assert.equal(ops.matchAnswer(answers, {ids: new Set(), question: 'Are you authorized to work in the country where the job is located?'}).field, 'q2');
  assert.equal(ops.matchAnswer(answers, {ids: new Set(), question: 'Are you authorized to work'}).field, 'q2');   // the form's title inside the kit's longer question
  assert.equal(ops.matchAnswer(answers, {ids: new Set(), question: 'Anything'}), undefined);   // too short to be sure
});

test('a toggle group presses the option named by the answer and checks it stayed', async () => {
  const box = toggleBox();
  assert.deepEqual(await ops.setToggleGroup(box, 'Yes'), {ok: true});
  assert.deepEqual(box.buttons.map(b => b.getAttribute('aria-pressed')), ['true', 'false']);
  assert.deepEqual(await ops.setToggleGroup(box, 'No, I do not'), {ok: true});
  assert.deepEqual(box.buttons.map(b => b.getAttribute('aria-pressed')), ['false', 'true']);
  assert.equal((await ops.setToggleGroup(box, 'Perhaps')).ok, false);
  const stuck = toggleBox(); stuck.buttons[0].click = noop;   // a page that ignores the click
  assert.equal((await ops.setToggleGroup(stuck, 'Yes')).ok, false);
});

test('a date field gets the date in its format and must keep it', async () => {
  const input = {type: 'text', placeholder: 'dd.mm.yyyy', value: '', focus: noop, dispatchEvent: noop};
  assert.deepEqual(await ops.setDate(input, '2026-11-01'), {ok: true, text: '01.11.2026'});
  assert.equal(input.value, '01.11.2026');
  assert.equal((await ops.setDate({...input, value: ''}, 'soon')).ok, false);
  const forgetful = {type: 'text', placeholder: '', focus: noop, dispatchEvent: noop, get value() { return ''; }, set value(_) {}};
  assert.equal((await ops.setDate(forgetful, '2026-11-01')).ok, false);
});

test('a custom dropdown opens, picks the option by its text, and must show it', async () => {
  const trigger = {textContent: 'Select…', click() { opened = true; }};
  let opened = false;
  const option = text => ({textContent: text, children: [], contains: () => false, getClientRects: () => [1], click() { trigger.textContent = text; }});
  const doc = {querySelectorAll: () => (opened ? [option('Switzerland'), option('Sweden')] : [])};
  assert.equal((await ops.setCustomSelect(trigger, 'Sweden', doc)).ok, true);
  assert.equal(trigger.textContent, 'Sweden');
  opened = false;
  assert.equal((await ops.setCustomSelect(trigger, 'Norway', doc)).ok, false);
});

test('fill offers only matched, permitted controls to the operators and reports each', async () => {
  const yes = entry('Are you authorized to work in the country where the job is located?', toggleBox());
  const consent = entry('I agree to the privacy policy', toggleBox());
  const stranger = entry('Do you like cats today?', toggleBox());
  const kit = {widgets: () => [yes, consent, stranger].map(el => ({el, kind: 'toggle-group'}))};
  const doc = {querySelectorAll: () => []};
  const answers = [{question: 'Are you authorized to work in the country where the job is located?', value: 'Yes'},
    {question: 'I agree to the privacy policy', value: 'Yes'}];
  const results = await ops.fill(answers, {doc, kit, skip: question => /agree|privacy/i.test(question)});
  assert.deepEqual(results.filter(r => !r.unmatched).map(r => [r.question.slice(0, 12), r.ok]), [['Are you auth', true]]);
  // An empty control no answer fit is reported for learning with a fixed reason word and no text; an off-limits one (consent) is not reported at all.
  assert.deepEqual(results.filter(r => r.unmatched).map(r => [r.kind, r.ok, r.why, r.question, r.value]), [['toggle-group', false, 'no_answer', '', '']]);
  assert.equal(consent.buttons.some(b => b.getAttribute('aria-pressed') === 'true'), false);   // consent never touched
  assert.equal(stranger.buttons.some(b => b.getAttribute('aria-pressed') === 'true'), false);  // no answer, no action
});

test('a recipe configures the toggle operator: its own option selector and its own "selected" attribute', async () => {
  const state = {'data-state': 'off'};
  const make = text => {
    const own = {'data-state': 'off'};
    const button = {textContent: text, getAttribute: name => own[name] ?? null, getClientRects: () => [1], click() { for (const b of buttons) b.own['data-state'] = 'off'; own['data-state'] = 'on'; }, own};
    return button;
  };
  const buttons = [make('Yes'), make('No')];
  const seen = [];
  const box = {querySelectorAll: selector => { seen.push(selector); return buttons; }};
  assert.equal((await ops.setToggleGroup(box, 'No', {option: '.choice', onAttr: 'data-state', onValue: 'on'})).ok, true);
  assert.deepEqual(seen, ['.choice']);
  assert.equal(buttons[1].own['data-state'], 'on');
  assert.equal(state['data-state'], 'off');
});

test('a recipe can set a date field\'s shape, and fill uses the recipe for a control with that fingerprint and says which version', async () => {
  const input = {type: 'text', placeholder: 'Pick date...', value: '', focus: noop, dispatchEvent: noop};
  assert.deepEqual(await ops.setDate(input, '2026-11-01', {order: 'dmy', sep: '.'}), {ok: true, text: '01.11.2026'});
  const box = toggleBox();
  const el = entry('Do you need a visa?', box);
  const kit = {widgets: () => [{el, kind: 'toggle-group'}], skeleton: () => ({}), fingerprint: () => 'fp1d2pcap'};
  const results = await ops.fill([{question: 'Do you need a visa?', value: 'No'}], {doc: {querySelectorAll: () => []}, kit,
    recipes: {fp1d2pcap: {operator: 'toggle', version: 3, params: {}}}});
  assert.deepEqual(results.map(r => [r.fp, r.recipe, r.ok]), [['fp1d2pcap', 3, true]]);
  const other = await ops.fill([{question: 'Do you need a visa?', value: 'No'}], {doc: {querySelectorAll: () => []}, kit: {...kit, widgets: () => [{el: entry('Do you need a visa?', toggleBox()), kind: 'toggle-group'}]},
    recipes: {fp1d2pcap: {operator: 'select', version: 9, params: {}}}});
  assert.equal(other[0].recipe, 0);   // a recipe for another operator is not applied
});

test('whatever a recipe says, an operator never presses something that looks like a submit control', async () => {
  const submit = {textContent: 'Submit application', getAttribute: () => null, getClientRects: () => [1], click() { throw new Error('pressed'); }};
  const box = {querySelectorAll: () => [submit]};
  assert.deepEqual(await ops.setToggleGroup(box, 'Submit application', {option: 'button'}), {ok: false, why: 'refused: looks like a submit control'});
  const trigger = {textContent: 'Send application', click() { throw new Error('pressed'); }};
  assert.equal((await ops.setCustomSelect(trigger, 'x', {querySelectorAll: () => []})).ok, false);
  const typed = {textContent: 'Continue', getAttribute: name => (name === 'type' ? 'submit' : null), getClientRects: () => [1], click() { throw new Error('pressed'); }};
  assert.equal((await ops.setToggleGroup({querySelectorAll: () => [typed]}, 'Continue', {})).ok, false);   // an explicit submit type
  // a plain button reports type "submit" in a browser without having the attribute: that is not a reason to refuse it
  const plain = {textContent: 'Yes', type: 'submit', getAttribute: name => (name === 'aria-pressed' ? 'false' : null), getClientRects: () => [1], click() { this.getAttribute = () => 'true'; }};
  assert.equal((await ops.setToggleGroup({querySelectorAll: () => [plain]}, 'Yes', {})).ok, true);
});

test('the fingerprints a form shows are listed for the app to ask recipes for', () => {
  const kit = {widgets: () => [{el: {}, kind: 'toggle-group'}, {el: {}, kind: 'slider'}, {el: {}, kind: 'custom-select'}], skeleton: () => ({}), fingerprint: (() => { let n = 0; return () => `fp${++n}aaaa`; })()};
  const doc = {querySelectorAll: () => []};
  assert.deepEqual(ops.fingerprints({doc, kit}), ['fp1aaaa', 'fp2aaaa']);   // a slider has no operator here, so no recipe is asked for
});

test('an empty toggle or date field no answer fits is a miss with a reason word; a custom select, which cannot be told empty, is not', async () => {
  const noTitle = Object.assign(toggleBox(), {parentElement: null, closest: () => null, idsList: []});
  const stranger = entry('Do you like cats today?', toggleBox());
  const pressed = entry('Remote?', toggleBox(['Yes', 'No'], ['Yes']));   // already answered: never a miss
  const select = entry('Country', {textContent: 'Select', getClientRects: () => [1], querySelector: () => null, click: noop});
  const kit = {widgets: () => [{el: noTitle, kind: 'toggle-group'}, {el: stranger, kind: 'toggle-group'}, {el: pressed, kind: 'toggle-group'}, {el: select, kind: 'custom-select'}], skeleton: () => ({}), fingerprint: () => 'fp12345'};
  pressed.querySelector = () => pressed.buttons[0];
  const results = await ops.fill([], {doc: {querySelectorAll: () => []}, kit});
  assert.deepEqual(results.map(r => [r.kind, r.why, r.unmatched, r.fp]), [['toggle-group', 'no_question', true, 'fp12345'], ['toggle-group', 'no_answer', true, 'fp12345']]);
});
