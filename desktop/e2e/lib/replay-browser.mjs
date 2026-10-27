// One browser with the real extension and N tabs at once for offline page replays (the journey gate's recorded cases; row replay builds on the same pool).
// Owns: the single catch-all route (registered before any tab navigates), the per-host AI answers, which requests and tabs belong to which case, and the scheduler.
// Guards: e2e/test/replay-browser.test.mjs (attribution, host overlap), e2e/test/recorded-pages.test.mjs (every case).
// A case's pages are served at their real addresses; every other address is a 404 and, besides that, resolves to nothing (real-extension.mjs offline: true).
// Isolation between tabs: told/asked/judged count only requests whose body names the case's host, notTold counts the case's own lines and the ones no case's host names (a line of another case's host is not its tab's; a failure in parallel is run again alone by the caller), and two cases that share a host never run at the same time (their pages, and the extension's per-host state, would meet).
import {startRealExtension} from './real-extension.mjs';
import {fillSeconds} from './replay-time.mjs';
import {syntheticNavigation, routeSyntheticNavigation} from './synthetic-navigation.mjs';
import {answerFor, answerPage, caseDelays, contactOf, caseFiles, caseHosts, caseStatuses, fillSettled, isExtensionPage, judgeCase} from './page-replay.mjs';

const hostOfUrl = url => { try { return new URL(url).host; } catch { return ''; } };
const hostOf = text => { try { return new URL(JSON.parse(text).url).host; } catch { return ''; } };

// A request that names no url but lists titles (pick-upload) belongs to a stub only when the stub's own answer is one of those titles: a stub's pick for another page's slots is not an answer
// for this one (4 upload cases in one browser, #1267: the import case's pick became the CV choice of the motivation-letter case, whose CV slot then got no file).
const claims = (state, route, sent) => {
  let titles; try { titles = JSON.parse(sent || '{}').titles; } catch { return true; }
  const picked = state.item?.ai?.[route]?.title;
  return !Array.isArray(titles) || typeof picked !== 'string' || titles.includes(picked);
};
// Which of the live cases a request is for: the host of the url it names, else the first live case that answers that route and claims it (a request with no url: the case is unknown).
export function caseForRequest(live, route, sent) {
  const host = hostOf(sent);
  return live.find(state => state.hosts.includes(host)) || live.find(state => state.answer[route] && claims(state, route, sent));
}

// The applicant details of the live case whose host the page's address names; null: the harness default (a case with no `contact`, or an address no live case owns).
export const contactForUrl = (live, url) => contactOf(live.find(state => state.hosts.includes(hostOfUrl(url)))?.item || {});

// The tab at the end of a new tab's opener chain (the case tab that, through its popups, opened it); undefined: no opener known, so it cannot be placed by who opened it.
export function openerRoot(entries, entry) {
  for (let step = 0, now = entry; now && step < 6; step += 1) {
    if (!now.opener) return undefined;
    const parent = entries.find(one => one.page === now.opener);
    if (!parent) return now.opener;
    now = parent;
  }
  return undefined;
}

// The tabs a page (or one of its popups) opens: the page tells us at once, before a quick close can lose the opener (page.opener() on a closed tab is null). -> Set, filled as they open.
export function trackPopups(tab) {
  const popups = new Set(), adopt = open => { popups.add(open); open.on('popup', adopt); };
  tab.on('popup', adopt);
  return popups;
}

// The cases that may start now, given the hosts of the ones running: in order, skipping a case whose host is taken (it waits for that tab to finish).
export function nextRunnable(queue, runningHosts) {
  const index = queue.findIndex(item => !caseHosts(item).some(host => runningHosts.has(host)));
  return index;
}

// -> {run, live, serve, close}: one browser, the stand-in answering by case. items: every case that may run in it (their AI routes are known up front).
export async function startReplayBrowser(items, {extensionDir, appPort = 0, cdp = false} = {}) {   // appPort: the caller's own stand-in app (row replay); then the AI answers and the request lists below are the caller's
  const live = [];   // states of the cases running now: {item, hosts, answer, from, tabs: Set, opened: [pages], shared}
  const allHosts = [...new Set(items.flatMap(caseHosts))];   // a request that names none of them could belong to any tab
  const routes = [...new Set(items.flatMap(item => Object.keys(item.ai || {})))];
  const answer = Object.fromEntries(routes.map(route => [route, sent => { const state = caseForRequest(live, route, sent); return state?.answer[route] ? state.answer[route](sent) : {}; }]));
  const run = await startRealExtension({extensionDir, cv: items.some(item => item.cv !== false), allowAllSites: true, answer, offline: true, appPort, cdp, contactFor: query => contactForUrl(live, query.get('url'))});   // each tab's own applicant details (a case's `contact`: its phone), asked by the page's address
  const files = new Map(), statuses = new Map(), delays = new Map(), redirects = new Map();   // pathKey -> each live case's response; a synthetic redirect is consumed once
  await run.context.route('**/*', route => {   // ONE route for the browser, before any tab navigates: a route added while another tab loads let a request out (example.ch, 11 Oct 2026)
    const url = route.request().url(), host = new URL(url).hostname;
    if (host === '127.0.0.1' || host === 'localhost') return route.continue();
    return answerPage(route, files, statuses, delays, redirects);
  });
  const everyOpened = [];   // [{page, at}] every non-extension tab opened since the browser started
  run.context.on('page', open => {
    if (isExtensionPage(open)) return;
    const entry = {page: open, at: Date.now(), opener: undefined};   // opener: the tab that opened it (null: none; undefined: not known yet)
    everyOpened.push(entry);
    open.opener().then(from => { entry.opener = from; }, () => { entry.opener = null; });
  });
  const rootOf = entry => openerRoot(everyOpened, entry);

  // One case in its own tab: -> {name, ok, failures, seen}.
  async function runInTab(item) {
    const navigation = syntheticNavigation(item);
    const hosts = caseHosts(item), others = live.length;
    const state = {item, hosts, answer: answerFor(item), from: Date.now(), tabs: new Set(), shared: others > 0};
    if (others) for (const one of live) one.shared = true;
    for (const [key, html] of caseFiles(item)) files.set(key, html);
    for (const [key, list] of caseStatuses(item)) statuses.set(key, list);
    for (const [key, ms] of caseDelays(item)) delays.set(key, ms);
    for (const [key, target] of navigation.redirects) redirects.set(key, target);
    live.push(state);
    const first = run.requests.length, began = Date.now(), tab = await run.context.newPage();
    const strict = () => run.requests.slice(first).filter(request => hosts.some(host => request.body.includes(host)));
    const loose = () => run.requests.slice(first).filter(request => hosts.some(host => request.body.includes(host)) || !allHosts.some(host => request.body.includes(host)));   // the case's own, and lines no case's host names (the extension's log lines often carry no host)
    const popups = trackPopups(tab);
    const theTabs = () => {   // the tabs opened since this case began (not its own), told apart by who opened them; alone, every tab is the case's
      const ours = [], unplaced = [];
      for (const one of everyOpened.filter(entry => entry.page !== tab && entry.at >= state.from)) {
        const root = state.shared === false ? tab : rootOf(one);
        if (root === tab || popups.has(one.page) || (root === undefined && hosts.some(host => one.page.url().includes(host)))) ours.push(one);
        else if (root === undefined && !allHosts.some(host => one.page.url().includes(host))) unplaced.push(one);   // opened by nobody we know, at an address of no case: it could be this case's
      }
      return {ours, unplaced};
    };
    const ours = open => !isExtensionPage(open) && open !== run.page && (open === tab || state.shared === false || hosts.some(host => open.url().includes(host)) || !/^https?:/.test(open.url()));   // alone: every tab is the case's
    try {
      await routeSyntheticNavigation(run.context, tab, item, route => answerPage(route, files, statuses, delays, redirects));
      await tab.goto(`${navigation.startUrl}#jobpilotto-fill`, {waitUntil: 'domcontentloaded'});
      const result = await judgeCase(item, {run, page: tab, pages: () => run.context.pages().filter(ours), mine: () => (state.shared ? loose() : run.requests.slice(first)), strict: state.shared ? strict : null, otherHosts: state.shared ? allHosts.filter(host => !hosts.includes(host)) : null,
        every: () => run.requests.slice(first), all: () => (state.shared ? loose() : run.requests.slice(first)), opened: () => theTabs().ours.length, unplacedTabs: () => theTabs().unplaced.length});   // the case's own tab is not one it opened (solo: the first tab, opened before the count starts)
      return {name: item.name, ...result, seconds: (Date.now() - began) / 1000, fillTime: () => fillSeconds(run.requests.slice(first), hosts)};   // read after the tab settled (lib/replay-time.mjs)
    } finally {
      await fillSettled(tab);   // a fill still running reports its moves before the tab goes (page-replay.mjs)
      live.splice(live.indexOf(state), 1);
      for (const key of caseFiles(item).keys()) { files.delete(key); statuses.delete(key); redirects.delete(key); }
      await Promise.all(run.context.pages().filter(open => open !== run.page && !isExtensionPage(open) && (open === tab || hosts.some(host => open.url().includes(host)))).map(open => open.close().catch(() => {})));
    }
  }
  return {run, live, runInTab, close: () => run.close()};
}

// Every case in one browser, `tabs` at a time. -> results in the order of items: {name, ok, failures, seen}. A case that throws is a failure with the error as its reason.
export async function replayInTabs(items, {tabs = 4, extensionDir, onResult} = {}) {
  const browser = await startReplayBrowser(items, {extensionDir});
  const queue = [...items], results = new Map(), running = new Map();   // running: case name -> promise
  const hostsRunning = () => new Set([...running.keys()].flatMap(name => caseHosts(items.find(item => item.name === name))));
  try {
    while (queue.length || running.size) {
      for (let index = nextRunnable(queue, hostsRunning()); running.size < tabs && index >= 0; index = nextRunnable(queue, hostsRunning())) {
        const item = queue.splice(index, 1)[0];
        running.set(item.name, runInTab_(browser, item).then(result => { results.set(item.name, result); running.delete(item.name); onResult?.(result); }));
      }
      if (running.size) await Promise.race(running.values());
    }
    if (!(await browser.run.assertIsolated().catch(() => false))) for (const result of results.values()) result.failures.push('isolation'), result.ok = false;
  } finally { await browser.close(); }
  return items.map(item => results.get(item.name));
}
const runInTab_ = (browser, item) => browser.runInTab(item).catch(error => ({name: item.name, ok: false, failures: [`error: ${String(error?.message || error).slice(0, 200)}`], seen: {tabs: 0, opened: 0}}));
