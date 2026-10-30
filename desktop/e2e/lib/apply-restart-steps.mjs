/* global window */
// The apply suite's restart steps: the app quits while its hidden browser holds a job (Background automation's filled form, Full automation's wait), then starts again.
// Why (30 Oct 2026, owner: "app quits mid-job" picked from the coverage sketch): only unit tests played a cut-off job (sweepInterrupted covers a press, not a held form). The hidden browser dies
// with the app (lib/browser-reaper.js), so after the start nothing may press, and the job may not be left on a page that is gone. Every wait is on a state; the caps only catch a hang.
// Job: wait on state
import {backgroundStateOf, closeHiddenBrowser, describeHidden, linkRuntime, withFormJudge} from './background-proof.mjs';
import {appLogLines} from './app-log.mjs';
import {FORMS} from './forms.mjs';
import {POSTING} from './apply-fixtures.mjs';
import {addKitJob, removeJobsByUrl} from './seed-data.mjs';

const sessionOf = (page, url) => page.evaluate(target => window.pilot.sessions().then(list => list.find(item => String(item.url || '').replace(/\/$/, '') === target.replace(/\/$/, ''))?.id || ''), url);
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

/** After the start: the states the job passes through for `ms`, sampled every second, as "state@seconds" (the exploration's record). */
async function statesAfter(ctx, url, ms) {
  const seen = [], end = Date.now() + ms, from = Date.now();
  while (Date.now() < end) {
    const state = await backgroundStateOf(ctx.page, url).catch(() => '?');
    if (seen.at(-1)?.state !== state) seen.push({state, at: Math.round((Date.now() - from) / 1000)});
    await new Promise(done => setTimeout(done, 1000));
  }
  return seen;
}

/** Runs the restart steps; takes the harness context, the suite's fixture job addresses `urls` (removed first, so the one job Start picks is this step's) and its state wait `until`. */
export async function runRestartSteps(ctx, {urls, until}) {
  const form = FORMS.submitter;
  // Full automation needs every answer a saved fact: the submitter's details-only page (as lib/background-auto-proof.mjs), on its own address (one background session per address).
  const autoForm = {...form, path: form.autoPath, url: `https://${form.host}${form.autoPath}?restart=1`, kit: []};
  const seed = async job => { await removeJobsByUrl(ctx, urls);
    await addKitJob(ctx, {title: job.title, company: job.company, url: job.url, kit: {answers: job.kit || [], cover_letter: '', check_before_sending: [], eligible: true}, description: POSTING}); };
  const needs = [...ctx.needs, {name: 'a runtime link for the hidden browser (none on Windows)', value: process.platform !== 'win32'}];
  await ctx.run('the app quits while Background automation holds a filled form: after it starts again nothing is posted, and the job is not left on a page that is gone', async () => {
    const unlinked = linkRuntime(ctx.profile);
    if (unlinked) throw new Error(unlinked);
    try {
      const posted = await holdJob(ctx, {form, seed, until, mode: 'fill', held: 'ready_for_review'});
      await ctx.relaunch();
      const seen = await statesAfter(ctx, form.url, 60000);
      console.log(`  after the start: ${seen.map(item => `${item.state || 'none'}@${item.at}s`).join(' → ')} | ${applyLines(ctx.profile)}`);
      if (ctx.forms.posts.length !== posted) throw new Error(`after the start the form was posted ${ctx.forms.posts.length - posted} time(s)`);
      if (seen.at(-1)?.state === 'ready_for_review') throw new Error(`a minute after the start the job still says ready for review on the hidden page that died with the app: ${await describeHidden(ctx.profile)}`);
    } finally { await closeHiddenBrowser(ctx.profile); }
  }, {needs});

  await ctx.run('the app quits in Full automation\'s wait: after it starts again nothing is pressed, and the job is not left waiting on a page that is gone', async () => {
    const unlinked = linkRuntime(ctx.profile);
    if (unlinked) throw new Error(unlinked);
    try {
      const posted = await holdJob(ctx, {form: autoForm, seed, until, mode: 'auto', waitMin: 1, held: 'waiting_to_submit'});
      await ctx.relaunch();
      const id = await sessionOf(ctx.page, autoForm.url);
      const seen = await statesAfter(ctx, autoForm.url, 90000);   // past the 1-minute wait
      console.log(`  after the start (${id}): ${seen.map(item => `${item.state || 'none'}@${item.at}s`).join(' → ')} | ${applyLines(ctx.profile)}`);
      if (ctx.forms.posts.length !== posted) throw new Error(`after the start the app pressed Submit ${ctx.forms.posts.length - posted} time(s) on a wait the quit cut off`);
      if (seen.at(-1)?.state === 'waiting_to_submit') throw new Error(`90 s after the start (the wait was 1 minute) the job still waits on the hidden page that died with the app: ${await describeHidden(ctx.profile)}`);
    } finally { await closeHiddenBrowser(ctx.profile); }
  }, {needs});
}
