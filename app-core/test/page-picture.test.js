// What the closer look takes of a page: typed values hidden for the capture and shown again; the "unsure twice" rule (extension/ladder/rung4-page-picture.js, extension/ladder/rung4-picture.js).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {hideValues, showValues} from '../../extension/ladder/rung4-page-picture.js';
import {unsureTwice} from '../../extension/ladder/rung4-picture.js';

test('values are hidden by one style and shown again by removing it; nothing else on the page changes', () => {
  const dom = new JSDOM('<body><input id="e" value="ada@example.com"><p id="t">Label</p></body>');
  Object.assign(globalThis, {document: dom.window.document});
  assert.equal(hideValues(), true);
  assert.equal(hideValues(), true);   // asked twice: still one style
  const styles = [...document.querySelectorAll('#jobadabra-hide-values')];
  assert.equal(styles.length, 1);
  assert.match(styles[0].textContent, /input[^}]*color: transparent !important/);
  assert.equal(document.getElementById('e').value, 'ada@example.com');   // the value itself is untouched: only its paint
  showValues();
  assert.equal(document.querySelectorAll('#jobadabra-hide-values').length, 0);
});

test('hideValues and showValues work injected alone, as executeScript runs them: no module scope (a module const threw in the page from 10 to 14 Oct)', () => {
  const dom = new JSDOM('<body><input id="e" value="ada@example.com"></body>', {runScripts: 'outside-only'});
  const hide = dom.window.eval(`(${hideValues.toString()})`), show = dom.window.eval(`(${showValues.toString()})`);
  assert.equal(hide(), true);
  assert.equal(dom.window.document.querySelectorAll('#jobadabra-hide-values').length, 1);
  assert.equal(show(), true);
  assert.equal(dom.window.document.querySelectorAll('#jobadabra-hide-values').length, 0);
});

test('the closer look takes no picture when the values could not be hidden', () => {
  const source = readFileSync(new URL('../../extension/ladder/rung4-picture.js', import.meta.url), 'utf8');
  assert.match(source, /if \(await run\(tab, frameId, hideValues\) !== true\)[^\n]*return null;/);
});

test('a closer look is wanted the second time a page state is unsure, once; a changed state starts again', () => {
  const seen = new Map();
  assert.deepEqual([unsureTwice(seen, 1, 'a'), unsureTwice(seen, 1, 'a'), unsureTwice(seen, 1, 'a')], [false, true, false]);
  assert.deepEqual([unsureTwice(seen, 1, 'b'), unsureTwice(seen, 1, 'b')], [false, true]);
  assert.equal(unsureTwice(seen, 2, 'a'), false);   // another tab
});
