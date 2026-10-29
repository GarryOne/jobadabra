// Every suite that stubs AI calls declares whether the rest may reach a real model (`export const realAi`); one that declares false is checked by the harness (lib/suite-main.mjs).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const SUITES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'suites');
const sources = fs.readdirSync(SUITES).filter(file => file.endsWith('.mjs')).map(file => [file, fs.readFileSync(path.join(SUITES, file), 'utf8')]);
const declared = source => /^export const realAi = (true|false);/m.exec(source)?.[1];

test('a suite that stubs AI calls (setMode / setCanned) declares realAi true or false', () => {
  const missing = sources.filter(([, source]) => /\.(setMode|setCanned)\(/.test(source) && !declared(source)).map(([file]) => file);
  assert.deepEqual(missing, [], `add "export const realAi = false;" (every AI call is a stand-in: the harness fails the run if one reaches a real model) or "= true" (some calls go on to the real model, metered): ${missing.join(', ')}`);
});

test('a declaration is exactly true or false, and strategy (all stand-in) declares false', () => {
  for (const [file, source] of sources) if (/export const realAi\b/.test(source)) assert.ok(declared(source), `${file}: realAi must be a literal true or false`);
  assert.equal(declared(sources.find(([file]) => file === 'strategy.mjs')[1]), 'false');
});

test('the harness runs the real-AI check for a suite declaring false', () => {
  assert.match(fs.readFileSync(path.join(SUITES, '..', 'lib', 'suite-main.mjs'), 'utf8'), /await runAiGuards\(suite, ctx, runAlways\)/);
  assert.match(fs.readFileSync(path.join(SUITES, '..', 'lib', 'no-real-ai.mjs'), 'utf8'), /suite\.realAi === false\) await runAlways\(/);
});
