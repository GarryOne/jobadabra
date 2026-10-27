// Guards lib/replay-truth.mjs without a browser: which answers a case gives, when a box holds THAT answer (Israel is not Switzerland), and the agreement between the panel,
// the fill record and the page's own read-back (no "ready" with a required field left, no CV counted in with no file).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {againstLedger, agreementFailures, expectedAnswers, pickedChoices, recordsOf, sameAnswer, truthFailures} from '../lib/replay-truth.mjs';

test('a case\'s answers: one body, a list of variants, per host; a field given two values is not judged', () => {
  const one = {ai: {'/extension/answer': {answers: [{field: 'country', value: 'Switzerland'}, {field: 'why', value: ''}]}}};
  assert.deepEqual([...expectedAnswers(one)], [['country', 'Switzerland']]);
  const list = {ai: {'/extension/answer': [{when: {a: 1}, answer: {answers: [{field: 'x', value: 'Yes'}, {field: 'y', value: 'No'}]}}, {answer: {answers: [{field: 'x', value: 'Yes'}, {field: 'y', value: 'Yes'}]}}]}};
  assert.deepEqual([...expectedAnswers(list)], [['x', 'Yes']]);
  const byHost = {ai: {'/extension/answer': {byHost: {'a.example': {answers: [{field: 'z', value: '42'}]}, 'b.example': [{answer: {answers: [{field: 'w', value: 'Zurich'}]}}]}}}};
  assert.deepEqual([...expectedAnswers(byHost)], [['z', '42'], ['w', 'Zurich']]);
  assert.equal(expectedAnswers({}).size, 0);
});

test('the same answer: equal, a longer option that holds it, a phone by its digits; never another country or a "no" inside "not sure"', () => {
  assert.ok(sameAnswer('Switzerland', ['Switzerland']));
  assert.ok(sameAnswer('Switzerland', ['Switzerland (CH)', 'CH']));
  assert.ok(sameAnswer('Zürich', ['zurich']));
  assert.ok(sameAnswer('+41 79 123 45 67', ['0791234567', '+41791234567']));
  assert.ok(sameAnswer('+41', ['Switzerland', 'CH']), 'a calling code shown as its country (the fill ladder\'s repair, dial-code-in-country-1)');
  assert.ok(!sameAnswer('+41', ['Israel', 'IL']), 'never another country for a calling code');
  assert.ok(sameAnswer('Yes', ['yes']));
  assert.ok(sameAnswer('Geneva, Switzerland', ['Geneva']));   // a type-to-search option in its own, shorter wording (typeahead-answer-text-differs-1)
  assert.ok(sameAnswer('Are you fluent in English? YES', ['YES']));
  assert.ok(!sameAnswer('Switzerland', ['Israel', 'IL']));
  assert.ok(!sameAnswer('No', ['Not sure']));
  assert.ok(!sameAnswer('Test', ['Candidate']));
  assert.ok(!sameAnswer('Yes', []));
});

test('truth: a field that holds a value must hold its answer; an empty one is the agreement check\'s; an unreadable one is counted, not passed silently', () => {
  const expected = new Map([['country', 'Switzerland'], ['first', 'Test'], ['notes', 'Hello'], ['widget', 'Blue']]);
  const read = new Map([['country', {state: 'value', shown: ['Israel']}], ['first', {state: 'value', shown: ['Test']}], ['notes', {state: 'empty', shown: []}], ['widget', {state: 'unreadable', shown: []}]]);
  const out = truthFailures(expected, read);
  assert.deepEqual(out.failures, ['truth: country holds "Israel", its answer is "Switzerland"']);
  assert.deepEqual(out.counts, {compared: 2, empty: 1, unreadable: 1, missing: 0});
});

test('a choice the case\'s picker names is that field\'s answer too: "Yes" reached as an option in its own words (menu-choices-worded-differently-3)', () => {
  const item = {ai: {'/extension/pick-choice': [{answer: {choice: 'I have the Right to Work in the location'}}, {answer: {ok: true}}]}};
  assert.deepEqual(pickedChoices(item), ['I have the Right to Work in the location']);
  const read = new Map([['rtw', {state: 'value', shown: ['I have the Right to Work in the location']}]]);
  assert.deepEqual(truthFailures(new Map([['rtw', 'Yes']]), read, pickedChoices(item)).failures, []);
  assert.equal(truthFailures(new Map([['rtw', 'Yes']]), new Map([['rtw', {state: 'value', shown: ['I need a visa']}]]), pickedChoices(item)).failures.length, 1);
});

const trace = (...rows) => rows.map(([label, outcome, required = true, type = 'text']) => ({label, outcome, required, type, ...(label === 'CV' ? {source: 'your CV'} : {})}));   // the fill's own CV row (page/fill.js)

test('agreement: a drafted written answer is left in the fill record as on the panel, until the person reads it (written-reminder-never-typed-1)', () => {
  const rows = [{label: 'Story', outcome: 'filled', required: true, type: 'textarea', reason: 'outline: add your own details'}, {label: 'Why', outcome: 'left', required: true, type: 'textarea'}];
  assert.deepEqual(agreementFailures({trace: rows, review: {missing: ['Story', 'Why']}, panel: {present: true, ready: false}, required: [], files: 0}), []);
  assert.deepEqual(agreementFailures({trace: [{...rows[0], reason: ''}, rows[1]], review: {missing: ['Story', 'Why']}, panel: {present: true, ready: false}, required: [], files: 0}).length, 1, 'a plain filled row is still not left');
});

test('agreement: the panel\'s missing, the fill record\'s left and the page\'s own empty required agree', () => {
  const ok = agreementFailures({trace: trace(['Email', 'filled'], ['Phone', 'left'], ['CV', 'filled', true, 'file']), review: {missing: ['Phone']}, panel: {present: true, ready: false},
    required: [{name: 'phone', empty: true}], files: 1});
  assert.deepEqual(ok, []);
  const off = agreementFailures({trace: trace(['Email', 'filled'], ['Phone', 'filled']), review: {missing: ['Phone', 'City']}, panel: {present: true, ready: false}, required: [], files: 0});
  assert.deepEqual(off, ['agreement: the fill record leaves 0 required (none), the panel 2 (Phone, City)']);
  // A record that says MORE left than the panel is older than the page (a box typed again after it was written: upload-autofill-clears-typed-1 on CI): a timing, never a better-looking row.
  assert.deepEqual(agreementFailures({trace: trace(['First name', 'left']), review: {missing: []}, panel: {present: true, ready: false}, required: [], files: 0}), []);
  const page = agreementFailures({trace: trace(['Email', 'filled']), review: {missing: []}, panel: {present: true, ready: false}, required: [{name: 'city', empty: true}], files: 0});
  assert.deepEqual(page, ['agreement: the page has 1 required control empty (city), the panel counts 0 (none)']);
});

test('a "ready" panel with a required field left fails, by the live readings (the panel\'s, the page\'s)', () => {
  const base = {trace: [], review: {missing: []}, panel: {present: true, ready: true}, required: [], files: 0};
  assert.deepEqual(agreementFailures(base), []);
  assert.deepEqual(agreementFailures({...base, required: [{name: 'phone', empty: true}]}), ['agreement: the page has 1 required control empty (phone), the panel counts 0 (none)', 'ready: the panel says ready with 1 required left (phone)']);
  assert.deepEqual(agreementFailures({...base, review: {missing: ['Phone']}, trace: trace(['Phone', 'left'])}), ['ready: the panel says ready with 1 required left (Phone)']);
  // A fill record older than the page (a box typed again after it was written): "ready" is judged on the live readings only.
  assert.deepEqual(agreementFailures({...base, trace: trace(['First name', 'left'])}), []);
});

test('a CV counted in with no file attached on the page fails; a CV left is not this check\'s', () => {
  const base = {review: null, panel: {present: false}, required: []};
  assert.deepEqual(agreementFailures({...base, trace: trace(['CV', 'filled', true, 'file']), files: 0}), ['cv: the fill record counts the CV in, no file box on the page holds a file']);
  assert.deepEqual(agreementFailures({...base, trace: trace(['CV', 'filled', true, 'file']), files: 1}), []);
  assert.deepEqual(agreementFailures({...base, trace: trace(['CV', 'left', true, 'file']), files: 0}), []);
});

test('the fill\'s own CV row counts when it is left: the panel lists the slot', () => {
  assert.deepEqual(agreementFailures({trace: trace(['CV', 'left', true, 'file']), review: {missing: ['Resume']}, panel: {present: true, ready: false}, required: [], files: 0, slots: 1}), []);
});

test('the record\'s CV row counts only where the page has an upload slot: on a page without one it could balance a duplicate on the panel (Ashby, found by fill-ladder)', () => {
  const twice = {trace: trace(['Work in English?', 'left'], ['CV', 'left', true, 'file']), review: {missing: ['Work in English?', 'Work in English?']}, panel: {present: true, ready: false}, required: [], files: 0};
  assert.deepEqual(agreementFailures({...twice, slots: 0}), ['agreement: the fill record leaves 1 required (Work in English?), the panel 2 (Work in English?, Work in English?)']);
  assert.deepEqual(agreementFailures({...twice, review: {missing: ['Work in English?', 'Resume']}, slots: 1}), []);
});

test('no fill record and no panel: nothing to agree on', () => {
  assert.deepEqual(agreementFailures({trace: null, review: null, panel: {present: false}, required: [{name: 'x', empty: true}], files: 0}), []);
});

test('the ledger of found false readings: a listed one is known, a new one fails, a listed one not seen this run is said (some depend on timing), never a failure', () => {
  const ledger = {a: ['truth: x holds "Israel", its answer is "Switzerland"']};
  assert.deepEqual(againstLedger('a', ['truth: x holds "Israel", its answer is "Switzerland"'], ledger), {failures: [], known: ['truth: x holds "Israel", its answer is "Switzerland"'], gone: []});
  assert.deepEqual(againstLedger('a', ['truth: x holds "Israel", its answer is "Switzerland"', 'cv: new'], ledger).failures, ['cv: new']);
  assert.deepEqual(againstLedger('a', [], ledger), {failures: [], known: [], gone: ['truth: x holds "Israel", its answer is "Switzerland"']});
  assert.deepEqual(againstLedger('b', ['ready: y'], ledger), {failures: ['ready: y'], known: [], gone: []});
});

test('every ledger line names a recorded case and one of the checks', async () => {
  const {loadLedger} = await import('../lib/replay-truth.mjs');
  const {loadCases} = await import('../lib/page-replay.mjs');
  const names = new Set(loadCases().map(item => item.name));
  for (const [name, lines] of Object.entries(loadLedger())) {
    assert.ok(names.has(name), `${name}: no such recorded case`);
    for (const line of lines) assert.match(line, /^(truth|agreement|ready|cv): /, `${name}: ${line}`);
  }
});

test('the fill record is the /extension/run as the extension later corrected it: the last updated fields line replaces its trace', () => {
  const body = value => JSON.stringify(value);
  const row = outcome => ({label: 'First name', type: 'text', required: true, outcome, source: 'your details', reason: ''});
  const log = entries => ({route: '/extension/log', body: body({entries})});
  const updated = outcome => ({text: 'fields (updated after a late retype): 1 filled, 0 left', fields: {fields: [row(outcome)]}});
  const run = {route: '/extension/run', body: body({url: 'u', trace: [row('left')]})};
  assert.equal(recordsOf([run]).run.trace[0].outcome, 'left', 'no update: the record as sent');
  assert.equal(recordsOf([run, log([updated('filled')])]).run.trace[0].outcome, 'filled');
  assert.equal(recordsOf([log([updated('filled')]), run]).run.trace[0].outcome, 'left', 'an update from before this record is not its correction');
  assert.equal(recordsOf([run, log([updated('filled')]), log([updated('left')])]).run.trace[0].outcome, 'left', 'the last one wins');
  assert.equal(recordsOf([log([updated('filled')])]).run, null, 'no record, nothing to correct');
});

test('a fill record from ANOTHER page than the panel reports on is not compared with it (a two-page case: the login page\'s record is not the apply page\'s)', () => {
  const body = value => JSON.stringify(value);
  const kind = url => ({route: '/extension/page-kind', body: body({url})});
  const run = {route: '/extension/run', body: body({url: 'job', trace: [{label: 'Email', required: true, outcome: 'filled', source: 'your details'}]})};
  const review = url => ({route: '/extension/review', body: body({url: `${url}#jobpilotto-fill`, missing: ['Phone']})});
  assert.equal(recordsOf([kind('https://a.example/login'), run, kind('https://a.example/apply'), review('https://a.example/apply')]).run, null, 'the record was written on the login page');
  assert.equal(recordsOf([kind('https://a.example/login'), run, kind('https://a.example/apply'), review('https://a.example/apply')]).stale, true, 'never a silent pass: the page\'s own record is awaited, and its absence fails');
  assert.equal(recordsOf([kind('https://a.example/apply'), run, review('https://a.example/apply')]).run.trace[0].label, 'Email', 'the same page: the record stays');
  assert.equal(recordsOf([kind('https://a.example/apply'), run, review('https://a.example/apply')]).stale, false);
  assert.equal(recordsOf([run, review('https://a.example/apply')]).run.trace[0].label, 'Email', 'no page-kind ask before it: nothing to tell it from, kept');
  assert.equal(recordsOf([kind('https://a.example/login'), run]).run.trace[0].label, 'Email', 'no panel report: kept');
});
