// lib/storemove-steps.mjs processRows: the process table of each platform read into {pid, ppid, command} (the Windows one was missing: `ps -A` does not exist there).
import test from 'node:test';
import assert from 'node:assert/strict';
import {processRows, standInRows} from '../lib/storemove-steps.mjs';

test('a Unix `ps` listing and a Windows Get-CimInstance listing give the same rows', () => {
  const unix = processRows('  10     1 /Applications/Job Pilotto\n 11 10 python -m src.stores.copy --from sqlite --to notion\n', 'darwin');
  const windows = processRows(JSON.stringify([{ProcessId: 10, ParentProcessId: 1, CommandLine: 'Jobadabra.exe'}, {ProcessId: 11, ParentProcessId: 10, CommandLine: 'python.exe -m src.stores.copy --from sqlite --to notion'}, {ProcessId: 12, ParentProcessId: 10, CommandLine: null}]), 'win32');
  assert.deepEqual(unix.map(({pid, ppid}) => [pid, ppid]), [[10, 1], [11, 10]]);
  assert.deepEqual(windows.map(({pid, ppid}) => [pid, ppid]), [[10, 1], [11, 10], [12, 10]]);
  assert.ok(unix[1].command.includes('-m src.stores.copy') && windows[1].command.includes('-m src.stores.copy'));
  assert.equal(windows[2].command, '', 'a process whose command line is not readable is an empty command, not a crash');
});

test('a Windows listing of one process (PowerShell prints an object, not a list) and an empty one', () => {
  assert.equal(processRows(JSON.stringify({ProcessId: 7, ParentProcessId: 1, CommandLine: 'x'}), 'win32').length, 1);
  assert.deepEqual(processRows('', 'win32'), []);
});

test('standInRows reads a stand-in database\'s rows with their Status (the evidence of a screen that differs after a move)', () => {
  const rich = text => [{plain_text: text}];
  const objects = new Map([
    ['db1', {object: 'database', id: 'aaaa-bbbb', title: rich('Job Matches — AI Scored')}],
    ['db2', {object: 'database', id: 'cccc-dddd', title: rich('Job Tracker')}],
    ['p1', {object: 'page', parent: {database_id: 'aaaabbbb'}, properties: {Name: {type: 'title', title: rich('Orrin AG')}, Status: {select: {name: 'Not seen'}}}}],
    ['p2', {object: 'page', parent: {database_id: 'cccc-dddd'}, properties: {Name: {type: 'title', title: rich('Kestrel Labs')}}}],
  ]);
  assert.deepEqual(standInRows({objects: {values: () => objects.values()}}, 'Job Matches'), [{title: 'Orrin AG', status: 'Not seen', archived: false}]);
  assert.deepEqual(standInRows({objects: {values: () => objects.values()}}, 'Job Tracker'), [{title: 'Kestrel Labs', status: null, archived: false}]);
});
