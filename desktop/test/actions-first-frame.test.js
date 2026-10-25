// #286: opening Actions drew its run banner and the result card of an unseen run at the next refresh, a moment after the page appeared, and pushed the
// task grid down under the pointer (measured in the demo: 117 px -> 539 px; after this, 539 px from the first frame).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {activitySource} from './activity-source.js';

const read = file => fs.readFileSync(new URL(`../renderer/pages/${file}`, import.meta.url), 'utf8');

test('Actions is drawn from what the window knows before it is shown', () => {
  const open = read('nav.js').slice(read('nav.js').indexOf('export function openView'));
  const prepare = open.indexOf("if (name === 'actions') prepareActions();"), reveal = open.indexOf("document.querySelectorAll('.view').forEach(view => show(view");
  assert.ok(prepare > 0 && prepare < reveal, 'prepareActions runs while the page is still hidden');
  const activity = activitySource();
  assert.match(activity, /export function prepareActions\(\) \{\n\s+if \(!lastActivity\) return;\n\s+renderActionsPage\(lastActivity\);\n\s+showQueuedBanner\(lastActivity\);\n\s+showAwaitedResult\(lastActivity\.runs, \{opening: true\}\);/);
  assert.match(activity, /const onActions = opening \|\| /);
});

test('a finished run is drawn on Actions at once from its row (the compact banner), never after a page read', () => {
  const activity = activitySource();
  const body = activity.slice(activity.indexOf('function showActionsResult'), activity.indexOf('// The status bar'));
  assert.match(body, /drawBanner\(\$\('actions-result'\), model/);
  assert.doesNotMatch(body, /runDetail|read\(\)\.then|renderCardSkeleton/);
});
