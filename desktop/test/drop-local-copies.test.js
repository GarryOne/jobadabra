// Dropping the Mac's own profile.md and answers.md once Notion has them is logged, so a round trip that lost them says who took them (beta 0.8.30, settings suite).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {dropLocalCopies} from '../lib/strategy-settings.js';
import {logTo} from '../lib/log.js';
import {logText} from './log-text.mjs';

test('dropping the local copies removes both files and logs which ones were there', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-drop-'));
  logTo(path.join(dir, 'logs'));
  const storage = {path: name => path.join(dir, name)};
  fs.writeFileSync(storage.path('profile.md'), '# profile');
  dropLocalCopies(storage);
  assert.equal(fs.existsSync(storage.path('profile.md')), false);
  const log = logText(path.join(dir, 'logs', 'app.log'));
  assert.match(log, /local copies dropped/);
  assert.match(log, /profile\.md/);
  assert.doesNotMatch(log, /answers\.md/, 'only the files that were there');
  dropLocalCopies(storage);   // nothing left: no second line
  assert.equal(logText(path.join(dir, 'logs', 'app.log')).match(/local copies dropped/g).length, 1);
});
