// Main's run after a merge replays the merged PR's own AI answers (main cannot read a PR's cache). Main red 27 Oct 2026: #2180's PR replayed its own answers
// (0 misses) and was green; main restored an older cache (run 40417621424), asked 8 questions live, got other answers and went red.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {layOver, pickArtifact, prOfCommit} from '../pr-answers.mjs';

test('the merged PR is the one whose merge made the commit', () => {
  assert.deepEqual(prOfCommit([{number: 7, merged_at: null, head: {ref: 'other'}}, {number: 2180, merged_at: '2026-10-27T01:40:00Z', head: {ref: 'quality-judge-haiku'}}]),
    {number: 2180, branch: 'quality-judge-haiku'});
  assert.equal(prOfCommit([]), null);
  assert.equal(prOfCommit(null), null);
});

test('the answers are the newest unexpired ones of this suite from the PR\'s branch', () => {
  const art = (id, branch, name, created, expired = false) => ({id, name, expired, created_at: created, workflow_run: {id: id * 10, head_branch: branch}});
  const list = [art(1, 'quality-judge-haiku', 'ai-answers-quality', '2026-10-27T01:24:00Z'), art(2, 'quality-judge-haiku', 'ai-answers-quality', '2026-10-27T01:38:00Z'),
    art(3, 'quality-judge-haiku', 'ai-answers-settings', '2026-10-27T01:39:00Z'), art(4, 'other', 'ai-answers-quality', '2026-10-27T01:50:00Z'),
    art(5, 'quality-judge-haiku', 'ai-answers-quality', '2026-10-27T01:55:00Z', true)];
  assert.equal(pickArtifact(list, {branch: 'quality-judge-haiku', name: 'ai-answers-quality'}).id, 2);
  assert.equal(pickArtifact(list, {branch: 'nobody', name: 'ai-answers-quality'}), null);
});

test('the PR\'s answers replace main\'s for the same question and add the new ones', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-answers-'));
  const cache = path.join(root, 'cache'), from = path.join(root, 'pr');
  fs.mkdirSync(cache); fs.mkdirSync(from);
  fs.writeFileSync(path.join(cache, 'same.json'), '{"body":"main"}');
  fs.writeFileSync(path.join(cache, 'mainonly.json'), '{"body":"main"}');
  fs.writeFileSync(path.join(from, 'same.json'), '{"body":"pr"}');
  fs.writeFileSync(path.join(from, 'new.json'), '{"body":"pr"}');
  fs.writeFileSync(path.join(from, 'notes.txt'), 'not an answer');
  assert.equal(layOver(from, cache), 2);
  assert.equal(fs.readFileSync(path.join(cache, 'same.json'), 'utf8'), '{"body":"pr"}');
  assert.equal(fs.readFileSync(path.join(cache, 'mainonly.json'), 'utf8'), '{"body":"main"}');
  assert.ok(fs.existsSync(path.join(cache, 'new.json')));
  assert.ok(!fs.existsSync(path.join(cache, 'notes.txt')));
  fs.rmSync(root, {recursive: true, force: true});
});
