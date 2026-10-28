/* global document, window */
// Everything a suite needs, built once: its own Notion test page (token per suite), the fixture feeds (a copy a step can change), the slow-AI proxy, and the
// launched app. A suite is a short file in suites/ that calls ctx.run(...) with its steps. See README.md.
// Job: run the backbone
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {startAiProxy} from './ai-proxy.mjs';
import {aiProvider} from './ai-provider.mjs';
import {answerViaBroker} from './broker-relay.mjs';
import {startNotionProxy} from './notion-proxy.mjs';
import {startTelegramFake} from './telegram-fake.mjs';
import {startGoogleFake} from './google-fake.mjs';
import {startReleasesFake} from './releases-fake.mjs';
import {buildStandIn, startNotionFake} from './notion-fake.mjs';
import {useNotionAt} from './notion.mjs';
import {appKey, appModelEnv, DUMMY_KEY, familySecret, isCi, pickEngine, pickFamily, testKey} from './engine.mjs';
import {checkRelay} from './free-ai-check.mjs';
import {copyExtension, freePort, makeOpenShim, opensIntoSpool} from './extension.mjs';
import {startForms} from './forms.mjs';
import {hiddenBrowserEnv} from './hidden-browser-env.mjs';
import {createVariation, placeOf} from './variation.mjs';
import {ARTIFACTS, E2E, launch, pickFile, step} from './app.mjs';
import {clearRoot, testRoot, workspaceReady} from './notion.mjs';
import {createRunner} from './runner.mjs';
import {notionFarSide, pickStore, runToken, storeSettings} from './store.mjs';
import {storeCall} from './store-call.mjs';
import {lockNeeded, takeNotionPage} from './notion-page-lock.mjs';
import {tally} from './faults.mjs';

// A suite is a file in suites/ (adding one needs no other list). It may export `minutes` (its time limit in CI, default 15).
import {readdirSync} from 'node:fs';
import {checkKeyAccepted, checkOtherKeys, keyFingerprint} from './key-check.mjs';
import {waitForFolderFree} from './folder-free.mjs';
export const SUITES = readdirSync(path.join(E2E, 'suites')).filter(file => file.endsWith('.mjs')).map(file => file.slice(0, -4)).sort();
const KEY = () => testKey();   // empty on a Mac, whatever the environment holds: the key is for CI (lib/engine.mjs)
// Each suite has its own Notion page and connection, so suites can run at the same time. E2E_NOTION_TOKEN is the wizard's; a suite without its own token falls
// back to it on a developer's Mac (one suite at a time), and is skipped in CI. own: the real workspace (notion-real) takes its own token or none, never the
// wizard's: with `fresh` it empties its page, and the fallback's page is another suite's.
export function notionToken(suite, {own: ownOnly = false, env = process.env} = {}) {
  const own = env[`E2E_NOTION_TOKEN_${suite.toUpperCase()}`] || '';
  if (ownOnly) return own;
  if (suite === 'wizard') return env.E2E_NOTION_TOKEN_WIZARD || env.E2E_NOTION_TOKEN || '';
  if (own) return own;
  return env.CI ? '' : env.E2E_NOTION_TOKEN || '';
}

// browser: the suite drives a real Chromium with the extension (lib/extension.mjs): the fixture forms are served, and the app's `open` reaches that browser.
// engine: a suite whose steps the AI proxy answers pins 'api' (a placeholder key on a Mac); otherwise a Mac uses Claude Code, CI the API key (lib/engine.mjs).
export async function openContext(suite, {fresh = false, env: suiteEnv = {}, browser = false, light = false, notionProxy = false, telegram = false, google = false, releases = false, notion: usesNotion = true, notionStandIn = false, store: suiteStore = '', newInstall = false, notionTokenOf = '', notionPage = '', keepGoing = false, variesPlace = false, engine: suiteEngine = '', budgetMinutes = 0, stepNeeds = null, report = null} = {}) {
  // Where the app keeps the person's data (lib/store.mjs): this Mac (sqlite, no Notion at all), the in-memory Notion (fresh and private for this run, no
  // token, no shared page: lib/notion-fake.mjs), or the real test workspace for a suite that pins it. A suite with no Notion part keeps its own setup.
  const store = light || !usesNotion ? '' : pickStore({suiteStore: suiteStore || (notionStandIn ? 'standin' : '')});
  if (store) console.log(`  store under test: ${store}${isCi() && !suiteStore && !notionStandIn ? ` (CI run ${process.env.GITHUB_RUN_NUMBER || '?'}: runs 0,1 sqlite, 2,3 stand-in, by 4)` : ''}`);
  if (store) process.env.E2E_STORE_UNDER_TEST = store;   // the coverage file names it (lib/coverage.mjs): a PR runs its picked steps on the store they were recorded on
  const onNotion = usesNotion && store !== 'sqlite';
  // A suite on this Mac's store that also opts into the stand-in (`store = 'sqlite'` + `notionStandIn = true`: "Move my data to Notion") gets an empty one to move into.
  const standIn = store === 'standin' || (store === 'sqlite' && notionStandIn) ? await startNotionFake() : null;
  // Off the real workspace nothing reaches Notion: the harness's own Notion calls go to the stand-in, or on this Mac's store to a dead local port (lib/store.mjs).
  if (store && store !== 'notion') useNotionAt(notionFarSide({store, standIn: standIn?.url}));
  const family = pickFamily(), engine = pickEngine({suiteEngine, family});   // family: claude | openai | free (CI on Free AI: lib/engine.mjs freeAi)
  // The app's key follows its engine's family (E2E_OPENAI_KEY for OpenAI); a light suite is the judges' own calls: Claude's key.
  const key = light ? KEY() : testKey(process.env, engine, family), token = runToken({store, standIn, light, fromEnv: () => notionToken(notionTokenOf || suite, {own: store === 'notion'})});
  if (!light) console.log(`  AI family under test: ${{openai: 'OpenAI', free: 'Free AI (Workers AI, the relay on this runner)'}[family] || 'Claude'} (engine ${engine}${isCi() && family !== 'free' ? `, CI run ${process.env.GITHUB_RUN_NUMBER || '?'}: odd runs OpenAI, even runs Claude` : ''})`);
  if (!light && isCi()) {
    if (family === 'free') await checkRelay({url: process.env.E2E_FREE_AI_URL, key}); else await checkKeyAccepted({engine, key});
    await checkOtherKeys({engine: family === 'free' ? 'free' : engine}); console.log(`  preflight: the ${familySecret(family, engine)} key fingerprint ${keyFingerprint(key)}`);
  }   // a refused key stops the suite here, named, not as a puzzling AI step later
  let session = null, fakes = [];   // the fake services of this suite, once started: the runner checks that a step's fault fired (lib/faults.mjs)
  const runner = createRunner(() => session, {keepGoing, stepNeeds, report, faultTally: () => tally(fakes), ...(budgetMinutes ? {budgetMs: budgetMinutes * 60000} : {})});
  // A light suite needs only the AI key: no Notion page, no app, no browser (a model-only eval).
  // The test's own judges and evals (lib/judge.mjs, fit.mjs, model.mjs, the explore agent) are Claude whatever the app runs on, so both families are judged
  // by one model: always the Anthropic test key, never the app's (9 Oct 2026: the first OpenAI run sent the OpenAI key to Anthropic, 401).
  const judgeKey = KEY();
  if (light) return {suite, key, judgeKey, engine, runner, run: runner.run, ARTIFACTS, E2E, needs: isCi() ? [{name: 'E2E_ANTHROPIC_KEY', value: key}] : [], skipAll: isCi() && !key, close: async () => {}};
  const ctx = {suite, key, judgeKey, token, runner, standIn, store, run: runner.run, ARTIFACTS, E2E, cv: process.env.E2E_CV || path.join(E2E, 'fixtures', 'cv.pdf'),
    engine, family, appKey: appKey(key), needsKey: isCi() ? [{name: familySecret(family, engine), value: key}] : [],   // CI only: on a Mac nothing needs a key
    needs: [...(['api', 'openai'].includes(engine) && isCi() ? [{name: familySecret(family, engine), value: key}] : []),
      // A suite with no Notion part (`export const notion = false`, the update flow) needs no Notion token and gets no page.
      ...(onNotion ? [{name: `a Notion token for the ${suite} suite (E2E_NOTION_TOKEN${suite === 'wizard' ? '' : `_${(notionTokenOf || suite).toUpperCase()}`})`, value: token}] : [])]};
  if (ctx.needs.some(item => !item.value)) { ctx.skipAll = true; return ctx; }
  if (engine === 'cli') console.log('  AI engine: the Claude Code on this Mac (your plan): no Anthropic key is read or used on a Mac.');
  // The real test page is one page for the whole Mac: a run on it waits for the run that holds it (lib/notion-page-lock.mjs). SQLite and stand-in runs never take it.
  if (lockNeeded({store})) ctx.pageLock = await takeNotionPage({what: suite}); else if (store === 'notion' && process.env.JOB_PILOTTO_NOTION_LOCK === '0') console.log('  Notion page lock: off (JOB_PILOTTO_NOTION_LOCK=0)');
  if (onNotion) ctx.root = await testRoot(token);   // refuses any workspace but the test one, and any token that sees more than one page
  // The real workspace names the page it may empty (`notionPage`): a token that sees another page fails here, before `fresh` trashes anything.
  if (store === 'notion' && (!notionPage || ctx.root.title !== notionPage)) throw new Error(`refusing the Notion page "${ctx.root.title}": the ${suite} suite may only use "${notionPage || '(its notionPage export is missing)'}"`);
  if (fresh && ctx.root) console.log(`Notion test page "${ctx.root.title}": ${await clearRoot(token, ctx.root.id)} item(s) moved to the trash`);
  // The stand-in starts empty: built once here unless the suite tests a fresh setup (the wizard), like the real test page that is built already.
  if (store === 'standin' && !fresh) await buildStandIn(standIn);
  ctx.built = onNotion && !fresh && await workspaceReady(token);
  ctx.feeds = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-e2e-feeds-'));
  fs.cpSync(path.join(E2E, 'fixtures', 'feeds'), ctx.feeds, {recursive: true});
  ctx.proxy = await startAiProxy({delayMs: 0, ...(aiProvider(process.env, 'app').provider === 'codex' && isCi() ? {kind: 'app-codex', relay: answerViaBroker} : family === 'free' ? {target: process.env.E2E_FREE_AI_URL, kind: 'app-free'} : {})});   // CI on Free AI: the app's calls go on to the relay
  // The OpenAI engine's calls (the app's and the engine's SDK follow OPENAI_BASE_URL in a test run): metered as app-openai, replayed like Claude's, and they obey
  // ctx.proxy's controls: a suite's stand-ins (setCanned), faults (setMode) and delay apply on an OpenAI turn too, in OpenAI's own shapes (lib/ai-proxy.mjs).
  ctx.openaiProxy = ctx.family === 'openai' ? await startAiProxy({target: 'https://api.openai.com', kind: 'app-openai', metered: /\/responses(\?|$)/, shape: 'openai', follow: ctx.proxy}) : null;
  // A suite that breaks Notion on purpose (`export const notionProxy = true`) gets the Notion stand-in between the app and Notion (lib/notion-proxy.mjs).
  // Its far side is the stand-in, never real Notion, unless the suite pins the real workspace; on this Mac's store a dead port (the app has no business with Notion there).
  if (notionProxy) ctx.notion = await startNotionProxy({target: notionFarSide({store, standIn: standIn?.url})});
  // A suite that reads what Telegram would receive (`export const telegram = true`) gets the fake Bot API (lib/telegram-fake.mjs); nothing reaches Telegram.
  if (telegram) ctx.telegram = await startTelegramFake();
  // A suite that runs the Gmail check (`export const google = true`) gets a fake Google with three of the mailreading eval's invented emails and a fake sign-in (lib/google-fake.mjs).
  // The update flow (`export const releases = true`): a fake GitHub release list the app's updater reads instead of GitHub (lib/releases-fake.mjs).
  if (releases) ctx.releases = await startReleasesFake();
  if (google) {
    const cases = JSON.parse(fs.readFileSync(path.join(E2E, '..', '..', 'tests', 'fixtures', 'mail_eval.json'), 'utf8')).cases;
    ctx.google = await startGoogleFake({emails: ['ats_thanks', 'interview_invite', 'security_code'].map(id => cases.find(item => item.id === id)?.email).filter(Boolean)});
  }
  fakes = [ctx.proxy, ctx.notion, ctx.telegram, ctx.google];
  ctx.vary = createVariation();   // no E2E_SEED = the fixed path (the release gate); a seed = this run's varied data and timing (every suite: lib/feeds.mjs, lib/forms.mjs)
  // The browsers' user data the app may read (Chrome's profiles, the extension's install): this run's own empty folder, never the owner's
  // (lib/browser-profile.js browserData; 16 Oct 2026: a local run read the owner's Chrome Local State). Every suite, with or without a browser.
  // The automatic backup's folder likewise: the app backs up at its start once set up, and must never write to the owner's iCloud Drive or Documents (lib/backup.js folder).
  ctx.backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-e2e-backups-'));
  const browserEnv = {JOB_PILOTTO_BROWSER_DATA: fs.mkdtempSync(path.join(os.tmpdir(), 'jp-e2e-browser-data-')), JOB_PILOTTO_BACKUP_DIR: ctx.backupDir};
  // Every suite, with or without a browser: a page the app opens lands in the stand-in's spool, never in the owner's Chrome. Why (#2350, 28 Oct 2026): the shim was
  // put only on browser suites, so the interactions probe's press on Focus's "Read Indeed" ran the real `open` and put ch.indeed.com in the owner's Chrome.
  ctx.shim = makeOpenShim();
  Object.assign(browserEnv, {PATH: `${ctx.shim.bin}${path.delimiter}${process.env.PATH}`, JOB_PILOTTO_E2E_OPEN_DIR: ctx.shim.spool});
  if (process.platform === 'win32') browserEnv.JOB_PILOTTO_E2E_OPENER = ctx.shim.script;   // no `open` on Windows (lib/apply.js chromeCommand)
  if (browser) {
    // The app and the extension copy share a free port, so the test never meets the user's own app on 47111.
    ctx.appPort = await freePort();
    ctx.extensionDir = copyExtension(ctx.appPort);
    ctx.forms = await startForms({vary: ctx.vary});
    browserEnv.JOB_PILOTTO_PORT = String(ctx.appPort);
    Object.assign(browserEnv, hiddenBrowserEnv(ctx.forms.port));   // the app's hidden browser reaches the fixture sites only (lib/background-proof.mjs)
  }
  const env = {...appModelEnv(), JOB_PILOTTO_FIXTURE_DIR: ctx.feeds, JOB_PILOTTO_E2E_AI_BASE_URL: ctx.proxy.url, ...(family === 'free' ? {JOB_PILOTTO_E2E_FREE_AI_KEY: key} : {}), ...(ctx.openaiProxy ? {JOB_PILOTTO_E2E_OPENAI_BASE_URL: `${ctx.openaiProxy.url}/v1`} : {}), ...(ctx.notion ? {JOB_PILOTTO_E2E_NOTION_BASE_URL: ctx.notion.url} : ctx.standIn ? {JOB_PILOTTO_E2E_NOTION_BASE_URL: ctx.standIn.url} : store && store !== 'notion' ? {JOB_PILOTTO_E2E_NOTION_BASE_URL: notionFarSide({store})} : {}), ...(ctx.telegram ? {JOB_PILOTTO_E2E_TELEGRAM_BASE_URL: ctx.telegram.url} : {}),
    ...(ctx.releases ? {JOB_PILOTTO_E2E_UPDATES_URL: ctx.releases.url} : {}), ...(ctx.google ? {JOB_PILOTTO_E2E_GOOGLE_BASE_URL: ctx.google.url, GOOGLE_CLIENT_ID: 'e2e-client', GOOGLE_CLIENT_SECRET: 'e2e-secret', GOOGLE_REFRESH_TOKEN: 'e2e-refresh'} : {}), ...browserEnv, ...suiteEnv};
  // The owner's browser data is never read by a test run: the app's browser-data root is this run's own folder (lib/browser-profile.js browserData).
  if (!env.JOB_PILOTTO_BROWSER_DATA || path.resolve(env.JOB_PILOTTO_BROWSER_DATA).startsWith(path.join(os.homedir(), 'Library')) || path.resolve(env.JOB_PILOTTO_BROWSER_DATA).startsWith(path.join(os.homedir(), 'AppData'))) {
    throw new Error(`a test run must not read the owner's browser profiles (JOB_PILOTTO_BROWSER_DATA is ${env.JOB_PILOTTO_BROWSER_DATA || 'unset'})`);
  }
  // A page the app opens goes to this run's spool, never to the owner's browser (lib/browser-launch.js runs `open`, found first on PATH, or the Windows opener).
  if (!opensIntoSpool(env)) throw new Error(`a test run must not open pages in the owner's browser (PATH starts ${String(env.PATH).split(path.delimiter)[0]})`);
  // P7: off the real workspace a run holds no token but the stand-in's own (lib/store.mjs runToken); the run fails here, before the app starts, if it ever does.
  if (store && store !== 'notion' && token && token !== standIn?.token) throw new Error(`the ${store} store must not hold a Notion token from the environment`);
  // P7: a run off the real workspace reaches no Notion but a local one (the stand-in, or the fault proxy in front of it). Fails the run before the app starts.
  if (store && store !== 'notion' && !/^http:\/\/127\.0\.0\.1[:/]/.test(env.JOB_PILOTTO_E2E_NOTION_BASE_URL || '')) throw new Error(`the ${store} store must not reach real Notion, and the app was given ${env.JOB_PILOTTO_E2E_NOTION_BASE_URL || 'no Notion URL (the real one)'}`);
  // The environment the app was started with: a second app a step opens (another time zone, a fresh install) starts from it, so it talks to the same Notion
  // (real or the stand-in), AI proxy and fixtures (6 Oct 2026: calendar's second app had its own list and reached real Notion with the stand-in's token).
  ctx.appEnv = env;
  ctx.newInstall = newInstall;   // the wizard suite: started with no store, as a new install (lib/wizard.mjs)
  const adopt = started => { session = started; ctx.session = session; ctx.page = session.page; ctx.app = session.app; ctx.profile = session.profile; };
  // A seeded run of a suite that opts in lives somewhere else: another time zone (window and engine) and language (lib/variation.mjs placeOf).
  ctx.place = variesPlace ? placeOf() : null;
  if (ctx.place) { Object.assign(env, {TZ: ctx.place.zone, JOB_PILOTTO_TZ: ctx.place.zone, LANG: `${ctx.place.locale.replace('-', '_')}.UTF-8`}); console.log(`  place: ${ctx.place.zone}, ${ctx.place.locale}`); }
  // newInstall: no store written, as a new install starts (the app gives it this Mac at first start, lib/store-handlers.js settleStore).
  adopt(await launch({env, lang: ctx.place?.locale || '', settings: newInstall ? {} : storeSettings(store)}));
  // The app's trace is kept when the suite failed so far: a failed step, or an error outside the steps (lib/suite-main.mjs sets ctx.stopped first).
  const failed = () => !!ctx.stopped || runner.results.some(result => result.status === 'failed');
  ctx.close = async () => { try { await session?.shot('last'); await ctx.browser?.close(); await session?.close({keepTrace: failed()}); await ctx.proxy?.close(); await ctx.openaiProxy?.close(); await ctx.notion?.close(); await ctx.telegram?.close(); await ctx.google?.close(); await ctx.releases?.close(); if (ctx.standIn) { try { fs.writeFileSync(path.join(ARTIFACTS, 'notion-standin.json'), JSON.stringify(ctx.standIn.dump(), null, 1)); } catch {} await ctx.standIn.close(); } await ctx.forms?.close(); } finally { ctx.pageLock?.release(); } };
  // Quit the app the hard way (as a crash or a power cut would: nothing gets to tidy up) and start it again on the same profile. `extra` adds to the environment; `between(profile)` runs while the app is down.
  ctx.relaunch = async (extra = {}, between) => { const profile = session.profile; await session.close({keepTrace: failed()}); await between?.(profile); adopt(await launch({env: {...env, ...extra}, profile, lang: ctx.place?.locale || ''})); };
  // Some actions end with the app's OWN exit (a reset, an import): it finishes its work first (a reset disconnects the Gmail sign-in through a Python call since 645cef9), so a
  // relaunch straight after the click closes the app half way and nothing was reset (10 Oct 2026, settings suite on Mac and Windows). Wait for that exit, then relaunch.
  ctx.waitForExit = (timeout = 60000) => { const mainPid = ctx.app.process().pid; return new Promise((resolve, reject) => {
    const child = ctx.app.process();
    if (child.exitCode !== null || child.signalCode) return resolve();
    const timer = setTimeout(() => reject(new Error(`the app did not exit by itself within ${timeout / 1000} s`)), timeout);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
  }).then(() => process.platform === 'win32' && session?.profile ? waitForFolderFree(session.profile, {mainPid}) : null); };   // Windows: the app's own children may still hold the folder; its main pid names their tree
  ctx.expectStep = async (name, timeout = 20000) => {
    await ctx.page.waitForFunction(wanted => [...document.querySelectorAll('.step')].find(el => !el.hidden && el.offsetParent !== null)?.dataset.step === wanted, name, {timeout})
      .catch(async () => { throw new Error(`expected the "${name}" step, the app shows "${await step(ctx.page)}"`); });
  };
  ctx.pickCv = () => pickFile(ctx.app, ctx.cv);
  // The person's data on whichever store the app uses, through the engine's own store command (lib/store-call.mjs): how a suite seeds and reads its data.
  ctx.data = (entity, method, kwargs = {}, options = {}) => storeCall(ctx, entity, method, kwargs, options);
  // Run `fn` with the app on the API engine and the AI proxy in front of it, then put the engine back. With a dummy key (the default) nothing reaches Anthropic that the
  // proxy does not answer itself (429, 500, a delay then a refusal, a canned answer), so it costs nothing. There is no way to use the real key from here.
  ctx.withApi = async fn => {
    if (ctx.engine === 'api') return fn();
    const set = (mode, secret) => ctx.page.evaluate(async ({mode, secret}) => { if (secret) await window.pilot.saveSecret('ANTHROPIC_API_KEY', secret); await window.pilot.setAiEngine(mode); }, {mode, secret});
    await set('api', DUMMY_KEY);
    try { return await fn(); } finally { await set(ctx.engine, DUMMY_KEY); }   // back to the engine under test (Claude Code, Codex or the OpenAI key)
  };
  return ctx;
}
