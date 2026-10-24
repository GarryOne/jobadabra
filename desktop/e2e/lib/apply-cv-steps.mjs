/* global document, window */
// The apply suite's tailored-CV steps (moved out of suites/apply.mjs, 8 Oct 2026): Tailor CV on a job, the panel's offer, Tailor CVs for top matches, Apply without a kit. Guards the CV flow in docs/flows/applying.md.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {FORMS} from './forms.mjs';
import {POSTING, pause} from './apply-fixtures.mjs';
import {addKitJob, removeJobsByUrl, tailoredFiles} from './seed-data.mjs';
import {cvProblems} from './applycheck.mjs';
import {readForm, readPanel} from './extension.mjs';
import {showFilter} from './jobs-filter.mjs';

export async function runCvSteps(ctx, h) {
  const {apply, cv, fail, page, panelOf, proxy} = h;
  await ctx.run('Tailor CV on a job writes a CV from its posting: the PDF on this Mac, the file on the job in Notion, and the extension attaches it, not the base CV', async () => {
    const form = FORMS.greenhouse;
    const code = crypto.createHash('sha1').update(form.url.trim()).digest('hex').slice(0, 8);
    const tailoredPdf = path.join(ctx.profile, 'cv', 'tailored', `${code}.pdf`);
    await page.click('.nav[data-view="jobs"]');
    // Under "Everything", whatever filter an earlier step left on the list: this job is Opened/Form filled by now and is not under "New matches" (10 Oct 2026: Windows CI,
    // "waiting for the More actions button of E2E Greenhouse Labs" for 30 s, the list showing other jobs).
    await showFilter(page, 'everything');
    await page.locator('article.job-row').filter({hasText: form.company}).first().waitFor({timeout: 60000})
      .catch(() => { throw new Error(`${form.company} is not in the Jobs list even under Everything`); });
    // The list redraws while sessions update, which closes an open ⋯ menu: open it again until the item is there.
    let items = [];
    for (let attempt = 0; attempt < 8; attempt++) {
      await page.locator('article.job-row').filter({hasText: form.company}).first().getByRole('button', {name: 'More actions'}).click();
      await pause(600);
      items = await page.getByRole('menuitem').allInnerTexts();
      if (items.some(text => /Tailor CV/.test(text))) break;
    }
    if (!items.some(text => /Tailor CV/.test(text))) throw new Error(`the ⋯ menu of ${form.company} has no Tailor CV (it lists: ${items.join(' | ') || 'nothing'})`);
    await page.getByRole('menuitem', {name: /Tailor CV/}).click();
    for (let waited = 0; !fs.existsSync(tailoredPdf) && waited < 120000; waited += 1000) await pause(1000);
    if (!fs.existsSync(tailoredPdf)) throw new Error('Tailor CV wrote no PDF within two minutes (see the "Tailoring failed" toast)');
    const size = fs.statSync(tailoredPdf).size;
    if (size === cv.size) throw new Error('the tailored PDF is the size of the base CV: it was not written from the posting');
    let files = 0;
    for (let i = 0; i < 10 && !files; i++) { files = await tailoredFiles(ctx, form.url); if (!files) await pause(3000); }
    if (!files) throw new Error(ctx.store === 'sqlite' ? 'the tailored CV is not among the job\'s files in this Mac\'s store (applications.attach)' : 'the tailored CV is not on the job\'s row in Notion (column "Tailored CV")');
    const {tab, state} = await apply(form, {viaApi: true});
    if (state.state === 'error') throw new Error(`the fill ended in an error: ${state.error}`);
    fail(cvProblems(await readForm(tab), {name: 'CV_Ada_Tester_E2E_Greenhouse_Labs.pdf', size}));   // the tailored file's bytes, under its own name: the form shows which CV it got
  }, {needs: ctx.needs});

  await ctx.run('the form\'s panel offers a tailored CV: asked there, it is written, and filling again attaches it under its own name', async () => {
    const form = FORMS.lever;
    const code = crypto.createHash('sha1').update(form.url.trim()).digest('hex').slice(0, 8);
    const tailoredPdf = path.join(ctx.profile, 'cv', 'tailored', `${code}.pdf`);
    fs.rmSync(tailoredPdf, {force: true});
    const {tab, state} = await apply(form, {viaApi: true});
    if (state.state === 'error') throw new Error(`the fill ended in an error: ${state.error}`);
    let panel = await panelOf(tab);
    for (let i = 0; i < 10 && !/general CV/i.test(panel?.tailor || ''); i++) { await pause(1500); panel = await readPanel(tab); }
    // The panel says "General CV attached" while it offers the tailoring (extension/review.js): matched without case, so a capital never reads as no offer (stale since 18 Oct 2026).
    // The offer needs a session, the app connected, the CV state and no account page (extension/review.js canTailor): the panel's other lines say which is missing.
    if (!/general CV/i.test(panel?.tailor || '')) throw new Error(`the panel does not offer a tailored CV (its tailor line: "${panel?.tailor}"; the panel: ${JSON.stringify({pill: panel?.pill, progress: panel?.progress, note: panel?.note, foot: panel?.foot, fill: panel?.fillLabel})})`);
    await tab.locator('#jobpilotto-review-host .t-btn').click();
    for (let waited = 0; !fs.existsSync(tailoredPdf) && waited < 120000; waited += 1000) await pause(1000);
    if (!fs.existsSync(tailoredPdf)) throw new Error('asking from the panel wrote no tailored CV within two minutes');
    for (let i = 0; i < 20 && !/ready/.test(panel?.tailor || ''); i++) { await pause(1500); panel = await readPanel(tab); }
    if (!/ready/.test(panel?.tailor || '')) throw new Error(`the panel never said the tailored CV is ready (its tailor line: "${panel?.tailor}")`);
    await tab.locator('#jobpilotto-review-host .fill').click();
    // Done when the form holds the tailored CV, or when the fill pressed here is over (the panel's Fill is disabled while it runs). Never the page's
    // fill state: only the hand-off writes it, so it still said "done" from the first fill and ended the wait 2.5 s after the press, before a slower
    // fill reached the upload (gate run 38251424138, seed 3891685770: a late field, the SQLite store; cv.pdf read while the second fill ran).
    const expected = {name: 'CV_Ada_Tester_E2E_Lever_Systems.pdf', size: fs.statSync(tailoredPdf).size};
    for (let waited = 0; waited < 90000; waited += 500) {
      await pause(500);
      if (!cvProblems(await readForm(tab).catch(() => ({})), expected).length || (waited >= 1000 && !(await readPanel(tab).catch(() => null))?.filling)) break;
    }
    const after = await readPanel(tab).catch(() => null);
    fail(cvProblems(await readForm(tab), expected).map(problem => (after?.note ? `${problem} (the panel says: "${after.note}")` : problem)));
  }, {needs: ctx.needs});

  // Tailor CVs for top matches (Actions): the best open jobs without a tailored CV, in fit order, only as many as asked. The stand-in AI answers the tailoring.
  const topUrls = [1, 2, 3].map(n => `https://boards.greenhouse.io/e2e-top/jobs/90000${n}`);
  const bareUrl = 'https://boards.greenhouse.io/e2e-no-such-board/jobs/900010';   // the kitless step's Saved job: a run that stopped inside that step leaves it
  const codeOf = url => crypto.createHash('sha1').update(url.trim()).digest('hex').slice(0, 8);
  const tailoredAt = url => path.join(ctx.profile, 'cv', 'tailored', `${codeOf(url)}.pdf`);
    await ctx.run('Tailor CVs for top matches: asked for 2, it tailors the two best open jobs without a CV, in fit order, and leaves the third alone', async () => {
    // Rows an earlier run left behind, the kitless step's Saved job too: a Saved job is picked before any fit (beta 9 Oct 2026, the apply page: it took a slot).
    await removeJobsByUrl(ctx, [...topUrls, bareUrl]);
    const added = [];
    for (const [index, fit] of [99, 98, 97].entries()) added.push((await addKitJob(ctx, {title: `Platform Engineer ${index + 1}`, company: `E2E Top ${index + 1}`, url: topUrls[index], fit,
      kit: {answers: [], cover_letter: '', check_before_sending: []}, description: POSTING})).id.replace(/-/g, ''));
    await page.reload();
    await page.waitForSelector('.view:not([hidden])', {timeout: 60000});
    await page.click('.nav[data-view="jobs"]');
    // The NEW rows, by the store's id (6 Oct 2026: the saved list painted on reload still held the rows just archived, same URLs; Tailor then wrote to an archived page).
    // page_id is the store's id on every store (src.desktop jobs); notion_url only on Notion.
    await page.waitForFunction(ids => ids.every(id => (window.__jp.shared.allJobs || []).some(job => String(job.page_id || job.notion_url || '').replace(/-/g, '').includes(id))), added, {timeout: 120000, polling: 2000})
      .catch(async () => {
        const held = await page.evaluate(urls => (window.__jp.shared.allJobs || []).filter(job => urls.includes(job.url)).map(job => `${job.url.slice(-6)} → ${String(job.page_id || job.notion_url || 'no store id').slice(-32)}`), topUrls);
        throw new Error(`the Jobs list never showed the three new top-match rows ${added.map(id => id.slice(-8)).join(', ')}; it holds: ${held.join(' | ') || 'none of their URLs'}`);
      });
    // The premise: no other open job without a CV is saved or fits above 98 (else it rightly takes a slot and the step proves nothing).
    const rivals = await page.evaluate(urls => (window.__jp.shared.allJobs || []).filter(job => !urls.includes(job.url) && ['unreviewed', 'saved'].includes(job.status) && !job.tailored
      && (job.status === 'saved' || (job.fit ?? -1) >= 98)).map(job => `${job.title} (${job.status}, fit ${job.fit})`), topUrls);
    if (rivals.length) throw new Error(`other open jobs without a CV would be picked first: ${rivals.join(' | ')}`);
    await page.click('.nav[data-view="actions"]');
    if (await page.locator('[data-command="kits"]').count()) throw new Error('Prepare top matches is still on the Actions page');
    await page.fill('#tailor-top-n', '2');
    // HELD by the test: the stand-in's tailoring answers only once the running task was looked at (Run off, View activity), else the task can be over first
    // (12 Oct 2026, seed 3891685770: two CVs in 6.1 s, the clicks below took 6.6 s, and Run was rightly on again when it was checked).
    let release;
    ctx.tailorHold = new Promise(resolve => { release = resolve; });
    console.log('  HELD by the test: the tailoring answers once Run is checked off');
    try {
      await page.click('#tailor-top');
      // A tracked task: the banner follows it and Recent activity holds its row, with the result line as its summary.
      await page.waitForFunction(() => /Tailor CV \+ cover letter/.test(document.getElementById('run-banner-title')?.textContent || '') && !document.getElementById('run-banner')?.hidden, null, {timeout: 60000, polling: 500})
        .catch(() => { throw new Error('the Actions banner never showed Tailor CVs running'); });
      // "View activity" on the banner opens the RUNNING task, even when a finished row was open before.
      await page.click('#run-banner-view');
      const finished = page.locator('#activity-recent .recent-row').filter({hasNotText: 'Running'}).first();
      if (await finished.count()) { await finished.click(); await page.click('#activity-toggle').catch(() => {}); }
      await page.click('#run-banner-view');
      await page.waitForFunction(() => /Running/.test(document.querySelector('#activity-recent .recent-row.current')?.textContent || ''), null, {timeout: 10000})
        .catch(() => { throw new Error('"View activity" did not open the running Tailor CVs task'); });
      if (!(await page.locator('#tailor-top').isDisabled())) throw new Error('Run is still pressable while Tailor CVs is running');
    } finally { ctx.tailorHold = null; release(); }
    let said = '';
    for (let waited = 0; !/Tailored \d+ of \d+ CV/.test(said) && waited < 420000; waited += 3000) {
      await pause(3000);
      said = await page.evaluate(async () => ((await window.pilot.runs()).runs || []).find(run => run.kind === 'tailor')?.summary || '');
    }
    await page.waitForFunction(() => !document.getElementById('tailor-top').disabled, null, {timeout: 20000}).catch(() => { throw new Error('Run stayed disabled after Tailor CVs ended'); });
    if (!/Tailored 2 of 2 CVs/.test(said)) throw new Error(`Recent activity has no Tailor CVs run that says two CVs were tailored: "${said}"`);
    const made = topUrls.map(url => fs.existsSync(tailoredAt(url)));
    if (made.join() !== 'true,true,false') throw new Error(`expected CVs for the 99 and 98 fit jobs only, got ${JSON.stringify(Object.fromEntries(topUrls.map((url, i) => [url.slice(-6), made[i]])))}`);
    await page.reload();   // the list is read again from Notion, where the CVs now sit on their rows
    await page.waitForSelector('.view:not([hidden])', {timeout: 60000});
    await page.click('.nav[data-view="jobs"]');
    await page.waitForFunction(urls => { const jobs = window.__jp.shared.allJobs || []; return jobs.filter(job => urls.includes(job.url) && job.tailored).length === 2; }, topUrls, {timeout: 90000, polling: 2000})
      .catch(() => { throw new Error('the Jobs list does not show 📄 Tailored CV on the two jobs'); });
    await removeJobsByUrl(ctx, topUrls);
  }, {needs: ctx.needs});

  // One Apply button (5 Oct 2026): pressed on a saved job with no kit, it drafts the kit first. Here the AI answers every call with a server error, so the draft cannot
  // be made: the button must say so ("Retry apply"), no form may open, and the job stays without a kit. The success path needs a form to read (not faked here).
  // (A board that does not exist is not enough: an unreadable form still gets a kit from the posting, src/ai/kit.py prepare_one; the gate of 6 Oct 2026 drafted one.)
  await ctx.run('Apply on a saved job without a kit: it prepares first, and when the kit cannot be drafted says Retry apply and opens nothing', async () => {
    await removeJobsByUrl(ctx, [bareUrl]);
    await addKitJob(ctx, {title: 'Bare Platform Engineer', company: 'E2E Bare', url: bareUrl, kit: null, fit: 60, stage: 'Saved', nextStep: '', description: POSTING});
    await page.reload();
    await page.waitForSelector('.view:not([hidden])', {timeout: 60000});
    await page.click('.nav[data-view="jobs"]');
    await showFilter(page, 'saved');   // Saved jobs are not in the default "New matches"
    const rowText = () => page.evaluate(() => [...document.querySelectorAll('article.job-row')].filter(row => /E2E Bare/.test(row.textContent)).map(row => row.querySelector('.row-main')?.textContent.trim())[0] || '');
    for (let waited = 0; !(await rowText()) && waited < 120000; waited += 2000) await pause(2000);
    if ((await rowText()) !== 'Apply') throw new Error(`a saved job without a kit should show Apply, it shows "${await rowText()}"`);
    const opened = ctx.browser.opened.length, asked = proxy.stats.calls;
    proxy.setMode('server-error');
    try {
      await page.locator('article.job-row').filter({hasText: 'E2E Bare'}).first().locator('.row-main').click();
      for (let waited = 0; (await rowText()) !== 'Retry apply' && waited < 180000; waited += 1000) {
        if (ctx.browser.opened.length !== opened) throw new Error('a form was opened for a job whose kit was never drafted');
        await pause(1000);
      }
    } finally { proxy.setMode('pass'); }
    if (proxy.stats.calls === asked) throw new Error('the AI was never asked to draft the kit, so this step did not test a failed draft');
    if ((await rowText()) !== 'Retry apply') throw new Error(`the button never said Retry apply (it says "${await rowText()}")`);
    if (ctx.browser.opened.length !== opened) throw new Error('a form was opened for a job whose kit was never drafted');
    await removeJobsByUrl(ctx, [bareUrl]);
  }, {needs: ctx.needs});
}
