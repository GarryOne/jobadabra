// Crash reports to Sentry (lib/sentry.js): the DSN, what an event holds and does not, scrubbing, rate limits, and the off switches.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as sentry from '../lib/sentry.js';

const DSN = 'https://abc123@o1.ingest.de.sentry.io/4500001';

test('extension exceptions use safe diagnostics, filename-only frames and a one-minute limit', () => {
  const sent = [];
  let time = 0, on = true;
  const client = sentry.create({dsn: DSN, release: 'job-pilotto@1.2', installId: 'install-test', now: () => time,
    enabled: () => on, fetcher: (url, init) => { sent.push(init.body); return Promise.resolve(); }});
  client.note('PAGE_TEXT_CANARY');
  const fields = {type: 'TypeError', message: 'PAGE_TEXT_CANARY https://private.example/URL_CANARY',
    stack: 'at fill.js:42:7\nat flow.js:91:3', extVersion: '0.9.12', host: 'URL_CANARY', logLines: ['PAGE_TEXT_CANARY']};
  assert.equal(client.capture('extension_error', fields), true);
  assert.equal(client.capture('extension_error', fields), false, 'also deduplicates at time zero');
  time = 59_999;
  assert.equal(client.capture('extension_error', fields), false);
  time = 60_000;
  assert.equal(client.capture('extension_error', fields), true);
  on = false;
  time += 60_000;
  assert.equal(client.capture('extension_error', fields), false);
  assert.equal(sent.length, 2);
  const event = JSON.parse(sent[0].split('\n')[2]);
  assert.equal(event.tags.source, 'extension');
  assert.equal(event.tags.extVersion, '0.9.12');
  assert.equal(event.release, 'job-pilotto@1.2');
  assert.equal(event.user.id, 'install-test');
  assert.equal(event.exception.values[0].type, 'TypeError');
  assert.deepEqual(event.exception.values[0].stacktrace.frames.map(f => [f.filename, f.lineno]), [['flow.js', 91], ['fill.js', 42]]);
  assert.doesNotMatch(sent.join(''), /PAGE_TEXT_CANARY|URL_CANARY|private\.example|attachment|breadcrumbs/);
});

test('a DSN gives the envelope and minidump addresses; anything else is off', () => {
  const target = sentry.parseDsn(DSN);
  assert.equal(target.envelope, 'https://o1.ingest.de.sentry.io/api/4500001/envelope/');
  assert.equal(target.minidump, 'https://o1.ingest.de.sentry.io/api/4500001/minidump/?sentry_key=abc123');
  assert.match(target.auth, /sentry_key=abc123/);
  for (const bad of ['', 'not a url', 'https://o1.ingest.sentry.io/4500001', 'https://k@o1.ingest.sentry.io/abc']) assert.equal(sentry.parseDsn(bad), null, bad);
});

test('a crash becomes an exception with frames (oldest first, no folders above the app); a run failure becomes a message with its last lines', () => {
  const stack = ['TypeError: x is not a function', '    at render (/Users/ada/Job Pilotto.app/Contents/Resources/app.asar/renderer/pages/jobs.js:120:14)',
    '    at async load (file:///Users/ada/Job Pilotto.app/Contents/Resources/app.asar/lib/pipeline.js:9:3)', '    at node:internal/process/task_queues:95:5'].join('\n');
  const crash = sentry.buildEvent('crash', {type: 'TypeError', message: 'x is not a function', stack, where: 'window'}, {release: 'job-pilotto@0.5.250', installId: 'inst-1', os: '27.2.0'});
  const [value] = crash.exception.values;
  assert.equal(value.type, 'TypeError');
  assert.deepEqual(value.stacktrace.frames.map(f => f.filename), ['node:internal/process/task_queues', 'app.asar/lib/pipeline.js', 'app.asar/renderer/pages/jobs.js'].map(name => name));
  assert.equal(value.stacktrace.frames.at(-1).lineno, 120);
  assert.ok(!JSON.stringify(crash).includes('/Users/ada'), 'no home folder anywhere in the event');
  assert.deepEqual([crash.level, crash.release, crash.user], ['fatal', 'job-pilotto@0.5.250', {id: 'inst-1'}]);
  const failed = sentry.buildEvent('run_failed', {job: 'src daily run', error: 'stopped by the app: no output for 16 min', timedOut: 'no output for 16 min',
    tail: ['a', 'b', 'Open /Users/ada/cv.pdf', 'd', 'e', 'f']}, {});
  assert.match(failed.message, /^run_failed · src daily run: stopped by the app/);
  assert.equal(failed.tags.timedOut, 'yes');
  assert.equal(failed.extra.tail.length, 5);
  assert.ok(!JSON.stringify(failed).includes('/Users/ada'));
});

test('secrets, emails and numbers in a message are scrubbed, and numbers do not split one problem into many', () => {
  const event = sentry.buildEvent('run_failed', {job: 'src daily', error: 'Notion 401 for ada@example.com with sk-ant-abc123def456 after 42 s'}, {});
  assert.doesNotMatch(event.message, /ada@example\.com|sk-ant/);
  const a = sentry.buildEvent('run_failed', {job: 'src daily', error: 'timed out after 30 s'}, {}), b = sentry.buildEvent('run_failed', {job: 'src daily', error: 'timed out after 31 s'}, {});
  assert.deepEqual(a.fingerprint, b.fingerprint);
});

test('the envelope is three JSON lines; capture sends once per problem per 10 minutes, honours the switch, and never throws', async () => {
  let t = 1_000_000;
  const sent = [];
  let on = true;
  const client = sentry.create({dsn: DSN, release: 'r', installId: 'i', enabled: () => on, now: () => t, fetcher: async (url, init) => { sent.push([url, init]); return {ok: true}; }});
  assert.equal(client.active, true);
  assert.equal(client.capture('stuck', {action: 'x'}), true);
  assert.equal(client.capture('stuck', {action: 'x'}), false, 'the same problem again within 10 minutes');
  t += 11 * 60_000;
  assert.equal(client.capture('stuck', {action: 'x'}), true);
  assert.equal(client.capture('health', {}), false, 'kinds that are not problems are never sent');
  on = false;
  assert.equal(client.capture('crash', {message: 'y'}), false, 'Technical reports off: nothing');
  on = true;
  const lines = sent[0][1].body.trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual([Object.keys(lines[0]).sort(), lines[1].type], [['dsn', 'event_id', 'sent_at'], 'event']);
  assert.equal(sent[0][0], 'https://o1.ingest.de.sentry.io/api/4500001/envelope/');
  assert.equal(sentry.create({dsn: ''}).capture('crash', {message: 'z'}), false, 'no DSN: off');
  const failing = sentry.create({dsn: DSN, fetcher: () => { throw new Error('offline'); }});
  assert.doesNotThrow(() => failing.capture('crash', {message: 'q'}));
});

test('native crashes go to the minidump address with only the version and install id; no DSN, no reporter', () => {
  const started = [];
  assert.equal(sentry.startNativeCrashes({start: options => started.push(options)}, {dsn: DSN, release: 'job-pilotto@1', installId: 'i'}), true);
  assert.equal(started[0].submitURL, 'https://o1.ingest.de.sentry.io/api/4500001/minidump/?sentry_key=abc123');
  assert.deepEqual(started[0].extra, {release: 'job-pilotto@1', install: 'i'});
  assert.equal(sentry.startNativeCrashes({start() { throw new Error('x'); }}, {dsn: DSN}), false);
  assert.equal(sentry.startNativeCrashes({start() {}}, {dsn: ''}), false);
});

test('the trail keeps the last 25 step names and rides on the next report; a run log is attached only when given, scrubbed', () => {
  const sent = [];
  const client = sentry.create({dsn: DSN, release: 'job-pilotto@1', installId: 'i', fetcher: (...args) => { sent.push(args); return Promise.resolve(); }});
  for (let n = 0; n < 30; n++) client.note('page_view', {page: `p${n}`});
  client.capture('run_failed', {job: 'src daily', error: 'boom', logLines: ['ok line', 'mail igor@example.com failed with key sk-ant-abc123', '/Users/igor/job-pilotto/x.py']});
  const parts = sent[0][1].body.split('\n');
  const event = JSON.parse(parts[2]);
  assert.equal(event.breadcrumbs.values.length, 25);
  assert.equal(event.breadcrumbs.values.at(-1).message, 'page_view: p29');
  const header = JSON.parse(parts[3]);
  assert.equal(header.type, 'attachment');
  const body = parts.slice(4).join('\n');
  assert.doesNotMatch(body, /igor@example|sk-ant|\/Users\/igor/);
  assert.match(body, /<email>/);
  client.capture('stuck', {action: 'wait'});
  assert.equal(sent[1][1].body.includes('"type":"attachment"'), false, 'no log lines given: no attachment');
});

test('an end-to-end report names its suite and says whether that suite makes failures on purpose', async () => {
  const {e2eTags, buildEvent} = await import('../lib/sentry.js');
  assert.deepEqual(e2eTags({JOB_PILOTTO_E2E_SUITE: 'jobs'}), {suite: 'jobs', expected: 'no'});
  assert.deepEqual(e2eTags({JOB_PILOTTO_E2E_SUITE: 'activity', JOB_PILOTTO_E2E_EXPECTS_FAILURES: '1'}), {suite: 'activity', expected: 'yes'});
  assert.deepEqual(e2eTags({}), {}, 'a user install adds nothing');
  assert.equal(buildEvent('run_failed', {message: 'x'}, {tags: {suite: 'jobs', expected: 'no'}}).tags.expected, 'no');
});
