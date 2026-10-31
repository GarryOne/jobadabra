// The apply suite presses Stop on the live card in both hidden-browser modes, reads the app's hand-off verdict, and moves the app clock past Full automation's cancelled due time.
/* global document, window */
// Why (30 Oct 2026, g2, owner): the older Full automation proof called liveStop directly, so it could pass with the card's Stop missing or unwired.
// Job: wait on state
import {HIDDEN_NEED, autoFormOf, backgroundOf, closeHiddenBrowser, kitSeeder, linkRuntime, openSessionCard, sessionOf, skipJob, withFormJudge} from './background-proof.mjs';
import {advancePastDue, hangOf, startJob, waitOn} from './apply-hold.mjs';
import {FORMS} from './forms.mjs';
import {POSTING} from './apply-fixtures.mjs';
import {liveCard} from '../../renderer/live-card.js';

/** Reads the actual live card, including its session, renderer state, words and enabled Stop button. */
const cardOf = page => page.evaluate(() => {
  const stop = [...document.querySelectorAll('#ss-actions button')].find(button => button.textContent.trim() === 'Stop');
  return {id: window.__jp.openSession?.id, background: window.__jp.openSession?.background, now: Date.now(),
    title: document.querySelector('#ss-next-title')?.textContent, note: document.querySelector('#ss-question > p')?.textContent,
    stop: !!stop && !stop.disabled && stop.getClientRects().length > 0};
});

/** Holds only the form judge's stand-in replies on a Promise; other asks keep their existing answers. release() settles every held reply without a timer. */
function holdJudge(previous) {
  const judge = withFormJudge(null, 'Submit Application');
  let release, pending = 0;
  const released = new Promise(resolve => { release = resolve; });
  return {release, waiting: () => pending > 0, answer: body => {
    const answer = judge(body);
    if (answer == null) return previous ? previous(body) : null;
    pending++;
    return released.then(() => answer);
  }};
}

/** Starts only this fixture job; returns its app record while a judge reply is held (Background) or the countdown is running (Full automation). */
async function holdJob(ctx, {form, seed, mode, seen, judge = null}) {
  const {page} = ctx, unlinked = linkRuntime(ctx.profile);
  if (unlinked) throw new Error(unlinked);
  await startJob(ctx, {form, seed, mode, waitMin: 1, canned: judge ? judge.answer : undefined});
  const held = mode === 'auto' ? 'waiting_to_submit' : 'the filling card with a held form-judge reply';
  seen.what = `the job never reached ${held}`;
  return waitOn(ctx, seen, async () => {
    const record = await backgroundOf(page, form.url);
    seen.state = {background: record, judgeHeld: judge?.waiting()};
    return record;
  }, record => mode === 'auto' ? record?.state === held && record.waitDecision?.reason === 'waiting' : !!record && liveCard(record).kind === 'filling' && judge.waiting());
}

/** Opens this session's live card, waits for its held state to be drawn, checks the countdown's own words, and clicks its real Stop. */
async function stopOnCard(ctx, form, held, seen) {
  const {page} = ctx, id = await sessionOf(page, form.url);
  await openSessionCard(page, form);
  seen.what = 'the live card never drew this job in its held state';
  const shown = await waitOn(ctx, seen, async () => (seen.state = await cardOf(page)), card => card.id === id && card.background?.state === held.state &&
    [liveCard(held, null, {now: () => card.now}).title, liveCard(held, {left: []}, {now: () => card.now}).title].includes(card.title));
  if (held.state === 'waiting_to_submit') {
    const expected = liveCard(held, null, {now: () => shown.now});
    if (shown.title !== expected.title || shown.note !== expected.note || held.dueAt <= shown.now + (held.waitClockOffset || 0)) throw new Error(`the wait's card did not show the renderer's countdown and note before it was due: ${JSON.stringify(shown)}`);
  }
  if (!shown.stop) throw new Error(`the held job has no enabled Stop on its live card: ${JSON.stringify(shown)}`);
  seen.what = 'Stop on the live card never handed the job to the person';
  await page.locator('#ss-actions').getByRole('button', {name: 'Stop', exact: true}).click();
  // liveStop marks the session stopped; controller.poll calls markManual('stopped'), and store.handoff records needs_user_handoff with manualOverride.
  const stopped = await waitOn(ctx, seen, async () => (seen.state = await backgroundOf(page, form.url)), record => record?.state === 'needs_user_handoff');
  if (stopped.reason !== 'stopped' || !stopped.manualOverride) throw new Error(`Stop gave the wrong hand-off verdict: ${JSON.stringify(stopped)}`);
}

/** Runs the two card-Stop proofs using separate fixture addresses; every started job is skipped and its hidden browser closed even on failure. */
export async function runStopSteps(ctx, {urls}) {
  const seed = kitSeeder(ctx, urls, POSTING), needs = [...ctx.needs, HIDDEN_NEED];
  const filling = {what: '', state: null}, waiting = {what: '', state: null};
  await ctx.run('Stop on the card in Background automation: while the form is filling, Stop hands it to you and nothing is posted', async () => {
    const form = autoFormOf(FORMS.submitter, '?stop=fill'), posted = ctx.forms.posts.length;
    const previous = ctx.proxy.canned(), judge = holdJudge(previous);
    try {
      const held = await holdJob(ctx, {form, seed, mode: 'fill', seen: filling, judge});
      await stopOnCard(ctx, form, held, filling);
      if (ctx.forms.posts.length !== posted) throw new Error(`Stop on the Background card let ${ctx.forms.posts.length - posted} POST(s) through`);
    } finally { judge.release(); ctx.proxy.setCanned(previous); await skipJob(ctx.page, form); await closeHiddenBrowser(ctx.profile); }
  }, {needs, hangError: hangOf(ctx, filling)});

  await ctx.run('Stop on the card in Full automation: the wait says when it will submit, Stop hands it to you, and nothing is posted past the due time', async () => {
    const form = autoFormOf(FORMS.submitter, '?stop=auto'), posted = ctx.forms.posts.length;
    try {
      const held = await holdJob(ctx, {form, seed, mode: 'auto', seen: waiting});
      if (!Number.isFinite(held.dueAt) || !held.dueAt) throw new Error('the waiting job has no due time to watch past');
      await stopOnCard(ctx, form, held, waiting);
      if (ctx.forms.posts.length !== posted) throw new Error(`Stop on the Full automation card let ${ctx.forms.posts.length - posted} POST(s) through`);
      await advancePastDue(ctx, form, waiting, {state: 'needs_user_handoff', reason: 'stopped'});
      if (ctx.forms.posts.length !== posted) throw new Error(`after Stop the app still posted ${ctx.forms.posts.length - posted} time(s)`);
      const last = await backgroundOf(ctx.page, form.url);
      if (last?.state !== 'needs_user_handoff' || last.reason !== 'stopped' || !last.manualOverride) throw new Error(`after the cancelled due time the Stop verdict changed: ${JSON.stringify(last)}`);
    } finally { await skipJob(ctx.page, form); await closeHiddenBrowser(ctx.profile); }
  }, {needs, hangError: hangOf(ctx, waiting)});
}
