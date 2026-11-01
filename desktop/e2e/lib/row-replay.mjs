/* global document, history, PopStateEvent, window */
// One pool row replayed offline on the app's own path (speed-5x landing 2, owner 11 Oct 2026): the row's saved journey (every page and frame under its own address,
// its stylesheets from styles.har.json) served to the real extension in one browser, the extension talking to the app's own server under plain node
// (lib/offline-app.mjs: the fake applicant, the row's model answers from model-memo.json, a miss asks the plan's claude -p once and is kept). Nothing reaches a site:
// an address the run did not record gets a 404 and a finding "route not recorded: <address>". Ends on the live run's still-clock and prints the same evidence lines.
// -> {seconds, evidence, unrecorded, asks, coldAsks, requests}. CLI: row.mjs (npm run row). Guard: e2e/test/row-replay.test.mjs.
// Job: serve stored answers
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {evidenceLines} from './evidence-bundle.mjs';
import {nextRunnable} from './replay-browser.mjs';
import {PAGE_LINE, quietSeconds, stillClock} from './live-still.mjs';
import {bindToEvents, followDelayMs, keptPresses, laterStates, replayPresses, samePress, stateAfter, swapInPage} from './row-follow.mjs';
import {frontOf} from './app-front.mjs';
import {activityOf, mayEnd} from './row-end.mjs';
import {applyPoolEligibility} from './pool-eligibility.mjs';
import {CONTACT} from './apply-fixtures.mjs';
import {startOfflineApp} from './offline-app.mjs';
import {startRealExtension} from './real-extension.mjs';
import {forceScrollbar} from './scrollbar.mjs';
import {shotTab} from './end-shot.mjs';
import {kindFromLog, stepShooter} from './step-shots.mjs';
import {extensionWorker} from './own-worker.mjs';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
// The live harness's window (lib/extension.mjs: viewport null under --headless=new), measured on 11 Oct 2026: for a capture made before it recorded its own (journey view).
const LIVE_WINDOW = {width: 1200, height: 818};
// The memo's own miss log (lib/ai/model-memo.js missLogFile, one JSON line per miss, whole: the app's log line is cut at its length and a part list read from it came out as "use) {"):
// -> {parts: [the parts that differ from the nearest kept ask, without repeats], volatile: [the parts carrying a clock time or a date]}
export function missesOf(file) {
  let lines = [];
  try { lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)); } catch { /* no miss, or no file */ }
  return {parts: [...new Set(lines.flatMap(line => line.differs || []))], volatile: [...new Set(lines.flatMap(line => line.volatile || []))]};
}
// Each loose memo hit the app noted (lib/ai/model-memo.js): [{differs: [part, ...]}].
const looseHitsOf = file => { try { return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)); } catch { return []; } };
// The text boxes of the page the replay ends on (every frame of the row's tab): {label: 'filled' | 'empty'} by the label a person sees, never the value. A page that autofilled after the CV
// upload emptied the boxes the extension typed; a build that retypes them ends with them filled (fix 2f6a91e), one that does not, empty.
/* global document */
export async function boxesOf(tab) {
  const read = () => [...document.querySelectorAll('input, textarea')].filter(el => el.getClientRects().length && !el.closest('[id^=jobpilotto], [id^=job-pilotto]') && !/^(hidden|file|submit|button|image|reset|checkbox|radio|password)$/i.test(el.type || '')).map(el => {
    const label = (el.labels?.[0]?.innerText || el.getAttribute('aria-label') || el.placeholder || el.name || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    return label ? [label, el.value.trim() ? 'filled' : 'empty'] : null;
  }).filter(Boolean);
  const boxes = {};
  for (const frame of tab.frames()) for (const [label, state] of await frame.evaluate(read).catch(() => [])) boxes[label] = boxes[label] === 'filled' ? 'filled' : state;
  return boxes;
}
export const addressOf = url => String(url).replace(/[?#].*$/, '').replace(/\/$/, '');
const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };

// The row's recorded files -> {start, documents: Map(address -> html of its first state), sheets: Map(address -> css), states: the main page's states in order
// [{url, at, state, html}], presses: the live run's presses (presses.json)}.
export function rowFiles(caseDir) {
  const item = readJson(path.join(caseDir, 'case.json'), null);
  if (!item?.pages?.length) throw new Error(`no recorded pages in ${caseDir}/case.json`);
  const html = page => fs.readFileSync(path.join(caseDir, page.file), 'utf8'), documents = new Map();
  // First as the extension saw a page when it asked (the capture's ask state), else the first state kept.
  for (const page of [...item.pages.filter(one => one.ask), ...item.pages]) if (!documents.has(addressOf(page.url))) documents.set(addressOf(page.url), html(page));
  const states = item.pages.filter(page => !page.frameOf && page.at != null).map(page => ({url: addressOf(page.url), href: String(page.url), at: page.at, state: page.state || 0, ask: !!page.ask, view: page.view || null, html: html(page)})).sort((a, b) => a.at - b.at);
  const entries = readJson(path.join(caseDir, 'styles.har.json'), {log: {entries: []}}).log?.entries || [];
  const sheets = new Map(entries.map(entry => [addressOf(entry.request.url), entry.response?.content?.text || '']));
  return {start: item.pages.find(page => !page.frameOf) || item.pages[0], documents, sheets, states, presses: keptPresses(readJson(path.join(caseDir, 'presses.json'), []), states[0]?.at ?? null), popups: readJson(path.join(caseDir, 'presses.json'), []).filter(press => press.what === 'closed a popup').map(press => ({at: press.at, label: String(press.label || '')})), asks: Array.isArray(item.asks) ? item.asks : readJson(path.join(caseDir, 'ai-calls.json'), []).map(call => ({route: String(call.route), at: call.at})).filter(call => Number.isFinite(call.at)).sort((a, b) => a.at - b.at)};   // a built case keeps them in case.json; a pool candidate has ai-calls.json
}

// A capture made before the replay format (11 Oct 2026: no page state carries its window size or the extension's ask) replays without the live run's states,
// presses or matching AI answers, so it would mislead: it is named, with what to do, instead of replayed. -> the reason, or '' (current).
export function staleCapture(caseDir) {
  const item = readJson(path.join(caseDir, 'case.json'), null);
  const current = (item?.pages || []).some(page => !page.frameOf && (page.view || page.ask));
  return current ? '' : `this row's capture predates the replay format (no per-page states, presses or window size): capture it once with npm run record-sites -- --only "<row>" (or npm run live -- <posting url>) and replay again`;
}

// A pool row by its case folder, or by its name (as smoke prints it): the newest day's candidate whose folder name holds it. -> the folder, or ''.
export function findRow(name, root) {
  if (fs.existsSync(path.join(name, 'case.json'))) return path.resolve(name);
  const want = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  let days = [];
  try { days = fs.readdirSync(root).filter(day => /^\d{4}-\d\d-\d\d$/.test(day)).sort().reverse(); } catch { return ''; }
  for (const day of days) {
    const hit = fs.readdirSync(path.join(root, day)).find(folder => folder.includes(want) && fs.existsSync(path.join(root, day, folder, 'case.json')));
    if (hit) return path.join(root, day, hit);
  }
  return '';
}

// The one place the browser comes from: the real extension built for the front at `port` (lib/real-extension.mjs appPort: no stub of its own), any site allowed,
// offline (nothing but this computer resolves). -> {context, page, close}.
export const openBrowser = ({extensionDir, port}) => startRealExtension({extensionDir, appPort: port, allowAllSites: true, offline: true});

// One offline app, front and browser for one or more rows (their kept model answers merged: a key is a hash of the ask). -> {use(caseDir), replay(caseDir, opts), close()}
export async function openReplay(caseDirs, {extensionDir, ask = false, loose = false, slow = false, ordinal = false} = {}) {   // ordinal: CI's row cases: an ask with no kept answer gets the n-th kept answer of its kind (model-memo.js), counted and warned; slow: the second speed of the row-to-case gate: CPU x4 in the tab, answers x1.6 + 0.3 s, the site's reaction times x1.6   // loose: kept answers also serve an ask whose system side changed since the capture (CI row cases; every hit counted)   // ask: a model call not in the kept answers goes to the plan's claude -p once and is kept (row-to-case --ask-cold)
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-row-'));
  const memo = path.join(workDir, 'model-memo.json');   // a copy: each row's own answers stay as the live run kept them
  const merged = Object.assign({}, ...caseDirs.map(dir => readJson(path.join(dir, 'model-memo.json'), {})));
  fs.writeFileSync(memo, JSON.stringify(merged));
  const ordinalHits = ordinal ? path.join(workDir, 'ordinal-hits.jsonl') : '';
  const looseHits = loose ? path.join(workDir, 'loose-hits.jsonl') : '', missLog = path.join(workDir, 'miss-log.jsonl');
  const app = await startOfflineApp({memo, ask, loose: looseHits, missLog, slow, ordinal: ordinalHits, dir: path.join(workDir, 'app')});
  // The applicant's contact exactly as the live row set it (live-row.mjs: saveContact(CONTACT)): the profile in every form-answer ask carries it, and its lines (name, phone, e-mail, links) are part of
  // the memo key; with the stand-in contact the whole ask missed its kept answer (12 Oct 2026, Ashby: profile lines 30-37 differed, found by the memo's line hashes).
  await app.call('saveContact', CONTACT);
  const front = await frontOf(app);
  // A page state that followed a model ask in the live run (row-follow.mjs bindToEvents) is played in BEFORE that ask's answer goes back: the extension's next step then sees the page as it did live, however fast this
  // machine answers. The ask is the row's n-th on its route; a row side by side with others is found by its hosts in the request.
  front.beforeRespond = async (route, body) => {
    const row = [...active].find(one => active.size === 1 || [...one.hosts].some(host => body.includes(host)));
    if (!row?.bound?.length || !row.tab) return;
    const n = row.countRoute(route);
    for (const hit of row.bound.filter(item => item.kind === 'ask' && item.route === route && item.n === n && !item.done)) { hit.done = true; await advance(row, row.tab, hit.state, `ask ${route} #${n} answered`, 0); }
  };
  const run = await openBrowser({extensionDir, port: front.port});
  // The eligibility stop is OFF, as in the live pool row that made the capture (lib/pool-eligibility.mjs, cbf5ccc): with it on, a French posting stopped the fill before any field (12 Oct 2026, Ashby), so a fix
  // that acts on the fields could never show. Set through the extension's own switch before the tab opens, and read back.
  await applyPoolEligibility(await extensionWorker(run.context), {env: {LIVE_ELIGIBILITY: 'off'}});
  // Rows replay side by side, one tab each; rows that share a host never run together (replayRows), so an address, a request or a log line names its row by host.
  const rows = new Map(), active = new Set();   // page -> its row; the rows running now
  const rowOf = page => rows.get(page) || [...active].find(row => row.hosts.has(new URL(page.url() || 'about:blank').host)) || null;
  run.context.on('page', page => { const opener = rows.get(page.opener?.() || null); if (opener) rows.set(page, opener); });   // a tab a row's page opened is that row's
  // The live run's next state, played into the tab: the page's own script, a route it changed, or a new document (after a press, or after the extension attached a file).
  const advance = async (row, page, next, why, delayMs = 150) => {   // delayMs: the site's own reaction time (a press: at once; an attach: the live gap, row-follow.mjs followDelayMs)
    await new Promise(resolve => setTimeout(resolve, slow ? delayMs * 1.6 : delayMs));
    if (Number.isFinite(row.shownAt) && next.at < row.shownAt) return;   // never back to an OLDER state of the live run: a later one (bound to an ask) may already be on the page, and it holds what the older one changed
    row.shownAt = next.at;
    row.documents.set(next.url, next.html); row.pageStates.set(next.url, next.html);
    const was = row.states[row.states.indexOf(next) - 1], sameDocument = next.view?.doc && was?.view?.doc ? next.view.doc === was.view.doc : new URL(next.url).host === new URL(page.url()).host;
    if (addressOf(page.url()) === next.url) await page.evaluate(swapInPage, next.html).catch(() => {});
    else if (sameDocument) await page.evaluate(url => { history.pushState({}, '', url); window.dispatchEvent(new PopStateEvent('popstate')); }, next.href || next.url).then(() => page.evaluate(swapInPage, next.html)).catch(() => {});   // a single-page app's route
    else {   // a new document: followed as the site did (a link inside the page), never typed into the address bar (the extension would read that as the person leaving)
      await Promise.all([page.waitForNavigation({waitUntil: 'domcontentloaded', timeout: 15000}).catch(() => {}),
        page.evaluate(url => { const link = Object.assign(document.createElement('a'), {href: url}); document.body.append(link); link.click(); }, next.href || next.url).catch(() => {})]);
    }
    row.say?.(`row: ${row.name}: ${why}: the live run's next state (${next.url}, state ${next.state})`);
  };
  // The site reacts at the click, not when the extension's log arrives (batched: 11 Oct 2026, the page moved after the extension's after-press watch had ended): a
  // click on a control the live run pressed next moves the page to the live run's next state at once (lib/row-follow.mjs).
  const norm = text => String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
  await run.context.exposeBinding('__jpReplayPressed', async ({page}, label) => {
    const row = rowOf(page), k = row?.applied, live = row?.presses[k];
    const popup = row?.popups?.[row.popupsSeen];   // a popup close is no press of the journey (row-follow.mjs keptPresses), but the page changes on it: the banner is hidden
    if (popup && norm(label) === norm(popup.label)) {
      row.popupsSeen += 1;
      for (const hit of row.bound.filter(item => item.kind === 'popup' && item.k === row.popupsSeen - 1 && !item.done)) { hit.done = true; await advance(row, page, hit.state, `popup "${label}" closed`, 0); }   // at once: measured on the Lever capture (0 s: 1 ask misses; 2 s: 4): the extension's page-kind and form-answer asks go out ~1 s apart here, seconds apart live, so no delay fits both (the interleaving of its concurrent flows, not the page)
      return;
    }
    if (!live || norm(label) !== norm(live.label)) return;
    row.applied += 1;
    row.later = laterStates(row.states, row.presses, k);   // what the page does on its own after this press: one state per attach (below)
    const next = stateAfter(row.states, row.presses, k);
    if (next) await advance(row, page, next, `press ${k + 1} "${label}" as live`);
  });
  // The extension attached a file (the CV): the site's own script reacts as it did live (an upload that autofills the form and empties the boxes the extension typed), so the page moves to the live
  // run's next state of that segment. Not from a press, so a row with 0 presses follows too.
  await run.context.exposeBinding('__jpReplayAttached', async ({page}) => {
    const row = rowOf(page), next = row?.later?.shift();
    if (next) await advance(row, page, next, 'the extension attached a file', followDelayMs(row.states[row.states.indexOf(next) - 1], next));
  });
  await run.context.addInitScript(() => document.addEventListener('change', event => { if (event.target?.type === 'file' && event.target.files?.length) window.__jpReplayAttached?.(); }, true));
  await run.context.addInitScript(() => document.addEventListener('click', event => {
    const control = event.target?.closest?.('button, a, [role=button], input[type=submit], input[type=button]');
    if (control) window.__jpReplayPressed?.((control.innerText || control.value || control.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 80));
  }, true));
  // One catch-all route before any page loads (a route added while a tab loads let a request out, 11 Oct 2026); this computer's calls pass.
  await run.context.route('**/*', route => {
    const url = route.request().url(), key = addressOf(url);
    if (/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) return route.continue();
    const owner = [...active].find(row => row.documents.has(key) || row.sheets.has(key));
    // The tab itself loading an address the live run saw as a page of its own (a form frame opened in the tab): that page's state, not its frame snapshot.
    const asPage = owner && route.request().resourceType() === 'document' && !route.request().frame()?.parentFrame() && owner.pageStates.get(key);
    if (asPage) return route.fulfill({status: 200, contentType: 'text/html; charset=utf-8', body: asPage});
    if (owner?.documents.has(key)) return route.fulfill({status: 200, contentType: 'text/html; charset=utf-8', body: owner.documents.get(key)});
    if (owner) return route.fulfill({status: 200, contentType: 'text/css', body: owner.sheets.get(key)});
    if (['document', 'stylesheet'].includes(route.request().resourceType())) { const page = route.request().frame()?.page(); (rows.get(page) || [...active][0])?.unrecorded.add(key); }
    return route.fulfill({status: 404, body: ''});
  });
  let blank = run.page;   // the browser's first, empty tab: closed once a row has its own, so the extension counts the tabs the live run had
  const close = async () => { await run.close().catch(() => {}); await front.close().catch(() => {}); await app.close().catch(() => {}); };
  const replay = async (caseDir, {stillSeconds = 10, capSeconds = 90, say = () => {}, alone = true, shotName = 'end-replay.png', shotDir = ''} = {}) => {   // alone: no other row runs beside it (nothing to attribute)
    const started = Date.now(), files = rowFiles(caseDir), {start, states, presses} = files;
    const hosts = new Set([...files.documents.keys()].map(url => new URL(url).host)), name = path.basename(caseDir);
    const pageStates = new Map();   // address -> the first state the live run kept of it as the tab's own page
    for (const state of [...states.filter(one => one.ask), ...states]) if (!pageStates.has(state.url)) pageStates.set(state.url, state.html);
    const timeline = [];   // what happened when, from this replay's start: the page's swaps (here) and the extension's own log lines (below): all CI keeps of a failed replay (12 Oct 2026: a case flaked and nothing said why)
    const split = bindToEvents(laterStates(states, presses, -1), {asks: files.asks, popups: files.popups});
    const row = {name, documents: files.documents, sheets: files.sheets, pageStates, unrecorded: new Set(), states, presses, applied: 0, later: split.free, bound: split.bound, popups: files.popups, popupsSeen: 0, hosts,
      say: line => { say(line); timeline.push({ms: Date.now() - started, text: String(line).replace(/^row: [^:]+: /, '')}); }};
    const mine = text => alone || [...hosts].some(host => String(text).includes(host));
    const fromRequest = front.requests.length, fromLog = app.logText().length;
    const requests = () => front.requests.slice(fromRequest).filter(request => mine(request.body));
    const log = () => app.logText().slice(fromLog).split('\n').filter(mine).join('\n');
    active.add(row);
    const tab = await run.context.newPage();
    if (slow) await (await run.context.newCDPSession(tab)).send('Emulation.setCPUThrottlingRate', {rate: 4}).catch(() => {});   // a slower machine: the page's own timers and the extension's page script run behind
    rows.set(tab, row);
    row.tab = tab; row.countRoute = route => requests().filter(request => request.route === route).length;
    if (blank) { await blank.close().catch(() => {}); blank = null; }
    try {
      const view = states[0]?.view?.width ? states[0].view : LIVE_WINDOW;
      await tab.setViewportSize({width: view.width, height: view.height}).catch(() => {});
      if (await forceScrollbar(tab, states[0]?.view?.scrollbar)) say(`row: ${name}: the live page's scrollbar forced: ${states[0].view.scrollbar} px (lib/scrollbar.mjs)`);   // the live run's window size (a frame's size is in the AI's sketch)
      say(`row: ${name}: ${row.documents.size} pages, ${row.sheets.size} stylesheets, ${presses.length} live presses`);
      await tab.goto(`${start.url.replace(/#.*$/, '')}#jobpilotto-fill`, {waitUntil: 'domcontentloaded'}).catch(() => {});
      const clock = stillClock({seconds: stillSeconds, startedAt: Date.now()});
      const steps = stepShooter({tabOf: () => tab, kindOf: () => kindFromLog(log()), dir: shotDir || caseDir, prefix: 'replay-step'});   // one full-page picture per recorded state the replay reaches, beside end-replay.png
      let followed = 0, divergence = '', firstMissMs = null, endedBy = 'cap';
      while (Date.now() - started < capSeconds * 1000 && !divergence) {
        // Each press the replay made, against the live run's (lib/row-follow.mjs); the click handler above moved the page.
        const pressed = replayPresses(requests(), alone ? null : hosts);
        for (; followed < pressed.length && !divergence; followed++) {
          const check = samePress(pressed[followed], presses[followed], followed);
          if (!check.same) divergence = check.finding;
        }
        clock.see(JSON.stringify([activityOf(requests()), log().split('\n').filter(line => PAGE_LINE.test(line)).length, [...rows.values()].filter(one => one === row).length]), Date.now());
        if (firstMissMs == null && /not in the row's kept answers/.test(log())) firstMissMs = Date.now();
        const why = mayEnd({quietMs: clock.stillFor(Date.now()), stillMs: quietSeconds(stillSeconds, log()) * 1000, followed, livePresses: presses.length, firstMissMs, nowMs: Date.now()});
        if (why) { endedBy = why; break; }
        await steps.tick();
        await wait(500);
      }
      const boxes = await boxesOf(tab);
      const endShot = await shotTab(tab, path.join(shotDir || caseDir, shotName));   // where the replay ended, beside the live run's end.png (local only). shotDir: a tool that copies caseDir elsewhere (row-to-case's staging copy) names another folder so the picture never travels with it; never throws, never part of the result's signature
      for (const request of requests().filter(one => one.route === '/extension/log')) { try { for (const entry of JSON.parse(request.body).entries || []) if (/typed|again|attach|upload|empt|retype|fill|page kind|pressed|closed/i.test(String(entry.text))) timeline.push({ms: Date.parse(entry.at) - started, text: `ext: ${String(entry.text).slice(0, 90)}`}); } catch { /* a body cut at the limit */ } }
      return {row: name, boxes, endShot, stepShots: steps.files(), stepNotes: steps.notes(), timeline: timeline.filter(item => Number.isFinite(item.ms)).sort((a, b) => a.ms - b.ms).slice(0, 40).map(item => `+${(item.ms / 1000).toFixed(1)}s ${item.text}`), seconds: Math.round((Date.now() - started) / 100) / 10, evidence: evidenceLines(log()), unrecorded: [...row.unrecorded], followed: Math.min(followed, row.applied),
        divergence, endedBy, livePresses: presses.length, asks: requests().filter(request => request.route === '/extension/page-kind').length,
        misses: (log().match(/not in the row's kept answers/g) || []).length, missParts: missesOf(missLog).parts, missVolatile: missesOf(missLog).volatile, requests: requests(), appLog: log()};
    } finally {
      active.delete(row);
      for (const [page, owner] of [...rows]) if (owner === row) { rows.delete(page); await page.close().catch(() => {}); }
    }
  };
  return {replay, close, keptAnswers: Object.keys(merged).length, memoNow: () => readJson(memo, {}), looseNow: () => looseHitsOf(looseHits), ordinalNow: () => looseHitsOf(ordinalHits), missesNow: () => missesOf(missLog)};
}

export async function replayRow(caseDir, {extensionDir, ask = false, loose = false, slow = false, ordinal = false, ...options} = {}) {
  const session = await openReplay([caseDir], {extensionDir, ask, loose, slow, ordinal});
  try { const result = {...(await session.replay(caseDir, options)), looseHits: session.looseNow(), ordinalHits: session.ordinalNow()}; return ask ? {...result, memoAfter: session.memoNow()} : result; } finally { await session.close(); }
}

// Every row in one browser and one app, `tabs` at a time; rows that share a host wait for each other (replay-browser.mjs nextRunnable). -> [result] in the rows' order
export async function replayRows(caseDirs, {extensionDir, tabs = 4, ...options} = {}) {
  const session = await openReplay(caseDirs, {extensionDir}), results = new Map(), running = new Map();   // dir -> its hosts
  const queue = caseDirs.map(dir => ({dir, pages: [...rowFiles(dir).documents.keys()].map(url => ({url}))}));
  try {
    await new Promise(resolve => {
      const next = () => {
        if (!queue.length && !running.size) return resolve();
        while (running.size < tabs && queue.length) {
          const at = nextRunnable(queue, new Set([...running.values()].flat()));
          if (at < 0) break;
          const [item] = queue.splice(at, 1);
          running.set(item.dir, item.pages.map(page => new URL(page.url).host));
          session.replay(item.dir, {...options, alone: tabs === 1}).catch(error => ({row: path.basename(item.dir), error: String(error?.message || error)}))
            .then(result => { results.set(item.dir, result); running.delete(item.dir); next(); });
        }
      };
      next();
    });
    // A press line may name no host ("closed a popup"): a row that diverged beside others is re-run alone before its result counts (as replay-browser.mjs does for told/notTold).
    for (const dir of caseDirs) if (tabs > 1 && results.get(dir)?.divergence) results.set(dir, {...await session.replay(dir, {...options, alone: true}), rerunAlone: true});
  } finally { await session.close(); }
  return caseDirs.map(dir => results.get(dir));
}
