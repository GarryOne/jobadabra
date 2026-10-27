// Hung page evaluation and tab closure must fail by case/phase while healthy sibling results survive.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {timedReplay, replayLimit} from '../lib/replay-deadline.mjs';
const never = () => new Promise(() => {});

test('hung evaluation fails by deadline; a hung close cannot hide it or a healthy sibling', async () => {
  const completed = [], logs = [];
  const run = (name, body, cleanup) => timedReplay({name}, body, cleanup, {budgetMs: 25, cleanupMs: 15, log: line => logs.push(line)})
    .then(value => completed.push({name, value}), error => completed.push({name, error}));
  await replayLimit('test outer bound', 300, () => Promise.all([
    run('hung', step => step('judge', never), step => step('close', never)),
    run('healthy', step => step('judge', () => 'pass'), step => step('close', () => {})),
  ]));
  assert.equal(completed[0].name, 'healthy');
  assert.equal(completed[0].value, 'pass');
  assert.match(completed[1].error.message, /replay hung: judge timed out/);
  assert.equal(completed[1].error.code, 'REPLAY_TIMEOUT');
  assert.ok(logs.some(line => /hung.*FAIL.*judge timed out/.test(line)));
  assert.ok(logs.some(line => /healthy.*done/.test(line)));
});

test('teardown failure makes a completed judgment red', async () => {
  await assert.rejects(timedReplay({name: 'close-hung'}, step => step('judge', () => 'pass'), step => step('close', never),
    {budgetMs: 25, cleanupMs: 15, log: () => {}}), /close-hung: close timed out/);
});

test('late operations cannot advance after their deadline', async () => {
  let release, advanced = false;
  await assert.rejects(timedReplay({name: 'late'}, async step => {
    await step('newPage', () => new Promise(resolve => { release = resolve; }));
    await step('goto', () => { advanced = true; });
  }, async () => {}, {budgetMs: 15, log: () => {}}), /late: newPage timed out/);
  release();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(advanced, false);
});

test('the real tab scheduler retains its healthy sibling while evaluation and closure hang', async () => {
  const {EventEmitter} = await import('node:events');
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const {replayInTabs} = await import('../lib/replay-browser.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-deadline-'));
  fs.writeFileSync(path.join(dir, 'page.html'), '<title>Fictional fixture</title>');
  const items = ['hung', 'healthy', 'later'].map(name => ({name, dir, pages: [{url: `https://${name}.example/form`, file: 'page.html'}]}));
  items[2].pages[0].url = 'https://hung.example/form';
  const judged = [];
  const context = new EventEmitter(), pages = [], base = {url: () => 'about:blank'};
  context.route = async () => {};
  context.pages = () => [base, ...pages];
  context.newPage = async () => {
    const page = new EventEmitter(); let url = 'about:blank';
    page.url = () => url;
    page.goto = async address => { url = address; };
    page.opener = async () => null;
    page.evaluate = () => url.includes('hung.example') ? never() : Promise.resolve(null);
    page.close = () => url.includes('hung.example') ? never() : Promise.resolve();
    pages.push(page); context.emit('page', page); return page;
  };
  const saved = [];
  try {
    const results = await replayLimit('scheduler test', 1000, () => replayInTabs(items, {
      tabs: 2, caseBudgetMs: 30, cleanupMs: 15,
      startExtension: async () => ({context, page: base, requests: [], assertIsolated: async () => true, close: async () => {}}),
      judge: async (item, scope) => { judged.push(item.name); await scope.page.evaluate(() => null); return {ok: true, failures: [], seen: {tabs: 1, opened: 0}}; },
      onResult: result => saved.push({name: result.name, ok: result.ok, failures: [...result.failures]}),
    }));
    assert.equal(saved[0].name, 'healthy');
    assert.equal(results[1].ok, true);
    assert.equal(results[0].ok, false);
    assert.equal(Number.isFinite(results[0].seconds), true, 'error result must support the batch duration summary');
    assert.doesNotThrow(() => results[0].seconds.toFixed(0));
    assert.match(results[0].failures.join(';'), /hung: judge timed out/);
    assert.equal(results[2].ok, false);
    assert.equal(results[2].retired, true);
    assert.match(results[2].failures.join(';'), /browser retired/);
    assert.equal(judged.includes('later'), false);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('the outer wall also bounds awaits outside named steps', async () => {
  let cleaned = false;
  await assert.rejects(timedReplay({name: 'between-steps'}, async step => {
    await step('routes', () => {});
    await never();
  }, async () => { cleaned = true; }, {budgetMs: 15, log: () => {}}), /between-steps: routes timed out/);
  assert.equal(cleaned, true);
});

test('late resources are closed after the failed case returns', async () => {
  let release, closed = false;
  await assert.rejects(timedReplay({name: 'late-resource'}, step => step('browser.start', () => new Promise(resolve => { release = resolve; }),
    resource => resource.close()), async () => {}, {budgetMs: 15, log: () => {}}), /late-resource: browser.start timed out/);
  release({close: () => { closed = true; }});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(closed, true);
});


test('a shared browser which finishes startup late is disposed', async () => {
  const {replayInTabs} = await import('../lib/replay-browser.mjs');
  let release, closed = false;
  await assert.rejects(replayInTabs([], {startupMs: 15, startBrowser: () => new Promise(resolve => { release = resolve; })}), /browser startup timed out/);
  release({close: () => { closed = true; }});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(closed, true);
});

test('an ordinary judge error plus hung teardown still retires the browser', async () => {
  const {replayInTabs} = await import('../lib/replay-browser.mjs');
  const items = ['first', 'successor'].map(name => ({name, pages: [{url: 'https://same.example/form'}]}));
  let successorStarted = false;
  const results = await replayInTabs(items, {tabs: 1, startBrowser: async () => ({
    run: {assertIsolated: async () => true}, close: async () => {},
    runInTab: item => {
      if (item.name === 'successor') { successorStarted = true; return Promise.resolve({name: item.name, ok: true, failures: []}); }
      return timedReplay(item, async () => { throw new Error('ordinary judge failure'); }, step => step('tab.close', never), {cleanupMs: 15, log: () => {}});
    },
  })});
  assert.equal(results[0].ok, false);
  assert.equal(results[1].ok, false);
  assert.equal(successorStarted, false);
});

test('shared partial startup exposes cleanup before its factory returns', async () => {
  const {replayInTabs} = await import('../lib/replay-browser.mjs');
  let closed = false, startupSignal;
  await assert.rejects(replayInTabs([], {startupMs: 15, startExtension: async ({onCleanup, signal}) => {
    startupSignal = signal;
    onCleanup(async () => { closed = true; });
    await never();
  }}), /browser startup timed out/);
  assert.equal(closed, true);
  assert.equal(startupSignal.aborted, true);
});


test('isolated recovery after retirement never labels an unrun case as flaky', async () => {
  const {replayRetryMessage} = await import('../lib/replay-browser.mjs');
  const first = {name: 'queued', ok: false, retired: true, failures: ['not run: browser retired']};
  const text = replayRetryMessage(first, {ok: true}, 4);
  assert.match(text, /run alone after browser retirement/);
  assert.doesNotMatch(text, /FLAKY/);
  assert.equal(replayRetryMessage(first, {ok: false}, 4), '');
  assert.match(replayRetryMessage({...first, retired: false}, {ok: true}, 4), /FLAKY in parallel/);
});
