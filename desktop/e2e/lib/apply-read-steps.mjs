/* global document */
// The apply suite's triage-read step (spec 2026-10-30-apply-triage, PR C2a): the Jobs button reads a fixture job's form in the app's hidden browser, the chip shows the verdict, and the read never fills.
// Why (30 Oct 2026, a8 on #2602): a behaviour change carries its e2e step in the same PR; the unit tests fake the browser, this one plays the owner's press end to end. The judge is the suite's stand-in (a model that reads the sketch).
// Job: wait on state
import {INSTRUCTIONS as FORM_JUDGE} from '../../lib/form-judge.js';
import {FORMS} from './forms.mjs';
import {addKitJob, removeJobsByUrl} from './seed-data.mjs';
import {HIDDEN_NEED, autoFormOf, closeHiddenBrowser, describeHidden, evaluateOn, hiddenTargets, linkRuntime, withFormJudge} from './background-proof.mjs';
import {pollUntil, stepTimeLeft, stepWait} from './wait-on-state.mjs';
import {assertReadUntyped, sampleBeforeClose, TYPED_SNAPSHOT} from './typed-recorder.mjs';
import {CHIP_VALUE, sessionsNow} from './apply-triage-steps.mjs';

/** The http pages the hidden browser of `profile` holds, [] when it is not running. */
const hiddenPages = profile => hiddenTargets(profile).then(targets => targets.filter(item => item.type === 'page' && /^https?:/.test(item.url)), () => []);
const onHost = host => item => { try { return new URL(item.url).host === host; } catch { return false; } };

/**
 * Observe the form until stopped, retaining transient writes since attachment; the judge checkpoint reads it once more before the close path.
 * Why (30 Oct 2026, owner): target discovery follows browser startup, so this fallback cannot prove the interval before attachment or after the final read.
 */
function watchHiddenForm(profile, host) {
  const seen = {samples: 0, installed: 0, filled: [], expired: false};
  let stopped = false;
  const sample = async () => {
    const form = (await hiddenPages(profile)).find(onHost(host));
    const snapshot = form ? await evaluateOn(form.webSocketDebuggerUrl, TYPED_SNAPSHOT) : null;
    if (snapshot) {
      seen.samples += 1;
      if (snapshot.installed === true) seen.installed += 1;
      seen.filled.push(...(snapshot.filled || []));
    }
    return snapshot?.installed === true;
  };
  // Wait on the explicit stop state while observing the open page; the cap catches a stuck read, never proves it read-only.
  const done = pollUntil(async () => { if (!stopped) await sample(); return stopped; }, value => value,
    {capMs: stepTimeLeft(), tickMs: 25, log: () => {}}).then(result => { seen.expired = !result.value; });
  return {seen, sample, stop: () => { stopped = true; return done; }};
}

/** The chip text of the Jobs row titled `title` (ac's chip selector, lib/apply-triage-steps.mjs), or ''. */
const chipOfRow = (page, title) => page.evaluate(({text, selector}) => [...document.querySelectorAll(selector)].find(chip => chip.closest('.role')?.textContent.includes(text))?.textContent.trim() || '', {text: title, selector: CHIP_VALUE});

/** Every chip text now on the Jobs list, for a failure message. */
const allChips = page => page.evaluate(selector => [...document.querySelectorAll(selector)].map(chip => chip.textContent.trim()), CHIP_VALUE);

/** Wait for a read's observable state within the current step's deadline; a cap is only a hang failure. */
async function readState(why, check) {
  const result = await pollUntil(check, value => value, {capMs: stepTimeLeft()});
  if (!result.value) throw new Error(why);
}

/**
 * Runs both read verdicts using the harness context. Seeds and removes only its own fixture job per step; no form is filled or sent.
 * Skipped here, counted as skipped, where the hidden browser has no runtime link (Windows).
 */
export async function runReadSteps(ctx) {
  const {page, proxy, forms} = ctx;
  // Why (30 Oct 2026, owner): the stand-in leaves the submitter's Linux question unanswered; its details-only variant is covered entirely by the saved profile.
  for (const [form, expected] of [[FORMS.submitter, 'You review and submit'], [autoFormOf(FORMS.submitter), 'Can apply automatically']]) {
    await ctx.run('"See which jobs can apply automatically" reads a job\'s form in the hidden browser: ' + expected + ', the tab closes, and nothing is filled or sent', async () => {
      const unlinked = linkRuntime(ctx.profile);
      if (unlinked) throw new Error(unlinked);
      const previous = proxy.canned(), judge = withFormJudge(previous, 'Submit Application');
      let asked = 0;
      await removeJobsByUrl(ctx, [form.url]);
      await addKitJob(ctx, {title: form.title, company: form.company, url: form.url, kit: null, fit: 90, stage: 'Saved', nextStep: ''});
      const watch = watchHiddenForm(ctx.profile, form.host);
      proxy.setCanned(async body => {
        const system = typeof body?.system === 'string' ? body.system : (body?.system || []).map(part => part.text || '').join('');
        if (system.startsWith(FORM_JUDGE)) {
          asked += 1;
          // Why (30 Oct 2026, owner): the extension plans after this judge checkpoint, then closes; observe continuously and sample before releasing the judge.
          await sampleBeforeClose(watch);
        }
        return judge(body);
      });
      try {
        await page.reload();
        await stepWait('the app window showed its view after the reload', timeout => page.locator('.view:not([hidden])').waitFor({timeout}));
        await page.click('.nav[data-view="jobs"]');
        await page.fill('#filter-text', form.url);   // Why (2026-10-30, CI run 41092478435): a Saved job is no row of the default "New matches" view; a pasted link finds a job whatever its status (renderJobs `anyStatus`)
        await readState('the fixture job never appeared on the Jobs list', async () => (await chipOfRow(page, form.title)) !== '');
        if (await chipOfRow(page, form.title) !== 'Not checked') throw new Error('the job already had a chip before any read');
        const sessions = sessionsNow(ctx), posted = forms.posts.length;
        await page.click('#triage-open');
        await stepWait('the triage dialog opened', timeout => page.waitForSelector('#triage-dialog[open]', {timeout}));
        await page.fill('#triage-n', '1');   // Why (2026-10-30, owner: the popup is becoming one field, the first N best matching jobs): the default "best" choice ranks by fit; this job is fit 90 and the suite's other fixture jobs sit below it, so the first 1 is this job
        await page.click('#triage-start');
        await readState('the chip never showed the form read', async () => (await chipOfRow(page, form.title)) !== 'Not checked')
          .catch(async error => { throw new Error(`${error.message} | chips: ${JSON.stringify(await allChips(page))} | ${await describeHidden(ctx.profile)}`); });
        const chip = await chipOfRow(page, form.title);
        if (chip !== expected) throw new Error(`the fixture should read "${expected}", the chip says "${chip}"`);
        if (asked < 1) throw new Error('the verdict never went through the form judge');
        await readState('the read tab was never closed', async () => !(await hiddenPages(ctx.profile)).some(onHost(form.host)));
        await watch.stop();
        assertReadUntyped(watch.seen);
        if (forms.posts.length !== posted) throw new Error('a read posted the form');
        if (sessionsNow(ctx) !== sessions) throw new Error('a read created or changed a session; it is not an application');
      } finally {
        await page.click('#triage-cancel').catch(() => {});   // a run still going would read on into the next hidden-browser step
        await stepWait('the triage progress went away', timeout => page.waitForSelector('#triage-progress', {state: 'hidden', timeout})).catch(() => {});
        await page.click('#triage-close').catch(() => {});
        await page.fill('#filter-text', '').catch(() => {});
        await watch.stop();
        proxy.setCanned(previous);
        await removeJobsByUrl(ctx, [form.url]).catch(() => 0);
        await closeHiddenBrowser(ctx.profile);
      }
    }, {safety: true, needs: [...ctx.needs, HIDDEN_NEED]});   // Why (2026-10-28, Gitar on #2364; safety: 31 Oct 2026, owner): a missing need is recorded as skipped, not passed; this step proves nothing is filled or sent, so it is never suspended
  }
}
