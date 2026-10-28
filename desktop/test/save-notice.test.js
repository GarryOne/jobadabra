// A private file Windows holds too long reaches the person as a warn pop-up whose click is Retry; at quit a save still waiting is finished or reported (lib/save-notice.js).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {timing, writePrivate} from '../lib/private-file.js';
import {failedToast, quitMessage, retrySave, watchSaves} from '../lib/save-notice.js';

test('the pop-up names the file, says nothing is lost and carries the file for Retry', () => {
  const toast = failedToast(path.join('x', 'settings.json'));
  assert.match(toast.title, /settings\.json/);
  assert.match(toast.body, /nothing is lost/);
  assert.equal(toast.tone, 'warn');
  assert.equal(toast.retrySave, path.join('x', 'settings.json'));
  assert.match(quitMessage(['a/b/secrets.json']), /secrets\.json/);
});

test('a held file that stays held reaches the window as the pop-up, and Retry through the handler saves it once free', async () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform'), renameSync = fs.renameSync, saved = {...timing};
  let held = false;
  Object.defineProperty(process, 'platform', {value: 'win32'});
  fs.renameSync = (from, to) => { if (held) throw Object.assign(new Error('held'), {code: 'EPERM'}); return renameSync(from, to); };
  Object.assign(timing, {briefTries: 2, briefPauseMs: 1, retryMs: 10, giveUpMs: 60});
  const toasts = [];
  watchSaves({app: {on() {}}, dialog: {}, toWindow: (channel, body) => toasts.push([channel, body])});
  try {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-notice-')), 'settings.json');
    writePrivate(file, '{"v":0}');
    held = true; writePrivate(file, '{"v":1}');
    await new Promise(done => setTimeout(done, 300));
    assert.deepEqual(toasts.map(([channel, body]) => [channel, body.retrySave]), [['toast', file]]);
    held = false;
    assert.equal(retrySave({}, file), true);
    await new Promise(done => setTimeout(done, 100));
    assert.equal(fs.readFileSync(file, 'utf8'), '{"v":1}');
  } finally { Object.defineProperty(process, 'platform', platform); fs.renameSync = renameSync; Object.assign(timing, saved); }
});
