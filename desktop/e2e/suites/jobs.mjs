/* global window, document */
// Job: wait on state
// Actions + Recent activity + Jobs: the core of every workflow. Starts from a set-up install; resets only its own data (jobs and run rows) in Notion.
import fs from 'node:fs';
import path from 'node:path';
import {longestSilence, watch} from '../lib/activity.mjs';
import {runsData} from '../lib/activity-steps.mjs';
import {clearData} from '../lib/start-state.mjs';
import {agreeWithin} from '../lib/truth-data.mjs';
import {finish, visit} from '../lib/layout.mjs';
import {ensureSetUp} from '../lib/seed.mjs';
import {varyFeeds} from '../lib/feeds.mjs';
import {hangCapsFor} from '../lib/hang-caps.mjs';

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
  const {proxy, feeds, ARTIFACTS} = ctx;
  let {page} = ctx;
  ctx.findings = [];
  await ensureSetUp(ctx);
  // On this Mac's store the strategy is the app's own config (saved at setup, lib/seed.mjs): no page to link, the check reads the file.
  if (ctx.store === 'sqlite') await ctx.run("the check looks for this person's roles and places (this Mac's config, no Search settings page)", async () => {
    const search = JSON.parse(fs.readFileSync(path.join(ctx.profile, 'config', 'search.json'), 'utf8'));
    if (!(search.role_keywords || []).some(word => /site reliability/.test(word))) throw new Error(`config/search.json holds roles ${JSON.stringify(search.role_keywords)}, not the applicant's`);
  }, {needs: ctx.needs});
  else await ctx.run("the app's next start links this workspace's Search settings page (so the check looks for this person's roles and places)", async () => {
    // The fast seed connects Notion and marks setup done without a restart; the app links the existing Search settings page in its start-up migration (migrate.js), which is
    // what a real person's next start does. Without it the engine keeps the example config (a data analyst in Amsterdam), drops every fixture job and the check finds "0 new jobs"
    // (CI, 2 Oct 2026).
    await ctx.relaunch();
    page = ctx.page;
    await page.waitForSelector('.view:not([hidden])', {timeout: 60000});
    let linked = null;
    for (let waited = 0; !linked && waited < 60000; waited += 2000) {
      linked = await page.evaluate(async () => (await window.pilot.state()).settings?.notionIds?.NOTION_SEARCH_SETTINGS_PAGE || null);
      if (!linked) await page.waitForTimeout(2000);
    }
    if (!linked) throw new Error("the app did not link this workspace's Search settings page within a minute of starting");
  }, {needs: ctx.needs});
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
      for (let waited = 0; !(await has()) && waited < 120000; waited += 5000) await page.waitForTimeout(5000);
      // Say what the window holds for every fixture job, scored or not: present without a score (scoring slow) is not the same as missing from the list (never kept or never refreshed).
      const held = () => page.evaluate(() => (window.__jp.shared.allJobs || []).filter(job => /^E2E /.test(job.company || '')).map(job => `${job.title} [${job.fit == null || job.fit === '' ? 'no score' : job.fit}]`));
      if (!(await has())) throw new Error(`the added match "${varied.match}" (in "${varied.place}") was not kept and scored; scored: ${(await scored()).map(job => job.title).join('; ')}; the window holds ${(await held()).length} fixture job(s): ${(await held()).join('; ')}`);
    }
  }, {needs: ctx.needs});
  await ctx.run('every scored job in the Jobs list is its Job Matches record, with the same score, and none is missing', async () => {
    // Screen against source: a list that drops, adds or rescored a job is a wrong result no screenshot shows (lib/truth-data.mjs).
    // After the refresh ends: the list shows a job the moment it is scored, and the refresh writes its Notion rows in groups and at its end (7 Oct 2026: the
    // step compared at "scored 5 of 6", before any row was written, and failed on Mac and Windows).
    for (let waited = 0; (await runsData(page)).running && waited < 240000; waited += 3000) await page.waitForTimeout(3000);
    if ((await runsData(page)).running) throw new Error('the refresh was still running 4 minutes after its first scored job');
    // The list redraws a moment after the run ends (a reload from the store may still be in flight, slow on Windows: 17 Oct 2026 read a listed job as missing): both sides are read again until they agree.
    const problems = await agreeWithin(async () => [
      await page.evaluate(() => (window.__jp.shared.allJobs || []).filter(job => /^E2E /.test(job.company || '') && job.fit != null && job.fit !== '').map(job => ({url: job.url, title: job.title, fit: job.fit}))),
      await ctx.data('matches', 'list', {})]);   // the store: only this run's fixture jobs, emptied at the start (Notion) or a fresh profile (this Mac's store)
    if (problems.length) throw new Error(problems.slice(0, 5).join('; '));
  }, {needs: ctx.needs});
  // One Apply button (5 Oct 2026): a scored job with no kit is applied to like any other (the kit is drafted when Apply is pressed), and Prepare is only in the ⋯ menu.
  await ctx.run('a scored job without a kit shows the Apply button, never Prepare, and "Prepare only" in its ⋯ menu', async () => {
    await page.click('.nav[data-view="jobs"]');
    await page.waitForSelector('article.job-row', {timeout: 60000});
    const rows = await page.evaluate(() => [...document.querySelectorAll('article.job-row')].map(row => ({text: row.textContent, label: row.querySelector('.row-main')?.textContent.trim(), cls: row.querySelector('.row-main')?.className || ''})));
    const kitless = rows.filter(row => !/📝 Kit/.test(row.text));
    if (!kitless.length) throw new Error(`no kitless job in the list to check (rows: ${rows.length})`);
    const wrong = kitless.filter(row => row.label !== 'Apply' || !/state-apply/.test(row.cls) || /Prepare/.test(row.text));
    if (wrong.length) throw new Error(`${wrong.length} of ${kitless.length} jobs without a kit do not show a plain Apply button: ${wrong.slice(0, 3).map(row => `"${row.label}" (${row.cls})`).join('; ')}`);
    let items = [];
    for (let attempt = 0; attempt < 8 && !items.some(text => /Prepare only/.test(text)); attempt++) {   // the list redraws and closes an open ⋯ menu: open it again
      await page.locator('article.job-row').filter({hasNotText: '📝 Kit'}).first().getByRole('button', {name: 'More actions'}).click();
      await page.waitForTimeout(600);
      items = await page.getByRole('menuitem').allInnerTexts();
    }
    if (!items.some(text => /Prepare only/.test(text))) throw new Error(`the ⋯ menu of a job without a kit has no "Prepare only" (it lists: ${items.join(' | ')})`);
    await page.keyboard.press('Escape');
  }, {needs: ctx.needs});
  await ctx.run('Find new employers probes the seed company and lists it in the store (Employers & Sources)', async () => {
    fs.copyFileSync(path.join(ctx.E2E, 'fixtures', 'feeds', 'scout_seeds.json'), path.join(ctx.profile, 'config', 'scout_seeds.json'));
    await page.click('.nav[data-view="actions"]');
    await page.evaluate(() => window.pilot.command('scout'));   // the finder alone: Find jobs runs it as its last step, and Always on / the schedule start it by itself; the Actions card was merged into Find jobs (16 Oct 2026)
    const started = Date.now();
    let listed = null;
    while (!listed && Date.now() - started < 240000) {
      listed = ((await ctx.data('employers', 'list', {active: false}).catch(() => [])) || []).concat((await ctx.data('employers', 'list', {}).catch(() => [])) || []).find(employer => employer.name === 'E2E Gamma') || null;   // active or not
      if (!listed) await page.waitForTimeout(4000);
    }
    if (!listed) throw new Error('"E2E Gamma" was not listed in the store (Employers & Sources) within 4 minutes');
  }, {needs: ctx.needs});
  // Stored answers through the AI proxy, delayed by 8 s per call; its counter advances before table lookup.
  await ctx.run('a slow Jobs check keeps showing that it is working, and ends cleanly', async () => {
    // Four new matching postings appear, and every AI call now takes 8 seconds: the shape of a friend's 35-minute check (2 Oct 2026).
    const acme = JSON.parse(fs.readFileSync(path.join(feeds, 'acme.json'), 'utf8'));
    const more = ['Senior Site Reliability Engineer, Payments', 'Staff Platform Engineer, Observability', 'Senior DevOps Engineer, Cloud', 'Senior Infrastructure Engineer, Kubernetes'];
    more.forEach((title, i) => acme.jobs.push({id: 1100 + i, title, location: {name: 'Zurich, Switzerland'}, absolute_url: `https://boards.e2e.test/job/${1100 + i}`, updated_at: '2026-10-02T09:00:00Z',
      content: `<p>${title}: run production on Kubernetes and AWS with Terraform, SLOs and on-call. Senior level, hybrid in Zurich, English working language.</p>`}));
    fs.writeFileSync(path.join(feeds, 'acme.json'), JSON.stringify(acme));
    proxy.setDelay(8000);
    const callsBefore = proxy.stats.calls;
    await page.click('.nav[data-view="actions"]');
    await page.click('[data-command="run"]');
    const t0 = Date.now();
    let opened = false;
    // Why (30 Oct 2026, owner, #2601): reserve 30 s for the state verdict and evidence before the runner's measured hang cap.
    const verdictReserveSeconds = 30;
    const {samples, endedAt} = await watch(page, {maxMs: (hangCaps['a slow Jobs check keeps showing that it is working, and ends cleanly'] - verdictReserveSeconds) * 1000, onSample: async (s, all) => {
      if (!opened && s.banner.shown) { opened = true; await page.click('#run-banner-view').catch(() => {}); }
      console.log(`  +${String(Math.round((s.at - t0) / 1000)).padStart(3)}s running=${s.running ? 'yes' : 'no '} banner=${s.banner.shown ? 'yes' : 'no '} log=${s.logShown} unscored=${s.unscored}/${s.jobs} step="${(s.running?.step || s.panelStep).slice(0, 56)}"`);
    }});
    proxy.setDelay(0);
    const running = samples.filter(s => s.running);
    const problems = [];
    if (!running.length) problems.push('the task never showed as running');
    if (!samples.some(s => s.banner.shown)) problems.push('no "running" banner appeared on the Actions page');
    const firstLog = running.find(s => s.logShown > 0);
    if (!firstLog) problems.push('the Technical log never showed a line while the task ran ("Nothing to show yet" the whole time)');
    else console.log(`  clock: Technical log first showed a line after ${Math.round((firstLog.at - running[0].at) / 1000)} s (reported only)`);
    const silence = longestSilence(samples);
    console.log(`  longest stretch with nothing visibly changing: ${Math.round(silence / 1000)} s; AI calls through the slow proxy: ${proxy.stats.calls - callsBefore}`);
    if (endedAt == null) problems.push('the task never reached its terminal state before the measured hang cap');
    const last = samples.at(-1);
    if (endedAt != null && (last.newest?.live || last.newest?.ok === false)) problems.push(`the task ended but the newest run is ${last.newest?.live ? 'still live' : 'failed'}: ${last.newest?.result}`);
    if (endedAt != null && last.unscored > 0) problems.push(`${last.unscored} job(s) are still "Not scored" after the task ended`);
    if (ctx.engine === 'api' && proxy.stats.calls - callsBefore < 1) problems.push('the test never reached the slow AI path (no AI call went through the proxy)');   // on Claude Code every call is slow by itself and the proxy is not in the way
    if (problems.length) throw new Error(problems.join('; '));
  }, {needs: [...ctx.needs, ...ctx.needsKey]});
  await ctx.run('the pages of this suite render without layout problems', async () => {
    await visit(ctx, ['focus', 'jobs', 'actions']);
    finish(ctx);
  }, {needs: ctx.needs});
}
