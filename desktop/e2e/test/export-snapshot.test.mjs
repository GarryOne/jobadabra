// Real archives pin the restore baseline despite live profile writes during export navigation.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {tar} from '../../lib/tar.js';
import {exportedFileDigests} from '../lib/export-snapshot.mjs';

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'export-snapshot-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const file = path.join(dir, 'export.tar.gz');
  return {dir, file, pack: names => execFileSync(tar(), ['-czf', file, '-C', dir, ...names])};
}

test('restore matches actual archive after a legitimate pre-export profile write', t => {
  const {dir, file, pack} = fixture(t);
  const before = {'profile.md': hash('earlier'), 'answers.md': null};
  fs.writeFileSync(path.join(dir, 'profile.md'), 'updated by opening Settings');
  pack(['profile.md']);
  const expected = exportedFileDigests(file, before);
  assert.notEqual(expected['profile.md'], before['profile.md']);
  const restored = execFileSync(tar(), ['-xOzf', file, 'profile.md']);
  assert.equal(expected['profile.md'], hash(restored));
  assert.notEqual(expected['profile.md'], hash('import corrupted the profile'));
  assert.equal(expected['answers.md'], null);
});

test('an originally present file omitted from export still fails', t => {
  const {dir, file, pack} = fixture(t);
  fs.writeFileSync(path.join(dir, 'answers.md'), 'answers');
  pack(['answers.md']);
  assert.throws(() => exportedFileDigests(file, {'profile.md': hash('profile')}), /omitted profile.md/);
});

test('dot-prefixed archive paths preserve binary CV bytes', t => {
  const {dir, file, pack} = fixture(t);
  const bytes = Buffer.from([0, 255, 13, 10, 128]);
  fs.writeFileSync(path.join(dir, 'cv.pdf'), bytes);
  pack(['./cv.pdf']);
  assert.deepEqual(exportedFileDigests(file, {'cv.pdf': hash(bytes)}), {'cv.pdf': hash(bytes)});
});

test('unreadable archives fail instead of returning an empty baseline', t => {
  const {file} = fixture(t);
  fs.writeFileSync(file, 'invalid archive');
  assert.throws(() => exportedFileDigests(file, {'profile.md': null}), /cannot read export archive/);
});
