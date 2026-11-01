// E2E_STEPS pulls in the steps a chosen step needs (lib/runner.mjs wantedWords), and every declared need names a step that exists (6 Oct 2026: filtered runs lacked state).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {wantedWords} from '../lib/runner.mjs';

test('a chosen step brings its needs, transitively, and nothing else', () => {
  const needs = {'in-app hold': ['five more up next', 'removes it for good'], 'removes it for good': ['five more up next', 'seed']};
  assert.deepEqual(wantedWords(['hold'], needs).sort(), ['five more up next', 'hold', 'removes it for good', 'seed'].sort());
  assert.deepEqual(wantedWords(['palette'], needs), ['palette']);
});

test('every step a suite declares as a need, or as needing one, is in that suite', async () => {
  const dir = new URL('../suites/', import.meta.url);
  for (const file of fs.readdirSync(dir).filter(name => name.endsWith('.mjs'))) {
    const {stepNeeds} = await import(new URL(file, dir));
    if (!stepNeeds) continue;
    const own = fs.readFileSync(new URL(file, dir), 'utf8');
    const source = own + (/from '\.\/(\w+)\.mjs'/.exec(own) ? fs.readFileSync(new URL(`${/from '\.\/(\w+)\.mjs'/.exec(own)[1]}.mjs`, dir), 'utf8') : '');
    for (const words of [...Object.keys(stepNeeds), ...Object.values(stepNeeds).flat()])
      assert.ok(source.toLowerCase().includes(words.toLowerCase()), `${file}: "${words}" names no step (renamed?)`);
  }
});
