// The run list the window reads names the app's own start-up work (the move of data into Notion) while it runs, so "the app is quiet" waits for it.
// Beta 3 (26 Oct 2026): the start-up move's engine step took the run lock between a Find jobs press's job boards and its search, so the e2e "AI silent" run waited for it.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as critical from '../lib/critical.js';
import {createAppNotify} from '../lib/app-notify.js';

const storage = {readText: () => '[]', settings: () => ({}), secret: () => ''};
const notify = createAppNotify({DEMO: true, Notification: null, app: {}, getStorage: () => storage, targets: {clean: t => t}, toWindow: () => {}, getWindow: () => null});

test('the run list names start-up work while it runs, and nothing once it is done', async () => {
  assert.deepEqual(notify.activity().busy, []);
  let finish;
  const work = critical.during('Moving your data to Notion', () => new Promise(done => { finish = done; }));
  assert.deepEqual(notify.activity().busy, ['Moving your data to Notion']);
  await new Promise(done => setImmediate(done));   // during() starts the work on the next tick
  finish();
  await work;
  assert.deepEqual(notify.activity().busy, []);
});
