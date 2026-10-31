/* global document */
// The apply suite's real triage progress and Cancel proof: the fixture server holds each page until released, so every press follows a state, never a delay.
// Job: wait on state
import {FORMS} from './forms.mjs';
import {addKitJob, removeJobsByUrl} from './seed-data.mjs';
import {HIDDEN_NEED, autoFormOf, closeHiddenBrowser, hiddenTargets, linkRuntime, sessionOf, skipJob, withFormJudge} from './background-proof.mjs';
import {CHIP_VALUE} from './apply-triage-steps.mjs';
import {pollUntil, stepTimeLeft} from './wait-on-state.mjs';

/** Waits on a state for as long as the step's hang cap leaves (stepTimeLeft: no clock of its own); throws what it waited for and last read. */
async function waitOn(seen, what, read, accepts) {
  seen.what = what;
  console.log(`  triage: ${what}`);
  const {value} = await pollUntil(async () => (seen.state = await read()), accepts, {capMs: stepTimeLeft(), log: () => {}});
  if (!accepts(value)) throw new Error(`${what} (last read: ${JSON.stringify(seen.state)})`);
  return value;
}

/** Progress and per-address chip words from the real Jobs window, including rows hidden behind the popup. */
const screenOf = (page, urls) => page.evaluate(({urls, selector}) => ({
  shown: !document.getElementById('triage-progress').hidden,
  text: document.getElementById('triage-progress-text').textContent.trim(),
  width: document.getElementById('triage-bar').style.width,
  chips: urls.map(url => [...document.querySelectorAll('.job-row')].find(row => row.dataset.url === url)?.querySelector(selector)?.textContent.trim() || ''),
}), {urls, selector: CHIP_VALUE});

/** The runner's hang report: last state, exact per-job GET counts, field reports and the hidden browser's targets. */
const hangOf = seen => () => `${seen.what} (last read: ${JSON.stringify(seen.state)}) | reads: ${JSON.stringify(seen.held?.reads)} | field reports: ${JSON.stringify(seen.held?.reports)}`;   // evidence; the runner says it was cut off

/** Runs one triage proof with four fixture jobs; removes the suite's fixture urls first so only this run's jobs can be picked. No application is started. */
export async function runTriageCancelSteps(ctx, {urls}) {
  const {page, proxy, forms} = ctx, seen = {what: '', state: null};
  const jobs = [1, 2, 3, 4].map(n => ({...autoFormOf(FORMS.submitter, `?triage-cancel=${n}`), title: `Triage Cancel Engineer ${n}`}));
  const addresses = jobs.map(job => job.url);
  await ctx.run('the triage bar moves per real read and Cancel during a held read stops before the next job, closes its page, and fills or sends nothing', async () => {
    const unlinked = linkRuntime(ctx.profile);
    if (unlinked) throw new Error(unlinked);
    const previous = proxy.canned(), held = forms.holdReads(jobs);
    seen.held = held;
    proxy.setCanned(withFormJudge(previous, 'Submit Application'));
    try {
      await closeHiddenBrowser(ctx.profile);
      await removeJobsByUrl(ctx, [...urls, ...addresses]);
      for (const [index, job] of jobs.entries()) await addKitJob(ctx, {...job, kit: null, fit: 100 - index, stage: 'Saved', nextStep: ''});
      await page.reload();
      await waitOn(seen, 'the Jobs navigation never appeared', () => page.locator('.nav[data-view="jobs"]').isVisible(), shown => shown);
      await page.click('.nav[data-view="jobs"]');
      await page.fill('#filter-text', jobs[0].url.split('?')[0]);
      await waitOn(seen, 'the four fixture chips never appeared unchecked', () => screenOf(page, addresses), state => state.chips.every(chip => chip === 'Not checked'));
      for (const job of jobs) if (await sessionOf(page, job.url)) throw new Error(`a session already holds ${job.url}`);
      const posted = forms.posts.length;
      await page.click('#triage-open');
      await page.fill('#triage-n', String(jobs.length));
      await page.click('#triage-start');
      await waitOn(seen, 'Check never opened the first held page with progress visible', async () => ({screen: await screenOf(page, addresses), reads: [...held.reads]}), state => state.screen.shown && state.reads.includes(addresses[0]));

      for (const completed of [1, 2]) {
        held.release(addresses[completed - 1]);
        const state = await waitOn(seen, `the bar never reached ${completed} of ${jobs.length} while the next read was held`, async () => ({screen: await screenOf(page, addresses), reads: [...held.reads]}), state => state.screen.text === `${completed} of ${jobs.length}` && state.reads.includes(addresses[completed]));
        const width = `${Math.round(completed / jobs.length * 100)}%`;
        if (!state.screen.shown || state.screen.width !== width) throw new Error(`after ${completed} real reads the bar should show ${width}: ${JSON.stringify(state)}`);
        console.log(`  triage progress: ${state.screen.text}, bar ${state.screen.width}`);
      }
      // The third GET is still unanswered. Even its loading page must disappear on Cancel; a blank target is still a held page.
      await waitOn(seen, 'the hidden browser never held the in-flight read', () => hiddenTargets(ctx.profile).then(targets => targets.filter(target => target.type === 'page')), pages => pages.length > 0);
      await page.click('#triage-cancel');
      await waitOn(seen, 'Cancel never ended the run and hid its bar', () => screenOf(page, addresses), state => !state.shown);
      const stopped = await screenOf(page, addresses);
      if (stopped.chips.slice(0, 2).some(chip => !chip || chip === 'Not checked')) throw new Error(`the completed reads never changed their chips: ${JSON.stringify(stopped)}`);
      if (stopped.chips.slice(2).some(chip => chip !== 'Not checked')) throw new Error(`Cancel changed an unread job's chip: ${JSON.stringify(stopped)}`);
      const counts = addresses.map(url => held.reads.filter(read => read === url).length);
      if (JSON.stringify(counts) !== '[1,1,1,0]') throw new Error(`Cancel read another job or repeated a read: per-address GET counts ${JSON.stringify(counts)}`);
      if (forms.posts.length !== posted) throw new Error('triage posted a fixture form');
      if (held.reports.some(report => report.filled !== 0)) throw new Error(`triage filled controls: ${JSON.stringify(held.reports)}`);
      if (!addresses.slice(0, 2).every(url => held.reports.some(report => report.url === url))) throw new Error('the completed pages never reported their empty fields: the no-fill proof saw nothing');
      for (const job of jobs) if (await sessionOf(page, job.url)) throw new Error(`triage left a session for ${job.url}`);
      await waitOn(seen, 'Cancel left a hidden page open while its response was held', () => hiddenTargets(ctx.profile).then(targets => targets.filter(target => target.type === 'page')), pages => pages.length === 0);
    } finally {
      await page.evaluate(() => document.getElementById('triage-cancel')?.click()).catch(() => {});
      await closeHiddenBrowser(ctx.profile);
      held.close();
      for (const job of jobs) await skipJob(page, job);
      await removeJobsByUrl(ctx, addresses);
      await page.evaluate(() => document.getElementById('triage-close')?.click()).catch(() => {});
      await page.fill('#filter-text', '').catch(() => {});
      proxy.setCanned(previous);
    }
  }, {safety: true, needs: [...ctx.needs, HIDDEN_NEED], hangError: hangOf(seen)});
}
