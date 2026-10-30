// Cases for tools/conflict-label.mjs, run by tests/test_conflict_label.py: GitHub's mergeable verdict puts the "Merge conflict" label on and takes it off.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {apply, edits, settle, CONFLICT} from '../tools/conflict-label.mjs';

/** Runs the CLI with gh replaced by a fake repo. `prs` = [{number, states: [mergeable per read, the last repeats], labels}]; `missing`: the repo lacks the label. */
function runCli(t, {prs, missing = false, failure = ''}) {
  const dir = mkdtempSync(join(tmpdir(), 'conflict-label-'));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  const stateFile = join(dir, 'state.json'), preload = join(dir, 'fake-gh.mjs');
  writeFileSync(stateFile, JSON.stringify({prs, missing, reads: 0, creates: 0, calls: 0}));
  writeFileSync(preload, `// Replaces only gh so this CLI test cannot access GitHub or credentials.
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {readFileSync, writeFileSync} from 'node:fs';
childProcess.execFileSync = (file, args) => {
  if (file !== 'gh') throw new Error('unexpected executable: ' + file);
  const state = JSON.parse(readFileSync(process.env.FAKE_GH_STATE, 'utf8'));
  state.calls++;
  const save = () => writeFileSync(process.env.FAKE_GH_STATE, JSON.stringify(state));
  save();
  if (process.env.FAKE_GH_FAILURE) throw new Error(process.env.FAKE_GH_FAILURE);
  if (args[0] === 'api' && args[1] === 'graphql') {
    const read = state.reads++;
    save();
    return JSON.stringify({data: {repository: {pullRequests: {nodes: state.prs.map(p => ({
      number: p.number, mergeable: p.states[Math.min(read, p.states.length - 1)], labels: {nodes: p.labels.map(name => ({name}))}}))}}}});
  }
  if (args[0] === 'label' && args[1] === 'create') { state.creates++; state.missing = false; save(); return ''; }
  if (args[0] !== 'pr' || args[1] !== 'edit') throw new Error('unexpected gh args: ' + args);
  const pr = state.prs.find(p => String(p.number) === args[2]), add = args.indexOf('--add-label'), remove = args.indexOf('--remove-label');
  if (add >= 0 && state.missing) throw new Error("could not add label: '" + args[add + 1] + "' not found");
  if (add >= 0) pr.labels.push(args[add + 1]); else pr.labels = pr.labels.filter(name => name !== args[remove + 1]);
  save();
  return '';
};
syncBuiltinESMExports();
`);
  const done = spawnSync(process.execPath, ['--import', preload, fileURLToPath(new URL('../tools/conflict-label.mjs', import.meta.url))], {
    encoding: 'utf8', env: {PATH: process.env.PATH, GITHUB_REPOSITORY: 'o/r', CONFLICT_LABEL_WAIT_MS: '1', FAKE_GH_STATE: stateFile, FAKE_GH_FAILURE: failure},
  });
  assert.ifError(done.error);
  return {...done, ...JSON.parse(readFileSync(stateFile, 'utf8'))};
}
const labelsOf = (done, number) => done.prs.find(p => p.number === number).labels;

test('the owner\'s PR list: a conflicting PR gets the orange label, a fixed one loses it, one GitHub is still computing is read again', t => {
  const done = runCli(t, {missing: true, prs: [
    {number: 1, states: ['CONFLICTING'], labels: ['Gitar: approved']},
    {number: 2, states: ['MERGEABLE'], labels: [CONFLICT.name]},
    {number: 3, states: ['UNKNOWN', 'CONFLICTING'], labels: []},
    {number: 4, states: ['MERGEABLE'], labels: []},
  ]});
  assert.equal(done.status, 0, done.stderr);
  assert.deepEqual(labelsOf(done, 1), ['Gitar: approved', CONFLICT.name], 'added beside Gitar\'s label, which it leaves alone');
  assert.deepEqual(labelsOf(done, 2), [], 'main merged in: the label goes');
  assert.deepEqual(labelsOf(done, 3), [CONFLICT.name], 'read again once GitHub has computed it');
  assert.deepEqual(labelsOf(done, 4), []);
  assert.equal(done.reads, 2);
  assert.equal(done.creates, 1, 'the label is created once, when the repo lacks it');
  assert.equal(CONFLICT.color, 'f66a0a', 'orange (owner): not Gitar\'s yellow fbca04 nor its red d73a4a');
});

test('a PR GitHub never computes keeps its label and the run says so; a failure is red', t => {
  const unknown = runCli(t, {prs: [{number: 7, states: ['UNKNOWN'], labels: [CONFLICT.name]}]});
  assert.equal(unknown.status, 0, unknown.stderr);
  assert.deepEqual(labelsOf(unknown, 7), [CONFLICT.name]);
  assert.equal(unknown.reads, 7, 'the first read and 6 re-reads');
  assert.ok(unknown.stdout.includes('::notice::') && unknown.stdout.includes('#7'), unknown.stdout);
  const failed = runCli(t, {prs: [{number: 1, states: ['CONFLICTING'], labels: []}], failure: 'HTTP 403 API rate limit exceeded for installation'});
  assert.equal(failed.status, 1);
  assert.ok(failed.stderr.includes('rate limit'), failed.stderr);
});

test('edits, settle and apply', () => {
  assert.deepEqual(edits([
    {number: 1, mergeable: 'CONFLICTING', labeled: false}, {number: 2, mergeable: 'CONFLICTING', labeled: true},
    {number: 3, mergeable: 'MERGEABLE', labeled: true}, {number: 4, mergeable: 'UNKNOWN', labeled: true}, {number: 5, mergeable: 'UNKNOWN', labeled: false},
  ]), [{pr: 1, add: true}, {pr: 3, add: false}]);
  let reads = 0;
  assert.deepEqual(settle(() => (++reads < 3 ? [{mergeable: 'UNKNOWN'}] : [{mergeable: 'MERGEABLE'}])), [{mergeable: 'MERGEABLE'}]);
  assert.equal(reads, 3);
  const calls = [];
  assert.throws(() => apply('o/r', {pr: 1, add: true}, (...args) => { calls.push(args[0]); throw new Error('HTTP 404 Not Found'); }), /404/);
  assert.deepEqual(calls, ['pr'], 'a missing PR is not answered with a label create');
  assert.throws(() => apply('o/r', {pr: 1, add: false}, (...args) => { calls.push(args[0]); throw new Error("could not add label: 'x' not found"); }));
  assert.deepEqual(calls, ['pr', 'pr'], 'a removal never creates the label');
});
