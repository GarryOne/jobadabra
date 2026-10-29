// markApplied, the one step every confirmed submit passes (the person's press and the hidden browser's alike), stamps the fill's run row after the job is Applied; a failed stamp never undoes Applied.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as server from '../lib/server.js';

const URL_ = 'https://jobs.example.test/acme/1';
const storage = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-receipt-'));
  return {settings: () => ({}), secret: () => 't', setSecret: () => {}, path: (...p) => path.join(dir, ...p)};
};
const envOf = ({stamps, statusOk = true, stamp = async () => ({ok: true})}) => server.localEnv(storage(), () => {}, {
  find: async () => ({url: URL_, title: 'SRE', company: 'Acme', status: 'kit_ready'}),
  setStatus: async () => ({ok: statusOk, error: 'no'}),
  runs: {receiptRun: async (url, at) => { stamps.push([url, at]); return stamp(url, at); }},
});

test('a confirmed submit stamps that job\'s fill row once, after Applied is saved', async () => {
  const stamps = [];
  const result = await envOf({stamps}).markApplied(URL_, 'a confirmation page');
  assert.equal(result.ok, true);
  assert.equal(stamps.length, 1);
  assert.equal(stamps[0][0], URL_);
  assert.match(stamps[0][1], /^\d{4}-\d\d-\d\dT/, 'the time of the receipt');
});

test('a job that could not be marked Applied is not stamped as submitted', async () => {
  const stamps = [];
  const result = await envOf({stamps, statusOk: false}).markApplied(URL_, 'a confirmation page');
  assert.equal(result.ok, false);
  assert.deepEqual(stamps, []);
});

test('a stamp that fails or finds no row never undoes Applied', async () => {
  for (const stamp of [async () => { throw new Error('store busy'); }, async () => ({ok: false, skipped: true})]) {
    const stamps = [];
    const result = await envOf({stamps, stamp}).markApplied(URL_, 'a confirmation page');
    assert.equal(result.ok, true, 'Applied stands');
    assert.equal(stamps.length, 1);
  }
});
