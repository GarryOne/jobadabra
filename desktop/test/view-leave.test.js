// renderer/pages/view-leave.js: what the Applying page stops when the person goes to another page (B follow-up 1, 28 Oct 2026: the live view's stream kept running behind
// the new page). The registry is tested by behaviour; nav.js and session-live.js are read for their one line each because the window needs Electron (sibling: job-drawer-closes-on-nav.test.js).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {leaveView, onLeaveView} from '../renderer/pages/view-leave.js';

test('leaving a page runs what it registered; staying on it or arriving elsewhere does not', () => {
  const seen = [];
  onLeaveView('sessions', () => seen.push('closed'));
  leaveView('sessions', 'sessions');
  leaveView('jobs', 'sessions');
  leaveView('', 'sessions');
  assert.deepEqual(seen, [], 'no move away from Applying, nothing closes');
  leaveView('sessions', 'jobs');
  assert.deepEqual(seen, ['closed']);
});

test('a handler that throws neither blocks the move nor the handlers after it', () => {
  const seen = [];
  onLeaveView('settings', () => { throw new Error('stop failed'); });
  onLeaveView('settings', () => seen.push('second'));
  leaveView('settings', 'jobs');
  assert.deepEqual(seen, ['second']);
});

test('openView tells the registry on every move, and the live view registers its close', () => {
  const read = file => fs.readFileSync(new URL(`../renderer/pages/${file}`, import.meta.url), 'utf8');
  const nav = read('nav.js'), live = read('session-live.js');
  assert.match(nav, /import \{leaveView\} from '\.\/view-leave\.js';/);
  assert.ok(nav.indexOf('leaveView(leaving, name);') > nav.indexOf('export function openView('), 'openView calls leaveView');
  assert.match(live, /onLeaveView\('sessions', closeLive\);/);
});
