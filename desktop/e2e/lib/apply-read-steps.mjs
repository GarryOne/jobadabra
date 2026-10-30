/* global document */
// The apply suite's triage-read step (spec 2026-10-30-apply-triage, PR C2a): the Jobs button reads a fixture job's form in the app's hidden browser, the chip shows the verdict, and the read never fills.
// Why (30 Oct 2026, a8 on #2602): a behaviour change carries its e2e step in the same PR; the unit tests fake the browser, this one plays the owner's press end to end. The judge is the suite's stand-in (a model that reads the sketch).
// Job: wait on state
import {INSTRUCTIONS as FORM_JUDGE} from '../../lib/form-judge.js';
import {FORMS} from './forms.mjs';
import {addKitJob, removeJobsByUrl} from './seed-data.mjs';
import {closeHiddenBrowser, describeHidden, evaluateOn, hiddenTargets, linkRuntime, withFormJudge} from './background-proof.mjs';
import {CHIP_VALUE, sessionsNow} from './apply-triage-steps.mjs';

const pause = ms => new Promise(done => setTimeout(done, ms));
const FILLED = `[...document.querySelectorAll('input,textarea')].filter(item => !['hidden', 'submit', 'button', 'checkbox', 'radio', 'file'].includes(item.type) && item.value).map(item => (item.name || item.id) + '=' + item.value)`;

/** The http pages the hidden browser of `profile` holds, [] when it is not running. */
const hiddenPages = profile => hiddenTargets(profile).then(targets => targets.filter(item => item.type === 'page' && /^https?:/.test(item.url)), () => []);
const onHost = host => item => { try { return new URL(item.url).host === host; } catch { return false; } };

/**
 * Looks at the hidden form page of `host` every 250 ms until `stop()`: how often it was seen, and every value found typed into it.
 * The page is read from the page itself, over the hidden browser's own debugging port, never from a log.
 */
function watchHiddenForm(profile, host) {
  const seen = {samples: 0, filled: []};
  const done = (async () => {
    while (!seen.stop) {
      const form = (await hiddenPages(profile)).find(onHost(host));
      const values = form ? await evaluateOn(form.webSocketDebuggerUrl, FILLED) : null;
      if (values) { seen.samples += 1; seen.filled.push(...values); }
      await pause(250);
    }
  })();
  return {seen, stop: () => { seen.stop = true; return done; }};
}

/** The chip text of the Jobs row titled `title` (ac's chip selector, lib/apply-triage-steps.mjs), or ''. */
const chipOfRow = (page, title) => page.evaluate(({text, selector}) => [...document.querySelectorAll(selector)].find(chip => chip.closest('.role')?.textContent.includes(text))?.textContent.trim() || '', {text: title, selector: CHIP_VALUE});

/** Every chip text now on the Jobs list, for a failure message. */
const allChips = page => page.evaluate(selector => [...document.querySelectorAll(selector)].map(chip => chip.textContent.trim()), CHIP_VALUE);

/**
 * Runs the read step; takes the harness context and the suite's `until(what, check, ms)`. Seeds and removes only its own job (the fixture submitter's).
 * Skipped here, counted as skipped, where the hidden browser has no runtime link (Windows).
 */
export async function runReadSteps(ctx, {until}) {
  const {page, proxy, forms} = ctx, form = FORMS.submitter;
  await ctx.run('"See which jobs can apply automatically" reads a job\'s form in the hidden browser: the chip shows the verdict, the tab closes, and nothing is filled or sent', async () => {
    const unlinked = linkRuntime(ctx.profile);
    if (unlinked) throw new Error(unlinked);
    const previous = proxy.canned(), judge = withFormJudge(previous, 'Submit Application');
    let asked = 0;
    proxy.setCanned(body => { const system = typeof body?.system === 'string' ? body.system : (body?.system || []).map(part => part.text || '').join(''); if (system.startsWith(FORM_JUDGE)) asked += 1; return judge(body); });
    await removeJobsByUrl(ctx, [form.url]);
    await addKitJob(ctx, {title: form.title, company: form.company, url: form.url, kit: null, fit: 90, stage: 'Saved', nextStep: ''});
    const watch = watchHiddenForm(ctx.profile, form.host);
    try {
      await page.reload();
      await page.waitForSelector('.view:not([hidden])', {timeout: 60000});
      await page.click('.nav[data-view="jobs"]');
      await page.fill('#filter-text', form.url);   // Why (2026-10-30, CI run 41092478435): a Saved job is no row of the default "New matches" view; a pasted link finds a job whatever its status (renderJobs `anyStatus`)
      await until('the fixture job never appeared on the Jobs list', async () => (await chipOfRow(page, form.title)) !== '', 60000);
      if (await chipOfRow(page, form.title) !== 'Not checked') throw new Error('the job already had a chip before any read');
      const sessions = sessionsNow(ctx), posted = forms.posts.length;
      await page.click('#triage-open');
      await page.waitForSelector('#triage-dialog[open]', {timeout: 5000});
      await page.click('#triage-by-fit');   // only this job: the suite's other fixture jobs sit below fit 90 and stay unread
      await page.fill('#triage-fit', '90');
      await page.fill('#triage-n', '1');
      await page.click('#triage-start');
      await until('the chip never showed the form read', async () => (await chipOfRow(page, form.title)) !== 'Not checked', 150000)
        .catch(async error => { throw new Error(`${error.message} | chips: ${JSON.stringify(await allChips(page))} | ${await describeHidden(ctx.profile)}`); });
      const chip = await chipOfRow(page, form.title);
      if (chip !== 'You review and submit') throw new Error(`a clean form with answers not yet saved should read "You review and submit", the chip says "${chip}"`);
      if (asked < 1) throw new Error('the verdict never went through the form judge');
      await until('the read tab was never closed', async () => !(await hiddenPages(ctx.profile)).some(onHost(form.host)), 30000);
      await watch.stop();
      if (watch.seen.samples < 1) throw new Error('the hidden form page was never seen open: the "nothing was filled" check proved nothing');
      if (watch.seen.filled.length) throw new Error(`the read typed into the form: ${watch.seen.filled.join(', ')}`);
      if (forms.posts.length !== posted) throw new Error('a read posted the form');
      if (sessionsNow(ctx) !== sessions) throw new Error('a read created or changed a session; it is not an application');
    } finally {
      await page.click('#triage-cancel').catch(() => {});   // a run still going would read on into the next hidden-browser step
      await page.waitForSelector('#triage-progress', {state: 'hidden', timeout: 30000}).catch(() => {});
      await page.click('#triage-close').catch(() => {});
      await page.fill('#filter-text', '').catch(() => {});
      await watch.stop();
      proxy.setCanned(previous);
      await removeJobsByUrl(ctx, [form.url]).catch(() => 0);
      await closeHiddenBrowser(ctx.profile);
    }
  }, {needs: [...ctx.needs, {name: 'a runtime link for the hidden browser (none on Windows)', value: process.platform !== 'win32'}]});   // Why (2026-10-28, Gitar on #2364): a missing need is recorded as skipped, not passed
}
