// A selector the window loses while a suite still uses it is flagged at push time (lib/stale-expectations.mjs staleSelectors, tools/stale-expectations.mjs).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {selectorNames, staleSelectors} from '../../lib/stale-expectations.mjs';

test('the names a suite selects on: ids, classes, data- attributes, getElementById', () => {
  assert.deepEqual([...selectorNames(`await page.click('#focus-list .focus-item[data-kind="nudge"]'); document.getElementById('filter-status'); page.locator('.view:not([hidden])')`)].sort(),
    ['data-kind', 'filter-status', 'focus-item', 'focus-list', 'view']);
  assert.equal(selectorNames("console.log('see the #3 item. done')").size, 0, 'not in a selector call');
});

test('flagged only when the push removed the name and the window has it nowhere', () => {
  const suites = [{file: 's.mjs', text: "await page.click('#focus-list .row');\nawait page.click('#kept-id');"}];
  const diff = '--- a/x\n-<ul id="focus-list"></ul>\n-<b id="kept-id"></b>\n+<ul id="focus-items"></ul>';
  assert.deepEqual(staleSelectors({diff, present: '<ul id="focus-items"></ul><b id="kept-id"></b>', suites}), [{word: 'focus-list', file: 's.mjs', line: 1}]);
  assert.deepEqual(staleSelectors({diff, present: '<ul id="focus-list-wrap"></ul><b id="kept-id"></b>', suites}).map(item => item.word), ['focus-list'], 'a longer name is not the same name');
  assert.deepEqual(staleSelectors({diff: '', present: '', suites}), [], 'nothing removed by this push: an old gap is not this push\'s');
});
