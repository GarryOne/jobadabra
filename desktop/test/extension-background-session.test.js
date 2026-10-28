// Background Apply browser ownership: create an unfocused normal window in the hidden browser and reveal the same persisted session for manual handoff.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createBackgroundSession} from '../../extension/background-session.mjs';

const parseMark = url => new URL(url).hash.match(/(?:^#|&)jobpilotto-fill=([^&]+)/)?.[1] || '';

function browser() {
  let next = 1, stored = {}, shown = [];
  const windows = new Map(), tabs = new Map();
  const chrome = {
    storage: {local: {get: async key => ({[key]: stored[key]}), set: async value => { stored = {...stored, ...value}; }}},
    tabs: {query: async () => [...tabs.values()], get: async id => tabs.get(id) || null},
    windows: {
      create: async options => {
        // Why (2026-10-28, measured): a minimized headless tab repainted 2 of 5 page changes, a normal unfocused one all 5; the live view needs every frame.
        assert.notEqual(options.state, 'minimized');
        assert.equal(options.focused, false);
        const id = next++, tab = {id: next++, windowId: id, url: options.url};
        tabs.set(tab.id, tab);
        const win = {id, state: options.state, tabs: [tab]}; windows.set(id, win); return win;
      },
      get: async id => windows.get(id),
      update: async (id, options) => { shown.push({id, ...options}); return windows.get(id) || null;},
    },
  };
  return {chrome, shown, windows, tabs};
}

test('Background and Full automation create one unfocused session and reveal that same session on request', async () => {
  for (const mode of ['fill', 'auto']) {
    const fake = browser(), run = createBackgroundSession({chrome: fake.chrome, parseMark});
    const created = await run.start({session: `s-${mode}`, url: `https://jobs.example.test/app#jobpilotto-fill=s-${mode}`, mode});
    assert.equal(created.ok, true);
    assert.equal(created.reused, false);
    assert.equal(await run.start({session: `s-${mode}`, url: `https://jobs.example.test/app#jobpilotto-fill=s-${mode}`, mode}).then(result => result.reused), true);
    assert.equal(await run.reveal(`s-${mode}`), true);
    assert.deepEqual(fake.shown, [{id: created.window, state: 'normal', focused: true}]);
  }
});

test('manual override survives runner recreation and challenge resolution cannot resume automation', async () => {
  const fake = browser(), args = {session: 'captcha-job', url: 'https://jobs.example.test/app#jobpilotto-fill=captcha-job', mode: 'auto'};
  let run = createBackgroundSession({chrome: fake.chrome, parseMark});
  await run.start(args);
  assert.equal(await run.mayContinue(args.session), true);
  assert.equal(await run.requireManual(args.session, 'captcha'), true);
  run = createBackgroundSession({chrome: fake.chrome, parseMark});
  assert.equal(await run.start(args).then(result => result.manualRequired), true);
  assert.equal(await run.mayContinue(args.session), false);
  assert.equal(await run.reveal(args.session), true);
});

test('invalid mode or session mark fails closed before creating a browser window', async () => {
  const fake = browser(), run = createBackgroundSession({chrome: fake.chrome, parseMark});
  assert.equal((await run.start({session: 's1', url: 'https://jobs.example.test/app#jobpilotto-fill=s1', mode: 'check'})).ok, false);
  assert.equal((await run.start({session: 's1', url: 'https://jobs.example.test/app#jobpilotto-fill=s2', mode: 'fill'})).ok, false);
  assert.equal(fake.windows.size, 0);
});

test('two concurrent extension polls cannot create two windows for the same marked application', async () => {
  const fake = browser(), run = createBackgroundSession({chrome: fake.chrome, parseMark});
  const command = {session: 'race', url: 'https://jobs.example.test/app#jobpilotto-fill=race', mode: 'fill'};
  await Promise.all([run.start(command), run.start(command)]);
  assert.equal(fake.windows.size, 1);
});

test('a challenge after any observed form is runtime even when its new page has no form; unexpected accounts hand off before filling', async () => {
  const fake = browser(), run = createBackgroundSession({chrome: fake.chrome, parseMark});
  const args = {session: 'phase', url: 'https://jobs.example.test/app#jobpilotto-fill=phase', mode: 'auto'};
  await run.start(args);
  assert.equal(await run.observe('phase', 'no-form', true), 'captcha_preflight');
  assert.equal(await run.observe('phase', 'form', false), '');
  const restarted = createBackgroundSession({chrome: fake.chrome, parseMark});
  assert.equal(await restarted.observe('phase', 'no-form', true), 'captcha_runtime');
  assert.equal(await restarted.observe('phase', 'account', false), 'sign_in_required');
});

test('cancel never closes a recycled tab id belonging to another application', async () => {
  const fake = browser(), run = createBackgroundSession({chrome: fake.chrome, parseMark});
  const created = await run.start({session: 'close', url: 'https://jobs.example.test/app#jobpilotto-fill=close', mode: 'fill'});
  let closed = false;
  fake.chrome.tabs.remove = async () => { closed = true; };
  fake.tabs.get(created.tab).url = 'https://jobs.example.test/other#jobpilotto-fill=other';
  assert.equal(await run.closeSession('close'), false);
  assert.equal(closed, false);
  assert.equal(await run.mayContinue('close'), false);
});
