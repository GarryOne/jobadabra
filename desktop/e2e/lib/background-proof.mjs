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
  if (left) await page.evaluate(session => window.pilot.sessionSkip(session), left).catch(() => {});
}

/** Opens this application's session on the Sessions page: the card a click on its dock card or list row opens (pages/session-log.js openSession), picked by the session's id.
 * Why (30 Oct 2026, found by the bot-check steps in CI order): every submitter variant has one company and one title, so a card found by those words opened an earlier job's card ("Review the filled application"). */
async function openSessionCard(page, form) {
  const id = await sessionOf(page, form.url);
  if (!id) throw new Error(`the app holds no session for ${form.url}`);
  await page.evaluate(session => import('./pages/session-log.js').then(module => module.openSession(session)), id);
}

/** One Runtime.evaluate over the debugging socket `socketUrl`: resolves its value, or null when the page never answers or cannot be read (4 s). Never throws. */
export const evaluateOn = (socketUrl, expression) => new Promise(done => {
  const socket = new WebSocket(socketUrl), end = value => { clearTimeout(timer); try { socket.close(); } catch { /* closed */ } done(value); }, timer = setTimeout(() => end(null), 4000);
  socket.onopen = () => socket.send(JSON.stringify({id: 1, method: 'Runtime.evaluate', params: {returnByValue: true, expression}}));
  socket.onmessage = event => end(JSON.parse(event.data).result?.result?.value ?? null);
  socket.onerror = () => end(null);
});

/** The debugging port of the hidden browser of `profile` (its DevToolsActivePort file); throws when it was never started. */
export const hiddenPort = profile => Number(fs.readFileSync(path.join(profile, 'background-browser', 'profile', 'DevToolsActivePort'), 'utf8').split('\n')[0]);

/** Every target the hidden browser of `profile` holds (pages and extension workers); throws when it is not running. */
export const hiddenTargets = async profile => (await fetch(`http://127.0.0.1:${hiddenPort(profile)}/json/list`, {signal: AbortSignal.timeout(3000)})).json();

/** The values of the inputs on the page behind `socketUrl`, for a failure message. */
const valuesOf = async socketUrl => String(await evaluateOn(socketUrl, "[...document.querySelectorAll('input,textarea,select')].map(item => (item.name || item.id) + '=' + (item.type === 'file' ? item.files.length + ' file(s) [file mark: ' + (item.getAttribute('data-jobpilotto-file') || 'none') + ']' : item.value) + ' [grounding: ' + (item.dataset.jobpilottoGrounding || 'none') + (item.hasAttribute('data-jobpilotto-guess') ? ', guess' : '') + ']').join(', ')") ?? '(no answer)').slice(0, 700);

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
 * The proof: Background automation saved as the mode; the app fills the fixture form in its hidden browser and reaches Ready to review without posting; the person's Submit
 * (liveSubmit, the app re-reads the page first) posts exactly once and the job becomes Applied. `until(what, check, ms)` is the suite's state wait.
 */
export async function proveBackground(ctx, {form, seed, until}) {
  const {page, proxy, forms} = ctx;
  const unlinked = linkRuntime(ctx.profile);
  if (unlinked) { if (process.platform === 'win32') { console.log(`  skipped here: ${unlinked}`); return; } throw new Error(unlinked); }
  proxy.setCanned(withFormJudge(proxy.canned(), 'Submit Application'));
  await seed();
  try {
    await page.evaluate(chosenAt => window.pilot.saveSettings({apply: {mode: 'fill', chosenAt}}), new Date().toISOString());
    const posted = forms.posts.length;
    const started = await page.evaluate(() => window.pilot.apply({n: 1, mode: 'settings'}));
    if (process.env.E2E_KEEP_HIDDEN === '1') for (const seconds of [6, 20]) setTimeout(() => describeHidden(ctx.profile).then(text => console.log(`  [${seconds}s after Start] ${text}`)), seconds * 1000);   // local debugging only: the hidden browser's state early, not only at the failure
    if (started?.ok === false) throw new Error(`the app refused to start Background automation: ${started.error}`);
    // The owner's scenario (28 Oct 2026 screenshot, "Filling the application" with a broken picture): the session is opened in the window while the fill runs, when the hidden form may not be open yet;
    // the live view must still end up showing the page (renderer/live-opener.js asks again on every redraw).
    await until('the application never got a session', async () => !!(await page.evaluate(target => window.pilot.sessions().then(list => list.find(item => String(item.url || '').replace(/\/$/, '') === target.replace(/\/$/, ''))?.id || ''), form.url)), 60000);
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
    const id = await page.evaluate(target => window.pilot.sessions().then(list => list.find(item => String(item.url || '').replace(/\/$/, '') === target.replace(/\/$/, ''))?.id || ''), form.url);
    if (!id) throw new Error('the filled application has no session to press Submit on');
    const sent = await page.evaluate(session => window.pilot.liveSubmit(session), id);
    if (!sent?.ok) throw new Error(`the person's Submit was refused: ${sent?.error}`);
    await until('the job never became Applied after the person submitted in the live view', async () => (await stageOf(ctx, form.url)) === 'Applied', 120000);
    if (forms.posts.length !== posted + 1) throw new Error(`expected the person's one Submit, the server saw ${forms.posts.length - posted}`);
  } finally { if (process.env.E2E_KEEP_HIDDEN !== '1') await closeHiddenBrowser(ctx.profile); }   // E2E_KEEP_HIDDEN=1: leave it running to probe by hand after a failure (local only)
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
      .catch(async error => { throw new Error(`${error.message} | ${await describeHidden(ctx.profile)} | state: ${(await backgroundOf(page, form.url))?.state || 'none'}`); });
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
