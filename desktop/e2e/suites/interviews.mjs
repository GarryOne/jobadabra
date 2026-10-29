/* global document, window */
// Interviews: the library on dummy rows written through the Notion API, a transcript imported through the page's own button and reviewed with stored answers,
// the failure path (a failing AI), review again, link, delete, the consent rule of the recorder. Starts from a set-up install; resets only its own rows.
import fs from 'node:fs';
import path from 'node:path';
import {pickFile} from '../lib/app.mjs';
import {TRANSCRIPT, addDays, newestFirst} from '../lib/interview-data.mjs';
import {addInterview, addTrackedJob} from '../lib/seed-data.mjs';
import {clearData} from '../lib/start-state.mjs';
import {finish, snap} from '../lib/layout.mjs';
import {pickJob} from '../lib/picker.mjs';
import {ensureSetUp} from '../lib/seed.mjs';
import {answerConfirms, captureExternal, ids, independent} from '../lib/steps.mjs';
import {goView} from '../lib/go-view.mjs';

// Why (29 Oct 2026, ap): rule A serves declared reviews and patterns; the no-credit fault still precedes the table.
export const offlineAi = true;
export const realAi = false;
export const name = 'interviews';
const REVIEW_MS = 5 * 60 * 1000;

export async function run(ctx) {
  const {page, app, proxy} = ctx;
  // Where the library says it is kept (renderer/pages/interviews.js savedTo): Notion's database, or the app itself on this Mac's store.
  const SAVED_TO = ctx.store === 'sqlite' ? 'Saved in Jobadabra' : 'Saved to Notion 🎤 Interviews';
  // A finished review says where it went (interviews.js: byStore 'The review is on the Notion page.' / 'The review is saved with it.').
  const REVIEW_DONE = ctx.store === 'sqlite' ? 'The review is saved with it' : 'The review is on the Notion page';
  ctx.findings = [];
  const {step, end} = independent(ctx);
  const today = new Date().toISOString().slice(0, 10);
  const seed = {};
  const message = () => page.locator('#iv-message').innerText();
  const tableIds = () => page.$$eval('#iv-saved tr[data-id]', trs => trs.map(tr => tr.dataset.id));
  const row = id => page.locator(`#iv-saved tr[data-id="${id}"]`);
  const openInterviews = async expected => {
    await page.click('.nav[data-view="focus"]');
    await goView(page, 'interviews');
    // A timeout says what the page was showing (the gate, the lock, the window's Notion ids, the stats line): 9 Oct 2026 it said only "Timeout 90000ms".
    if (expected != null) await page.waitForFunction(n => document.querySelectorAll('#iv-saved tr[data-id]').length === n, expected, {timeout: 90000}).catch(async error => {
      const seen = await page.evaluate(() => { const view = document.querySelector('.view[data-view="interviews"]'); return {rows: document.querySelectorAll('#iv-saved tr[data-id]').length,
        hidden: !!view?.hidden, locked: !!view?.classList.contains('notion-locked'), gate: !!view?.querySelector(':scope > .notion-gate-host')?.children.length,
        stats: document.getElementById('iv-lib-stats')?.textContent.trim(), notionIds: Object.keys(window.__jp?.shared?.state?.notion || {}).length, store: window.__jp?.shared?.state?.store || null}; }).catch(() => ({}));
      throw new Error(`${error.message.split('\n')[0]}; expected ${expected} rows, the page shows ${JSON.stringify(seen)}`);
    });
    // The library paints its saved copy first and re-draws when Notion answers: act only once that is done, or a menu opened on the first draw is closed under the click.
    await page.waitForFunction(want => document.getElementById('iv-lib-stats').textContent.trim() === want, SAVED_TO, {timeout: 120000});
    await page.waitForTimeout(500);
  };
  // A re-draw of the table (a read finishing) closes an open ⋯ menu: open it again until the entry is there.
  const chooseFromMenu = async (id, label) => {
    const entry = page.locator('[role=menuitem]:visible').filter({hasText: label});
    for (let attempt = 0; attempt < 6; attempt++) {
      await row(id).getByRole('button', {name: 'More actions'}).click();
      const shown = await entry.first().waitFor({state: 'visible', timeout: 2500}).then(() => true, () => false);
      if (shown && await entry.first().click({timeout: 2500}).then(() => true, () => false)) return;
    }
    throw new Error(`the ⋯ menu of the row never showed "${label}"`);
  };
  // The interviews as the store keeps them (any store): {id, title, overall, next_step, app_id, transcript, review}; transcript and review are whole Markdown (spec §4).
  const notionRows = async () => (await ctx.data('interviews', 'list', {})) || [];
  const interviewOf = id => ctx.data('interviews', 'get', {interview_id: id});
  const byTitle = (list, title) => list.find(item => item.title === title);
  const sameId = (a, b) => String(a || '').replace(/-/g, '') === String(b || '').replace(/-/g, '');
  const headingsOf = markdown => String(markdown || '').split('\n').map(line => /^#{1,4}\s+(.+?)\s*$/.exec(line)?.[1]).filter(Boolean);
  const reviewHeadings = async id => headingsOf((await interviewOf(id))?.review);

  await ensureSetUp(ctx);
  const external = await captureExternal(app);
  await answerConfirms(page);

  // Dummy rows, written once: three jobs in the tracker, four interviews (three reviewed with different outcomes and one not).
  await ctx.run('this suite starts from its own dummy jobs and interviews in the store', async () => {
    const cleared = [await clearData(ctx, 'Interviews'), await clearData(ctx, 'Job Tracker'), await clearData(ctx, 'Insights')];
    console.log(`  cleared ${cleared.join('/')} interview, job and insight row(s)`);
    for (const [key, role, company, n] of [['acme', 'Senior Site Reliability Engineer', 'E2E Acme', 9001], ['beta', 'Platform Engineer', 'E2E Beta', 9002], ['gamma', 'Senior Site Reliability Engineer', 'E2E Gamma', 9003]]) {
      const url = `https://boards.e2e.test/job/${n}`;
      const created = await addTrackedJob(ctx, {role, company, url});
      seed[key] = {id: created.id, url, company, role};
    }
    // The review as Markdown, as the app keeps it on every store (a summary, then Strengths and Questions): spec §4, transcript and review are whole Markdown.
    const review = text => `${text}\n\n### Strengths\n\n- SEED strength: clear incident handling\n\n### Questions\n\n- ✅ [Incidents] How do you handle an unclear root cause? — rollback, then timeline\n`;
    const make = async (key, fields, withReview) => {
      const created = await addInterview(ctx, {...fields, transcript: TRANSCRIPT, ...(withReview ? {review: review(`SEED summary ${key}`)} : {})});
      seed[key] = {...(seed[key] || {}), page: created.id, day: fields.day};
    };
    await make('ivPositive', ({name: 'E2E Acme · Round 1', day: addDays(today, -10), round: 'Recruiter screen', overall: 'positive', nextStep: 'Technical interview', applicationId: seed.acme.id}), true);
    await make('ivNeutral', ({name: 'E2E Beta · Round 2', day: addDays(today, -6), round: 'Technical', overall: 'neutral', nextStep: 'Wait for feedback', applicationId: seed.beta.id}), true);
    await make('ivNegative', ({name: 'E2E Loose · Round 1', day: addDays(today, -3), round: 'Hiring manager', overall: 'negative'}), true);
    await make('ivFresh', ({name: 'E2E Gamma · Not reviewed yet', day: addDays(today, -1), round: 'Call', applicationId: seed.gamma.id}), false);
  });
  await ctx.run('the app reads the new jobs, as it does when the Jobs page has loaded', async () => {
    const count = await page.evaluate(async () => { const read = await window.pilot.jobs(); window.__jp.shared.allJobs = read.jobs; return read.jobs.length; });
    if (count < 3) throw new Error(`the app's job list has ${count} job(s) after three were added to the store`);
  });
  if (!seed.ivFresh) throw new Error('the dummy rows were not written: the other steps cannot run');

  await step('the library lists every interview, newest first, with its outcome', async () => {
    await openInterviews(4);
    const order = await tableIds();
    const expected = [seed.ivFresh, seed.ivNegative, seed.ivNeutral, seed.ivPositive].map(item => item.page);
    if (JSON.stringify(order) !== JSON.stringify(expected)) throw new Error(`the rows are not newest first: shown ${order.map(id => ids(id).slice(-4))}, expected ${expected.map(id => ids(id).slice(-4))}`);
    if (!newestFirst(order.map(id => Object.values(seed).find(item => item.page === id).day))) throw new Error('the seeded dates are not newest first (test bug)');
    const pill = async item => (await row(item.page).locator('td').nth(4).innerText()).trim();
    const got = {positive: await pill(seed.ivPositive), neutral: await pill(seed.ivNeutral), negative: await pill(seed.ivNegative), fresh: await pill(seed.ivFresh)};
    const want = {positive: 'Positive', neutral: 'Neutral', negative: 'Negative', fresh: 'Not reviewed'};
    for (const key of Object.keys(want)) if (got[key] !== want[key]) throw new Error(`the ${key} interview shows the outcome "${got[key]}", expected "${want[key]}"`);
    if ((await page.locator('#iv-lib-stats').innerText()).trim() !== SAVED_TO) throw new Error(`the library does not say where it is kept: "${await page.locator('#iv-lib-stats').innerText()}", expected "${SAVED_TO}"`);
    await snap(ctx, 'interviews', {situation: 'The library with four dummy interviews: three reviewed (positive, neutral, negative) and one not reviewed'});
  });

  // Its job by name, on every store (on this Mac's store the library finds the job by its store id: renderer/pages/interview-lists.js jobForPage, mac-27 8c65d67).
  await step('the library shows each interview\'s job by name (opening it in the Jobs list), and "Link a job" when there is none', async () => {
    await openInterviews(4);
    const job = async item => (await row(item.page).locator('td').nth(1).innerText()).replace(/\s+/g, ' ');
    if (!(await job(seed.ivPositive)).includes('E2E Acme')) throw new Error(`the Acme interview shows the job "${await job(seed.ivPositive)}"`);
    if (!(await job(seed.ivNegative)).includes('Link a job')) throw new Error(`an interview without a job does not offer "Link a job": "${await job(seed.ivNegative)}"`);
    // The job's name opens it in the Jobs list, alone.
    await row(seed.ivPositive.page).locator('td').nth(1).getByRole('button', {name: /E2E Acme/}).click();
    await page.waitForFunction(() => document.querySelector('.view[data-view="jobs"]:not([hidden])'), null, {timeout: 15000});
    const shown = await page.$$eval('.view[data-view="jobs"]:not([hidden]) .job-row', rowsOnScreen => rowsOnScreen.map(item => item.innerText));
    if (shown.length !== 1 || !/Acme/.test(shown[0])) throw new Error(`the Jobs list shows ${shown.length} job(s) after opening the Acme job, expected only that one`);
  });

  await step('the search box and the outcome filter narrow the library, and say so when nothing matches', async () => {
    await openInterviews(4);
    await page.fill('#iv-filter', 'beta');
    await page.waitForFunction(() => document.querySelectorAll('#iv-saved tr[data-id]').length === 1);
    if ((await tableIds())[0] !== seed.ivNeutral.page) throw new Error('searching "beta" did not leave the Beta interview');
    await page.fill('#iv-filter', 'zzz-no-such-interview');
    await page.waitForFunction(() => !document.getElementById('iv-empty').hidden);
    if (!/No interview matches/.test(await page.locator('#iv-empty').innerText())) throw new Error('an empty search does not say that nothing matches');
    await page.fill('#iv-filter', '');
    await page.selectOption('#iv-outcome', 'none');
    await page.waitForFunction(() => document.querySelectorAll('#iv-saved tr[data-id]').length === 1);
    if ((await tableIds())[0] !== seed.ivFresh.page) throw new Error('"Not reviewed" did not leave the one unreviewed interview');
    await page.selectOption('#iv-outcome', 'negative');
    await page.waitForFunction(() => document.querySelectorAll('#iv-saved tr[data-id]').length === 1);
    await page.selectOption('#iv-outcome', '');
    await page.waitForFunction(() => document.querySelectorAll('#iv-saved tr[data-id]').length === 4);
  });

  // On Notion "Open review" opens the interview's page; on this Mac's store there is none, so it opens the review in the app (renderer/interview-review-view.js, #review-dialog).
  await step(ctx.store === 'sqlite' ? 'a reviewed row opens its review in the app' : 'a reviewed row opens its review in Notion', async () => {
    await openInterviews(4);
    await external.clear();
    await row(seed.ivPositive.page).getByRole('button', {name: 'Open review'}).click();
    if (ctx.store === 'sqlite') {
      const dialog = page.locator('#review-dialog[open]');
      await dialog.waitFor({timeout: 15000}).catch(() => { throw new Error('"Open review" opened no review in the app'); });
      const text = await dialog.innerText();
      if (!/E2E Acme · Round 1/.test(text) || !/SEED summary ivPositive/.test(text)) throw new Error(`the review shown is not this interview's: "${text.slice(0, 160)}"`);
      if ((await external.urls()).length) throw new Error(`"Open review" also opened ${JSON.stringify(await external.urls())} outside the app`);
      await page.keyboard.press('Escape');
      await page.locator('#review-dialog[open]').waitFor({state: 'detached', timeout: 5000}).catch(async () => {
        if (await page.locator('#review-dialog').evaluate(dialog => dialog.open)) throw new Error('the review stayed open after Escape');
      });
    } else {
      await page.waitForTimeout(500);
      const opened = await external.urls();
      if (!opened.some(url => url.includes(ids(seed.ivPositive.page)))) throw new Error(`"Open review" opened ${JSON.stringify(opened)}, not the interview's Notion page`);
    }
  });

  await step('Record stays off until everyone has agreed, and says why', async () => {
    await openInterviews();
    const record = page.locator('#iv-record');
    if (!(await record.isDisabled())) throw new Error('Record is enabled before the consent box is ticked');
    if (!/everyone on the call agreed/i.test(await record.getAttribute('title') || '')) throw new Error(`the disabled Record button gives no reason: title "${await record.getAttribute('title')}"`);
    if (!/Recording consent required/.test(await page.locator('#iv-consent-box').innerText())) throw new Error('the consent notice is not on the page');
    await page.check('#iv-consent');
    if (await record.isDisabled()) throw new Error('Record stays disabled after the consent box is ticked');
    await page.uncheck('#iv-consent');
    if (!(await record.isDisabled())) throw new Error('Record is still enabled after the consent box is unticked');
  });

  // The one-time setup (add-on + speech models) shows a banner only on a Mac without the models, and a test run never starts that setup (desktop/lib/e2e-host.js prefetchForRun, 29 Oct 2026): send the app's own progress events instead,
  // so the banner is on screen for the checks and the screenshot review (it was invisible to them, and its spinner was stretched, 6 Oct 2026).
  await step('the one-time setup banner shows its step and percent, then goes away when transcribing starts', async () => {
    await openInterviews();
    const send = payload => app.evaluate(({BrowserWindow}, data) => BrowserWindow.getAllWindows()[0].webContents.send('ivProgress', data), payload);
    const banner = () => page.evaluate(() => ({shown: !document.getElementById('iv-setup').hidden, text: document.getElementById('iv-setup-text').textContent,
      bar: document.getElementById('iv-setup-bar').hidden ? null : document.getElementById('iv-setup-fill').style.width}));
    await send({id: 'setup', percent: 40, setup: true, text: 'Downloading the speech models, only the first time (about 520 MB): asr'});
    await page.waitForFunction(() => !document.getElementById('iv-setup').hidden, null, {timeout: 5000});
    const downloading = await banner();
    if (!/asr 40%/.test(downloading.text) || downloading.bar !== '40%') throw new Error(`the setup banner shows "${downloading.text}" with a bar of ${downloading.bar}, expected asr 40% and 40%`);
    await snap(ctx, 'interviews-setup', {view: 'interviews', busy: true, situation: 'The one-time transcription setup banner at the top of Interviews, downloading the speech models at 40% (a spinner, one line of text, a progress bar)'});
    await send({id: 'setup', percent: null, setup: true, text: 'Unpacking the speech models (asr), a minute or two'});
    await page.waitForFunction(() => document.getElementById('iv-setup-bar').hidden, null, {timeout: 5000});
    await send({id: 'x', percent: 10, text: 'Writing down what was said'});
    await page.waitForFunction(() => document.getElementById('iv-setup').hidden, null, {timeout: 5000});
  });

  await step('an interview can be linked to a job and unlinked again, and Notion follows', async () => {
    await openInterviews(4);
    await row(seed.ivNegative.page).getByRole('button', {name: 'Link a job'}).click();
    const select = row(seed.ivNegative.page).locator('.iv-picker select');
    await select.waitFor({state: 'visible'});
    await select.selectOption(seed.beta.url);
    await page.waitForFunction(() => /is now linked to that job/.test(document.getElementById('iv-message').textContent), null, {timeout: 120000});
    let linked = (await interviewOf(seed.ivNegative.page))?.app_id;
    if (!sameId(linked, seed.beta.id)) throw new Error(`the store links the interview to ${JSON.stringify(linked)}, expected the Beta job ${seed.beta.id}`);
    // The re-drawn row shows the job as its link (the cell's innerText also holds the old picker's options, so it said "Beta" before the re-draw),
    // and its picker is hidden again: unlink as a person does, ⋯ → Change job…, again if a later re-draw hides it (Windows, 6 Oct 2026).
    await page.waitForFunction(id => /Beta/.test(document.querySelector(`#iv-saved tr[data-id="${id}"] .lib-who button.link`)?.textContent || ''), seed.ivNegative.page, {timeout: 60000});
    for (let attempt = 0; ; attempt++) {
      await chooseFromMenu(seed.ivNegative.page, 'Change job');
      if (await row(seed.ivNegative.page).locator('.iv-picker select').selectOption('', {timeout: 5000}).then(() => true, () => false)) break;
      if (attempt === 4) throw new Error('the job picker never stayed open long enough to unlink');
    }
    await page.waitForFunction(() => /not linked to a job/.test(document.getElementById('iv-message').textContent), null, {timeout: 120000});
    linked = (await interviewOf(seed.ivNegative.page))?.app_id;
    if (linked) throw new Error('the store still links the interview to a job after it was unlinked');
  });

  await step('a transcript that fails to review leaves one saved row, not reviewed, and a clear message', () => ctx.withApi(async () => {   // the proxy's refusal needs the API engine (dummy key)
    const file = path.join(ctx.profile, 'recruiter-call-failing.txt');
    fs.writeFileSync(file, TRANSCRIPT);
    const before = (await notionRows()).length;
    await pickFile(app, file);
    await openInterviews();
    await page.click('#iv-add');
    await page.locator('#iv-ready').waitFor({state: 'visible', timeout: 90000});
    if (!(await page.inputValue('#iv-text')).includes('Terraform at scale')) throw new Error('the imported transcript is not in the editor');
    await pickJob(page.locator('#iv-job'), seed.gamma.url);
    proxy.setMode('no-credit');
    const callsBefore = proxy.stats.calls;
    try {
      await page.click('#iv-save-review');
      await page.waitForFunction(want => document.getElementById('iv-message').textContent.includes(want) || document.getElementById('iv-message').classList.contains('error'), SAVED_TO, {timeout: 60000});
      await page.waitForFunction(() => document.getElementById('iv-message').classList.contains('error') && !/Saving|reviewing the interview/.test(document.getElementById('iv-message').textContent), null, {timeout: 240000});
    } finally { proxy.setMode('pass'); }
    const said = (await message()).trim();
    console.log(`  the page said: ${said.slice(0, 160)}`);
    if (proxy.stats.calls === callsBefore) throw new Error('the review never reached the AI path (test setup)');
    if (!said || /Traceback|\{'type'|\{"type"|BadRequestError|Error code|undefined|\[object/.test(said)) throw new Error(`the failure message is not a clear sentence: "${said.slice(0, 200)}"`);
    const after = await notionRows();
    if (after.length !== before + 1) throw new Error(`Notion has ${after.length} interviews after the failed review, expected ${before + 1} (the saved transcript, once)`);
    const saved = byTitle(after, 'recruiter-call-failing') || after.find(item => !seed.page && String(item.title || '').includes('failing'));
    if (!saved) throw new Error('the saved transcript is not in the store');
    if ((await interviewOf(saved.id))?.overall) throw new Error('the interview has an outcome although its review failed');
    const headings = await reviewHeadings(saved.id);
    if (headings.some(text => ['Strengths', 'Questions', 'Weak spots'].includes(text))) throw new Error(`a half-written review was saved: ${headings}`);
    if (!/Terraform at scale/.test((await interviewOf(saved.id))?.transcript || '')) throw new Error('the saved row lost its transcript');
    seed.failed = {page: saved.id};
    await page.waitForFunction(id => /^Review$/.test(document.querySelector(`#iv-saved tr[data-id="${id}"] .iv-main`)?.textContent.trim() || ''), saved.id, {timeout: 60000}).catch(() => {});
    const label = (await row(saved.id).locator('.iv-main').innerText()).trim();
    if (label !== 'Review') throw new Error(`the row's button says "${label}" after the failure, so it cannot be retried`);
  }));

  await step('a transcript imported through the page is reviewed for real: outcome, strengths, next step, the right job, and the insights follow', async () => {
    const file = path.join(ctx.profile, 'recruiter-call-gamma.txt');
    fs.writeFileSync(file, TRANSCRIPT);
    const before = await notionRows();
    await pickFile(app, file);
    await openInterviews();
    await page.click('#iv-add');
    await page.locator('#iv-ready').waitFor({state: 'visible', timeout: 90000});
    await pickJob(page.locator('#iv-job'), seed.gamma.url);
    const calls = proxy.stats.calls;
    await page.click('#iv-save-review');
    await page.waitForFunction(done => { const text = document.getElementById('iv-message').textContent; return (text.includes(done) || /failed|Could not|error/i.test(text)) && !/reviewing the interview/.test(text); }, REVIEW_DONE,
      {timeout: REVIEW_MS, polling: 2000});
    const said = (await message()).trim();
    if (!said.includes(REVIEW_DONE)) throw new Error(`the review did not finish: "${said.slice(0, 240)}"`);
    const after = await notionRows();
    const added = after.filter(item => !before.some(old => old.id === item.id));
    if (added.length !== 1) throw new Error(`${added.length} new interview rows in the store after one import, expected 1`);
    const saved = added[0];
    seed.imported = {page: saved.id};
    const overall = (await interviewOf(saved.id))?.overall;
    if (!['positive', 'neutral', 'negative'].includes(overall)) throw new Error(`the row has no outcome (Overall "${overall}")`);
    const reviewed = await interviewOf(saved.id);
    if (!sameId(reviewed?.app_id, seed.gamma.id)) throw new Error('the interview is not linked to the Gamma job that was chosen');
    if (!String(reviewed?.next_step || '').trim()) throw new Error('the review has no next step although the call names one');
    const headings = await reviewHeadings(saved.id);
    for (const wanted of ['Strengths', 'Questions']) if (!headings.includes(wanted)) throw new Error(`the review has no "${wanted}" section: ${headings}`);
    if (!headings.some(text => ['Weak spots', 'Practise before the next round'].includes(text))) throw new Error(`the review names no gap and no practice step: ${headings}`);
    console.log(`  reviewed: ${overall}; ${proxy.stats.calls - calls} AI call(s); sections: ${headings.join(', ')}`);
    await page.waitForFunction(id => /Positive|Neutral|Negative/.test(document.querySelector(`#iv-saved tr[data-id="${id}"] td:nth-child(5)`)?.innerText || ''), saved.id, {timeout: 90000});
    // The insights card appears (reviewed interviews exist) and the review's own refresh wrote the "Interview patterns" row.
    await page.waitForFunction(() => !document.getElementById('iv-insight').hidden, null, {timeout: 60000});
    const patterns = ((await ctx.data('insights', 'list', {category: 'Interview patterns'})) || []).filter(item => item.category === 'Interview patterns');
    if (patterns.length !== 1) throw new Error(`${patterns.length} "Interview patterns" insights in the store, expected exactly 1`);
    await snap(ctx, 'interviews-reviewed', {situation: 'After importing a transcript and reviewing it: the library with the new outcome, and the Insights card'});
  });

  await step('Review again right after a review starts nothing: no second call, no duplicate row, no duplicate review', async () => {
    if (!seed.imported) throw new Error('needs the imported interview of the previous step');
    if (ctx.engine !== 'api') return console.log('  not checked on Claude Code: this step counts AI calls at the proxy, which Claude Code does not use (CI checks it)');
    await openInterviews();
    const before = await notionRows();
    const calls = proxy.stats.calls;
    await chooseFromMenu(seed.imported.page, 'Review again');
    await page.waitForFunction(() => !/reviewing the interview again/.test(document.getElementById('iv-message').textContent) && document.getElementById('iv-message').textContent.trim() !== '', null, {timeout: 60000});
    const said = (await message()).trim();
    await page.waitForTimeout(3000);
    if (proxy.stats.calls !== calls) throw new Error(`a second review started within the guard window: ${proxy.stats.calls - calls} AI call(s)`);
    if ((await notionRows()).length !== before.length) throw new Error('Review again added or removed an interview row');
    const headings = await reviewHeadings(seed.imported.page);
    if (headings.filter(text => text === 'Questions').length !== 1) throw new Error(`the review is on the page ${headings.filter(text => text === 'Questions').length} times`);
    if (/was replaced/.test(said)) throw new Error(`the page claims "${said}" although no review ran`);
  });

  await step('Review again on an older review replaces it: same row, one review, the old text gone', async () => {
    await openInterviews();
    const before = await notionRows();
    const calls = proxy.stats.calls;
    await chooseFromMenu(seed.ivPositive.page, 'Review again');
    await page.waitForFunction(() => /was replaced|failed/i.test(document.getElementById('iv-message').textContent), null, {timeout: REVIEW_MS, polling: 2000});
    const said = (await message()).trim();
    if (!/was replaced/.test(said)) throw new Error(`review again did not finish: "${said.slice(0, 240)}"`);
    if (ctx.engine === 'api' && proxy.stats.calls === calls) throw new Error('review again made no AI call');   // Claude Code does not go through the proxy; "was replaced" above proves a review ran
    const after = await notionRows();
    if (after.length !== before.length) throw new Error(`review again changed the number of rows: ${before.length} → ${after.length}`);
    const again = await interviewOf(seed.ivPositive.page);
    if (/SEED/.test(again?.review || '')) throw new Error('the old (seeded) review text is still in the review');
    for (const heading of ['Strengths', 'Questions']) {
      const count = headingsOf(again?.review).filter(text => text === heading).length;
      if (count !== 1) throw new Error(`"${heading}" is in the review ${count} times after review again`);
    }
    if (!/Terraform at scale/.test(again?.transcript || '')) throw new Error('review again lost the transcript');
  });

  await step('Refresh insights without a new review says it is up to date and spends nothing', async () => {
    await openInterviews();
    await page.waitForFunction(() => !document.getElementById('iv-insight').hidden, null, {timeout: 60000});
    // The review above changed a row: one refresh brings the card up to date, the next one finds nothing to do.
    const refresh = page.locator('.iv-insight-refresh');
    await refresh.click();
    await page.waitForFunction(() => !document.querySelector('.iv-insight-refresh')?.disabled, null, {timeout: REVIEW_MS, polling: 2000});
    const calls = proxy.stats.calls;
    await refresh.click();
    await page.waitForFunction(() => /up to date/i.test(document.getElementById('iv-message').textContent), null, {timeout: 120000}).catch(async () => {
      // On the stand-in store with the API engine (CI) this step never saw "up to date" (12 Oct 2026); on Claude Code it does. Say what the page and the proxy saw.
      const said = ((await page.locator('#iv-message').textContent().catch(() => '')) || '').replace(/\s+/g, ' ').trim().slice(0, 240);
      const busy = await refresh.isDisabled().catch(() => null);
      throw new Error(`the second refresh never said "up to date" in 2 minutes; the page says "${said}"; the button is ${busy ? 'still busy' : 'free'}; AI calls since the first refresh ended: ${proxy.stats.calls - calls}`);
    });
    if (proxy.stats.calls !== calls) throw new Error('a refresh with nothing changed still called the AI');
  });

  await step('Delete moves an interview to the Notion trash and takes it off the page', async () => {
    await openInterviews();
    const target = seed.ivNeutral.page;
    const before = (await notionRows()).length;
    await chooseFromMenu(target, /^Delete$/);
    await page.waitForFunction(id => !document.querySelector(`#iv-saved tr[data-id="${id}"]`), target, {timeout: 120000});
    if (!/Deleted/.test(await message())) throw new Error(`no confirmation after deleting: "${(await message()).trim()}"`);
    const after = await notionRows();
    if (after.length !== before - 1 || after.some(item => item.id === target)) throw new Error('the interview is still in the store after Delete');
  });

  await step('Interviews renders without layout problems', async () => { finish(ctx); });
  end();
}
