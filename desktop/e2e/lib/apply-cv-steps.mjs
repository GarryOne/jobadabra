// The apply suite's tailored-CV steps (moved out of suites/apply.mjs, 8 Oct 2026): Apply without a kit. Guards the CV flow in docs/flows/applying.md.
// Job: wait on state
import {POSTING} from './apply-fixtures.mjs';
import {addKitJob, removeJobsByUrl} from './seed-data.mjs';
import {showFilter} from './jobs-filter.mjs';

export async function runCvSteps(ctx, h) {
  const {page, proxy, until} = h;
  // Why (1 Nov 2026, owner: "Only tier 1 … should stay e2e"): the two Tailor steps (Tailor CV on a job, Tailor on the session page; night journey J8, Tier 2) are integration tests now:
  // desktop/integration/store/tailored-cv.test.mjs (what the app hands the form, the restart) and integration/extension/extension-form-shapes.test.mjs (the extension attaches it).
  // Why (1 Nov 2026, same ask): "Tailor CVs for top matches" (the bulk Tailor, J8) is desktop/integration/store/tailor-top-matches.test.mjs: the real store lists the jobs, the picker takes the best N without a CV.

  const bareUrl = 'https://boards.greenhouse.io/e2e-no-such-board/jobs/900010';   // the kitless step's Saved job: a run that stopped inside that step leaves it

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
    const row = page.locator(`article.job-row[data-url=${JSON.stringify(bareUrl)}]`);
    const rowText = () => row.locator('.row-main').textContent({timeout: 120000}).then(text => text.trim());
    if ((await rowText()) !== 'Apply') throw new Error(`a saved job without a kit should show Apply, it shows "${await rowText()}"`);
    const opened = ctx.browser.opened.length, asked = proxy.stats.calls;
    proxy.setMode('server-error');
    try {
      await row.locator('.row-main').click();
      await until('the button never said Retry apply', async () => {
        if (ctx.browser.opened.length !== opened) throw new Error('a form was opened for a job whose kit was never drafted');
        return (await rowText()) === 'Retry apply';
      }, 180000);
    } finally { proxy.setMode('pass'); }
    if (proxy.stats.calls === asked) throw new Error('the AI was never asked to draft the kit, so this step did not test a failed draft');
    if ((await rowText()) !== 'Retry apply') throw new Error(`the button never said Retry apply (it says "${await rowText()}")`);
    if (ctx.browser.opened.length !== opened) throw new Error('a form was opened for a job whose kit was never drafted');
    await removeJobsByUrl(ctx, [bareUrl]);
  }, {needs: ctx.needs});
}
