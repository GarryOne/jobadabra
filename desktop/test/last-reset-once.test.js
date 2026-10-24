// "Data imported ✓" / "Jobadabra was reset" is shown once per app start, not again on every window reload (6 Oct 2026).
import assert from 'node:assert/strict';
import {mainSource} from './main-source.js';
import {test} from 'node:test';

test('lastReset hands the import/reset result to the window once, then null', async () => {
  const main = mainSource();
  const line = main.split('\n').find(l => l.includes("ipcMain.handle('lastReset'"));
  assert.ok(line, 'the lastReset handler exists');
  const resetDone = {imported: true, backup: 'x'};
  const body = line.trim().replace(/^ipcMain\.handle\('lastReset',\s*/, '').replace(/\);$/, '');
  const handler = new Function('getResetDone', `let resetTold = false; return ${body};`)(() => resetDone);   // lib/system-handlers.js: the reset result through a getter
  assert.deepEqual(handler(), resetDone);
  assert.equal(handler(), null, 'a reload does not show it again');
});
