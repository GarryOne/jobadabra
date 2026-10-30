/* global window, document */
// The apply suite's triage steps (spec 2026-10-30-apply-triage, PR B): the Jobs button's popup picks the best jobs by fit, and a job nobody has read says "Not checked".
// Why (30 Oct 2026, owner: "work on the apply-triage e2e"): the popup and its chips had unit tests only; no step pressed the button in the real window. The form read is PR C: until it lands
// a run reads nothing, so a step also holds that nothing opened, filled or sent. Fictional jobs only; the progress bar and Cancel have no step until a read can be slow (PR C).
// Job: wait on state
import fs from 'node:fs';
import path from 'node:path';
import {addKitJob, removeJobsByUrl} from './seed-data.mjs';

// Twelve jobs with fits the popup must order: more than the 10 it takes, every one with a distinct fit.
const FITS = [96, 93, 90, 88, 86, 84, 82, 80, 78, 76, 74, 72];
const JOBS = FITS.map((fit, index) => ({fit, title: `Triage Engineer ${index + 1}`, company: 'Triage Fixture Co', url: `https://jobs.triage-fixture.example/roles/${index + 1}`}));

/** The chip on each Jobs row: the selector both triage steps read (renderer/pages/jobs-render.js `.role > .chip-tag`). */
export const CHIP_VALUE = '.role > .chip-tag .chip-value';

const sessionsFile = ctx => path.join(ctx.profile, 'sessions.json');
const sessionsNow = ctx => { try { return fs.readFileSync(sessionsFile(ctx), 'utf8'); } catch { return ''; } };

/** Opens Jobs with the fictional jobs listed (the list is read again from the store, never the page's older copy). */
async function openJobs(ctx) {
  const {page} = ctx;
  await page.reload();
  await page.waitForSelector('.view:not([hidden])', {timeout: 60000});
  await page.click('.nav[data-view="jobs"]');
  await page.waitForFunction(urls => urls.every(url => (window.__jp?.shared?.allJobs || []).some(job => job.url === url)), JOBS.map(job => job.url), {timeout: 60000, polling: 500})
    .catch(() => { throw new Error('the Jobs list never held the twelve fictional jobs'); });
}

/** The popup as the person reads it: {count, start, disabled}. */
const popup = page => page.evaluate(() => ({count: document.getElementById('triage-count').textContent.trim(), start: document.getElementById('triage-start').textContent.trim(), disabled: document.getElementById('triage-start').disabled}));
const jobs = n => `${n} ${n === 1 ? 'job' : 'jobs'}`;

/** Runs the triage steps; takes the harness context. Seeds and removes only its own twelve jobs. */
export async function runTriageSteps(ctx) {
  const {page} = ctx;
  const urls = JOBS.map(job => job.url);
  try {
    await ctx.run('the Jobs popup picks the 10 best matches by fit, or every job above a fit, and says how many', async () => {
      await removeJobsByUrl(ctx, urls);
      for (const job of JOBS) await addKitJob(ctx, {title: job.title, company: job.company, url: job.url, kit: null, fit: job.fit, stage: 'Saved', nextStep: ''});
      await openJobs(ctx);
      const listed = await page.evaluate(() => (window.__jp.shared.allJobs || []).filter(job => job.url).map(job => Number.isFinite(job.fit) ? job.fit : -1));
      await page.click('#triage-open');
      await page.waitForSelector('#triage-dialog[open]', {timeout: 5000});
      let seen = await popup(page);
      const best = Math.min(10, listed.length);
      if (seen.count !== jobs(best) || seen.start !== `Check ${jobs(best)}`) throw new Error(`"10 best matches" over ${listed.length} listed jobs should say ${jobs(best)}, the popup says ${JSON.stringify(seen)}`);
      // Every job at or above a floor, capped by the count: the floor the twelve straddle.
      await page.click('#triage-by-fit');
      await page.fill('#triage-fit', '85');
      const above = Math.min(10, listed.filter(fit => fit >= 85).length);
      seen = await popup(page);
      if (seen.count !== jobs(above) || seen.start !== `Check ${jobs(above)}`) throw new Error(`"Fit above 85" over fits ${listed.join(', ')} should say ${jobs(above)}, the popup says ${JSON.stringify(seen)}`);
      // A floor nothing reaches leaves nothing to check, and the button says so by being off.
      await page.fill('#triage-fit', '100');
      const none = listed.filter(fit => fit >= 100).length === 0;
      seen = await popup(page);
      if (none && (seen.count !== jobs(0) || !seen.disabled)) throw new Error(`no job reaches fit 100, yet the popup says ${JSON.stringify(seen)}`);
      await page.click('#triage-close');
    });

    await ctx.run('checking jobs before the form read exists reads nothing: every chip says "Not checked", no session starts, nothing is filled or sent', async () => {
      const before = sessionsNow(ctx);
      await page.click('#triage-open');
      await page.waitForSelector('#triage-dialog[open]', {timeout: 5000});
      await page.click('#triage-by-best');
      await page.click('#triage-start');
      await page.waitForSelector('.toast', {timeout: 15000}).catch(() => { throw new Error('pressing "Check jobs" told the person nothing'); });
      const told = (await page.locator('.toast').last().innerText()).replace(/\s+/g, ' ');
      if (!/Nothing was checked/i.test(told)) throw new Error(`with no form read yet the toast should say nothing was checked, it says "${told}"`);
      if (await page.locator('#triage-progress:visible').count()) throw new Error('the progress bar is still showing after the run');
      await page.click('#triage-close').catch(() => {});
      const chips = await page.evaluate(selector => [...document.querySelectorAll(selector)].map(chip => chip.textContent.trim()), CHIP_VALUE);
      if (!chips.length) throw new Error('no job row shows a triage chip (.role > .chip-tag, renderer/pages/jobs-render.js)');
      const odd = chips.filter(text => text !== 'Not checked');
      if (odd.length) throw new Error(`${odd.length} chip(s) guessed a mode without a read: ${[...new Set(odd)].join(', ')}`);
      if (sessionsNow(ctx) !== before) throw new Error('checking jobs started or changed a session; nothing may open, fill or send before the form read exists');
    });
  } finally {
    await removeJobsByUrl(ctx, urls).catch(() => 0);
  }
}
