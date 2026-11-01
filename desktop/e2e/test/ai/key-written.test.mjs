// Windows closes wait for Chromium's key file before the hard exit (lib/app.mjs keyWritten; 7 Oct 2026, the jobs suite lost its Notion token to a new key).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {keyWritten} from '../../lib/app.mjs';

const appAt = dir => ({evaluate: async () => dir});

test('waits until Local State holds the key, and gives up after its limit', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-key-'));
  setTimeout(() => fs.writeFileSync(path.join(dir, 'Local State'), '{"os_crypt":{"encrypted_key":"RFBBUEk..."}}'), 60);
  assert.equal(await keyWritten(appAt(dir), {within: 2000, every: 10}), true);
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-key-'));
  fs.writeFileSync(path.join(empty, 'Local State'), '{"browser":{}}');
  assert.equal(await keyWritten(appAt(empty), {within: 50, every: 10}), false);
});

test('an app that no longer answers does not stop the close', async () => {
  assert.equal(await keyWritten({evaluate: async () => { throw new Error('Target closed'); }}, {within: 50}), false);
});
