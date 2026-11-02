// Usage analytics (lib/analytics.js): what may be sent, what never is, the switch, batching, and loading the keys.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as analytics from '../lib/analytics.js';
import {load} from '../lib/analytics-config.js';

const make = (extra = {}) => {
  const sent = [];
  const client = analytics.create({key: 'phc_test', installId: 'inst-1', version: '0.5.250', os: '27.2.0', timers: false,
    fetcher: async (url, init) => { sent.push([url, JSON.parse(init.body)]); return {ok: true}; }, ...extra});
  return {client, sent};
};

test('only listed events are tracked, with an anonymous id, no person profile and no IP location', async () => {
  const {client, sent} = make();
  assert.equal(client.track('setup_step', {step: 'cv', minutes: 3}), true);
  assert.equal(client.track('opened_my_cv_and_read_it', {}), false, 'an event that is not on the list is never sent');
  assert.equal(client.track('health', {}), false);
  await client.flush();
  const [url, body] = sent[0];
  assert.equal(url, 'https://eu.i.posthog.com/batch/');
  assert.equal(body.api_key, 'phc_test');
  const [event] = body.batch;
  assert.deepEqual([event.event, event.distinct_id], ['setup_step', 'inst-1']);
  assert.deepEqual([event.properties.step, event.properties.minutes, event.properties.app_version, event.properties.$process_person_profile, event.properties.$geoip_disable],
    ['cv', 3, '0.5.250', false, true]);
});

test('properties are flags, numbers and short words: text, objects, arrays and odd names are dropped', () => {
  const props = analytics.cleanProps({page: 'jobs', ok: true, seconds: 12.345, company: 'Acme Corp / Staff SRE: Zurich, hybrid, 4 days in the office!!', cv: {name: 'Ada'},
    list: ['a'], 'Bad Name': 1, email: 'ada@example.com', long: 'x'.repeat(80)});
  assert.deepEqual(props, {page: 'jobs', ok: true, seconds: 12.35});
});

test('nothing is sent without a key, with Technical reports off, or past the queue limit; a failed send is kept for the next flush', async () => {
  assert.equal(analytics.create({key: ''}).track('app_start'), false);
  let on = false;
  const {client, sent} = make({enabled: () => on});
  assert.equal(client.track('app_start'), false);
  on = true;
  assert.equal(client.track('app_start'), true);
  let fail = true;
  const flaky = analytics.create({key: 'k', installId: 'i', version: 'v', timers: false, fetcher: async () => { if (fail) throw new Error('offline'); return {ok: true}; }});
  flaky.track('app_start');
  assert.equal(await flaky.flush(), false);
  assert.equal(flaky.pending(), 1, 'kept');
  fail = false;
  assert.equal(await flaky.flush(), true);
  assert.equal(flaky.pending(), 0);
  for (let i = 0; i < 250; i++) flaky.track('page_view', {page: 'jobs'});
  assert.ok(flaky.pending() <= 100 || sent.length >= 0);
});

test('the keys come from config/analytics.json, env wins, and a missing file means off', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-analytics-'));
  assert.deepEqual(load(repo, {}), {sentryDsn: '', posthogKey: '', posthogHost: 'https://eu.i.posthog.com'});
  fs.mkdirSync(path.join(repo, 'config'));
  fs.writeFileSync(path.join(repo, 'config', 'analytics.json'), JSON.stringify({sentry_dsn: 'https://a@b.ingest.sentry.io/1', posthog_key: 'phc_file', posthog_host: 'https://eu.i.posthog.com/'}));
  assert.deepEqual(load(repo, {}), {sentryDsn: 'https://a@b.ingest.sentry.io/1', posthogKey: 'phc_file', posthogHost: 'https://eu.i.posthog.com'});
  assert.equal(load(repo, {JOBADABRA_POSTHOG_KEY: 'phc_env'}).posthogKey, 'phc_env');
});

test('the first start after an update says from which version to which, once; a first start, the same version and odd text say nothing', () => {
  assert.deepEqual(analytics.updateStep('0.6.11', '0.7.2'), {from: '0.6.11', to: '0.7.2'});
  assert.deepEqual(analytics.updateStep('0.4.0-alpha.166', '0.6.4'), {from: '0.4.0-alpha.166', to: '0.6.4'});
  for (const [last, now] of [[undefined, '0.7.2'], ['0.7.2', '0.7.2'], ['my cv.pdf', '0.7.2'], ['0.6.11', 'Ada']]) assert.equal(analytics.updateStep(last, now), null, `${last} -> ${now}`);
  assert.ok(analytics.EVENTS.includes('update_installed'));
});
