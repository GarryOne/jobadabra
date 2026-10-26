// The apply suite's parts and fixtures stay consistent: every journey step runs where its fixture's kit is seeded, and the wrong-kind page
// has a page shape no other fixture shares (both broke the 9 Oct 2026 beta: a step in the wrong part, a shape remembered from another page).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import * as forms from '../lib/forms.mjs';
import {partOf} from '../suites/apply.mjs';
import * as applySuite from '../suites/apply.mjs';
import * as applyflowsSuite from '../suites/applyflows.mjs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const journeySteps = () => [...fs.readFileSync(new URL('../lib/apply-journeys.mjs', import.meta.url), 'utf8').matchAll(/ctx\.run\('((?:[^'\\]|\\.)*)'/g)]
  .map(match => match[1].replace(/\\'/g, "'"));

test('every journey step is a flows step, where its fixture jobs and kits are seeded', () => {
  const steps = journeySteps();
  assert.ok(steps.length >= 10, `only ${steps.length} journey steps read: the pattern no longer matches`);
  assert.deepEqual(steps.filter(name => partOf(name) !== 'flows'), []);
});

test('the wrong-kind page has its own page shape: no other fixture page shares its kind cache', async () => {
  // page-kind.js imports desktop/shared/ (made by desktop/scripts/stage.mjs): staged here when missing, files only (CI's plan job has no desktop dependencies).
  if (!fs.existsSync(new URL('../../shared/alias-schema.js', import.meta.url))) execFileSync(process.execPath, [fileURLToPath(new URL('../../scripts/stage.mjs', import.meta.url)), '--files-only'], {stdio: 'ignore'});
  const {pageShape} = await import('../../lib/page-kind.js');
  const {MISLABELLED} = forms;
  assert.equal(pageShape(MISLABELLED.url), MISLABELLED.shape);
  const pages = Object.values(forms).flatMap(item => (item && typeof item === 'object' && !Array.isArray(item) ? [item, ...Object.values(item)] : []))
    .filter(item => item && item !== MISLABELLED && typeof item.host === 'string' && typeof item.path === 'string')
    .flatMap(item => [item.path, item.accountPath, item.formPath].filter(Boolean).map(path => `https://${item.path === path ? item.host : item.accountHost || item.host}${path}`));
  assert.ok(pages.length >= 10, `only ${pages.length} fixture pages found`);
  assert.deepEqual(pages.filter(url => pageShape(url) === MISLABELLED.shape), []);
});

test('CI runs every part of the apply steps in exactly one suite, and the CV steps beside the forms', async () => {
  // Each suite's run(ctx) calls runApply(ctx, parts): read the parts from the source, the one line that says them (applyflows: the parts CI runs, not LIVE=1's).
  const partsOf = name => JSON.parse(fs.readFileSync(new URL(`../suites/${name}.mjs`, import.meta.url), 'utf8').match(/export const run = ctx => runApply\(ctx, (?:process\.env\.LIVE \? \[[^\]]*\] : )?(\[[^\]]*\])\)/)[1].replace(/'/g, '"'));
  const apply = partsOf('apply'), applyflows = partsOf('applyflows');
  assert.deepEqual([...apply, ...applyflows].sort(), ['cv', 'flows', 'forms']);   // each once: a part in both doubles its time, a part in neither never runs on CI
  assert.ok(apply.includes('cv') && apply.includes('forms'), 'the CV steps use the form fixtures, seeded where the forms run');
  assert.deepEqual([applySuite.macos, applyflowsSuite.macos], ['release', 'release'], 'both run on the macOS runner for a release (the extension through `open`, the CV attached) and on Linux for a PR (test/pr-linux.test.mjs)');
});
