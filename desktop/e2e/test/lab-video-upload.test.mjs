// A pool row's fill video for the Lab (lib/lab-video-upload.mjs): sent from CI on main only, one PUT with the narrow key, the row's name and length in the address, never the page's address; anything else sends nothing.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {uploadFillVideo} from '../lib/lab-video-upload.mjs';

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lab-video-')), 'fill.webm');
fs.writeFileSync(file, Buffer.alloc(2000, 7));
const video = {path: file, bytes: 2000, secs: 72}, ctx = {branch: 'main'}, ci = {CI: 'true', REPLAYS_PUBLISH_KEY: 'k'};

test('one PUT with the narrow key from CI on main; a branch, a Mac, a missing key, a dry run and no video send nothing', async () => {
  const calls = [], fetcher = async (url, init) => { calls.push({url, init}); return {ok: true, json: async () => ({ok: true, bytes: 2000})}; };
  assert.match(await uploadFillVideo('A row', video, ctx, {env: {}, fetcher}), /not sent \(a local run/);
  assert.match(await uploadFillVideo('A row', video, {branch: 'fix-x'}, {env: ci, fetcher}), /only a run on main/);
  assert.match(await uploadFillVideo('A row', video, ctx, {env: {CI: 'true'}, fetcher}), /REPLAYS_PUBLISH_KEY/);
  assert.match(await uploadFillVideo('A row', video, ctx, {env: {...ci, JP_CI_ROWS_DRY: '1'}, fetcher}), /dry run/);
  assert.match(await uploadFillVideo('A row', null, ctx, {env: ci, fetcher}), /no video/);
  assert.equal(calls.length, 0);
  assert.match(await uploadFillVideo('A row', video, ctx, {env: ci, fetcher}), /sent to \/admin\/form-filling\/lab/);
  assert.equal(calls[0].init.method, 'PUT');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer k');
  assert.equal(calls[0].init.headers['Content-Type'], 'video/webm');
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, '/applying/video');
  assert.equal(url.searchParams.get('name'), 'A row');
  assert.equal(url.searchParams.get('secs'), '72');
  assert.equal(calls[0].init.body.length, 2000);
});

test('a refusal or a network error is a line, never a throw, and the file is removed after a send', async () => {
  fs.writeFileSync(file, Buffer.alloc(2000, 7));   // the first test's send removed it
  assert.match(await uploadFillVideo('A row', video, ctx, {env: ci, fetcher: async () => ({ok: false, status: 503, json: async () => ({error: 'not configured'})})}), /refused \(503 not configured\)/);
  assert.match(await uploadFillVideo('A row', video, ctx, {env: ci, fetcher: async () => { throw new Error('offline'); }}), /not sent \(offline\)/);
  assert.ok(fs.existsSync(file), 'a failed send keeps the file for the run artifact');
  assert.match(await uploadFillVideo('A row', video, ctx, {env: ci, fetcher: async () => ({ok: true, json: async () => ({})})}), /sent/);
  assert.equal(fs.existsSync(file), false);
});
