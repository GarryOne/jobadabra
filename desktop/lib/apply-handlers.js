// The application flow's IPC (moved out of main.js, 8 Oct 2026): Apply and Apply with Claude, the form page's review state, watch and focus, showing a
// job's form tab, un-applying, outcomes, the sign-in password and credentials, Google connection, open tabs and which forms are open, the
// extension's state and the learned answers. It hands back showForm for the browser handlers. A FLOW FILE (docs/flows/applying.md): changing
// it runs the whole scenario matrix (npm run flows). Guards: the apply, review and credentials tests in desktop/test and the e2e rows.
import * as applicationOutcomes from './outcomes.js';
import * as apply from './apply.js';
import * as credentials from './credentials.js';
import * as profileAccounts from './profile-accounts.js';
import * as extensionInstall from './extension-install.js';
import * as github from './github.js';
import * as pipeline from './pipeline.js';
import {killTree} from './kill-tree.js';
import * as questions from './questions.js';
import * as questionLists from './question-lists.js';
import * as detailsReview from './details-review.js';
import {claudeAi} from './question-ai.js';
import * as review from './review.js';
import {noteTabMiss} from './tab-expect.js';
import * as server from './server.js';
import {extensionReady} from './extension-ready.js';
import * as sitePassword from './site-password.js';
import * as terminals from './terminals.js';
import fs from 'node:fs';
import {GOOGLE_KEYCHAIN, GOOGLE_SCOPES_KEYCHAIN} from './google-keys.js';
import {log as appLog} from './log.js';
import {createTakeOver} from './ladder/rung5-takeover.js';
import {SHOW_RESUME_CLAUDE} from '../renderer/claude-help.js';
import {pageKeyOf, startRun} from './ladder/rung5-takeover-teach.js';
import {extensionGate as installedGate} from './extension-gate.js';
import {listTabs, openFormTab} from './form-tab.js';
import {sessionsNamedIn, sessionsWithTab} from './session-tab.js';
import {sharedCheck} from './shared-check.js';
import {withAccounts, withCompanies, withoutHost} from './site-accounts.js';
import {isTwin} from './twin.js';
import {OUTCOME_STAGES as BOARD_STAGES} from '../renderer/jobs-board-rules.js';
import {demoFormsOpen, demoPath} from './demo.js';
import {applyOf} from '../renderer/apply-settings-model.js';

export const extensionGate = installedGate;   // what main.js hands to every handler that opens a Chrome form
// The batch runner of each built Apply mode (renderer/apply-settings-model.js `built`). Why (28 Oct 2026, owner, #2317 rework): a mode with no runner
// is not built, so it never reaches the visible Chrome path; test/apply-dialog-mode.test.js fails when `built` and this map disagree.
export const BATCH_RUNNER = Object.freeze({check: 'chrome'});
export function registerApplyHandlers(ctx) {
  const {DEMO, applyRunner = apply, extensionGate = () => null, allowanceBlock, claudeConsent, cloud, here, ipcMain, log, nativeTheme = {shouldUseDarkColors: false}, needsNotion, prepareKitFor, getRecipeReporter, startClaude, storage, toWindow, track} = ctx;
  const needExtension = () => (DEMO ? null : extensionGate());   // a Chrome form with no extension to fill it: install it first (lib/extension-gate.js)
  ipcMain.handle('apply', async (_, options) => {
    const fromSettings = options?.mode === 'settings';   // Why (27 Oct 2026, owner): read after the first-choice gate replays the held call, so Start never uses a stale mode
    const mode = fromSettings ? BATCH_RUNNER[applyOf(storage.settings()).mode] : options?.mode;
    if (fromSettings && !mode) return {ok: false, error: 'This way of applying is coming soon. Choose Standard automation in Settings → Apply.'};
    const agents = mode === 'agents';
    const blocked = needsNotion('apply') || await allowanceBlock() || (agents ? null : needExtension());   // (an earlier one-line form sent these answers through the "Claude is off" branch)
    if (blocked) return blocked;
    if (agents && !SHOW_RESUME_CLAUDE) return {ok: false, error: 'Applying by session is not available in this version. Use Fill in Chrome.'};
    if (agents && !(await claudeConsent())) return {ok: false, error: 'Apply with Claude is off. Use Fill in Chrome, or allow it next time.'};
    return applyRunner.start(storage, {...options, mode}, undefined, undefined, undefined, undefined,
      (code, name) => prepareKitFor(code, name, {quiet: true}), text => toWindow('applyProgress', text));
  });
  ipcMain.handle('applyOne', async (_, url, details) => {
    const gate = needsNotion('apply');
    if (gate) return gate;
    const blocked = await allowanceBlock() || needExtension();
    if (blocked) return blocked;
    const result = await (DEMO ? apply.openOne(url, {session: 'demo'}) : apply.applyOne(storage, url, details || {}));
    if (result?.ok) track('apply_started', {how: 'extension'});
    return result;
  });
  // Checked session workflows share the production registration with the offline app scenario tests.
  ipcMain.handle('applyWithClaude', (_, url, details = null) => startClaude(url, details));
  const takeOver = createTakeOver({enabled: SHOW_RESUME_CLAUDE, startClaude, storage, appLog, toWindow, onStarted: url => startRun(pageKeyOf(url))});   // the panel's button or countdown and the session card's: the person's own request, once per application (lib/ladder/rung5-takeover.js)
  server.setTakeOverHandler(takeOver);
  ipcMain.handle('takeOverClaude', (_, url, details, consent) => takeOver({url, host: '', consent: !!consent,
    job: details ? {title: details.title, company: details.company, location: details.location, work_mode: details.workMode} : null}));
  server.setClaudeAutoHandler(event => {   // the panel's "Always let Claude finish when I'm stuck" box: the same switch as Settings
    storage.saveSettings({claudeAuto: !!event.on});
    appLog('extension', `always let Claude finish when stuck: ${event.on ? 'on' : 'off'} (from the panel)`);
  });
  // The form page and this page in step (lib/review.js): what to track in the form, and "show me this field".
  // Demo: each form's tab opened 12 minutes ago, so the card's "open for" reads the same in every screenshot.
  ipcMain.handle('reviewStates', () => (DEMO ? JSON.parse(fs.readFileSync(demoPath(here, 'review.json'), 'utf8'))
    .map(state => ({tabAt: Date.now() - 12 * 60 * 1000, ...state})) : review.allStates()));
  ipcMain.handle('reviewWatch', (_, id, items) => {
    appLog('review', `watch ${id}: ${(items || []).length} field(s)`, {labels: (items || []).map(item => String(item.label).slice(0, 60))});
    return review.setWatch(String(id), items);
  });
  // The extension first: the form page takes the request, brings its own tab forward and scrolls to the field (no
  // macOS permission needed, never the wrong tab). Only when no page answers does the app look for the tab itself.
  const showForm = async (id, label, url, company) => {
    const key = String(id), name = String(label || '');
    // On a Mac the form tab is found and brought forward first, through Chrome's own tab list: at once, whatever the page is
    // doing (a background tab's timers are slow). One attempt: it worked, or it says no tab is this job's form.
    if (process.platform === 'darwin' && !isTwin()) {   // a twin finds its tab through its own extension (lib/twin.js)
      // The session's own tab, by its bound id or the id in its address (lib/session-tab.js): nothing else is ever taken.
      const direct = await openFormTab({id: key, boundTab: review.tabOf(key)}).catch(() => 'none');
      if (direct !== 'tab') {
        appLog('review', `show ${key}: this session owns no open tab; nothing queued`, {went: direct, boundTab: review.tabOf(key)});
        review.forget(key);
        return {taken: false, went: 'none', found: null};
      }
      if (!name) { appLog('review', `show ${key}: went straight to the form tab`, {went: direct, boundTab: review.tabOf(key)}); return {taken: true, went: direct, found: null}; }
      // A field: the tab is in front now, so its page checks in quickly and scrolls to it.
      review.queueFocus(key, name);
      const answered = await review.delivered(key, 6000);
      if (!answered) review.cancelFocus(key);  // nobody took it: it must not fire later
      const seen = answered ? await review.focusFound(key, 3000) : null;
      appLog('review', `show ${key}: tab in front, ${answered ? 'the page took the field' : 'the page did not answer'}`, {label: name.slice(0, 60), found: seen});
      return {taken: answered, went: 'tab', found: seen};
    }
    const ready = await extensionReady(server.extensionSeen);   // just started: pages are known only after the extension's first tab report
    if (ready.waited) appLog('review', `show ${key}: waited for the extension's first check-in`, {ms: ready.waited, seen: ready.seen});
    review.queueFocus(key, name);
    let taken = await review.delivered(key, 4000), woke = false;  // the page checks in every 2 s
    if (!taken) {
      // The tab Claude opened has no panel. Wake the extension and inject into that tab; do not reload it.
      let host = '';
      try { host = new URL(String(url || '')).hostname; } catch { /* no url */ }
      appLog('review', 'extension not on the form tab: joining it', {host});
      woke = await extensionInstall.openInChrome(`chrome-extension://${server.extensionIdNow()}/wake.html`, {browser: apply.extensionBrowser()}).catch(() => false);
      appLog('review', `wake page ${woke ? 'opened' : 'did not open'}`, {browser: apply.extensionBrowser() || 'default'});
      taken = await review.delivered(key, 6000);
    }
    if (!taken) noteTabMiss(woke ? 'join_empty' : 'wake_failed');   // the step that failed, for the Technical reports (lib/tab-expect.js)
    if (!taken) review.cancelFocus(key);  // nobody took it: it must not fire later and pull Chrome forward
    const went = taken ? 'tab' : 'none';   // no page answered: the card offers to reopen the form, nothing is opened here
    appLog('review', `show ${key}: ${taken ? 'form page answered' : `no page answered, app went to: ${went}`}`, {label: name.slice(0, 60), taken: !!taken, went});
    const found = taken && name ? await review.focusFound(key, 3000) : null;
    return {taken, went, found};
  };
  ipcMain.handle('reviewFocus', async (_, id, label, url, company) => {
    const result = await showForm(id, label, url, company);
    const seen = server.extensionSeen(), latest = server.latestExtension();
    return {...result, extension: seen?.version || '', latest, outdated: !!(seen?.version && latest && seen.version !== latest)};
  });
  ipcMain.handle('unapplyJob', (_, url) => pipeline.unapply(storage, String(url)));
  // "This wasn't submitted": only ever asked for by the user, and only from a bare Applied.
  ipcMain.handle('notSubmitted', (_, url) => {
    const job = String(url);
    appLog('applied', `not submitted: undo asked for ${job}`);
    return pipeline.notSubmitted(storage, job).then(result => {
      appLog('applied', `not submitted: ${job} -> ${result.notion || result.error} (${result.events || 0} event(s) removed)`);
      return result;
    });
  });
  // "How did it go?" on a job: written to Notion like a stage the Gmail check found, then counted anonymously (lib/outcomes.js) if reports are on.
  ipcMain.handle('markOutcome', async (_, input) => {
    const outcome = String(input?.outcome || ''), url = String(input?.url || '');
    const stage = applicationOutcomes.STAGES[outcome];
    if (!stage || !url) return {ok: false, error: 'Unknown outcome.'};
    if (DEMO) return {ok: true, stage};
    appLog('outcome', `marked ${outcome} (${stage})`, {board: applicationOutcomes.anonymous({url, outcome})?.board || ''});
    const result = await pipeline.markOutcome(storage, url, stage);
    if (result.ok && outcome !== 'withdrawn') getRecipeReporter()?.application(applicationOutcomes.anonymous({url, outcome, appliedOn: input?.appliedOn}));
    if (result.ok && outcome !== 'withdrawn') getRecipeReporter()?.reply(String(input?.bucket || ''), outcome);   // the job's score band, to see whether the score predicts replies
    return result;
  });
  // Jobs → Board: a card moved to an outcome column (renderer/jobs-board-rules.js dropFor). The same engine step as markOutcome (the stage
  // and its 📈 event, the store's rules), without the anonymous outcome report: a move on the board can be a correction.
  ipcMain.handle('setStage', async (_, url, stage) => {
    const job = String(url || ''), to = String(stage || '');
    if (!job || !BOARD_STAGES.includes(to)) return {ok: false, error: 'That stage is set by Jobadabra, not by moving a card.'};
    const result = await pipeline.markOutcome(storage, job, to).catch(error => ({ok: false, error: error.message}));
    appLog('outcome', `moved on the board to ${to}: ${result.ok ? 'saved' : result.error || 'failed'}`, {by: 'you'});
    return result;
  });
  ipcMain.handle('claudeReady', () => apply.claudeReady(storage));
  // Settings → Application assistant: the old job-site password, for accounts made before 10 Oct 2026 (each new account has its own, in Credentials). Never made here on a Mac
  // where none exists; Copy puts it on the clipboard through the engine, never printed.
  ipcMain.handle('sitePassword', async (_, action) => {
    if (DEMO) return {ok: true, password: 'Maple-Rocket-42'};
    if (process.platform === 'darwin' && !sitePassword.read()) return {ok: false, error: 'No shared password: every account made by Jobadabra has its own. Show it in Credentials.'};
    if (action === 'show' && sitePassword.read()) return {ok: true, password: sitePassword.read()};
    const {code} = await pipeline.run(storage, ['src.ai.passwords', 'shared']);
    appLog('apply', `job-site password ${action === 'show' ? 'shown' : 'copied'}`, {ok: code === 0});
    if (code !== 0) return {ok: false, error: 'The password could not be made or read.'};
    return {ok: true, copied: true, password: action === 'show' ? sitePassword.read() : null};
  });
  // Settings → Credentials: the sites' accounts from the Keychain (attributes only), and one password when you press Show or Copy.
  ipcMain.handle('credentials', () => (DEMO ? {ok: true, rows: [{host: 'career2.successfactors.eu', email: 'you@example.com', job: 'https://jobs.migros.ch/x', created: '2026-10-08T11:54:02Z', state: 'confirmed', companies: ['Migros', 'Coop']}, {host: 'jobs.old-example.com', key: 'unassigned:jobs.old-example.com', unassigned: true, email: '', job: '', created: '2026-09-28T00:36:03Z'}]} : (list => ({...list, rows: withCompanies(withAccounts(list.rows, storage.settings().siteAccounts), review.allStates(), terminals.list())}))(credentials.list())));
  ipcMain.handle('credentialReveal', (_, host, why) => {
    const password = DEMO ? 'Maple-Rocket-42' : credentials.reveal(host);
    appLog('apply', `credential ${why === 'copy' ? 'copied' : 'shown'}`, {host: String(host || '').slice(0, 120), found: !!password});   // which site, never the password
    return password ? {ok: true, password} : {ok: false, error: 'Not in the Keychain any more.'};
  });
  // Delete: the site's password item, and the app's record of an account there (the next sign-in or sign-up page starts fresh). Logged: the host, never a secret.
  ipcMain.handle('credentialDelete', (_, host) => {
    if (DEMO) return {ok: true};
    const gone = credentials.forget(host);
    if (gone) storage.saveSettings({siteAccounts: withoutHost(storage.settings().siteAccounts, host)});
    appLog('apply', 'credential deleted', {host: String(host || '').slice(0, 120), ok: gone});
    return gone ? {ok: true} : {ok: false, error: 'It could not be deleted (not in the Keychain any more?).'};
  });
  // Assign: an account from before profiles (listed "not assigned") becomes this profile's; the old item goes only after the new one reads back equal. Logged: the host, never a secret.
  ipcMain.handle('credentialAssign', (_, key) => {
    const host = String(key || '').startsWith(credentials.UNASSIGNED) ? String(key).slice(credentials.UNASSIGNED.length) : '';
    if (DEMO) return {ok: true};
    const result = host ? profileAccounts.assign(host) : 'failed';
    appLog('apply', 'credential assigned to this profile', {host: host.slice(0, 120), result});
    return result === 'moved' ? {ok: true} : {ok: false, error: result === 'kept' ? 'This profile already has a different password for that site: both stay. Delete the one you do not need.' : 'It could not be moved (not in the Keychain any more?).'};
  });
  ipcMain.handle('claudePrereqs', async () => ({...apply.claudePrereqs(), inApp: await terminals.available()}));
  // Gmail and Calendar (read-only): replies and interviews, and sign-up confirmation emails for Apply with Claude.
  // The token lives in the Keychain, where the Python side (src/sources/google.py) reads it.
  // One Gmail check shared by every view (lib/shared-check.js): Settings' overview and the Gmail card ask at once.
  const googleStatus = sharedCheck(async () => {
    const {stdout} = await pipeline.run(storage, ['src.sources.google', 'status']);
    return JSON.parse(stdout.trim().split('\n').pop());  // unreadable: throws, so it isn't kept and is retried
  });
  ipcMain.handle('googleStatus', async () => {
    // Demo mode: the fictional user's account. The real check reads this Mac's Google sign-in (the Keychain, not the
    // demo folder), which put the owner's own address into the reference screenshots.
    // JOB_PILOTTO_DEMO_GOOGLE=off shows the disconnected states (the state viewer, e2e/mail-states.mjs).
    if (DEMO) return process.env.JOB_PILOTTO_DEMO_GOOGLE === 'off' ? {connected: false} : {connected: true, email: 'alex.morgan@example.com'};
    try { return await googleStatus(); } catch { return {connected: false}; }
  });
  let googleSignIn = null;   // the sign-in waiting for Google's redirect (up to 5 minutes): its child, so Cancel ends exactly this one
  ipcMain.handle('googleConnectCancel', () => { if (googleSignIn) { googleSignIn.cancelled = true; killTree(googleSignIn.child); } });
  ipcMain.handle('googleConnect', async (_event, {only} = {}) => {
    const gate = needsNotion('gmail');
    if (gate) return gate;
    if (googleSignIn) return {ok: false, error: 'A Google sign-in is already waiting.'};
    const mine = googleSignIn = {child: null, cancelled: false};
    const lines = [];
    // The browser's "connected" page follows the app's theme; `only` (gmail|calendar) is a reconnect asking just for the part left unticked.
    const args = ['src.sources.google', 'auth', '--theme', nativeTheme.shouldUseDarkColors ? 'dark' : 'light', ...(['gmail', 'calendar'].includes(only) ? ['--only', only] : [])];
    let code;
    try { ({code} = await pipeline.run(storage, args, line => lines.push(line), {}, {onChild: child => { mine.child = child; }})); }
    finally { googleSignIn = null; }
    if (mine.cancelled) return {ok: false, cancelled: true, error: 'Sign-in cancelled.'};
    googleStatus.forget();   // the next status asks again, so the new account shows at once
    // Always on: the new sign-in goes to the GitHub repo too, so the Gmail check there can use it.
    if (code === 0 && cloud()) github.updateRepo(storage).catch(error => log(`Google sign-in not sent to GitHub: ${error.message}`));
    return code === 0 ? {ok: true} : {ok: false, error: lines.filter(line => !/^Opening|^https?:/.test(line)).slice(-1)[0] || 'Sign-in did not complete'};
  });
  // Settings → Connections → ⋯ → Disconnect Gmail (owner, 7 Oct 2026): revoked at Google, forgotten in the Keychain and, with
  // Always on, in the GitHub repo. Logged: what was asked and what each step did, never the token.
  ipcMain.handle('googleDisconnect', async () => {
    if (DEMO) return {ok: false, error: 'Demo mode: the sign-in is not changed.'};
    const {code, stdout} = await pipeline.run(storage, ['src.sources.google', 'disconnect']);
    let result = {};
    try { result = JSON.parse(String(stdout).trim().split('\n').pop()); } catch {}
    googleStatus.forget();
    let inRepo = false;
    if (code === 0 && cloud()) inRepo = await github.removeRepoSecrets(storage, [...Object.keys(GOOGLE_KEYCHAIN), ...Object.keys(GOOGLE_SCOPES_KEYCHAIN)]).catch(error => { appLog('connections', 'Gmail secrets not removed from GitHub', {error: error.message}); return 'failed'; });
    appLog('connections', 'Gmail disconnected', {from: 'settings', code, revoked: !!result.revoked, wasConnected: !!result.was_connected, github: inRepo});
    return code === 0 && result.ok ? {ok: true, revoked: !!result.revoked, github: inRepo} : {ok: false, error: 'Gmail could not be disconnected: try again'};
  });
  ipcMain.handle('openTabs', () => server.openTabs());
  let liveAt = 0, liveList = [];
  const liveTabs = async () => { if (Date.now() - liveAt > 1500) { liveList = await listTabs(); liveAt = Date.now(); } return liveList; };   // the poll runs every 2 s: one scripting call each
  // Which sessions' forms are still open in Chrome, by the extension's own tab report. `known` is false while the
  // extension has not checked in lately: then nothing can be said about a closed tab, so the page says nothing.
  let lastFormsOpen = '';
  ipcMain.handle('formsOpen', async () => {
    if (DEMO) return demoFormsOpen(JSON.parse(fs.readFileSync(demoPath(here, 'review.json'), 'utf8')));   // the demo's forms, as Chrome would report them (lib/demo.js)
    const seen = server.extensionSeen(), known = !!seen && Date.now() - seen.at < 90 * 1000;
    if (!known) return {known, ids: []};
    // A session whose own tab we know is open while that tab exists; for the others, a tab that looks like its form says open, nothing says closed.
    // Open is proved two ways, each exact: a tab in the extension's report naming the session in its address, or in Chrome's own list right now
    // (Mac scripting, read at each check, so a screen opened after a restart never waits for the extension's next 30 s report).
    const sessions = terminals.list(), byLook = sessionsNamedIn(sessions, server.openTabs());
    for (const id of sessionsWithTab(sessions, DEMO ? [] : await liveTabs(), sessionId => review.tabOf(sessionId))) byLook.add(id);
    const {ids, unsure} = review.formStates(sessions.map(session => session.id), byLook);
    const line = `${ids.join(',') || 'none'}${unsure.length ? ` (not known: ${unsure.join(',')})` : ''}`;
    if (line !== lastFormsOpen) { lastFormsOpen = line; appLog('review', `forms open in Chrome: ${line}`, {sessions: sessions.length}); }   // who is open, when it changed
    return {known, ids, unsure};
  });
  // latest + note: the pages show one wording for a stale copy (server.staleExtension), the same sentence the app
  // records with a failed fill.
  ipcMain.handle('extensionSeen', () => {
    const seen = server.extensionSeen();
    if (!seen) return null;
    const latest = server.latestExtension();
    return {...seen, latest, note: server.staleExtension(seen.version, latest)};
  });
  // A failed Notion read is reported (not an empty list), so the section says why instead of disappearing.
  ipcMain.handle('openQuestions', () => (DEMO ? Promise.resolve({list: [...(storage.settings().openQuestions || []), ...(storage.settings().demoDetailsReview || [])], hidden: storage.settings().hiddenQuestions || []}) : questionLists.openShown(storage))
    .then(({list, hidden, consent = 0, fromDetails = 0}) => ({ok: true, list, hidden, consent, fromDetails}), error => ({ok: false, error: error.message, list: [], hidden: []})));
  ipcMain.handle('jobQuestions', (_, url) => questionLists.jobQuestions(storage, url));
  ipcMain.handle('jobQuestionOnly', (_, question) => (DEMO ? {ok: true} : needsNotion('profile') || questionLists.onlyThisJob(storage, String(question || '')).catch(error => ({ok: false, error: error.message}))));
  // Profile → Needs review: the AI's verdict per open question (kept per question), filtered in the window by the same rule.
  // unmarked: the labels whose line carries no kind mark (the AI judges those once, lib/question-formats.js).
  ipcMain.handle('questionVerdicts', (_, labels, unmarked) => (DEMO ? Promise.resolve({verdicts: storage.settings().questionVerdicts || {}, formats: storage.settings().questionFormats || {}})
    : questionLists.reviewVerdicts(storage, (labels || []).map(String).slice(0, 200), Array.isArray(unmarked) ? {unmarked: unmarked.map(String).slice(0, 200)} : {}))
    .then(({verdicts, formats = {}}) => ({ok: true, verdicts, formats}), error => ({ok: false, error: error.message, verdicts: {}, formats: {}})));
  // mark: the kind the window drew it with ({kind, options, list}), written with the first answer of a question that had none (lib/questions.js answer).
  // options.jobOnly (the drawer's "Reuse for matching questions" off): kept with the application that asked (options.company), nowhere else.
  // options.also: the keys of the other wordings of the same question (one item in the queue, renderer/question-filter.js): they get the same answer.
  // A Your details item of the queue (lib/details-review.js) is answered into its section or Profile line.
  ipcMain.handle('answerQuestion', (_, questionKey, answer, mark, options) => needsNotion('profile') || (detailsReview.isDetailsKey(questionKey)
    ? detailsReview.answer(storage, String(questionKey), String(answer ?? ''), {ai: claudeAi(storage)}) : questions.answerAll(storage, [questionKey, ...(Array.isArray(options?.also) ? options.also.map(String).slice(0, 20) : [])], answer, undefined, mark && typeof mark === 'object' ? mark : null,
    {ai: claudeAi(storage), ...(options?.jobOnly ? {jobOnly: {company: String(options.company || '')}} : {})}))
    .catch(error => ({ok: false, error: `Notion: ${error.message}`})));
  // A session's ❓ fact, answered with one tick on the session page: saved to its home (Your details or the standard answers page, lib/answer-home.js).
  ipcMain.handle('rememberAnswer', (_, question, answer) => (DEMO ? Promise.resolve({ok: true}) : needsNotion('profile') || questions.remember(storage, question, answer, undefined, {ai: claudeAi(storage)}))
    .catch(error => ({ok: false, error: `Notion: ${error.message}`})));
  // Saved keys as dots plus their last 4 characters, so Settings can show which key is stored (never the key).
  ipcMain.handle('secretHints', () => Object.fromEntries(['ANTHROPIC_API_KEY', 'NOTION_TOKEN', 'TELEGRAM_BOT_TOKEN', 'SERPAPI_API_KEY', 'ADZUNA_APP_ID', 'ADZUNA_APP_KEY', 'JOOBLE_API_KEY', 'OPENAI_API_KEY', 'BRAVE_SEARCH_API_KEY']
    .map(name => [name, storage.secret(name)]).filter(([, value]) => value).map(([name, value]) => [name, `${'•'.repeat(12)}${value.slice(-4)}`])));
  return {showForm};   // the browser handlers (lib/browser-handlers.js) show a job's form tab through it
}
