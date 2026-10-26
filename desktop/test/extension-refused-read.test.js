// The extension's side of refused sites read in the browser (owner, 19 Oct 2026): nothing unless the app lists sites (it does so only after the person's press), every fetch
// without cookies, one at a time, never a login-wall site even if the app lists one, and every page or failure goes back to the app.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {pass, mayFetch, readNowIfAsked, ALARM, NOW_ALARM, MAX_SITES} from '../../extension/refused-read.js';

const chromeWith = allowed => ({permissions: {contains: async () => allowed}});
function harness({on = true, sites = [], allowed = true, pages = {}, stopAfter = 0} = {}) {
  const calls = [], fetched = [];
  let open = 0, most = 0;
  const call = async (_cfg, path, init) => {
    calls.push([path, init?.body ? JSON.parse(init.body) : null]);
    if (path === '/extension/refused-outcome' && stopAfter && calls.filter(([p]) => p === path).length >= stopAfter) return {ok: true, stop: true};
    return path === '/extension/refused-queue' ? {ok: true, on, sites} : {ok: true};
  };
  const fetchPage = async (url, init) => {
    open++; most = Math.max(most, open);
    fetched.push([url, init]);
    await new Promise(resolve => setTimeout(resolve, 1));
    open--;
    const page = pages[url] || {status: 200, text: '<html><title>Jobs</title></html>'};
    if (page.throws) throw new Error(page.throws);
    return {status: page.status, url: page.final || url, text: async () => page.text};
  };
  return {calls, fetched, run: () => pass({chrome: chromeWith(allowed), call, config: {}, fetchPage, pause: async () => {}}), most: () => most};
}

test('the setting off or no permission: nothing is fetched', async () => {
  for (const options of [{on: false, sites: [{url: 'https://jobs.coop.ch'}]}, {allowed: false, sites: [{url: 'https://jobs.coop.ch'}]}]) {
    const h = harness(options);
    assert.equal((await h.run()).read, 0);
    assert.deepEqual(h.fetched, []);
  }
});

test('each site is fetched once, without cookies, one at a time, and its page goes back to the app', async () => {
  const sites = [{url: 'https://jobs.coop.ch'}, {url: 'https://www.monsterboard.nl/v?q=a'}];
  const h = harness({sites, pages: {'https://www.monsterboard.nl/v?q=a': {status: 429, text: ''}}});
  assert.equal((await h.run()).read, 2);
  assert.ok(h.fetched.every(([, init]) => init.credentials === 'omit' && init.redirect === 'follow'), 'no cookies, no logins');
  assert.equal(h.most(), 1);
  const outcomes = h.calls.filter(([path]) => path === '/extension/refused-outcome').map(([, body]) => [body.url, body.status, body.title]);
  assert.deepEqual(outcomes, [['https://jobs.coop.ch', 200, 'Jobs'], ['https://www.monsterboard.nl/v?q=a', 429, '']]);
  assert.equal(h.calls.at(-1)[0], '/extension/refused-done');
});

test('a login-wall site the app lists is never fetched, a failed fetch is reported, and the list is capped', async () => {
  for (const host of ['www.linkedin.com', 'de.indeed.com', 'www.glassdoor.com', 'www.levels.fyi', 'www.reddit.com']) assert.equal(mayFetch(`https://${host}/jobs`), false, host);
  assert.equal(mayFetch('http://jobs.coop.ch'), false, 'https only');
  const h = harness({sites: [{url: 'https://www.linkedin.com/jobs'}, {url: 'https://down.example.ch'}], pages: {'https://down.example.ch': {throws: 'network'}}});
  await h.run();
  assert.deepEqual(h.fetched.map(([url]) => url), ['https://down.example.ch']);
  assert.equal(h.calls.filter(([path, body]) => path === '/extension/refused-outcome' && body.status === 0).length, 2, 'both reported to the app: one skipped, one failed');
  const many = harness({sites: Array.from({length: 40}, (_, n) => ({url: `https://s${n}.example.ch`}))});
  await many.run();
  assert.equal(many.fetched.length, MAX_SITES);
  assert.equal(ALARM, 'refused-reads');
});

test('the extension looks every minute and only reads when the app says the person pressed the button', async () => {
  assert.notEqual(NOW_ALARM, ALARM);
  for (const [pending, reads] of [[true, 1], [false, 0]]) {
    const paths = [];
    const call = async (_cfg, path) => { paths.push(path); return path === '/extension/refused-pending' ? {ok: true, pending} : path === '/extension/refused-queue' ? {ok: true, on: true, sites: [{url: 'https://jobs.coop.ch'}]} : {ok: true}; };
    const fetchPage = async url => ({status: 200, url, text: async () => '<html></html>'});
    const answer = await readNowIfAsked({chrome: chromeWith(true), call, config: {}, fetchPage, pause: async () => {}});
    assert.equal(answer.read, reads);
    assert.equal(paths.includes('/extension/refused-queue'), pending, 'the engine is only asked when a press waits');
  }
});

test('the ladder: a site the download cannot open goes on to the real tab, and the outcome says which step opened it', async () => {
  const calls = [], tabbed = [];
  const call = async (_cfg, path, init) => {
    const body = init?.body ? JSON.parse(init.body) : null;
    calls.push([path, body]);
    if (path === '/extension/refused-queue') return {ok: true, on: true, sites: [{url: 'https://jobs.coop.ch'}, {url: 'https://jobs.manor.ch'}, {url: 'https://jobs.last.ch', step: 'tab'}]};
    if (path === '/extension/refused-judge') return {ok: true, state: body.status === 403 ? 'refused' : 'page'};
    return {ok: true};
  };
  const fetchPage = async url => ({status: url.includes('coop') ? 403 : 200, url, text: async () => '<html><title>Jobs</title></html>'});
  const tabs = {read: async url => { tabbed.push(url); return {state: 'page', page: {url, status: 200, html: '<html>jobs</html>', title: 'Jobs', final: url}}; }, close: async () => {}};
  await pass({chrome: chromeWith(true), call, config: {}, fetchPage, tabs, pause: async () => {}});
  assert.deepEqual(tabbed, ['https://jobs.coop.ch', 'https://jobs.last.ch'], 'only the refused one and the one that last opened at the tab step; an open site never uses the tab');
  const steps = Object.fromEntries(calls.filter(([path]) => path === '/extension/refused-outcome').map(([, body]) => [new URL(body.url).hostname, body.step]));
  assert.deepEqual(steps, {'jobs.coop.ch': 'tab', 'jobs.manor.ch': 'download', 'jobs.last.ch': 'tab'});
  assert.equal(calls.filter(([path]) => path === '/extension/refused-outcome').length, 3, 'one outcome per site, never two');
});

test('a 429 is "slow down", never a ladder step: no tab is opened for it', async () => {
  const tabbed = [];
  const call = async (_cfg, path) => path === '/extension/refused-queue' ? {ok: true, on: true, sites: [{url: 'https://jobs.coop.ch'}]} : {ok: true, state: 'refused'};
  const fetchPage = async url => ({status: 429, url, text: async () => ''});
  await pass({chrome: chromeWith(true), call, config: {}, fetchPage, tabs: {read: async url => { tabbed.push(url); return {skipped: 'x'}; }, close: async () => {}}, pause: async () => {}});
  assert.deepEqual(tabbed, []);
});

test('no Allow in Incognito: the page goes back marked, so the app can say which switch to press', async () => {
  const calls = [];
  const call = async (_cfg, path, init) => { calls.push([path, init?.body ? JSON.parse(init.body) : null]); return path === '/extension/refused-queue' ? {ok: true, on: true, sites: [{url: 'https://jobs.coop.ch'}]} : {ok: true}; };
  const fetchPage = async () => ({status: 403, url: 'https://jobs.coop.ch', text: async () => ''});
  const tabs = {read: async () => ({skipped: 'incognito'}), close: async () => {}};
  await pass({chrome: chromeWith(true), call, config: {}, fetchPage, tabs, pause: async () => {}});
  assert.equal(calls.find(([path]) => path === '/extension/refused-outcome')[1].tabSkipped, 'incognito');
});

test('Open Chrome\'s switch: the extension opens its own details page once, and only when the app asks', async () => {
  const opened = [];
  const chrome = {runtime: {id: 'abcdef'}, tabs: {create: async info => { opened.push(info.url); }}, permissions: {contains: async () => true}};
  for (const [answer, expected] of [[{ok: true, pending: false}, []], [{ok: true, pending: false, openDetails: true}, ['chrome://extensions/?id=abcdef']]]) {
    opened.length = 0;
    await readNowIfAsked({chrome, call: async () => answer, config: {}});
    assert.deepEqual(opened, expected);
  }
});

// Owner, 25 Oct 2026: Stop in the app must stop the reading in Chrome too, not only the app's row.
test('when the app answers stop, no further site is fetched', async () => {
  const h = harness({sites: [{url: 'https://a.example.ch'}, {url: 'https://b.example.ch'}, {url: 'https://c.example.ch'}], stopAfter: 1});
  assert.equal((await h.run()).read, 1);
  assert.deepEqual(h.fetched.map(([url]) => url), ['https://a.example.ch']);
});
