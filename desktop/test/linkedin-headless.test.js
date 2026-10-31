// LinkedIn jobs on every Find jobs, PR 2/3 (spec docs/superpowers/specs/2026-10-31-linkedin-headless-design.md): the step that reads the person's LinkedIn
// searches in the app's own hidden browser. Every state of the spec's table, the copied session leaving the browser on every way out, and the secret
// never in any output. All seams are fakes: nothing here touches a real browser, Keychain or LinkedIn (no test uses anyone's session).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {linkedinStep} from '../lib/linkedin-headless.js';

const SECRET = 'FAKE-LI-AT-value-1234';
const SESSION = {li_at: SECRET, JSESSIONID: '"ajax:99"'};
const SEARCHES = [1, 2, 3].map(n => ({name: `LinkedIn: role${n} in Genève`, url: `https://www.linkedin.com/jobs/search/?keywords=role${n}&location=Gen%C3%A8ve`}));
const NOW = Date.parse('2026-10-31T12:00:00.000Z');

function rig({on = true, session = SESSION, ready = true, searches = SEARCHES, paused = '', results = [], status = {}, startError = null, runError = null, aborted = false} = {}) {
  const mine = {linkedinJobs: {on, ...(paused ? {pauseUntil: paused} : {})}};
  const storage = {settings: () => mine, saveSettings: patch => Object.assign(mine, patch)};
  const calls = [], lines = [], opened = [], tabs = new Set(), listeners = [];
  let nextTab = 0;
  const browser = {
    ready: () => { calls.push('ready'); return ready; },
    start: async () => { calls.push('start'); if (startError) throw startError; return {owner: 'o'}; },
    send: async (method, params) => {
      calls.push([method, params]);
      if (method === 'Target.createTarget') { const targetId = `T${++nextTab}`; tabs.add(targetId); return {targetId}; }
      if (method === 'Target.closeTarget') tabs.delete(params.targetId);
      return {};
    },
    targetSocket: async id => `ws://127.0.0.1:1/devtools/page/${id}`,
  };
  const openCdp = async socket => ({
    send: async (method, params) => { calls.push([`cdp:${method}`, params]); if (method === 'Page.navigate') { opened.push(params.url); const n = opened.length; const code = status[n]; if (code) listeners.forEach(fn => fn({type: 'Document', response: {url: 'https://www.linkedin.com/jobs/search/', status: code}})); } return {}; },
    on: (event, fn) => { if (event === 'Network.responseReceived') listeners.push(fn); },
    detach: async () => { calls.push(['cdp:detach', socket]); },
  });
  const ended = [];
  let searchNo = 0;
  const run = async (sites, options) => {
    if (runError) throw runError;
    const site = sites[0], result = results[searchNo] ?? {ok: true, jobs: 10, added: 2, fits: 1, why: '3 pages read: the most for this read', blocked: ''};
    searchNo += 1;
    options.openTab(`${site.url}#jp-read-abcd1234`);
    await new Promise(resolve => setTimeout(resolve, 5));
    return [{...site, ...result}];
  };
  const controller = new AbortController();
  if (aborted) controller.abort();
  const args = {storage, browser, openCdp, run, end: payload => ended.push(payload), tee: line => lines.push(line), signal: controller.signal, now: () => NOW,
    searches: async () => searches, readSession: () => session, port: 47111, token: 't', pause: async () => { calls.push('pause'); }};
  return {args, calls, lines, opened, tabs, ended, mine};
}

const cookieCalls = calls => calls.filter(call => Array.isArray(call) && call[0] === 'Storage.setCookies');
const noSecret = (...things) => { for (const thing of things) assert.equal(JSON.stringify(thing).includes('FAKE-LI-AT'), false, 'the session never leaves the cookie jar'); };

test('off: no browser, no cookie, no search, nothing said', async () => {
  const r = rig({on: false});
  assert.deepEqual(await linkedinStep(r.args), {state: 'off', jobs: 0});
  assert.deepEqual(r.calls, []);
  assert.deepEqual(r.lines, []);
});

test('on without a copied session: says what to do and starts nothing', async () => {
  const r = rig({session: null});
  const result = await linkedinStep(r.args);
  assert.equal(result.state, 'no-session');
  assert.match(r.lines.join('\n'), /sign in to LinkedIn in Chrome/i);
  assert.equal(r.calls.includes('start'), false);
});

test('the background browser is not downloaded: says so, starts nothing', async () => {
  const r = rig({ready: false});
  assert.equal((await linkedinStep(r.args)).state, 'no-browser');
  assert.match(r.lines.join('\n'), /download/i);
  assert.equal(r.calls.includes('start'), false);
  assert.equal(cookieCalls(r.calls).length, 0);
});

test('a read of three searches: cookies in, honest tabs opened one after another, jobs added up, cookies out, tabs closed', async () => {
  const r = rig();
  const result = await linkedinStep(r.args);
  assert.deepEqual([result.state, result.jobs, result.fits, result.read, result.of], ['done', 30, 3, 3, 3], 'jobs and the ones that fit the search, added up');
  assert.equal(r.opened.length, 3);
  assert.ok(r.opened.every(url => /#jp-read-abcd1234$/.test(url) && !url.includes('jp-read-filter')), 'a plain read: no filter step types into LinkedIn');
  const sets = cookieCalls(r.calls);
  assert.equal(sets.length, 2, 'one set before, one clear after');
  const [put, clear] = sets.map(call => call[1].cookies);
  assert.deepEqual(put.map(c => c.name), ['li_at', 'JSESSIONID']);
  assert.ok(put.every(c => c.domain === '.linkedin.com' && c.secure === true && c.path === '/'));
  assert.equal(put[0].httpOnly, true);
  assert.ok(clear.every(c => c.value === '' && c.expires < NOW / 1000), 'cleared by expiring them, with no value');
  assert.equal(r.tabs.size, 0, 'every tab closed');
  assert.equal(r.calls.filter(call => call === 'pause').length, 2, 'a pause between searches, none after the last');
  assert.match(r.lines.join('\n'), /LinkedIn: 30 jobs read/);
  noSecret(r.lines, result, r.calls.filter(call => Array.isArray(call) && call[0] !== 'Storage.setCookies'));
});

test('the cap per search is three pages, one search at a time', async () => {
  const r = rig();
  const seen = [];
  const run = r.args.run;
  r.args.run = (sites, options) => { seen.push([sites.length, options.maxPages, options.atOnce, options.filter]); return run(sites, options); };
  await linkedinStep(r.args);
  assert.deepEqual(seen, [[1, 3, 1, false], [1, 3, 1, false], [1, 3, 1, false]]);
});

test('a sign-in page ends the step: no retry, no further search, the session leaves the browser', async () => {
  const r = rig({results: [{ok: false, jobs: 0, added: 0, why: 'x', blocked: 'login'}]});
  const result = await linkedinStep(r.args);
  assert.equal(result.state, 'signed-out');
  assert.equal(r.opened.length, 1);
  assert.match(r.lines.join('\n'), /sign in again in Chrome/i);
  assert.equal(cookieCalls(r.calls).length, 2);
});

test('a check page ends the step and is never answered', async () => {
  const r = rig({results: [{ok: true, jobs: 4, added: 1, why: '', blocked: ''}, {ok: false, jobs: 0, added: 0, why: 'x', blocked: 'check'}]});
  const result = await linkedinStep(r.args);
  assert.deepEqual([result.state, result.jobs, r.opened.length], ['check', 4, 2], 'the jobs of the first search are kept');
  assert.match(r.lines.join('\n'), /asked for a check/i);
});

test('429 ends the step and pauses LinkedIn for a day; 403 ends it without a pause', async () => {
  const r = rig({status: {2: 429}});
  const result = await linkedinStep(r.args);
  assert.equal(result.state, 'limited');
  assert.equal(result.pauseUntil, new Date(NOW + 24 * 3600 * 1000).toISOString());
  assert.equal(r.opened.length, 2);
  assert.equal(r.ended.length, 1, 'the waiting read is ended at once, not left to time out');
  assert.match(r.lines.join('\n'), /slow down/i);
  const other = rig({status: {1: 403}});
  const second = await linkedinStep(other.args);
  assert.equal(second.state, 'limited');
  assert.equal(second.pauseUntil, undefined);
});

test('a pause from a 429 is respected: nothing starts until it is over', async () => {
  const r = rig({paused: new Date(NOW + 3600 * 1000).toISOString()});
  const result = await linkedinStep(r.args);
  assert.equal(result.state, 'limited');
  assert.equal(r.calls.includes('start'), false);
  assert.match(r.lines.join('\n'), /slow down/i);
  const over = rig({paused: new Date(NOW - 1000).toISOString()});
  assert.equal((await linkedinStep(over.args)).state, 'done');
});

test('Stop before the step starts: nothing is started and no cookie is set', async () => {
  const r = rig({aborted: true});
  assert.equal((await linkedinStep(r.args)).state, 'stopped');
  assert.deepEqual(r.calls, []);
});

test('Stop during the read: the step ends as stopped, no further search opens, the tab is closed and the session leaves the browser', async () => {
  const r = rig();
  const stop = new AbortController();
  r.args.signal = stop.signal;
  r.args.run = async (sites, options) => { options.openTab(`${sites[0].url}#jp-read-abcd1234`); await new Promise(resolve => setTimeout(resolve, 5)); stop.abort(); return [{...sites[0], ok: false, jobs: 0, why: 'Stopped by you', blocked: ''}]; };
  const result = await linkedinStep(r.args);
  assert.equal(result.state, 'stopped');
  assert.equal(r.opened.length, 1);
  assert.equal(cookieCalls(r.calls).length, 2, 'set, then cleared');
  assert.equal(r.tabs.size, 0);
});

test('whatever throws, the cookies are cleared and the words never carry the session', async () => {
  const r = rig({runError: new Error(`boom ${SECRET}`)});
  const result = await linkedinStep(r.args);
  assert.equal(result.state, 'failed');
  assert.equal(cookieCalls(r.calls).length, 2, 'set, then cleared');
  noSecret(r.lines, result);
});

test('a browser that will not start is a plain failure, nothing was set', async () => {
  const r = rig({startError: Object.assign(new Error('x'), {code: 'BACKGROUND_BROWSER_MISSING'})});
  assert.equal((await linkedinStep(r.args)).state, 'no-browser');
  const other = rig({startError: new Error('could not start')});
  assert.equal((await linkedinStep(other.args)).state, 'failed');
  assert.equal(cookieCalls(other.calls).length, 0);
});

test('no searches in the strategy: done with none, no cookie set', async () => {
  const r = rig({searches: []});
  assert.deepEqual([(await linkedinStep(r.args)).state, cookieCalls(r.calls).length], ['done', 0]);
});
