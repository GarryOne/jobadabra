// The repo counts sent with the replay upload (lib/repo-counts.mjs): counted by structure, so a new case or zoo page changes them without anyone editing a list; and the upload carries them.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {E2E} from '../../lib/app.mjs';
import {repoCounts} from '../../lib/repo-counts.mjs';

test('a case is a folder with a case.json: adding one changes the count, a loose folder does not', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-counts-'));
  for (const name of ['recorded/a-1', 'recorded/b-1', 'widget-zoo/z-1']) { fs.mkdirSync(path.join(root, name), {recursive: true}); fs.writeFileSync(path.join(root, name, 'case.json'), '{}'); }
  fs.mkdirSync(path.join(root, 'recorded', 'no-case'));
  assert.deepEqual(repoCounts(root), {recorded: 2, zoo: 1});
  fs.mkdirSync(path.join(root, 'recorded', 'c-1')); fs.writeFileSync(path.join(root, 'recorded', 'c-1', 'case.json'), '{}');
  assert.equal(repoCounts(root).recorded, 3);
  assert.deepEqual(repoCounts(path.join(root, 'nothing')), {recorded: 0, zoo: 0});
});

test('this repo\'s own counts match its folders', () => {
  const have = dir => fs.readdirSync(path.join(E2E, dir)).filter(name => fs.existsSync(path.join(E2E, dir, name, 'case.json'))).length;
  assert.deepEqual(repoCounts(), {recorded: have('recorded'), zoo: have('widget-zoo')});
  assert.ok(repoCounts().recorded > 50 && repoCounts().zoo >= 8);
});

test('the replay upload carries the counts', async () => {
  const {uploadReplays} = await import('../../lib/applying-report.mjs');
  const sent = [];
  const main = {CI: 'true', GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main', GITHUB_SHA: 'abcdef1234567', REPLAYS_PUBLISH_KEY: 'k'};
  await uploadReplays([{name: 'a', ok: true}], {env: main, repo: {recorded: 111, zoo: 16}, fetcher: async (url, init) => { sent.push(JSON.parse(init.body)); return {ok: true, json: async () => ({stored: 1})}; }});
  assert.deepEqual(sent[0].repo, {recorded: 111, zoo: 16});
});
