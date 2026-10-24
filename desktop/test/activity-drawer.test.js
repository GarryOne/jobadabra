// The Recent activity drawer is told apart from the page behind it: its own surface and a stronger shadow, loaded after style.css (owner, 24 Oct 2026).
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const read = file => readFileSync(new URL(`../renderer/${file}`, import.meta.url), 'utf8');

test('the drawer has its own surface and shadow, after style.css', () => {
  const css = read('activity-drawer.css'), html = read('index.html');
  assert.match(css, /\.activity-panel \{[^}]*background: var\(--surface-2\)[^}]*box-shadow:/s);
  assert.ok(html.indexOf('activity-drawer.css') > html.indexOf('href="style.css"'), 'loaded after style.css');
});
