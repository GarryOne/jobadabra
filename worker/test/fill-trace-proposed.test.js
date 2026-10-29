// Coop, twin, 9 Oct 2026: the AI proposed answers (SMS, job subscription) in the pass after the fill, but flow.js kept only that pass's
// rows with a source, so the first pass's "no answer" stayed and the site's fill card counted the proposals as declined.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('a later pass keeps the rows of questions the AI proposed for, under the reason the page writes', () => {
  const flow = read('extension/fill-tab-finish.js'), fill = read('extension/page/fill.js');
  const reason = flow.match(/const PROPOSED = '([^']+)'/)?.[1];
  assert.ok(reason && fill.includes(`reason = '${reason}'`), 'flow.js PROPOSED is page/fill.js\'s own reason');
  assert.match(flow, /\.filter\(row => row\.source === 'Claude \(on the page\)' \|\| row\.reason === PROPOSED \|\| String\(row\.reason \|\| ''\)\.startsWith\(WRITTEN\) \|\| KIND_REASON\.test\(String\(row\.reason \|\| ''\)\)\)/);   // legal, demographic and "the AI gave no answer" kinds too (11 Oct 2026, Umantis Anrede)
  assert.ok(fill.includes(`reason = '${flow.match(/const WRITTEN = '([^']+)'/)?.[1]}: your own words to write'`), 'flow.js WRITTEN is page/fill.js\'s own reason word');
});
