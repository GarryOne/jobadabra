// The trend record of a grey job (gt, 31 Oct 2026): lib/grey-record.mjs is the one writer, flaky-proof.mjs --grey the one caller, the retry steps upload it as "grey-<suite>".
// The private site's collector reads it (admin/e2e-grey.js there validates again). Job: report health
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {greyProof} from '../lib/flaky-proof.mjs';
import {REASONS, greyRecord, writeGreyRecord} from '../lib/grey-record.mjs';

const timing = [{step: 'fill', message: 'Timeout 30000ms exceeded'}];
const environment = [{step: 'load', message: 'socket hang up'}];
const picked = [{step: 'steps picked for this PR',   // red-steps.mjs NOT_A_STEP: the runner's own "no step is named" record
   message: 'no step is named …'}];

test('a grey proof names its reason with flakyProof\'s own kind: any timing failure is timing, only environment failures environment', () => {
  assert.equal(greyProof(timing, timing).reason, 'timing');
  assert.equal(greyProof(timing, environment).reason, 'timing');
  assert.equal(greyProof(environment, environment).reason, 'environment');
  assert.equal(greyProof(timing, [{step: 'v', message: 'expected Completed, got Running'}]).reason, undefined, 'a red is never given a reason');
});

test('the record holds a plain suite key and one of the known reasons, nothing else', () => {
  assert.deepEqual(greyRecord('apply-1of2', 'timing'), {suite: 'apply-1of2', reason: 'timing'});
  assert.deepEqual(REASONS, ['timing', 'environment', 'picker']);
  for (const suite of ['', undefined, '../x', 'a b', 'x'.repeat(81)]) assert.throws(() => greyRecord(suite, 'timing'), /suite/);
  for (const reason of [undefined, 'main', 'coffee', '']) assert.throws(() => greyRecord('apply', reason), /reason/);
});

function cli(args, env) {
  try { return {code: 0, out: execFileSync(process.execPath, ['flaky-proof.mjs', '--grey', ...args], {cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8', env: {...process.env, ...env}})}; }
  catch (error) { return {code: error.status, out: String(error.stdout)}; }
}

test('flaky-proof --grey writes the job\'s record when it proves grey, for both grey paths (first try only, both tries) and never on a red', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grey-record-'));
  try {
    const first = path.join(dir, 'first.json'), second = path.join(dir, 'second.json'), file = path.join(dir, 'out', 'grey.json');
    const env = {GREY_RECORD_FILE: file, GREY_SUITE: 'applyflows-1of2'};
    fs.writeFileSync(first, JSON.stringify(timing));
    assert.equal(cli([first], env).code, 1, 'one try is no proof');
    assert.equal(fs.existsSync(file), false, 'no record for a job that stays red');
    fs.writeFileSync(second, JSON.stringify(environment));
    assert.equal(cli([first, second], env).code, 0);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), {suite: 'applyflows-1of2', reason: 'timing'});
    fs.rmSync(file);
    fs.writeFileSync(first, JSON.stringify(picked));
    assert.equal(cli([first], env).code, 0, 'a stale pick is grey on the first try');
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), {suite: 'applyflows-1of2', reason: 'picker'});
    fs.rmSync(file);
    fs.writeFileSync(first, JSON.stringify(timing));
    fs.writeFileSync(second, JSON.stringify([{step: 'v', message: 'expected Completed, got Running'}]));
    assert.equal(cli([first, second], env).code, 1);
    assert.equal(fs.existsSync(file), false, 'a wrong value stays red and leaves no record');
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('a record that cannot be written never changes the verdict: the job is still grey, with a warning', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grey-record-'));
  try {
    const first = path.join(dir, 'first.json'), second = path.join(dir, 'second.json');
    fs.writeFileSync(first, JSON.stringify(timing));
    fs.writeFileSync(second, JSON.stringify(timing));
    const blocked = path.join(dir, 'file');
    fs.writeFileSync(blocked, 'x');
    const result = cli([first, second], {GREY_RECORD_FILE: path.join(blocked, 'grey.json'), GREY_SUITE: 'apply'});
    assert.equal(result.code, 0);
    assert.match(result.out, /::warning::grey record not written/);
    assert.equal(cli([first, second], {GREY_RECORD_FILE: path.join(dir, 'g.json'), GREY_SUITE: '../bad'}).code, 0, 'an invalid suite key is refused by the writer, not by the verdict');
    assert.equal(fs.existsSync(path.join(dir, 'g.json')), false);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('every retry step records its grey job and uploads it: grey-<suite> (Windows: grey-windows-<suite>), replacing an earlier attempt\'s', () => {
  const flows = path.join(fileURLToPath(new URL('../../..', import.meta.url)), '.github/workflows');
  let seen = 0;
  for (const file of ['e2e.yml', 'desktop.yml']) {
    const text = fs.readFileSync(path.join(flows, file), 'utf8');
    for (const match of text.matchAll(/> "\$first\/flaky\.json"/g)) {
      const start = text.lastIndexOf('      - name:', match.index), end = text.indexOf('\n      - ', match.index);
      const retry = text.slice(start, end < 0 ? undefined : end);
      seen += 1;
      assert.match(retry, /GREY_RECORD_FILE: \$\{\{ github\.workspace \}\}\/grey-record\/grey\.json/, `${file}: the retry step names the record file`);
      assert.match(retry, /GREY_SUITE: \$\{\{ matrix\.key \}\}/, `${file}: the record carries the matrix key`);
      const after = text.slice(end).split('\n      - ').slice(1).find(step => step.includes('Keep the grey record')) || '';
      assert.match(after, /hashFiles\('grey-record\/grey\.json'\) != ''/, `${file}: uploaded only when a record exists`);
      assert.match(after, /name: grey-(?:windows-)?\$\{\{ matrix\.key \}\}/, `${file}: the artifact name the collector looks for`);
      assert.match(after, /overwrite: true/, `${file}: a fresh attempt replaces the earlier one`);
    }
  }
  assert.ok(seen >= 2, 'e2e.yml and desktop.yml both retry a red suite');
});
