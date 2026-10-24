// The narrowest window (owner, 9 Oct 2026: Jobadabra and Chrome side by side on a 14-inch screen, about 700 px each).
// Two things keep it usable: the window may be that narrow, and no single-column grid is a bare `1fr` (it grows to its widest child, so a long
// line pushed cards and buttons off the right edge: "+ New session", "Jobadabra never clicks Submit"). Use minmax(0, 1fr).
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {MIN_WIDTH} from '../lib/main-window.js';

const renderer = fileURLToPath(new URL('../renderer/', import.meta.url));

test('the window can be half of a 14-inch screen wide (1352–1512 px: about 676 px)', () => {
  assert.ok(MIN_WIDTH <= 676, `MIN_WIDTH ${MIN_WIDTH}`);
});

test('no stylesheet has a bare single-column `grid-template-columns: 1fr`', () => {
  const bare = readdirSync(renderer).filter(file => file.endsWith('.css'))
    .flatMap(file => readFileSync(join(renderer, file), 'utf8').split('\n').map((line, i) => [file, i + 1, line])
      .filter(([, , line]) => /grid-template-columns:\s*1fr\s*[;}]/.test(line)).map(([f, n]) => `${f}:${n}`));
  assert.deepEqual(bare, []);
});
