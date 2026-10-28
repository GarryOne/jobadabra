// Rule E on the lane registry (tools/lanes-check.mjs): a suite leaves the backbone only by naming the input it depends on and why.
// Pure cases on the two texts, one throwaway git repo for the real push, the real registry as a class check, and the wiring into the push script.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkPush, entryProblems, FILE, lanesProblems} from '../../tools/lanes-check.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WHY = 'Twelve golden postings go through the real check and a judge reads the free text.';
const entry = (over = {}) => ({lane: 'tolerant', input: 'ai', since: '2026-10-28', why: WHY, ...over});
const file = suites => JSON.stringify({v: 1, about: 'the registry', suites}, null, 2);

test('a tolerant suite with its input, its reason and a date passes', () => {
  assert.deepEqual(lanesProblems(file({}), file({quality: entry()})), []);
});

test('a tolerant suite with no input is refused, naming the suite and what it lacks', () => {
  const found = lanesProblems(file({}), file({settings: entry({input: undefined})}));
  assert.equal(found.length, 1);
  assert.match(found[0], /^settings: input must be one of ai, clock, outside/);
});

test('an input outside the three, a one-word reason and a missing date are each refused', () => {
  assert.match(entryProblems(entry({input: 'flaky'})).join(), /input must be one of/);
  assert.match(entryProblems(entry({why: 'flaky'})).join(), /why must say in a sentence/);
  assert.match(entryProblems(entry({why: 'allowance for model noise (1 in 9)'})).join(), /why must say in a sentence/, 'the 5395279 wording is not a reason');
  assert.match(entryProblems(entry({since: undefined})).join(), /since must be a date/);
  assert.match(entryProblems(entry({lane: 'backbone'})).join(), /lane must be one of/);
  assert.deepEqual(entryProblems(entry({lane: 'suspended', input: undefined})), [], 'a suspended suite is a flip, not an input: it needs no input');
});

test('moving a suite that was not tolerant into the tolerant lane without an input is refused', () => {
  const was = file({apply: entry({lane: 'suspended', input: undefined})});
  assert.match(lanesProblems(was, file({apply: entry({lane: 'tolerant', input: undefined})})).join(), /apply: input must be one of/);
});

test('free: an edit to `about`, an entry nobody touched, and a removed entry (the suite is back in the backbone)', () => {
  const legacy = file({old: {lane: 'tolerant', since: '2026-10-01'}, quality: entry()});   // an entry from before the rule is not this push's to fix
  assert.deepEqual(lanesProblems(legacy, legacy.replace('the registry', 'a longer registry note')), []);
  assert.deepEqual(lanesProblems(legacy, file({quality: entry()})), []);
  assert.deepEqual(lanesProblems(legacy, legacy), []);
  assert.deepEqual(lanesProblems(legacy, null), [], 'a registry that is gone makes every suite backbone: the strict direction');
});

test('a registry that does not parse is refused', () => {
  assert.match(lanesProblems(file({}), '{"suites": {').join(), /not valid JSON/);
});

test('the registry on this branch passes as a first cut: every entry is complete (class)', () => {
  const text = fs.readFileSync(path.join(root, FILE), 'utf8');
  assert.deepEqual(lanesProblems(null, text), []);
  assert.ok(Object.keys(JSON.parse(text).suites).length > 0, 'a registry with no entry would pass for nothing');
});

// A one-file push, as the push script sees it: base commit, then a commit that changes the registry.
function push(baseSuites, headSuites) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-check-'));
  const git = (...rest) => execFileSync('git', ['-C', dir, ...rest], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
  try {
    git('init', '-q', '-b', 'main'); git('config', 'user.email', 't@example.com'); git('config', 'user.name', 't'); git('config', 'commit.gpgsign', 'false');
    fs.mkdirSync(path.join(dir, path.dirname(FILE)), {recursive: true});
    fs.writeFileSync(path.join(dir, FILE), file(baseSuites)); git('add', '-A'); git('commit', '-qm', 'Base'); git('branch', 'base');
    fs.writeFileSync(path.join(dir, FILE), file(headSuites)); git('add', '-A'); git('commit', '-qm', 'Change the registry');
    return checkPush({root: dir, base: 'base'});
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
}

test('a push that lists a suite as tolerant with no input is blocked with the rule; with the input it passes', () => {
  const blocked = push({}, {settings: entry({input: undefined})});
  assert.match(blocked, /this push changes the lane registry desktop\/e2e\/lanes\.json, and:\n {2}settings: input must be one of/);
  assert.match(blocked, /our own races are bugs, not tolerance/);
  assert.equal(push({}, {settings: entry({input: 'outside'})}), '');
});

test('a checkout with no base to compare with says nothing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-check-'));
  try { assert.equal(checkPush({root: dir, base: 'origin/main'}), ''); } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('the push script runs it, so the CI gate (the same script) and a local push both block', () => {
  assert.match(fs.readFileSync(path.join(root, 'tools/pre-push-check.sh'), 'utf8'), /node tools\/lanes-check\.mjs --base origin\/main/);
});
