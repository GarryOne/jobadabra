/* global window */
// Job: wait on state. The end-to-end proof of Full automation's press (spec 2026-10-27-background-apply-execution, step C): the app's hidden browser fills a fictional form and, once the
// wait has run, presses Submit itself exactly once against the fixture server's fake submit endpoint (never a real site); a Stop in the wait presses nothing. Every wait is on a state.
import {backgroundStateOf, closeHiddenBrowser, describeHidden, linkRuntime, withFormJudge} from './background-proof.mjs';
import {stageOf} from './seed-data.mjs';
import {appLogLines} from './app-log.mjs';

/** The app's own words for why it handed a background application to the person (its log line, with the reason id), for a failure message. */
const handedWhy = profile => { try { return appLogLines(profile).filter(line => /handed to the person/.test(line)).slice(-2).map(line => line.slice(0, 200)).join(' // ') || 'no hand-off logged'; } catch { return '(app log unreadable)'; } };

const E2E_FULL_AUTOMATION = {JOB_PILOTTO_E2E_FULL_AUTOMATION: '1'};   // the pair lib/background-apply-controller.js reads with JOB_PILOTTO_E2E; no user can set it

async function startAuto(ctx, {form, seed, waitMin}) {   // `seed(form)` adds the job the run starts
  const {page, proxy} = ctx;
  proxy.setCanned(withFormJudge(proxy.canned(), 'Submit Application'));
  await seed(form);
  await page.evaluate(({chosenAt, waitMin: wait}) => window.pilot.saveSettings({apply: {mode: 'auto', chosenAt, auto: {waitMin: wait}}}), {chosenAt: new Date().toISOString(), waitMin});
  const started = await page.evaluate(() => window.pilot.apply({n: 1, mode: 'settings'}));
  if (started?.ok === false) throw new Error(`the app refused to start Full automation: ${started.error}`);
  return started;
}

const sessionOf = (page, url) => page.evaluate(target => window.pilot.sessions().then(list => list.find(item => String(item.url || '').replace(/\/$/, '') === target.replace(/\/$/, ''))?.id || ''), url);

/**
 * The proof: with Full automation saved (wait 0) the form is filled, the checks pass and the app presses Submit by itself; the fake endpoint sees exactly one POST and the job is Applied.
 * Then, with a wait of 5 minutes, a Stop in the wait leaves the job with the person and the endpoint sees no POST. `until(what, check, ms)` is the suite's state wait.
 */
export async function proveAutomatic(ctx, {form, seed, until}) {
  const {forms} = ctx;   // `ctx.page` is read after the relaunch: it is a new window
  const unlinked = linkRuntime(ctx.profile);
  if (unlinked) { if (process.platform === 'win32') { console.log(`  skipped here: ${unlinked}`); return; } throw new Error(unlinked); }
  await ctx.relaunch(E2E_FULL_AUTOMATION);
  try {
    const posted = forms.posts.length;
    await startAuto(ctx, {form, seed, waitMin: 0});
    await until('the job never became Applied after the automatic press', async () => (await stageOf(ctx, form.url)) === 'Applied', 180000)
      .catch(async error => { throw new Error(`${error.message} | ${handedWhy(ctx.profile)} | ${await describeHidden(ctx.profile)} | state: ${await backgroundStateOf(ctx.page, form.url) || 'none'}`); });
    if (forms.posts.length !== posted + 1) throw new Error(`expected the automatic press to post once, the endpoint saw ${forms.posts.length - posted}`);
    await closeHiddenBrowser(ctx.profile);

    // Stop in the wait: the job has to reach "waiting to submit" first, then the person's Stop turns it into a hand-off with nothing sent.
    const beforeStop = forms.posts.length;
    // Why (2026-10-28, found by this step): the app keeps one background session per job address, so a second run on the same address reads the first one's final state; the Stop half uses its own address (the server ignores the query).
    const second = {...form, url: `${form.url}?second=1`};
    await startAuto(ctx, {form: second, seed, waitMin: 5});
    await until('the form never reached the wait before the automatic press', async () => (await backgroundStateOf(ctx.page, second.url)) === 'waiting_to_submit', 180000)
      .catch(async error => { throw new Error(`${error.message} | ${handedWhy(ctx.profile)} | ${await describeHidden(ctx.profile)} | state: ${await backgroundStateOf(ctx.page, second.url) || 'none'}`); });
    const id = await sessionOf(ctx.page, second.url);
    if (!id) throw new Error('the waiting application has no session to Stop');
    await ctx.page.evaluate(session => window.pilot.liveStop(session), id);
    await until('the Stop did not hand the application to the person', async () => /manual_submit_required|needs_user_handoff/.test(await backgroundStateOf(ctx.page, second.url) || ''), 60000);
    if (forms.posts.length !== beforeStop) throw new Error(`Stop in the wait still let ${forms.posts.length - beforeStop} submit(s) through`);
  } finally { await closeHiddenBrowser(ctx.profile); }
}
