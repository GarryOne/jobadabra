// The apply suite's restart steps: the app quits while its hidden browser holds a job (Background automation's filled form, Full automation's wait), then starts again.
// Why (30 Oct 2026, owner: "app quits mid-job" picked from the coverage sketch; then "A quit is a Stop"): only unit tests played a cut-off job. This step's first runs saw the job continued
// after the start, and Full automation press 80 s after it on the wait the quit cut off; now every job an earlier run held goes to the person and nothing is pressed. Every wait is on a state.
// Why (30 Oct 2026, a8, #2612): the waits carry no clock of their own; the step's hang cap (apply.mjs hangCaps) is the only one, and a hang reports what the app and its hidden browser held (hangError).
// Job: wait on state
import {HIDDEN_NEED, autoFormOf, backgroundOf, backgroundStateOf, closeHiddenBrowser, kitSeeder, linkRuntime, skipJob} from './background-proof.mjs';
import {WATCH_PAST_DUE_MS, hangOf, startJob, waitOn} from './apply-hold.mjs';
import {FORMS} from './forms.mjs';
import {POSTING} from './apply-fixtures.mjs';

/** Starts one fixture job in `mode` (fill or auto, wait `waitMin`) and waits for the state the app holds it in. -> the posts count before the quit. */
async function holdJob(ctx, {form, seed, mode, waitMin, held, seen}) {
  const {page, forms} = ctx;
  await startJob(ctx, {form, seed, mode, waitMin});
  seen.what = `the job never reached ${held}`;
  await waitOn(ctx, seen, async () => (seen.state = (await backgroundStateOf(page, form.url)) || 'none'), state => state === held);
  return forms.posts.length;
}

/** After the start: waits until the job of `url` is handed to the person because the app was closed (lib/background-apply-controller.js sweepInterrupted). -> its background record. */
async function handedOver(ctx, url, seen) {
  seen.what = 'after the start the job the quit cut off was not handed to you (a quit is a Stop)';
  const last = await waitOn(ctx, seen, async () => (seen.state = await backgroundOf(ctx.page, url).catch(() => null)), record => record?.state === 'needs_user_handoff');
  if (last.reason !== 'app_closed') throw new Error(`the job was handed to you as "${last.reason}", not because the app was closed`);
  return last;
}

/** Runs the restart steps; takes the harness context and the suite's fixture job addresses `urls` (removed first, so the one job Start picks is this step's). */
export async function runRestartSteps(ctx, {urls}) {
  const form = FORMS.submitter;
  const autoForm = autoFormOf(form, '?restart=1'), seed = kitSeeder(ctx, urls, POSTING), needs = [...ctx.needs, HIDDEN_NEED];
  const filled = {what: '', state: ''}, waiting = {what: '', state: ''};
  await ctx.run('the app quits while Background automation holds a filled form: after it starts again the job is handed to you, and nothing is posted', async () => {
    const unlinked = linkRuntime(ctx.profile);
    if (unlinked) throw new Error(unlinked);
    try {
      const posted = await holdJob(ctx, {form, seed, mode: 'fill', held: 'ready_for_review', seen: filled});
      await ctx.relaunch();
      await handedOver(ctx, form.url, filled);
      if (ctx.forms.posts.length !== posted) throw new Error(`after the start the form was posted ${ctx.forms.posts.length - posted} time(s)`);
    } finally { await skipJob(ctx.page, form); await closeHiddenBrowser(ctx.profile); }   // the handed-over job stays eligible; the next proof's Start would take it (skipJob)
  }, {needs, hangError: hangOf(ctx, filled)});

  await ctx.run('the app quits in Full automation\'s wait: after it starts again the job is handed to you, and nothing is pressed when the wait runs out', async () => {
    const unlinked = linkRuntime(ctx.profile);
    if (unlinked) throw new Error(unlinked);
    try {
      const posted = await holdJob(ctx, {form: autoForm, seed, mode: 'auto', waitMin: 1, held: 'waiting_to_submit', seen: waiting});
      await ctx.relaunch();
      const {dueAt} = await handedOver(ctx, autoForm.url, waiting);
      // Why (30 Oct 2026, #2598 run 41088170876): the press came 80 s after the start, once the cut-off wait ran out; a press waits for the extension's next alarm, so the step watches the posts
      // until WATCH_PAST_DUE_MS past the app's own due time. A negative watch on the product's promise: it ends at that time, or at the first press.
      if (!dueAt) throw new Error('the handed-over job has no due time: the step cannot watch past the press it would have made');
      waiting.what = 'the watch past the wait did not end';
      await waitOn(ctx, waiting, async () => Date.now() > dueAt + WATCH_PAST_DUE_MS || ctx.forms.posts.length !== posted, over => over);
      if (ctx.forms.posts.length !== posted) throw new Error(`after the start the app pressed Submit ${ctx.forms.posts.length - posted} time(s) on a wait the quit cut off`);
      if ((await backgroundStateOf(ctx.page, autoForm.url)) !== 'needs_user_handoff') throw new Error('after the wait ran out the job was no longer handed to you');
    } finally { await skipJob(ctx.page, autoForm); await closeHiddenBrowser(ctx.profile); }
  }, {needs, hangError: hangOf(ctx, waiting)});
}
