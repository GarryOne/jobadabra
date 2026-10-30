// Cases for tools/title-tag.mjs, run by tests/test_title_tag.py: an edit that drops the "[xx] " tag gets it back, every other edit is left alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {restoredTitle, retitle} from '../tools/title-tag.mjs';

const SCRIPT = fileURLToPath(new URL('../tools/title-tag.mjs', import.meta.url));

/** Runs the CLI the way pr-gate's step does, with `gh` replaced by a script that records its arguments (and exits `ghExit`). */
function runCli(t, env, ghExit = 0) {
  const dir = mkdtempSync(join(tmpdir(), 'title-tag-'));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  writeFileSync(join(dir, 'gh'), `#!/bin/sh\necho "$@" >> "${dir}/calls"\nexit ${ghExit}\n`);
  chmodSync(join(dir, 'gh'), 0o755);
  const done = spawnSync(process.execPath, [SCRIPT], {env: {PATH: `${dir}:${process.env.PATH}`, GITHUB_REPOSITORY: 'GarryOne/jobadabra', PR: '2549', ...env}, encoding: 'utf8'});
  let calls = '';
  try { calls = readFileSync(join(dir, 'calls'), 'utf8'); } catch { /* gh was not called */ }
  return {...done, calls};
}

test('the tag of the old title is put back on a title that lost it (#2549)', () => {
  assert.equal(restoredTitle('[ac] 1/2 Class test sees the twin', 'Class test sees the twin; doc says how a test sets its port'), '[ac] Class test sees the twin; doc says how a test sets its port');
});

test('a title that still has a tag is left alone, whichever tag it is', () => {
  assert.equal(restoredTitle('[ac] Old words', '[ac] New words'), null);
  assert.equal(restoredTitle('[ac] Old words', '[27] New words'), null);
});

test('an old title without a tag, or an empty new title, restores nothing', () => {
  assert.equal(restoredTitle('Old words', 'New words'), null);
  assert.equal(restoredTitle(undefined, 'New words'), null);
  assert.equal(restoredTitle('[ac] Old words', '   '), null);
  assert.equal(restoredTitle('[ac] Old words', undefined), null);
});

test('retitle sets the title on that PR in that repo', () => {
  const calls = [];
  retitle('GarryOne/jobadabra', 2549, '[ac] Words', (...args) => calls.push(args));
  assert.deepEqual(calls, [['pr', 'edit', '2549', '--title', '[ac] Words', '-R', 'GarryOne/jobadabra']]);
});

test('the gate step: a dropped tag is repaired on the PR and the restored title is what gets judged', t => {
  const done = runCli(t, {OLD_TITLE: '[ac] 1/2 Words', NEW_TITLE: 'Better words'});
  assert.equal(done.status, 0);
  assert.equal(done.stdout.trim(), '[ac] Better words');
  assert.equal(done.calls.trim(), 'pr edit 2549 --title [ac] Better words -R GarryOne/jobadabra');
});

test('the gate step: a title that is fine, a first run and a bot PR call nothing and print the title as it is', t => {
  for (const env of [{OLD_TITLE: '[ac] Old', NEW_TITLE: '[ac] New'}, {NEW_TITLE: 'Untagged on open'}, {OLD_TITLE: '[ac] Old', NEW_TITLE: ''}]) {
    const done = runCli(t, env);
    assert.equal(done.status, 0);
    assert.equal(done.stdout.trim(), env.NEW_TITLE);
    assert.equal(done.calls, '');
  }
});

test('the gate step: a failed repair fails the step, so the PR stays red', t => {
  assert.notEqual(runCli(t, {OLD_TITLE: '[ac] Old', NEW_TITLE: 'New'}, 1).status, 0);
});
