// The AI's "other" stands: a page with form fields is not turned into the application form by them, at any confidence (extension/page-kind-final.js, fill-flow.js).
// 13 Oct 2026, the owner's own Chrome: "page kind: other, 0.97" on a pull request, then "page kind corrected: a posting with no Apply but a form's fields", then the fill.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {noJobPage} from '../../extension/page-kind-final.js';

test('"other" is final at any confidence, kept or asked again; a posting, a form and no answer are not', () => {
  for (const confidence of [0.97, 0.8, 0.7, 0.6]) for (const by of ['ai', 'remembered']) assert.equal(noJobPage({kind: 'other', signal: 'confident', confidence, by}), true, `${by} ${confidence}`);
  assert.equal(noJobPage({kind: 'other', signal: 'unsure', confidence: 0.4}), true);
  assert.equal(noJobPage({kind: 'posting', signal: 'confident', confidence: 0.97}), false);   // a posting with no Apply but a form's fields is the form: the correction stays for it
  assert.equal(noJobPage({kind: 'form', signal: 'confident', confidence: 0.9}), false);
  assert.equal(noJobPage(null), false);   // no answer at all: the structure rule decides, as before
});

test('the fill flow\'s correction asks it before it forgets the AI\'s answer', () => {
  const source = ['fill-flow.js', 'fill-flow-read.js', 'fill-flow-steps.js'].map(file => fs.readFileSync(new URL(`../../extension/${file}`, import.meta.url), 'utf8')).join('\n');
  const line = source.split('\n').findIndex(text => text.includes("a posting with no Apply but a form\\'s fields"));
  assert.ok(line > 0, 'the correction is still there for a posting');
  assert.match(source.split('\n').slice(line - 3, line + 1).join('\n'), /noJobPage\(kind\)/);
  assert.match(source, /import \{noJobPage\} from '\.\/page-kind-final\.js'/);
});
