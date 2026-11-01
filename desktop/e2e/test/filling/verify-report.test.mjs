// verify-report.mjs: the plan's answers and the row jobs' verdicts go in one PUT with fixed fields only; no key or no rows sends nothing. Pure: a fake fetch.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {readVerdicts, rowsOf, uploadVerify} from '../../verify-report.mjs';

test('verdicts are read from any depth, joined with the plan\'s, and carry fixed fields only', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-report-'));
  fs.mkdirSync(path.join(dir, 'a', 'b'), {recursive: true});
  fs.writeFileSync(path.join(dir, 'a', 'b', 'verdict.json'), JSON.stringify({kind: 'fixed', row: 'R', verdict: 'confirmed', why: 'w', secret: 'x', commit: 'abc1234'}));
  const rows = rowsOf({verdicts: [{kind: 'fixed', row: 'S', verdict: 'live', why: 'no recording of this row'}]}, readVerdicts(dir));
  assert.deepEqual(rows.map(row => row.row), ['S', 'R']);
  assert.equal(rows[1].secret, undefined);
});

test('no key sends nothing; with a key it is one PUT with the bearer and the build', async () => {
  const rows = [{kind: 'fixed', row: 'R', verdict: 'live'}];
  assert.match(await uploadVerify(rows, 'abc1234', {env: {}}), /not sent/);
  assert.match(await uploadVerify([], 'abc1234', {env: {REPLAYS_PUBLISH_KEY: 'k'}}), /nothing to send/);
  const seen = [];
  const said = await uploadVerify(rows, 'abc1234', {env: {REPLAYS_PUBLISH_KEY: 'k'}, fetcher: async (url, init) => { seen.push([url, init]); return {ok: true, json: async () => ({stored: 1})}; }});
  assert.match(said, /1 verdict\(s\) changed of 1/);
  assert.equal(seen.length, 1);
  assert.equal(seen[0][1].headers.Authorization, 'Bearer k');
  assert.deepEqual(JSON.parse(seen[0][1].body), {sha: 'abc1234', rows});
});
