// pages/browser-progress.js: Jobadabra's browser for Background automation (spec 2026-10-27-background-apply-execution, step B): offered where it is
// needed, downloaded only on the person's press, its progress with Cancel, and failed / cancelled with "Try again". Drawn with office-progress.js's block.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {browserView} from '../renderer/pages/browser-progress.js';

const MB = 1048576, start = 1_000_000;

test('nothing is shown where it is not offered, nor once the browser is there', () => {
  assert.deepEqual(browserView({step: 'none'}), {hidden: true});
  assert.deepEqual(browserView({step: 'ready'}, {offer: true}), {hidden: true});
});

test('offered: what it is, its size, once only, and the one press that starts it (nothing downloads by itself)', () => {
  const view = browserView({step: 'none'}, {offer: true});
  assert.equal(view.action, 'Download');
  assert.match(view.title, /Jobadabra's browser/);
  assert.match(view.fine, /About 200 MB, only once/);
  assert.deepEqual(view.steps, []);
});

test('downloading: share and MB, the steps in order, Cancel', () => {
  const view = browserView({step: 'download', bytes: 50 * MB, total: 200 * MB, started: start}, {now: start + 10_000});
  assert.equal(view.right, '25% · 50 of 200 MB');
  assert.equal(view.action, 'Cancel');
  assert.deepEqual(view.steps.map(s => s.kind), ['now', 'next', 'next']);
  assert.deepEqual(browserView({step: 'unpack', started: start}).steps.map(s => s.kind), ['done', 'done', 'now']);
  assert.equal(browserView({step: 'checking', started: start}).steps[0].kind, 'now');
});

test('failed or cancelled: said, with Try again', () => {
  const failed = browserView({step: 'failed', error: 'The download stopped.'});
  assert.equal(failed.action, 'Try again');
  assert.match(failed.fine, /The download stopped\./);
  assert.match(browserView({step: 'cancelled'}).title, /cancelled/);
});
