// E2E_BROWSER=msedge runs the extension in Edge; anything else keeps Playwright's Chromium.
import test from 'node:test';
import assert from 'node:assert/strict';
import {browserChannel, fillNote, formTab} from '../../lib/extension.mjs';

test('the apply suite uses Edge only when asked', () => {
  assert.deepEqual(browserChannel({E2E_BROWSER: 'msedge'}), {channel: 'msedge'});
  assert.deepEqual(browserChannel({}), {});
  assert.deepEqual(browserChannel({E2E_BROWSER: 'chrome'}), {});
});

// A fixture browser's addresses resolve to the local fixture server: they are not live visits and never reach the per-site ledger
// (12 Oct 2026: local apply runs filled jobs.lever.co's daily 3 and the next run's Lever step was refused). A real browser's are counted.
test('only a real browser counts its visits in the site ledger', async () => {
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const {visitGuard} = await import('../../lib/extension.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-ledger-'));
  const env = {JOBADABRA_SITE_LEDGER_DIR: dir, JOBADABRA_SITE_LIMIT: '1'};
  try {
    for (let i = 0; i < 3; i++) visitGuard(false)('https://jobs.lever.co/e2e/1/apply', {env, who: 'browser'});
    assert.equal(fs.existsSync(path.join(dir, 'ledger.json')) ? Object.keys(JSON.parse(fs.readFileSync(path.join(dir, 'ledger.json'), 'utf8'))).length : 0, 0, 'a fixture visit was written to the ledger');
    visitGuard(true)('https://jobs.lever.co/e2e/1/apply', {env, who: 'twin'});
    const days = Object.values(JSON.parse(fs.readFileSync(path.join(dir, 'ledger.json'), 'utf8')));
    assert.equal(days[0]?.['jobs.lever.co']?.visits?.length, 1, 'a real browser\'s visit was not counted');
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

// Beta 40281407461 (26 Oct 2026), Windows apply-1of2 in Edge: the extension's install opened its settings tab while the harness reused a blank tab for the
// app's first form; the form loaded in another tab (319271653, opened from the first) and the test watched the first pick for 90 s ("state: null").
test('the form tab is the one that shows the form\'s address, not the harness\'s first pick', () => {
  const page = url => ({url: () => url, isClosed: () => false});
  const url = 'https://boards.greenhouse.io/e2e/jobs/4001001#jobadabra-fill=2ce1ef73';
  const picked = page('about:blank'), real = page(url);
  const browser = {pages: {[url]: picked}, context: {pages: () => [picked, real]}};
  assert.equal(formTab(browser, url), real);
  const shown = {pages: {[url]: real}, context: {pages: () => [page(url), real]}};
  assert.equal(formTab(shown, url), real, 'the first pick wins while it shows the form');
  const loading = {pages: {[url]: picked}, context: {pages: () => [picked]}};
  assert.equal(formTab(loading, url), picked, 'nothing shows it yet: the first pick, still loading');
});

// Beta 40748263936 (28 Oct 2026), Windows apply-1of2, the Workday-shaped form: the app log said "filled the form" and the step read "state: null" for 90 s. The same words
// as beta 40281407461 above, a different cause there (the wrong tab). The extension also writes the fill's card id (a bare uuid, flow.js) into that attribute, and a read
// that threw was turned into null by every caller's `.catch(() => null)`: three different situations, one word. Each says what it is, so the next red names its cause.
test('a fill state that cannot be read says so and what it saw, never a bare null', async () => {
  const {fillState} = await import('../../lib/extension.mjs');
  const pageWith = attribute => ({evaluate: async fn => {
    globalThis.document = {URL: 'https://e2e.wd3.myworkdayjobs.com/en-US/E2E/job/Zurich/x/apply#jobadabra-fill=0a089404', documentElement: {dataset: attribute === undefined ? {} : {jobadabraFill: attribute}}};
    try { return await fn(); } finally { delete globalThis.document; }
  }});
  try {
    assert.equal(await fillState(pageWith(undefined)), null, 'nothing written yet: null, as before');
    assert.deepEqual(await fillState(pageWith('{"state":"done","filled":6}')), {state: 'done', filled: 6}, 'a readable mark is returned as before');
    const card = await fillState(pageWith('3f2a9c1e-7b64-4d0a-9a53-0c1d2e3f4a5b'));
    assert.equal(card.state, 'unreadable', 'the card id the fill leaves on the page is not a state');
    assert.equal(card.raw, '3f2a9c1e-7b64-4d0a-9a53-0c1d2e3f4a5b', 'what the page held');
    assert.equal(card.at, 'https://e2e.wd3.myworkdayjobs.com/en-US/E2E/job/Zurich/x/apply', 'on which address, without the mark');
    const gone = await fillState({evaluate: async () => { throw new Error('page.evaluate: Target page, context or browser has been closed\n at ...'); }, url: () => 'https://e2e.wd3.myworkdayjobs.com/x#jobadabra-fill=1', isClosed: () => true});
    assert.deepEqual(gone, {state: 'unreadable', error: 'page.evaluate: Target page, context or browser has been closed', at: 'https://e2e.wd3.myworkdayjobs.com/x', closed: true}, 'a read that threw');
  } finally { delete globalThis.document; }
});

test('fillNote reports a cap for missing or unfinished states, and preserves finished values', () => {
  for (const state of [null, {state: 'running'}, {state: 'unreadable', raw: 'card-id'}, {state: 'unreadable', closed: false, error: 'navigation replaced context'}, {state: 'pending'}]) {
    assert.equal(fillNote(state, 90), `the fill did not finish within 90 s (last seen: ${JSON.stringify(state)})`);
  }
  for (const name of ['done', 'error', 'stopped', 'no-form', 'account']) {
    const state = {state: name, error: 'reported value'};
    assert.equal(fillNote(state, 90), `state: ${JSON.stringify(state)}`);
    if (['no-form', 'account'].includes(name)) assert.equal(fillNote(state, 90, {pageKinds: []}), `the fill did not finish within 90 s (last seen: ${JSON.stringify(state)})`);
  }
});

test('a known closed tab is a reported failure, not a wait that can still finish', () => {
  const state = {state: 'unreadable', closed: true, error: 'Target page has been closed'};
  assert.equal(fillNote(state, 90), `state: ${JSON.stringify(state)}`);
});

// Beta 41250138244 (31 Oct 2026), Windows apply-1of3, Edge, "a Workday-shaped form": "read on about:blank, 1 tab(s)". The watcher gave the form the blank tab it found, the extension's install then took a
// tab for its settings page, and the form's navigation was lost (its error was swallowed). These tests play that order with a fake browser: no real browser, no clock.
const SETTINGS = 'chrome-extension://abcdefghijklmnop/options.html';
const FORM = 'https://e2e.wd3.myworkdayjobs.com/en-US/E2E/job/Zurich/x/apply#jobadabra-fill=0a089404';

// A browser context as Playwright shows it: pages(), newPage(), 'page' events; a page navigates by goto (the harness) or navigate (the browser itself, as the install does).
function fakeContext({gotoFails = null} = {}) {
  const list = [], handlers = [];
  const make = (url = 'about:blank') => {
    const listeners = {}, frame = {url: () => url};
    const emit = (name, ...args) => (listeners[name] || []).forEach(fn => fn(...args));
    const page = {gotos: [], closed: false, url: () => url, isClosed: () => page.closed, mainFrame: () => frame, on: (name, fn) => (listeners[name] ||= []).push(fn),
      navigate(target) { url = target; emit('framenavigated', frame); },
      async goto(target, options) { page.gotos.push(target); page.options = options; if (gotoFails) throw new Error(gotoFails); page.navigate(target); },
      async close() { page.closed = true; list.splice(list.indexOf(page), 1); emit('close'); }};
    list.push(page);
    return page;
  };
  const context = {pages: () => [...list], on: (name, fn) => handlers.push(fn), made: 0,
    async newPage() { context.made++; const page = make(); handlers.forEach(fn => fn(page)); return page; }};
  return {context, starter: make(), open: url => { const page = make(url); handlers.forEach(fn => fn(page)); return page; }, make};
}
async function spooled(...urls) {
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const spool = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-spool-'));
  urls.forEach((url, i) => fs.writeFileSync(path.join(spool, `open.${i}.url`), url));
  return {spool, remove: () => fs.rmSync(spool, {recursive: true, force: true})};
}
const livePages = context => context.pages().map(page => page.url());

test('a fresh profile opens no form before the install\'s settings page was seen, and the install\'s navigation never lands on the form\'s tab', async () => {
  const {startTabs} = await import('../../lib/spool-tabs.mjs');
  const {context, starter} = fakeContext(), {spool, remove} = await spooled(FORM);
  try {
    let ready = false;
    const starting = startTabs({context, spool, fresh: true, pollMs: 0, guardMs: 60000}).then(tabs => { ready = true; return tabs; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(ready, false, 'the tabs were handed out before the install\'s settings page appeared');
    assert.equal(context.made, 0, 'a form tab was created before the install\'s settings page appeared');
    starter.navigate(SETTINGS);   // Edge: the install takes the tab that exists, no new page
    const tabs = await starting;
    await tabs.drain();
    await tabs.loaded(FORM);
    assert.equal(tabs.pages[FORM].url(), FORM, 'the form is in its own tab');
    assert.notEqual(tabs.pages[FORM], starter);
    assert.deepEqual(livePages(context).sort(), ['about:blank', FORM].sort(), 'the settings page is closed; one blank anchor tab and the form remain');
    assert.deepEqual(tabs.pages[FORM].gotos, [FORM], 'one navigation, no retry');
  } finally { remove(); }
});

test('beta 41250138244\'s order: the form is asked for at once, the install takes the blank tab right after; a tab still shows the form at the end', async () => {
  const {startTabs} = await import('../../lib/spool-tabs.mjs');
  const {context, starter} = fakeContext(), {spool, remove} = await spooled(FORM);
  try {
    const starting = startTabs({context, spool, fresh: true, pollMs: 0});
    const installed = new Promise(resolve => setImmediate(() => { starter.navigate(SETTINGS); resolve(); }));
    const tabs = await starting;
    await tabs.drain();   // the first poll of the spool
    await installed;
    await tabs.drain();   // a later poll
    assert.ok(livePages(context).includes(FORM), `no tab shows the form at the end; tabs: ${livePages(context).join(', ')}`);
    assert.notEqual(tabs.pages[FORM], starter, 'the form reused the tab the install navigated');
    assert.equal(starter.gotos.length, 0, 'the harness navigated the install\'s tab');
  } finally { remove(); }
});

test('an install that opens its settings page as a new tab leaves the start tab and the form', async () => {
  const {startTabs} = await import('../../lib/spool-tabs.mjs');
  const {context, open} = fakeContext(), {spool, remove} = await spooled(FORM);
  try {
    const starting = startTabs({context, spool, fresh: true, pollMs: 0, guardMs: 60000});
    open(SETTINGS);
    const tabs = await starting;
    await tabs.drain();
    assert.deepEqual(livePages(context).sort(), ['about:blank', FORM].sort());
    assert.equal(context.made, 1, 'the only page the harness created is the form\'s');
  } finally { remove(); }
});

test('a fresh profile whose install page never appears fails the launch, naming it', async () => {
  const {startTabs} = await import('../../lib/spool-tabs.mjs');
  const {context} = fakeContext(), {spool, remove} = await spooled();
  try {
    await assert.rejects(startTabs({context, spool, fresh: true, pollMs: 0, guardMs: 5}), /the extension's install page \(options\.html\) did not appear within 0\.005 s of the browser starting; tabs: tab 1 \+\d+ ms open about:blank/);
  } finally { remove(); }
});

test('a kept profile installs nothing, is not waited for, and the form still gets its own tab', async () => {
  const {startTabs} = await import('../../lib/spool-tabs.mjs');
  const {context, starter} = fakeContext(), {spool, remove} = await spooled(FORM);
  try {
    const tabs = await startTabs({context, spool, fresh: false, pollMs: 0});
    await tabs.drain();
    assert.equal(starter.gotos.length, 0, 'the blank tab is never reused');
    assert.equal(tabs.pages[FORM].url(), FORM);
    assert.equal(context.pages().length, 2);
  } finally { remove(); }
});

test('a navigation the browser refused is an error with the tab\'s trail, not a swallowed one', async () => {
  const {startTabs} = await import('../../lib/spool-tabs.mjs');
  const {context, open} = fakeContext({gotoFails: 'page.goto: net::ERR_ABORTED at https://e2e.wd3.myworkdayjobs.com/x\nCall log: ...'}), {spool, remove} = await spooled(FORM);
  const logged = [], was = console.error;
  console.error = (...args) => logged.push(args.join(' '));
  try {
    const starting = startTabs({context, spool, fresh: true, pollMs: 0});
    open(SETTINGS);
    const tabs = await starting;
    await tabs.drain();
    await assert.rejects(tabs.loaded(FORM), error => {
      assert.match(error.message, /the browser could not open https:\/\/e2e\.wd3\.myworkdayjobs\.com\/en-US\/E2E\/job\/Zurich\/x\/apply in its own tab: page\.goto: net::ERR_ABORTED/);
      assert.match(error.message, /tab \d: tab \d \+\d+ ms open about:blank/);
      assert.doesNotMatch(error.message, /jobadabra-fill/, 'the fill mark is not part of the trail');
      return true;
    });
    assert.equal(tabs.trail.errors.length, 1);
    assert.match(logged.join('\n'), /the browser could not open .* net::ERR_ABORTED/);
    assert.ok(tabs.trail.entries.some(entry => entry.what === 'goto failed'));
  } finally { console.error = was; remove(); }
});

test('the trail keeps every tab\'s opens, navigations and closes without the fill mark or a query', async () => {
  const {tabTrail} = await import('../../lib/tab-trail.mjs');
  let ms = 1000;
  const {context, starter, open} = fakeContext(), trail = tabTrail(context, {now: () => (ms += 10)});
  starter.navigate(`${SETTINGS}?token=secret`);
  const page = open('about:blank');
  page.navigate(FORM);
  await page.close();
  assert.deepEqual(trail.entries.map(entry => `${entry.tab}:${entry.what}:${entry.address}`), [
    '1:open:about:blank', `1:navigated:${SETTINGS}`, '2:open:about:blank', '2:navigated:https://e2e.wd3.myworkdayjobs.com/en-US/E2E/job/Zurich/x/apply', '2:closed:']);
  assert.deepEqual(trail.entries.map(entry => entry.ms), [10, 20, 30, 40, 50], 'times are ms since the trail began');
  assert.equal(trail.head(2), `tab 1 +10 ms open about:blank; tab 1 +20 ms navigated ${SETTINGS}`, 'the first entries read in order');
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-trail-'));
  try { trail.write(dir); assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'tab-trail.json'), 'utf8')).entries.length, 5, 'the artifact holds the same entries'); }
  finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

// Gitar on #2754: the form's load has no clock of its own: the running step's hang cap bounds it (stepWait), and with no step running Playwright's own default applies.
test('a form\'s navigation is bounded by the running step\'s clock, not by the launch\'s', async () => {
  const {startTabs} = await import('../../lib/spool-tabs.mjs'), {stepClock} = await import('../../lib/wait-on-state.mjs');
  const {context, open} = fakeContext(), {spool, remove} = await spooled(FORM);
  try {
    const starting = startTabs({context, spool, fresh: true, pollMs: 0, guardMs: 60000});
    open(SETTINGS);
    const tabs = await starting;
    stepClock(10000);
    await tabs.drain();
    const timeout = tabs.pages[FORM].options.timeout;
    assert.ok(timeout > 0 && timeout <= 8000, `the step's clock minus the report time bounds the load, got ${timeout}`);
    stepClock(null);
    const fs = await import('node:fs'), path = await import('node:path'), second = `${FORM}2`;
    fs.writeFileSync(path.join(spool, 'second.url'), second);
    await tabs.drain();
    assert.equal(tabs.pages[second].options.timeout, undefined, 'no step running: no bound of our own, Playwright\'s default applies');
  } finally { stepClock(null); remove(); }
});
