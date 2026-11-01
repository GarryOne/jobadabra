/* global document, window, location */
// The apply suite's journey steps (moved out of suites/apply.mjs, 8 Oct 2026): a form drawn late and the sign-in pages. The posting that opens a tab, side-by-side applications, "Needs your attention", the account and the application on one page, a closed form tab and a second browser moved to recorded pages and integration/app/session-*.test.js (R3, 1 Nov 2026). Guards the flows in docs/flows/applying.md.
// Job: run the backbone
import {LATE, SIGNIN, SIGNIN_PASSWORD, SIGNIN_REFUSED} from './forms.mjs';
import {CONTACT, pause} from './apply-fixtures.mjs';
import {pollSessions} from './app-log.mjs';
import {lostTabIn} from './tab-bound.mjs';
import {submitProblems} from './applycheck.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {fillNote, fillSettled, fillState, readForm} from './extension.mjs';
import {writePrivate} from '../../lib/private-file.js';
import {extensionDecisions, pollUntil, stepTimeLeft, waitCapNote, waitForDecisions, waitForFormValue, waitForStage} from './wait-on-state.mjs';
import {boxesOf, missedPressNote} from './account-press.mjs';

export async function runJourneys(ctx, h) {
  const {dumpExtension, fail, forms, page} = h;
  const tabsSeen = () => ctx.browser.context.pages().map(item => item.url().split('#')[0]);
  const arrived = async (read, what, lastSeen = tabsSeen) => {
    const {value, ms} = await pollUntil(read, Boolean, {capMs: stepTimeLeft()});
    if (!value) {
      const evidence = await lastSeen();
      await dumpExtension();
      throw new Error(waitCapNote(what, ms / 1000, evidence));
    }
    return value;
  };
  const filled = async (tab, pageKinds = []) => {
    const {value, ms} = await pollUntil(() => fillState(tab), state => fillSettled(state, {pageKinds}), {capMs: stepTimeLeft(), tickMs: 500});
    if (value?.state !== 'done') throw new Error(fillNote(value, ms / 1000, {pageKinds, lost: lostTabIn(ctx.profile)}));
    return value;
  };
  // A form drawn late (9 Oct 2026, SuccessFactors after a sign-in): judged while empty it reads as a posting whose "Apply" is the form's own submit span.
  // That is never pressed; once the fields come the page is looked at again (fill-flow.js watchForFields) and filled, with the panel on it.
  await ctx.run('a form drawn after a spinner: its submit is never pressed as Apply, and it is filled once its fields come', async () => {
    for (const item of ctx.browser.context.pages()) if ([LATE.url, LATE.formUrl].some(url => item.url().startsWith(url))) await item.close();
    await page.evaluate(([url, details]) => window.pilot.applyOne(url, details), [LATE.url, {title: LATE.title, company: LATE.company}]);
    const tab = await arrived(() => ctx.browser.context.pages().find(item => item.url().startsWith(LATE.formUrl)), 'the wait for the late form');
    await filled(tab);
    const problems = [...submitProblems(forms.fired, LATE.formPath)];
    {
      const read = (await readForm(tab)).question_3001, value = String(read?.value ?? read ?? '');
      if (value !== '5') problems.push(`Kubernetes years "${value}", the kit says 5`);
    }
    if (!(await tab.evaluate(() => !!document.getElementById('jobpilotto-review-host')).catch(() => false))) problems.push('no panel on the form once its fields came');
    if (problems.length) {
      await dumpExtension(); // Why (30 Oct 2026, applyflows 40992748380): app-only screenshots did not show whether the form appeared or the tab navigated away.
      const evidence = await tab.evaluate(() => ({url: location.href, ready: document.readyState, loading: !!document.getElementById('loading'), form: !!document.getElementById('application_form'), controls: [...document.querySelectorAll('input,textarea,select')].map(el => ({id: el.id, type: el.type, visible: !!el.getClientRects().length}))})).catch(error => ({error: error.message}));
      console.log(`late-form state: ${JSON.stringify(evidence)}`);
    }
    fail(problems);
  }, {safety: true, needs: ctx.needs});
  // Why (1 Nov 2026, owner: "Only tier 1 … should stay e2e"): 'a sign-up page before the form' (night journey J15, Tier 2) is an integration test: integration/extension/extension-form-shapes.test.mjs.
  // A sign-in page before the form where we have an account (8 Oct 2026: a saved site password + "email=" on its item = sign-in). The run's own password store
  // (never the Keychain: lib/keychain.js) holds the fixture host's test password with the applicant's email. The extension fills the email and the password, presses
  // "Sign in" once on the account AI's "ready", and the form behind it is filled from the kit; Settings → Credentials lists the host with the email. Then the same
  // page where the site refuses: pressed once, never again, and the person is told (Claude offered, never started).
  // Under the current profile's name (job-pilotto.profile-<id>.<host>.password, lib/credentials.js serviceOf, 16 Oct 2026): an item without the id is "unassigned" and never
  // filled, so the extension made a new password, took the register route and ended on a sign-up page with a box only a person ticks (beta 17 Oct 2026, 7-minute budget).
  const seedSitePassword = async host => {
    const file = path.join(ctx.profile, 'isolated-secrets.json');
    let items = {}; try { items = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch { /* the first item */ }
    let id = ''; try { id = JSON.parse(fs.readFileSync(path.join(ctx.profile, 'settings.json'), 'utf8')).profileId; } catch { /* no settings yet */ }   // lib/profile-accounts.js profileId: made at the app's start
    if (!/^profile-[0-9a-f]{12}$/.test(String(id || ''))) throw new Error('the app has no profile id in its settings: the seeded site password would be an unassigned one the fill never uses');
    items[`job-pilotto.${id}.${host}.password`] = {value: SIGNIN_PASSWORD, account: 'job-pilotto', comment: `email=${CONTACT.email}`, created: new Date().toISOString()};
    writePrivate(file, JSON.stringify(items, null, 2));
  };
  const openAccount = async fixture => {
    await seedSitePassword(fixture.accountHost);
    await page.evaluate(([url, details]) => window.pilot.applyOne(url, details), [fixture.url, {title: fixture.title, company: fixture.company}]);
    const tab = await arrived(() => ctx.browser.context.pages().find(item => item.url().startsWith(fixture.accountUrl)), 'the wait for the sign-in page');
    return tab;
  };
  const sessionOf = fixture => pollSessions(page, fixture.url, ctx.ARTIFACTS);
  const pressesOf = fixture => forms.signinPosts.filter(post => post.path === fixture.accountPath);
  await ctx.run('a sign-in page before the form: your email and saved password are filled, "Sign in" is pressed once, and the form behind it is filled', async () => {
    const tab = await openAccount(SIGNIN);
    const problems = [];
    const {ms: pressWaitMs, error: pressError} = await waitForStage(() => pressesOf(SIGNIN), list => list.length > 0);
    const presses = pressesOf(SIGNIN);
    // Ends the step here when the press never came: the wait spent the step's clock and the rest would be cut by the runner, losing this note.
    if (!presses.length) fail([missedPressNote({what: '"Sign in"', waitedMs: pressWaitMs, ...await boxesOf(tab, CONTACT.email), error: pressError, decisions: await extensionDecisions(ctx)})]);
    if (!presses[0].email || !presses[0].password) problems.push(`"Sign in" was pressed with the wrong ${!presses[0].email ? 'email' : 'password'} (the saved one for this site was not used)`);
    if (presses.length) {
      await arrived(() => tab.url().startsWith(SIGNIN.formUrl), 'the wait for the application after sign-in');
      await filled(tab);
      const {value, ms} = await waitForFormValue(async () => { const read = (await readForm(tab)).question_3001; return String(read?.value ?? read ?? ''); }, '4', {capMs: stepTimeLeft()});
      if (value !== '4') problems.push(`the form after signing in has Kubernetes years "${value}" after waiting ${ms} ms, its kit says 4`);
    }
    if (pressesOf(SIGNIN).length > 1) problems.push(`"Sign in" was pressed ${pressesOf(SIGNIN).length} times (once per tab is the floor)`);
    const {value: at} = await waitForStage(() => sessionOf(SIGNIN), value => value?.stage === 'form');
    if (at?.stage !== 'form') problems.push(`after signing in the session did not move to the form step (stage: ${at?.stage}, stuck: ${at?.stuck})`);
    // Why (9 Oct 2026; 30 Oct 2026, owner on #2612): read where the extension decides (its store), not app.log, which got them 14-62 s late (#2608).
    const {value: log} = await waitForDecisions(() => extensionDecisions(ctx), [/account button: pressed/, /account result: created/]);
    // Either path may fill the email first (beta 9 Oct 2026: the account step, 864b279, pressed ~1 s after the load, before the fill's line): the site's own
    // record above (`presses[0].email`) is the proof the right email arrived; this line only says which part of the extension did it.
    for (const [line, why] of [[/sign_in page: filled with your details|sign-in page: email filled/, 'the sign-in page was not filled with your details (neither the fill nor the account step says so)'], [/site password given for a sign-in page/, 'the app did not give the saved password as a sign-in'],
      [/account button: pressed/, 'no "account button: pressed" among the extension\'s decisions'], [/account result: created/, 'the account AI\'s word after the press ("created") is not in the extension\'s decisions']]) if (!line.test(log)) problems.push(why);
    const rows = await page.evaluate(() => window.pilot.credentials());
    const row = (rows?.rows || []).find(item => item.host === SIGNIN.accountHost);
    if (!row) problems.push(`Settings → Credentials does not list ${SIGNIN.accountHost} (${rows?.ok ? `${rows.rows.length} row(s)` : rows?.error})`);
    else if (row.email !== CONTACT.email) problems.push(`Settings → Credentials lists ${SIGNIN.accountHost} with email "${row.email}", expected the applicant's`);
    fail(problems);
  }, {needs: ctx.needs});

  await ctx.run('a sign-in page before the form that refuses the password: "Sign in" is pressed once, never again, and you are told; on the stuck sign-up page Take over with Claude only with Claude help on, never started', async () => {
    const tab = await openAccount(SIGNIN_REFUSED);
    const problems = [];
    const {ms: pressWaitMs, error: pressError} = await waitForStage(() => pressesOf(SIGNIN_REFUSED), list => list.length > 0);
    // Ends the step here when the press never came: the pauses and panel waits below have clocks of their own and would let the runner cut the step first.
    if (!pressesOf(SIGNIN_REFUSED).length) fail([missedPressNote({what: '"Sign in" on the refusing page', waitedMs: pressWaitMs, ...await boxesOf(tab, CONTACT.email), error: pressError, decisions: await extensionDecisions(ctx)})]);
    const {value: at, error: stuckError} = await waitForStage(() => sessionOf(SIGNIN_REFUSED), value => value?.stuck === 'account');
    // Ends the step here: the wait spent the step's clock, and the pauses and panel waits below have clocks of their own that would let the runner cut the step first (Gitar on #2778).
    if (at?.stuck !== 'account') fail([`the session does not say the account step needs you (stage: ${at?.stage}, stuck: ${at?.stuck}${stuckError ? `, last read error: ${stuckError}` : ''})`]);
    await pause(12000);   // several more looks of the extension (it looks every few seconds): a second press would show here
    const presses = pressesOf(SIGNIN_REFUSED).length;
    if (presses > 1) problems.push(`after the site refused, "Sign in" was pressed again (${presses} presses): a refused sign-in is never retried`);
    if (tab.url().startsWith(SIGNIN_REFUSED.formUrl)) problems.push('the refusing page somehow led to the form');
    const {value: log} = await waitForDecisions(() => extensionDecisions(ctx), [/account result: refused/]);
    if (!/account result: refused/.test(log)) problems.push('the account AI\'s "refused" is not in the extension\'s decisions');
    if (!/account page: the extension could not finish it/.test(log)) problems.push('the account step was not handed to the person after the refused sign-in');
    // The session is stuck on the sign-up page the refusal led to (a box only a person can tick): Claude is OFFERED there, never started (owner, 9 Oct 2026).
    // Read the open panel (extension/panel-claude.js). Readiness is masked by the takeover flag in the report (lib/claude-ready.js); no Claude session starts by itself.
    const panelTakeOver = async () => {
      await tab.waitForFunction(() => { const root = document.getElementById('jobpilotto-review-host')?.shadowRoot, card = root?.querySelector('.card'); if (card?.hidden) root.querySelector('.pill')?.click();
        return !!card && !card.hidden; }, null, {timeout: 45000, polling: 250}).catch(() => {});
      return tab.evaluate(() => { const root = document.getElementById('jobpilotto-review-host')?.shadowRoot, card = root?.querySelector('.card'), offer = root?.querySelector('.claude-offer');
        return {url: location.pathname, panel: !!card && !card.hidden, offered: !!card && !card.hidden && !!offer && !offer.hidden && [...offer.querySelectorAll('button')].some(button => /Let Claude finish this page/.test(button.textContent))}; }).catch(error => ({error: String(error.message).slice(0, 80)}));
    };
    const claudes = async () => (await page.evaluate(() => window.pilot.sessions())).filter(item => (item.kind || 'claude') === 'claude' && String(item.url || '').replace(/\/$/, '') === SIGNIN_REFUSED.url).length;
    const claudesBefore = await claudes();
    await page.evaluate(() => window.pilot.saveSettings({claudeReadyTest: 'off'}));   // this Mac may have Claude Code: the step says "not ready" itself
    await pause(6000);   // Clock kept (review.js keeps claudeAsk private; takeoverOffered masks readiness while takeover is off): no state is readable
    const off = await panelTakeOver();
    if (!off.panel) problems.push(`the stuck page has no panel to open (${JSON.stringify(off)}): Take over cannot be checked`);
    else if (off.offered) problems.push('Claude is not ready, yet the stuck page offers "Let Claude finish this page"');
    await page.evaluate(() => window.pilot.saveSettings({claudeReadyTest: 'on'}));
    let on = null;
    await pause(6000); on = await panelTakeOver();   // Clock kept (panel-claude.js renders the same report view for on/off while SHOW_RESUME_CLAUDE is false): no state is readable
    // An OpenAI engine (odd CI runs, lib/engine.mjs): Claude is never offered, whatever the switch (owner, 9 Oct 2026; the app's claudeHelp needs the Claude family).
    if (ctx.family === 'openai') { if (on?.offered) problems.push('an OpenAI engine is chosen, yet the panel offers "Let Claude finish this page"'); }
    else if (on?.offered) problems.push(`Claude's takeover is off, yet the stuck page offers "Let Claude finish this page" (${JSON.stringify(on)})`);
    if (await claudes() !== claudesBefore) problems.push('a Claude session started by itself: Claude is only ever offered, the person starts it');
    await page.evaluate(() => window.pilot.saveSettings({claudeReadyTest: null}));
    fail(problems);
  }, {needs: ctx.needs});

  // Why (1 Nov 2026, owner as above): 'a menu whose choices are not the answer's words' (J15, Tier 2) is two integration tests in the same file (the pick, the remembered choice); remembering is desktop/test/menu-choices.test.js.

}
