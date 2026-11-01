// A CI pool run's endings (lib/pool-endings.mjs; the outcome contract, spec 2026-10-12-one-next-move.md phase 1a): one record per row this run ran, fixed words only, sent with
// CI's narrow key to /applying/endings, where main's feed the Resolution tile.
import assert from 'node:assert/strict';
import test from 'node:test';
import {endingRecords, uploadEndings} from '../../lib/pool-endings.mjs';

const report = {day: '2026-10-12', thisRun: {ran: ['A row', 'B row', 'C row']}, results: {
  'A row': {reached: 'form', ending: 'unresolved'}, 'B row': {reached: 'account', ending: 'held'}, 'C row': {reached: 'none', ending: ''}, 'Earlier today': {reached: 'ready', ending: 'ready'}}};
const ctx = {run: '42', branch: 'main', sha: 'abcdef1234567', at: '2026-10-12T18:00:00.000Z'};

test('one record per row this run ran that has an ending word; fixed words, the run, the branch, the build', () => {
  assert.deepEqual(endingRecords(report, ctx), [
    {row: 'A row', ending: 'unresolved', step: 'form', cause: '', run: '42', branch: 'main', sha: 'abcdef1234567', at: ctx.at},
    {row: 'B row', ending: 'held', step: 'account', cause: '', run: '42', branch: 'main', sha: 'abcdef1234567', at: ctx.at}]);
  assert.deepEqual(endingRecords({...report, results: {'A row': {ending: 'Send your CV to jane@x.example'}}}, ctx), [], 'a word outside the list never leaves');
});

test('sent from CI only, with the narrow key, one PUT; a dry run says what it would send', async () => {
  const calls = [], fetcher = async (url, init) => { calls.push({url, init}); return {ok: true, json: async () => ({ok: true, stored: 2})}; };
  const records = endingRecords(report, ctx);
  assert.match(await uploadEndings(records, {env: {}, fetcher}), /not sent \(a local run/);
  assert.match(await uploadEndings(records, {env: {CI: 'true'}, fetcher}), /not sent \(REPLAYS_PUBLISH_KEY/);
  assert.match(await uploadEndings(records, {env: {CI: 'true', REPLAYS_PUBLISH_KEY: 'k', JP_ENDINGS_DRY: '1'}, fetcher}), /dry run: would send 2/);
  assert.match(await uploadEndings([], {env: {CI: 'true', REPLAYS_PUBLISH_KEY: 'k'}, fetcher}), /nothing to send/);
  assert.equal(calls.length, 0);
  assert.match(await uploadEndings(records, {env: {CI: 'true', REPLAYS_PUBLISH_KEY: 'k'}, fetcher}), /2 ending\(s\) sent/);
  assert.equal(calls[0].init.method, 'PUT');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer k');
  assert.deepEqual(JSON.parse(calls[0].init.body), {records});
});

test('a record carries where the row stopped and why, as fixed words', () => {
  const [one] = endingRecords({results: {'A row': {ending: 'unresolved', reached: 'posting', cause: 'no-form'}}}, ctx);
  assert.deepEqual([one.step, one.cause], ['posting', 'no-form']);
});
