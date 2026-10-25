// A few sources that did not answer never replace a run's result: one small line under the card; a real failure keeps its box.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {partialWords, splitPartial} from '../renderer/pages/activity-partial.js';
import {activitySource} from './activity-source.js';

test('"1 feed(s) failed: Oxylabs." is the small line, not a warning box', () => {
  const {partial, rest} = splitPartial(['1 feed(s) failed: Oxylabs.']);
  assert.deepEqual(partial, {count: 1, names: ['Oxylabs']});
  assert.deepEqual(rest, []);
  assert.equal(partialWords(partial), '1 source didn’t answer: Oxylabs');
});

test('several sources are counted and named; other warnings stay for the box', () => {
  const {partial, rest} = splitPartial(['3 feed(s) failed: A, B, C.', 'AI limit reached, 5 job(s) not scored', '2868 job(s) waiting, none scored this run']);
  assert.equal(partialWords(partial), '3 sources didn’t answer: A, B, C');
  assert.equal(rest.length, 2);
});

test('the engine\'s list line ("- 7 feed(s) failed: … and 1 more.") is the same sources line, its count and names agree (owner\'s 25 Oct 2026 shot: "• - 7 feed(s) failed" with 6 names)', () => {
  const {partial, rest} = splitPartial(['- 7 feed(s) failed: A, B, C, D, E, F and 1 more.']);
  assert.deepEqual(partial, {count: 7, names: ['A', 'B', 'C', 'D', 'E', 'F']});
  assert.deepEqual(rest, []);
  assert.equal(partialWords(partial), '7 sources didn’t answer: A, B, C, D, E, F and 1 more');
  assert.equal(partialWords({count: 7, names: ['A', 'B']}), '7 sources didn’t answer: A, B and 5 more', 'never more sources than it names without saying so');
  assert.equal(partialWords({count: 3, names: []}), '3 sources didn’t answer');
});

test('every state: no failed sources draws no line; unrelated warnings are untouched', () => {
  for (const warnings of [[], ['2868 job(s) waiting, none scored this run'], ['Notion was busy (429)'], undefined]) {
    const {partial, rest} = splitPartial(warnings);
    assert.equal(partial, null);
    assert.deepEqual(rest, warnings || []);
  }
});

test('the renderer shows the line only for a finished, ok run (a failed run keeps its error box), for every kind', () => {
  const source = activitySource();
  assert.match(source, /const partial = run\?\.ok && !run\.live && split\.partial \? split : null;/);
  assert.match(source, /const warnings = partial \? split\.rest : detailWarnings;/);
  assert.doesNotMatch(source, /kindOf\(run\) === 'search'[^\n]*splitPartial/, 'not a search-only branch: Gmail, employers and analysis runs share it');
  const html = fs.readFileSync(new URL('../renderer/index.html', import.meta.url), 'utf8');
  assert.ok(html.indexOf('id="activity-card"') < html.indexOf('id="activity-partial"') && html.indexOf('id="activity-partial"') < html.indexOf('id="activity-next"'), 'under the card');
});
