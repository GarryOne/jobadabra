// Integration test (layer 1, owner 1 Nov 2026): the real extension in a real Chromium on fixture forms, no app: two checks of the apply e2e suite that a recorded page case cannot hold,
// moved here from it. (1) "real forms the extension once failed on" (fixtures/real-forms, tools/fixture-from-fills.py): your details are filled, and every required field the
// extension failed on is now filled or listed for the person by its label, never skipped in silence; Submit is never pressed. (2) A required control the extension cannot operate (a
// role=slider): the miss is reported to the app, the panel lists the question and never says "Ready to submit" over it.
// Why not recorded cases (1 Nov 2026): (1) holds "filled OR listed", which a case's fixed expectations cannot say; (2) is a disagreement the page-case runner's truth check
// (lib/replay-truth.mjs agreement) refuses for every case: the fill record leaves 0 required where the panel lists the slider (reported to the coordinator as a product finding, not fixed here).
// The stand-in app and the isolation proof are lib/real-extension.mjs; the pages come from the fixtures, served by context.route. Runs in CI · Harness tests (full Chromium).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {after, before, test} from 'node:test';
import {fillState, readForm, readPanel} from '../../e2e/lib/extension.mjs';
import {waitForFill} from '../../e2e/lib/fill-attempt.mjs';
import {cvProblems, fillProblems, leftProblems, submitProblems} from '../../e2e/lib/applycheck.mjs';
import {FORMS, MENU_FIRST, MENU_AGAIN, MENU_PAGE, REAL_FORMS, SIGNUP, SIGNUP_PAGES, formHtml, realFieldId, realPage} from '../../e2e/lib/forms.mjs';
import {FAKE_CONTACT, FIXTURE_CV, startRealExtension} from '../../e2e/lib/real-extension.mjs';

// Hang guards (1 Nov 2026, main 47580bb run 41342226333: this file printed no subtest and died at the run's 180 s file limit). Slowest measured test here: 5.9 s (run 41341289580), so 100 s is 17x.
// Each test gets its own limit below the file's, so a hung one is named by the runner; the waits inside end earlier still and say which state they waited for.
const TEST_CAP = {timeout: 100000}, FILL_CAP_MS = 60000, PANEL_CAP_MS = 20000;
const KIND = {ok: true, kind: 'form', role: 'form', by: 'ai', confidence: 0.95, rung: 2};
const CONTACT = FAKE_CONTACT;   // the applicant the stand-in app serves (lib/real-extension.mjs)
let run;
before(async () => {
  // No kit: the AI answers nothing beyond the page kind, so what the person's details cannot fill must be listed for them.
  run = await startRealExtension({offline: true, allowAllSites: true, answer: {'/extension/page-kind': () => KIND, '/extension/answer': () => ({ok: true, eligible: true, answers: []})}});
}, TEST_CAP);
after(async () => { await run?.close(); }, TEST_CAP);

// Open the form as the app's Apply does (the marked address), wait for the fill to end, read the form and the panel. The page closes at the end of the test.
async function fillForm(form, html, via = run) {
  const fired = [];
  const url = `https://${form.host}${form.path}`;
  const page = await via.context.newPage();
  await page.route(`https://${form.host}/**`, route => {
    if (route.request().url().includes('/__fired')) { const query = new URL(route.request().url()).searchParams; fired.push({kind: query.get('kind'), form: query.get('form')}); return route.fulfill({status: 204, body: ''}); }
    return route.fulfill({status: 200, contentType: 'text/html; charset=utf-8', body: html});
  });
  await page.goto(`${url}#jobpilotto-fill`, {waitUntil: 'domcontentloaded'});
  const done = await waitForFill({capMs: FILL_CAP_MS, pickTab: () => ({tab: page, tabs: 1}), readState: fillState});
  assert.ok(done.ok, `the extension never finished filling ${form.title} (last state ${JSON.stringify(done.state)})`);
  assert.notEqual(done.state.state, 'error', `the fill ended in an error: ${done.state.error}`);
  const panelRead = await waitForFill({capMs: PANEL_CAP_MS, pickTab: () => ({tab: page, tabs: 1}), readState: readPanel, accept: panel => !!panel?.progress && !panel.filling});
  assert.ok(panelRead.ok, `the panel never became readable (last read ${JSON.stringify(panelRead.state)})`);
  return {page, fired, actual: await readForm(page), panel: panelRead.state};
}

for (const spec of REAL_FORMS) {
  test(`real form ${spec.id}: your details are filled, and every required field it failed on is filled or listed for you by name, Submit untouched`, TEST_CAP, async () => {
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

test('a form with a control the extension cannot operate: the miss is reported to the app, the panel lists the question and does not say "Ready to submit" over it', TEST_CAP, async () => {
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

// Night journey J8 (Tier 2 since 1 Nov 2026, so no longer an e2e step): the tailored CV reaches the form. Which CV the app hands the extension is desktop/integration/store/tailored-cv.test.mjs; here the
// extension attaches exactly what the app hands it, under its own name and not the general CV. The stand-in app serves the tailored file the way lib/server-contact.js `me` does (resume: {data, name, type}).
test('a form whose app hands it a tailored CV gets that file attached, under its own name, and not the general CV', TEST_CAP, async () => {
  const tailored = Buffer.concat([fs.readFileSync(FIXTURE_CV), Buffer.from('\n% tailored for E2E Greenhouse Labs\n')]);
  const general = fs.readFileSync(FIXTURE_CV);
  const NAME = 'CV_Ada_Tester_E2E_Greenhouse_Labs.pdf';
  const tailoredRun = await startRealExtension({offline: true, allowAllSites: true, answer: {'/extension/page-kind': () => KIND, '/extension/answer': () => ({ok: true, eligible: true, answers: []})},
    resume: {data: tailored.toString('base64'), name: NAME, type: 'application/pdf'}});
  try {
    const form = FORMS.greenhouse;
    const {page, fired, actual} = await fillForm(form, formHtml('greenhouse'), tailoredRun);
    try {
      assert.notEqual(tailored.length, general.length, 'the control: the tailored file is not the size of the general CV');
      assert.deepEqual([...cvProblems(actual, {name: NAME, size: tailored.length}), ...submitProblems(fired, form.path)], []);
    } finally { await page.close(); }
  } finally { await tailoredRun.close(); }
});

// Night journey J15 (Tier 2 since 1 Nov 2026, so no longer an e2e step), first half: the sign-up page before a form. The extension fills the person's details by meaning and leaves the username, the password
// and the "I'm not a robot" box to the person; it reports the account step ("stuck: account", which the session shows as the account step, with no form progress); and "Create account", pressed by the person,
// is not the application sent and nothing typed there is learned as an answer. The fixture is the one the e2e step used (lib/forms.mjs SIGNUP). The app side of the account step is desktop/test/account-*.test.js.
const ACCOUNT_KIND = {ok: true, by: 'ai', rung: 2, signal: 'confident', applyButton: '', applyRoute: '', applyBy: '', applyEmail: '', registerControl: '', signinControl: '', form_frame: -1, kind: 'account', role: 'account', confidence: 0.95,
  accountStep: 'sign_up', accountButton: 'Create account'};
const sentLines = (via, ...phrases) => phrases.filter(phrase => via.requests.some(request => request.route === '/extension/log' && request.body.includes(phrase)));
test('a sign-up page before the form: the account step is kept apart from the application form', TEST_CAP, async () => {
  const accountRun = await startRealExtension({offline: true, allowAllSites: true, answer: {'/extension/page-kind': () => ACCOUNT_KIND, '/extension/answer': () => ({ok: true, eligible: true, answers: []}),
    '/extension/site-password': () => ({ok: true, email: CONTACT.email, mode: 'sign-up', automation: 'assist', session: ''})}});
  try {
    const form = {title: SIGNUP.title, host: SIGNUP.accountHost, path: SIGNUP.accountPath};
    const {page, fired, actual, panel} = await fillForm(form, SIGNUP_PAGES.account(), accountRun);
    try {
      assert.equal(actual.signup_email.value, CONTACT.email, 'the person\'s e-mail, a detail by meaning, is not filled on the sign-up page');
      assert.deepEqual([actual.signup_username.value, actual.signup_password.value, actual.robot.checked], ['', '', false], 'the extension typed a username or password, or ticked the "not a robot" box (those are the person\'s)');
      assert.deepEqual(fired, [], 'the extension pressed something on the sign-up page (Create account is the person\'s)');
      assert.ok(['Username', 'Password', 'robot'].every(word => panel.left.some(item => item.includes(word))), `the panel does not list the account fields as left for the person: ${panel.left.join(' | ')}`);
      const stuck = accountRun.requests.filter(request => request.route === '/extension/event').map(request => JSON.parse(request.body)).filter(body => body.type === 'stuck');
      assert.deepEqual(stuck.map(body => [body.why, body.accountStep]), [['account', 'sign_up']], 'the account step was not reported to the app (the session shows it as the account step)');
      // The person creates the account: typed fields, the box ticked, Create account pressed.
      await page.fill('#signup_username', 'e2e-person');
      await page.fill('#signup_password', 'Fictional-Pass-1234');
      await page.check('#robot');
      await page.click('#create_account');
      const told = await waitForFill({capMs: 30000, pickTab: () => ({tab: page, tabs: 1}), readState: async () => sentLines(accountRun, 'account page: answers typed there are not learned', 'account page: a sign-in or sign-up press, not an application submit'), accept: lines => lines.length === 2});
      assert.ok(told.ok, `the extension's decisions lack ${told.state.length ? 'one of' : 'both of'} "answers typed there are not learned" / "a sign-in or sign-up press, not an application submit" (seen: ${told.state.join(' | ') || 'none'})`);
      assert.deepEqual(accountRun.requests.filter(request => request.route === '/extension/learned'), [], 'what was typed on the sign-up page was sent to be learned as an answer');
    } finally { await page.close(); }
  } finally { await accountRun.close(); }
});

// Night journey J15, second half: a menu whose choices are not the answer's words (Coop, 8 Oct 2026: "+41" asked, country names listed). The first form asks the app once for the choice that means the same
// ("Suisse"); once the app remembers it for the site (lib/menu-choices.js, served with the details), the next form there has it with no ask. Remembering itself is desktop/test/menu-choices.test.js.
const MENU_ANSWER = {ok: true, eligible: true, answers: [{field: 'country_code', value: '+41', confidence: 'high', note: '', category: 'other', use: 'fill'}, {field: 'question_3001', value: '6', confidence: 'high', note: '', category: 'other', use: 'fill'}]};
// The stand-in app plays what lib/menu-rearm.js does with the extension's report: the form reports the menu it could not answer with its choices (proposals), the app picks the one that means the same
// ONCE ("Suisse") and answers the next report with the arm command (commands: [{fill}]); the app half itself is integration/store/menu-choice.test.mjs.
async function menuFormAfterFill(fixture, menuChoices) {
  const picks = [];
  const menuRun = await startRealExtension({offline: true, allowAllSites: true, menuChoices, answer: {'/extension/page-kind': () => KIND, '/extension/answer': () => MENU_ANSWER,
    '/extension/review': body => {
      if (!body.includes('Suisse') || !body.includes('+41') || !body.includes('Indicatif de pays')) return {};
      picks.push(body.slice(0, 100));
      return picks.length === 1 ? {commands: [{fill: {label: 'Indicatif de pays', value: 'Suisse'}}]} : {};
    }}});
  try {
    const {page, fired} = await fillForm(fixture, MENU_PAGE(fixture), menuRun);
    try {
      const menu = await waitForFill({capMs: 45000, pickTab: () => ({tab: page, tabs: 1}), readState: async () => (await readForm(page)).country_code?.value, accept: value => value === 'Suisse'});
      return {value: menu.state, reported: picks.length, years: (await readForm(page)).question_3001?.value, submits: submitProblems(fired, fixture.path)};
    } finally { await page.close(); }
  } finally { await menuRun.close(); }
}
test('a menu whose choices are not the answer\'s words: the form reports the menu with its choices, and the choice the app picks is put in it', TEST_CAP, async () => {
  const first = await menuFormAfterFill(MENU_FIRST, []);
  assert.deepEqual([first.value, first.years, first.submits], ['Suisse', '6', []], `the "Indicatif de pays" is "${first.value}" after the form reported the menu ${first.reported} time(s)`);
  assert.ok(first.reported >= 1, 'the form never reported the menu and its choices to the app');
});
test('a menu choice the app remembers for the site is on the next form there at once, with nothing reported to ask about', TEST_CAP, async () => {
  const remembered = [{host: MENU_AGAIN.host, label: 'Indicatif de pays', value: '+41', choice: 'Suisse'}];
  const again = await menuFormAfterFill(MENU_AGAIN, remembered);
  assert.deepEqual([again.value, again.reported, again.years, again.submits], ['Suisse', 0, '6', []], `the next form has "${again.value}" and reported the menu ${again.reported} time(s): the remembered choice is tried first, so there is nothing to ask`);
});
