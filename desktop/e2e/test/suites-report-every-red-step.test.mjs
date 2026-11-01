// Guards that every e2e suite either goes on after a red step (keepGoing / independent) or says why it cannot: one failed step must not hide the others (a fix then takes one round, not several).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const suitesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'suites');

// A suite whose steps build on one another (a later step reads what an earlier one made): going on after a red step would only pile up false reds. A new suite is
// independent by default (`export const keepGoing = true`, its setup step `critical`); to be listed here it needs a reason.
const CHAINED = {
  employers: 'each step reads the run the step before made (one run, its row, the second run)',
  jobs: 'each step reads the check the first one ran and the rows it wrote',
  personas: 'a persona is one chain: nothing saved, no check, no digest',
  quality: 'steps share the golden check; its optional ones already go on (soft)',
  qualityai: 'steps share the golden check; its optional ones already go on (soft)',
  strategy: 'each step reads the settings the step before saved and the check after them',
  wizard: 'one step',
};

const files = fs.readdirSync(suitesDir).filter(file => file.endsWith('.mjs'));

test('every suite goes on after a red step, or is listed as chained with its reason', () => {
  const bad = [];
  for (const file of files) {
    const name = file.replace(/\.mjs$/, ''), source = fs.readFileSync(path.join(suitesDir, file), 'utf8');
    const goesOn = /^export const keepGoing = true;/m.test(source) || /\bindependent\(/.test(source);
    if (!goesOn && !CHAINED[name]) bad.push(`${name}: add \`export const keepGoing = true;\` (setup step \`critical\`), or list it as chained with a reason`);
    if (goesOn && CHAINED[name]) bad.push(`${name}: goes on now; remove it from the chained list`);
  }
  assert.deepEqual(bad, []);
});

test('the chained list names only suites that exist', () => {
  assert.deepEqual(Object.keys(CHAINED).filter(name => !files.includes(`${name}.mjs`)), []);
});
