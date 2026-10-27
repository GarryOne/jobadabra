// Does the form-filling loop learn? Bugs are planted in the reader (extension/page/fill-labels.js, fill-read.js), one at a time, on a corpus of real
// layouts (Greenhouse, Ashby). For each plant, the loop must on its own: notice the question it no longer reads (coverage), send
// it in a fill-failure report with its HTML (desktop/lib/reports.js -> worker/src/report.js), queue it for triage at once, and
// turn it into a replay fixture (tools/fill-fixture.mjs) that is RED while the bug is there and GREEN once it is gone: the fix is
// proven. Recall = plants caught / plants planted, printed as a scorecard; anything below 100% fails.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadJsdom, openPage } from './helpers/page.js';
import { build } from '../../desktop/lib/reports.js';
import { handleReport, sanitize } from '../src/report.js';
import { fromFields } from '../../tools/fill-fixture.mjs';

const JSDOM = await loadJsdom();
const LABELS = 'extension/page/fill-labels.js', READER = 'extension/page/fill-read.js';   // the reader's two files (extension/page-files.js)
const SITE = 'jobs.ashbyhq.com';
const READING = /^question (on the page not read|text not found)/;

// Real layouts, scrubbed: a Greenhouse yes/no in a fieldset with a legend, Ashby's radio group titled by a <label> and required
// only by its class, Ashby's location box with no id or name, and a plain labelled text field.
const CORPUS = `<form>
  <label for="notice">Notice period *</label><input id="notice" required>
  <fieldset><legend>Do you need a visa to work here? *</legend>
    <input type="radio" id="v1" name="visa" required><label for="v1">Yes</label>
    <input type="radio" id="v2" name="visa" required><label for="v2">No</label></fieldset>
  <fieldset class="ashby-application-form-input-radio-group">
    <label class="_heading_f7cvd_52 _required_f7cvd_91 ashby-application-form-question-title" for="q-ai">How much has AI increased your speed?</label>
    <div><span><input type="radio" id="ai-0" name="ai"></span><label for="ai-0">20%</label></div>
    <div><span><input type="radio" id="ai-1" name="ai"></span><label for="ai-1">2x</label></div></fieldset>
  <div class="_fieldEntry_1e3gg_28" data-field-path="_systemfield_location">
    <label class="_heading_f7cvd_52 _required_f7cvd_91 ashby-application-form-question-title" for="_systemfield_location">Where are you located?</label>
    <div class="_inputContainer"><input placeholder="Start typing..." aria-autocomplete="list" aria-haspopup="listbox" role="combobox"></div></div>
</form>`;

// Each plant: a real line of the reader replaced by a broken one (the test fails if the line is gone: plants follow the code).
const PLANTS = [
  { name: 'fieldset titled by a label is not read', file: LABELS, questions: ['How much has AI increased your speed?'],
    from: "Array.from(set.querySelectorAll('label')).find(l => !l.control && !l.querySelector('input, select, textarea'))", to: 'null' },
  { name: 'a field\'s loose label is ignored', file: LABELS, questions: ['Where are you located?'],
    from: 'if (loose.length === 1) return R.read(loose[0]);', to: "if (loose.length === 1) return '';" },
  { name: 'a field with no id or name is dropped', file: READER, questions: ['Where are you located?'],
    from: 'el.id = `jp-field-${++unnamed}`', to: 'void 0' },
  { name: 'radio buttons are not read at all', file: READER, questions: ['Do you need a visa to work here?', 'How much has AI increased your speed?'],
    from: "['hidden', 'submit', 'button', 'reset', 'search', 'file', 'image'].includes(el.type));",
    to: "['hidden', 'submit', 'button', 'reset', 'search', 'file', 'image', 'radio'].includes(el.type));" },
];
const plant = (p) => ({ [p.file]: (source) => {
  assert.ok(source.includes(p.from), `plant "${p.name}": its line is no longer in ${p.file}; update the plant`);
  return source.replace(p.from, p.to);
} });

// One fill, as the extension runs it: the trace, and the snapshots flow.js takes of the fields left for a mechanical reason.
async function fill(html, patch) {
  const window = openPage(JSDOM, html, { url: `https://${SITE}/acme/1/application`, patch });
  const summary = await window.__jobPilottoExtensionFill([], {}, null, '', false);
  const trace = Array.from(summary.trace, (row) => ({ ...row }));
  const reading = trace.filter((row) => READING.test(row.reason));
  const snapshots = JSON.parse(JSON.stringify(window.__jobPilottoSnapshots(reading.map((row) => ({ label: row.label, field: '' })), [])));
  window.close();
  return { trace, reading, snapshots };
}
const isRead = (trace, question) => trace.some((row) => row.label === question && !READING.test(row.reason || ''));

test('without a plant, every required question in the corpus is read: nothing to learn', { skip: !JSDOM }, async () => {
  const { reading } = await fill(CORPUS);
  assert.deepEqual(reading.map((row) => row.label), []);
});

test('planted reader bugs are noticed, reported, triaged at once and become a fixture that proves the fix', { skip: !JSDOM }, async () => {
  const card = [];
  for (const p of PLANTS) {
    const { trace, reading, snapshots } = await fill(CORPUS, plant(p));
    // 1. Noticed: every question the plant broke is traced as a reading failure, required.
    const noticed = p.questions.filter((q) => reading.some((row) => row.label === q && row.required));
    // 2. Reported: the app's fill-failure report carries each, with its HTML; the Worker keeps it.
    const report = build({ url: `https://${SITE}/acme/1/application`, trace, snapshots, debug: { version: 'test', form: [] } });
    const kept = sanitize(report || {});
    const reported = p.questions.filter((q) => kept?.fields.some((f) => f.label === q && f.snapshot));
    // 3. Triaged at once (not waiting for other installs).
    const calls = [];
    await handleReport(new Request('https://x/report/fill-failure', { method: 'POST', body: JSON.stringify(report || {}) }),
      { WAITLIST: { get: async () => null, put: async () => {} } }, async () => calls.push(1));
    // 4. A fixture per question, red under the plant, green under the real reader.
    const fixtures = fromFields(SITE, kept?.fields || []);
    const proven = [];
    for (const fixture of fixtures.filter((f) => p.questions.includes(f.spec.label))) {
      assert.deepEqual(fixture.spec.expect, { read: true, required: true });
      const red = !isRead((await fill(fixture.html, plant(p))).trace, fixture.spec.label);
      const green = isRead((await fill(fixture.html)).trace, fixture.spec.label);
      if (red && green) proven.push(fixture.spec.label);
    }
    card.push({ plant: p.name, planted: p.questions.length, noticed: noticed.length, reported: reported.length, triaged: calls.length > 0, proven: proven.length });
    assert.deepEqual([noticed, reported, calls.length > 0, proven], [p.questions, p.questions, true, p.questions], `plant "${p.name}"`);
  }
  const planted = card.reduce((n, row) => n + row.planted, 0), caught = card.reduce((n, row) => n + row.proven, 0);
  console.log(`Learning loop recall: ${caught}/${planted} planted reader bugs caught end to end`);
  console.table(card);
});
