// A live row's fill video (lib/live-video.mjs): nothing starts without the folder, a normal end says one parseable line, a privacy hit discards the file, a failing recorder never breaks the row.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {liveVideo} from '../../lib/live-video.mjs';
import {parseLive} from '../../lib/record-sites.mjs';

const context = {pages: () => [{url: () => 'chrome-extension://x/a.html'}, {url: () => 'https://jobs.example.test/apply'}]}, page = {url: () => 'about:blank'};
const file = () => { const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'live-video-')), 'fill.webm'); fs.writeFileSync(f, 'x'); return f; };

test('without the folder nothing starts; with it the recorder follows the newest http tab', async () => {
  let started = 0;
  await (await liveVideo({context, page, dir: '', start: async () => { started++; }})).finish();
  assert.equal(started, 0);
  let tab = null;
  const f = file();
  const said = [];
  await (await liveVideo({context, page, dir: '/d', start: async (_, options) => { tab = options.tabOf(); return {stop: async () => ({path: f, bytes: 1, secs: 9})}; }})).finish({say: line => said.push(line)});
  assert.equal(tab.url(), 'https://jobs.example.test/apply');
  assert.deepEqual(said, [`live: fill video: ${f}|1|9`]);
  assert.deepEqual(parseLive(said.join('\n')).video, {path: f, bytes: 1, secs: 9});
});

test('a tripwire hit discards the video; a recorder that fails or returns nothing says nothing', async () => {
  const f = file(), said = [];
  await (await liveVideo({context, page, dir: '/d', start: async () => ({stop: async () => ({path: f, bytes: 1, secs: 2})})})).finish({tripped: true, say: line => said.push(line)});
  assert.equal(fs.existsSync(f), false);
  assert.match(said[0], /discarded/);
  assert.equal(parseLive(said.join('\n')).video, undefined);
  await (await liveVideo({context, page, dir: '/d', start: async () => { throw new Error('no ffmpeg'); }})).finish({say: line => said.push(line)});
  await (await liveVideo({context, page, dir: '/d', start: async () => ({stop: async () => null})})).finish({say: line => said.push(line)});
  assert.equal(said.length, 1);
});
