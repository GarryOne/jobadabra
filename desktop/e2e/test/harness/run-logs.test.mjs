// Every suite's artifacts say what the run reached (lib/run-logs.mjs, called by lib/app.mjs keepLogs at each app's close): notion-requests.log and
// store-call.log are always there, empty when nothing was asked, and a suite's own store calls (lib/store-call.mjs) are logged with the store and Notion host.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {KEPT_LOGS, keepRunLogs, logStoreCall} from '../../lib/run-logs.mjs';
import {storeCall} from '../../lib/store-call.mjs';

const temp = prefix => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const lines = file => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);

test('a run that asked nothing still leaves both logs in its artifacts, empty', () => {
  const profile = temp('jp-run-logs-'), artifacts = temp('jp-run-logs-art-');
  fs.mkdirSync(path.join(profile, 'logs'));
  fs.writeFileSync(path.join(profile, 'logs', 'app.log'), 'one line\n');
  assert.deepEqual(keepRunLogs(profile, artifacts), {'notion-requests.log': 0, 'store-call.log': 0});
  for (const name of [...KEPT_LOGS, 'app.log']) assert.ok(fs.existsSync(path.join(artifacts, 'logs', name)), `${name} is in the artifacts`);
});

test('the app\'s Notion requests are kept and counted', () => {
  const profile = temp('jp-run-logs-'), artifacts = temp('jp-run-logs-art-');
  fs.mkdirSync(path.join(profile, 'logs'));
  fs.writeFileSync(path.join(profile, 'logs', 'notion-requests.log'), 'a\tGET\t/v1/users/me\t200\nb\tPOST\t/v1/search\t200\n');
  assert.equal(keepRunLogs(profile, artifacts)['notion-requests.log'], 2);
});

test('a store call is logged with its store and Notion host, never its arguments', () => {
  const profile = temp('jp-run-logs-');
  logStoreCall(profile, {entity: 'applications', method: 'create', store: 'sqlite', ok: true});
  logStoreCall(profile, {entity: 'events', method: 'add', store: 'standin', notionUrl: 'http://127.0.0.1:51234', ok: false, error: 'store events.add: refused\nmore'});
  logStoreCall(profile, {entity: 'texts', method: 'get', store: 'notion', ok: true});
  const [mac, standIn, real] = lines(path.join(profile, 'logs', 'store-call.log')).map(line => line.split('\t').slice(1));
  assert.deepEqual(mac, ['applications.create', 'store=sqlite', 'notion=none', 'ok']);
  assert.deepEqual(standIn, ['events.add', 'store=standin', 'notion=127.0.0.1:51234', 'failed: store events.add: refused']);
  assert.deepEqual(real, ['texts.get', 'store=notion', 'notion=api.notion.com', 'ok'], 'the real workspace is named as such');
});

test('ctx.data writes its line through the real engine command, and the engine is told the request log', async () => {
  const profile = temp('jp-run-logs-');
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({store: 'sqlite'}));
  await storeCall({profile, store: 'sqlite', token: ''}, 'applications', 'list', {});
  assert.deepEqual(lines(path.join(profile, 'logs', 'store-call.log')).map(line => line.split('\t').slice(1, 4)), [['applications.list', 'store=sqlite', 'notion=none']]);
});

test('every suite gets them: the app\'s close (lib/app.mjs keepLogs) keeps the logs through keepRunLogs', () => {
  const source = fs.readFileSync(path.join(path.resolve(import.meta.dirname, '..'), '..', 'lib', 'app.mjs'), 'utf8');
  const keepLogs = source.slice(source.indexOf('const keepLogs'), source.indexOf('close: async'));
  assert.match(keepLogs, /keepRunLogs\(profile, ARTIFACTS\)/);
  assert.match(source.slice(source.indexOf('close: async')), /keepLogs\(\)/, 'close() runs keepLogs');
});
