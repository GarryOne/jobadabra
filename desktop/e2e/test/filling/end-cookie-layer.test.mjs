// The end check: a cookie layer still open at the end of a run is a miss in the verdict, never a clean end (Fidag, 11 Oct 2026).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {endShotLine, takeEndShot} from '../../lib/end-shot.mjs';
import {parseLive} from '../../lib/record-sites.mjs';

const tabWith = layer => ({url: () => 'https://a.example/apply', screenshot: async ({path: file}) => fs.writeFileSync(file, 'png'), evaluate: async () => layer});

test('a consent box still listed at the end is said out loud and becomes an error; none leaves the line as it was', async () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-layer-')), 'cap');
  const open = await takeEndShot({pages: () => [tabWith(['Ok', 'Politique de confidentialité'])]}, dir);
  assert.deepEqual(open.layer, ['Ok', 'Politique de confidentialité']);
  const line = endShotLine(open);
  assert.match(line, /live: cookie layer still open at the end: Ok \| Politique/);
  assert.ok(parseLive(`live: 59.2 s\n  ${line}\n`).errors.some(error => /cookie layer still open at the end/.test(error)));
  const clean = await takeEndShot({pages: () => [tabWith([])]}, dir);
  assert.equal(endShotLine(clean), 'live: end screenshot kept');
  assert.equal(parseLive(`live: 59.2 s\n  ${endShotLine(clean)}\n`).errors.some(error => /cookie layer/.test(error)), false);
});

