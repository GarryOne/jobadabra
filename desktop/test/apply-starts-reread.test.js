// Every press that starts an application in the window marks its job Applying in the store, so it ends in startedApplying() (pages/jobs.js): the row
// at once, then the list read again (renderer/job-writes.js). #1737: Apply did not, and the Jobs chips counted "Applying 0" with eight forms open.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const desktop = fileURLToPath(new URL('..', import.meta.url));
const walk = dir => fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry => (entry.isDirectory() ? walk(path.join(dir, entry.name)) : entry.name.endsWith('.js') ? [path.join(dir, entry.name)] : []));
// The IPC calls that start an application (main: lib/apply-handlers.js, ready-handlers.js, session-handlers.js). takeOverClaude is not one: it
// continues a session whose job is already Applying.
const STARTS = ['apply', 'applyOne', 'applyWithClaude', 'readyOpen', 'sessionRestart'];

test('every window call that starts an application ends in startedApplying (the row, then the list read again)', () => {
  const calls = [];
  for (const file of walk(path.join(desktop, 'renderer'))) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, at) => {
      for (const name of STARTS) if (line.includes(`window.pilot.${name}(`)) calls.push({where: `${path.relative(desktop, file)}:${at + 1}`, name, after: lines.slice(at, at + 8).join('\n')});
    });
  }
  for (const name of STARTS) assert.ok(calls.some(call => call.name === name), `no window call of ${name} found: the list is out of date`);
  for (const call of calls) assert.match(call.after, /startedApplying\(/, `${call.where}: ${call.name} starts an application but the Jobs list is not told (startedApplying)`);
});

test('a main handler that starts an application is in the list above', () => {
  const handlers = ['apply-handlers.js', 'ready-handlers.js', 'session-handlers.js'].map(name => fs.readFileSync(path.join(desktop, 'lib', name), 'utf8')).join('\n');
  // Each handler's own lines: a one-line handler, or from its line to the "  });" that closes it (never a helper defined between two handlers).
  const blocks = [], lines = handlers.split('\n');
  lines.forEach((line, at) => {
    const name = /\.handle\('(\w+)'/.exec(line)?.[1];
    if (!name) return;
    const end = line.trimEnd().endsWith('{') ? lines.findIndex((other, i) => i > at && /^  \}\);/.test(other)) : at;
    blocks.push([name, lines.slice(at, end + 1).join('\n')]);
  });
  const starting = blocks.filter(([, body]) => /applyOne\(|(apply|applyRunner)\.start\(|startClaude\(|restartAs\(/.test(body)).map(([name]) => name);
  assert.ok(starting.includes('applyOne') && starting.includes('sessionRestart'), 'the handler scan finds the known starts');
  for (const name of starting) assert.ok(STARTS.includes(name) || name === 'takeOverClaude', `${name} starts an application: add it to STARTS and end its window call in startedApplying`);
});
