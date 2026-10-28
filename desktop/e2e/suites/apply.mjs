/* global document, window, chrome */
// Apply with the real Chrome extension on fixture forms: the app's Apply click opens a form, the extension fills it from the job's kit, leaves what is the
// person's to decide, and never submits. Starts from a set-up install; writes and removes only its own jobs in its Notion page. The forms are local
// (lib/forms.mjs, behind the real job-site host names), the AI answer is canned, so the suite costs nothing and no employer site is contacted.
import fs from 'node:fs';
import {parseShard} from '../lib/replay-shard.mjs';
import {stepSlicer} from '../lib/step-slices.mjs';
import path from 'node:path';
import {cvProblems, fillProblems, highlightProblems, leftProblems, notLeftProblems, submitProblems} from '../lib/applycheck.mjs';
import {CHAIN, FORMS, HOSTS, LATE, REAL_FORMS, SCRIPTED, SIGNIN, SIGNIN_REFUSED, SIGNUP, MENU_FIRST, MENU_AGAIN, PROPOSE, REVEAL, COLLAPSED, ONEPAGE, MISLABELLED, realFieldId} from '../lib/forms.mjs';
import {formTab, launchBrowser, readForm, readPanel, fillState} from '../lib/extension.mjs';
import {addKitJob, removeJobsByUrl, seedLivePosting, stageOf} from '../lib/seed-data.mjs';
import {ensureSetUp} from '../lib/seed.mjs';
import {appLogLines, appLogText} from '../lib/app-log.mjs';
import {livePosting, realKind, runLive} from '../lib/apply-live.mjs';
import {runCvSteps} from '../lib/apply-cv-steps.mjs';
import {proveBackground} from '../lib/background-proof.mjs';
import {proveAutomatic} from '../lib/background-auto-proof.mjs';
import {runJourneys} from '../lib/apply-journeys.mjs';
import {INSTRUCTIONS as KIND_RULES} from '../../lib/ladder/rung2-sketch.js';
import {BASE_CV, CONTACT, OPEN_ANSWER, POSTING, expectedOf, pause, tailoredFrom} from '../lib/apply-fixtures.mjs';

// Walks other data and timing on each seeded run (lib/forms.mjs varyForms): an exploring run on an unchanged commit includes it.
export const realAi = true;   // stubs some AI calls but passes the others to the real model (metered); a suite with all calls stubbed declares false (test/suite-ai-mode.test.mjs)
export const varies = true;
export const minutes = 20;   // the job's limit: a first attempt may use the suite's 7-minute budget and the retry ('once more, to tell flaky from real') another 7, plus setup (12 Oct 2026: 12 cancelled the retry)
export const shards = 2;   // the forms and CV steps split across two gate jobs (JP_REPLAY_SHARD, runApply below); the setup and the final checks run in both. 26 Oct 2026: one job
// took 6-6.5 min of its 7 and ran over on a slow attempt (beta 40155147300 too, 25 Oct): the same steps vary 2-4x between runners (real forms 46-122 s)
export const stepSharded = true;   // its slices are steps, not recorded cases (test/suite-shards.test.mjs)
// The split's weights: each step's seconds on a slow attempt (beta, 26 Oct 2026, Notion leg), a step's followers counted in it (multi-step + the session page,
// cannot operate + Ready to submit). A new forms or CV step is weighed here (test/step-slices.test.mjs).
export const stepSeconds = {'real forms the extension once failed on': 76, 'Tailor CVs for top matches': 51, 'a multi-step form': 37, 'a form with a control the extension cannot operate': 35,
  'Tailor CV on a job': 34, 'a Lever-like form': 33, 'Open in Chrome on a form the night filled': 29, 'Tailor on the session page of a form': 23, 'the person submits a form': 21,
  'a Greenhouse-like form': 16, 'Apply on a saved job without a kit': 15, 'a Workday-shaped form': 11, 'The hidden browser fills a form': 30, 'Full automation presses Submit once on its own': 60};
// applyflows' journeys, weighed the same way (26 Oct 2026, beta 40275152602 + main 40274183649, the slowest attempt of each): turn-taking put 392 s of them in one slice and 299 s in the other.
export const flowSeconds = {'the account and the application on one page': 97, 'a menu whose choices are not the answer': 79, '"Needs your attention" from the extension': 78, 'the form tab is closed': 76,
  'a second browser with the extension': 73, 'a posting whose Apply opens a new tab': 65, 'two applications side by side': 61, 'a sign-in page before the form that refuses': 38,
  'a sign-in page before the form:': 30, 'a form drawn after a spinner': 25, 'an upload slot that appears only when +': 23, 'the AI gave a page the wrong kind': 18, 'a sign-up page before the form': 15,
  'a form with collapsed sections': 13};
export const browser = true;
export const engine = 'api';   // the form's open question is answered by the AI proxy, which needs the API engine
export const macos = 'release';   // a release, a gate and the night run it on a macOS runner (the real Chrome extension, opened through `open` as on a Mac); a PR's run on Linux (lib/plan.mjs runnerOf)
// What a step needs from an earlier one when E2E_STEPS picks it (lib/runner.mjs wantedWords): every form step needs the applicant, the kits and the proxy's answers.
// Only the fixture's declared consent ids receive an explicit AI reading; unknown boxes and factual declarations stay unread.
function fixtureAnswers(fields) {
  const consent = new Set(Object.values(FORMS).flatMap(form => form.consent || []));
  return fields.flatMap(item => consent.has(item.field) && item.type === 'checkbox'
    ? [{field: item.field, category: 'consent', use: 'fill', value: 'checked', confidence: 'high'}]
    : item.field === 'why' ? [{field: item.field, value: OPEN_ANSWER, confidence: 'medium', note: 'inferred from the profile'}] : []);
}

const SETUP = 'the app has an applicant';
export const stepNeeds = {'form': [SETUP], 'session page says it too': [SETUP, 'multi-step form'], 'Tailor CV': [SETUP], 'tailored CV': [SETUP], 'without a kit': [SETUP],
  'hidden browser fills a form': [SETUP], 'submits a form': [SETUP], 'I submitted it': [SETUP, 'Apply opens a new tab'], 'Apply opens a new tab': [SETUP], 'side by side': [SETUP], 'sign-up page': [SETUP], 'sign-in page': [SETUP], 'menu whose choices': [SETUP], 'Needs your attention" from': [SETUP], 'appears only when + is pressed': [SETUP], 'one page': [SETUP], 'tab is closed': [SETUP], 'second browser': [SETUP], 'wrong kind': [SETUP], 'cannot operate': [SETUP],
  'Ready to submit': [SETUP, 'cannot operate']};   // it reads the tab the "cannot operate" step left open
// One failed step never hides the rest: the runner records it and goes on (lib/runner.mjs); only the setup step marked `critical` stops the suite. A step that needs another one is named in stepNeeds.
export const keepGoing = true;
export const name = 'apply';


// Parts of this file (6 Oct 2026, the 7-minute budget; the journeys split off on 8 Oct 2026): `apply` fills the forms and runs the tailored-CV and kitless-Apply
// steps (moved here 9 Oct 2026: with them applycv ran over 7 minutes); `applyflows` (suites/applyflows.mjs) runs the journeys across pages and tabs (docs/flows/applying.md:
// a posting that opens a new tab, two applications side by side, a sign-up before the form, account + form on one page, a closed tab, a wrong kind), which is how
// CI runs them within its 5 macOS jobs (test/apply-parts.test.mjs: each part in exactly one of them); `applyflows`
// (suites/applyflows.mjs, manual) runs only the journeys, so the local scenario matrix runs forms and journeys in parallel. Each has its own Notion page and token.
// The setup step and the final "Submit was never clicked" check run in all of them; each run seeds only the fixture jobs its steps use.
const CV_STEPS = ['Tailor CV on a job', 'the form\'s panel offers a tailored CV', 'Tailor CVs for top matches', 'Apply on a saved job without a kit'];
const FLOW_STEPS = ['a posting whose Apply opens a new tab', 'two applications side by side', 'a form drawn after a spinner', 'a sign-up page before the form', 'a sign-in page before the form', 'a menu whose choices', '"Needs your attention" from the extension', 'an upload slot that appears only when + is pressed', 'a form with collapsed sections', 'the account and the application on one page',
  'the form tab is closed', 'a second browser with the extension', 'the AI gave a page the wrong kind', '"I submitted it"'];
const SHARED_STEPS = ['the app is seeded', 'the app has an applicant', 'through all of it'];
const LIVE_STEPS = ['a real posting, watched live'];
export const partOf = name => (LIVE_STEPS.some(head => name.startsWith(head)) ? 'live' : SHARED_STEPS.some(head => name.startsWith(head)) ? 'both' : CV_STEPS.some(head => name.startsWith(head)) ? 'cv' : FLOW_STEPS.some(head => name.startsWith(head)) ? 'flows' : 'forms');

// Which steps of this file each suite runs (a PR that changes one runs that suite: desktop/e2e/pr-suites.mjs); applyflows runs the 'flows' part.
export const ownsStep = name => ['forms', 'cv', 'both'].includes(partOf(name));
export const run = ctx => runApply(ctx, ['forms', 'cv']);   // the CV steps use the form fixtures' jobs; with the journeys they put applycv over 7 minutes (beta 9 Oct 2026: 394 s of steps on Windows)
export async function runApply(ctx, parts) {
  const {page, proxy, forms} = ctx;
  ctx.findings = [];
  // A seeded run (E2E_SEED, lib/variation.mjs) fills forms with other data and other timing (lib/forms.mjs varyForms); the written seed replays it.
  fs.writeFileSync(path.join(ctx.ARTIFACTS, 'seed.json'), JSON.stringify({seed: ctx.vary.seed, fixed: ctx.vary.fixed, detail: forms.variation}));
  console.log(ctx.vary.fixed ? '  variation: fixed forms' : `  variation: seed ${ctx.vary.seed}; ${forms.variation}; replay with E2E_SEED=${ctx.vary.seed}`);
  await ensureSetUp(ctx);   // before the filter below: a new Notion page is built by the wizard's own steps
  const all = ctx.run;
  const live = parts.includes('live') ? livePosting() : null;   // the live run: one real posting, read from this Mac's job list; the fixture checks do not apply to it
  // A slice (the suite's `shards`, JP_REPLAY_SHARD=i/n): the shared steps run in every slice; the others split by weight, take turns, or follow a step they need (lib/step-slices.mjs).
  const takes = stepSlicer(live ? null : parseShard(process.env.JP_REPLAY_SHARD), {seconds: parts.includes('flows') ? flowSeconds : stepSeconds, needs: stepNeeds, setup: SETUP});
  ctx.run = (name, fn, options) => {
    if (!((partOf(name) === 'both' && !(live && name.startsWith('through all of it'))) || parts.includes(partOf(name)))) return undefined;
    if (partOf(name) !== 'both' && !takes(name)) return all(name, fn, {...options, elsewhere: true});   // the other slice runs it (a PR's picked step is found there)
    return all(name, fn, options);
  };
  // The jobs this part seeds: the journeys use their own fixtures, the forms and the CV steps the form fixtures.
  const fixtures = [...(live ? [live] : []), ...(parts.some(part => !['flows', 'live'].includes(part)) ? Object.values(FORMS) : []), ...(parts.includes('flows') ? [CHAIN, SCRIPTED, LATE, SIGNUP, SIGNIN, SIGNIN_REFUSED, MENU_FIRST, MENU_AGAIN, PROPOSE, REVEAL, COLLAPSED, ONEPAGE, MISLABELLED] : [])];
  const urls = fixtures.map(form => form.url);
  const cv = {name: 'cv.pdf', size: fs.statSync(path.join(ctx.profile, 'cv.pdf')).size};

  await ctx.run('the app has an applicant, jobs with drafted kits for every fixture form, and an AI that answers only what the kits do not', async () => {
    await page.evaluate(contact => window.pilot.saveContact(contact), live && process.env.LIVE_EMAIL ? {...CONTACT, email: process.env.LIVE_EMAIL} : CONTACT);   // LIVE_EMAIL: the live run signs up with the owner's own plus address
    console.log(`  removed ${await removeJobsByUrl(ctx, urls)} job row(s) left by an earlier run`);
    for (const form of fixtures) await (form === live ? seedLivePosting(ctx, live)   // the live posting as a real user's fresh one: no kit (lib/seed-data.mjs)
      : addKitJob(ctx, {title: form.title, company: form.company, url: form.url, kit: {answers: form.kit, cover_letter: '', check_before_sending: []}, description: POSTING}));
    // The app's own AI calls go to the test proxy: the one question no kit covers gets a fixed answer, everything else would pass through (and is counted).
    proxy.setCanned(body => {
      const content = body.messages?.[0]?.content;
      if (Array.isArray(content) && content.some(part => part.type === 'document')) return JSON.stringify(BASE_CV);   // the CV import (lib/cv.js)
      // The tailoring; HELD while a step holds it (ctx.tailorHold): the stand-in answers in milliseconds, faster than a step can look at the task running.
      if (typeof content === 'string' && content.startsWith('<cv>')) return Promise.resolve(ctx.tailorHold).then(() => JSON.stringify(tailoredFrom(JSON.parse(/<cv>\n([\s\S]*?)\n<\/cv>/.exec(content)[1]))));
      // The page after a Submit (lib/confirmation.js): the stand-in answers like a model that reads the words, so the suite proves the chain around it.
      const text = typeof content === 'string' ? content : (content || []).map(part => part.text || '').join('');
      if (/^URL path:/m.test(text) && /^Page:/m.test(text)) return JSON.stringify({confirmation: /successfully submitted|received your application/i.test(text) && !/must be completed|required/i.test(text)});
      // The menu choice that means the same (lib/option-pick.js: {question, answer, choices} -> {choice}): the stand-in knows what a model would, for the menu
      // fixture only ("+41" is Suisse); each ask is counted, so the remembered choice can be proven to need none (ctx.optionPicks).
      if (typeof content === 'string' && content.startsWith('{"question"')) {
        const ask = JSON.parse(content);
        ctx.optionPicks = [...(ctx.optionPicks || []), {question: ask.question, answer: ask.answer}];
        return JSON.stringify({choice: ask.answer === '+41' && ask.choices.includes('Suisse') ? 'Suisse' : ''});
      }
      // The account AI (lib/account-judge.js; its sketch also has "Address path:" and "Controls", so it is matched first). On the sign-in fixtures the stand-in reads the
      // page like a model: "ready" once no required box is empty, "refused" when the page says the password is wrong, else "created". Elsewhere it is unsure (nothing pressed).
      if (/^Phase: (ready|result)$/m.test(text)) {
        const phase = /^Phase: (\w+)$/m.exec(text)[1], where = (/^Address path: (.*)$/m.exec(text)?.[1] || '').replace(/\/$/, '');
        const ours = [SIGNIN, SIGNIN_REFUSED].some(fixture => [fixture.accountPath, fixture.formPath, `${fixture.accountPath}/new`].includes(where));   // /new: the sign-up page after a refusal
        const answer = !ours ? 'unsure' : phase === 'ready' ? (/· required · empty/.test(text) ? 'needs_person' : 'ready') : /password is wrong/i.test(text) ? 'refused' : 'created';
        return JSON.stringify({answer, needs: answer === 'refused' ? 'Sign in' : '', needs_kind: answer === 'refused' ? 'other' : '', bot_check: false, confidence: 0.9});
      }
      // What kind of page (lib/page-kind.js): the stand-in answers with each fixture's true kind, so every flow row runs on the AI's word, as in use.
      if (/^Address path:/m.test(text) && /^Controls/m.test(text)) {
        const system = typeof body?.system === 'string' ? body.system : (body?.system || []).map(part => part.text || '').join('');
        if (system === KIND_RULES) ctx.kindAsks = (ctx.kindAsks || 0) + 1;   // counted: the night's page kind is never asked (the Open in Chrome step); the "ready to submit?" judge shares this sketch and still runs
        const where = /^Address path: (.*)$/m.exec(text)?.[1] || '';
        const kinds = {[CHAIN.path]: 'posting', [CHAIN.stepPath]: 'posting', [CHAIN.formPath]: 'form', [SCRIPTED.path]: 'posting', [SCRIPTED.formPath]: 'form', [LATE.path]: 'posting',
          [SIGNUP.path]: 'posting', [SIGNUP.accountPath]: 'account', [SIGNUP.formPath]: 'form', [ONEPAGE.path]: 'account-form',
          [MISLABELLED.path]: 'posting', [SIGNIN.path]: 'posting', [SIGNIN.formPath]: 'form', [SIGNIN_REFUSED.path]: 'posting'};   // MISLABELLED: deliberately wrong, the self-correction row
        if (live) return realKind(body);   // a real site: a real model answers (this Mac's Claude Code, lib/model.mjs), the way the app's own AI would
        // LATE: as the live AI did on SuccessFactors, an empty page still loading reads as a posting whose Apply is its "Postuler" (the form's own submit).
        if (where.replace(/\/$/, '') === LATE.formPath) return JSON.stringify(/Years of experience/.test(text) ? {kind: 'form', confidence: 0.95} : {kind: 'posting', confidence: 0.85, apply_button: 'Postuler'});
        if ([SIGNIN.accountPath, SIGNIN_REFUSED.accountPath].includes(where.replace(/\/$/, ''))) return JSON.stringify({kind: 'account', confidence: 0.95, apply_button: '', account_step: 'sign_in', register_control: 'Create an account', signin_control: '', account_button: 'Sign in'});
        if (where.replace(/\/$/, '') === `${SIGNIN_REFUSED.accountPath}/new`) return JSON.stringify({kind: 'account', confidence: 0.95, apply_button: '', account_step: 'sign_up', register_control: '', signin_control: '', account_button: 'Create account'});   // the sign-up page after the refusal
        return JSON.stringify({kind: kinds[where.replace(/\/$/, '')] || 'form', confidence: 0.95});
      }
      const asked = /<form_fields>\n([\s\S]*?)\n<\/form_fields>/.exec(typeof content === 'string' ? content : (content || []).map(part => part.text || '').join(''));
      if (!asked) return null;
      ctx.answerAsks = [...(ctx.answerAsks || []), ...JSON.parse(asked[1]).map(item => item.field)];   // counted: a question the night answered is never asked
      const answers = fixtureAnswers(JSON.parse(asked[1]));
      return JSON.stringify({eligible: true, eligibility_note: '', answers});
    });
    await page.reload();
    await page.waitForSelector('.view:not([hidden])', {timeout: 60000});
    await page.click('.nav[data-view="jobs"]');
    // Every fixture job with its kit; the live posting is a fresh job with none (lib/seed-data.mjs seedLivePosting): listed is enough.
    await page.waitForFunction(([wanted, liveUrl]) => wanted.every(url => (window.__jp.shared.allJobs || []).some(job => job.url === url && (job.kit || url === liveUrl))), [urls, live?.url || ''], {timeout: 120000, polling: 2000})
      .catch(async () => {
        const seen = await page.evaluate(() => (window.__jp.shared.allJobs || []).map(job => `${job.company} [${job.stage}${job.kit ? ', kit' : ''}]`));
        throw new Error(`the Jobs list never showed every kit job with an Apply button; it holds ${seen.length}: ${seen.join('; ')}`);
      });
    ctx.browser = await launchBrowser({port: forms.port, spool: ctx.shim.spool, extensionDir: ctx.extensionDir, real: !!live});
    await ctx.browser.serviceWorker();
  }, {needs: ctx.needs, critical: true});   // the setup: every later step needs it, so only this one stops the suite

  // What the extension itself holds: which tabs it armed, whose job each follows, who opened whom and when its worker booted (a cause is in here, not in the page).
  async function dumpExtension() {
    const inside = await (await ctx.browser.serviceWorker()).evaluate(async () => ({session: await chrome.storage.session.get(null),
      tabs: (await chrome.tabs.query({})).map(item => ({id: item.id, status: item.status, opener: item.openerTabId ?? null, url: String(item.url).split('#')[0].slice(0, 70)}))})).catch(error => ({error: String(error)}));
    console.log(`  extension state at the failure: ${JSON.stringify(inside)}`);
  }
  // The person's click on a job's Apply button; the form opens in the browser with the extension, which fills it by itself. -> the tab, once the fill is over.
  async function apply(form, {viaApi = false} = {}) {
    const opened = ctx.browser.opened.length;
    // A job whose form tab is still open keeps it (22 Oct 2026, 0e359e1): the app has that tab reload and fill again instead of opening a second one, so a reload of an open tab counts as the open.
    const reloaded = [];
    for (const open of ctx.browser.context.pages()) open.once('load', () => reloaded.push(open));
    await page.click('.nav[data-view="jobs"]');
    // viaApi: the same call the button makes ("Fill in Chrome" in the ⋯ menu), for a job whose button now says "View session".
    if (viaApi) await page.evaluate(job => window.pilot.applyOne(job.url, {title: job.title, company: job.company, location: 'Zurich, Switzerland', workMode: ''}), form);
    else await page.locator('article.job-row').filter({hasText: form.company}).first().locator('.row-main').click();
    const deadline = Date.now() + 30000;
    while (ctx.browser.opened.length === opened && !reloaded.length && Date.now() < deadline) await pause(250);
    if (ctx.browser.opened.length === opened && !reloaded.length) throw new Error(`Apply did not open ${form.title} in the browser (the app's open command was never called, and no open tab reloaded)`);
    let tab = reloaded[0];
    if (ctx.browser.opened.length !== opened) {
      const url = ctx.browser.opened.at(-1);
      if (!/#jobpilotto-fill=[A-Za-z0-9_-]+$/.test(url)) throw new Error(`Apply opened ${url} without the fill marker that names its session (every tab the app opens carries one: lib/session-tab.js)`);
      tab = formTab(ctx.browser, url);
    }
    const openedUrl = ctx.browser.opened.length !== opened ? ctx.browser.opened.at(-1) : '';
    for (let waited = 0; waited < 90000; waited += 500) {
      if (openedUrl) tab = formTab(ctx.browser, openedUrl);   // the tab that shows the form now (lib/extension.mjs formTab)
      const state = await fillState(tab).catch(() => null);
      if (state?.state === 'done' || state?.state === 'error') return {tab, state};
      await pause(500);
    }
    await dumpExtension();
    throw new Error(`the extension never finished filling ${form.title} (state: ${JSON.stringify(await fillState(tab))}, read on ${tab.url().split('#')[0].slice(0, 100)}, ${ctx.browser.context.pages().length} tab(s))`);   // the address read and the tab count: a null from the wrong tab (26 Oct) and from the right one (28 Oct) look alike
  }
  // The panel opens by itself while a fill runs; open it only when it is closed (a click on the pill toggles).
  const panelOf = async tab => {
    const closed = await tab.evaluate(() => document.getElementById('jobpilotto-review-host')?.shadowRoot?.querySelector('.card')?.hidden);
    if (closed) await tab.locator('#jobpilotto-review-host .pill').click({timeout: 15000});
    await pause(1500);
    return readPanel(tab);
  };
  let unknownTab = null;
  const fail = problems => { if (problems.length) throw new Error(problems.join('; ')); };

  await ctx.run('a Greenhouse-like form: every kit answer and your details are filled, the CV is attached, the legal box is left, Submit untouched', async () => {
    const form = FORMS.greenhouse;
    const {tab, state} = await apply(form);
    if (state.state === 'error') throw new Error(`the fill ended in an error: ${state.error}`);
    const actual = await readForm(tab);
    fail([...fillProblems({expected: {...expectedOf(form), first_name: CONTACT.first_name, last_name: CONTACT.last_name, email: CONTACT.email, phone: CONTACT.phone}, left: form.legal, actual}),
      ...cvProblems(actual, cv),
      // A long drafted answer is flagged for a read-through; a short fact or your own details are not.
      ...highlightProblems({actual, ai: ['question_1004'], plain: ['question_1001', 'question_1003', 'first_name', 'email']}),
      ...submitProblems(forms.fired, form.path)]);
    const panel = await panelOf(tab);
    if (!panel) throw new Error('no Jobadabra panel on the form');
    console.log(`  panel: "${panel.progress}"; left for you: ${panel.left.join(' | ') || 'nothing'}`);
    fail([...leftProblems(panel.left, []), ...notLeftProblems(panel.left, form.consentWords)]);   // the consent box is ticked, not left
  }, {needs: ctx.needs});

  await ctx.run('a Workday-shaped form: answers fill fields known only by opaque ids and aria labels, the list-button question is left for you by name, Submit untouched', async () => {
    const form = FORMS.workday;
    const {tab, state} = await apply(form);
    if (state.state === 'error') throw new Error(`the fill ended in an error: ${state.error}`);
    const actual = await readForm(tab);
    fail([...fillProblems({expected: {...expectedOf(form), 'input-2': CONTACT.first_name, 'input-3': CONTACT.last_name, 'input-4': CONTACT.email}, actual}),
      ...submitProblems(forms.fired, form.path)]);
    const panel = await panelOf(tab);
    if (!panel) throw new Error('no Jobadabra panel on the form');
    console.log(`  workday panel: "${panel.progress}"; left for you: ${panel.left.join(' | ') || 'nothing'}`);
    fail(leftProblems(panel.left, ['hear about us']));
  }, {needs: ctx.needs});

  // Forms the extension failed on for a real person (fixtures/real-forms, tools/fixture-from-fills.py): your details filled, every required field it cannot
  // fill listed as left for you by its label, Submit untouched. None yet: the step says so and passes.
  await ctx.run('real forms the extension once failed on: your details are filled, and every field it failed on is now filled or listed for you by name', async () => {
    if (!REAL_FORMS.length) { console.log('  no real forms yet (tools/fixture-from-fills.py writes them from the fill log)'); return; }
    const problems = [];
    for (const spec of REAL_FORMS) {
      const form = FORMS[`real-${spec.id}`];
      const {tab, state} = await apply(form);
      if (state.state === 'error') { problems.push(`${spec.id}: the fill ended in an error: ${state.error}`); continue; }
      const actual = await readForm(tab);
      problems.push(...fillProblems({expected: {first_name: CONTACT.first_name, last_name: CONTACT.last_name, email: CONTACT.email}, actual}).map(text => `${spec.id}: ${text}`));
      problems.push(...submitProblems(forms.fired, form.path).map(text => `${spec.id}: ${text}`));
      const panel = await panelOf(tab);
      if (!panel) { problems.push(`${spec.id}: no Jobadabra panel on the form`); continue; }
      // Each field it failed on for a real person is now either filled, or listed for the person by name: never skipped in silence.
      const listed = label => panel.left.some(item => item.toLowerCase().includes(String(label).split(/\s+/).slice(0, 3).join(' ').toLowerCase()));
      for (const [i, item] of spec.fields.entries()) {
        if (item.required === false) continue;
        const value = actual[realFieldId(item.label, i)];
        const filled = value && (value.checked || (value.value && !/^select/i.test(value.value)));
        if (!filled && !listed(item.label)) problems.push(`${spec.id}: "${String(item.label).slice(0, 60)}" was neither filled nor listed as left for the person (it lists: ${panel.left.join(' | ') || 'nothing'})`);
      }
    }
    fail(problems);
  }, {needs: ctx.needs});

  await ctx.run('a Lever-like form: a field rendered late is filled, the question no kit covers is answered by the AI and highlighted', async () => {
    const form = FORMS.lever;
    const callsBefore = proxy.stats.canned;
    const {tab, state} = await apply(form);
    if (state.state === 'error') throw new Error(`the fill ended in an error: ${state.error}`);
    const actual = await readForm(tab);
    fail([...fillProblems({expected: {...expectedOf(form), name: CONTACT.full_name, email: CONTACT.email, why: OPEN_ANSWER}, actual}), ...cvProblems(actual, cv),
      ...highlightProblems({actual, ai: ['why'], plain: ['org', 'heard', 'email']}), ...submitProblems(forms.fired, form.path)]);
    if (proxy.stats.canned - callsBefore < 1) throw new Error('the AI was never asked about the open question');
  }, {needs: ctx.needs});

  // Ready to send's Open in Chrome (owner, 18 Oct 2026: "It should be all cached... instant"): the night's hand-off carries its page kind and AI answers; the app
  // answers from them (lib/ready-handoff.js), so the extension fills with no page-kind ask and no question asked, and the panel says the fill is last night's.
  await ctx.run('Open in Chrome on a form the night filled: the night\'s answer is typed, no page kind or question goes to the AI, and the panel says "Last night\'s fill is back"', async () => {
    const form = FORMS.lever, night = 'From last night: your platform team runs what I have built for six years.';
    const formUrl = `https://${form.host}${form.formPath}`;
    await ctx.app.evaluate((_, given) => globalThis.__jpReadyHandoffs.keep(given, [given.posting]), {url: formUrl, posting: form.url, storage: {cookies: [], origins: []}, sessionStorage: {},
      snapshot: {fields: [], files: []}, night: {role: 'form', answers: [{field: form.open.field, label: form.open.question, answer: {field: form.open.field, value: night, confidence: 'medium', note: ''}}]}});
    const kinds = ctx.kindAsks || 0, answered = (ctx.answerAsks || []).length;
    try {
      const {tab, state} = await apply(form, {viaApi: true});
      if (state.state === 'error') throw new Error(`the fill ended in an error: ${state.error}`);
      const actual = await readForm(tab);
      const problems = [];
      if (actual[form.open.field]?.value !== night) problems.push(`the open question holds "${String(actual[form.open.field]?.value || '').slice(0, 60)}", not the night's answer`);
      if ((ctx.kindAsks || 0) !== kinds) problems.push(`the page kind went to the AI ${(ctx.kindAsks || 0) - kinds} time(s): the night's kind was not used`);
      const asked = (ctx.answerAsks || []).slice(answered);
      if (asked.includes(form.open.field)) problems.push('the question the night answered went to the AI');
      let said = '';
      for (let waited = 0; waited < 10000 && !/Last night.s fill is back/.test(said); waited += 500) {   // the panel redraws on its own beat after the fill
        said = await tab.evaluate(() => document.getElementById('jobpilotto-review-host')?.shadowRoot?.querySelector('.pill small')?.textContent || '');
        if (!/Last night.s fill is back/.test(said)) await pause(500);
      }
      if (!/Last night.s fill is back/.test(said)) problems.push(`the panel says "${said}", not "Last night's fill is back"`);
      fail([...problems, ...submitProblems(forms.fired, form.path)]);
      console.log(`  night's answer typed; page-kind asks ${(ctx.kindAsks || 0) - kinds}; questions asked: ${asked.join(', ') || 'none'}; panel: "${said}"`);
    } finally { await ctx.app.evaluate(() => globalThis.__jpReadyHandoffs.clear()); }   // the later steps fill this form as any other
  }, {needs: ctx.needs});

  await ctx.run('a multi-step form: step 1 is filled, step 2 only once you reach it, the consent is left to you, Submit untouched', async () => {
    const form = FORMS.multistep;
    const {tab, state} = await apply(form);
    if (state.state === 'error') throw new Error(`the fill ended in an error: ${state.error}`);
    let actual = await readForm(tab);
    fail([...fillProblems({expected: {first_name: CONTACT.first_name, last_name: CONTACT.last_name, email: CONTACT.email}, actual}), ...cvProblems(actual, cv),
      ...(actual.salary.value ? ['salary: the step the person has not reached was filled'] : [])]);
    await tab.click('#next_step');   // the person goes on to step 2 (never Submit)
    const panel = await panelOf(tab);
    if (!panel) throw new Error('no Jobadabra panel on the form');
    await tab.locator('#jobpilotto-review-host .fill').click({timeout: 15000});
    await tab.waitForFunction(() => document.getElementById('salary')?.value, null, {timeout: 60000}).catch(() => { throw new Error('"Fill again" did not fill step 2 (salary stayed empty)'); });
    // The consent boxes are ticked at the end of the fill, after the answers: the salary showing is not the end of it.
    await tab.waitForFunction(ids => ids.every(id => document.getElementById(id)?.checked), form.consent, {timeout: 15000}).catch(() => {});
    actual = await readForm(tab);
    fail([...fillProblems({expected: expectedOf(form), left: form.legal, actual}), ...submitProblems(forms.fired, form.path)]);
    let left = await readPanel(tab);
    // The panel's list is redrawn when the fill ends, a moment after the box is ticked.
    for (let waited = 0; waited < 15000 && left.left.some(item => form.consentWords.some(word => item.toLowerCase().includes(word))); waited += 500) { await tab.waitForTimeout(500); left = await readPanel(tab); }
    fail([...leftProblems(left.left, ['sponsorship']), ...notLeftProblems(left.left, form.consentWords)]);   // the knockout question stays the person's; the consent box is ticked
    // The question a hiring system can be set to reject on comes first, with its warning, and any tip the panel shows carries one of the labels that say how strong it is.
    if (!/sponsorship/i.test(left.left[0] || '')) throw new Error(`the knockout question is not first in "Left for you" (the list: ${left.left.join(' | ')})`);
    if (!/reject an application automatically|knockout rule/i.test(left.knock)) throw new Error(`no knockout warning above the list (it says: "${left.knock}")`);
    // The tip line is off for now (SHOW_TIPS=false in extension/review.js, owner 15 Oct 2026): a tip is not required, but one that shows still carries a label that says how strong it is.
    if (left.tip && (!['Fact', 'Recruiters say', 'Worth trying', 'Tip'].includes(left.tip.chip) || left.tip.text.length < 20)) throw new Error(`the panel shows a tip without a valid label (${JSON.stringify(left.tip)})`);
  }, {needs: ctx.needs});

  await ctx.run('the session page says it too: "Before you submit" counts the knockout question that is still the person\'s, and says which CV goes in', async () => {
    const form = FORMS.multistep;
    // The session this form belongs to. The job row's button says "View session" only on a Mac with Claude Code installed (claudeReady, jobs.js); here it is the fill
    // button ("Opened ↻"), and clicking it fills the form again and stays on the Jobs list (apply run 37134779221). A session card in the dock opens the same page for everyone,
    // and the Sessions page lists them all when the dock (three cards at most) does not show this one.
    const card = page.locator('#sd-cards .sd-card').filter({hasText: form.company}).first();
    if (await card.count()) {
      if (!await card.isVisible() && await page.locator('#sd-toggle').isVisible()) await page.click('#sd-toggle');   // the dock starts collapsed: its cards are in the page but hidden (apply run 37135786161)
      await card.click();
    }
    else {
      await page.click('.nav[data-view="sessions"]');
      await page.locator('.view[data-view="sessions"]').getByText(form.company).first().click({timeout: 15000}).catch(() => { throw new Error(`no session for ${form.company} on the Sessions page or in the dock`); });
    }
    const strip = page.locator('#ss-before');
    await strip.waitFor({state: 'visible', timeout: 30000}).catch(async () => {
      throw new Error(`the session page shows no "Before you submit" strip (the form card says: "${await page.locator('#ss-form-card').innerText().catch(() => 'not shown')}")`);
    });
    // This session's strip, not the one shown before (6 Oct 2026: the row named the Greenhouse form's work-permit question, read the moment the strip appeared).
    let knock = '';
    for (const started = Date.now(); Date.now() - started < 15000; await page.waitForTimeout(500)) {
      knock = (await page.locator('#ss-before-knock').innerText()).replace(/\s+/g, ' ');
      if (/sponsorship/i.test(knock)) break;
    }
    if (!/1 question can reject you automatically/i.test(knock) || !/sponsorship/i.test(knock)) {
      const shown = (await page.locator('.view[data-view="session"] h1, #ss-title, #ss-form-card').first().innerText().catch(() => '?')).replace(/\s+/g, ' ').slice(0, 120);
      throw new Error(`the knockout row does not count and name the sponsorship question after 15 s: "${knock}" (the page shows: "${shown}", expected ${form.company})`);
    }
    await page.locator('#ss-before-cv').waitFor({state: 'visible', timeout: 15000});
    const cvRow = (await page.locator('#ss-before-cv').innerText()).replace(/\s+/g, ' ');
    if (!/general CV|tailored/i.test(cvRow)) throw new Error(`the CV row says neither which CV goes in nor that one is tailored: "${cvRow}"`);
  }, {needs: ctx.needs});

  await ctx.run('a form with a control the extension cannot operate: the miss is reported to the app', async () => {
    const form = FORMS.unknown;
    const {tab, state} = await apply(form);
    if (state.state === 'error') throw new Error(`the fill ended in an error: ${state.error}`);
    const actual = await readForm(tab);
    fail([...fillProblems({expected: {...expectedOf(form), first_name: CONTACT.first_name, email: CONTACT.email}, actual}), ...submitProblems(forms.fired, form.path)]);
    // Reported to the app: it keeps the control's shape in misses.json and says so in its log.
    const file = path.join(ctx.profile, 'misses.json');
    let kept = [];
    for (let waited = 0; waited < 30000 && !kept.some(entry => entry.kind === 'slider'); waited += 1000) {
      kept = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
      await pause(1000);
    }
    if (!kept.some(entry => entry.kind === 'slider')) throw new Error('the app was never told about the slider (no "slider" entry in misses.json)');
    const log = appLogText(ctx.profile);
    if (!/\[misses\] \d+ new control/.test(log)) throw new Error('the app kept the miss but did not log it');
    unknownTab = tab;
  }, {needs: ctx.needs});

  await runLive(ctx, {page, posting: live});   // lib/apply-live.mjs (only when parts has 'live')
  await runJourneys(ctx, {cv, dumpExtension, fail, forms, page});   // lib/apply-journeys.mjs

  const sessionsOf = url => page.evaluate(target => window.pilot.sessions().then(list => list.filter(item => String(item.url || '').replace(/\/$/, '') === target.replace(/\/$/, '')).map(item => `${item.kind}:${item.id}`)), url);
  const logTail = () => { try { return appLogLines(ctx.profile).filter(line => /\[extension\]|\[applied\]/.test(line)).slice(-6).map(line => line.slice(0, 220)).join('\n    '); } catch { return '(no log)'; } };
  async function until(what, check, ms = 60000) {
    for (let waited = 0; waited < ms; waited += 1000) { if (await check()) return; await pause(1000); }
    throw new Error(`${what}. The app's last extension lines:\n    ${logTail()}`);
  }

  // Found by the owner on a real form (OK Job, 3 Oct 2026): the person submitted, the page said "successfully submitted", and the app stayed on "Ready to submit".
  // The test is the person here: it presses Submit. The extension must see the press and the page change, send that page to the AI (answered by the proxy), and
  // the app must mark the job Applied in Notion and take its session off the list. Nothing but the person's click ever submits.
  await ctx.run('the person submits a form: the page after Submit is read, the job becomes Applied, its session leaves the list', async () => {
    const form = FORMS.submitter;
    const {tab, state} = await apply(form);
    if (state.state === 'error') throw new Error(`the fill ended in an error: ${state.error}`);
    fail(fillProblems({expected: {first_name: CONTACT.first_name, last_name: CONTACT.last_name, email: CONTACT.email, question_4001: '9'}, actual: await readForm(tab)}));
    if (!(await sessionsOf(form.url)).length) throw new Error('the Apply click left no session for this job (nothing to take off the list)');
    if ((await stageOf(ctx, form.url)) === 'Applied') throw new Error('the job was Applied before anyone submitted');
    const asked = proxy.stats.canned;
    await tab.click('#submit_app');   // the person's click
    await until('the job never became Applied after the person submitted', async () => (await stageOf(ctx, form.url)) === 'Applied', 90000);
    if (forms.posts.length !== 1) throw new Error(`expected the person's one Submit, the server saw ${forms.posts.length}`);
    if (proxy.stats.canned - asked < 1) throw new Error('the page after Submit was never sent to the AI');
    await until('the job is Applied but its session is still on the list', async () => !(await sessionsOf(form.url)).length, 30000);
  }, {needs: ctx.needs});

  // "I submitted it" (the session card's button; the app missed the submit): the job becomes Applied AND its sessions end, not only the Notion row (3 Oct 2026).
  await ctx.run('"I submitted it" marks the job Applied and takes its session off the list', async () => {
    if (!(await sessionsOf(CHAIN.url)).length) throw new Error('the journey left no session for this job (nothing to take off the list)');
    const result = await page.evaluate(url => window.pilot.setStatus(url, 'applied'), CHAIN.url);
    if (!result?.ok) throw new Error(`the app refused: ${result?.error}`);
    await until('"I submitted it" left the job\'s session on the list', async () => !(await sessionsOf(CHAIN.url)).length, 30000);
    if ((await stageOf(ctx, CHAIN.url)) !== 'Applied') throw new Error('the Notion row is not Applied');
  }, {needs: ctx.needs});

  await runCvSteps(ctx, {apply, cv, fail, page, panelOf, proxy});   // lib/apply-cv-steps.mjs

  await ctx.run('through all of it: Submit was never clicked or submitted, and no host but the fixture job sites was contacted', async () => {
    fail(submitProblems(forms.fired, ''));
    const strange = [...ctx.browser.requested].filter(host => !HOSTS.includes(host) && host !== '127.0.0.1' && host !== 'localhost' && host !== '');
    if (strange.length) throw new Error(`the browser asked for hosts outside the fixtures: ${strange.join(', ')}`);
    await removeJobsByUrl(ctx, urls);
  }, {needs: ctx.needs});

  // Background automation (spec 2026-10-27-background-apply-execution, step B): the app's own hidden browser fills the form, the person's Submit in the live view posts it once.
  // After "through all of it" because it is the one place a Submit is allowed after the person's own (submitProblems above), and it seeds its own job.
  await ctx.run('The hidden browser fills a form, the person\'s Submit in the live view posts it once and the job becomes Applied', async () => {
    const form = FORMS.submitter;
    await proveBackground(ctx, {form, until, seed: async () => { await removeJobsByUrl(ctx, urls);   // only the submitter is left, so the one job Start picks is the one this step watches
       await addKitJob(ctx, {title: form.title, company: form.company, url: form.url, kit: {answers: form.kit, cover_letter: '', check_before_sending: []}, description: POSTING}); }});
  }, {needs: [...ctx.needs, {name: 'a runtime link for the hidden browser (none on Windows)', value: process.platform !== 'win32'}]});   // Why (2026-10-28, Gitar on #2364): a plain return on Windows was counted as passed; a missing need is recorded as skipped (lib/runner.mjs)

  // Full automation (spec step C): the app presses Submit itself once, against the fixture server's fake endpoint; a Stop in the wait presses nothing. Last of the hidden-browser steps: it relaunches the app with the test-only switch.
  await ctx.run('Full automation presses Submit once on its own, and a Stop in the wait presses nothing', async () => {
    // Why (2026-10-28, found by this step): a kit answer is never a saved fact (extension/flow.js `source: 'kit'`), so Full automation hands over any form with a kit question; this proof uses the submitter's details-only variant.
    const form = {...FORMS.submitter, path: FORMS.submitter.autoPath, url: `https://${FORMS.submitter.host}${FORMS.submitter.autoPath}`, kit: []};
    await proveAutomatic(ctx, {form, until, seed: async job => { await removeJobsByUrl(ctx, urls);
       await addKitJob(ctx, {title: job.title, company: job.company, url: job.url, kit: {answers: [], cover_letter: '', check_before_sending: [], eligible: true}, description: POSTING}); }});
  }, {needs: [...ctx.needs, {name: 'a runtime link for the hidden browser (none on Windows)', value: process.platform !== 'win32'}]});

  // Found by this suite (2 Oct 2026): extension/review.js built the panel's list from native fields only, so a REQUIRED custom widget it cannot read (here a
  // role=slider) was in no list and no count, and the panel said "Ready to submit, every required field is filled" over a form that still needed an answer.
  // The miss was reported to the app but not shown to the person. Fixed in review.js; this step keeps it fixed (worker/test/panel-widgets.test.js is the unit test).
  await ctx.run('the panel does not say "Ready to submit" over a required control it could not fill, and lists the question', async () => {
    const panel = await panelOf(unknownTab);
    console.log(`  panel: "${panel?.progress}"; left for you: ${panel?.left.join(' | ') || 'nothing'}; pill: "${panel?.pill}"`);
    if (/ready to submit/i.test(`${panel?.pill} ${panel?.progress}`)) throw new Error('the panel says "Ready to submit" while the required "How would you rate your Terraform skill?" control is unanswered');
    fail(leftProblems(panel?.left || [], ['Terraform skill']));
  }, {needs: ctx.needs});
}
