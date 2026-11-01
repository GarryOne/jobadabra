// The outside heartbeat of the site's synthetic probes (src/heartbeat.js): a dead site, a wrong page, a dead probe feed or an old probe round is one Telegram line, told only on the :00 and
// :30 ticks; a healthy site says nothing; nothing it meets can throw out of the cron.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {LAST, SITE, STALE_MIN, heartbeat, heartbeatProblem, tellTick} from '../src/heartbeat.js';
import {runScheduled} from '../src/scheduler.js';

const NOW = new Date('2026-11-01T12:30:00Z');
const PAGE = '<html><title>Jobadabra: your job search on autopilot</title></html>';
const minutesAgo = n => new Date(NOW.getTime() - n * 60000).toISOString();
const site = (overrides = {}) => async url => {
  const answers = {[SITE]: PAGE, [LAST]: {at: minutesAgo(10)}, ...overrides};
  const answer = answers[String(url)];
  if (answer instanceof Response) return answer;
  if (answer === 'throw') throw new TypeError('network');
  if (answer === 'timeout') throw Object.assign(new Error('t'), {name: 'TimeoutError'});
  return typeof answer === 'string' ? new Response(answer) : Response.json(answer);
};

test('a healthy site, a recent round: no problem', async () => {
  assert.equal(await heartbeatProblem(NOW, site()), '');
  assert.equal(await heartbeatProblem(NOW, site({[LAST]: {at: minutesAgo(STALE_MIN)}})), '', 'exactly 45 minutes is still on time');
});

test('each way the outside view can be wrong is named in one sentence', async () => {
  assert.match(await heartbeatProblem(NOW, site({[SITE]: 'throw'})), /website does not answer \(unreachable\)/);
  assert.match(await heartbeatProblem(NOW, site({[SITE]: 'timeout'})), /website does not answer \(timeout\)/);
  assert.match(await heartbeatProblem(NOW, site({[SITE]: new Response('x', {status: 522})})), /website does not answer \(HTTP 522\)/);
  assert.match(await heartbeatProblem(NOW, site({[SITE]: '<title>Error 1101</title>'})), /not with the Jobadabra page/);
  assert.match(await heartbeatProblem(NOW, site({[LAST]: new Response('nope', {status: 404})})), /probe feed does not answer \(HTTP 404\)/);
  assert.match(await heartbeatProblem(NOW, site({[LAST]: {at: null}})), /no probe round on record/);
  assert.match(await heartbeatProblem(NOW, site({[LAST]: {at: minutesAgo(46)}})), /46 minutes old/);
});

test('told only on the :00 and :30 ticks, once per tick, and never when healthy', async () => {
  const told = [];
  const notify = async text => told.push(text);
  const dead = site({[SITE]: 'throw'});
  for (const minute of [0, 10, 20, 30, 40, 50]) {
    told.length = 0;
    await heartbeat(new Date(Date.UTC(2026, 10, 1, 12, minute)), {fetcher: dead, notify});
    assert.equal(told.length, tellTick(new Date(Date.UTC(2026, 10, 1, 12, minute))) ? 1 : 0, `minute ${minute}`);
  }
  told.length = 0;
  await heartbeat(NOW, {fetcher: site(), notify});
  assert.deepEqual(told, []);
  await heartbeat(NOW, {fetcher: dead, notify});
  assert.match(told[0], /^🚨 Jobadabra monitor, seen from outside the site: The website does not answer/);
});

test('a Telegram or fetch failure never throws out of the heartbeat', async () => {
  assert.equal(await heartbeat(NOW, {fetcher: site({[SITE]: 'throw'}), notify: async () => { throw new Error('telegram 500'); }}), '');
  assert.match(await heartbeat(NOW, {fetcher: async () => { throw new Error('boom'); }}), /website does not answer \(unreachable\)/, 'a throwing fetch is the outage it is, named, not an exception');
});

test('the ten-minute cron asks only when index.js hands it a fetcher, and only on that cron; the starts still happen', async () => {
  const asked = [], dispatched = [], told = [];
  const fetcher = async url => { asked.push(String(url)); return site({[SITE]: 'throw'})(url); };
  const run = (cron, extra = {}) => runScheduled({cron, scheduledTime: NOW.getTime()}, {}, {dispatch: async (env, inputs, workflow) => { dispatched.push(workflow); }, notify: async text => told.push(text), ...extra});
  await run('*/10 * * * *');
  assert.deepEqual(asked, [], 'no fetcher, no heartbeat (the existing tests never touch the network)');
  await run('0 2 * * *', {heartbeatFetch: fetcher});
  assert.deepEqual(asked, [], 'another cron does not ask');
  await run('*/10 * * * *', {heartbeatFetch: fetcher});
  assert.deepEqual(asked, [SITE]);
  assert.ok(dispatched.includes('pr-verdict.yml'), 'the verdict sweep still starts');
  assert.equal(told.length, 1);
});
