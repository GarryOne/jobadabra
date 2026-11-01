/* global window */
// Job: wait on state
// Actions + Recent activity + Jobs: the core of every workflow. Starts from a set-up install; resets only its own data (jobs and run rows) in Notion.
import fs from 'node:fs';
import path from 'node:path';
import {runsData} from '../lib/activity-steps.mjs';
import {clearData} from '../lib/start-state.mjs';
import {agreeWithin} from '../lib/truth-data.mjs';
import {ensureSetUp} from '../lib/seed.mjs';
import {varyFeeds} from '../lib/feeds.mjs';
import {hangCapsFor} from '../lib/hang-caps.mjs';
import {pollUntil, stepTimeLeft} from '../lib/wait-on-state.mjs';

// Why (30 Oct 2026, ap): rule A serves jobs' declared engine and background answers without a live key.
export const offlineAi = true;
// Why (30 Oct 2026, ap): the harness must fail jobs if any question reaches a real model.
export const realAi = false;
export const aiAnswers = 'backbone';   // answers its AI from the stored table in every workflow (plan-run.mjs puts it in the matrix)
// Why (30 Oct 2026, ap; a8's rule for calendar on #2565): stored answers need one store path (test/store.test.mjs); jobs takes the default store, SQLite, whose steps it already has.
export const store = 'sqlite';
export const minutes = 30;
export const name = 'jobs';
export const hangCaps = hangCapsFor('jobs');
// Why (30 Oct 2026, owner, Rule B): measured per-step hang caps replace the aggregate clock; a slow runner is not a failed state assertion.
export const aggregateBudget = false;
export async function run(ctx) {
  const {ARTIFACTS, page} = ctx;
  await ensureSetUp(ctx);
  // Why (1 Nov 2026, a8's after-merge red on 6631d38): this suite is pinned to this Mac's store (`store` above), whose strategy is the app's own config (saved at setup, lib/seed.mjs); a step
  // behind `ctx.store !== 'sqlite'` could never run, and the after-merge picker picked it. That the config holds the applicant's roles is desktop/integration/store/strategy-integration.test.mjs.
  await ctx.run('this suite starts with no jobs and no runs in its Notion page', async () => {
    const rows = [await clearData(ctx, 'Job Matches — AI Scored'), await clearData(ctx, 'Cronjob Runs')];
    console.log(`  cleared ${rows[0]} job row(s) and ${rows[1]} run row(s)`);
    // The app listed last run's fixture jobs when it started; read the list again, or the next step sees them, passes at once and never waits for its check.
    await page.reload();
    await page.waitForSelector('.view:not([hidden])', {timeout: 60000});
    await page.waitForFunction(() => Array.isArray(window.__jp?.shared?.allJobs) && !window.__jp.shared.allJobs.some(job => /^E2E /.test(job.company || '')), null, {timeout: 60000, polling: 1000})
      .catch(() => { throw new Error('the app still lists fixture jobs after their rows were cleared'); });
  }, {needs: ctx.needs});
  await ctx.run('a jobs check reads the fixture feeds, drops the wrong roles and scores the matching jobs', async () => {
    // The employers to crawl: two fixture boards (feeds come from fixtures/feeds, never the network).
    fs.mkdirSync(path.join(ctx.profile, 'config'), {recursive: true});
    fs.copyFileSync(path.join(ctx.E2E, 'fixtures', 'feeds', 'sources.json'), path.join(ctx.profile, 'config', 'sources.json'));
    const varied = varyFeeds(ctx.feeds, ctx.vary);   // a seeded run: one more match, one more wrong role, Zurich written another way (lib/feeds.mjs)
    if (varied) {   // replay: E2E_SEED=<seed> node suite.mjs jobs (issues show the seed from seed.json)
      console.log(`  variation: seed ${ctx.vary.seed}; ${varied.note}`);
      fs.writeFileSync(path.join(ARTIFACTS, 'seed.json'), JSON.stringify({seed: ctx.vary.seed, fixed: false, detail: varied.note}));
    }
    await page.click('.nav[data-view="jobs"]');
    await page.click('#refresh');
    // Only the fixture employers' jobs (E2E …) count: the app's list also holds this workspace's own application records, scored long ago, which made this wait pass at once
    // and the slow check below join a check still in flight (CI, 2 Oct 2026: "0 new jobs", no AI call).
    const scored = () => page.evaluate(() => (window.__jp.shared.allJobs || []).filter(job => /^E2E /.test(job.company || '') && job.title && job.fit != null && job.fit !== '').map(job => ({title: job.title, fit: Number(job.fit)})));
    await page.waitForFunction(() => (window.__jp.shared.allJobs || []).some(job => /^E2E /.test(job.company || '') && /reliability|devops|platform/i.test(job.title) && job.fit != null && job.fit !== ''),
      null, {timeout: 480000, polling: 3000});
    const jobs = await scored();
    const titles = jobs.map(job => job.title);
    console.log(`  scored: ${jobs.map(job => `${job.title} (${job.fit})`).join('; ')}`);
    if (jobs.some(job => !(job.fit >= 0 && job.fit <= 100))) throw new Error('a score is outside 0 to 100');
    const wrong = titles.filter(title => /account executive|product designer|intern|sales development|marketing manager|recruiter \d/i.test(title));   // the crowd's roles too (lib/feeds.mjs)
    if (wrong.length) throw new Error(`jobs for the wrong role were kept: ${wrong.join(', ')}`);
    if (varied) {   // the added match is kept and scored like the written ones, whatever way Zurich is written
      // As a person reads it: a gender tag such as (m/w/d) may be dropped for display (src/digest.py), spacing and case may change.
      const read = title => String(title || '').toLowerCase().replace(/\((?:m\/w\/d|m\/f\/d|f\/m\/d|w\/m\/d|all genders|a)\)/g, '').replace(/\s+/g, ' ').trim();
      const has = async () => (await scored()).some(job => read(job.title) === read(varied.match));
      await pollUntil(has, present => present, {capMs: stepTimeLeft()});
      // Say what the window holds for every fixture job, scored or not: present without a score (scoring slow) is not the same as missing from the list (never kept or never refreshed).
      const held = () => page.evaluate(() => (window.__jp.shared.allJobs || []).filter(job => /^E2E /.test(job.company || '')).map(job => `${job.title} [${job.fit == null || job.fit === '' ? 'no score' : job.fit}]`));
      if (!(await has())) throw new Error(`the added match "${varied.match}" (in "${varied.place}") was not kept and scored; scored: ${(await scored()).map(job => job.title).join('; ')}; the window holds ${(await held()).length} fixture job(s): ${(await held()).join('; ')}`);
    }
  }, {needs: ctx.needs});
  await ctx.run('every scored job in the Jobs list is its Job Matches record, with the same score, and none is missing', async () => {
    // Screen against source: a list that drops, adds or rescored a job is a wrong result no screenshot shows (lib/truth-data.mjs).
    // After the refresh ends: the list shows a job the moment it is scored, and the refresh writes its Notion rows in groups and at its end (7 Oct 2026: the
    // step compared at "scored 5 of 6", before any row was written, and failed on Mac and Windows).
    const {value: run} = await pollUntil(() => runsData(page), state => !state.running, {capMs: stepTimeLeft()});
    if (run.running) throw new Error('the refresh was still running at the step\'s hang cap');
    // The list redraws a moment after the run ends (a reload from the store may still be in flight, slow on Windows: 17 Oct 2026 read a listed job as missing): both sides are read again until they agree.
    const problems = await agreeWithin(async () => [
      await page.evaluate(() => (window.__jp.shared.allJobs || []).filter(job => /^E2E /.test(job.company || '') && job.fit != null && job.fit !== '').map(job => ({url: job.url, title: job.title, fit: job.fit}))),
      await ctx.data('matches', 'list', {})]);   // the store: only this run's fixture jobs, emptied at the start (Notion) or a fresh profile (this Mac's store)
    if (problems.length) throw new Error(problems.slice(0, 5).join('; '));
  }, {needs: ctx.needs, data: true});
  // One Apply button (5 Oct 2026): a scored job without a kit shows Apply, and Prepare only in its ⋯ menu: integration/app/screen-apply.test.js (moved 1 Nov 2026).
  // Find new employers (probes the seed company, lists it) and a slow Jobs check ending cleanly: desktop/integration/store/jobs-run.test.mjs (moved 1 Nov 2026, R2).
  // Layout of Focus, Jobs and Actions: suites/interactions.mjs (night-report) takes their Finder shots; integration/app/screen-focus*.test.js and screen-activity.test.js check them on PRs (moved 1 Nov 2026, 6/6a-2).
}
