// "Proven live" is retired (record-once spec 15 Oct 2026: a fix is confirmed OFFLINE on a recording, never by a live run): no tracked file may still use its pieces, so a new
// rule, skill, workflow or page cannot ask for a live proof again.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';

const root = path.resolve(import.meta.dirname, '../..');
const RETIRED = /pool-proven|unproven-fixes|uploadProven|pool-proof\.yml|PR_PROOF_ANTHROPIC_KEY|pr-live-proof|applying\/proven|applying-proven|JOB_PILOTTO_SITE_RESERVE|\bProven live\b|\bNeeds live\b/;   // "Needs live" became "Needs a recording" (15 Oct 2026): no verdict word may ask for a live run
const KEEP = [/^docs\/superpowers\//, /^docs\/rules\/why\.md$/, /^site\/migrations\//, /^desktop\/test\/live-proof-retired\.test\.js$/, /^desktop\/e2e\/test\/pool-ci-triggers\.test\.mjs$/, /^site\/test\/applying-replays\.test\.js$/];   // history, and the guards that name what must not return
const KEPT_FOR_OLD_ROWS = [/^site\/src\/jobcost\.js$/];   // an old /admin/intelligence/ai-cost row keeps its job's label

test('no tracked file still uses a retired live-proof piece', () => {
  const left = [];
  for (const file of execFileSync('git', ['-C', root, 'ls-files'], {encoding: 'utf8'}).split('\n').filter(Boolean)) {
    if (KEEP.some(rule => rule.test(file)) || KEPT_FOR_OLD_ROWS.some(rule => rule.test(file)) || /\.(png|jpe?g|gif|ico|zip|woff2?|pdf|lock)$/i.test(file)) continue;
    let text = '';
    try { text = fs.readFileSync(path.join(root, file), 'utf8'); } catch { continue; }
    const hit = RETIRED.exec(text);
    if (hit) left.push(`${file}: ${hit[0]}`);
  }
  assert.deepEqual(left, []);
});

test('the reader finds a retired piece (positive control)', () => {
  assert.match('lib/pool-proven.mjs', RETIRED);
  assert.match('Not Proven live', RETIRED);
  assert.match('Needs live', RETIRED);
  assert.doesNotMatch('Needs a recording', RETIRED);
  assert.doesNotMatch('Confirmed offline', RETIRED);
});
