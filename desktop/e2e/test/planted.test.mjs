// A failure planted on purpose marks itself where it is planted, so the app's Sentry reporter never sends what a test caused (16 Oct 2026: 98% of a month's Sentry quota
// was CI e2e). The class: every fake that serves a failure, plus the recall benchmark. A new fake that counts failures without marking them fails here.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {startAiProxy} from '../lib/ai-proxy.mjs';
import {startGoogleFake} from '../lib/google-fake.mjs';
import {startNotionProxy} from '../lib/notion-proxy.mjs';
import {startTelegramFake} from '../lib/telegram-fake.mjs';
import {HUNG_REPORTS, markPlanted, RECALL_REPORTS} from '../lib/planted.mjs';
import {causedByPlant} from '../../lib/planted.js';

const LIB = path.dirname(fileURLToPath(new URL('../lib/planted.mjs', import.meta.url)));

test('markPlanted writes the kinds a plant causes, and does nothing without a file', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-planted-')), 'planted.log');
  assert.equal(markPlanted('x', undefined, {}), false);
  const env = {JOB_PILOTTO_E2E: '1', JOB_PILOTTO_E2E_PLANTED_FILE: file};
  assert.equal(markPlanted('ai server-error', undefined, env, 1000), true);
  assert.equal(markPlanted('ai hang', HUNG_REPORTS, env, 1000), true);
  assert.equal(markPlanted('recall x', RECALL_REPORTS, env, 1000), true);
  const at = 1000 + 60_000;
  assert.equal(causedByPlant({kind: 'run_warning', message: 'AI limit'}, env, at), true);
  assert.equal(causedByPlant({kind: 'stuck', message: 'no output for 10 s'}, env, at), true);
  assert.equal(causedByPlant({kind: 'run_failed', message: ''}, env, at), true, 'a hung run the test stopped has no words');
  assert.equal(causedByPlant({kind: 'crash', message: 'Uncaught Error: recall planted error'}, env, at), true);
  assert.equal(causedByPlant({kind: 'crash', message: 'TypeError: real'}, env, at), false, 'a real crash in the same minute is sent');
  assert.equal(causedByPlant({kind: 'run_warning', message: 'AI limit'}, env, 1000 + 200_000), false, 'an old plant hides nothing');
});

test('an extension plant records its source and exact frame, hiding only that exception', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-extension-plant-'));
  const env = {JOB_PILOTTO_E2E: '1', JOB_PILOTTO_E2E_PLANTED_FILE: path.join(root, 'planted.log')};
  try {
    markPlanted('extension exception', {kinds: ['extension_error'], source: 'extension', frame: 'sentry-plant.js:3:'}, env, 1000);
    const report = {kind: 'extension_error', source: 'extension', message: 'Uncaught TypeError', stack: 'at sentry-plant.js:3:17'};
    assert.equal(causedByPlant(report, env, 2000), true);
    assert.equal(causedByPlant({...report, stack: 'at flow.js:3:17'}, env, 2000), false);
    assert.equal(causedByPlant({...report, source: 'window'}, env, 2000), false);
  } finally { fs.rmSync(root, {recursive: true, force: true}); }
});

test('every fake that serves a failure marks it planted', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-planted-')), 'planted.log');
  process.env.JOB_PILOTTO_E2E_PLANTED_FILE = file;
  const lines = () => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).length : 0);
  const ai = await startAiProxy(), notion = await startNotionProxy(), telegram = await startTelegramFake(), google = await startGoogleFake();
  try {
    const cases = [
      ['ai', async () => { ai.setMode('server-error'); await fetch(`${ai.url}/v1/messages`, {method: 'POST', body: '{}'}).then(r => r.text()); ai.setMode('pass'); }],
      ['notion', async () => { notion.fail('server-error'); await fetch(`${notion.url}/v1/users/me`).then(r => r.text()); notion.pass(); }],
      ['telegram', async () => { telegram.fail(Object.keys((await import('../lib/telegram-fake.mjs')).TELEGRAM_FAILURES)[0]); await fetch(`${telegram.url}/botx/sendMessage`, {method: 'POST', body: 'chat_id=1&text=a', headers: {'content-type': 'application/x-www-form-urlencoded'}}).then(r => r.text()); telegram.pass(); }],
      ['google', async () => { google.revoke(); await fetch(`${google.url}/oauth2.googleapis.com/token`, {method: 'POST'}).then(r => r.text()); google.pass(); }],
    ];
    for (const [name, serve] of cases) { const before = lines(); await serve(); assert.ok(lines() > before, `the ${name} fake served a failure and did not mark it planted`); }
  } finally { delete process.env.JOB_PILOTTO_E2E_PLANTED_FILE; await Promise.all([ai.close(), notion.close(), telegram.close(), google.close()]); }
});

test('a new fake or plant that counts failures cannot skip the mark', () => {
  for (const name of fs.readdirSync(LIB).filter(file => file.endsWith('.mjs'))) {
    const source = fs.readFileSync(path.join(LIB, name), 'utf8');
    if (!/\b(stats\.|control\.)failed\+\+/.test(source)) continue;
    assert.match(source, /markPlanted\(/, `${name} counts served failures (failed++) without markPlanted()`);
  }
  assert.match(fs.readFileSync(path.join(LIB, 'recall.mjs'), 'utf8'), /markPlanted\(/, 'the recall benchmark plants window errors and must mark them');
});
