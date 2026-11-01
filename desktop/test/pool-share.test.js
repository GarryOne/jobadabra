// "Help the pool grow" is opt-in: off by default, nothing in the run environment or the user's GitHub repo until switched on.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as poolShare from '../lib/pool-share.js';
import {pipelineEnv} from '../lib/pipeline.js';
import * as github from '../lib/github.js';
import {createStorage} from '../lib/storage.js';

const fakeCrypto = {encrypt: v => Buffer.from(v).toString('base64'), decrypt: s => Buffer.from(s, 'base64').toString()};
const fresh = () => createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-')), fakeCrypto);

test('a new install shares by default; switched off, no variable reaches the run environment', () => {
  const storage = fresh();
  assert.equal(poolShare.on(storage), true);
  assert.equal(pipelineEnv(storage, {}).JOBADABRA_SHARE_EMPLOYERS, '1');
  poolShare.set(storage, false);
  assert.equal(poolShare.on(storage), false);
  assert.equal(poolShare.variables(storage), null);
  const env = pipelineEnv(storage, {});
  assert.equal(env.JOBADABRA_SHARE_EMPLOYERS, undefined);
  assert.equal(env.JOBADABRA_INSTALL_ID, undefined);
});

test('opt-out for every install: an old install pinned off is turned on once; a choice made with the switch is kept', async () => {
  const {openPoolShare} = await import('../lib/migrate.js');
  const pinned = fresh();
  pinned.saveSettings({setupDone: true, poolShareDefaultPinned: true, shareEmployers: false});   // the old pin, never a choice
  assert.equal(openPoolShare(pinned), true);
  assert.equal(poolShare.on(pinned), true);
  poolShare.set(pinned, false);   // then the user turns it off: stays off
  assert.equal(openPoolShare(pinned), false);
  assert.equal(poolShare.on(pinned), false);
  const chose = fresh();
  chose.saveSettings({setupDone: true});
  poolShare.set(chose, false);
  openPoolShare(chose);
  assert.equal(poolShare.on(chose), false, 'a switch choice is never overwritten');
  const brandNew = fresh();
  assert.equal(openPoolShare(brandNew), false);
  assert.equal(poolShare.on(brandNew), true);
});

test('switched on: the run environment gets the switch and the same random id technical reports use', () => {
  const storage = fresh();
  storage.saveSettings({telemetryId: 'existing-random-id'});
  poolShare.set(storage, true);
  const env = pipelineEnv(storage, {});
  assert.equal(env.JOBADABRA_SHARE_EMPLOYERS, '1');
  assert.equal(env.JOBADABRA_INSTALL_ID, 'existing-random-id');
});

test('switching on makes an id when there is none; switching off removes everything again', () => {
  const storage = fresh();
  poolShare.set(storage, true);
  assert.match(storage.settings().telemetryId, /^[0-9a-f-]{36}$/);
  poolShare.set(storage, false);
  assert.equal(pipelineEnv(storage, {}).JOBADABRA_SHARE_EMPLOYERS, undefined);
});

test('Always on follows the switch: variables set when on, removed when off', async () => {
  // (a fresh install is on; the first update below is with it switched off)
  const calls = [];
  const fetcher = async (url, options = {}) => { calls.push(`${options.method || 'GET'} ${new URL(url).pathname}`); return new Response('{}', {status: 200}); };
  const storage = fresh();
  storage.saveSettings({cloud: {repo: 'me/job-pilotto-private'}});
  storage.setSecret('GITHUB_TOKEN', 'ghu_x');
  poolShare.set(storage, false);
  await github.updateRepo(storage, {fetcher});
  assert.ok(calls.some(c => c.startsWith('DELETE') && c.includes('JOBADABRA_SHARE_EMPLOYERS')), calls.join('\n'));
  assert.ok(!calls.some(c => c.startsWith('POST') && c.includes('/variables')));
  calls.length = 0;
  poolShare.set(storage, true);
  await github.updateRepo(storage, {fetcher});
  assert.ok(calls.some(c => c.includes('/actions/variables')), calls.join('\n'));
  assert.ok(!calls.some(c => c.startsWith('DELETE') && c.includes('JOBADABRA_SHARE_EMPLOYERS')));
});

test('the first screen of setup says, in one plain sentence, that employer pages are shared and where to switch it off', () => {
  const html = fs.readFileSync(new URL('../renderer/index.html', import.meta.url), 'utf8');
  const start = html.indexOf('<div class="step" data-step="welcome">');
  const welcome = html.slice(start, html.indexOf('<div class="step" data-step="ai">', start));
  assert.match(welcome, /shares which employer career pages you use/);
  assert.match(welcome, /Turn either off any time in\s+Settings → Advanced/);
  assert.match(welcome, /Never your answers, CV, emails or names/);
});
