/* global document, window */
// Job: wait on state
// The end-to-end proof of Background automation (spec 2026-10-27-background-apply-execution, step B): the app's own hidden browser fills a fictional
// form, the person's Submit (liveSubmit, after the app re-reads the page) lands, the job becomes Applied. Only the fixture server and the proxy's stand-ins answer; every
// wait is on a state the app shows (the session's background state, the stage), the cap only catches a hang.
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright-core';
import {INSTRUCTIONS as FORM_JUDGE} from '../../lib/form-judge.js';
import {addKitJob, removeJobsByUrl, stageOf} from './seed-data.mjs';
import {appLogLines} from './app-log.mjs';
import {OWNED_WORKER} from './own-worker.mjs';

const FOLDER = {darwin: 'chrome-mac-', linux: 'chrome-linux64', win32: 'chrome-win64'};
/**
 * Puts Playwright's Chromium where the app looks for its downloaded Chrome for Testing (`<profile>/background-browser-runtime/chrome-<platform>`), as a link: no
 * 195 MB download in a test (lib/background-browser-download.js layout). Returns '' when linked, else why not (Windows has no link here).
 */
export function linkRuntime(profile, platform = process.platform, arch = process.arch) {
  if (platform === 'win32') return 'no hidden-browser runtime link on Windows';
  const executable = chromium.executablePath(), mac = platform === 'darwin';
  const root = mac ? path.resolve(executable, '..', '..', '..', '..') : path.dirname(executable);   // chrome-mac-arm64 (holds the .app) or the folder with `chrome`
  const name = mac ? `chrome-mac-${arch === 'arm64' ? 'arm64' : 'x64'}` : FOLDER[platform];
  if (!name || !fs.existsSync(executable)) return `no Chromium at ${executable}`;
  const runtime = path.join(profile, 'background-browser-runtime');
  fs.mkdirSync(runtime, {recursive: true});
  fs.rmSync(path.join(runtime, name), {recursive: true, force: true});
  fs.symlinkSync(root, path.join(runtime, name), 'dir');
  return '';
}

/** The form judge's ask in a proxy body: {judged, text} (judged: it is the form judge's system prompt; text: the sketch). */
const askOf = body => {
  const system = typeof body?.system === 'string' ? body.system : (body?.system || []).map(part => part.text || '').join('');
  const content = body?.messages?.[0]?.content;
  return {judged: system.startsWith(FORM_JUDGE), text: typeof content === 'string' ? content : (content || []).map(part => part.text || '').join('')};
};
const verdict = (answer, submitControl, botCheck = false) => JSON.stringify({answer, blocked_kind: '', needs: '', needs_kind: '', step: 'final', next_control: '', submit_control: submitControl, bot_check: botCheck, login_wall: false, account_to_create: false, confidence: 0.95});

/**
 * The form judge's stand-in (lib/form-judge.js, a model that reads the sketch): ready on a final step once no required control is listed empty, naming the one Submit button;
 * every other ask goes to `previous`, the suite's own stand-ins.
 */
export const withFormJudge = (previous, submitText) => body => {
  const {judged, text} = askOf(body);
  if (!judged) return previous ? previous(body) : null;
  const empty = /· required · empty/.test(text);
  return verdict(empty ? 'needs_person' : 'ready', empty ? '' : submitText);
};

/**
 * The same stand-in for a page that lists a box asking to prove the visitor is no robot (forms.mjs BOT_CHECK): the answer a model gives, needs_person with bot_check true (form-judge.js BOT_RULE);
 * a sketch without that box is answered by `withFormJudge`.
 */
export const withBotCheckJudge = (previous, submitText) => {
  const plain = withFormJudge(previous, submitText);
  return body => { const {judged, text} = askOf(body); return judged && /not a robot/i.test(text) ? verdict('needs_person', '', true) : plain(body); };
};

/** The triage judge's account shapes: a login heading or a password confirmation means the person is needed; other forms use the bot-check/plain stand-ins. `before` observes the real hidden page before the answer releases it. */
export const withAccountReadJudge = (previous, submitText, before = async () => {}) => {
  const plain = withBotCheckJudge(previous, submitText);
  return async body => {
    const {judged, text} = askOf(body);
    if (!judged) return plain(body);
    await before();
    const login = /^Headings: .*\bSign in to apply\b/m.test(text), account = /password · Confirm password/.test(text);
    if (!login && !account) return plain(body);
    return JSON.stringify({...JSON.parse(verdict('needs_person', '')), login_wall: login, account_to_create: account});
  };
};

/** The need every hidden-browser step names: the runtime link (linkRuntime) does not exist on Windows. */
export const HIDDEN_NEED = {name: 'a runtime link for the hidden browser (none on Windows)', value: process.platform !== 'win32'};
/** The submitter's details-only page, the one Full automation can take (a kit answer is never a saved fact); `query` gives a step its own address (one background session per address). */
export const autoFormOf = (form, query = '') => ({...form, path: form.autoPath, url: `https://${form.host}${form.autoPath}${query}`, kit: []});
/** The seed of a hidden-browser step: the suite's fixture jobs `urls` removed (so the one job Start picks is this step's), then `job` added with an eligible kit of its own answers. */
export const kitSeeder = (ctx, urls, posting) => async job => {
  await removeJobsByUrl(ctx, urls);
  await addKitJob(ctx, {title: job.title, company: job.company, url: job.url, kit: {answers: job.kit || [], cover_letter: '', check_before_sending: [], eligible: true}, description: posting});
};
/** The session id of the application of `url`, from the Sessions list, or ''. */
export const sessionOf = (page, url) => page.evaluate(target => window.pilot.sessions().then(list => list.find(item => String(item.url || '').replace(/\/$/, '') === target.replace(/\/$/, ''))?.id || ''), url);

/** The background record of the application of `url` ({state, reason, …}), from the Sessions list (item.background, lib/background-apply-controller.js cache), or null. */
export const backgroundOf = (page, url) => page.evaluate(target => window.pilot.sessions().then(list => list.find(item => String(item.url || '').replace(/\/$/, '') === target.replace(/\/$/, ''))?.background || null), url);
/** The background state of the application of `url`, or ''. */
export const backgroundStateOf = async (page, url) => (await backgroundOf(page, url))?.state || '';

/** Ends a proof's job the way the person does ("Skip this role": the job is dismissed, its session closes).
 * Why (30 Oct 2026, found by the bot-check steps): Start takes the first eligible job and the suite's steps assume one is left, so a job a proof leaves handed over is started again by the next proof. */
export async function skipJob(page, form) {
  const left = await sessionOf(page, form.url).catch(() => '');
  if (left) await page.evaluate(session => window.pilot.sessionSkip(session), left).catch(error => console.log(`  could not skip session ${left}: ${String(error?.message || error).slice(0, 120)}`));
}

/** Opens this application's session on the Sessions page: the card a click on its dock card or list row opens (pages/session-log.js openSession), picked by the session's id.
 * Why (30 Oct 2026, found by the bot-check steps in CI order): every submitter variant has one company and one title, so a card found by those words opened an earlier job's card ("Review the filled application"). */
export async function openSessionCard(page, form) {
  const id = await sessionOf(page, form.url);
  if (!id) throw new Error(`the app holds no session for ${form.url}`);
  await page.evaluate(session => import('./pages/session-log.js').then(module => module.openSession(session)), id);
}

/** One Runtime.evaluate on the owned target: ignore events/other replies. Diagnostics return null on failure and end after 4 s; strict proofs reject with the
 * worker/protocol error and have no clock of their own; a socket that closes before its reply ends either. */
export const evaluateOn = (socketUrl, expression, {strict = false} = {}) => new Promise((done, fail) => {
  const socket = new WebSocket(socketUrl), end = (value, error) => { clearTimeout(timer); try { socket.close(); } catch { /* closed */ } strict && error ? fail(error) : done(value); };
  // Why (31 Oct 2026, re-check 41198629562, apply-2of3): the strict due-time poll awaits the app's /extension/background-apply ([ext-http] 4.1 and 4.8 s there,
  // no AI), so a 4 s cap timed the app's work, not the worker's reply; the step's hang cap is a strict proof's only clock (rule B).
  const timer = strict ? undefined : setTimeout(() => end(null, new Error('the owned target did not answer Runtime.evaluate (4 s hang cap)')), 4000);
  socket.onclose = () => end(null, new Error('the owned Runtime.evaluate socket closed before its reply'));
  socket.onopen = () => socket.send(JSON.stringify({id: 1, method: 'Runtime.evaluate', params: {returnByValue: true, awaitPromise: true, expression}}));
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id !== 1) return;
    const exception = message.result?.exceptionDetails;
    const error = message.error?.message || exception?.exception?.description || exception?.text;
    end(message.result?.result?.value ?? null, error ? new Error(`owned Runtime.evaluate: ${error}`) : null);
  };
  socket.onerror = () => end(null, new Error('the owned Runtime.evaluate socket failed'));
});

/** The debugging port of the hidden browser of `profile` (its DevToolsActivePort file); throws when it was never started. */
export const hiddenPort = profile => Number(fs.readFileSync(path.join(profile, 'background-browser', 'profile', 'DevToolsActivePort'), 'utf8').split('\n')[0]);

/** Every target the hidden browser of `profile` holds (pages and extension workers); throws when it is not running. */
export const hiddenTargets = async profile => (await fetch(`http://127.0.0.1:${hiddenPort(profile)}/json/list`, {signal: AbortSignal.timeout(3000)})).json();

/** The values of the inputs on the page behind `socketUrl`, for a failure message. */
const valuesOf = async socketUrl => String(await evaluateOn(socketUrl, "[...document.querySelectorAll('input,textarea,select')].map(item => (item.name || item.id) + '=' + (item.type === 'file' ? item.files.length + ' file(s) [file mark: ' + (item.getAttribute('data-jobadabra-file') || 'none') + ']' : item.value) + ' [grounding: ' + (item.dataset.jobadabraGrounding || 'none') + (item.hasAttribute('data-jobadabra-guess') ? ', guess' : '') + ']').join(', ')") ?? '(no answer)').slice(0, 700);

/** The console lines and exceptions the page behind `socketUrl` already holds (Runtime.enable replays them), for a failure message. */
const consoleOf = socketUrl => new Promise((done, fail) => {
  const pending = new Set([1, 2]);
  const lines = [], socket = new WebSocket(socketUrl), end = error => { clearTimeout(timer); try { socket.close(); } catch { /* closed */ } if (error) fail(error); else done(lines.slice(-8).join(' // ') || '(empty)'); };
  const timer = setTimeout(() => end(new Error('the hidden console never acknowledged Runtime.enable and Log.enable (10 s hang cap)')), 10000);
  socket.onopen = () => { socket.send(JSON.stringify({id: 1, method: 'Runtime.enable'})); socket.send(JSON.stringify({id: 2, method: 'Log.enable'})); };
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.consoleAPICalled') lines.push(`${message.params.type}: ${(message.params.args || []).map(arg => arg.value ?? arg.description ?? '').join(' ')}`.slice(0, 200));
    if (message.method === 'Runtime.exceptionThrown') lines.push(`EXCEPTION: ${message.params.exceptionDetails?.exception?.description || message.params.exceptionDetails?.text}`.slice(0, 240));
    if (message.method === 'Log.entryAdded') lines.push(`log ${message.params.entry.level}: ${message.params.entry.text}`.slice(0, 200));
    // Why (29 Oct 2026, ap): CDP replays stored events before acknowledging enable; both replies end collection even when the console is empty.
    if (pending.delete(message.id) && !pending.size) end();
  };
  socket.onerror = () => end();
});

/** Asks the hidden browser's extension itself, from a page of its own (options.html): its permission for the form's site, what its storage holds, the tabs and the worker's session keys. */
async function askExtension(profile, port) {
  try {
    const prefs = JSON.parse(fs.readFileSync(path.join(profile, 'background-browser', 'profile', 'Default', 'Secure Preferences'), 'utf8'));
    const id = Object.entries(prefs.extensions?.settings || {}).find(([, item]) => String(item.path || '').endsWith(`${path.sep}background-browser${path.sep}extension`))?.[0];
    if (!id) return 'extension not in the profile';
    const {webSocketDebuggerUrl} = await (await fetch(`http://127.0.0.1:${port}/json/version`, {signal: AbortSignal.timeout(3000)})).json();
    return await new Promise((done, fail) => {
      const socket = new WebSocket(webSocketDebuggerUrl), waits = new Map();
      let counter = 0;
      const call = (method, params = {}, sessionId) => new Promise(resolve => { const n = ++counter; waits.set(n, resolve); socket.send(JSON.stringify({id: n, method, params, ...(sessionId ? {sessionId} : {})})); });
      const end = (error, answer) => { clearTimeout(timer); socket.close(); if (error) fail(error); else done(answer); };
      const timer = setTimeout(() => end(new Error('the extension options page never became ready or answered (10 s hang cap)')), 10000);
      socket.onmessage = event => { const message = JSON.parse(event.data); if (message.id && waits.has(message.id)) { waits.get(message.id)(message); waits.delete(message.id); } };
      socket.onopen = async () => {
        try {
          const {result: {targetId}} = await call('Target.createTarget', {url: `chrome-extension://${id}/options.html`});
          const {result: {sessionId}} = await call('Target.attachToTarget', {targetId, flatten: true});
          const run = async expression => { const reply = (await call('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true}, sessionId)).result; const value = reply?.result?.value; return value === undefined ? `(${String(reply?.exceptionDetails?.exception?.description).slice(0, 100)})` : typeof value === 'string' ? value : JSON.stringify(value); };
          while (await run(`location.href === 'chrome-extension://${id}/options.html' && document.readyState === 'complete' && !!globalThis.chrome?.storage?.local && !!globalThis.chrome?.storage?.session && !!globalThis.chrome?.tabs`) !== 'true') {
            await new Promise(next => setTimeout(next, 100));
          }
          const answer = await run(`(async () => { const local = await chrome.storage.local.get(null), session = await chrome.storage.session.get(null), tabs = await chrome.tabs.query({});
            return JSON.stringify({page: location.protocol, siteAllowed: await chrome.permissions.contains({origins: ['https://e2e.recruitee.com/*']}), localKeys: Object.keys(local), owner: !!local.backgroundOwner, worker: String(local.workerUrl || ''),
              sessionKeys: Object.keys(session).slice(0, 14), tabs: tabs.map(item => item.url.slice(0, 60))}); })()`);
          await call('Target.closeTarget', {targetId}); end(null, answer);
        } catch (error) { end(error); }
      };
      socket.onerror = () => end(null, '(unreadable)');
    });
  } catch (error) { return `(${String(error?.message || error).slice(0, 80)})`; }
}

/** What the hidden browser of `profile` holds right now (its tabs and extension workers, its folder), for a failure message. Never throws. */
export async function describeHidden(profile) {
  const folder = path.join(profile, 'background-browser');
  try {
    const port = hiddenPort(profile), targets = await hiddenTargets(profile);
    const form = targets.find(item => item.type === 'page' && /^https?:/.test(item.url));
    return `hidden browser on port ${port} holds: ${targets.map(item => `${item.type} ${String(item.url).slice(0, 80)}`).join(' | ') || 'nothing'} | its form reads: ${form ? await valuesOf(form.webSocketDebuggerUrl) : 'no page'} | its console: ${form ? await consoleOf(form.webSocketDebuggerUrl) : 'no page'} | the extension says: ${await askExtension(profile, port)}`;
  } catch (error) {
    let held = ''; try { held = fs.readdirSync(folder).join(', '); } catch { held = 'no folder'; }
    let said = ''; try { said = fs.readFileSync(path.join(folder, 'e2e-browser.log'), 'utf8').trim().split('\n').slice(-6).join(' // ').slice(0, 600); } catch { said = 'no log'; }
    return `hidden browser not reachable (${String(error?.message || error).slice(0, 80)}); its folder holds: ${held}; it said: ${said}`;
  }
}

/** Closes the app's hidden browser of `profile` (it dies with the app, lib/browser-reaper.js; a run closes it itself so it does not wait for that): Browser.close over its own debugging port. Never throws. */
export async function closeHiddenBrowser(profile) {
  try {
    const port = hiddenPort(profile);
    const {webSocketDebuggerUrl} = await (await fetch(`http://127.0.0.1:${port}/json/version`, {signal: AbortSignal.timeout(3000)})).json();
    await new Promise(done => {
      const socket = new WebSocket(webSocketDebuggerUrl), end = () => { clearTimeout(timer); done(); }, timer = setTimeout(end, 5000);
      socket.onopen = () => socket.send(JSON.stringify({id: 1, method: 'Browser.close'}));
      socket.onmessage = end; socket.onclose = end; socket.onerror = end;
    });
  } catch { /* none was started */ }
}

/**
 * The compact state a hang message leads with, so a cap that cuts the message still names the cause: whether the owned worker is there, the hidden browser's tabs, and the app's queue
 * (each session with its background state). Never throws. Why (1 Nov 2026, apply-3of3 41269739097): the bot-check message was cut at 600 characters before it said anything about the browser.
 */
export async function hiddenBrief(profile, page, {targets: list = hiddenTargets} = {}) {
  let browser;
  try {
    const targets = await list(profile);
    browser = `owned worker ${targets.some(item => item.type === 'service_worker' && OWNED_WORKER.test(String(item.url))) ? 'yes' : 'NO'}; tabs: ${targets.filter(item => item.type === 'page').map(item => String(item.url).slice(0, 60)).join(' | ') || 'none'}`;
  } catch (error) { browser = `not reachable (${String(error?.message || error).slice(0, 60)})`; }
  let queue;
  try { queue = (await page.evaluate(() => window.pilot.sessions())).map(item => `${item.id}:${item.background?.state || '-'}`).join(' ') || 'none'; } catch (error) { queue = `unreadable (${String(error?.message || error).slice(0, 60)})`; }
  return `hidden browser: ${browser} | app queue: ${queue}`;
}

/**
 * Runs a proof's `body`; when it throws, the jobs it started are ended the way the person ends them ("Skip this role") BEFORE the error goes on, and the hidden browser is closed on every path.
 * Why (1 Nov 2026, rule 7, apply-3of3 41267661024): "Full automation presses Submit once" threw at its poll with its auto session still queued; the next steps found it first ("Stop on the card" read its
 * card, "several queued jobs" counted it as one of the 4). A job that finished (Applied) is left as it is: only a failed step skips.
 */
export async function withJobsEnded(ctx, jobs, body) {
  try { return await body(); }
  catch (error) {
    for (const job of jobs) await skipJob(ctx.page, job);
    const left = (await Promise.all(jobs.map(job => sessionOf(ctx.page, job.url).catch(() => '')))).filter(Boolean);
    if (left.length) console.log(`  after the failed step, ${left.length} session(s) are still listed: ${left.join(', ')}`);
    throw error;
  } finally { if (process.env.E2E_KEEP_HIDDEN !== '1') await closeHiddenBrowser(ctx.profile); }   // E2E_KEEP_HIDDEN=1: leave it running to probe by hand after a failure (local only)
}

/**
 * The proof: Background automation saved as the mode; the app fills the fixture form in its hidden browser and reaches Ready to review without posting; the person's Submit
 * (liveSubmit, the app re-reads the page first) posts exactly once and the job becomes Applied. `until(what, check, ms)` is the suite's state wait.
 */
export async function proveBackground(ctx, {form, seed, until}) {
  const {page, proxy, forms} = ctx;
  const unlinked = linkRuntime(ctx.profile);
  if (unlinked) { if (process.platform === 'win32') { console.log(`  skipped here: ${unlinked}`); return; } throw new Error(unlinked); }
  proxy.setCanned(withFormJudge(proxy.canned(), 'Submit Application'));
  await seed();
  await withJobsEnded(ctx, [form], async () => {
    await page.evaluate(chosenAt => window.pilot.saveSettings({apply: {mode: 'fill', chosenAt}}), new Date().toISOString());
    const posted = forms.posts.length;
    const started = await page.evaluate(() => window.pilot.apply({n: 1, mode: 'settings'}));
    if (process.env.E2E_KEEP_HIDDEN === '1') for (const seconds of [6, 20]) setTimeout(() => describeHidden(ctx.profile).then(text => console.log(`  [${seconds}s after Start] ${text}`)), seconds * 1000);   // local debugging only: the hidden browser's state early, not only at the failure
    if (started?.ok === false) throw new Error(`the app refused to start Background automation: ${started.error}`);
    // The owner's scenario (28 Oct 2026 screenshot, "Filling the application" with a broken picture): the session is opened in the window while the fill runs, when the hidden form may not be open yet;
    // the live view must still end up showing the page (renderer/live-opener.js asks again on every redraw).
    await until('the application never got a session', async () => !!(await sessionOf(page, form.url)), 60000);
    // The way e2e/suites/apply.mjs opens a session (proven on CI): the dock card, expanding the collapsed dock first; the Sessions page when the dock does not show this one.
    await openSessionCard(page, form);
    const shown = await page.evaluate(async () => {
      for (let waited = 0; waited < 40000; waited += 250) {
        const img = document.querySelector('.live-img');
        if (img?.complete && img.naturalWidth > 0) return {ok: true, w: img.naturalWidth};
        await new Promise(done => setTimeout(done, 250));
      }
      const img = document.querySelector('.live-img');
      return {ok: false, img: !!img, srcChars: String(img?.getAttribute('src') || '').length, address: document.querySelector('.live-url')?.textContent || ''};
    });
    if (!shown.ok) throw new Error(`the live view shows no picture of the hidden page: ${JSON.stringify(shown)}`);
    await until('the hidden form never reached Ready to review', async () => (await backgroundStateOf(page, form.url)) === 'ready_for_review', 120000)
      .catch(async error => { throw new Error(`${error.message} | ${await describeHidden(ctx.profile)} | state: ${await backgroundStateOf(page, form.url) || 'none'}`); });
    if (forms.posts.length !== posted) throw new Error('the form was posted before the person pressed Submit');
    const id = await sessionOf(page, form.url);
    if (!id) throw new Error('the filled application has no session to press Submit on');
    const sent = await page.evaluate(session => window.pilot.liveSubmit(session), id);
    if (!sent?.ok) throw new Error(`the person's Submit was refused: ${sent?.error}`);
    await until('the job never became Applied after the person submitted in the live view', async () => (await stageOf(ctx, form.url)) === 'Applied', 120000);
    if (forms.posts.length !== posted + 1) throw new Error(`expected the person's one Submit, the server saw ${forms.posts.length - posted}`);
  });
}

const HANDOFF = /^(needs_user_handoff|manual_submit_required)$/;

/**
 * The proof of the bot-check hand-off in a hidden-browser mode (`mode` 'fill' = Background, 'auto' = Full automation, with no wait): the form (forms.mjs BOT_CHECK) asks to prove no robot, the judge's stand-in
 * says bot_check, and the application is handed to the person with a captcha reason. The Applying card says "A bot check needs you" with Submit off, the list and dock say "Needs you", and nothing is solved or sent:
 * the fixture server sees no POST and the app never authorizes a press. `until(what, check, ms)` is the suite's state wait.
 */
export async function proveBotCheck(ctx, {form, mode, seed, until}) {
  const unlinked = linkRuntime(ctx.profile);
  if (unlinked) { if (process.platform === 'win32') { console.log(`  skipped here: ${unlinked}`); return; } throw new Error(unlinked); }
  await ctx.relaunch();   // Why (30 Oct 2026, found by this step): the step before closed the hidden browser behind the app's back, so a second run in the same app never got a browser to poll; each proof starts the app fresh (proveAutomatic does too)
  const {page, proxy, forms} = ctx;   // read after the relaunch: it is a new window
  proxy.setCanned(withBotCheckJudge(proxy.canned(), 'Submit Application'));
  await seed(form);   // `seed(form)` adds the job the run starts (kitSeeder), as proveAutomatic does
  try {
    const chosenAt = new Date().toISOString(), posted = forms.posts.length, pressed = () => appLogLines(ctx.profile).filter(line => /one-shot automatic submit authorized/.test(line)).length;
    const pressesBefore = pressed();
    await page.evaluate(({kind, at}) => window.pilot.saveSettings({apply: {mode: kind, chosenAt: at, ...(kind === 'auto' ? {autoConfirmedAt: at, auto: {waitMin: 0}} : {})}}), {kind: mode, at: chosenAt});
    const started = await page.evaluate(() => window.pilot.apply({n: 1, mode: 'settings'}));
    if (started?.ok === false) throw new Error(`the app refused to start the ${mode} mode: ${started.error}`);
    const handed = await until('the hidden browser never handed the bot check to the person', async () => { const held = await backgroundOf(page, form.url); return HANDOFF.test(held?.state || '') ? held : null; }, 180000)
      .catch(async error => { throw new Error(`${await hiddenBrief(ctx.profile, page)} | state: ${(await backgroundOf(page, form.url))?.state || 'none'} | ${error.message} | ${await describeHidden(ctx.profile)}`); });
    if (!/^captcha_/.test(handed.reason)) throw new Error(`the hand-off reason is "${handed.reason}", not a bot check (captcha_*)`);
    await openSessionCard(page, form);
    const readCard = () => page.evaluate(() => ({title: document.querySelector('#ss-next-title')?.innerText || '', pill: document.querySelector('#ss-stage')?.innerText || '', open: document.querySelector('#ss-title, .ss-title')?.innerText || '',
      submit: [...document.querySelectorAll('#ss-actions button')].filter(button => /^Submit application$/i.test(button.innerText.trim())).map(button => button.disabled)}));
    const card = await until('the Applying card never said "A bot check needs you"', async () => { const read = await readCard(); if (/A bot check needs you/.test(read.title)) return read; await openSessionCard(page, form); return null; }, 30000)   // asks for the card again: the page may have moved to another session meanwhile
      .catch(async error => { throw new Error(`${error.message} | the open card says ${JSON.stringify(await readCard())}; state: ${JSON.stringify(handed)}`); });
    if (!/Needs you/i.test(card.pill)) throw new Error(`the card's pill says "${card.pill.trim()}", not "Needs you"`);
    if (card.submit.length !== 1 || card.submit[0] !== true) throw new Error(`the card's Submit application is not one disabled button: ${JSON.stringify(card.submit)}`);
    await page.click('.nav[data-view="sessions"]');
    // Why (30 Oct 2026, found on CI apply-1of2): the list marks one row current, and the page falls back to another session's (a Lever job "Ready to submit") when the open one is not the pick, so the check reads the company's rows: the other jobs of this company are Applied or skipped, only this one can say "Needs you".
    const rows = await page.locator('#ss-list .ss-row').filter({hasText: form.company}).allInnerTexts();
    if (!rows.some(text => /Needs you/i.test(text))) throw new Error(`no Sessions list row of ${form.company} says "Needs you": "${rows.join(' / ').replace(/\s+/g, ' ')}"`);
    const dock = await page.locator('#sd-cards .sd-card').filter({hasText: form.company}).allInnerTexts().catch(() => []);   // the dock draws live sessions only; a job of the same company may sit beside this one
    if (dock.length && !dock.some(text => /Needs you/i.test(text))) throw new Error(`no dock card says "Needs you": "${dock.join(' / ').replace(/\s+/g, ' ')}"`);
    if (forms.posts.length !== posted) throw new Error(`a bot check was met and the form still got ${forms.posts.length - posted} POST(s): nothing may be sent`);
    if (pressed() !== pressesBefore) throw new Error('the app authorized an automatic press on a page with a bot check');
  } finally {
    await skipJob(page, form);
    await closeHiddenBrowser(ctx.profile);
  }
}


/** The app's stored record of the background application of `url` (queuedAt, launchedAt, readyAt, handoffAt, state, reason ...), or null: what the app wrote at each move, read after the run. */
async function recordOf(ctx, url) {
  const app = await ctx.data('applications', 'get', {url});
  if (!app?.id) return null;
  try { return JSON.parse(await ctx.data('applications', 'section', {app_id: app.id, name: 'Background Apply'}) || 'null'); } catch { return null; }
}

/**
 * Returns the first pair of stored queue records in preflight/filling at one poll, or null; only those states occupy a filling slot.
 * Why (30 Oct 2026, beta 41121393681): readyAt is re-stamped on a changed page (background-apply-store.js:64), so later ready reports cannot prove overlap.
 */
export function fillingPair(records) {
  const filling = records.filter(record => record?.state === 'preflight' || record?.state === 'filling');
  return filling.length > 1 ? filling.slice(0, 2) : null;
}

/**
 * The proof of several jobs queued at once in a hidden-browser mode (`mode` 'fill' = Background, 'auto' = Full automation, no wait): Start queues `jobs` (forms, distinct addresses); the person stops the second while
 * it is still queued. Every wait polls all stored states for two jobs filling at once. After the run: the stopped job was never launched and went to the person with reason `stopped`; the others launched in
 * queue order; Background sent nothing, Full automation pressed once per job that ran. `seed(job)` adds each job, `until(what, check, ms)` is the suite's state wait.
 */
export async function proveQueue(ctx, {jobs, mode, seed, until}) {
  const unlinked = linkRuntime(ctx.profile);
  if (unlinked) { if (process.platform === 'win32') { console.log(`  skipped here: ${unlinked}`); return; } throw new Error(unlinked); }
  await ctx.relaunch();   // Why (30 Oct 2026, #2596): a second proof in one app run never got a browser to poll; each proof starts the app fresh
  const {page, proxy, forms} = ctx;
  proxy.setCanned(withFormJudge(proxy.canned(), 'Submit Application'));
  for (const job of jobs) await seed(job);   // kitSeeder removes the suite's fixture jobs and adds one job: called per job, the queue jobs are not among the fixtures
  try {
    const chosenAt = new Date().toISOString(), posted = forms.posts.length;
    await page.evaluate(({kind, at}) => window.pilot.saveSettings({apply: {mode: kind, chosenAt: at, ...(kind === 'auto' ? {autoConfirmedAt: at, auto: {waitMin: 0}} : {})}}), {kind: mode, at: chosenAt});
    const started = await page.evaluate(count => window.pilot.apply({n: count, mode: 'settings'}), jobs.length);
    if (started?.ok === false) throw new Error(`the app refused to start the ${mode} mode: ${started.error}`);
    const ids = await Promise.all(jobs.map(job => sessionOf(page, job.url)));
    if (ids.some(id => !id) || started.sessions?.length !== jobs.length) throw new Error(`Start did not queue all ${jobs.length} jobs: ${JSON.stringify({sessions: started.sessions, ids})}`);
    const queued = started.sessions.map(id => jobs[ids.indexOf(id)]);   // the app's own queue order
    const stopped = queued[1], ran = queued.filter(job => job !== stopped);
    await page.evaluate(session => window.pilot.liveStop(session), ids[jobs.indexOf(stopped)]);
    let overlap = null;
    const waitForQueue = async (what, check, ms) => {
      await until(what, async () => {
        const records = await Promise.all(queued.map(job => recordOf(ctx, job.url)));
        overlap ||= fillingPair(records);
        return overlap || await check(records);   // settle the wait on a violation; report it outside the wait's retry handling
      }, ms);
      if (overlap) throw new Error(`two jobs filled at once: ${JSON.stringify(overlap.map(({session, state}) => ({session, state})))}`);
    };
    const done = async (job, records) => mode === 'fill' ? records[queued.indexOf(job)]?.state === 'ready_for_review' : (await stageOf(ctx, job.url)) === 'Applied';
    await waitForQueue('the stopped job never went to the person', records => HANDOFF.test(records[queued.indexOf(stopped)]?.state || ''), 60000);
    for (const job of ran) {
      await waitForQueue(`a queued job never ${mode === 'fill' ? 'reached Ready to review' : 'was pressed and became Applied'}: ${job.url}`, records => done(job, records), 120000)
        .catch(async error => { throw new Error(`${error.message} | ${await describeHidden(ctx.profile)} | states: ${JSON.stringify(await Promise.all(queued.map(item => recordOf(ctx, item.url).then(held => held?.state))))}`); });
    }
    const gone = await recordOf(ctx, stopped.url);
    if (gone?.reason !== 'stopped' || gone.launchedAt) throw new Error(`the stopped queued job should be handed over as "stopped" and never launched, the app recorded ${JSON.stringify({reason: gone?.reason, launchedAt: gone?.launchedAt})}`);
    const times = await Promise.all(ran.map(async job => ({job, held: await recordOf(ctx, job.url)})));
    for (const {job, held} of times) if (!held?.launchedAt || !held.readyAt) throw new Error(`the app recorded no launch and ready time for ${job.url}: ${JSON.stringify(held)}`);
    times.forEach(({held}, at) => {
      if (at && held.launchedAt < times[at - 1].held.launchedAt) throw new Error(`job ${at + 1} of the queue launched before job ${at}`);
    });
    const sent = forms.posts.length - posted;
    if (mode === 'fill' && sent) throw new Error(`Background automation sent ${sent} application(s) before the person pressed Submit`);
    if (mode === 'auto' && sent !== ran.length) throw new Error(`Full automation should press once per job that ran (${ran.length}), the endpoint saw ${sent}`);
  } finally {
    // Why (30 Oct 2026, #2596): Start takes the first eligible job and the suite's steps assume none is left; the person ends each job with "Skip this role".
    for (const job of jobs) await skipJob(page, job);
    await closeHiddenBrowser(ctx.profile);
  }
}
