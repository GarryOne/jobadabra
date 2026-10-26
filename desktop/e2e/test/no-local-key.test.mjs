// The rule, enforced for every suite that exists or will exist (owner, 5 Oct 2026: "no local e2e suite should ever load the Anthropic key"): test code reaches a model only through
// lib/model.mjs, and only lib/engine.mjs reads E2E_ANTHROPIC_KEY, so a new suite cannot spend a key on a Mac by accident. CI-only tools are listed, each with its reason.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';

const E2E = path.resolve(import.meta.dirname, '..');
const CI_ONLY = new Set([
  'review-ui.mjs',          // the AI screenshot review: CI only (README)
  'review-eval.mjs',        // scores a screenshot reviewer on the judged issues: CI only, by hand (.github/workflows/review-eval.yml)
  'ai-cost-report.mjs',     // reads what Anthropic billed (admin key), spends nothing
  'lib/ai-proxy.mjs',       // the stand-in for the API: it forwards only when a key is behind it
  'lib/model.mjs',          // the one door: the API in CI, Claude Code on a Mac
  'lib/engine.mjs',         // reads E2E_ANTHROPIC_KEY, and only in CI
  'lib/context.mjs',        // hands the CI key to a suite, empty on a Mac
  'lib/key-check.mjs',      // CI only (context.mjs calls it only in CI): one free GET of the model list with the key; the secret's name is in its error
]);
const files = dir => fs.readdirSync(path.join(E2E, dir), {withFileTypes: true}).flatMap(entry => entry.isDirectory() ? [] : /\.mjs$/.test(entry.name) ? [path.join(dir, entry.name)] : []);
// Code only: a comment may name the key.
const code = file => fs.readFileSync(path.join(E2E, file), 'utf8').split('\n').filter(line => !/^\s*\/\//.test(line)).join('\n');
const sources = [...files('.'), ...files('lib'), ...files('suites')].map(file => file.replace(/^\.\//, '')).filter(file => !CI_ONLY.has(file));

test('no suite or helper posts to the Anthropic API itself', () => {
  const offenders = sources.filter(file => /api\.anthropic\.com\/v1\/messages/.test(code(file)) && !/modelFetch/.test(code(file)));
  assert.deepEqual(offenders, [], `ask a model through lib/model.mjs (modelFetch / modelClient), never fetch the API directly: ${offenders.join(', ')}`);
});

test('nothing but the engine rule reads E2E_ANTHROPIC_KEY or the Keychain item', () => {
  const offenders = sources.filter(file => /E2E_ANTHROPIC_KEY|e2e\.anthropic_key/.test(code(file))
    && !/^(skip\.mjs|lib\/skip\.mjs)$/.test(file));
  // The CI tooling below reads its own secrets from the environment GitHub gives it, never from a Mac's Keychain.
  const allowed = new Set(['lib/wizard.mjs',   // only the label of the CI-only step that types the key
    'plan-run.mjs', 'finder-review.mjs', 'judge-exam.mjs', 'prejudge.mjs', 'verdict-audit.mjs', 'selfheal-stats.mjs', 'triage.mjs', 'lib/judge-exam.mjs', 'lib/prejudge.mjs', 'lib/triage.mjs', 'lib/breaker.mjs', 'lib/signatures.mjs']);
  const unexpected = offenders.filter(file => !allowed.has(file));
  assert.deepEqual(unexpected, [], `only lib/engine.mjs may read the key: ${unexpected.join(', ')}`);
});

test('a suite never reads the key straight from the environment', () => {
  const offenders = files('suites').filter(file => /process\.env\.E2E_ANTHROPIC_KEY|process\.env\.ANTHROPIC/.test(code(file)));
  assert.deepEqual(offenders, []);
});
