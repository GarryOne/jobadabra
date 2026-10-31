// Jobadabra installed twice on Windows (Microsoft Store package + the downloaded .exe): detection only (the note's tests are test/two-installs-notice.test.js). The layout is the one measured on a Windows runner (msix-spike.yml, two-installs).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {detectCopies, installedTwice, realProbes, STORE_IDENTITY} from '../lib/two-installs.js';
import {EXE, FAMILY, LOCAL, find, probes} from './two-installs-disk.js';

test('detection: none, Store only, .exe only, both', () => {
  assert.deepEqual(find('none'), {store: '', exe: ''});
  assert.deepEqual(find('storeOnly'), {store: `${LOCAL}\\Packages\\${FAMILY}`, exe: ''});
  assert.deepEqual(find('exeOnly'), {store: '', exe: EXE});
  assert.deepEqual(find('both'), {store: `${LOCAL}\\Packages\\${FAMILY}`, exe: EXE});
  assert.deepEqual(['none', 'storeOnly', 'exeOnly', 'both'].map(name => installedTwice(find(name))), [false, false, false, true]);
});

test('only our own package identity counts as the Store copy', () => {
  const other = probes({packages: ['SomeoneElse.Jobadabra_abc', `${STORE_IDENTITY}Extra_abc`]});
  assert.equal(detectCopies({env: {LOCALAPPDATA: LOCAL}, probes: other}).store, '');
});

test('without LOCALAPPDATA (Mac, Linux) nothing is found and nothing is read', () => {
  const boom = () => { throw new Error('read the disk'); };
  assert.deepEqual(detectCopies({env: {}, probes: {names: boom, isFile: boom}}), {store: '', exe: ''});
});

test('the real probes read a folder on disk', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'two-installs-'));
  fs.writeFileSync(path.join(dir, 'a.txt'), 'x');
  assert.ok(realProbes.isFile(path.join(dir, 'a.txt')) && !realProbes.isFile(dir));
  assert.deepEqual(realProbes.names(dir), ['a.txt']);
  assert.deepEqual(realProbes.names(path.join(dir, 'nope')), []);
});

