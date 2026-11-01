// The cause of each left control travels from the fill to the panel's report: fillCard lists marks, markCauses writes them onto the controls (and drops the list), the report's `why` carries them as fixed words
// (extension/ladder/control-marks.js, page/review-payload.js). Guard for the person card's reason line (desktop/test/reason-class.test.js).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {fillCard} from '../../extension/fill-card.js';
import {markCauses} from '../../extension/ladder/control-marks.js';
import {loadJsdom, openPage} from './helpers/page.js';
import { readPanel } from './helpers/panel.js';

const JSDOM = await loadJsdom();
const trace = [{label: 'Phone', field: 'phone', type: 'text', required: true, outcome: 'left', reason: 'a detail of yours not saved yet'},
  {label: 'Pay', field: 'pay', type: 'text', required: true, outcome: 'left', reason: 'question on the page not read'},
  {label: 'City', field: 'city', type: 'text', required: true, outcome: 'filled', reason: ''}];

test('the card lists the cause of every left control with a field, and only the worker keeps the list', () => {
  const card = fillCard({id: 'abc12345-x', trace, form: [], useAI: false});
  assert.deepEqual(card.marks, [{field: 'phone', cause: 'no_data'}, {field: 'pay', cause: 'unread'}]);
});

test('markCauses writes each cause on its control (a group of options on all of them) and drops the list', { skip: !JSDOM }, async () => {
  const window = openPage(JSDOM, '<input id="phone"><input id="pay"><input type="radio" name="g"><input type="radio" name="g"><input id="city">');
  const card = {marks: [{field: 'phone', cause: 'no_data'}, {field: 'g', cause: 'ai_declined'}, {field: 'pay', cause: 'a stray word'}, {field: '', cause: 'other'}]};
  const inPage = async (tab, fn, args) => { window.__args = args; return window.eval(`(${fn.toString()})(...window.__args)`); };
  assert.equal(await markCauses(inPage, 1, card), 3);
  assert.equal(card.marks, undefined);
  const doc = window.document;
  assert.equal(doc.getElementById('phone').getAttribute('data-jobpilotto-cause'), 'no_data');
  assert.deepEqual([...doc.getElementsByName('g')].map(el => el.getAttribute('data-jobpilotto-cause')), ['ai_declined', 'ai_declined']);
  assert.equal(doc.getElementById('pay').hasAttribute('data-jobpilotto-cause'), false, 'only a fixed cause word is written');
  assert.equal(doc.getElementById('city').hasAttribute('data-jobpilotto-cause'), false);
});

test('the report carries one fixed cause per left control, no value', { skip: !JSDOM }, () => {
  const window = openPage(JSDOM, '');
  window.eval(fs.readFileSync(new URL('../../extension/page/review-payload.js', import.meta.url), 'utf8'));
  const list = [{label: 'Phone', required: true, filled: false, cause: 'no_data', el: null}, {label: 'Pay', required: true, filled: false, unread: true},
    {label: 'City', required: true, filled: false, cause: 'not_taken', gaveUp: 'tries'}, {label: 'Name', required: true, filled: true}];
  const payload = window.__jobPilottoReviewPayload({list, left: 3, total: 4}, [], {agree: /agree/i, find: () => null});
  assert.deepEqual(JSON.parse(JSON.stringify(payload.why)), [{label: 'Phone', cause: 'no_data', tries: false, unread: false}, {label: 'Pay', cause: '', tries: false, unread: true}, {label: 'City', cause: 'not_taken', tries: true, unread: false}]);
  assert.deepEqual([...payload.pending], ['Phone', 'Pay', 'City']);
});

test('the panel loads the payload file and reads the cause marks (review.js, background.js)', () => {
  const read = file => fs.readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
  assert.match(read('extension/background.js'), /'page\/option-groups\.js', 'page\/review-payload\.js', 'hook\.js'/);
  assert.match(readPanel(), /window\.__jobPilottoReviewPayload\(state, watch/);
  assert.match(readPanel(), /entry\.cause \|\|= el\.dataset\.jobpilottoCause/);
});
