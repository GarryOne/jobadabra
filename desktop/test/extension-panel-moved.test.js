// A marked tab that is not the application's form tab never says "Ready to submit" (owner, 15 Oct 2026: the Adnovum posting tab showed the form tab's ready state).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {readPanel} from '../../worker/test/helpers/panel.js';
import * as review from '../lib/review.js';

const read = name => fs.readFileSync(new URL(`../../extension/${name}`, import.meta.url), 'utf8');

test('a posting tab with the mark, plus the bound form tab: the posting is told it continues elsewhere, the form shows its counts', () => {
  review._reset();
  const job = {id: 'a1', url: 'https://careers.example.test/job/1', company: 'Adnovum', status: 'input'};
  const page = (url, tab, extra = {}) => ({url, title: 'Apply', tab, session: 'a1', total: 0, left: 0, ...extra});
  review.report([job], page('https://careers.example.test/job/1#jobpilotto-fill=a1', 10));
  const form = review.report([job], page('https://career74.example.test/apply#jobpilotto-fill=a1', 20, {total: 6, left: 0}));
  assert.equal(form.matched, 'a1');
  assert.equal(review.tabOf('a1'), 20);
  const posting = review.report([job], page('https://careers.example.test/job/1#jobpilotto-fill=a1', 10));
  assert.equal(posting.moved, true);                    // the panel draws "Continues in another tab", never the form's Ready
  assert.deepEqual(review.allStates().map(state => [state.id, state.total, state.left]), [['a1', 6, 0]]);
});

test('the panel: moved is never ready, shows Go there, and the worker brings the named tab forward', () => {
  const panel = readPanel();
  assert.match(panel, /ready = !moved && (?:!pageMark && )?total > 0 && left === 0/);
  assert.match(panel, /moved \? 'Continues in another tab'/g);
  assert.match(panel, /\$\('\.go-there'\)\.onclick = .*type: 'panelGoTab', tab: movedTab/);
  assert.match(read('panel-markup.js'), /class="link go-there" hidden/);
  assert.match(read('messages-panel.js'), /message\?\.type === 'panelGoTab'[\s\S]*chrome\.tabs\.update\(message\.tab, \{active: true\}\)/);
});
