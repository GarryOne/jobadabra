/* global window */
// The Notion part of the failure checks (the step failuresnotion runs): a Save that Notion refuses is never shown as saved. Moved out of suites/activityfailures.mjs when that suite left e2e (1 Nov 2026, owner: "None of these are critical user journeys"); its AI part is integration/store/run-faults-ai.test.mjs and run-quit-midway.test.mjs.
// Job: run the backbone
import {rows as notionRows} from './notion.mjs';
import {prepare, runTask, setFeed, sleep} from './activity-steps.mjs';

export async function runParts(ctx, parts) {
  const page = await prepare(ctx);
  if (parts.includes('notion')) {
    // A save Notion refuses must never look saved: the engine writes Notion first and changes nothing when it fails (src/desktop.py), so the person is told,
    // the row in Notion is as it was, and the list does not claim the job is saved. A silent loss here is a job the person thinks they kept (5 Oct 2026).
    await ctx.run('a Save that Notion refuses is never shown as saved: the person is told in words, and Notion and the list still agree', async () => {
      // Its own job first (9 Oct 2026: run as failuresnotion, nothing had opened the Jobs page, so the list was never loaded and the step never
      // reached Save; and under the applicant's own strategy, Zurich only, a "Zurich or Amsterdam" posting was placed outside their places and
      // dropped): one clean search for a posting in Zurich, then the Jobs page, whose list must hold THAT job before Notion is made to refuse.
      const [seed] = setFeed(ctx, ['Senior Site Reliability Engineer, save seed'], {location: 'Zurich, Switzerland'});
      await runTask(ctx, 'run', {maxMs: 300000, kind: 'search'});
      await page.click('.nav[data-view="jobs"]');
      const unsaved = () => page.evaluate(url => (window.__jp.shared.allJobs || []).find(item => item.url === url && item.status !== 'saved'), seed.absolute_url);
      let job = await unsaved();
      for (let waited = 0; !job && waited < 60000; waited += 2000) { await sleep(page, 2000); job = await unsaved(); }
      if (!job) throw new Error(`the seed did not take: a clean search for "${seed.title}" (Zurich) ran, yet the Jobs list does not hold it (${seed.absolute_url})`);
      console.log(`  save seed: "${job.title}" (${job.company}) is in the list, status ${job.status}`);
      const statusIn = async () => (await notionRows(ctx.token, 'Job Matches — AI Scored')).find(row => String(row.properties?.['Job URL']?.url || '').replace(/\/$/, '') === job.url.replace(/\/$/, ''))?.properties?.Status?.select?.name || '';
      const before = await statusIn();
      ctx.notion.fail('server-error', {writes: true});
      let result;
      try { result = await page.evaluate(url => window.pilot.setStatus(url, 'saved').catch(error => ({ok: false, error: error.message})), job.url); } finally { ctx.notion.pass(); }
      const after = await statusIn();
      const listed = await page.evaluate(url => (window.__jp.shared.allJobs || []).find(item => item.url === url)?.status, job.url);
      console.log(`  save refused: answer ${JSON.stringify(result).slice(0, 160)}; Notion "${before}" -> "${after}"; list "${listed}"`);
      const problems = [];
      if (result?.ok && after === before) problems.push('the app answered "saved" but Notion never got it: a silent loss');
      if (!result?.ok && after !== before) problems.push(`the app said it failed but Notion changed ("${before}" -> "${after}")`);
      if (!result?.ok && listed === 'saved') problems.push('the list shows the job as saved though the save failed');
      if (!result?.ok && /<!DOCTYPE|internal_server_error|"object":|Traceback/.test(String(result?.error || ''))) problems.push('the message for the person carries Notion\'s raw answer');
      if (problems.length) throw new Error(problems.join('; '));
    }, {needs: ctx.needs, faults: true, data: true});
  }
}
