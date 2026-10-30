/* global document, window */
// The apply suite's Full automation confirmation steps: the one dialog in Settings → Apply, and the controller's refusal of a Full automation that was never confirmed.
// Why (30 Oct 2026, g2, owner via d3: "add e2e to close all the gaps … apply in different modes"): every Full automation step stamped `autoConfirmedAt` straight through window.pilot.saveSettings, so the dialog
// (renderer/apply-save.js) had unit tests only and nothing played Not now / Turn on in the real window. Every wait is on a state; the step's hang cap (apply.mjs) is the only clock.
// Job: wait on state
import {autoFormOf, kitSeeder, sessionOf} from './background-proof.mjs';
import {removeJobsByUrl} from './seed-data.mjs';
import {pollUntil} from './wait-on-state.mjs';
import {FORMS} from './forms.mjs';
import {POSTING} from './apply-fixtures.mjs';

let seen = '';   // what the step last waited on and read, for the hang report
/** Waits until `read()` gives a value `accepts` takes, with no clock of its own (the step's hang cap ends a hang); -> that value. `what` says what never happened, for the hang report. */
async function waitOn(what, read, accepts) {
  const {value} = await pollUntil(async () => { const now = await read(); seen = `${what} (last read: ${JSON.stringify(now)})`; return now; }, accepts, {capMs: Infinity, log: () => {}});
  return value;
}
const hung = ms => new Error(`the step did not finish within ${ms / 1000} s (it hung): ${seen || 'before its first wait'}`);

/** The apply settings the app saved ({mode, autoConfirmedAt, …}), read from the main process, never from the window's own copy. */
const savedApply = page => page.evaluate(() => window.pilot.state().then(state => state?.settings?.apply || {}));
/** The window's view of the mode cards and the confirmation dialog: {picked: the selected card's mode, open: the dialog is showing}. */
const screenOf = page => page.evaluate(() => ({picked: document.querySelector('#apply-modes .ui-choice.is-selected')?.dataset.choice || '', open: !!document.getElementById('auto-confirm-dialog')?.open}));

/** Reloads the window (it reads the saved settings again) and opens Settings → Apply, the way a link into Settings does (pages/settings.js openSetting). */
async function openApplySettings(page) {
  await page.reload();
  await page.waitForSelector('.view:not([hidden])');
  await page.evaluate(() => import('./pages/settings.js').then(module => module.openSetting('apply-mode')));
  await waitOn('Settings → Apply never showed its mode cards', () => page.evaluate(() => document.querySelectorAll('#apply-modes .ui-choice').length), count => count === 3);
}

/** Presses the card of `mode` in Settings → Apply. */
const pickMode = (page, mode) => page.click(`#apply-modes .ui-choice[data-choice="${mode}"]`);

/** Runs the confirmation steps; takes the harness context and the suite's fixture job addresses `urls` (removed first, so the one job Start picks is this step's). */
export async function runConfirmSteps(ctx, {urls}) {
  const {page, proxy, forms} = ctx;
  await ctx.run('Full automation asks once in Settings → Apply: Not now keeps the old mode and saves no confirmation, Turn on Full automation saves it', async () => {
    await openApplySettings(page);
    await pickMode(page, 'fill');
    await waitOn('Background automation was never saved from its card', () => savedApply(page), saved => saved.mode === 'fill' && !saved.autoConfirmedAt);   // the starting point, set through the window and read from the app

    await pickMode(page, 'auto');
    await waitOn('picking Full automation never opened its confirmation', () => screenOf(page), screen => screen.open);
    await page.click('#auto-confirm-cancel');
    await waitOn('"Not now" never closed the confirmation', () => screenOf(page), screen => !screen.open);
    const declined = await savedApply(page), shown = await screenOf(page);
    if (declined.mode !== 'fill' || declined.autoConfirmedAt) throw new Error(`"Not now" changed the saved mode: ${JSON.stringify(declined)}`);
    if (shown.picked !== 'fill') throw new Error(`after "Not now" the cards show "${shown.picked}" as chosen, not the old mode`);

    await pickMode(page, 'auto');
    await waitOn('picking Full automation again never opened its confirmation', () => screenOf(page), screen => screen.open);
    await page.click('#auto-confirm-go');
    const confirmed = await waitOn('"Turn on Full automation" never saved the mode with its confirmation', () => savedApply(page), saved => saved.mode === 'auto' && !!saved.autoConfirmedAt);
    if (Number.isNaN(Date.parse(confirmed.autoConfirmedAt))) throw new Error(`the saved confirmation is not a time: ${confirmed.autoConfirmedAt}`);
    await waitOn('after "Turn on Full automation" the cards never showed it chosen', () => screenOf(page), screen => screen.picked === 'auto' && !screen.open);
  }, {needs: ctx.needs, hangError: hung});

  await ctx.run('Full automation saved without its confirmation: the app refuses to start, and nothing is filled or sent', async () => {
    const form = autoFormOf(FORMS.submitter, '?unconfirmed=1');
    try {
      await kitSeeder(ctx, urls, POSTING)(form);
      const chosenAt = new Date().toISOString();
      await page.evaluate(at => window.pilot.saveSettings({apply: {mode: 'auto', chosenAt: at, auto: {waitMin: 0}}}), chosenAt);
      const saved = await savedApply(page);
      if (saved.mode !== 'auto' || saved.autoConfirmedAt) throw new Error(`the starting point did not take: ${JSON.stringify(saved)}`);   // positive control: Full automation saved, no confirmation
      const asked = proxy.stats.calls, posted = forms.posts.length;
      const started = await page.evaluate(() => window.pilot.apply({n: 1, mode: 'settings'}));   // lib/background-apply-controller.js enqueue
      if (started?.ok !== false || !/Full automation is off until you confirm it in Settings → Apply/.test(started?.error || '')) throw new Error(`Start did not refuse Full automation without its confirmation: ${JSON.stringify(started)}`);
      if (await sessionOf(page, form.url)) throw new Error('the refused Start left a session for the job');
      if (forms.posts.length !== posted) throw new Error(`the refused Start posted the form ${forms.posts.length - posted} time(s)`);
      if (proxy.stats.calls !== asked) throw new Error(`the refused Start asked the AI ${proxy.stats.calls - asked} time(s)`);
    } finally {
      await removeJobsByUrl(ctx, [form.url]);   // no session holds it, so it stays eligible and the next proof's Start would take it
      await page.evaluate(at => window.pilot.saveSettings({apply: {mode: 'fill', chosenAt: at}}), new Date().toISOString());
    }
  }, {needs: ctx.needs, hangError: hung});
}
