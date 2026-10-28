// The push script runs the renderer class tests (the ones that read every renderer or lib file) when a push touches those files: a CI red caught in 0.4 s on the Mac.
// Why (28 Oct 2026): 40 red PR runs of "CI · Tests · desktop" in ~30 h; of the 34 that named a failing test file, these seven files failed 10 times (card-system 2, no-question-mark 2,
// roomy-cards 2, text-fields, solid-buttons, mac-words, design 1 each). The whole desktop unit suite on push was measured 108 s (spec rule H), so only this class runs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const script = fs.readFileSync(path.join(root, 'tools/pre-push-check.sh'), 'utf8');
const listed = (/class_tests="([^"]+)"/.exec(script) || [])[1];
const trigger = (/diff --name-only origin\/main\.\.\.HEAD[^\n]*\| grep -qE '([^']+)'[^\n]*\n[^\n]*timed "renderer class tests"/.exec(script) || [])[1];

test('the push script names the class tests and the files whose change runs them', () => {
  assert.ok(listed, 'tools/pre-push-check.sh has no class_tests="..." list');
  assert.ok(trigger, 'the class tests have no trigger on changed files');
});

test('every listed file exists and reads the renderer, so the list is the class and not a guess', () => {
  const files = String(listed).split(/\s+/).filter(Boolean);
  assert.ok(files.length >= 7, `only ${files.length} class tests listed`);
  for (const file of files) {
    const full = path.join(root, 'desktop', file);
    assert.ok(fs.existsSync(full), `${file} is listed but missing: a rename dropped it from the push check`);
    assert.match(fs.readFileSync(full, 'utf8'), /renderer/, `${file} does not read the renderer: it is not a class test`);
  }
  for (const named of ['no-question-mark', 'solid-buttons', 'card-system', 'text-fields']) assert.ok(files.some(file => file.includes(named)), `${named} (the #2322 class) is not listed`);
});

test('a change to a renderer file, a lib file or an allow-list runs them; a change elsewhere does not', () => {
  const runs = new RegExp(String(trigger));
  for (const file of ['desktop/renderer/answers.js', 'desktop/renderer/index.html', 'desktop/lib/os-text.js', 'desktop/test/text-fields-allowed.json', 'desktop/test/text-buttons-allowed.json']) assert.ok(runs.test(file), `${file} does not run the class tests`);
  for (const file of ['tools/lanes-check.mjs', 'desktop/e2e/lanes.json', 'src/job_rank.py']) assert.equal(runs.test(file), false, `${file} runs them for nothing`);
});
