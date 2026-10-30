/* global window */
// The apply suite's restart steps: the app quits while its hidden browser holds a job (Background automation's filled form, Full automation's wait), then starts again.
// Why (30 Oct 2026, owner: "app quits mid-job" picked from the coverage sketch; then "A quit is a Stop"): only unit tests played a cut-off job. This step's first runs saw the job continued
// after the start, and Full automation press 80 s after it on the wait the quit cut off; now every job an earlier run held goes to the person and nothing is pressed. Every wait is on a state.
// Job: wait on state
import {HIDDEN_NEED, autoFormOf, backgroundOf, backgroundStateOf, closeHiddenBrowser, describeHidden, kitSeeder, linkRuntime, withFormJudge} from './background-proof.mjs';
import {appLogLines} from './app-log.mjs';
import {FORMS} from './forms.mjs';
import {POSTING} from './apply-fixtures.mjs';

const applyLines = profile => { try { return appLogLines(profile).filter(line => /\[apply\]/.test(line)).slice(-4).map(line => line.slice(0, 220)).join(' // '); } catch { return '(app log unreadable)'; } };

/** Starts one fixture job in `mode` (fill or auto, wait `waitMin`) and waits for the state the app holds it in. -> the posts count before the quit. */
async function holdJob(ctx, {form, seed, until, mode, waitMin, held}) {
  const {page, proxy, forms} = ctx;
  proxy.setCanned(withFormJudge(proxy.canned(), 'Submit Application'));
  await seed(form);
  const chosenAt = new Date().toISOString();
  await page.evaluate(apply => window.pilot.saveSettings({apply}), mode === 'auto' ? {mode, chosenAt, autoConfirmedAt: chosenAt, auto: {waitMin}} : {mode, chosenAt});
  const started = await page.evaluate(() => window.pilot.apply({n: 1, mode: 'settings'}));
  if (started?.ok === false) throw new Error(`the app refused to start ${mode}: ${started.error}`);
  await until(`the job never reached ${held}`, async () => (await backgroundStateOf(page, form.url)) === held, 180000)
    .catch(async error => { throw new Error(`${error.message} | ${applyLines(ctx.profile)} | ${await describeHidden(ctx.profile)} | state: ${await backgroundStateOf(page, form.url) || 'none'}`); });
  return forms.posts.length;
}

/** After the start: waits until the job of `url` is handed to the person because the app was closed (lib/background-apply-controller.js sweepInterrupted). -> its background record. */
async function handedOver(ctx, url, until) {
  let last = null;
  await until('after the start the job the quit cut off was not handed to you (a quit is a Stop)', async () => (last = await backgroundOf(ctx.page, url).catch(() => null))?.state === 'needs_user_handoff', 60000)
    .catch(error => { throw new Error(`${error.message} | last read: ${last ? `${last.state}/${last.reason || ''}` : 'none'} | ${applyLines(ctx.profile)}`); });
  if (last.reason !== 'app_closed') throw new Error(`the job was handed to you as "${last.reason}", not because the app was closed`);
  return last;
}

/** Runs the restart steps; takes the harness context, the suite's fixture job addresses `urls` (removed first, so the one job Start picks is this step's) and its state wait `until`. */
export async function runRestartSteps(ctx, {urls, until}) {
  const form = FORMS.submitter;
  const autoForm = autoFormOf(form, '?restart=1'), seed = kitSeeder(ctx, urls, POSTING), needs = [...ctx.needs, HIDDEN_NEED];
  await ctx.run('the app quits while Background automation holds a filled form: after it starts again the job is handed to you, and nothing is posted', async () => {
    const unlinked = linkRuntime(ctx.profile);
    if (unlinked) throw new Error(unlinked);
    try {
      const posted = await holdJob(ctx, {form, seed, until, mode: 'fill', held: 'ready_for_review'});
      await ctx.relaunch();
      await handedOver(ctx, form.url, until);
      if (ctx.forms.posts.length !== posted) throw new Error(`after the start the form was posted ${ctx.forms.posts.length - posted} time(s)`);
    } finally { await closeHiddenBrowser(ctx.profile); }
  }, {needs});

  await ctx.run('the app quits in Full automation\'s wait: after it starts again the job is handed to you, and nothing is pressed when the wait runs out', async () => {
    const unlinked = linkRuntime(ctx.profile);
    if (unlinked) throw new Error(unlinked);
    try {
      const posted = await holdJob(ctx, {form: autoForm, seed, until, mode: 'auto', waitMin: 1, held: 'waiting_to_submit'});
      await ctx.relaunch();
      const {dueAt} = await handedOver(ctx, autoForm.url, until);
      // Why (30 Oct 2026, #2598 run 41088170876): the press came 80 s after the start, once the cut-off wait ran out; a press waits for the extension's next 30 s alarm (report-alarm.js), so the step
      // watches the posts until 45 s past the app's own due time.
      if (!dueAt) throw new Error('the handed-over job has no due time: the step cannot watch past the press it would have made');
      await until('the watch past the wait did not end', async () => Date.now() > dueAt + 45000 || ctx.forms.posts.length !== posted, Math.max(0, dueAt + 45000 - Date.now()) + 15000);
      if (ctx.forms.posts.length !== posted) throw new Error(`after the start the app pressed Submit ${ctx.forms.posts.length - posted} time(s) on a wait the quit cut off`);
      if ((await backgroundStateOf(ctx.page, autoForm.url)) !== 'needs_user_handoff') throw new Error('after the wait ran out the job was no longer handed to you');
    } finally { await closeHiddenBrowser(ctx.profile); }
  }, {needs});
}
