// Integration test (layer 1, owner 1 Nov 2026): the real extension in a real Chromium on fixture forms, no app: two checks of the apply e2e suite that a recorded page case cannot hold,
// moved here from it. (1) "real forms the extension once failed on" (fixtures/real-forms, tools/fixture-from-fills.py): your details are filled, and every required field the
// extension failed on is now filled or listed for the person by its label, never skipped in silence; Submit is never pressed. (2) A required control the extension cannot operate (a
// role=slider): the miss is reported to the app, the panel lists the question and never says "Ready to submit" over it.
// Why not recorded cases (1 Nov 2026): (1) holds "filled OR listed", which a case's fixed expectations cannot say; (2) is a disagreement the page-case runner's truth check
// (lib/replay-truth.mjs agreement) refuses for every case: the fill record leaves 0 required where the panel lists the slider (reported to the coordinator as a product finding, not fixed here).
// The stand-in app and the isolation proof are lib/real-extension.mjs; the pages come from the fixtures, served by context.route. Runs in CI · Harness tests (full Chromium).
import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {fillState, readForm, readPanel} from '../../e2e/lib/extension.mjs';
import {waitForFill} from '../../e2e/lib/fill-attempt.mjs';
import {fillProblems, leftProblems, submitProblems} from '../../e2e/lib/applycheck.mjs';
import {FORMS, REAL_FORMS, formHtml, realFieldId, realPage} from '../../e2e/lib/forms.mjs';
import {FAKE_CONTACT, startRealExtension} from '../../e2e/lib/real-extension.mjs';

const KIND = {ok: true, kind: 'form', role: 'form', by: 'ai', confidence: 0.95, rung: 2};
const CONTACT = FAKE_CONTACT;   // the applicant the stand-in app serves (lib/real-extension.mjs)
let run;
before(async () => {
  // No kit: the AI answers nothing beyond the page kind, so what the person's details cannot fill must be listed for them.
  run = await startRealExtension({offline: true, allowAllSites: true, answer: {'/extension/page-kind': () => KIND, '/extension/answer': () => ({ok: true, eligible: true, answers: []})}});
});
after(async () => { await run?.close(); });

// Open the form as the app's Apply does (the marked address), wait for the fill to end, read the form and the panel. The page closes at the end of the test.
async function fillForm(form, html) {
  const fired = [];
  const url = `https://${form.host}${form.path}`;
  const page = await run.context.newPage();
  await page.route(`https://${form.host}/**`, route => {
    if (route.request().url().includes('/__fired')) { const query = new URL(route.request().url()).searchParams; fired.push({kind: query.get('kind'), form: query.get('form')}); return route.fulfill({status: 204, body: ''}); }
    return route.fulfill({status: 200, contentType: 'text/html; charset=utf-8', body: html});
  });
  await page.goto(`${url}#jobpilotto-fill`, {waitUntil: 'domcontentloaded'});
  const done = await waitForFill({capMs: 90000, pickTab: () => ({tab: page, tabs: 1}), readState: fillState});
  assert.ok(done.ok, `the extension never finished filling ${form.title} (last state ${JSON.stringify(done.state)})`);
  assert.notEqual(done.state.state, 'error', `the fill ended in an error: ${done.state.error}`);
  const panelRead = await waitForFill({capMs: 30000, pickTab: () => ({tab: page, tabs: 1}), readState: readPanel, accept: panel => !!panel?.progress && !panel.filling});
  assert.ok(panelRead.ok, `the panel never became readable (last read ${JSON.stringify(panelRead.state)})`);
  return {page, fired, actual: await readForm(page), panel: panelRead.state};
}

for (const spec of REAL_FORMS) {
  test(`real form ${spec.id}: your details are filled, and every required field it failed on is filled or listed for you by name, Submit untouched`, async () => {
    const form = FORMS[`real-${spec.id}`];
    const {page, fired, actual, panel} = await fillForm(form, realPage(form));
    try {
      const problems = [...fillProblems({expected: CONTACT, actual}), ...submitProblems(fired, form.path)];
      // Each field it failed on for a real person is now either filled, or listed for the person by name: never skipped in silence.
      const listed = label => panel.left.some(item => item.toLowerCase().includes(String(label).split(/\s+/).slice(0, 3).join(' ').toLowerCase()));
      for (const [i, item] of spec.fields.entries()) {
        if (item.required === false) continue;
        const value = actual[realFieldId(item.label, i)];
        const filled = value && (value.checked || (value.value && !/^select/i.test(value.value)));
        if (!filled && !listed(item.label)) problems.push(`"${String(item.label).slice(0, 60)}" was neither filled nor listed as left for the person (it lists: ${panel.left.join(' | ') || 'nothing'})`);
      }
      assert.deepEqual(problems, []);
    } finally { await page.close(); }
  });
}

test('a form with a control the extension cannot operate: the miss is reported to the app, the panel lists the question and does not say "Ready to submit" over it', async () => {
  const form = FORMS.unknown;
  const {page, fired, actual, panel} = await fillForm(form, formHtml('unknown'));
  try {
    assert.deepEqual([...fillProblems({expected: {first_name: CONTACT.first_name, email: CONTACT.email}, actual}), ...submitProblems(fired, form.path)], []);
    const reported = await waitForFill({capMs: 30000, pickTab: () => ({tab: page, tabs: 1}), readState: async () => run.requests.filter(request => request.route === '/extension/misses' && request.body.includes('"kind":"slider"')).map(request => request.route), accept: routes => routes.length > 0});
    assert.ok(reported.ok, `the app was never told about the slider (no /extension/misses report carries "kind":"slider"; routes seen: ${[...new Set(run.requests.map(request => request.route))].join(', ')})`);
    assert.ok(!/ready to submit/i.test(`${panel.pill} ${panel.progress}`), `the panel says "${panel.pill} ${panel.progress}" while the required "${form.widget}" control is unanswered`);
    assert.deepEqual(leftProblems(panel.left, ['Terraform skill']), []);
  } finally { await page.close(); }
});
