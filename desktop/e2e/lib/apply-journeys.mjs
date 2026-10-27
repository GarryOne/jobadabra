/* global document, window, location */
// The apply suite's journey steps (moved out of suites/apply.mjs, 8 Oct 2026): a posting that opens a tab, side-by-side applications, sign-up, one page, a closed form tab, a wrong page kind. Guards the flows in docs/flows/applying.md.
import {CHAIN, LATE, MENU_AGAIN, MENU_CHOICES, MENU_FIRST, MISLABELLED, NOTICE_CHOICES, ONEPAGE, PROPOSE, REVEAL, COLLAPSED, SCRIPTED, SIGNIN, SIGNIN_PASSWORD, SIGNIN_REFUSED, SIGNUP} from './forms.mjs';
import {CONTACT, pause} from './apply-fixtures.mjs';
import {appLogText, rearmedSessions} from './app-log.mjs';
import {cvProblems, fillProblems, submitProblems} from './applycheck.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fillNote, fillState, launchBrowser, readForm} from './extension.mjs';
import {writePrivate} from '../../lib/private-file.js';
import {pressed, ticked} from './free-click.mjs';

export async function runJourneys(ctx, h) {
  const {cv, dumpExtension, fail, forms, page} = h;
  // Found by asking "can the extension follow a journey from one tab to another?" (3 Oct 2026): a posting whose Apply opens a NEW tab (since 8 Oct 2026
  // loaded in the posting's own tab instead, extension/same-tab.js), whose page has only a
  // "To apply" link, and only then the form (jobs.ch -> an agency's own site). The extension must press Apply, follow the new tab as the same application, press
  // "To apply" in it, and fill the form it reaches; Submit untouched.
  await ctx.run('a posting whose Apply opens a new tab, then a "To apply" step, then the form: the journey is followed and the form filled', async () => {
    const opened = ctx.browser.opened.length;
    await page.click('.nav[data-view="jobs"]');
    await page.locator('article.job-row').filter({hasText: CHAIN.company}).first().locator('.row-main').click();
    for (let waited = 0; ctx.browser.opened.length === opened && waited < 30000; waited += 250) await pause(250);
    if (ctx.browser.opened.length === opened) throw new Error('Apply did not open the posting in the browser');
    const seen = [];
    let tab = null;
    for (let waited = 0; waited < 90000 && !tab; waited += 1000) {
      const pages = ctx.browser.context.pages();
      seen.splice(0, seen.length, ...pages.map(item => item.url().split('#')[0]));
      tab = pages.find(item => item.url().startsWith(CHAIN.formUrl)) || null;
      await pause(1000);
    }
    if (!tab) await dumpExtension();
    if (!tab) throw new Error(`the journey never reached the form. Tabs open: ${seen.join(' | ')}. ${seen.some(url => url.startsWith(CHAIN.stepUrl)) ? 'The new tab opened but "To apply" was not followed.' : 'Apply did not open the second tab.'}`);
    // The form page answers only to the step's POST: "session expired" means the posted data was dropped (the address loaded again).
    for (let waited = 0; waited < 10000 && !(await tab.locator('#application_form, form input').count().catch(() => 0)); waited += 500) await pause(500);
    if (await tab.locator('#expired').count().catch(() => 0)) throw new Error('"To apply" posts its form into a new tab, and the form page said "session expired": the posted data was lost on the way to one tab');
    // One tab for the whole journey (owner, 8 Oct 2026): the page Apply opened in a new tab loads in the posting's own tab, and the new tab closes.
    const journey = ctx.browser.context.pages().filter(item => [CHAIN.url, CHAIN.stepUrl, CHAIN.formUrl].some(url => item.url().startsWith(url.split('#')[0])));
    if (journey.length !== 1) throw new Error(`the journey was in ${journey.length} tabs, not one: ${journey.map(item => item.url().split('#')[0]).join(' | ')}`);
    let state = null;
    for (let waited = 0; waited < 90000; waited += 500) {
      state = await fillState(tab).catch(() => null);
      if (state?.state === 'done' || state?.state === 'error') break;
      await pause(500);
    }
    if (state?.state !== 'done') throw new Error(`the form was reached but not filled (${fillNote(state, 90)})`);
    const actual = await readForm(tab);
    fail([...fillProblems({expected: {first_name: CONTACT.first_name, last_name: CONTACT.last_name, email: CONTACT.email, question_3001: '7'}, actual}), ...cvProblems(actual, cv),
      ...submitProblems(forms.fired, CHAIN.path), ...submitProblems(forms.fired, CHAIN.formPath)]);
    // Floating labels: a filled field was left like a person leaves it (focus, then blur), so the site moved its label out of the way.
    const stuckLabels = await tab.evaluate(() => ['first_name', 'last_name', 'email', 'question_3001'].filter(id => !document.querySelector(`label[for=${id}]`)?.classList.contains('up')));
    if (stuckLabels.length) throw new Error(`filled, but the site never saw the field being left (its floating label stayed over the value): ${stuckLabels.join(', ')}`);
    // "Let Claude finish this page" only when Claude is ready and the extension is stuck (owner, 9-10 Oct 2026): this form was filled, so the panel must not offer it.
    // The stuck case: worker/test/extension-files.test.js, desktop/test/panel-claude.test.js and the twin.
    const offered = await tab.evaluate(() => { const offer = document.getElementById('jobpilotto-review-host')?.shadowRoot?.querySelector('.claude-offer'); return !!offer && !offer.hidden; });
    if (offered) throw new Error('the panel offers Claude on a filled form (nothing is stuck)');
  }, {needs: ctx.needs});

  // Two applications side by side (8 Oct 2026: Coop and Manor started seconds apart; Migros's sign-in page showed on Manor's card). SCRIPTED's Apply opens its
  // form from the page's own script (nothing to point at the same tab: the new tab is followed, the posting closes); CHAIN's goes link → posted form. Started
  // 2 s apart, each ends in one tab, filled from its OWN kit (9 vs 7: a form credited to the other job shows the wrong number).
  await ctx.run('two applications side by side, one whose Apply opens its form from script: each keeps one tab and its own kit', async () => {
    for (const item of ctx.browser.context.pages()) if ([CHAIN.url, CHAIN.stepUrl, CHAIN.formUrl, SCRIPTED.url, SCRIPTED.formUrl].some(url => item.url().startsWith(url))) await item.close();   // an earlier step's tabs
    // Apply's own call (the row's button, which on a job already applying in an earlier step only opens its session): both start here.
    const apply = job => page.evaluate(([url, details]) => window.pilot.applyOne(url, details), [job.url, {title: job.title, company: job.company}]);
    await apply(SCRIPTED);
    await pause(2000);
    await apply(CHAIN);
    const find = url => ctx.browser.context.pages().find(item => item.url().startsWith(url)) || null;
    let scripted = null, chain = null;
    for (let waited = 0; waited < 90000 && !(scripted && chain); waited += 1000) { scripted = find(SCRIPTED.formUrl); chain = find(CHAIN.formUrl); await pause(1000); }
    const seen = () => ctx.browser.context.pages().map(item => item.url().split('#')[0]).join(' | ');
    if (!scripted || !chain) { await dumpExtension(); throw new Error(`not both forms were reached (scripted: ${!!scripted}, chain: ${!!chain}). Tabs open: ${seen()}`); }
    const tabsOf = urls => ctx.browser.context.pages().filter(item => urls.some(url => item.url().startsWith(url))).length;
    for (let waited = 0; waited < 10000 && tabsOf([SCRIPTED.url, SCRIPTED.formUrl]) > 1; waited += 500) await pause(500);   // the posting closes once its new tab is followed
    const problems = [];
    if (tabsOf([SCRIPTED.url, SCRIPTED.formUrl]) !== 1) problems.push(`the scripted application is in ${tabsOf([SCRIPTED.url, SCRIPTED.formUrl])} tabs, not one: ${seen()}`);
    if (tabsOf([CHAIN.url, CHAIN.stepUrl, CHAIN.formUrl]) !== 1) problems.push(`the chain application is in ${tabsOf([CHAIN.url, CHAIN.stepUrl, CHAIN.formUrl])} tabs, not one: ${seen()}`);
    for (const [tab, job, answer] of [[scripted, SCRIPTED, '9'], [chain, CHAIN, '7']]) {
      let state = null;
      for (let waited = 0; waited < 90000; waited += 500) { state = await fillState(tab).catch(() => null); if (state?.state === 'done' || state?.state === 'error') break; await pause(500); }
      if (state?.state !== 'done') { problems.push(`${job.company}: its form was reached but not filled (${fillNote(state, 90)})`); continue; }
      const read = (await readForm(tab)).question_3001, value = String(read?.value ?? read ?? "");
      if (value !== answer) problems.push(`${job.company}: Kubernetes years "${value}", its own kit says ${answer}${value === (answer === '9' ? '7' : '9') ? ' (the other job\'s kit)' : ''}`);
    }
    fail(problems);
  }, {needs: ctx.needs});

  // A form drawn late (9 Oct 2026, SuccessFactors after a sign-in): judged while empty it reads as a posting whose "Apply" is the form's own submit span.
  // That is never pressed; once the fields come the page is looked at again (fill-flow.js watchForFields) and filled, with the panel on it.
  await ctx.run('a form drawn after a spinner: its submit is never pressed as Apply, and it is filled once its fields come', async () => {
    for (const item of ctx.browser.context.pages()) if ([LATE.url, LATE.formUrl].some(url => item.url().startsWith(url))) await item.close();
    await page.evaluate(([url, details]) => window.pilot.applyOne(url, details), [LATE.url, {title: LATE.title, company: LATE.company}]);
    let tab = null;
    for (let waited = 0; waited < 60000 && !tab; waited += 1000) { tab = ctx.browser.context.pages().find(item => item.url().startsWith(LATE.formUrl)) || null; await pause(1000); }
    if (!tab) { await dumpExtension(); throw new Error(`the late form was never reached. Tabs: ${ctx.browser.context.pages().map(item => item.url()).join(' | ')}`); }
    let state = null;
    for (let waited = 0; waited < 90000; waited += 500) { state = await fillState(tab).catch(() => null); if (state?.state === 'done' || state?.state === 'error') break; await pause(500); }
    const problems = [...submitProblems(forms.fired, LATE.formPath)];
    if (state?.state !== 'done') problems.push(`the form was not filled once its fields came (${fillNote(state, 90)})`);
    else {
      const read = (await readForm(tab)).question_3001, value = String(read?.value ?? read ?? '');
      if (value !== '5') problems.push(`Kubernetes years "${value}", the kit says 5`);
    }
    if (!(await tab.evaluate(() => !!document.getElementById('jobpilotto-review-host')).catch(() => false))) problems.push('no panel on the form once its fields came');
    if (problems.length) await dumpExtension();
    fail(problems);
  }, {needs: ctx.needs});

  // Account creation and the application form kept apart (owner, 8 Oct 2026). The posting's Apply leads to a sign-up page: the extension leaves it alone and
  // the session shows the account step, no form progress (since 12 Oct 2026 the extension fills the page's detail fields by meaning, and presses neither the box nor the button). The test, as the person, creates the account; the form behind it is filled from the kit and the
  // session moves on to the form. Nothing typed on the sign-up page is learned as an answer or a fill miss, and "Create account" is not the application sent.
  await ctx.run('a sign-up page before the form: the account step is kept apart from the application form', async () => {
    const appLog = () => appLogText(ctx.profile);
    await page.evaluate(([url, details]) => window.pilot.applyOne(url, details), [SIGNUP.url, {title: SIGNUP.title, company: SIGNUP.company}]);
    const find = url => ctx.browser.context.pages().find(item => item.url().startsWith(url)) || null;
    let tab = null;
    for (let waited = 0; waited < 60000 && !tab; waited += 1000) { tab = find(SIGNUP.accountUrl); await pause(1000); }
    if (!tab) { await dumpExtension(); throw new Error(`the sign-up page was never reached. Tabs: ${ctx.browser.context.pages().map(item => item.url()).join(' | ')}`); }
    const session = async () => (await page.evaluate(target => window.pilot.sessions(), null)).find(item => String(item.url || '').replace(/\/$/, '') === SIGNUP.url) || null;
    let at = null;
    for (let waited = 0; waited < 30000 && at?.stage !== 'account'; waited += 1000) { at = await session(); await pause(1000); }
    const problems = [];
    if (at?.stage !== 'account') problems.push(`on the sign-up page the session is not at the account step (stage: ${at?.stage}, stuck: ${at?.stuck})`);
    // Every account page gets the normal fill (owner, 12 Oct 2026, 8691f97): the person's details by meaning may be in; what stays the person's or Claude's is the box and the button (the password is account-step.js's, as a password manager's).
    if (await tab.locator('#robot').isChecked()) problems.push('the extension ticked the sign-up page\'s box (it must leave that to the person)');
    // The person creates the account: typed fields (trusted input), the box ticked, Create account pressed. While the extension fills, its overlay holds the person's click (c09c6a8,
    // 19 Oct 2026), so the person waits for it to lift, as a real one would: a click made under it changes nothing.
    await tab.fill('#signup_email', 'e2e.person@example.com');
    await tab.fill('#signup_username', 'e2e-person');
    await tab.fill('#signup_password', 'Fictional-Pass-1234');
    await ticked(tab, '#robot');   // each waits for the overlay again and retries a click it swallowed (lib/free-click.mjs)
    await pressed(tab, '#create_account', {landed: () => tab.url().startsWith(SIGNUP.formUrl)});   // counted only when the form behind it loads
    let state = null;
    for (let waited = 0; waited < 60000; waited += 500) { if (tab.url().startsWith(SIGNUP.formUrl)) { state = await fillState(tab).catch(() => null); if (state?.state === 'done' || state?.state === 'error') break; } await pause(500); }
    if (state?.state !== 'done') problems.push(`the application form after the sign-up was not filled (at ${tab.url()}, ${fillNote(state, 60)})`);
    else {
      // The fill's last pass (the read-back after the page settled, ~0.8 s) can commit the box just after "done" is written (13 Oct 2026, flow e2e on #558: read 50 ms
      // before it): the value has 5 s to land, and a wait is said, so a slower fill stays visible.
      let value = '';
      const since = Date.now();
      for (let waited = 0; waited <= 5000 && value !== '5'; waited += 250) { const read = (await readForm(tab)).question_3001; value = String(read?.value ?? read ?? ''); if (value !== '5') await pause(250); }
      if (value === '5' && Date.now() - since > 300) console.log(`  the Kubernetes years box held its answer ${Date.now() - since} ms after the fill said done`);
      if (value !== '5') problems.push(`the form after the sign-up has Kubernetes years "${value}" 5 s after the fill said done, its kit says 5`);
    }
    for (let waited = 0; waited < 20000 && at?.stage !== 'form'; waited += 1000) { at = await session(); await pause(1000); }
    if (at?.stage !== 'form') problems.push(`on the application form the session did not move to the form step (stage: ${at?.stage})`);
    const log = appLog();
    if (!/account page: answers typed there are not learned/.test(log)) problems.push('the answers typed on the sign-up page were not kept out of the learned answers (no "not learned" line in the app log)');
    if (!/account page: a sign-in or sign-up press, not an application submit/.test(log)) problems.push('"Create account" was not told apart from submitting the application');
    if (/learned.*Username|Username.*learned/i.test(log)) problems.push('"Username" from the sign-up page reached the learned answers');
    fail(problems);
  }, {needs: ctx.needs});

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
    let tab = null;
    for (let waited = 0; waited < 60000 && !tab; waited += 1000) { tab = ctx.browser.context.pages().find(item => item.url().startsWith(fixture.accountUrl)) || null; await pause(1000); }
    if (!tab) { await dumpExtension(); throw new Error(`the sign-in page was never reached. Tabs: ${ctx.browser.context.pages().map(item => item.url()).join(' | ')}`); }
    return tab;
  };
  const sessionOf = async fixture => (await page.evaluate(() => window.pilot.sessions())).find(item => String(item.url || '').replace(/\/$/, '') === fixture.url) || null;
  const pressesOf = fixture => forms.signinPosts.filter(post => post.path === fixture.accountPath);

  await ctx.run('a sign-in page before the form: your email and saved password are filled, "Sign in" is pressed once, and the form behind it is filled', async () => {
    const tab = await openAccount(SIGNIN);
    const problems = [];
    for (let waited = 0; waited < 60000 && !pressesOf(SIGNIN).length; waited += 500) await pause(500);
    const presses = pressesOf(SIGNIN);
    if (!presses.length) problems.push(`"Sign in" was never pressed (email box "${await tab.locator('#signin_email').inputValue().catch(() => '?')}" is ${await tab.locator('#signin_email').inputValue().catch(() => '') === CONTACT.email ? 'filled' : 'not filled'}, password box ${await tab.locator('#signin_password').inputValue().then(value => (value ? 'filled' : 'empty')).catch(() => '?')})`);
    else if (!presses[0].email || !presses[0].password) problems.push(`"Sign in" was pressed with the wrong ${!presses[0].email ? 'email' : 'password'} (the saved one for this site was not used)`);
    let state = null;
    for (let waited = 0; waited < 60000 && presses.length; waited += 500) { if (tab.url().startsWith(SIGNIN.formUrl)) { state = await fillState(tab).catch(() => null); if (state?.state === 'done' || state?.state === 'error') break; } await pause(500); }
    if (presses.length && state?.state !== 'done') problems.push(`the form after signing in was not filled (at ${tab.url()}, ${fillNote(state, 60)})`);
    else if (presses.length) {
      const read = (await readForm(tab)).question_3001, value = String(read?.value ?? read ?? '');
      if (value !== '4') problems.push(`the form after signing in has Kubernetes years "${value}", its kit says 4`);
    }
    if (pressesOf(SIGNIN).length > 1) problems.push(`"Sign in" was pressed ${pressesOf(SIGNIN).length} times (once per tab is the floor)`);
    let at = null;
    for (let waited = 0; waited < 20000 && at?.stage !== 'form'; waited += 1000) { at = await sessionOf(SIGNIN); await pause(1000); }
    if (at?.stage !== 'form') problems.push(`after signing in the session did not move to the form step (stage: ${at?.stage}, stuck: ${at?.stuck})`);
    // The extension's decisions reach the app log in batches: the account AI's word after the press can land after the form was filled
    // (local e2e, 9 Oct 2026: "created" judged at 22.246 s, the log read 0.1 s later). Wait up to 10 s for the last expected line, then read.
    for (let waited = 0; waited < 10000 && !/account result: created/.test(appLogText(ctx.profile)); waited += 500) await pause(500);
    const log = appLogText(ctx.profile);
    // Either path may fill the email first (beta 9 Oct 2026: the account step, 864b279, pressed ~1 s after the load, before the fill's line): the site's own
    // record above (`presses[0].email`) is the proof the right email arrived; this line only says which part of the extension did it.
    for (const [line, why] of [[/sign_in page: filled with your details|sign-in page: email filled/, 'the sign-in page was not filled with your details (neither the fill nor the account step says so)'], [/site password given for a sign-in page/, 'the app did not give the saved password as a sign-in'],
      [/account button: pressed/, 'no "account button: pressed" decision in the app log'], [/account result: created/, 'the account AI\'s word after the press ("created") is not in the app log']]) if (!line.test(log)) problems.push(why);
    const rows = await page.evaluate(() => window.pilot.credentials());
    const row = (rows?.rows || []).find(item => item.host === SIGNIN.accountHost);
    if (!row) problems.push(`Settings → Credentials does not list ${SIGNIN.accountHost} (${rows?.ok ? `${rows.rows.length} row(s)` : rows?.error})`);
    else if (row.email !== CONTACT.email) problems.push(`Settings → Credentials lists ${SIGNIN.accountHost} with email "${row.email}", expected the applicant's`);
    fail(problems);
  }, {needs: ctx.needs});

  await ctx.run('a sign-in page before the form that refuses the password: "Sign in" is pressed once, never again, and you are told; on the stuck sign-up page Take over with Claude only with Claude help on, never started', async () => {
    const tab = await openAccount(SIGNIN_REFUSED);
    const problems = [];
    for (let waited = 0; waited < 60000 && !pressesOf(SIGNIN_REFUSED).length; waited += 500) await pause(500);
    if (!pressesOf(SIGNIN_REFUSED).length) problems.push('"Sign in" was never pressed on the refusing page');
    let at = null;
    for (let waited = 0; waited < 30000 && at?.stuck !== 'account'; waited += 1000) { at = await sessionOf(SIGNIN_REFUSED); await pause(1000); }
    await pause(12000);   // several more looks of the extension (it looks every few seconds): a second press would show here
    const presses = pressesOf(SIGNIN_REFUSED).length;
    if (presses > 1) problems.push(`after the site refused, "Sign in" was pressed again (${presses} presses): a refused sign-in is never retried`);
    if (tab.url().startsWith(SIGNIN_REFUSED.formUrl)) problems.push('the refusing page somehow led to the form');
    if (at?.stuck !== 'account') problems.push(`the session does not say the account step needs you (stage: ${at?.stage}, stuck: ${at?.stuck})`);
    const log = appLogText(ctx.profile);
    if (!/account result: refused/.test(log)) problems.push('the account AI\'s "refused" is not in the app log');
    if (!/account page: the extension could not finish it/.test(log)) problems.push('the account step was not handed to the person after the refused sign-in');
    // The session is stuck on the sign-up page the refusal led to (a box only a person can tick): Claude is OFFERED there, never started (owner, 9 Oct 2026).
    // Read as a person sees it: the panel open (the offer is drawn only in its open card, extension/panel-claude.js). Claude not ready (no Claude Code): no "Let Claude finish this page";
    // ready (settings.claudeReadyTest, which only the e2e run honours): offered at the panel's next report. No Claude session starts by itself. Back to off for the steps after.
    const panelTakeOver = async () => {
      await tab.evaluate(() => { const root = document.getElementById('jobpilotto-review-host')?.shadowRoot; if (root?.querySelector('.card')?.hidden) root.querySelector('.pill')?.click(); }).catch(() => {});
      await pause(500);
      return tab.evaluate(() => { const root = document.getElementById('jobpilotto-review-host')?.shadowRoot, card = root?.querySelector('.card'), offer = root?.querySelector('.claude-offer');
        return {url: location.pathname, panel: !!card && !card.hidden, offered: !!card && !card.hidden && !!offer && !offer.hidden && [...offer.querySelectorAll('button')].some(button => /Let Claude finish this page/.test(button.textContent))}; }).catch(error => ({error: String(error.message).slice(0, 80)}));
    };
    const claudes = async () => (await page.evaluate(() => window.pilot.sessions())).filter(item => (item.kind || 'claude') === 'claude' && String(item.url || '').replace(/\/$/, '') === SIGNIN_REFUSED.url).length;
    const claudesBefore = await claudes();
    await page.evaluate(() => window.pilot.saveSettings({claudeReadyTest: 'off'}));   // this Mac may have Claude Code: the step says "not ready" itself
    await pause(6000);   // the panel learns it at its next report
    const off = await panelTakeOver();
    if (!off.panel) problems.push(`the stuck page has no panel to open (${JSON.stringify(off)}): Take over cannot be checked`);
    else if (off.offered) problems.push('Claude is not ready, yet the stuck page offers "Let Claude finish this page"');
    await page.evaluate(() => window.pilot.saveSettings({claudeReadyTest: 'on'}));
    let on = null;
    await pause(6000); on = await panelTakeOver();   // the takeover is off for now (renderer/claude-help.js SHOW_RESUME_CLAUDE, owner 15 Oct 2026): the panel never offers Claude, ready or not   // OpenAI: a few reports, still nothing   // the panel learns the switch at its next report
    // An OpenAI engine (odd CI runs, lib/engine.mjs): Claude is never offered, whatever the switch (owner, 9 Oct 2026; the app's claudeHelp needs the Claude family).
    if (ctx.family === 'openai') { if (on?.offered) problems.push('an OpenAI engine is chosen, yet the panel offers "Let Claude finish this page"'); }
    else if (on?.offered) problems.push(`Claude's takeover is off, yet the stuck page offers "Let Claude finish this page" (${JSON.stringify(on)})`);
    if (await claudes() !== claudesBefore) problems.push('a Claude session started by itself: Claude is only ever offered, the person starts it');
    await page.evaluate(() => window.pilot.saveSettings({claudeReadyTest: null}));
    fail(problems);
  }, {needs: ctx.needs});

  // A menu whose choices are not the answer's words (Coop, 8 Oct 2026: "+41" asked, country names listed). The fill cannot match it; the app asks the AI once for the choice that means the same, arms the menu with it, and remembers it for the site: the next form there gets "Suisse" at once, no AI call, no re-arm.
  await ctx.run('a menu whose choices are not the answer\'s words: the choice that means the same is picked, then remembered for the next form on the site', async () => {
    const problems = [];
    const openForm = async fixture => {
      await page.evaluate(([url, details]) => window.pilot.applyOne(url, details), [fixture.url, {title: fixture.title, company: fixture.company}]);
      let tab = null;
      for (let waited = 0; waited < 60000 && !tab; waited += 1000) { tab = ctx.browser.context.pages().find(item => item.url().startsWith(fixture.url)) || null; await pause(1000); }
      if (!tab) throw new Error(`${fixture.title} never opened. Tabs: ${ctx.browser.context.pages().map(item => item.url()).join(' | ')}`);
      let state = null;
      for (let waited = 0; waited < 90000; waited += 500) { state = await fillState(tab).catch(() => null); if (state?.state === 'done' || state?.state === 'error') break; await pause(500); }
      if (state?.state !== 'done') problems.push(`${fixture.title}: the fill did not finish (${fillNote(state, 90)})`);
      return tab;
    };
    const menuOf = async (tab, within) => {
      let value = '';
      for (let waited = 0; waited <= within; waited += 500) { value = await tab.locator('#country_code').inputValue().catch(() => ''); if (value === 'Suisse') break; await pause(500); }
      return value;
    };
    const asked = () => (ctx.optionPicks || []).filter(item => item.answer === '+41').length;
    const first = await openForm(MENU_FIRST);
    const value1 = await menuOf(first, 45000);
    if (value1 !== 'Suisse') problems.push(`the first form's "Indicatif de pays" is "${value1}" (choices ${MENU_CHOICES.join(', ')}; the answer "+41" means Suisse)`);
    if (asked() !== 1) problems.push(`the AI was asked ${asked()} time(s) for "+41" on the first form (once is right)`);
    const kept = (() => { try { return JSON.parse(fs.readFileSync(path.join(ctx.profile, 'menu-choices.json'), 'utf8')); } catch { return null; } })();
    if (!kept?.some(item => item.host === MENU_FIRST.host && item.value === '+41' && item.choice === 'Suisse')) problems.push(`the choice was not remembered for ${MENU_FIRST.host} (menu-choices.json: ${kept ? `${kept.length} item(s)` : 'missing'})`);
    const logBefore = appLogText(ctx.profile).length;
    const again = await openForm(MENU_AGAIN);
    const value2 = await menuOf(again, 5000);
    if (value2 !== 'Suisse') problems.push(`the next form on the site has "Indicatif de pays" "${value2}" a few seconds after its fill (the remembered choice is tried first)`);
    if (asked() !== 1) problems.push(`the AI was asked again on the next form (${asked()} asks): the remembered choice needs none`);
    const log = appLogText(ctx.profile), firstForm = rearmedSessions(log.slice(0, logBefore));   // Why (main 40508145728): the first form's own 10 s re-arm (lib/menu-rearm.js GAP_MS) may land after logBefore
    if ([...rearmedSessions(log.slice(logBefore))].some(id => !firstForm.has(id))) problems.push('the next form\'s menu was re-armed (a detour the remembered choice avoids)');
    for (const tab of [first, again]) {
      const read = await readForm(tab);
      if (String(read.question_3001?.value ?? read.question_3001 ?? '') !== '6') problems.push(`${tab.url()}: Kubernetes years is not the kit's 6`);
    }
    fail([...problems, ...submitProblems(forms.fired, MENU_FIRST.path), ...submitProblems(forms.fired, MENU_AGAIN.path)]);
  }, {needs: ctx.needs});

  // "Needs your attention" fed by the extension's fill (owner, 8 Oct 2026: "we had this, it got overwritten"): the kit says "3 months", the menu offers none that
  // means it. The fill leaves it and proposes it; the session page lists the field with the proposal and the form's own choices; the person picks one and presses
  // Use; the form gets it through the extension, and the row says it is filled. Producer parity: the rows once came only from Claude's message.
  await ctx.run('"Needs your attention" from the extension\'s fill: the left menu is listed with its proposal and choices, and Use fills the form', async () => {
    const problems = [];
    await page.evaluate(([url, details]) => window.pilot.applyOne(url, details), [PROPOSE.url, {title: PROPOSE.title, company: PROPOSE.company}]);
    let tab = null;
    for (let waited = 0; waited < 60000 && !tab; waited += 1000) { tab = ctx.browser.context.pages().find(item => item.url().startsWith(PROPOSE.url)) || null; await pause(1000); }
    if (!tab) throw new Error(`the notice-period form never opened. Tabs: ${ctx.browser.context.pages().map(item => item.url()).join(' | ')}`);
    let state = null;
    for (let waited = 0; waited < 90000; waited += 500) { state = await fillState(tab).catch(() => null); if (state?.state === 'done' || state?.state === 'error') break; await pause(500); }
    if (state?.state !== 'done') throw new Error(`the fill did not finish (${fillNote(state, 90)})`);
    if (await tab.locator('#notice_period').inputValue() !== '') problems.push(`the fill put "${await tab.locator('#notice_period').inputValue()}" in a menu where no choice means "3 months"`);
    await page.click('.nav[data-view="sessions"]');
    await page.locator('.view[data-view="sessions"]').getByText(PROPOSE.company).first().click({timeout: 15000}).catch(() => { throw new Error(`no session for ${PROPOSE.company} on the Sessions page`); });
    const row = page.locator('li.ss-need').filter({hasText: 'Notice period'}).first();
    await row.waitFor({state: 'visible', timeout: 30000}).catch(async () => {
      throw new Error(`"Needs your attention" does not list Notice period (rows: ${(await page.locator('li.ss-need').allInnerTexts().catch(() => [])).map(text => text.replace(/\s+/g, ' ').slice(0, 60)).join(' | ') || 'none'})`);
    });
    const choice = row.locator('select.ss-ask-input');
    // The row is drawn first and its menu a moment after (Windows, run 910: the check ran 0.7 s after the fill ended); a row that never gets one is the lost proposal.
    await choice.first().waitFor({state: 'attached', timeout: 15000}).catch(() => {});
    if (!await choice.count()) problems.push('the row has no menu of the form\'s choices (a bare row: the proposal was lost)');
    else {
      const offered = (await choice.locator('option').allInnerTexts()).filter(Boolean);   // read before Use: the row leaves once the form has the answer
      if (NOTICE_CHOICES.some(option => !offered.includes(option))) problems.push(`the row offers ${offered.join(', ')}; the form's choices are ${NOTICE_CHOICES.join(', ')}`);
      if (!/3 months/.test(await row.innerText({timeout: 5000}))) problems.push('the row does not say what the kit proposed ("3 months")');
      await choice.selectOption('2 months', {timeout: 5000});
      await row.getByRole('button', {name: 'Use'}).click({timeout: 5000});
      let value = '';
      for (let waited = 0; waited < 15000 && value !== '2 months'; waited += 500) { value = await tab.locator('#notice_period').inputValue().catch(() => ''); await pause(500); }
      if (value !== '2 months') problems.push(`after Use the form's Notice period is "${value}", not the "2 months" picked in the app`);
      // Then the row says it is filled, or leaves the list once the form reports the field filled (the session's count says all required fields are in).
      let said = '', gone = false;
      for (let waited = 0; waited < 15000 && !gone && !/Filled in the form/.test(said); waited += 500) {
        const rows = page.locator('li.ss-need').filter({hasText: 'Notice period'});
        gone = !(await rows.count());
        said = gone ? '' : await rows.first().innerText({timeout: 1000}).catch(() => '');
        await pause(500);
      }
      if (!gone && !/Filled in the form/.test(said)) problems.push(`after Use the row neither says it is filled nor leaves the list ("${said.replace(/\s+/g, ' ').slice(0, 120)}")`);
    }
    if (String((await readForm(tab)).question_3001?.value ?? '') !== '7') problems.push('Kubernetes years is not the kit\'s 7');
    fail([...problems, ...submitProblems(forms.fired, PROPOSE.path)]);
  }, {needs: ctx.needs});

  // An upload slot that has no file input until its + is pressed (Coop on SuccessFactors, 8 Oct 2026): the app's CV goes through the whole chain into it
  // (the shapes alone are guarded in test/upload-slot.test.mjs without the app). The slot says it got the CV; the rest of the form is filled; Submit untouched.
  await ctx.run('an upload slot that appears only when + is pressed: the app\'s CV reaches it, the rest of the form is filled', async () => {
    await page.evaluate(([url, details]) => window.pilot.applyOne(url, details), [REVEAL.url, {title: REVEAL.title, company: REVEAL.company}]);
    let tab = null;
    for (let waited = 0; waited < 60000 && !tab; waited += 1000) { tab = ctx.browser.context.pages().find(item => item.url().startsWith(REVEAL.url)) || null; await pause(1000); }
    if (!tab) throw new Error(`the + upload form never opened. Tabs: ${ctx.browser.context.pages().map(item => item.url()).join(' | ')}`);
    let state = null;
    for (let waited = 0; waited < 90000; waited += 500) { state = await fillState(tab).catch(() => null); if (state?.state === 'done' || state?.state === 'error') break; await pause(500); }
    const problems = [];
    if (state?.state !== 'done') problems.push(`the fill did not finish (${fillNote(state, 90)})`);
    let got = null;
    for (let waited = 0; waited < 10000 && !got; waited += 500) { got = await tab.evaluate(() => window.got?.cv_plus || null).catch(() => null); await pause(500); }
    if (!got) problems.push('the + slot never received a file (its input appears only after the + is pressed)');
    else if (got.name !== cv.name || got.size !== cv.size) problems.push(`the + slot got ${got.name} (${got.size} bytes), expected the app's ${cv.name} (${cv.size} bytes)`);
    const read = await readForm(tab);
    if (String(read.first_name?.value ?? read.first_name ?? '') !== CONTACT.first_name) problems.push('the first name was not filled');
    if (String(read.question_3001?.value ?? read.question_3001 ?? '') !== '8') problems.push('Kubernetes years is not the kit\'s 8');
    fail([...problems, ...submitProblems(forms.fired, REVEAL.path)]);
  }, {needs: ctx.needs});

  // Sections drawn collapsed (Migros on SuccessFactors, 9 Oct 2026): the fill saw one field and filled nothing. The extension opens the closed disclosures by structure
  // (extension/sections.js), then reads and fills the questions inside them. Shapes alone: worker/test/page-sections.test.js. Submit untouched.
  await ctx.run('a form with collapsed sections: they are opened and the questions inside are filled', async () => {
    await page.evaluate(([url, details]) => window.pilot.applyOne(url, details), [COLLAPSED.url, {title: COLLAPSED.title, company: COLLAPSED.company}]);
    let tab = null;
    for (let waited = 0; waited < 60000 && !tab; waited += 1000) { tab = ctx.browser.context.pages().find(item => item.url().startsWith(COLLAPSED.url)) || null; await pause(1000); }
    if (!tab) throw new Error(`the collapsed-sections form never opened. Tabs: ${ctx.browser.context.pages().map(item => item.url()).join(' | ')}`);
    let state = null;
    for (let waited = 0; waited < 90000; waited += 500) { state = await fillState(tab).catch(() => null); if (state?.state === 'done' || state?.state === 'error') break; await pause(500); }
    const problems = [];
    if (state?.state !== 'done') problems.push(`the fill did not finish (${fillNote(state, 90)})`);
    const read = await readForm(tab);
    if (String(read.email?.value ?? read.email ?? '') !== CONTACT.email) problems.push('the e-mail inside the closed "profile" section was not filled');
    if (String(read.question_4001?.value ?? read.question_4001 ?? '') !== '6') problems.push('the question inside the closed "job" section is not the kit\'s 6');
    const closed = await tab.evaluate(() => [...document.querySelectorAll('button[aria-expanded]')].filter(b => b.getAttribute('aria-expanded') === 'false').length).catch(() => -1);
    if (closed !== 0) problems.push(`${closed} section(s) are still closed`);
    fail([...problems, ...submitProblems(forms.fired, COLLAPSED.path)]);
  }, {needs: ctx.needs});

  // The account and the application on one page (Coop, 8 Oct 2026): a CV upload says it is the application. It is filled from the kit, the session is at the
  // form step, and its password boxes are never counted as questions the fill missed.
  await ctx.run('the account and the application on one page: it is the application form, its passwords stay account fields', async () => {
    await page.evaluate(([url, details]) => window.pilot.applyOne(url, details), [ONEPAGE.url, {title: ONEPAGE.title, company: ONEPAGE.company}]);
    let tab = null;
    for (let waited = 0; waited < 60000 && !tab; waited += 1000) { tab = ctx.browser.context.pages().find(item => item.url().startsWith(ONEPAGE.url)) || null; await pause(1000); }
    if (!tab) throw new Error(`the one-page form never opened. Tabs: ${ctx.browser.context.pages().map(item => item.url()).join(' | ')}`);
    let state = null;
    for (let waited = 0; waited < 90000; waited += 500) { state = await fillState(tab).catch(() => null); if (state?.state === 'done' || state?.state === 'error' || state?.state === 'account') break; await pause(500); }
    const problems = [];
    if (state?.state !== 'done') problems.push(`the one-page form was not filled as the application (${fillNote(state, 90)}): a CV upload beside the password makes it the form`);
    else {
      const actual = await readForm(tab);
      const value = id => String(actual[id]?.value ?? actual[id] ?? '');
      if (value('first_name') !== CONTACT.first_name) problems.push(`first name "${value('first_name')}", expected ${CONTACT.first_name}`);
      if (value('question_3001') !== '3') problems.push(`Kubernetes years "${value('question_3001')}", its kit says 3`);
    }
    const sessionNow = async () => (await page.evaluate(() => window.pilot.sessions())).find(item => String(item.url || '').replace(/\/$/, '') === ONEPAGE.url) || null;
    let at = null;
    for (let waited = 0; waited < 20000 && at?.stage !== 'form'; waited += 1000) { at = await sessionNow(); await pause(1000); }
    if (at?.stage !== 'form') problems.push(`the session is not at the form step (stage: ${at?.stage}, stuck: ${at?.stuck}): this page is the application`);
    // The page's kind came from the AI (the stand-in), not the structure rule: the path every install takes when it has AI.
    if (!/page kind: account-form/.test(appLogText(ctx.profile))) problems.push('the one-page form\'s kind never came from the AI ("page kind: account-form" missing in the app log)');
    fail(problems);
  }, {needs: ctx.needs});

  // The form tab closed (owner, 8 Oct 2026): the app sees it, and Reopen opens the form again with the fill mark, for the same session, filled again.
  await ctx.run('the form tab is closed: the app sees it and Reopen opens the form again, filled, for the same session', async () => {
    for (const item of ctx.browser.context.pages()) if (item.url().startsWith(ONEPAGE.url)) await item.close();   // an earlier step's tab of the same job
    await pause(2000);
    await page.evaluate(([url, details]) => window.pilot.applyOne(url, details), [ONEPAGE.url, {title: ONEPAGE.title, company: ONEPAGE.company}]);
    const tabOf = () => ctx.browser.context.pages().find(item => item.url().startsWith(ONEPAGE.url)) || null;
    const filled = async tab => { for (let waited = 0; waited < 90000; waited += 500) { const state = await fillState(tab).catch(() => null); if (state?.state === 'done' || state?.state === 'error') return state; await pause(500); } return null; };
    let tab = null;
    for (let waited = 0; waited < 60000 && !tab; waited += 1000) { tab = tabOf(); await pause(1000); }
    if (!tab) throw new Error('the form never opened');
    if ((await filled(tab))?.state !== 'done') throw new Error('the form was not filled the first time');
    const session = (await page.evaluate(() => window.pilot.sessions())).find(item => String(item.url || '').replace(/\/$/, '') === ONEPAGE.url);
    if (!session) throw new Error('no session for the job');
    await tab.close();
    let forms = null;
    for (let waited = 0; waited < 45000; waited += 1000) { forms = await page.evaluate(() => window.pilot.formsOpen()); if (forms?.known && !forms.ids.includes(session.id)) break; await pause(1000); }
    const problems = [];
    if (!forms?.known || forms.ids.includes(session.id)) problems.push(`the app never saw the tab closed (forms open: ${JSON.stringify(forms)})`);
    const reopened = await page.evaluate(id => window.pilot.sessionReopen(id, false), session.id);
    if (!reopened?.ok) problems.push(`Reopen failed: ${JSON.stringify(reopened)}`);
    let again = null;
    for (let waited = 0; waited < 60000 && !again; waited += 1000) { again = tabOf(); await pause(1000); }
    if (!again) problems.push('Reopen opened no tab on the form');
    else {
      if (!again.url().includes('jobpilotto-fill')) problems.push(`the reopened tab has no fill mark: ${again.url()}`);
      if ((await filled(again))?.state !== 'done') problems.push('the reopened form was not filled again');
      const after = (await page.evaluate(() => window.pilot.sessions())).filter(item => String(item.url || '').replace(/\/$/, '') === ONEPAGE.url);
      if (after.length !== 1 || after[0].id !== session.id) problems.push(`the reopened form is not the same session (${after.map(item => item.id).join(', ')} vs ${session.id})`);
    }
    fail(problems);
  }, {needs: ctx.needs});

  // A second browser with the extension (8 Oct 2026: a test Chrome paired to the owner's app reported no tabs every few seconds, and the owner's open
  // Coop form flipped to "Form closed"). Each browser says what IT has open: a second one with no tabs never closes the first one's form.
  await ctx.run('a second browser with the extension and no tabs: the form open in the first stays open', async () => {
    for (const item of ctx.browser.context.pages()) if (item.url().startsWith(ONEPAGE.url)) await item.close();   // an earlier step's tab of the same job
    await pause(2000);
    await page.evaluate(([url, details]) => window.pilot.applyOne(url, details), [ONEPAGE.url, {title: ONEPAGE.title, company: ONEPAGE.company}]);
    let tab = null;
    for (let waited = 0; waited < 60000 && !tab; waited += 1000) { tab = ctx.browser.context.pages().find(item => item.url().startsWith(ONEPAGE.url)) || null; await pause(1000); }
    if (!tab) throw new Error('the form never opened');
    const session = (await page.evaluate(() => window.pilot.sessions())).find(item => String(item.url || '').replace(/\/$/, '') === ONEPAGE.url);
    if (!session) throw new Error('no session for the job');
    const openNow = async () => { const forms = await page.evaluate(() => window.pilot.formsOpen()); return forms?.known && forms.ids.includes(session.id); };
    let open = false;
    for (let waited = 0; waited < 60000 && !open; waited += 1000) { open = await openNow(); await pause(1000); }
    if (!open) throw new Error('the app never saw the form open in the first browser (nothing to protect: the row proves nothing)');
    const before = appLogText(ctx.profile).length;
    const spool = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-e2e-second-spool-'));   // its own: the app's `open` still goes to the first browser
    const second = await launchBrowser({port: forms.port, spool, extensionDir: ctx.extensionDir});
    const problems = [];
    try {
      await second.serviceWorker();
      // Proof the second browser reached the app (its own report), then one full report cycle after it (its reports come every 30 s, extension/tab-report.js):
      // its second empty report lands inside the window. 35 s, not the minute it was (13 Oct 2026: 79 s, a third of applycv's steps); the two-browser logic
      // itself is desktop/test/tab-identity.test.js's matrix.
      let reached = false;
      for (let waited = 0; waited < 60000 && !reached; waited += 1000) { reached = /another browser run reports its tabs/.test(appLogText(ctx.profile).slice(before)); await pause(1000); }
      if (!reached) problems.push('the second browser never reported its tabs to the app ("another browser run reports its tabs" missing): the row proves nothing');
      for (let waited = 0; reached && waited < 35000; waited += 2000) {
        if (!(await openNow())) { problems.push(`the form was shown closed after the second browser reported (${Math.round(waited / 1000)} s in)`); break; }
        await pause(2000);
      }
    } finally { await second.close(); fs.rmSync(spool, {recursive: true, force: true}); }
    fail(problems);
  }, {needs: ctx.needs});

  // A wrong kind kept by the AI corrects itself (owner, 8 Oct 2026): the stand-in calls this application form a "posting". The extension finds no Apply to
  // press while the page has a form's fields, drops the kind (logged), and fills the form from the kit this visit.
  await ctx.run('the AI gave a page the wrong kind: the page contradicts it, the kind is dropped and the form is filled', async () => {
    await page.evaluate(([url, details]) => window.pilot.applyOne(url, details), [MISLABELLED.url, {title: MISLABELLED.title, company: MISLABELLED.company}]);
    let tab = null;
    for (let waited = 0; waited < 60000 && !tab; waited += 1000) { tab = ctx.browser.context.pages().find(item => item.url().startsWith(MISLABELLED.url)) || null; await pause(1000); }
    if (!tab) throw new Error('the mislabelled form never opened');
    let state = null;
    for (let waited = 0; waited < 90000; waited += 500) { state = await fillState(tab).catch(() => null); if (['done', 'error', 'no-form', 'account'].includes(state?.state)) break; await pause(500); }
    const problems = [];
    const log = appLogText(ctx.profile);
    // The premise, on this page's own shape and from the AI (not remembered): another posting's line proves nothing (beta 9 Oct 2026).
    const ownLines = log.split('\n').filter(line => line.includes(`"shape":"${MISLABELLED.shape}|`));
    if (!ownLines.some(line => line.includes('page kind: posting {') && line.includes('"by":"ai"'))) {
      problems.push(`the stand-in's wrong kind was never asked for this page (no "page kind: posting" by the AI on ${MISLABELLED.shape}): the row proves nothing. Its lines: ${ownLines.slice(0, 3).join(' | ') || 'none'}`);
    }
    if (!/page kind corrected: a posting with no Apply but a form's fields/.test(log)) problems.push('the wrong kind was not corrected (no "page kind corrected" line)');
    if (!/page kind forgotten/.test(log)) problems.push('the app never dropped the kept kind (no "page kind forgotten" line)');
    if (state?.state !== 'done') problems.push(`the form was not filled after the correction (${fillNote(state, 90)})`);
    else {
      const read = (await readForm(tab)).question_3001, value = String(read?.value ?? read ?? '');
      if (value !== '4') problems.push(`Kubernetes years "${value}", its kit says 4`);
    }
    fail(problems);
  }, {needs: ctx.needs});
}
