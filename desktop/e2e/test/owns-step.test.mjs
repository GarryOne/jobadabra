// A PR that changes a step in suites/apply.mjs or lib/apply-*.mjs runs it in the suite that runs it (pr-suites.mjs): apply runs the forms and CV steps,
// applyflows the journeys, both the shared ones. Every literal step there must belong to one of them, or a PR's change to it would run nothing (owner's yes, 26 Oct 2026).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {stepCalls} from '../lib/pr-suites.mjs';

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('every apply step is owned by apply or applyflows; only the shared ones by both', async () => {
  const apply = await import('../suites/apply.mjs'), flows = await import('../suites/applyflows.mjs');
  const files = ['suites/apply.mjs', ...fs.readdirSync(path.join(here, 'lib')).filter(name => /^apply-.*\.mjs$/.test(name)).map(name => `lib/${name}`)];
  const names = files.flatMap(file => stepCalls(fs.readFileSync(path.join(here, file), 'utf8')).map(call => call.name).filter(Boolean));
  assert.ok(names.length > 20, `positive control: ${names.length} steps read`);
  const nobody = names.filter(name => !apply.ownsStep(name) && !flows.ownsStep(name));
  assert.deepEqual(nobody, [], 'steps no suite owns: a PR changing them would run nothing');
  const both = names.filter(name => apply.ownsStep(name) && flows.ownsStep(name));
  assert.ok(both.every(name => apply.partOf(name) === 'both'), `owned twice but not shared: ${both.filter(name => apply.partOf(name) !== 'both').join('; ')}`);
});
