// The AI's reading of a question (kit.py / worker answer category) in page/fill.js: a consent in any language is never ticked by us, and
// the kind is marked on the field for the review panel (8 Oct 2026: "Li e aceito a política de privacidade" was not caught by LEGAL).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import {fakeFillPage} from './fake-fill-page.js';

test('a consent the AI read as legal is never ticked, in any language; its kind is marked for the review panel', async () => {
  const rows = [{field: 'privacidade', label: 'Li e aceito a política de privacidade', type: 'checkbox', required: true, filled: false, legal: false},
    {field: 'visto', label: 'Precisa de visto para trabalhar em Portugal?', type: 'text', required: true, filled: false, legal: false}];
  const {elements, fill} = fakeFillPage(rows);
  await fill([{field: 'privacidade', value: 'checked', category: 'legal'}, {field: 'visto', value: 'Não', category: 'knockout'}]);
  assert.equal(elements.privacidade.clicks, 0, 'never ticked by us');
  assert.equal(elements.privacidade.dataset.jobpilottoCategory, 'legal');
  assert.equal(elements.visto.dataset.jobpilottoCategory, 'knockout');
});

test('a voluntary question the AI read as demographic is declined, in any language, like the English words', async () => {
  const fill = fs.readFileSync(new URL('../../extension/page/fill-plan.js', import.meta.url), 'utf8');
  assert.match(fill, /!\(row\.demographic \|\| DEMOGRAPHIC\.test\(row\.label/);
  const categories = fs.readFileSync(new URL('../../extension/page/categories.js', import.meta.url), 'utf8');
  assert.match(categories, /if \(item\.category === 'demographic'\) row\.demographic = true;/);
});

test('every calling code names a country; the codes the filler named before keep their exact names', () => {
  const window = {};
  vm.runInContext(fs.readFileSync(new URL('../../extension/page/dial-codes.js', import.meta.url), 'utf8'), vm.createContext({window, Intl}));
  const dial = window.__jobPilottoDial;
  assert.ok(Object.keys(dial).length >= 200);
  for (const [code, country] of [['+852', 'Hong Kong'], ['+90', 'T'], ['+65', 'Singapore'], ['+7', 'Russia'], ['+27', 'South Africa'], ['+57', 'Colombia']]) {
    assert.ok(String(dial[code]).startsWith(country), `${code}: ${dial[code]}`);
  }
  const fill = fs.readFileSync(new URL('../../extension/page/fill-menus.js', import.meta.url), 'utf8');
  assert.match(fill, /const DIAL = \{\.\.\.\(window\.__jobPilottoDial \|\| \{\}\), '\+1': 'United States'/);   // the old names win (after the spread)
  assert.match(fill, /'\+420': 'Czech Republic'/);
});

test('a legal question the AI returned as a kind only (no value) is marked legal: left as the person\'s choice, never "no answer", never filled', async () => {
  // 11 Oct 2026, Datadog: "I certify that the information provided is true" (a picklist) fell to "no answer in the kit": the English floor missed it and the AI had left it out.
  const rows = [{field: 'certify', label: 'I certify that the information provided in this application is true', type: 'combobox', required: true, filled: false, legal: false}];
  const {elements, armed, fill} = fakeFillPage(rows);   // the post-fill audit reads legal as the real one does (fake-fill-page.js)
  const summary = await fill([{field: 'certify', value: '', category: 'legal', use: 'kind'}]);
  assert.equal(elements.certify.dataset.jobpilottoCategory, 'legal');
  assert.deepEqual(armed, []);
  const row = (summary.trace || []).find(item => item.label.startsWith('I certify'));
  assert.ok(row, `the trace lists it: ${JSON.stringify(summary.trace).slice(0, 300)}`);
  assert.equal(row.reason, 'legal/consent: always your choice');
  assert.equal(row.source, '');
  const audit = fs.readFileSync(new URL('../../extension/page/browser-form-fastpath.js', import.meta.url), 'utf8');
  assert.match(audit, /legal: forbidden\.test\(label\(el\)\) \|\| el\.dataset\?\.jobpilottoCategory === 'legal'/, 'the post-fill audit honours the AI\'s legal mark');
});

test('a question the form reader called legal stays legal in the trace when the post-fill audit\'s own floor misses its wording', async () => {
  // 11 Oct 2026, Datadog round 2: the reader marked the attestation legal (so it was never asked), the audit's separate word list did not, and the trace
  // said "no answer in the kit". One decision: the reader's.
  const rows = [{field: 'certify', label: 'I certify that the information provided in this application is true', type: 'combobox', required: true, filled: false, legal: true}];
  const {fill} = fakeFillPage(rows, {audit: rows.map(row => ({...row, legal: false}))});
  const summary = await fill([]);
  assert.deepEqual(summary.trace.filter(row => row.label.startsWith('I certify')).map(row => [row.outcome, row.reason]), [['left', 'legal/consent: always your choice']]);
});

test('an open question the AI returned as a "written" kind (no value) is left as the person\'s to write: never "no answer", never typed', async () => {
  // 11 Oct 2026, Ashby "Quelles sont vos motivations pour rejoindre ...?": the AI left it out, so ~12 pool rows without a kit counted it as a failure.
  const rows = [{field: 'why', label: 'Quelles sont vos motivations pour rejoindre Pennylane ?', type: 'text', required: true, filled: false, legal: false}];
  const {elements, fill} = fakeFillPage(rows);
  const summary = await fill([{field: 'why', value: '', category: 'written', use: 'kind'}]);
  assert.equal(elements.why.dataset.jobpilottoCategory, 'written');
  const row = summary.trace.find(item => item.label.startsWith('Quelles'));
  assert.deepEqual([row.outcome, row.reason, row.source], ['left', 'written: your own words to write', '']);
});

test('the siblings of a "written" left field agree: the pool verdict, the fill card and the service count treat it like a legal one', async () => {
  const {verdictOf} = await import('../e2e/lib/record-sites.mjs');
  const {fillCard} = await import('../../extension/fill-card.js');
  const field = {outcome: 'left', required: true, type: 'text', label: 'Why us?', reason: 'written: your own words to write'};
  assert.equal(verdictOf(field), 'expected');
  assert.equal(fillCard({trace: [field]}).required, 0, 'not counted as a fill loss');
  assert.match(fs.readFileSync(new URL('../../extension/background.js', import.meta.url), 'utf8'), /!\/\^\(legal\|written\|demographic\)\/\.test\(String\(row\.reason/);
});

test('only a left field the AI read as written is an expected hold: every other kind of left field still makes the row a shortfall', async () => {
  const {verdictOf} = await import('../e2e/lib/record-sites.mjs');
  const left = reason => ({outcome: 'left', required: true, type: 'text', label: 'Q', reason});
  const want = {'written: your own words to write': 'expected', 'legal/consent: always your choice': 'expected', 'proposed for you to confirm': 'expected',
    'no answer in the kit, Profile or your details': 'no_suggestion', 'answer given, but the field did not take it': 'miss', 'question on the page not read': 'miss',
    'question text not found on the page': 'miss', 'dropdown that opens only on a real click': 'miss',
    'demographic: your own choice': 'expected', 'the AI gave no answer': 'no_suggestion'};
  for (const [reason, verdict] of Object.entries(want)) assert.equal(verdictOf(left(reason)), verdict, reason);
});

test('a salutation the AI returned as a "demographic" kind (no profile value) is the person\'s own choice; one it never named is "the AI gave no answer"; neither is typed', async () => {
  // 11 Oct 2026, 4 Umantis rows: the radio "Anrede" (Herr/Frau) was asked and missing from the AI's answer. Nothing is inferred from a first name.
  const rows = [{field: 'radio:form_data6', label: 'Anrede', type: 'radio', required: true, filled: false, legal: false},
    {field: 'radio:other', label: 'Titel', type: 'radio', required: true, filled: false, legal: false}];
  const {armed, fill} = fakeFillPage(rows);
  const summary = await fill([{field: 'radio:form_data6', value: '', category: 'demographic', use: 'kind'}, {field: 'radio:other', value: '', category: 'unanswered', use: 'kind'}]);
  assert.deepEqual(armed, []);
  const {verdictOf} = await import('../e2e/lib/record-sites.mjs');
  const {fillCard} = await import('../../extension/fill-card.js');
  const by = Object.fromEntries(summary.trace.map(row => [row.label, row]));
  assert.deepEqual([by.Anrede.outcome, by.Anrede.reason, by.Titel.reason], ['left', 'demographic: your own choice', 'the AI gave no answer']);
  assert.equal(verdictOf({...by.Anrede, required: true}), 'expected');
  assert.equal(fillCard({trace: [by.Anrede]}).required, 0, 'not counted as a fill loss');
  assert.equal(fillCard({trace: [by.Titel]}).causes.ai_declined, 1);
});
