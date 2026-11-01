// The old product name (job-pilotto in any spelling) does not come back: every use must be one the map keeps on purpose (tools/rename-map.json).
// Why (rename to Jobadabra, 1 Nov 2026, owner: "it should be all jobadabra"; his brief: "A guard: no new old-name use outside an allow-list"): ~3,000 uses had to be renamed once.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('no use of the old name outside the keep and owner rows of tools/rename-map.json', () => {
  let output = '';
  try { output = execFileSync('node', ['tools/rename-inventory.mjs', '--check'], {cwd: ROOT, encoding: 'utf8'}); } catch (error) { output = String(error.stdout || error.message); }
  assert.match(output, /no old-name use outside/, output);
});
