// The side-by-side preview's file name starts with the session's short name (scripts/preview-name.mjs).
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {previewPath, sessionShortName} from '../scripts/preview-name.mjs';

test('the file name, not the folder, gets the session name in front', () => {
  assert.deepEqual(previewPath(path.join('shots', 'a2', 'side-by-side.png'), 'a2'), {path: path.join('shots', 'a2', 'a2-side-by-side.png'), named: true});
  assert.equal(previewPath('after-tip.png', '4d').path, '4d-after-tip.png');
});

test('a name that already starts with it is kept; an unknown session still writes the file as given', () => {
  assert.deepEqual(previewPath(path.join('x', 'a2-after.png'), 'a2'), {path: path.join('x', 'a2-after.png'), named: true});
  assert.deepEqual(previewPath('after.png', '?'), {path: 'after.png', named: false});
});

test('the short name comes from the session lookup (JP_SESSION) without the project prefix', () => {
  const was = process.env.JP_SESSION; delete process.env.JOBADABRA_SESSION;
  process.env.JP_SESSION = 'jobadabra-zz';
  try { assert.equal(sessionShortName(), 'zz'); } finally { was === undefined ? delete process.env.JP_SESSION : process.env.JP_SESSION = was; }
});

test('side-by-side.mjs writes to the prefixed path and prints it; every doc that sends a session to open a preview says so', () => {
  assert.match(readFileSync(new URL('../scripts/side-by-side.mjs', import.meta.url), 'utf8'), /previewPath\(/);
  for (const file of ['CLAUDE.md', 'docs/rules/desktop-ui.md', '.claude/skills/desktop-change/SKILL.md', '.claude/skills/ui-look-and-feel/SKILL.md']) {
    const text = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
    assert.match(text, /side-by-side[\s\S]{0,400}session'?s? (short )?name/i, file);
  }
});
