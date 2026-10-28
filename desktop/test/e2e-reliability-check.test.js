// Expectation edits and harness changes must explain themselves before push and in the PR gate.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {checkPush, expectationChanges, harnessProblems} from '../../tools/e2e-reliability-check.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const suite = 'desktop/e2e/suites/apply.mjs';
const lib = 'desktop/e2e/lib/runner.mjs';
const why = 'Test-was-wrong: the saved fixture contains three rows';
const fixture = name => fs.readFileSync(path.join(root, 'desktop/test/fixtures/e2e-reliability', name), 'utf8');

function replay(commit) {
  const {files} = JSON.parse(fixture(`${commit}.json`));
  // Historic check modules predate rule F; label both sides so only rule E is measured.
  const side = which => Object.fromEntries(Object.entries(files).map(([file, snippets]) => [file,
    (file.startsWith('desktop/e2e/lib/') ? '// Job: run tolerant suites as rates\n' : '') + snippets[which]]));
  return {before: side('before'), after: side('after')};
}

function push(before, after, message = 'Change', lanes = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reliability-check-'));
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
  const write = files => { for (const [file, text] of Object.entries(files)) {
    if (text === null) fs.rmSync(path.join(dir, file));
    else { fs.mkdirSync(path.dirname(path.join(dir, file)), {recursive: true}); fs.writeFileSync(path.join(dir, file), text); }
  } };
  try {
    git('init', '-q', '-b', 'main'); git('config', 'user.email', 'test@example.com'); git('config', 'user.name', 'test'); git('config', 'commit.gpgsign', 'false');
    write({'desktop/e2e/lanes.json': JSON.stringify({suites: lanes}), ...before});
    git('add', '-A'); git('commit', '-qm', 'Base'); git('branch', 'base');
    write(after); git('add', '-A'); git('commit', '-qm', message);
    return checkPush({root: dir, base: 'base'});
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
}

test('an expected number changed without a citation blocks; either citation passes', () => {
  const before = {[suite]: 'assert.equal(count, 2);'};
  const after = {[suite]: 'assert.equal(count, 3);'};
  assert.match(push(before, after), /Rule E.*apply\.mjs/s);
  assert.equal(push(before, after, `Change\n\n${why}`), '');
  assert.equal(push(before, after, 'Change\n\nExpect-changed-by: abc1234'), '');
  assert.match(push(before, after, 'Change\n\nTest-was-wrong:   '), /Rule E/);
});

test('multiline assertions, expect matchers, waits and timeout properties are checked', () => {
  for (const [before, after] of [
    ['assert.equal(\n count,\n 2\n);', 'assert.equal(\n count,\n 3\n);'],
    ['expect(count).toBe(2)', 'expect(count).toBe(3)'],
    ['await page.waitForTimeout(500)', 'await page.waitForTimeout(900)'],
    ['await page.waitForSelector("x", {timeout: 500})', 'await page.waitForSelector("x", {timeout: 900})'],
    ['await until(done, {timeout: 500})', 'await until(done, {timeout: 900})'],
  ]) assert.ok(expectationChanges(before, after).length, after);
});

test('skipping, deleting assertions or a suite, and moving a suite out of backbone require a citation', () => {
  assert.ok(expectationChanges('test("row", run)', 'test.skip("row", run)').length);
  assert.ok(expectationChanges('it("row", run)', 'it.skip("row", run)').length);
  assert.ok(expectationChanges('assert.ok(found)', '').length);
  assert.match(push({[suite]: 'export const run = () => {};'}, {[suite]: null}), /Rule E/);
  const registry = JSON.stringify({suites: {apply: {lane: 'tolerant'}}});
  assert.match(push({[suite]: 'assert.equal(n, 2)'}, {'desktop/e2e/lanes.json': registry}), /Rule E/);
});

test('base lanes determine the protected suite; shared expectation files stay protected', () => {
  assert.equal(push({[suite]: 'assert.equal(n, 2)'}, {[suite]: 'assert.equal(n, 3)'}, 'Change', {apply: {lane: 'tolerant'}}), '');
  const file = 'desktop/e2e/fixtures/golden/truth.json';
  assert.match(push({[file]: '{"score":82}'}, {[file]: '{"score":80}'}), /Rule E/);
});

test('adding a test, changing a log or comment, and mechanical reformatting stay free', () => {
  assert.deepEqual(expectationChanges('assert.equal(n, 2);', 'assert.equal( n, 2 );\nassert.equal(m, 3);'), []);
  assert.deepEqual(expectationChanges('console.log(2); // assert.equal(n, 2)', 'console.log(3); // assert.equal(n, 3)'), []);
  assert.deepEqual(expectationChanges('assert.ok(n, "two: 2")', 'assert.ok(n, "three: 3")'), []);
});

test('5395279 real noise-allowance change blocks without a citation and passes with its explanation', () => {
  const {before, after} = replay('5395279');
  const message = 'Replay model-noise allowance\n\nHarness-job: run tolerant suites as rates';
  assert.match(push(before, after, message), /Rule E.*suites\/quality\.mjs/s);
  assert.equal(push(before, after, `${message}\nTest-was-wrong: allow one model slip in nine judged texts`), '');
});

test('2625cef real personas expectation needs and accepts its product-change citation', () => {
  const {before, after} = replay('2625cef');
  assert.match(push(before, after), /Rule E.*personas\.mjs/s);
  assert.equal(push(before, after, 'Accept no job board for a non-IT persona\n\nExpect-changed-by: e2d7df8'), '');
});

test('real apply Submit-count throw guard protects its number and ignores unrelated code', () => {
  const before = fixture('apply-throw.snippet.txt');
  assert.match(push({[suite]: before}, {[suite]: before.replace('!== 1', '!== 2')}), /Rule E/);
  assert.equal(push({[suite]: before}, {[suite]: `${before}\nconsole.log(23); const opened = 4;`}), '');
  assert.deepEqual(expectationChanges(before, before.replace('throw new Error', '{\n throw new Error') + '\n}'), []);
});

test('throw guards protect conditions and multiplicity; added guards and formatting stay free', () => {
  const guard = 'if (count > 2) { throw new Error("bad"); }';
  for (const after of ['', guard.replace('2', '3'), guard.replace('>', '>='), 'if (count > 2) console.log(count);']) {
    assert.ok(expectationChanges(guard, after).length, after);
  }
  assert.ok(expectationChanges(`${guard}\n${guard}`, guard).length);
  assert.deepEqual(expectationChanges(guard, 'if ( count >\n 2 ) throw Error("new message 42");'), []);
  assert.deepEqual(expectationChanges(guard, `${guard}\nif (other > 3) throw Error("bad");`), []);
});

test('removing a real apply Problems helper needs a citation; adding and reformatting stay free', () => {
  const before = 'fail([...fillProblems({expected, left: form.legal, actual}), ...cvProblems(actual, cv)]);';
  assert.match(push({[suite]: before}, {[suite]: 'fail([...fillProblems({expected, left: form.legal, actual})]);'}), /Rule E/);
  assert.ok(expectationChanges('cvProblems(a); cvProblems(b);', 'cvProblems(a);').length);
  assert.deepEqual(expectationChanges(before, `${before}\nsubmitProblems(forms.fired, form.path);`), []);
  assert.deepEqual(expectationChanges(before, before.replace('cvProblems(', 'cvProblems (\n')), []);
});

test('lib check modules protect numeric comparisons and named limits even without a backbone caller', () => {
  for (const name of ['checks', 'fill-problems', 'quality', 'factjudge', 'baseline', 'truth']) {
    const file = `desktop/e2e/lib/${name}.mjs`;
    const before = '// Job: run the backbone\nexport const ok = value => value >= 8;';
    const after = before.replace('>= 8', '>= 6');
    assert.match(push({[file]: before}, {[file]: after}, 'Change\n\nHarness-job: run the backbone', {apply: {lane: 'tolerant'}}), /Rule E/);
    assert.equal(push({[file]: before}, {[file]: after}, `Change\n\nHarness-job: run the backbone\n${why}`), '');
  }
  for (const operator of ['<', '>', '<=', '>=', '===', '!==']) {
    for (const expression of [`value ${operator} 8`, `8 ${operator} value`]) {
      const before = `const ok = value => ${expression};`;
      assert.ok(expectationChanges(before, before.replace('8', '9'), 'desktop/e2e/lib/quality.mjs').length, expression);
    }
  }
  for (const name of ['ALLOW', 'MAX', 'MIN', 'LIMIT', 'THRESHOLD', 'TOLERANCE', 'BAND', 'RATE']) {
    const before = `const ${name}_SCORE = 0.12;`;
    assert.ok(expectationChanges(before, before.replace('0.12', '0.2'), 'desktop/e2e/lib/quality.mjs').length, name);
  }
  for (const before of [
    'const ok = score => Math.abs(score) >= (8 + offset);',
    'const MIN = 1, MAX = 8;',
    'function unstable(first, second, tolerance = 8) { return first > tolerance; }',
  ]) assert.ok(expectationChanges(before, before.replace('8', '9'), 'desktop/e2e/lib/quality.mjs').length, before);
  assert.ok(expectationChanges('const ok = n => n > -1;', 'const ok = n => n > 1;', 'desktop/e2e/lib/quality.mjs').length);
  const before = 'const TOLERANCE = 8; const ok = score => score > 4; console.log(2);';
  assert.deepEqual(expectationChanges(before, before.replace('log(2)', 'log(3)'), 'desktop/e2e/lib/quality.mjs'), []);
  assert.deepEqual(expectationChanges(before, before.replace(' = 8', '=\n 8').replace(' > 4', '>\n4'), 'desktop/e2e/lib/quality.mjs'), []);
  assert.deepEqual(expectationChanges('const x = n => n > 8;', 'const x = n => n > 9;', lib), []);
});

test('a changed harness file needs one valid Job line and a harness trailer independently', () => {
  const before = {[lib]: '// Existing runner\nexport const x = 1;'};
  const after = {[lib]: '// Existing runner\nexport const x = 2;'};
  assert.match(push(before, after), /Job:/);
  assert.match(push(before, after), /Harness-job:/);
  assert.match(push(before, after, 'Change\n\nHarness-job: run the backbone'), /Job:/);
  const labelled = {[lib]: '// Job: run the backbone\nexport const x = 2;'};
  assert.match(push(before, labelled), /Harness-job:/);
  assert.equal(push(before, labelled, 'Change\n\nHarness-job: run the backbone'), '');
  assert.equal(push(before, labelled, 'Change\n\nFixes-backbone-red: https://github.com/GarryOne/jobadabra/actions/runs/123'), '');
});

test('workflows and root harness modules are covered; untouched legacy files need no labels', () => {
  for (const file of ['.github/workflows/e2e.yml', 'desktop/e2e/suite.mjs', lib]) {
    assert.ok(harnessProblems([{file, after: '# Job: invented job'}], ['Harness-job: invented job']).length);
  }
  assert.deepEqual(harnessProblems([{file: suite, after: 'test()'}], []), []);
  assert.deepEqual(harnessProblems([{file: lib, after: '// Job: wait on state\n// Job: run the backbone'}], ['Harness-job: wait on state']).length > 0, true);
});

test('both push and PR checks run the gate; review rules block E, F and excessive Gitar rounds', () => {
  const script = fs.readFileSync(path.join(root, 'tools/pre-push-check.sh'), 'utf8');
  assert.match(script, /node tools\/e2e-reliability-check\.mjs --base origin\/main/);
  assert.ok(script.indexOf('node tools/e2e-reliability-check.mjs') < script.indexOf('case "$command" in *SHIP_PR=1*|*CI_GATES=1*)'));
  assert.match(fs.readFileSync(path.join(root, '.github/workflows/pr-gate.yml'), 'utf8'), /bash tools\/pre-push-check\.sh/);
  const review = fs.readFileSync(path.join(root, '.gitar/review/e2e-reliability.md'), 'utf8');
  for (const text of ['Rule E', 'Rule F', '2 rounds', 'blocking', 'tolerant']) assert.ok(review.includes(text), text);
});
