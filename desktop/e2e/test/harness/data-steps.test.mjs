// The data steps are marked {data: true} like the safety steps, and one reader finds both (lib/safety-steps.mjs). A data step proves a store write, an export/import/move, a backup
// or where a credential goes; it gets no retry in a beta (lib/beta-retry.mjs).
// Why (1 Nov 2026, owner: "Auto-retry in betas only" / "Safety and data steps get no retry"): the list is the data rows of the keep-in-the-beta inventory (c27 test-stages, 1 Nov 2026);
// a step added to the list is added here, and a step marked in a suite but missing here is a mark nobody asked for.
// Job: report health
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {dataNamesIn, dataStepNames, isDataStep, safetyNamesIn, safetyStepNames} from '../../lib/safety-steps.mjs';

const DATA = [
  'finishing the setup without Notion opens the Job', 'a new install keeps its data on this Mac: the st', 'every scored job in the Jobs list is its Job Mat',
  'the person submits a form: the page after Submit',
];
const HERE = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

test('every data step of the list is marked {data: true} in a suite', () => {
  const marked = dataStepNames();
  for (const prefix of DATA) assert.ok(marked.some(name => name.startsWith(prefix)), `not marked as a data step: "${prefix}…"`);
  assert.ok(isDataStep(marked[0], marked));   // Why (1 Nov 2026): the sample was a settings backup step that moved to integration; any marked step shows the reader matches its own name
});

test('the seven LinkedIn steps (named by a table, so no literal call) are marked in the one helper that runs them', () => {
  const source = fs.readFileSync(path.join(HERE, '..', 'lib', 'linkedin-steps.mjs'), 'utf8');
  assert.match(source, /const step = \(key, body\) => ctx\.run\(NAMES\[key\], withDiagnosis\(ctx, fx, body\), \{needs, data: true\}\)/);
});

test('one reader, two marks: a data mark is not a safety mark and the other way round; a mark inside a string or a comment is none', () => {
  const text = "await ctx.run('a store step', async () => { const x = '{data: true}'; }, {needs, data: true});\nawait ctx.run('a posting step', () => {}, {safety: true});\n// await ctx.run('commented', () => {}, {data: true});";
  assert.deepEqual(dataNamesIn(text), ['a store step']);
  assert.deepEqual(safetyNamesIn(text), ['a posting step']);
});

test('no step is both: a safety step stays safety (its own rules), a data step stays data', () => {
  const safety = safetyStepNames();
  assert.deepEqual(dataStepNames().filter(name => safety.includes(name)), []);
});
