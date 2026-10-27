// The Profile Cover letter card has no separate fallback opt-in.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

test('the Cover letter panel has no fallback checkbox or opt-in copy', () => {
  const html = fs.readFileSync(path.join(here, '../renderer/index.html'), 'utf8');
  const panel = html.slice(html.indexOf('id="setting-letter"'), html.indexOf('id="setting-answers'));
  assert.doesNotMatch(panel, /letter-fallback|Use this approved base letter when a job has no tailored letter|Off:/);
  const view = fs.readFileSync(new URL('../renderer/pages/base-letter.js', import.meta.url), 'utf8');
  assert.doesNotMatch(view, /saveSettings|checkbox|letter-fallback/);
});
