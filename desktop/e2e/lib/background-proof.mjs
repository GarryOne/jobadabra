/* global document, window */
// Job: wait on state. The end-to-end proof of Background automation (spec 2026-10-27-background-apply-execution, step B): the app's own hidden browser fills a fictional
// form, the person's Submit (liveSubmit, after the app re-reads the page) lands, the job becomes Applied. Only the fixture server and the proxy's stand-ins answer; every
// wait is on a state the app shows (the session's background state, the stage), the cap only catches a hang.
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright-core';
import {INSTRUCTIONS as FORM_JUDGE} from '../../lib/form-judge.js';
import {stageOf} from './seed-data.mjs';

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

/**
 * The form judge's stand-in (lib/form-judge.js, a model that reads the sketch): ready on a final step once no required control is listed empty, naming the one Submit button;
 * every other ask goes to `previous`, the suite's own stand-ins.
 */
export const withFormJudge = (previous, submitText) => body => {
  const system = typeof body?.system === 'string' ? body.system : (body?.system || []).map(part => part.text || '').join('');
  const content = body?.messages?.[0]?.content, text = typeof content === 'string' ? content : (content || []).map(part => part.text || '').join('');
  if (!system.startsWith(FORM_JUDGE)) return previous ? previous(body) : null;
  const empty = /· required · empty/.test(text);
  return JSON.stringify({answer: empty ? 'needs_person' : 'ready', blocked_kind: '', needs: '', needs_kind: '', step: 'final', next_control: '', submit_control: empty ? '' : submitText, confidence: 0.95});
};

/** The background state of the application of `url`, from the Sessions list (item.background, lib/background-apply-controller.js cache), or ''. */
export const backgroundStateOf = (page, url) => page.evaluate(target => window.pilot.sessions().then(list => (list.find(item => String(item.url || '').replace(/\/$/, '') === target.replace(/\/$/, ''))?.background?.state) || ''), url);

/** The values of the inputs on the page behind `socketUrl` (one Runtime.evaluate over its debugging port), for a failure message. */
const valuesOf = socketUrl => new Promise(done => {
  const socket = new WebSocket(socketUrl), end = text => { clearTimeout(timer); try { socket.close(); } catch { /* closed */ } done(text); }, timer = setTimeout(() => end('(no answer)'), 4000);
  socket.onopen = () => socket.send(JSON.stringify({id: 1, method: 'Runtime.evaluate', params: {returnByValue: true, expression: "[...document.querySelectorAll('input,textarea,select')].map(item => (item.name || item.id) + '=' + (item.type === 'file' ? item.files.length + ' file(s)' : item.value)).join(', ')"}}));
  socket.onmessage = event => end(String(JSON.parse(event.data).result?.result?.value ?? '(none)').slice(0, 300));
  socket.onerror = () => end('(unreadable)');
});

/** The console lines and exceptions the page behind `socketUrl` already holds (Runtime.enable replays them), for a failure message. */
const consoleOf = socketUrl => new Promise(done => {
  const lines = [], socket = new WebSocket(socketUrl), end = () => { clearTimeout(timer); try { socket.close(); } catch { /* closed */ } done(lines.slice(-8).join(' // ') || '(empty)'); }, timer = setTimeout(end, 2500);
  socket.onopen = () => { socket.send(JSON.stringify({id: 1, method: 'Runtime.enable'})); socket.send(JSON.stringify({id: 2, method: 'Log.enable'})); };
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.consoleAPICalled') lines.push(`${message.params.type}: ${(message.params.args || []).map(arg => arg.value ?? arg.description ?? '').join(' ')}`.slice(0, 200));
    if (message.method === 'Runtime.exceptionThrown') lines.push(`EXCEPTION: ${message.params.exceptionDetails?.exception?.description || message.params.exceptionDetails?.text}`.slice(0, 240));
    if (message.method === 'Log.entryAdded') lines.push(`log ${message.params.entry.level}: ${message.params.entry.text}`.slice(0, 200));
  };
  socket.onerror = end;
});

/** Asks the hidden browser's extension itself, from a page of its own (options.html): its permission for the form's site, what its storage holds, the tabs and the worker's session keys. */
async function askExtension(profile, port) {
  try {
    const prefs = JSON.parse(fs.readFileSync(path.join(profile, 'background-browser', 'profile', 'Default', 'Secure Preferences'), 'utf8'));
    const id = Object.entries(prefs.extensions?.settings || {}).find(([, item]) => String(item.path || '').endsWith(`${path.sep}background-browser${path.sep}extension`))?.[0];
    if (!id) return 'extension not in the profile';
    const {webSocketDebuggerUrl} = await (await fetch(`http://127.0.0.1:${port}/json/version`, {signal: AbortSignal.timeout(3000)})).json();
    return await new Promise(done => {
      const socket = new WebSocket(webSocketDebuggerUrl), waits = new Map();
      let counter = 0;
      const call = (method, params = {}, sessionId) => new Promise(resolve => { const n = ++counter; waits.set(n, resolve); socket.send(JSON.stringify({id: n, method, params, ...(sessionId ? {sessionId} : {})})); });
      const timer = setTimeout(() => done('(no answer from the extension)'), 8000);
      socket.onmessage = event => { const message = JSON.parse(event.data); if (message.id && waits.has(message.id)) { waits.get(message.id)(message); waits.delete(message.id); } };
      socket.onopen = async () => {
        const {result: {targetId}} = await call('Target.createTarget', {url: `chrome-extension://${id}/options.html`});
        const {result: {sessionId}} = await call('Target.attachToTarget', {targetId, flatten: true});
        await new Promise(next => setTimeout(next, 800));
        const run = async expression => { const reply = (await call('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true}, sessionId)).result; const value = reply?.result?.value; return value === undefined ? `(${String(reply?.exceptionDetails?.exception?.description).slice(0, 100)})` : typeof value === 'string' ? value : JSON.stringify(value); };
        const answer = await run(`(async () => { const local = await chrome.storage.local.get(null), session = await chrome.storage.session.get(null), tabs = await chrome.tabs.query({});
          return JSON.stringify({page: location.protocol, siteAllowed: await chrome.permissions.contains({origins: ['https://e2e.recruitee.com/*']}), localKeys: Object.keys(local), owner: !!local.backgroundOwner, worker: String(local.workerUrl || ''),
            sessionKeys: Object.keys(session).slice(0, 14), tabs: tabs.map(item => item.url.slice(0, 60))}); })()`);
        await call('Target.closeTarget', {targetId}); clearTimeout(timer); socket.close(); done(answer);
      };
      socket.onerror = () => done('(unreadable)');
    });
  } catch (error) { return `(${String(error?.message || error).slice(0, 80)})`; }
}

/** What the hidden browser of `profile` holds right now (its tabs and extension workers, its folder), for a failure message. Never throws. */
export async function describeHidden(profile) {
  const folder = path.join(profile, 'background-browser');
  try {
    const port = Number(fs.readFileSync(path.join(folder, 'profile', 'DevToolsActivePort'), 'utf8').split('\n')[0]);
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`, {signal: AbortSignal.timeout(3000)})).json();
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
    const port = Number(fs.readFileSync(path.join(profile, 'background-browser', 'profile', 'DevToolsActivePort'), 'utf8').split('\n')[0]);
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
    const card = page.locator('#sd-cards .sd-card').filter({hasText: form.company}).first();
    if (await card.count()) {
      if (!await card.isVisible() && await page.locator('#sd-toggle').isVisible()) await page.click('#sd-toggle');
      await card.click();
    } else {
      await page.click('.nav[data-view="sessions"]');
      await page.locator('.view[data-view="sessions"]').getByText(form.company).first().click({timeout: 15000});
    }
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
