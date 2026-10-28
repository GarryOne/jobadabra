// The prompt fingerprint of the ladder (e2e/lib/ladder-fingerprint.mjs): the push gate replays STORED answers, so a changed prompt or schema would never be seen by it. A hash of every model-facing prompt and
// schema sits in e2e/ladder-baseline.json (promptFingerprint); a different hash fails the ratchet with what to re-run. Here: an unchanged tree passes, a changed string in a COPY of a file fails, only that rung.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {test} from 'node:test';
import {PROMPT_FILES, fingerprintProblems, fingerprints} from '../e2e/lib/ladder-fingerprint.mjs';
import {nextBaseline, readBaseline} from '../e2e/lib/ladder-baseline.mjs';
import {touchedLadderFiles} from '../../tools/ladder-gate.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// A loader that imports a COPY of one prompt file with one string changed (its relative imports made absolute), so the real tree is never touched.
function loaderWithChange(file, from, to) {
  const source = fs.readFileSync(path.join(repo, file), 'utf8');
  assert.ok(source.includes(from), `${file} does not contain ${JSON.stringify(from)}`);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ladder-fp-'));
  const copy = path.join(folder, path.basename(file));
  const absolute = source.replace(from, to).replace(/(from\s*|import\()\s*(['"])(\.{1,2}\/[^'"]+)\2/g, (_, lead, quote, spec) => `${lead}${quote}${pathToFileURL(path.resolve(path.dirname(path.join(repo, file)), spec)).href}${quote}`);
  fs.writeFileSync(copy, absolute);
  return target => import(target === file ? pathToFileURL(copy).href : pathToFileURL(path.join(repo, target)).href);
}

test('every model-facing prompt and schema is exported, and the fingerprint is stable', async () => {
  const first = await fingerprints(), second = await fingerprints();
  assert.deepEqual(first, second);
  assert.deepEqual(Object.keys(first), PROMPT_FILES.map(item => item.key));
  assert.deepEqual(Object.keys(first), ['rung2', 'rung2-frames', 'rung3', 'account-judge', 'form-judge', 'fill-verify', 'fill-repair', 'rung4']);
  assert.ok(Object.values(first).every(hash => /^[0-9a-f]{16}$/.test(hash)));
  assert.equal(new Set(Object.values(first)).size, PROMPT_FILES.length, 'two rungs hash the same: a part is missing');
});

// 28 Oct 2026: the form judge's SUBMIT_RULE, rung 2's FORM_CHECK_RULE and rung 3's FRAME_RULE all reached the model unhashed, so an edit to one alone passed the gate.
test('every exported prompt constant of a listed file (a *_RULE, *INSTRUCTIONS, *SCHEMA or schema) is in its fingerprint', async () => {
  const promptName = /^([A-Z_]*_RULE|[A-Z_]*INSTRUCTIONS|[A-Z_]*SCHEMA|schema)$/;
  for (const file of new Set(PROMPT_FILES.map(item => item.file))) {
    const hashed = new Set(PROMPT_FILES.filter(item => item.file === file).flatMap(item => item.parts));
    const unhashed = Object.keys(await import(pathToFileURL(path.join(repo, file)).href)).filter(name => promptName.test(name) && !hashed.has(name));
    assert.deepEqual(unhashed, [], `${file}: add these to PROMPT_FILES parts (e2e/lib/ladder-fingerprint.mjs)`);
  }
});

test('control: an unchanged tree matches the committed baseline', async () => {
  assert.deepEqual(fingerprintProblems(await fingerprints(), readBaseline()), []);
});

test('a changed prompt string in a copy fails the gate, for that rung only, with what to re-run', async () => {
  const changed = await fingerprints({load: loaderWithChange('desktop/lib/ladder/rung3-digest.js', 'Beware: a closed notice', 'Beware (changed): a closed notice')});
  const problems = fingerprintProblems(changed, readBaseline());
  assert.equal(problems.length, 1);
  assert.match(problems[0], /the prompt of rung 3 changed: re-run `npm run ladder-score` live \(plan path\), `--record` the changed answers, then `--offline --update-baseline "<why>"`/);
});

test('a changed schema or a judge prompt fails too, each naming its own rung or judge', async () => {
  const schema = await fingerprints({load: loaderWithChange('desktop/lib/ladder/rung2-sketch.js', "bot_check: {type: 'boolean'", "bot_check: {type: 'string'")});
  assert.match(fingerprintProblems(schema, readBaseline()).join('\n'), /the prompt of rung 2 changed/);
  const judge = await fingerprints({load: loaderWithChange('desktop/lib/form-judge.js', 'You judge one page of a JOB APPLICATION form', 'You judge one PAGE of a JOB APPLICATION form')});
  assert.match(fingerprintProblems(judge, readBaseline()).join('\n'), /the prompt of the form judge changed/);
});

test('a baseline without a fingerprint, or with a missing one, asks for an update instead of passing', async () => {
  const now = await fingerprints();
  assert.match(fingerprintProblems(now, {fixtures: {}}).join('\n'), /no prompt fingerprint in the baseline/);
  const {rung4: _gone, ...partial} = now;
  assert.match(fingerprintProblems(partial, {promptFingerprint: now}).join('\n'), /rung 4/);
});

test('--update-baseline writes the fingerprints; a push touching a prompt file starts the gate', async () => {
  const written = nextBaseline([], {reasons: []}, 'why', '2026-10-11', await fingerprints());
  assert.deepEqual(written.promptFingerprint, await fingerprints());
  const touched = touchedLadderFiles(['desktop/lib/ladder/rung4-picture.js', 'desktop/lib/account-judge.js', 'desktop/lib/form-judge.js', 'README.md'], []);
  assert.equal(touched.length, 3);
});
