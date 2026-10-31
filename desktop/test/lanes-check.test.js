// Rule E on the lane registry (tools/lanes-check.mjs): a suite leaves the backbone only by naming the input it depends on and why.
// Pure cases on the two texts, one throwaway git repo for the real push, the real registry as a class check, and the wiring into the push script.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkPush, entryProblems, FILE, lanesProblems, stepEntryProblems} from '../../tools/lanes-check.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WHY = 'Twelve golden postings go through the real check and a judge reads the free text.';
const entry = (over = {}) => ({lane: 'tolerant', input: 'ai', since: '2026-10-28', why: WHY, returns: 'Back to the backbone when the AI answers are keyed and a PR run proves it.', ...over});
const file = suites => JSON.stringify({v: 1, about: 'the registry', suites}, null, 2);

test('a tolerant suite with its input, its reason and a date passes', () => {
  assert.deepEqual(lanesProblems(file({}), file({quality: entry()})), []);
});

test('a tolerant suite with no input is refused, naming the suite and what it lacks', () => {
  const found = lanesProblems(file({}), file({settings: entry({input: undefined})}));
  assert.equal(found.length, 1);
  assert.match(found[0], /^settings: input must be one of ai, clock, outside/);
});

test('every lane entry needs a non-empty returns string', () => {
  for (const lane of ['tolerant', 'suspended', 'retired']) {
    for (const returns of [undefined, null, '', ' \t\n', 42, {}]) {
      const found = lanesProblems(file({}), file({quality: entry({lane, returns})}));
      assert.equal(found.length, 1, `${lane}: ${JSON.stringify(returns)}`);
      assert.match(found[0], /^quality: returns must be a non-empty string/);
    }
    assert.deepEqual(entryProblems(entry({lane, returns: 'Retire when its coverage is replaced.'})), []);
  }
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
  assert.equal(checkPush({root, base: 'HEAD'}), '');
  assert.ok(Object.keys(JSON.parse(text).suites).length > 0, 'a registry with no entry would pass for nothing');
});

// A push as the script sees it: base and head commits, with optional suite edits before or after the head commit.
function push(baseSuites, headSuites, {beforeCommit = () => {}, afterCommit = () => {}} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-check-'));
  const git = (...rest) => execFileSync('git', ['-C', dir, ...rest], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
  try {
    git('init', '-q', '-b', 'main'); git('config', 'user.email', 't@example.com'); git('config', 'user.name', 't'); git('config', 'commit.gpgsign', 'false');
    fs.mkdirSync(path.join(dir, path.dirname(FILE)), {recursive: true});
    fs.mkdirSync(path.join(dir, 'desktop/e2e/suites'), {recursive: true});
    fs.writeFileSync(path.join(dir, 'desktop/e2e/suites/settings.mjs'), '// A suite present in the push fixture.\n');
    fs.writeFileSync(path.join(dir, FILE), file(baseSuites)); git('add', '-A'); git('commit', '-qm', 'Base'); git('branch', 'base');
    fs.writeFileSync(path.join(dir, FILE), file(headSuites)); beforeCommit(dir);
    git('add', '-A'); git('commit', '--allow-empty', '-qm', 'Change the push'); afterCommit(dir);
    return checkPush({root: dir, base: 'base'});
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
}

test('a push that lists a suite as tolerant with no input is blocked with the rule; with the input it passes', () => {
  const blocked = push({}, {settings: entry({input: undefined})});
  assert.match(blocked, /this push changes the lane registry desktop\/e2e\/lanes\.json, and:\n {2}settings: input must be one of/);
  assert.match(blocked, /our own races are bugs, not tolerance/);
  assert.equal(push({}, {settings: entry({input: 'outside'})}), '');
});

// A step suspended by name (spec row 33, 31 Oct 2026): top-level `steps`, an owner and the issue holding the evidence.
const stepEntry = (over = {}) => ({lane: 'suspended', input: 'a loaded runner starves the hidden Chrome', since: '2026-10-31', owner: 'GarryOne', issue: 'https://github.com/GarryOne/jobadabra/issues/2701', why: WHY, returns: 'Back after its fix PR lands and main\'s next 3 runs pass it.', ...over});
const withSteps = steps => JSON.stringify({v: 1, about: 'the registry', suites: {}, steps}, null, 2);

test('a suspended step with its owner, its issue URL, a reason and a return passes', () => {
  assert.deepEqual(stepEntryProblems(stepEntry()), []);
  assert.deepEqual(lanesProblems(file({}), withSteps({apply: {'a step': stepEntry()}})), []);
});

test('a suspended step with no issue, no owner or a lane other than suspended is refused, naming suite and step', () => {
  assert.match(stepEntryProblems(stepEntry({issue: undefined})).join(), /issue must be the GitHub issue URL/);
  assert.match(stepEntryProblems(stepEntry({issue: 'https://example.test/1'})).join(), /issue must be the GitHub issue URL/);
  assert.match(stepEntryProblems(stepEntry({owner: ' '})).join(), /owner must name who fixes it/);
  assert.match(stepEntryProblems(stepEntry({lane: 'tolerant', input: 'ai'})).join(), /only ever suspended/);
  const found = lanesProblems(file({}), withSteps({apply: {'a step': stepEntry({returns: ''})}}));
  assert.equal(found.length, 1);
  assert.match(found[0], /^apply · a step: returns must be a non-empty string/);
});

test('an unchanged step entry is not checked again, and a push naming a step of a suite with no file is refused', () => {
  const same = withSteps({apply: {'a step': stepEntry({issue: 'not a url'})}});
  assert.deepEqual(lanesProblems(same, same), []);
});

test('a checkout with no base to compare with says nothing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-check-'));
  try { assert.equal(checkPush({root: dir, base: 'origin/main'}), ''); } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('a push refuses every head registry entry with no suite file, including a ceiling or an unchanged entry', () => {
  for (const missing of [{aiMissesMax: 0}, entry()]) {
    assert.equal(push({}, {nosuchsuite: missing}), 'nosuchsuite: desktop/e2e/lanes.json lists it but desktop/e2e/suites/nosuchsuite.mjs is not in this push; remove the entry or restore the suite');
  }
  assert.equal(push({nosuchsuite: {aiMissesMax: 0}}, {nosuchsuite: {aiMissesMax: 0}, settings: entry()}), 'nosuchsuite: desktop/e2e/lanes.json lists it but desktop/e2e/suites/nosuchsuite.mjs is not in this push; remove the entry or restore the suite');
});

test('a push deleting a listed suite with an unchanged registry reports only the missing suite', () => {
  const suites = {settings: entry()};
  const message = push(suites, suites, {
    beforeCommit: dir => fs.unlinkSync(path.join(dir, 'desktop/e2e/suites/settings.mjs')),
  });
  assert.equal(message, 'settings: desktop/e2e/lanes.json lists it but desktop/e2e/suites/settings.mjs is not in this push; remove the entry or restore the suite');
});

test('an untracked suite cannot hide its deletion from the committed push', () => {
  const suites = {settings: entry()};
  const message = push(suites, suites, {
    beforeCommit: dir => fs.unlinkSync(path.join(dir, 'desktop/e2e/suites/settings.mjs')),
    afterCommit: dir => fs.writeFileSync(path.join(dir, 'desktop/e2e/suites/settings.mjs'), '// Uncommitted restoration.\n'),
  });
  assert.equal(message, 'settings: desktop/e2e/lanes.json lists it but desktop/e2e/suites/settings.mjs is not in this push; remove the entry or restore the suite');
});

test('an uncommitted deletion does not make a committed suite missing from the push', () => {
  assert.equal(push({}, {settings: entry()}, {
    afterCommit: dir => fs.unlinkSync(path.join(dir, 'desktop/e2e/suites/settings.mjs')),
  }), '');
});

test('the push script runs it, so the CI gate (the same script) and a local push both block', () => {
  assert.match(fs.readFileSync(path.join(root, 'tools/pre-push-check.sh'), 'utf8'), /node tools\/lanes-check\.mjs --base origin\/main/);
});
