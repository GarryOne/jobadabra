// Jobadabra desktop app: a local-first cockpit for the job search. Data and keys stay on this Mac.
import {app, BrowserWindow, clipboard, crashReporter, Menu, desktopCapturer, dialog, ipcMain, nativeImage, nativeTheme, Notification, powerMonitor, safeStorage, screen, session, shell, systemPreferences} from 'electron';
import {guard as applyChoiceGuard} from './lib/apply-choice-gate.js';
import {aiNameOf, claudeFamily} from './lib/ai/names.js';
import {takeoverOffered, takeoverOn} from './lib/claude-ready.js';
import {SHOW_RESUME_CLAUDE} from './renderer/claude-help.js';
import {setPdfReader} from './lib/ai/codex-cli.js';
import {electronPdfReader} from './lib/ai/pdf-pages.js';
import {recordIpc} from './lib/e2e-ipc.js';
import {isTwin, twinRefusal} from './lib/twin.js';
import {forWindow} from './lib/site-accounts.js';
import {channelsOf} from './lib/notify-channel.js';
import * as devMarker from './lib/dev-marker.js';
import {hideWindows} from './lib/e2e-hidden.js';
import fs from 'node:fs';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import * as apply from './lib/apply.js';
import {createRestarter} from './lib/restart.js';
import {claimInstance, startWhenReady, installQuitHandling} from './lib/lifecycle.js';
import * as critical from './lib/critical.js';
import * as pageRender from './lib/page-render.js';
import {closeSessionTab, registerSessionHandlers} from './lib/session-handlers.js';
import {registerAppMetaHandlers} from './lib/app-meta-handlers.js';
import {registerInterviewHandlers} from './lib/interview-handlers.js';
import {registerCvAndLettersHandlers} from './lib/cv-handlers.js';
import {registerCvBuildHandlers} from './lib/cv-build-handlers.js';
import {registerExperienceHandlers} from './lib/experience-handlers.js';
import {registerContactHandlers} from './lib/contact-handlers.js';
import {registerStoreHandlers, settleStore, startOnNotionIfEmpty, storeState} from './lib/store-handlers.js';
import {registerJobPageHandlers} from './lib/job-page-handlers.js';
import {registerTextHandlers} from './lib/text-handlers.js';
import {registerReportsHandlers} from './lib/reports-handlers.js';
import {registerEmployersHandlers} from './lib/employers-handlers.js';
import {registerFormFillsHandlers} from './lib/form-fills-handlers.js';
import {registerSearchesHandlers} from './lib/searches-handlers.js';
import {registerSearchTuningHandlers} from './lib/search-tuning-handlers.js';
import {settingsDepsFor} from './lib/settings-deps.js';
import {createSessionFlow} from './lib/session-flow.js';
import * as cvlib from './lib/cv.js';
import * as tailorStatus from './lib/tailor-status.js';
import * as github from './lib/github.js';
import * as reminders from './lib/interview-reminders.js';
import * as engineLog from './lib/engine-log.js';
import * as requestLog from './lib/request-log.js';
import {googleSecrets} from './lib/google-keys.js';
import * as targets from './renderer/targets.js';
import {clearlyTechnical} from './renderer/audience.js';   // pure (no DOM), the same rule as src/coverage.py   // pure (no DOM), shared with the window
import * as notion from './lib/notion.js';
import * as telegram from './lib/telegram.js';
import * as pipeline from './lib/pipeline.js';
import * as server from './lib/server.js';
import * as terminals from './lib/terminals.js';
import * as transcript from './lib/transcript.js';
import {offerMove} from './lib/applications.js';
import * as aiFree from './lib/ai-free.js';
import * as claudeCode from './lib/claude-code.js';
import * as setupFunnel from './lib/setup-funnel.js';
import {sharedRead} from './lib/shared-read.js';
import * as pendingLicense from './lib/pending-license.js';
import * as installSource from './lib/install-source.js';
import * as review from './lib/review.js';
import * as sessionRuns from './lib/session-runs.js';
import {closeFormTab} from './lib/form-tab.js';
import {log as appLog, logTo} from './lib/log.js';
import electronLog from 'electron-log/main.js';
import {versionLine} from './lib/window-log.js';
import * as viewCache from './lib/view-cache.js';
import * as migrate from './lib/migrate.js';
import * as reset from './lib/reset.js';
import {createDataJob} from './lib/data-job.js';
import {createCvSync} from './lib/cv-sync.js';
import {installCrashMonitors} from './lib/crash-monitors.js';
import * as backup from './lib/backup.js';
import * as notionGate from './lib/notion-gate.js';
import * as notionWorkspace from './lib/notion-workspace.js';
import {createStorage, safeStorageCrypto} from './lib/storage.js';
import {fileURLToPath} from 'node:url';
import * as licenseLib from './lib/license.js'; import * as trialServer from './lib/trial-server.js';
import * as demo from './lib/demo.js';
import * as intelLib from './renderer/intel.js';
import {registerBrowserHandlers} from './lib/browser-handlers.js';
import {registerVisitsHandlers} from './lib/visits-handlers.js';
import {registerKitHandlers} from './lib/kit-handlers.js';
import {extensionGate, registerApplyHandlers} from './lib/apply-handlers.js';
import {registerFocusHandlers} from './lib/focus-handlers.js';
import {registerSystemHandlers} from './lib/system-handlers.js';
import {registerLeadsHandlers} from './lib/leads-handlers.js';
import * as calltap from './lib/calltap.js';
import * as interviews from './lib/interviews.js';
import {registerJobActionsHandlers} from './lib/job-actions-handlers.js';
import {registerCloudHandlers} from './lib/cloud-handlers.js';
import {registerJobsHandlers} from './lib/jobs-handlers.js';
import {registerJobsExportHandlers} from './lib/jobs-export-handlers.js';
import {registerStrategyDraftHandlers} from './lib/strategy-draft-handlers.js';
import {registerDraftEditHandlers} from './lib/draft-edit-handlers.js';
import {registerSetupHandlers} from './lib/setup-handlers.js';
import {registerExtServerHandlers} from './lib/ext-server-handlers.js';
import {registerBackgroundHandlers} from './lib/background-handlers.js';
import {createAppNotify} from './lib/app-notify.js';
import {createAppUpdates} from './lib/app-updates.js'; import {createZoom} from './lib/zoom-handlers.js';
import {createMainWindow} from './lib/main-window.js';
import {createAppReminders} from './lib/app-reminders.js';
import {createCvWindows} from './lib/cv-windows.js';
import {createAppAllowance} from './lib/app-allowance.js';
import {keepLegacyIdentity} from './lib/app-identity.js';
import {registerTelemetryHandlers} from './lib/telemetry-handlers.js';

// Recent activity: Notion ⏱️ Search runs rows (run-history.js), refreshed every 15 s, and the jobs just sent to
// GitHub that haven't opened their row yet.
const cloud = () => demo.cloudRuns(storage?.settings(), DEMO);   // never in the demo (lib/demo.js cloudRuns)
let telemetry = null;  // technical reports (lib/telemetry.js), made once storage exists
let analytics = null;  // usage events (lib/analytics.js, PostHog); crash reports (lib/sentry.js) have the same gate and switch as telemetry
let trail = null;  // lib/sentry.js note(): the last steps, attached to the next crash report
const track = (event, props) => { analytics?.track(event, props); if (event !== 'screen_time' && event !== 'ui_click') trail?.(event, props); };   // usage signals stay out of the crash trail
let recipeReporterRef = null;  // the batched, anonymous product counts (lib/recipes.js), made when the app is ready
let license = null;  // the free allowance and license keys (lib/license.js), made once storage exists
const zoom = createZoom({screen, getWindow: () => window, getStorage: () => storage, toWindow});   // the window's size, remembered (lib/zoom-handlers.js)
const {getUpdateOffer, setUpdateOffer, getUpdateCheckedAt, FROM_SOURCE, FROM_STORE, betaOn, testerOn, testerLogsOn, checkForUpdate, buildMenu, trackSetup, installUpdate, channels} =
  createAppUpdates({zoom, Menu, app, dialog, isDemo: () => DEMO, getStorage: () => storage, getTelemetry: () => telemetry, toWindow, track, getWindow: () => window, openExternal: url => shell.openExternal(url)});   // lib/app-updates.js
const here = path.dirname(fileURLToPath(import.meta.url));
// Demo mode (JOB_PILOTTO_DEMO=1, with JOB_PILOTTO_USER_DATA pointing at a copy of demo/): fictional
// profile and jobs for screenshots (scripts/screenshots.mjs). Nothing is contacted: no Python, Telegram,
// GitHub or local server, and the keys in demo/secrets.json are placeholders stored unencrypted.
// "Look around first" (setup wizard, lib/demo.js) starts it too, with --job-pilotto-demo=<a fresh copy of demo/>:
// the same, plus the banner with "Set up my own", and the actions that would reach outside answer "demo".
const DEMO_FOLDER = demo.folderFrom(process.argv);
const LOOK_AROUND = !!DEMO_FOLDER;
const DEMO = !!process.env.JOB_PILOTTO_DEMO || LOOK_AROUND;
const {licenseState, allowanceBlock, allowanceGate, aiGate, aiCaps, watchAiCaps, readSites, scoreVisitJobs, healthOnce, getPlan} = createAppAllowance({DEMO, getLicense: () => license, log: line => log(line), getStorage: () => storage, getTelemetry: () => telemetry, toWindow});   // lib/app-allowance.js
const JOBS_PAGE = 200;   // the Jobs list's first page; each "Show more" adds 500
const HIDDEN = hideWindows({app, BrowserWindow, shell});   // an e2e run: windows never show or take focus (lib/e2e-hidden.js)
pipeline.setDemo(DEMO);  // Python: only the jobs that read the demo folder
// Always on also gives the repo the Google sign-in (kept in the Keychain by the Python side, not the app's store).
github.setExtraSecrets(() => (DEMO ? {} : googleSecrets()));
setPdfReader(electronPdfReader(BrowserWindow));   // Codex reads a PDF as its pages' pictures and text (lib/ai/pdf-pages.js)
// The user's repo runs this app's own release of the code (a source checkout: main), so both update together.
github.setEngineRef(app.isPackaged ? `desktop-v${app.getVersion()}` : 'main');
// Version shown in the About box and the sidebar. build-info.json is written by the packaged build
// (scripts/stage.mjs --app); without it this is a development copy (npm start).
const buildInfo = (() => { try { return JSON.parse(fs.readFileSync(path.join(here, 'build-info.json'), 'utf8')); } catch { return null; } })();
const about = {version: app.getVersion(), build: buildInfo?.build || null, commit: buildInfo?.commit || null, dev: !app.isPackaged && !DEMO, mark: devMarker.mark(),
  label: DEMO ? app.getVersion() : buildInfo ? `${app.getVersion()} (build ${buildInfo.build}, ${buildInfo.commit})` : `${app.getVersion()} (development)`};
let storage;
let window;
// AI steps can run: the user chose their own Claude Code, or saved an API key (lib/claude-code.js).
const aiReady = () => claudeCode.aiReady(storage.settings(), !!storage.secret('ANTHROPIC_API_KEY'), !!storage.secret('OPENAI_API_KEY'));
let polling = null;

function restartTelegram() {
  polling?.stop();
  if (isTwin()) { polling = null; return; }   // a twin never polls the owner's bot (lib/twin.js)
  polling = telegram.startPolling(storage, log, undefined, dispatchNote);
}

const {openNotion, applyTheme, createWindow} = createMainWindow({BrowserWindow, DEMO, HIDDEN, app, dialog, here, nativeTheme, shell, getWindow: () => window, setWindow: value => { window = value; }, getZoom: () => zoom});   // lib/main-window.js

// Every message to the window goes through here: a closed or crashed window is skipped, never a crash.
function toWindow(...args) {
  if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send(...args);
}
const log = line => { if (pipeline.isDataLine(line)) return; pipeline.keep(line); toWindow('log', line); };   // JSON answers are for the app, not the window   // a running task keeps what the window was shown (lib/pipeline.js keep)

// Every cloud run this app starts is written to its own log, with the caller named at the call site: a dispatch
// spends money and time on GitHub, and two runs 38 s apart for one interview could not be told apart afterwards
// without it (1 Oct 2026). Lines: `start <caller> → <workflow> (<mode>) #<digest> in <repo>`, then `sent`/`failed`.
const dispatchNote = line => appLog('dispatch', line);
const dispatchCloud = (why, inputs, workflow) =>
  github.cloudDispatch(storage, log, {note: dispatchNote})(inputs, workflow, why);

const {keepLook, printPdf, renderDocx, openTailoredCv, readCvPdf, pageImages} = createCvWindows({BrowserWindow, HIDDEN, clipboard, shell, getStorage: () => storage});   // lib/cv-windows.js
const {notify, activity, announceRuns} = createAppNotify({DEMO, Notification, app, getStorage: () => storage, targets, toWindow, getWindow: () => window});   // lib/app-notify.js

function handlers() {
  // Demo mode: what would reach outside or change this computer answers "demo" instead (lib/demo.js BLOCKED).
  if (DEMO) ipcMain.handle = demo.guard(ipcMain.handle.bind(ipcMain));
  // End-to-end run: log every call the window makes (the interaction probe reads it, see lib/e2e-ipc.js).
  ipcMain.handle = applyChoiceGuard(ipcMain.handle.bind(ipcMain), () => storage, appLog);   // first Apply: choose how to apply first (lib/apply-choice-gate.js)
  if (process.env.JOB_PILOTTO_E2E) { globalThis.__jpIpc = []; ipcMain.handle = recordIpc(ipcMain.handle.bind(ipcMain), globalThis.__jpIpc); }
  // Notion later: without Notion the app only tries; a tracking action returns notionGate.needs(reason) and the window
  // opens the connect dialog (pages/core.js gated()). null = go on.
  const needsNotion = reason => {
    const answer = notionGate.check(storage, reason, {demo: DEMO});
    if (answer) appLog('notion', 'gate', {reason, outcome: 'asked'});
    return answer;
  };
  ipcMain.handle('state', () => ({
    about,
    settings: forWindow(storage.settings()),   // the window shows the effective choice, whatever was never saved
    secrets: storage.secretsPresent(), notifyBy: channelsOf(storage),   // how the person is told (Connections: Telegram optional once e-mail is chosen)
    hasCv: fs.existsSync(storage.path('cv.pdf')), hasProfile: !!(storage.settings().setupDone && (storage.settings().notionIds?.NOTION_PROFILE_PAGE_ID || storage.readText('profile.md'))),
    folder: storage.dir,
    store: storeState(storage),   // where the data lives (lib/store): {label, caps, trying}
    // Notion page links only when Notion is the store (lib/store): with the data on this Mac, none.
    notion: storage.secret('NOTION_TOKEN') && notionGate.onNotion(storage) ? Object.fromEntries(Object.entries(storage.settings().notionIds || {})
      .map(([env, id]) => [env, notion.pageUrl(id)])) : null,
    templateUrl: notion.TEMPLATE.template_url,
    notionReasons: notionGate.REASONS,  // the sentences after "Connect Notion …" (one source: lib/notion-gate.js)
    notionTitles: {...notion.TEMPLATE.databases, ...notion.TEMPLATE.pages},
    demo: DEMO ? {lookAround: LOOK_AROUND} : null,
  }));
  // "Look around first" (setup wizard): restart on a fresh copy of the demo data. The user's own folder, keys and
  // setup step stay as they are; "Set up my own" (leaveDemo) restarts back into them.
  ipcMain.handle('lookAround', async (_, from = '') => {
    let folder;
    try { folder = demo.prepare(demo.folder(here)); } catch (error) { return {ok: false, error: `The demo couldn't start: ${error.message}`}; }
    if (telemetry) {
      telemetry.record('setup', setupFunnel.lookAround(String(from), storage.settings()));
      await Promise.race([telemetry.flush(), new Promise(resolve => setTimeout(resolve, 1500))]);  // else sent at the next start
    }
    restartApp('look around (demo)', {args: demo.restartArgs(process.argv, folder)});
    return {ok: true};
  });
  ipcMain.handle('leaveDemo', () => {
    if (!LOOK_AROUND) return {ok: false};
    restartApp('leave the demo', {args: demo.restartArgs(process.argv)});
    return {ok: true};
  });
  // Connect to the user's Notion with a token (pasted, or from "Connect with Notion"): find the workspace, or
  // build it from the schema (lib/notion-workspace.js; templateRoot: the page Notion just copied the template into).
  // This computer's own name ("Igor's MacBook Pro"), as the person named it; the host name without ".local" elsewhere.
  const computerName = () => {
    if (process.platform === 'darwin') { try { return execFileSync('scutil', ['--get', 'ComputerName'], {encoding: 'utf8', timeout: 2000}).trim(); } catch {} }
    return os.hostname().replace(/\.local$/, '');
  };
  let notionFrom = 'token';
  async function connectNotion(token, {templateRoot = null} = {}) {
    try {
      const titles = {...notion.TEMPLATE.databases, ...notion.TEMPLATE.pages};
      const send = progress => toWindow('notionProgress', {...progress, titles});
      const result = await notionWorkspace.connectWorkspace(token, {templateRoot, fresh: !Object.keys(storage.settings().notionIds || {}).length, onProgress: send});
      let kept = null, startedOnNotion = false;
      if (result.ok) {
        storage.setSecret('NOTION_TOKEN', token);
        storage.saveSettings({notionIds: result.ids});
        // Notion later: a strategy kept on this Mac while trying moves in (lib/migrate.js 'strategy from this Mac'). A workspace the
        // app just built (or Notion just copied the template into) is empty, so this Mac's strategy wins; any other workspace
        // already had data, and Notion wins. Saved first, so a step that fails retries next start with the same answer.
        const hadLocal = !!(storage.readText('profile.md').trim() || storage.readText('answers.md').trim());
        // This Mac's store with nothing in it yet: the data lives in Notion from now on. First, so the answer below reads the store as it is now (a Notion store takes this Mac's strategy in).
        if (!DEMO) startedOnNotion = await startOnNotionIfEmpty(storage, {log: appLog}).catch(error => { log(`Store not switched to Notion: ${error.message}`); return false; });
        storage.saveSettings(migrate.connectSettings(storage.settings(), {hadLocal, fresh: !!(result.built?.length || templateRoot)}));
        if (!DEMO) {
          if (hadLocal) send({moving: true});
          const moved = await migrate.run(storage, log);  // anything kept on this Mac moves in now
          kept = storage.settings().notionKeptFolder || null;
          if (kept) storage.saveSettings({notionKeptFolder: undefined});
          // A page made by this connect (Notion's template copy, or built by the app) is named after this computer and today, so a second
          // install connecting the same Notion doesn't leave two pages both called "Jobadabra". Never blocks the connect.
          const fresh = !!(result.built?.length || templateRoot);
          const page = fresh ? await notion.nameWorkspace(token, result.ids, notion.workspaceTitle(computerName()))
            .catch(error => { log(`Notion page not renamed: ${error.message}`); return null; }) : null;
          if (storage.settings().importedNotion) storage.saveSettings({importedNotion: null});   // the import's warning has done its job
          appLog('notion', 'connected', {from: notionFrom, fresh, page: page?.id?.slice(-8) || '', renamed: !!page?.renamed, moved, kept: !!kept, hadLocal});
          syncCv();
          // What was scored before Notion reaches Job Matches, with no AI spend; with Always on GitHub's next run does it.
          if (hadLocal || moved.length) { if (!cloud()) pipeline.syncMatches(storage, log).catch(error => log(`Job Matches not synced: ${error.message}`)); }
        }
      }
      return {...result, titles, kept, startedOnNotion, stayedOnMac: !!result.ok && storage.settings().store === 'sqlite'};
    } catch (error) {
      return {ok: false, error: error.status === 401 ? 'Notion rejected this token. Copy the API token of your Jobadabra connection again (Developer tools → Connections).' : error.message};
    }
  }
  if (!DEMO) settleStore(storage, {log: appLog});   // a new install's data on this Mac, a connected Notion stays Notion (D7)
  registerStoreHandlers({ipcMain, storage, DEMO, log: appLog, toWindow});   // lib/store-handlers.js: Settings → Your data
  registerContactHandlers({ipcMain, storage, DEMO, connected: () => notionGate.tracking(storage), needsNotion, log: appLog,   // lib/contact-handlers.js
    contactSaved: saved => server.contactSaved(storage, saved)});
  registerSetupHandlers({DEMO, connectNotion, dialog, handleImportant, ipcMain, licenseState, needsNotion, shell, storage, syncCv, getTelemetry: () => telemetry, track, trackSetup, getWindow: () => window, keepLook, renderDocx, toWindow,
    setNotionFrom: value => { notionFrom = value; }});   // lib/setup-handlers.js
  registerStrategyDraftHandlers({DEMO, here, ipcMain, storage, syncCv, toWindow, trackSetup});   // lib/strategy-draft-handlers.js
  registerDraftEditHandlers({ipcMain});   // lib/draft-edit-handlers.js: the draft edited through the Strategy cards
  registerJobPageHandlers({ipcMain, storage, DEMO, here, dialog, log: appLog});   // lib/job-page-handlers.js: Jobs → a job's page
  registerTextHandlers({ipcMain, storage, DEMO, log: appLog});   // lib/text-handlers.js: Settings → Profile's texts
  registerReportsHandlers({ipcMain, storage, DEMO, here, log: appLog});   // lib/reports-handlers.js: Reports → insights
  registerEmployersHandlers({ipcMain, storage, DEMO, here, log: appLog, scoutFromPage: file => pipeline.scout(storage, log, 'you', null, {paste: file})});   // lib/employers-handlers.js: the Employers page
  registerSearchesHandlers({ipcMain, storage, DEMO, here, log: appLog});   // lib/searches-handlers.js: Reports → Searches
  registerFormFillsHandlers({ipcMain, storage, DEMO, here, log: appLog});   // lib/form-fills-handlers.js: Reports → Form fills
  registerJobsExportHandlers({DEMO, app, dialog, getWindow: () => window, ipcMain, licenseState, storage});   // lib/jobs-export-handlers.js
  registerJobsHandlers({DEMO, JOBS_PAGE, activity, aiGate, allowanceBlock: allowanceGate, app, cloud, dispatchCloud, here, ipcMain, log, needsNotion, shell, storage, toWindow, track});   // lib/jobs-handlers.js
  registerCloudHandlers({DEMO, cloud, dialog, handleImportant, ipcMain, needsNotion, restartTelegram, shell, storage, toWindow, getWindow: () => window});   // lib/cloud-handlers.js
  registerJobActionsHandlers({DEMO, allowanceBlock: allowanceGate, cloud, dispatchCloud, dispatchNote, intelLib, ipcMain, log, needsNotion, getRecipeReporter: () => recipeReporterRef, storage});   // lib/job-actions-handlers.js
  const settingsDeps = settingsDepsFor(toWindow);   // lib/settings-deps.js
  registerSearchTuningHandlers({DEMO, activity, here, ipcMain, needsNotion, getRecipeReporter: () => recipeReporterRef, storage, toWindow});   // lib/search-tuning-handlers.js
  registerInterviewHandlers({appLog, calltap, cloud, DEMO, dialog, dispatchCloud, handleImportant, here, interviews, ipcMain, needsNotion, notify, reminders,
    sharedRead, shell, storage, toWindow, viewCache, getWindow: () => window});   // the Interviews page (lib/interview-handlers.js)
  registerLeadsHandlers({DEMO, aiReady, app, clipboard, ipcMain, log, nativeImage, needsNotion, storage, toWindow});   // lib/leads-handlers.js
  registerSystemHandlers({DEMO, about, app, backupNow, dataJob, dialog, handleImportant, ipcMain, mediaAccess, getResetDone: () => resetDone, restartApp, shell, storage, getWindow: () => window});   // lib/system-handlers.js
  zoom.register(ipcMain); registerFocusHandlers({DEMO, aiReady, app, applyTheme, clearlyTechnical, here, ipcMain, log, needsNotion, settingsDeps, storage, toWindow, track});   // lib/focus-handlers.js
  const {prepareKitFor, tailorCv} = registerKitHandlers({DEMO, allowanceBlock: allowanceGate, app, cloud, dispatchCloud, ipcMain, keepLook, log, needsNotion, notify, openTailoredCv, pageImages, powerMonitor, printPdf, readCvPdf, renderDocx, shell, storage, track});   // lib/kit-handlers.js
  registerSessionHandlers({ipcMain, appLog, storage, getWindow: () => window, dialog, nativeImage, here,
    DEMO, extensionGate, apply, pipeline, review, server, notion, claudeConsent, getRecipeReporter: () => recipeReporterRef, version: app.getVersion()});
  registerAppMetaHandlers({DEMO, FROM_SOURCE, FROM_STORE, restartAfterQuitGuard: reason => restarter.restart(reason), app, betaOn, checkForUpdate, cloud, dialog, installUpdate, ipcMain, licenseState, log, storage, testerLogsOn, testerOn, track,
    getLicense: () => license, getPlan, aiCaps, shell, getTelemetry: () => telemetry, getUpdateOffer, setUpdateOffer,
    getUpdateCheckedAt, getWindow: () => window, channels});   // lib/app-meta-handlers.js
  const {showForm} = registerApplyHandlers({DEMO, extensionGate, allowanceBlock: allowanceGate, claudeConsent, cloud, here, ipcMain, log, nativeTheme, needsNotion, prepareKitFor, getRecipeReporter: () => recipeReporterRef, shell, startClaude, storage, toWindow, track});   // lib/apply-handlers.js
  registerCvAndLettersHandlers({BrowserWindow, DEMO, cvOf, handleImportant, ipcMain, keepLook, openTailoredCv, printPdf, shell, storage, tailorCv, tailoring, toWindow});   // lib/cv-handlers.js
  registerCvBuildHandlers({dialog, getWindow: () => window, ipcMain, printPdf, shell, storage, syncCv});   // lib/cv-build-handlers.js
  registerExperienceHandlers({DEMO, dialog, getWindow: () => window, ipcMain, shell, storage});   // lib/experience-handlers.js
  registerVisitsHandlers({DEMO, allowanceBlock, here, ipcMain, log, readSites, shell, storage});   // lib/visits-handlers.js
  registerBrowserHandlers({app, clipboard, ipcMain, openNotion, shell, showForm, storage});   // lib/browser-handlers.js
}

// Started from a terminal that's since closed, writing a log line fails (EIO/EPIPE); that must never crash the app.
for (const stream of [process.stdout, process.stderr]) stream?.on?.('error', () => {});

// A separate data folder for tests and demos (JOB_PILOTTO_USER_DATA), so they never touch the real one (nor move it: lib/app-identity.js moves a pre-rename folder).
keepLegacyIdentity({app, safeStorage, userDataOverride: DEMO_FOLDER || process.env.JOB_PILOTTO_USER_DATA || '', log: text => console.log(`[data folder] ${text}`)});   // the Keychain item keeps the old name
if (DEMO_FOLDER) app.setPath('userData', DEMO_FOLDER);
else if (process.env.JOB_PILOTTO_USER_DATA) app.setPath('userData', process.env.JOB_PILOTTO_USER_DATA);
// A live-test twin (lib/twin.js) on the real folder, or without the mirror's Notion token, stops here, before anything opens it.
if (twinRefusal()) { console.error(`Jobadabra twin refused: ${twinRefusal()}`); app.exit(3); }
// A reset asked for in Settings → Danger zone: the data folder is moved aside (or deleted) now, before anything
// opens it; the app then starts like the first time (the setup wizard).
let resetDone = null;
// What the form's panel shows about a job's CV: tailored already, or being tailored now (jobs whose Tailor CV was asked from the panel).
const tailoring = new Set();
const cvOf = url => ({tailored: !!cvlib.forUrl(storage, url), working: tailoring.has(server.pageKey(url)), status: tailorStatus.statusOf(url)});
const syncCv = createCvSync({DEMO, getStorage: () => storage});   // lib/cv-sync.js
const {dataJob, backupNow} = createDataJob({toWindow, backupWith: options => backup.run(storage, {version: about?.label || '', ...options}), appLog});   // one export, import or backup at a time, its progress for the window (lib/data-job.js)
try { resetDone = reset.applyPending(app.getPath('userData')); } catch (error) { console.error('Reset failed:', error.message); resetDone = {failed: error.message}; }

// An IPC handler whose work quitting must not cut off half-way (lib/critical.js): the quit check names it and offers to wait.
function handleImportant(channel, label, handler) {
  ipcMain.handle(channel, (...args) => critical.during(label, () => handler(...args)));
}
// Every restart says why: app.exit skips 'will-quit', so without this line a restart looks like a silent exit (a Windows e2e relaunch, 6 Oct 2026).
const restarter = createRestarter({app, log: message => appLog('window', message), beforeExit: () => { pipeline.stopRunning(); return dataJob.stop(); }});
function restartApp(reason, options) { restarter.restart(reason, options, {how: 'exit'}); }
// How the app ended, in logs/app.log: a Windows e2e relaunch closed with no line at all (6 Oct 2026). No line after "start" now means the
// process was killed from outside (nothing in the app can log that).
app.on('will-quit', () => appLog('window', 'quitting'));
process.on('exit', code => appLog('window', `process exit ${code}`));
// One copy per data folder: lifecycle callbacks are tested without launching Electron.
const firstCopy = claimInstance({app, getWindow: () => window, createWindow,
  showDuplicate: () => appLog('window', 'another copy holds this data folder: this one quits') || dialog.showMessageBoxSync({type: 'info', message: 'Jobadabra is already running',
    detail: `Quit the other copy first (${process.platform === 'darwin' ? '⌘Q' : 'close its window'}), then open this one again.`}),
});

// Apply with Claude sessions run without asking before each action (--permission-mode bypassPermissions), so the
// user agrees once, knowing what that means; the answer is kept in settings.
// Apply with Claude for one job: the job row's button, the page's "Take over" and an account page the extension reached.
const startClaude = async (url, details = null) => !claudeFamily(storage) ? {ok: false, error: `Apply with Claude needs a Claude engine; your AI is ${aiNameOf(storage)} (Settings → Connections → AI).`}
  : !SHOW_RESUME_CLAUDE ? {ok: false, error: 'Applying by session is not available in this version. Use Fill in Chrome.'}   // the one flag (renderer/claude-help.js): no button, IPC or take-over starts it while off
  : allowanceBlock() || (await claudeConsent())
  ? apply.claudeOne(storage, url, undefined, undefined, undefined, details).then(result => {
    if (result?.ok) { track('apply_started', {how: 'claude'}); handOverForms(url); } else terminals.dropForm(String(url).split('#')[0]);
    return result;
  })
  : {ok: false, error: 'Apply with Claude is off. Use Fill in Chrome, or allow it next time.'};
// The Applying flows' decisions (stuck → hand-over, the stage from each report, the hand-over's tab): lib/session-flow.js, unit-tested.
let sessionFlow = null;
const flow = () => (sessionFlow ||= createSessionFlow({terminals, review, apply, appLog, toWindow, startClaude,
  claudeAllowed: () => takeoverOffered(storage),
  offerNotice: ({id, company}) => notify(`Stuck${company ? ` · ${company}` : ''}`, 'The extension cannot finish this page. Claude can: open the session to choose.', {view: 'sessions', session: id}, 'warn'), closeTab: session => closeSessionTab({review, closeTab: closeFormTab}, session)}));
const handOverForms = url => flow().handOver(url);
async function claudeConsent() {
  if (!claudeFamily(storage)) return false;   // an OpenAI engine: no Claude feature, and no question about one
  if (storage.settings().claudeConsent) return true;
  const {response} = await dialog.showMessageBox(window, {type: 'warning', buttons: ['Allow', 'Cancel'], defaultId: 1, cancelId: 1,
    message: 'Let Claude work without asking before each step?',
    detail: 'Apply with Claude opens a Claude Code window per job that browses, signs up on the employer\'s site and fills the form ' +
      'without asking you to approve each action, so it can work on its own. It never clicks Submit: you review and submit yourself. ' +
      'Any other command it decides to run also runs without asking, so watch its window while it works.\n\n' +
      'It uses your own Claude account and plan. You can turn this off in Settings.'});
  if (response !== 0) return false;
  storage.saveSettings({claudeConsent: new Date().toISOString()});
  return true;
}

// Screen capture needs a permission only on the Mac; Windows lets any app capture the screen and its audio; Linux has no getMediaAccessStatus: nothing is denied.
function mediaAccess(type) {
  return typeof systemPreferences.getMediaAccessStatus !== 'function' || (process.platform !== 'darwin' && type === 'screen') ? 'granted' : systemPreferences.getMediaAccessStatus(type);
}

// The interview recorder asks for the screen's audio (the call). Chromium captures system audio on macOS 13+
// through ScreenCaptureKit behind these switches; without them (or without Screen Recording permission)
// the recorder falls back to the microphone alone.
app.commandLine.appendSwitch('enable-features', 'MacLoopbackAudioForScreenShare,MacSckSystemAudioLoopbackOverride');
installCrashMonitors({getTelemetry: () => telemetry});   // lib/crash-monitors.js

startWhenReady({app, firstCopy, getWindows: () => BrowserWindow.getAllWindows(), createWindow, start: () => {
  if (offerMove({app, dialog})) return false;  // moving to Applications: Electron quits and opens the moved copy
  buildMenu();
  app.setAboutPanelOptions({applicationName: 'Jobadabra', applicationVersion: app.getVersion(),
    version: buildInfo ? `build ${buildInfo.build} · ${buildInfo.commit}` : 'development', copyright: '© 2026 Jobadabra'});
  if (!app.isPackaged) { app.dock?.setIcon(path.join(here, 'assets', 'icon.png')); app.dock?.setBadge(devMarker.mark()); }  // from source: never mistaken for the installed app
  logTo(path.join(app.getPath('userData'), 'logs'), electronLog); appLog('app', 'start', {version: app.getVersion(), os: `${process.platform} ${process.arch} ${os.release()}`, packaged: app.isPackaged});
  if (resetDone) appLog('data', resetDone.failed ? `reset or import not applied: ${resetDone.failed}` : `applied at start: ${resetDone.imported ? 'import' : resetDone.deleted ? 'reset (deleted)' : 'reset'}`, {backup: resetDone.backup || '', waitedMs: resetDone.waited || 0});   // waitedMs: Windows still held the folder after the old app quit
  requestLog.setFile(path.join(app.getPath('userData'), 'logs', 'notion-requests.log'));  // every Notion request, one line
  engineLog.setFile(path.join(app.getPath('userData'), 'logs', 'engine.log'));  // everything a run printed, in full
  // E2E on a Linux CI runner only (no keyring there): Electron's safeStorage refuses the basic store unless told to. A user's app never takes this path.
  if (process.platform === 'linux' && process.env.JOB_PILOTTO_E2E && process.env.CI) safeStorage.setUsePlainTextEncryption?.(true);
  storage = createStorage(app.getPath('userData'), DEMO ? {encrypt: value => value, decrypt: value => value} : safeStorageCrypto(safeStorage));
  buildMenu();   // again, now the saved update channel can be read (Update Channel's radio)
  // An import on the Mac that made it: its sealed keys open here; an older export without them takes them from the same Profile's backup (lib/reset.js adoptBackupKeys).
  if (resetDone?.imported) {
    const kept = reset.adoptBackupKeys(storage);
    if (kept) appLog('data', 'import: keys taken from this computer\'s backup of the same Profile', {from: path.basename(kept.from), names: kept.names});
    if (storage.secret('NOTION_TOKEN')) resetDone.notionElsewhere = false;
  }
  if (resetDone?.notionElsewhere) appLog('data', 'import: Profile and tracking are in the backup\'s Notion workspace, no key came with it', {decidedBy: 'reset.notionLeftBehind'});
  // An import whose Profile is in a Notion workspace it brought no key for (lib/reset.js notionLeftBehind): the Notion dialog says to pick that one, until connected.
  if (resetDone?.notionElsewhere) storage.saveSettings({importedNotion: {page: storage.settings().notionIds?.NOTION_PROFILE_PAGE_ID || '', at: new Date().toISOString()}});
  { const lost = (storage.secretsPresent(), storage.unreadableSecrets()); if (lost.length) appLog('secrets', 'unreadable on this computer: asked again', {names: lost}); }
  const firstStart = DEMO ? null : versionLine(storage, app.getVersion(), buildInfo ? `build ${buildInfo.build} · ${buildInfo.commit}` : '');
  if (firstStart) appLog('update', firstStart);
  aiFree.apply(storage.settings()); watchAiCaps(); if (!DEMO) aiFree.migrate(storage).then(() => aiFree.ensureTrialKey(storage)).then(() => trialServer.keepFresh(storage, license)).catch(() => {});  // Free AI, if on: the Anthropic SDK goes to our website; the old $1 credit moves over
  // Technical reports (lib/telemetry.js): on by default, off in Settings → Advanced; never in demo mode, and never
  // from a source checkout (npm start): its crashes are work in progress, not users' problems, and would open triage issues.
  license = licenseLib.create(storage, {appliedNow: () => viewCache.recall(storage, 'focus')?.result?.focus?.funnel?.steps
    ?.find(step => step.step.includes('Applied'))?.reached ?? 0});
  // A founder key left by the one-command install (lib/pending-license.js): unlock, before setup.
  if (!DEMO) {
    const taken = pendingLicense.consume(app.getPath('userData'), {license});
    if (taken) console.log(`Founder key from the installer: ${taken.ok ? `accepted` : taken.error}`);
  }
  // The channel the install came from (the install link's ?src=): kept once, reported with the app's anonymous id.
  if (!DEMO) { const channel = installSource.consume(app.getPath('userData'), storage); if (channel) appLog('install', 'channel taken from the installer', {channel}); }
  // CI smoke runs (windows-smoke.mjs) launch the packaged app with a fresh profile each time: they (any launch with CI/GITHUB_ACTIONS set) must not count as installs.
  registerTelemetryHandlers({DEMO, app, crashReporter, healthOnce, storage, testerLogsOn, testerOn, track, trackSetup,   // lib/telemetry-handlers.js
    setTelemetry: value => { telemetry = value; }, setTrail: value => { trail = value; }, setAnalytics: value => { analytics = value; }});
  applyTheme(process.env.JOB_PILOTTO_THEME || storage.settings().theme);
  reset.adoptKeys(storage);  // keys that came with an import: stored encrypted, plain file deleted
  for (const file of pipeline.ensureConfig(storage)) appLog('config', 'removed the example notes from a settings file', {file});   // a copy made before 11 Oct 2026 kept them (lib/config-text.js)
  handlers();
  // Without Screen Recording permission there's no source (desktopCapturer rejects "Failed to get sources",
  // logged by Electron as an unhandled rejection), and Electron throws when a video request is answered
  // without video. So: when macOS says denied, refuse without asking for sources (not-determined still asks,
  // so macOS shows its prompt once); catch the rest. The recorder then shows the permission panel.
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    const answer = streams => { try { callback(streams); } catch {} };
    if (['denied', 'restricted'].includes(mediaAccess('screen'))) { answer({}); return; }
    desktopCapturer.getSources({types: ['screen']})
      .then(sources => answer(sources[0] ? {video: sources[0], audio: 'loopback'} : {}))
      .catch(() => answer({}));
  });
  if (!DEMO) {
    server.setNotifier(notify);
    server.setWindowSignal(toWindow);
  // The engine's pages that need their scripts run, in this app's own Chromium (lib/page-render.js): the address reaches engine runs (lib/pipeline.js).
  server.setRenderer((url, userAgent) => pageRender.renderPage(url, {BrowserWindow, userAgent}));
  pageRender.setAddress(`http://127.0.0.1:${server.PORT}/engine/render`);
  server.start(storage, error => log(error.code === 'EADDRINUSE'
      ? `Chrome extension connection is off: port ${server.PORT} is used by another program.`
      : `Chrome extension connection failed: ${error.message}`));
  }
  terminals.hideAsks(!takeoverOn); if (!DEMO) { terminals.persist(path.join(storage.dir, 'sessions.json')); terminals.restore(); }  // sessions of the last run
  // Each form's last state (ready to submit?), so a restart shows it before Chrome's tabs report again.
  if (!DEMO) review.persist(path.join(storage.dir, 'review-states.json'), terminals.list().map(session => session.id));
  // A session's conversation (its Claude Code transcript) on its Agent Runs row, folded: the Mac's file doesn't last.
  // Into the store (lib/session-runs.js optionsFor): a Notion row, or the record on this Mac; none while trying.
  const saveConversation = session => {
    if (!session.runPage || !session.transcript) return;
    const talk = transcript.conversation(session.transcript);
    if (!talk?.length || talk.length === session.conversationSaved) return;
    sessionRuns.saveConversation(storage, session, talk)
      .then(count => { if (count == null) return; session.conversationSaved = count; terminals.saveNow(); }).catch(error => log(`conversation not saved: ${error.message}`));
  };
  // Each session's statistics on its Agent Runs row in Notion, a few seconds after each change (lib/session-runs.js).
  if (!DEMO) terminals.onStatus((view, session) => sessionRuns.schedule(session, () => sessionRuns.optionsFor(storage,
    {create: /^decided|^ended|^failed/.test(session.events?.at(-1)?.status || '')}), page => {
    session.runPage = page;
    terminals.saveNow();
    // Once it ended, its conversation goes on the row too (again if it was resumed and said more since).
    if (/^decided|^ended|^failed/.test(session.events?.at(-1)?.status || '')) saveConversation(session);
  }));
  // Sessions that ended before this was saved (or while Notion was busy): at start-up, none of them is running.
  if (!DEMO) for (const session of terminals.list()) { const record = terminals.record(session.id); if (record) saveConversation(record); }
  createWindow();
  terminals.onChange((event, payload) => toWindow('session', event, payload));
  registerExtServerHandlers({DEMO, app, createWindow, cvOf, flow, ipcMain, notify, readSites, scoreVisitJobs, sessionNeedsYou, storage, getTelemetry: () => telemetry, toWindow, getWindow: () => window,
    setRecipeReporter: value => { recipeReporterRef = value; }});   // lib/ext-server-handlers.js
  registerBackgroundHandlers({DEMO, announceRuns, app, backupNow, checkForUpdate, cloud, focusReminder, log, notify, powerMonitor, restartTelegram, resumeQueue, skipUntilNotion, storage, syncCv, toWindow});   // lib/background-handlers.js
}});

// Focus reminders at 11:00, 15:00 and 19:00 (this Mac's time), once per slot: a notification and a Telegram
// message when someone waits for an answer, an interview is close, or today's applications are behind the target.
const FOCUS_HOURS = [11, 15, 19];
// Notion later: loops that read Notion do nothing until it is connected, and say so once per start (they pick up by themselves after a connect).
const skippedLoops = new Set();
const {skipUntilNotion, focusReminder, resumeQueue, sessionNeedsYou} = createAppReminders({FOCUS_HOURS, Notification, dialog, log, notify, skippedLoops, getStorage: () => storage, targets, toWindow, getWindow: () => window});   // lib/app-reminders.js
// Quitting decisions read current services, so they remain testable without global mocks.
installQuitHandling({app, platform: process.platform,
  state: () => ({storage, window, telemetry, demo: DEMO, smoke: !!process.env.JOB_PILOTTO_SMOKE}),
  pipeline, terminals, critical, stopDataJob: () => dataJob.stop(), dataRunning: () => !!dataJob.running(), shouldAskOnQuit: setupFunnel.shouldAskOnQuit,
  askWhyLeaving: () => toWindow('askWhyLeaving'),
  showDialog: (parent, options) => dialog.showMessageBoxSync(parent, options),
  icon: () => nativeImage.createFromPath(path.join(here, 'assets', 'icon.png')),
  getWindows: () => BrowserWindow.getAllWindows(), toWindow, notify, log: appLog, onCancel: () => restarter.cancel(),
});
