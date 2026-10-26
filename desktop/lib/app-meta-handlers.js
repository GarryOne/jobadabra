// The app's own state over IPC (moved out of main.js, 8 Oct 2026): the license, technical reports (telemetry, tester logs), sharing
// anonymous employer facts, app updates and the beta channel, the leaving question and feedback. main.js passes in the services they share.
// Guards: the license, telemetry, updater and beta tests in desktop/test.
import * as appFeedback from './app-feedback.js';
import * as github from './github.js';
import * as licenseLib from './license.js';
import * as pipeline from './pipeline.js';
import * as poolShare from './pool-share.js';
import * as setupFunnel from './setup-funnel.js';
import * as sharedLog from './shared-log.js';
import * as updater from './updater.js';
import {registerBuildHandlers} from './build-handlers.js';
import {log as appLog} from './log.js';
import {joinProWaitlist} from './pro-waitlist.js';

export function registerAppMetaHandlers(ctx) {
  const {DEMO, FROM_SOURCE, FROM_STORE = false, restartAfterQuitGuard, app, betaOn, checkForUpdate, cloud, installUpdate, ipcMain, licenseState, log, storage, testerLogsOn, testerOn, track, getLicense, getPlan, aiCaps = null, shell, getTelemetry, getUpdateOffer, getUpdateCheckedAt, channels} = ctx;
  // App updates (lib/updater.js): the latest stable release, offered in the menu; one click installs it.
  // Technical reports: the window's own errors come here; Settings shows the last ones sent and the switch.
  // Settings → Plan: where the user stands; a key from before 17 Oct 2026 is still checked offline and can be removed (no screen enters one any more).
  ipcMain.handle('license', () => ({...licenseState(), text: licenseLib.text(licenseState()), key: DEMO ? '' : getLicense().key()}));
  ipcMain.handle('licenseSet', (_, key) => {
    if (DEMO) return {ok: false, error: 'Demo mode: keys are not saved.'};
    const result = getLicense().set(String(key || ''));
    return result.ok ? {ok: true, state: {...result.state, text: licenseLib.text(result.state)}} : result;
  });
  // The Pro plan (lib/plan.js): the site's answer (kept 14 days offline), and a one-time payment opened in the browser. Both only when the plan is on at the site.
  ipcMain.handle('planState', async () => { const plan = getPlan(), now = plan.state(); return DEMO || (now.at && !now.stale) ? now : plan.refresh(); });
  ipcMain.handle('planCheckout', async (_, kind) => {
    if (!['pro', 'topup5', 'topup10', 'topup20'].includes(kind)) return {ok: false, error: 'Unknown purchase.'};
    const made = await getPlan().checkout(kind);
    if (made.ok) shell.openExternal(made.url);
    return made.ok ? {ok: true} : made;
  });
  ipcMain.handle('proWaitlistJoin', (_, email) => DEMO ? {ok: false, error: 'Demo mode: nobody is added to the waitlist.'} : joinProWaitlist(storage, email));   // Pro is not open yet: the address goes on the website's waitlist
  ipcMain.handle('planSignin', async (_, step, body = {}) => {   // "I have Pro": a code by e-mail adds this computer to the Pro account
    if (DEMO) return {ok: false, error: 'Demo mode: no sign-in.'};
    if (!['start', 'verify'].includes(step)) return {ok: false, error: 'Unknown step.'};
    return getPlan().signin(step, {email: String(body.email || '').slice(0, 200), code: String(body.code || '').slice(0, 12), ...(body.remove ? {remove: String(body.remove).slice(0, 64)} : {})});
  });
  ipcMain.handle('planRedeem', async (_, code) => {   // a promo code: the site checks it; a credit code may open our AI again, so the lines are asked afresh
    if (DEMO) return {ok: false, error: 'demo'};
    const result = await getPlan().redeem(String(code || '').slice(0, 64));
    if (result.ok && aiCaps) { aiCaps.forget(); await aiCaps.check({force: true, quiet: true}); }
    return result;
  });
  ipcMain.handle('licenseRemove', () => { const state = getLicense().remove(); return {...state, text: licenseLib.text(state)}; });
  ipcMain.handle('telemetryRecord', (_, kind, fields) => {
    // A window error also goes to app.log (type and message; the stack stays in the report): it was invisible there.
    if (kind === 'advice') appLog('advice', `${String(fields?.act || '?').slice(0, 10)} ${String(fields?.advice || '?').slice(0, 20)} on ${String(fields?.where || '?').slice(0, 20)}`, fields?.source ? {source: String(fields.source).slice(0, 30)} : {});   // what the app recommended, and what was taken
    if (kind === 'crash') appLog('window', `error on ${String(fields?.page || '?').slice(0, 30)}: ${String(fields?.type || 'Error').slice(0, 40)}: ${String(fields?.message || '').slice(0, 300)}`);
    getTelemetry()?.record(String(kind), fields || {});
    return true;
  });
  // The switch shows the saved choice (on unless turned off), also in a build that doesn't send (the reporter is null there).
  ipcMain.handle('telemetryShown', () => ({on: storage.settings().telemetry !== false, events: getTelemetry()?.shown() || [], shared: sharedLog.list(storage), tester: testerOn(), testerLogs: testerLogsOn()}));
  ipcMain.handle('testerLogsSet', (_, on) => { storage.saveSettings({testerLogs: !!on}); appLog('telemetry', `tester run logs ${on ? 'on' : 'off'}`); return {on: !!on}; });
  // "Help the pool grow" (opt-out, lib/pool-share.js): the switch, and exactly what would be sent (python -m src contribute --show).
  ipcMain.handle('poolShareGet', () => ({on: poolShare.on(storage)}));
  ipcMain.handle('poolShareSet', async (_, value) => {
    const result = poolShare.set(storage, value);
    appLog('pool', `Help the pool grow ${value ? 'on' : 'off'}`, {decidedBy: 'user switch'});
    if (cloud()) github.updateRepo(storage).catch(error => log(`GitHub repo not updated: ${error.message}`));
    return result;
  });
  ipcMain.handle('poolShareShown', async () => {
    const {code, stdout} = await pipeline.run(storage, ['src.contribute', '--show']);
    return {text: code === 0 ? stdout.trim() : 'Could not work out what would be sent right now.'};
  });
  ipcMain.handle('telemetrySet', (_, on) => { storage.saveSettings({telemetry: !!on}); if (!on) getTelemetry()?.flush(); return {on: !!on}; });
  ipcMain.handle('updateState', () => getUpdateOffer());
  ipcMain.handle('updateCheck', () => checkForUpdate(true));
  ipcMain.handle('updateStatus', () => ({current: app.getVersion(), offer: getUpdateOffer(), checkedAt: getUpdateCheckedAt(), fromSource: FROM_SOURCE, fromStore: FROM_STORE}));
  ipcMain.handle('updateInstall', () => installUpdate());
  registerBuildHandlers({app, ipcMain, restartApp: restartAfterQuitGuard, FROM_SOURCE, repo: pipeline.REPO});   // which build runs, and Restart to get N fixes (lib/build-handlers.js)
  // Beta and Test builds (Settings → Diagnostics): asked and saved by lib/update-channel.js, the same switch as the menu's Update Channel.
  // Only a click on its native dialog turns one on, never a script in the window. "Back to stable" installs the latest stable release even though it is older.
  ipcMain.handle('betaState', async () => {
    const stable = FROM_SOURCE || FROM_STORE ? null : await updater.stableRelease(app.getVersion()).catch(() => null);
    return {on: betaOn(), test: storage.settings().testChannel === true, current: app.getVersion(), stable: stable?.version || '', ahead: !!stable?.ahead, fromSource: FROM_SOURCE, fromStore: FROM_STORE};
  });
  ipcMain.handle('betaSet', (_, want) => channels.set('beta', want));
  ipcMain.handle('testSet', (_, want) => channels.set('test', want));
  ipcMain.handle('betaRollback', () => channels.rollback());
  // Why setup stopped (the quit question or "Stuck? Tell us"): a setup report; typed words also reach the owner.
  ipcMain.handle('leaveReason', async (_, answer = {}) => {
    const event = answer.reason ? setupFunnel.stopped(answer, storage.settings()) : null;
    if (event && getTelemetry()) { getTelemetry().record('setup', event); await getTelemetry().flush().catch(() => {}); }
    if (event?.said) await appFeedback.send({text: `[Setup · ${event.where} · ${setupFunnel.REASONS[event.reason]}] ${event.said}`, contact: answer.contact || ''},
      {storage, version: app.getVersion()}).catch(() => {});
    if (answer.mode === 'quit') setTimeout(() => app.quit(), 100);
    return {ok: true};
  });
  // Send feedback… (lib/app-feedback.js): to the owner, through the website. Demo mode sends nothing.
  ipcMain.handle('sendFeedback', (_, text, contact) => DEMO ? {ok: true}
    : appFeedback.send({text, contact}, {storage, version: app.getVersion()}).then(result => { if (result?.ok) track('feedback_sent', {}); return result; }));
}
