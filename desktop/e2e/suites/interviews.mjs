/* global document, window */
// Job: wait on state
// Interviews: what needs the real app: the one-time setup banner, link and unlink a job (night journey J18) and Delete (the id the page sends reaches the store). Starts from a set-up install;
// resets only its own rows. Reviews, review again and Refresh insights are desktop/integration/store/interviews-flow.test.mjs.
// Why (1 Nov 2026, owner: "the beta [keeps] only the critical e2e/user journeys"): the library's screens (list, job names, filters, Open review, the consent rule, Delete) are
// desktop/integration/app/screen-interviews.test.js; the Calendar is screen-calendar.test.js.
import {TRANSCRIPT, addDays} from '../lib/interview-data.mjs';
import {addInterview, addTrackedJob} from '../lib/seed-data.mjs';
import {clearData} from '../lib/start-state.mjs';
import {finish, snap} from '../lib/layout.mjs';
import {ensureSetUp} from '../lib/seed.mjs';
import {answerConfirms, independent} from '../lib/steps.mjs';
import {goView} from '../lib/go-view.mjs';
import {stepWait} from '../lib/wait-on-state.mjs';

// Why (29 Oct 2026, ap): rule A serves declared reviews and patterns; the no-credit fault still precedes the table.
export const offlineAi = true;
export const realAi = false;
export const aiAnswers = 'backbone';   // answers its AI from the stored table in every workflow (plan-run.mjs puts it in the matrix)
export const name = 'interviews';
// Why (30 Oct 2026, ap): SQLite keeps stored answers on one setup path without the stand-in's paced Notion requests; all steps support SQLite.
export const store = 'sqlite';

export async function run(ctx) {
  const {page, app} = ctx;
  // Where the library says it is kept (renderer/pages/interviews.js savedTo): Notion's database, or the app itself on this Mac's store.
  const SAVED_TO = ctx.store === 'sqlite' ? 'Saved in Jobadabra' : 'Saved to Notion 🎤 Interviews';
  ctx.findings = [];
  const {step, end} = independent(ctx);
  const today = new Date().toISOString().slice(0, 10);
  const seed = {};
  const message = () => page.locator('#iv-message').innerText();
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
    // The library paints its saved copy first and re-draws when Notion answers: act only once that is done, so the rows the test reads are the final ones.
    await stepWait('the interview library showed its saved count', timeout => page.waitForFunction(want => document.getElementById('iv-lib-stats').textContent.trim() === want, SAVED_TO, {timeout}));
  };
  // A re-draw of the table (a read finishing) keeps an open ⋯ menu (components.js holdMenu; 31 Oct 2026): open it once and click.
  const chooseFromMenu = async (id, label) => {
    await row(id).getByRole('button', {name: 'More actions'}).click();
    await page.locator('[role=menuitem]:visible').filter({hasText: label}).first().click()
      .catch(() => { throw new Error(`the ⋯ menu of the row never showed "${label}"`); });
  };
  // The interviews as the store keeps them (any store): {id, title, overall, next_step, app_id, transcript, review}; transcript and review are whole Markdown (spec §4).
  const notionRows = async () => (await ctx.data('interviews', 'list', {})) || [];
  const interviewOf = id => ctx.data('interviews', 'get', {interview_id: id});
  const sameId = (a, b) => String(a || '').replace(/-/g, '') === String(b || '').replace(/-/g, '');

  await ensureSetUp(ctx);
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

  // Why (R2, 1 Nov 2026, owner: "only the critical e2e/user journeys"): the failed review, the imported and reviewed transcript, Review again (right after, and on an older review) and Refresh insights
  // moved to desktop/integration/store/interviews-flow.test.mjs and desktop/test/interview-review-window.test.js, which run on every PR touching Interviews. Kept here: the setup banner (sent by the main process),
  // link and unlink (night journey J18) and Delete (the id the page sends).
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
