// The engine-backed kit of layer 3 (Node, no window): the app's own task code (lib/pipeline-tasks.js → lib/pipeline-run.js) runs the REAL Python engine on a temp install, with the
// e2e stand-ins in front of everything outside: the AI (lib/ai-proxy.mjs, can answer 429/500/401/no credit or never answer), Notion (notion-fake + notion-proxy: busy, an HTML error
// page, gone), Telegram (telegram-fake: a digest read, or refused) and Google (google-fake: a few emails, or a revoked sign-in). Created for the e2e suites activity, activityfailures,
// failuresnotion and the deleted failureschannels (R2, 1 Nov 2026), whose "a run ends in words, nothing left Running" checks have nothing to do with a window.
// Job: serve stored answers
//
// What one kit instance is: a temp install (settings, config, data, secrets), one free loopback port per stand-in (never 47111 or any port the owner's app may hold: asserted), the e2e
// fixture feeds copied into the install, and the app's own `pipelineEnv` pointed at the stand-ins by the e2e variables (it passes them only when JOB_PILOTTO_E2E is set).
// What it never does: reach the owner's folders (the engine would refuse them without JOB_PILOTTO_DATA_DIR and CONFIG_DIR: `refusesRealFolder`), a real network, a real AI (the proxy refuses
// every call no test answered, and its upstream is an address nothing listens on), or a model: the key is a dummy.
// Data comes from the engine's own commands: the applicant's strategy is saved by the app's own writer (lib/strategy-settings.js keepLocally), rows are read with `storeCall`.
//
// One instance per test FILE (node --test runs each file in its own process): it sets process.env, which the app's modules read at import and at every spawn.
//
// HOW TO EXTEND (R2 extension: a fake extension on the app's port for the apply rows): add an option here that starts the fake on `freePort()` (loopback, asserted), put its address in
// `env` under the e2e variable the app reads (lib/pipeline-env.js lists what a test run may pass on), keep its `close` in `closers`, and return it on the kit. Never a fixed port.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import {applicantDraft} from '../../e2e/lib/applicant-seed.mjs';
import {setFeed} from '../../e2e/lib/activity-steps.mjs';
import {startAiProxy} from '../../e2e/lib/ai-proxy.mjs';
import {startGoogleFake} from '../../e2e/lib/google-fake.mjs';
import {buildStandIn, startNotionFake} from '../../e2e/lib/notion-fake.mjs';
import {startNotionProxy} from '../../e2e/lib/notion-proxy.mjs';
import {python} from '../../e2e/lib/python.mjs';
import {storeCall} from '../../e2e/lib/store-call.mjs';
import {startTelegramFake} from '../../e2e/lib/telegram-fake.mjs';

const E2E = path.resolve(import.meta.dirname, '..', '..', 'e2e');
const REPO = path.resolve(E2E, '..', '..');
const FEEDS = path.join(E2E, 'fixtures', 'feeds');
const OWNER_APP_PORT = 47111;   // the owner's app (a leaked test app held it on 29 Oct 2026): no kit server may ever be on it
const NOTHING_LISTENS = 'http://127.0.0.1:9';   // the AI proxy's "upstream": the discard port; a call that reached it would fail, never reach a model
export const CHAT = '424242';

// The inbox of the e2e Gmail check: three of the qualityai mail eval's invented emails (an ATS thank-you, an interview invite, a security code), as lib/context.mjs gives its fake Google.
const mailFixtures = () => {
  const {cases} = JSON.parse(fs.readFileSync(path.join(REPO, 'tests', 'fixtures', 'mail_eval.json'), 'utf8'));
  return ['ats_thanks', 'interview_invite', 'security_code'].map(id => cases.find(item => item.id === id)?.email).filter(Boolean);
};

/** A free loopback port, chosen by the OS; throws if it is the owner's app port. Servers below ask for port 0 and are checked with `assertSafePort` afterwards. */
export async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const {port} = server.address();
  await new Promise(resolve => server.close(resolve));
  assertSafePort(port);
  return port;
}

/** Every address the kit hands to the app must be a loopback address on a port that is not the owner's app's. */
export function assertSafePort(portOrUrl) {
  const url = typeof portOrUrl === 'number' ? new URL(`http://127.0.0.1:${portOrUrl}`) : new URL(portOrUrl);
  assert.equal(url.hostname, '127.0.0.1', `a kit server must be on loopback, not ${url.hostname}`);
  assert.notEqual(Number(url.port), OWNER_APP_PORT, `a kit server is on ${OWNER_APP_PORT}, the port the owner's app may hold`);
}

/**
 * Starts a kit. Options: `ai` (default true: a dummy Anthropic key and the fault-injecting proxy in front of the engine's AI), `store` ('sqlite' = this Mac's store, or 'notion' = the Notion
 * stand-in behind the fault proxy), `answers` (a suite name, e.g. 'interviews': the AI answers from the e2e stored table for that suite, e2e/fixtures/golden/ai-answers.json,
 * and refuses what the table does not hold, instead of refusing everything), `telegram` and `google` (the fakes; Telegram is connected to chat CHAT), `emails` (what the fake inbox holds).
 * -> the kit: `storage`, `profile`, `feeds`, `proxy`, `notion` (fake + `proxy`), `telegram`, `google`, `tasks` (the app's own task functions), `feed(titles, {location})`,
 * `runTask(name, ...args)` (-> the app's run record: {ok, run}), `storedRuns()`, `close()`.
 */
export async function startEngineKit({ai = true, store = 'sqlite', telegram = false, google = false, emails = [], answers = ''} = {}) {
  const closers = [];
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-engine-kit-'));
  const feeds = path.join(profile, 'feeds');
  fs.cpSync(FEEDS, feeds, {recursive: true});
  const proxy = await startAiProxy({target: NOTHING_LISTENS});
  closers.push(() => proxy.close());
  // Anything no test answered is refused the way the API refuses an empty balance: a call can never fall through to a model. With `answers`, the e2e stored table answers first (its
  // backbone mode refuses a question the table lacks, never passing it on).
  if (!answers) proxy.setCanned(() => ({refuse: 'no-credit'}));
  assertSafePort(proxy.url);
  const env = {JOB_PILOTTO_E2E: '1', JOB_PILOTTO_FIXTURE_DIR: feeds, JOB_PILOTTO_FOLLOW_APP: '0', JOB_PILOTTO_E2E_AI_BASE_URL: proxy.url, JOB_PILOTTO_E2E_EXPECTS_FAILURES: '1', HOME: profile};
  const kit = {profile, feeds, proxy, tasks: null, storage: null, notion: null, telegram: null, google: null};

  if (store === 'notion') {
    const fake = await startNotionFake();
    const standIn = fake;
    const farSide = await startNotionProxy({target: fake.url});
    closers.push(() => farSide.close(), () => fake.close());
    assertSafePort(fake.url); assertSafePort(farSide.url);
    kit.notion = Object.assign(farSide, {fake, token: fake.token, ids: await buildStandIn(standIn)});
    Object.assign(env, {JOB_PILOTTO_E2E_NOTION_BASE_URL: farSide.url, JOB_PILOTTO_E2E_NOTION_STANDIN: '1'});
  }
  if (telegram) {
    kit.telegram = await startTelegramFake();
    closers.push(() => kit.telegram.close());
    assertSafePort(kit.telegram.url);
    env.JOB_PILOTTO_E2E_TELEGRAM_BASE_URL = kit.telegram.url;
  }
  if (google) {
    kit.google = await startGoogleFake({emails: emails.length ? emails : mailFixtures()});
    closers.push(() => kit.google.close());
    assertSafePort(kit.google.url);
    Object.assign(env, {JOB_PILOTTO_E2E_GOOGLE_BASE_URL: kit.google.url, GOOGLE_CLIENT_ID: 'e2e-client', GOOGLE_CLIENT_SECRET: 'e2e-secret', GOOGLE_REFRESH_TOKEN: 'e2e-refresh'});
  }
  if (answers) Object.assign(env, {E2E_AI_ANSWERS: 'backbone', E2E_SUITE: answers, E2E_ARTIFACTS: path.join(profile, 'artifacts')});
  // The app's modules read these at import and at each spawn: set them first, import after.
  const before = {...process.env};
  Object.assign(process.env, env);
  closers.push(() => { for (const name of Object.keys(env)) { if (name in before) process.env[name] = before[name]; else delete process.env[name]; } });

  const {createStorage} = await import('../../lib/storage.js');
  const {ensureConfig} = await import('../../lib/pipeline-env.js');
  const strategy = await import('../../lib/strategy-settings.js');
  const pipeline = await import('../../lib/pipeline.js');
  const {hasChildren} = await import('../../lib/pipeline-run.js');
  const storage = createStorage(profile, {encrypt: value => value, decrypt: value => value});
  kit.storage = storage; kit.tasks = pipeline;
  storage.saveSettings({setupDone: true, aiEngine: 'api', lastScoutAt: new Date(0).toISOString(), autoSearch: false, schedule: {search: 0, mail: 0, scout: 'off', insights: 'off'},
    ...(store === 'notion' ? {store: 'notion', notionIds: kit.notion.ids} : {store: 'sqlite'}), ...(telegram ? {telegramChatId: CHAT, notifyChannels: ['telegram']} : {})});
  if (ai) storage.setSecret('ANTHROPIC_API_KEY', 'sk-ant-e2e-dummy-key');
  if (store === 'notion') storage.setSecret('NOTION_TOKEN', kit.notion.token);
  if (telegram) storage.setSecret('TELEGRAM_BOT_TOKEN', '123456:e2e-fake-token');
  // Why (R2, 1 Nov 2026): the app's own AI calls in Node (remember, review, judge) follow ANTHROPIC_BASE_URL, which the app sets with this very function at start; the kit calls it, not a copy.
  if (ai) {
    const {apply: pointSdkAtStandIn} = await import('../../lib/ai-free.js');
    const sdkBefore = {ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL, OPENAI_BASE_URL: process.env.OPENAI_BASE_URL};
    pointSdkAtStandIn(storage.settings());
    assert.match(String(process.env.ANTHROPIC_BASE_URL), /^http:\/\/127\.0\.0\.1:\d+/, 'the app\'s AI calls must reach the loopback stand-in, nothing else');
    closers.push(() => { for (const [name, value] of Object.entries(sdkBefore)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } });
  }
  ensureConfig(storage);
  strategy.keepLocally(storage, applicantDraft(), null);   // the wizard's save on this Mac's store: the e2e applicant (an SRE in Zurich)
  fs.copyFileSync(path.join(FEEDS, 'sources.json'), path.join(profile, 'config', 'sources.json'));
  fs.copyFileSync(path.join(FEEDS, 'scout_seeds.json'), path.join(profile, 'config', 'scout_seeds.json'));

  const feedCtx = {feeds};
  kit.feed = (titles = [], options) => setFeed(feedCtx, titles, options);
  kit.feed([]);
  // The harness reads the store straight from the stand-in, not through the fault proxy: a read of what became of a run must not itself be failed.
  const storeCtx = () => ({profile, store: store === 'notion' ? 'standin' : 'sqlite', token: kit.notion?.token || '',
    appEnv: store === 'notion' ? {JOB_PILOTTO_E2E_NOTION_BASE_URL: kit.notion.fake.url, JOB_PILOTTO_E2E_NOTION_STANDIN: '1'} : {}});
  kit.storedRuns = async () => storeCall(storeCtx(), 'cron_runs', 'list', {});
  /** One call of the store's own command (`python -m src.stores call`), the way the e2e suites seed and read: data comes from the engine, never hand-written rows. */
  kit.data = (entity, method, kwargs = {}) => storeCall(storeCtx(), entity, method, kwargs);
  /** Runs one of the app's tracked tasks to its end and returns {ok, run}: `run` is the record the app keeps for Recent runs (kind, ok, warned, problem, result, summary, log). */
  kit.runTask = async (name, ...args) => {
    const lines = [];
    const done = await pipeline[name](storage, line => lines.push(String(line)), ...args);
    await kit.settled();
    return {...done, lines};
  };
  /** "Analyze my job search" (the weekly report): the task a Telegram or ⌘K command starts through lib/telegram.js localDispatch → pipeline.task with the daily args. -> {ok, run, lines}. */
  kit.runWeekly = async () => {
    const lines = [];
    const done = await pipeline.task(storage, 'weekly', pipeline.dailyArgs(storage, {mode: 'weekly'}), line => lines.push(String(line)));
    await kit.settled();
    return {...done, lines};
  };
  kit.running = () => pipeline.running();
  /** Resolves when no task runs and no engine child lives (a finished search starts a quiet follow-up step of its own: the folder must not go while it runs). The limit is a hang guard. */
  kit.settled = async (hangMs = 60000) => {
    const hang = Date.now() + hangMs;
    while (pipeline.running() || pipeline.queued().length || hasChildren()) {
      if (Date.now() > hang) throw new Error(`the kit never went quiet: running ${JSON.stringify(pipeline.running()?.kind)}, queued ${pipeline.queued().length}, engine children ${hasChildren()}`);
      // Why (1 Nov 2026): a poll interval for a state that is not here yet (the engine child's exit), bounded by the hang guard above, not a wait for time to pass.
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  };
  kit.appRuns = () => pipeline.runs(storage);
  kit.close = async () => { await kit.settled(); for (const close of closers.reverse()) await close(); fs.rmSync(profile, {recursive: true, force: true}); };
  return kit;
}

/**
 * The engine, started with no data or config folder set while an app is "set up" in a fake app folder (JOB_PILOTTO_APP_DIR, a temp folder), refuses to open it (src/paths.py
 * follow_app): proof that a run of this kit that lost its folders would stop, not touch the owner's. -> the engine's stderr ('' if it did not refuse). Nothing real is read.
 */
export async function refusesRealFolder() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-fake-app-'));
  try {
    fs.mkdirSync(path.join(home, 'data'), {recursive: true});
    fs.writeFileSync(path.join(home, 'settings.json'), JSON.stringify({setupDone: true, notionIds: {NOTION_JOBS_DB: '0123456789abcdef0123456789abcdef'}}));
    const env = {PATH: process.env.PATH, HOME: home, USERPROFILE: home, APPDATA: home, JOB_PILOTTO_APP_DIR: home, PYTHONUTF8: '1'};
    return await promisify(execFile)(python(), ['-c', 'from src import paths'], {cwd: REPO, env}).then(() => '', error => String(error.stderr || error.message));
  } finally { fs.rmSync(home, {recursive: true, force: true}); }
}
