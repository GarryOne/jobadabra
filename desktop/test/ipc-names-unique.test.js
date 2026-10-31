// Electron throws at start-up ("Attempted to register a second handler") when two files register one IPC channel, and nothing else caught it: LinkedIn jobs (31 Oct 2026) reused 'linkedinConnect',
// the profile import's channel, and ipc.test.js (preload ↔ handler) stayed green while the app would not boot. One loop over every registration in main.js and lib/.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';

const desktop = fileURLToPath(new URL('..', import.meta.url));
const files = [path.join(desktop, 'main.js'), ...fs.readdirSync(path.join(desktop, 'lib')).filter(name => name.endsWith('.js')).map(name => path.join(desktop, 'lib', name))];

test('no IPC channel is registered twice across main.js and lib/', () => {
  const seen = new Map(), twice = [];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/\b(?:ipcMain\.handle|handleImportant)\(\s*'([A-Za-z0-9_:-]+)'/g)) {
      const where = path.relative(desktop, file);
      if (seen.has(match[1]) && seen.get(match[1]) !== where) twice.push(`${match[1]}: ${seen.get(match[1])} and ${where}`);
      seen.set(match[1], where);
    }
  }
  assert.ok(seen.size > 100, `the scan found the app's channels (${seen.size})`);
  assert.deepEqual(twice, []);
});
