// A CI recording run's rows for the pool table (lib/pool-ci-rows.mjs): the rows this run ran, sent only from CI, only on main, with the narrow key.
import assert from 'node:assert/strict';
import test from 'node:test';
import {ciRows, uploadCiRows} from '../../lib/pool-ci-rows.mjs';

const report = {day: '2026-10-14', thisRun: {ran: ['A row', 'B row']}, results: {
  'A row': {url: 'https://jobs.example.test/a', reached: 'form', filled: 5, left: 1, ending: 'unresolved'}, 'B row': {url: 'https://b.example.test/', reached: 'none', ending: 'site-refused', note: 'site refused'}, 'Earlier today': {reached: 'ready'}}};

test('a row per row this run ran, host only (never the address), the ending word', () => {
  const rows = ciRows(report);
  assert.deepEqual(rows.map(row => [row.name, row.host, row.reached, row.ending]), [['A row', 'jobs.example.test', 'form', 'unresolved'], ['B row', 'b.example.test', 'none', 'site-refused']]);
  assert.ok(!JSON.stringify(rows).includes('/a'), 'no address leaves');
});

test('sent from CI on main only, one PUT with the narrow key; a branch, a Mac and a missing key send nothing', async () => {
  const calls = [], fetcher = async (url, init) => { calls.push({url, init}); return {ok: true, json: async () => ({ok: true, stored: 2})}; };
  const rows = ciRows(report), ci = {CI: 'true', REPLAYS_PUBLISH_KEY: 'k'}, ctx = {branch: 'main', day: '2026-10-14', version: '0.7.0'};
  assert.match(await uploadCiRows(rows, ctx, {env: {}, fetcher}), /not sent \(a local run/);
  assert.match(await uploadCiRows(rows, {...ctx, branch: 'fix-upload'}, {env: ci, fetcher}), /only a run on main/);
  assert.match(await uploadCiRows(rows, ctx, {env: {CI: 'true'}, fetcher}), /REPLAYS_PUBLISH_KEY/);
  assert.match(await uploadCiRows(rows, ctx, {env: {...ci, JP_CI_ROWS_DRY: '1'}, fetcher}), /dry run: would send 2/);
  assert.match(await uploadCiRows([], ctx, {env: ci, fetcher}), /nothing to send/);
  assert.equal(calls.length, 0);
  assert.match(await uploadCiRows(rows, ctx, {env: ci, fetcher}), /2 row\(s\) sent/);
  assert.equal(calls[0].init.method, 'PUT');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer k');
  assert.deepEqual(JSON.parse(calls[0].init.body), JSON.parse(JSON.stringify({branch: 'main', day: '2026-10-14', version: '0.7.0', rows})));
});
