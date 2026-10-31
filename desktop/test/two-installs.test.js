// Jobadabra installed twice on Windows (Microsoft Store package + the downloaded .exe): detection and what the running copy says. The layout is the one measured on a Windows runner (msix-spike.yml, two-installs).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {detectCopies, realProbes, STORE_IDENTITY, EXE_FOLDER, twoInstallsAction} from '../lib/two-installs.js';

const LOCAL = 'C:\\Users\\p\\AppData\\Local';
const FAMILY = `${STORE_IDENTITY}_8wekyb3d8bbwe`;
const STORE_DATA = `${LOCAL}\\Packages\\${FAMILY}\\LocalCache\\Roaming\\Jobadabra`;
const EXE = `${LOCAL}\\Programs\\${EXE_FOLDER}\\Jobadabra.exe`;

// A fake disk: the set of folders and files that exist, and which folders hold a person's data.
const probes = ({dirs = [], files = [], data = []} = {}) => ({
  isDir: dir => dirs.includes(dir),
  isFile: file => files.includes(file),
  names: dir => (dir === `${LOCAL}\\Packages` ? dirs.filter(d => d.startsWith(`${dir}\\`) && !d.slice(dir.length + 1).includes('\\')).map(d => d.slice(dir.length + 1)) : []),
  dataTime: dir => (data.includes(dir) ? 1 : 0),
});
const disk = {
  none: probes(),
  storeOnly: probes({dirs: [`${LOCAL}\\Packages\\${FAMILY}`]}),
  exeOnly: probes({files: [EXE]}),
  both: probes({dirs: [`${LOCAL}\\Packages\\${FAMILY}`], files: [EXE]}),
  bothStoreHasData: probes({dirs: [`${LOCAL}\\Packages\\${FAMILY}`, STORE_DATA], files: [EXE], data: [STORE_DATA]}),
};
const find = name => detectCopies({env: {LOCALAPPDATA: LOCAL}, probes: disk[name]});

test('detection: none, Store only, .exe only, both', () => {
  assert.deepEqual(find('none'), {store: '', exe: '', storeData: ''});
  assert.equal(find('storeOnly').store, `${LOCAL}\\Packages\\${FAMILY}`);
  assert.equal(find('storeOnly').exe, '');
  assert.equal(find('exeOnly').exe, EXE);
  assert.equal(find('exeOnly').store, '');
  const both = find('both');
  assert.ok(both.store && both.exe);
  assert.equal(both.storeData, '', 'a Store package that never made a data folder holds no data');
});

test('a Store copy that made its data folder in the package cache is told apart from an empty one', () => {
  assert.equal(find('bothStoreHasData').storeData, STORE_DATA);
});

test('only our own package identity counts as the Store copy', () => {
  const other = probes({dirs: [`${LOCAL}\\Packages\\SomeoneElse.Jobadabra_abc`, `${LOCAL}\\Packages\\${STORE_IDENTITY}Extra_abc`], files: []});
  assert.equal(detectCopies({env: {LOCALAPPDATA: LOCAL}, probes: other}).store, '');
});

test('without LOCALAPPDATA (Mac, Linux) nothing is found and nothing is read', () => {
  const boom = () => { throw new Error('read the disk'); };
  assert.deepEqual(detectCopies({env: {}, probes: {isDir: boom, isFile: boom, names: boom, dataTime: boom}}), {store: '', exe: '', storeData: ''});
});

test('the owner scenario: Store first with data, then the .exe copy with no data of its own is offered the Store copy', () => {
  assert.equal(twoInstallsAction({self: 'exe', copies: find('bothStoreHasData'), ownHasData: false}), 'use-store-copy');
});

test('both installed otherwise: one note; one copy only: nothing', () => {
  assert.equal(twoInstallsAction({self: 'exe', copies: find('bothStoreHasData'), ownHasData: true}), 'note');
  assert.equal(twoInstallsAction({self: 'store', copies: find('bothStoreHasData'), ownHasData: false}), 'note');
  assert.equal(twoInstallsAction({self: 'exe', copies: find('both'), ownHasData: false}), 'note');
  for (const name of ['none', 'storeOnly', 'exeOnly']) assert.equal(twoInstallsAction({self: 'exe', copies: find(name), ownHasData: false}), 'none', name);
});

test('the real probes read a folder on disk', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'two-installs-'));
  fs.writeFileSync(path.join(dir, 'a.txt'), 'x');
  assert.ok(realProbes.isDir(dir) && realProbes.isFile(path.join(dir, 'a.txt')) && !realProbes.isFile(dir) && !realProbes.isDir(path.join(dir, 'nope')));
  assert.deepEqual(realProbes.names(dir), ['a.txt']);
  assert.deepEqual(realProbes.names(path.join(dir, 'nope')), []);
});
