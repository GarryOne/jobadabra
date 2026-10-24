import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {handleUpdate} from '../shared/worker/index.js';
import * as pipeline from '../lib/pipeline.js';
import {due, mailDue, nextAt, nextMailAt, startSchedule} from '../lib/schedule.js';
import {createStorage} from '../lib/storage.js';
import * as telegram from '../lib/telegram.js';

const fakeCrypto = {encrypt: v => Buffer.from(v).toString('base64'), decrypt: s => Buffer.from(s, 'base64').toString()};
const tempStorage = () => createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-')), fakeCrypto);
const HOUR = 3600 * 1000;

test('a search is due every 4 hours after the first one, unless switched off', () => {
  const now = Date.parse('2026-09-27T12:00:00Z');
  assert.equal(due({setupDone: false}, now), false);
  assert.equal(due({setupDone: true}, now), false);  // the first search starts when setup finishes, not by timer
  assert.equal(due({setupDone: true, lastSearchAt: new Date(now - 3 * HOUR).toISOString()}, now), false);
  assert.equal(due({setupDone: true, lastSearchAt: new Date(now - 5 * HOUR).toISOString()}, now), true);
  assert.equal(due({setupDone: true, autoSearch: false}, now), false);
});

test('the next search time shows in the activity bar, and a scheduled search is announced before it starts', async () => {
  const last = Date.parse('2026-09-27T12:00:00Z');
  assert.equal(nextAt({setupDone: true, lastSearchAt: new Date(last).toISOString()}), last + 4 * HOUR);
  assert.equal(nextAt({setupDone: true, lastSearchAt: new Date(last).toISOString(), cloud: {repo: 'a/b'}}), null);
  const events = [];
  const settings = {setupDone: true, lastSearchAt: new Date(Date.now() - 5 * HOUR).toISOString()};
  const storage = {settings: () => settings};
  const schedule = startSchedule(storage, {
    search: async () => { events.push('search'); settings.lastSearchAt = new Date().toISOString(); },
    mail: async () => { events.push('mail'); settings.lastMailAt = new Date().toISOString(); },
  }, null, {soon: () => events.push('soon'), headsUp: 0, firstCheck: 0});
  // Wait for the three steps, not a fixed 50 ms: under a busy machine (the pre-push hook runs every suite at once) 50 ms was too short.
  for (const until = Date.now() + 2000; events.length < 3 && Date.now() < until;) await new Promise(resolve => setTimeout(resolve, 10));
  schedule.stop();
  assert.deepEqual(events, ['soon', 'search', 'mail']);  // no Gmail check yet: the first one runs right away
});

test('the app checks Gmail at the chosen times of day while it is open, unless the cloud does it or it is off', () => {
  const at = (day, hour, minute = 0) => new Date(2026, 8, day, hour, minute).getTime();  // local time, like the setting
  const base = {setupDone: true};
  // 3 times a day (default): 07, 12, 18. Last check 12:05 -> next 18:00; due from then on.
  const checked = {...base, lastMailAt: new Date(at(28, 12, 5)).toISOString()};
  assert.equal(nextMailAt(checked, at(28, 13)), at(28, 18));
  assert.equal(mailDue(checked, at(28, 17, 59)), false);
  assert.equal(mailDue(checked, at(28, 18, 1)), true);
  // After the Mac was off overnight: the missed 18:00 is due at once.
  assert.equal(mailDue(checked, at(29, 8)), true);
  // Once a day: 08:00.
  assert.equal(nextMailAt({...checked, schedule: {mail: 1}}, at(28, 13)), at(29, 8));
  assert.equal(mailDue(base, at(28, 13)), true);  // never checked: soon after setup
  assert.equal(nextMailAt({...base, schedule: {mail: 0}}, at(28, 13)), null);
  assert.equal(nextMailAt({...base, cloud: {repo: 'a/b'}}, at(28, 13)), null);
  assert.equal(nextMailAt({setupDone: false}, at(28, 13)), null);
});

test('a Gmail check looks back far enough to cover the time since the last good check', () => {
  const storage = tempStorage();
  assert.deepEqual(pipeline.mailArgs(storage), ['src.ai.mail', '--days', '2', '--log-run']);
  const now = Date.parse('2026-09-28T12:00:00Z');
  storage.saveSettings({lastMailOkAt: '2026-09-23T12:00:00Z'});
  assert.deepEqual(pipeline.mailArgs(storage, now), ['src.ai.mail', '--days', '6', '--log-run']);
  storage.saveSettings({lastMailOkAt: '2026-08-01T12:00:00Z'});
  assert.deepEqual(pipeline.mailArgs(storage, now), ['src.ai.mail', '--days', '14', '--log-run']);
  storage.setSecret('TELEGRAM_BOT_TOKEN', '1:abc');
  storage.saveSettings({telegramChatId: '42', lastMailOkAt: '2026-09-28T07:00:00Z'});
  assert.deepEqual(pipeline.mailArgs(storage, now), ['src.ai.mail', '--days', '2', '--send', '--log-run']);
});

test('every mode that runs AI steps has the 3-minute budget (the first run follow-up, mode today, had none)', () => {
  const storage = tempStorage();
  storage.setSecret('ANTHROPIC_API_KEY', 'sk-ant-x');
  // The class is the engine's own list of crawl modes (src/notion/cron_report.py CRAWL_MODES): a new one fails here until it has the budget.
  const crawl = fs.readFileSync(new URL('../../src/notion/cron_report.py', import.meta.url), 'utf8').match(/CRAWL_MODES = \{([^}]*)\}/)[1].match(/'(\w+)'/g).map(m => m.slice(1, -1));
  assert.deepEqual([...crawl].sort(), ['run', 'scheduled', 'today']);
  for (const mode of crawl) {
    const args = pipeline.dailyArgs(storage, {mode});
    assert.ok(args.includes('--score-max'), `${mode} scores`);
    assert.equal(args[args.indexOf('--budget') + 1], '180', `${mode} stops its AI steps at 3 minutes`);
  }
});

test('Telegram actions run the same pipeline command as the GitHub workflow', () => {
  const storage = tempStorage();
  assert.deepEqual(pipeline.dailyArgs(storage, {mode: 'today'}), ['src', 'daily', '--mode', 'today', '--log-run']);
  storage.setSecret('ANTHROPIC_API_KEY', 'sk-ant-x');
  storage.setSecret('TELEGRAM_BOT_TOKEN', '1:abc');
  storage.saveSettings({telegramChatId: '42'});
  assert.deepEqual(pipeline.dailyArgs(storage, {mode: 'scheduled'}),
    ['src', 'daily', '--mode', 'scheduled', '--send', '--log-run', '--enrich-max', '100', '--score-max', '60', '--budget', '180', '--insight']);
  assert.deepEqual(pipeline.dailyArgs(storage, {mode: 'apply', job: 'ab12cd34', action: 'saved'}),
    ['src', 'daily', '--mode', 'apply', '--send', '--log-run', '--job', 'ab12cd34', '--action', 'saved']);
  assert.deepEqual(pipeline.dailyArgs(storage, {mode: 'more', seed: 7, page: 2}),
    ['src', 'daily', '--mode', 'more', '--send', '--log-run', '--page', '2', '--seed', '7']);
  // A recruiter's message: add mode without a job; already talking -> Screening.
  assert.deepEqual(pipeline.dailyArgs(storage, {mode: 'add', note: 'Hi, a remote SRE role…', talking: true}),
    ['src', 'daily', '--mode', 'add', '--send', '--log-run', '--action', 'talking', '--note', 'Hi, a remote SRE role…']);
  // A screenshot for a job you picked.
  assert.deepEqual(pipeline.dailyArgs(storage, {mode: 'add', file: '/tmp/shot.png', target: 'https://x.test/1'}),
    ['src', 'daily', '--mode', 'add', '--send', '--log-run', '--target', 'https://x.test/1', '--file', '/tmp/shot.png']);
  // Applied elsewhere: who reached out first (a recruiter wrote first = inbound) goes along.
  assert.deepEqual(pipeline.dailyArgs(storage, {mode: 'add', job: 'https://x.test/1', note: '2026-09-23', origin: 'inbound'}),
    ['src', 'daily', '--mode', 'add', '--send', '--log-run', '--job', 'https://x.test/1', '--action', 'applied', '--note', '2026-09-23', '--origin', 'inbound']);
  // Add a job: the find path. --action is the shared default; import mode does not mark the job Applied.
  assert.deepEqual(pipeline.dailyArgs(storage, {mode: 'import', job: 'https://boards.greenhouse.io/acme/jobs/1'}),
    ['src', 'daily', '--mode', 'import', '--send', '--log-run', '--job', 'https://boards.greenhouse.io/acme/jobs/1', '--action', 'applied']);
});

test('pairing waits for Start in a private chat, then greets the user', async () => {
  const sent = [];
  let polls = 0;
  const fetcher = async (url, init) => {
    const method = url.split('/').pop();
    const body = JSON.parse(init.body);
    sent.push([method, body]);
    const ok = result => new Response(JSON.stringify({ok: true, result}));
    if (method === 'getMe') return ok({username: 'my_pilot_bot'});
    if (method === 'getUpdates') {
      polls += 1;
      return ok(polls === 1 ? [{update_id: 5, message: {chat: {id: 99, type: 'group'}, text: '/start'}}]
        : polls === 2 ? [{update_id: 6, message: {chat: {id: 42, type: 'private'}, text: '/start'}}] : []);
    }
    return ok({});
  };
  const result = await telegram.pair('1:abc', 5, fetcher);
  assert.deepEqual(result, {chatId: '42', username: 'my_pilot_bot'});
  assert.equal(sent.find(([m]) => m === 'sendMessage')[1].chat_id, 42);
});

test('a bot with a webhook is refused with a clear message', async () => {
  const fetcher = async url => new Response(JSON.stringify(url.endsWith('getMe') ? {ok: true, result: {username: 'b'}}
    : {ok: false, error_code: 409, description: 'Conflict: can\'t use getUpdates method while webhook is active'}));
  await assert.rejects(telegram.pair('1:abc', 5, fetcher), /webhook/);
});

test('the Worker\'s command handling runs locally through the app\'s dispatch', async () => {
  const dispatched = [];
  const replies = [];
  globalThis.fetch = async (url, init) => { replies.push(JSON.parse(init.body)); return new Response(JSON.stringify({ok: true, result: {}})); };
  const env = {TELEGRAM_BOT_TOKEN: '1:abc', OWNER_CHAT_ID: '42', dispatch: async (inputs, workflow) => dispatched.push([inputs, workflow])};
  await handleUpdate(env, {message: {chat: {id: 42}, text: '/run'}});
  await handleUpdate(env, {message: {chat: {id: 7}, text: '/run'}}); // a stranger: ignored
  assert.deepEqual(dispatched, [[{mode: 'run'}, undefined]]);
  assert.match(replies[0].text, /Crawling now/);
});

test('app buttons run the Telegram commands; without Telegram the answer only comes back to the window', async () => {
  const storage = tempStorage();
  let called = 0;
  const result = await telegram.runCommand(storage, 'status', '', () => {}, async () => { called += 1; return new Response('{}'); });
  assert.match(result.text, /No search yet/);
  assert.equal(result.telegram, false);
  assert.equal(called, 0);
  assert.equal(telegram.plainText('<b>Hi</b> &amp; <a href="x">link</a>'), 'Hi & link');
});

test('a taken extension port is reported, not a crash', async () => {
  const net = await import('node:net');
  const server = await import('../lib/server.js');
  const blocker = net.createServer();
  const taken = await new Promise(resolve => blocker.once('error', () => resolve(true))
    .listen(server.PORT, '127.0.0.1', () => resolve(false)));
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-port-')), {encrypt: s => s, decrypt: s => s});
  const error = await new Promise(resolve => server.start(storage, resolve));  // port busy: blocker or another app
  assert.equal(error.code, 'EADDRINUSE');
  if (!taken) blocker.close();
});

test('pairing hands the extension connection only to the Jobadabra extension', async () => {
  const server = await import('../lib/server.js');
  const manifest = JSON.parse(fs.readFileSync(new URL('../../extension/manifest.json', import.meta.url)));
  const {createHash} = await import('node:crypto');
  const id = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32)
    .replace(/[0-9a-f]/g, c => 'abcdefghijklmnop'[parseInt(c, 16)]);
  assert.ok(server.EXTENSION_IDS.includes(id), 'the manifest key\'s ID is one the app trusts');
  for (const trusted of server.EXTENSION_IDS) assert.equal(server.ownOrigin(`chrome-extension://${trusted}`), `chrome-extension://${trusted}`);
  assert.equal(server.ownOrigin('chrome-extension://abcdefghijklmnopabcdefghijklmnop'), '');
  assert.equal(server.ownOrigin('https://evil.example'), '');
  assert.equal(server.ownOrigin(undefined), '');
});

test('one-off jobs from the Actions page are tracked with a readable result line', async () => {
  const pipeline = await import('../lib/pipeline.js');
  assert.equal(pipeline.taskSummary('insight', ['AI budget: ok', 'Insight sent: Skills — Go is in 40% of your matches (0.012 USD)', 'Cronjob run logged: https://x']),
    'Skills — Go is in 40% of your matches');
  assert.equal(pipeline.taskSummary('insight', ['Insight: nothing new today (0.004 USD)']), 'nothing new today');
  assert.equal(pipeline.taskSummary('weekly', ['Weekly report sent: Replies doubled (0.020 USD)']), 'Replies doubled');
  assert.equal(pipeline.taskSummary('scout', ['🔎 <b>Source scout</b> · checked 15 · 🆕 2 new sources']), 'checked 15 · 🆕 2 new sources');
  assert.equal(pipeline.taskSummary('today', ['', "Digest ready: 12 jobs, 3 new. Telegram isn't connected, so nothing was sent."]),
    "Digest ready: 12 jobs, 3 new. Telegram isn't connected, so nothing was sent.");
  assert.equal(pipeline.taskSummary('today', ['nothing matching']), null);
  assert.equal(pipeline.taskName('insight'), 'Insight');
  assert.equal(pipeline.taskName('mail'), 'Gmail check');
});

test('without Telegram, a job\'s message is read from its output and the replies say it shows in the app', async () => {
  const pipeline = await import('../lib/pipeline.js');
  const log = ['Scouting…', '<<<message', '🔎 <b>Source scout</b> · checked 15 · 🆕 1 new source', '1. <b>Acme &amp; Co</b> · Greenhouse', 'message>>>', 'Cronjob run logged: https://n'];
  assert.equal(pipeline.appMessage(log), '🔎 Source scout · checked 15 · 🆕 1 new source\n1. Acme & Co · Greenhouse');
  assert.equal(pipeline.appMessage(['no message here']), null);
  assert.equal(telegram.inApp('💡 Looking at the market and your applications; the insight arrives in about a minute.'),
    '💡 Looking at the market and your applications; the insight shows here in about a minute.');
  assert.equal(telegram.inApp('📋 Sending the current list in about a minute.'), "📋 Preparing today's list; it shows here in about a minute.");
});

test('Telegram HTML shows as readable text everywhere the app shows output', () => {
  assert.equal(pipeline.readable("• Gap notes repeat &#x27;Staff level is a step above candidate&#x27;s title&#x27;"),
    "• Gap notes repeat 'Staff level is a step above candidate's title'");
  assert.equal(pipeline.readable('💡 <b>Insight · Seniority</b> &amp; <i>Confidence medium</i>'), '💡 Insight · Seniority & Confidence medium');
  assert.equal(pipeline.readable('<a href="https://notion.so/x">In Notion</a>'), 'In Notion (https://notion.so/x)');
  assert.equal(pipeline.readable('<<<message'), '<<<message');  // the app's own markers and a log's "<" stay
  assert.equal(pipeline.readable('score < 50 → skip'), 'score < 50 → skip');
  assert.equal(pipeline.appMessage(['<<<message', '<b>Seniority</b>', 'candidate&#x27;s title', 'message>>>']), "Seniority\ncandidate's title");
});

test('the queue survives quitting: saved with how to start each job again, emptied as they finish', async () => {
  const storage = tempStorage();
  // Two tasks clicked together: the second waits for the first. Both fail fast (no such module), that's fine here.
  const first = pipeline.task(storage, 'insight', ['src.no_such_module_a'], () => {});
  const second = pipeline.task(storage, 'weekly', ['src.no_such_module_b'], () => {});
  const saved = JSON.parse(storage.readText('queue.json'));
  assert.deepEqual(saved.map(job => [job.kind, job.trigger, job.resume.args[0]]),
    [['insight', 'you', 'src.no_such_module_a'], ['weekly', 'you', 'src.no_such_module_b']]);
  await Promise.all([first, second]);
  assert.deepEqual(JSON.parse(storage.readText('queue.json')), []);
  await pipeline.whenIdle(10);  // nothing runs, nothing waits
});

test('at the next start the saved jobs are handed back once, and entries without a way to start them are dropped', () => {
  const storage = tempStorage();
  storage.writeText('queue.json', JSON.stringify([
    {kind: 'insight', trigger: 'you', resume: {args: ['src', 'daily', '--mode', 'insight']}, interrupted: true},
    {kind: 'mail', trigger: 'schedule', resume: {}},
    {kind: 'weekly', trigger: 'you'},  // older file without resume: dropped
  ]));
  assert.deepEqual(pipeline.takeQueue(storage).map(job => job.kind), ['insight', 'mail']);
  assert.deepEqual(pipeline.takeQueue(storage), []);  // taken: not started twice
});

test('Find new employers runs on this Mac on its schedule (after the first search), not when Always on runs it', async () => {
  const {nextScoutAt, scoutDue} = await import('../lib/schedule.js');
  const base = {setupDone: true, lastSearchAt: '2026-09-28T10:00:00Z', schedule: {scout: 'daily'}};
  assert.equal(nextScoutAt({...base, schedule: undefined}), null);  // new installs: off, the central index replaces it
  assert.equal(nextScoutAt({...base, lastSearchAt: null}), null);  // not before the first search
  assert.equal(scoutDue(base, Date.parse('2026-09-28T10:05:00Z')), true);  // never run: due now
  const daily = {...base, lastScoutAt: '2026-09-28T12:00:00Z'};
  assert.equal(scoutDue(daily, Date.parse('2026-09-29T11:00:00Z')), false);
  assert.equal(scoutDue(daily, Date.parse('2026-09-29T12:01:00Z')), true);
  assert.equal(nextScoutAt({...daily, schedule: {scout: 'weekly'}}), Date.parse('2026-10-05T12:00:00Z'));
  assert.equal(nextScoutAt({...daily, schedule: {scout: 'off'}}), null);
  assert.equal(nextScoutAt({...daily, cloud: {repo: 'me/job-pilotto-private'}}), null);  // GitHub runs it
});

test('Find new employers: the result line is the card\'s second line, as well as the older wording', async () => {
  const pipeline = await import('../lib/pipeline.js');
  assert.equal(pipeline.taskSummary('scout', ['Cronjob run logged: x', '7 checked · 2 new sources', 'other']), '7 checked · 2 new sources');
  assert.equal(pipeline.taskSummary('scout', ['🔎 Source scout · checked 7 · 🆕 2 new sources']), 'checked 7 · 🆕 2 new sources');
  assert.equal(pipeline.taskSummary('scout', ['nothing relevant']), null);
});

test('Always on: jobs read in Chrome are scored by a run on this Mac that reads only them, sends no digest and closes nothing (mode today)', () => {
  const storage = tempStorage();
  storage.setSecret('ANTHROPIC_API_KEY', 'sk-ant-x');
  storage.setSecret('TELEGRAM_BOT_TOKEN', '1:abc');
  storage.saveSettings({telegramChatId: '42'});
  const args = pipeline.visitsArgs(storage);
  assert.deepEqual(args.slice(0, 4), ['src', 'daily', '--mode', 'today']);
  assert.ok(args.includes('--only-visits') && args.includes('--score-max'), args.join(' '));
  assert.ok(!args.includes('--send'), 'no Telegram digest for a few pages read in Chrome');
  const one = pipeline.visitsArgs(storage, 1);   // 7 Oct 2026: it read 41 other jobs with AI before scoring the one match
  const value = flag => one[one.indexOf(flag) + 1];
  assert.deepEqual([value('--enrich-max'), value('--score-max')], ['0', '1'], 'the matches scored, nothing else read');
});

test('a task queued first runs before the ones already waiting, after the one running', async () => {
  const order = [];
  let release;
  const running = pipeline.serial(() => new Promise(resolve => { order.push('running'); release = resolve; }));
  const long = pipeline.serial(async () => { order.push('find employers'); });
  const scoring = pipeline.serial(async () => { order.push('score Chrome jobs'); }, {first: true});
  await new Promise(resolve => setTimeout(resolve, 10));
  release();
  await Promise.all([running, long, scoring]);
  assert.deepEqual(order, ['running', 'score Chrome jobs', 'find employers']);
});
