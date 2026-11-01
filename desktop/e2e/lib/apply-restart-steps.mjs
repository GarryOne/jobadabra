// The apply suite's restart steps: the app quits while its hidden browser holds a job (Background automation's filled form, Full automation's wait), then starts again.
// Why (30 Oct 2026, owner: "app quits mid-job" picked from the coverage sketch; then "A quit is a Stop"): only unit tests played a cut-off job. This step's first runs saw the job continued
// after the start, and Full automation press 80 s after it on the wait the quit cut off; now every job an earlier run held goes to the person and nothing is pressed. Every wait is on a state.
// Why (31 Oct 2026, owner, a8): move the app's test clock past the cut-off wait and read its handoff decision; the step's hang cap is the only real clock.
// Job: wait on state
import {HIDDEN_NEED, autoFormOf, backgroundOf, backgroundStateOf, closeHiddenBrowser, kitSeeder, linkRuntime, skipJob} from './background-proof.mjs';
import {advancePastDue, hangOf, startJob, waitOn} from './apply-hold.mjs';
import {FORMS} from './forms.mjs';
import {POSTING} from './apply-fixtures.mjs';

/** Starts one fixture job in `mode` (fill or auto, wait `waitMin`) and waits for the state the app holds it in. -> the posts count before the quit. */
async function holdJob(ctx, {form, seed, mode, waitMin, held, seen}) {
  const {page, forms} = ctx;
  await startJob(ctx, {form, seed, mode, waitMin});
  seen.what = `the job never reached ${held}`;
  await waitOn(ctx, seen, async () => (seen.state = await backgroundOf(page, form.url)), record => record?.state === held && (held !== 'waiting_to_submit' || record.waitDecision?.reason === 'waiting'));
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
  // Why (1 Nov 2026, a8; main run 41312448297 after #2813 re-cut the slices): on the submitter's own address this step followed "The hidden browser fills a form … becomes Applied" in one app,
  // whose held write (lib/view-cache.js, 10 min) kept the re-created job Applied, so Start found no kit. Each hidden-browser step has its own address, as ?check=, ?stop=, ?queue= do.
  const form = {...FORMS.submitter, url: `${FORMS.submitter.url}?restart=fill`};
  const autoForm = autoFormOf(FORMS.submitter, '?restart=1'), seed = kitSeeder(ctx, urls, POSTING), needs = [...ctx.needs, HIDDEN_NEED];
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
  }, {safety: true, needs, hangError: hangOf(ctx, filled)});

  await ctx.run('the app quits in Full automation\'s wait: after it starts again the job is handed to you, and nothing is pressed when the wait runs out', async () => {
    const unlinked = linkRuntime(ctx.profile);
    if (unlinked) throw new Error(unlinked);
    try {
      const posted = await holdJob(ctx, {form: autoForm, seed, mode: 'auto', waitMin: 1, held: 'waiting_to_submit', seen: waiting});
      await ctx.relaunch();
      await handedOver(ctx, autoForm.url, waiting);
      // Why (31 Oct 2026, owner, a8): the old alarm-margin watch took two minutes and hit the step cap despite the correct app_closed handoff; a moved clock plus the poll's verdict proves the same refusal.
      await advancePastDue(ctx, autoForm, waiting, {state: 'needs_user_handoff', reason: 'app_closed'});
      if (ctx.forms.posts.length !== posted) throw new Error(`after the start the app pressed Submit ${ctx.forms.posts.length - posted} time(s) on a wait the quit cut off`);
      if ((await backgroundStateOf(ctx.page, autoForm.url)) !== 'needs_user_handoff') throw new Error('after the wait ran out the job was no longer handed to you');
    } finally { await skipJob(ctx.page, autoForm); await closeHiddenBrowser(ctx.profile); }
  }, {safety: true, needs, hangError: hangOf(ctx, waiting)});
}
