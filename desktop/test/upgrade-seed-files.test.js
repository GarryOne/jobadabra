// The upgrade + data test's demo person (scripts/upgrade-data-lib.mjs seedFiles) owns every plain file the store and the config know, so a file the fingerprint reads can never be missing from what the update is tested on.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {CONFIG_FILES} from '../lib/config-text.js';
import {fingerprintFolder} from '../lib/data-fingerprint.js';
import {TEXT_FILES} from '../lib/store/text-files.js';
import {seedFiles} from '../scripts/upgrade-data-lib.mjs';

test('the demo person has every user text, the cv, the settings and a search file; the config files that are not seeded are named here, not forgotten', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upgrade-seed-files-'));
  seedFiles(dir);
  const keys = Object.keys(fingerprintFolder(dir));
  for (const name of [...Object.values(TEXT_FILES), 'cv.pdf', 'cv/cv.json']) assert.ok(keys.includes(`file:${name}`), `${name} is seeded and fingerprinted`);
  for (const key of ['setupDone', 'store']) assert.ok(keys.includes(`json:settings.json:${key}`), `settings.json carries ${key}`);
  assert.ok(keys.includes('json:config/search.json:roles'));
  const notSeeded = CONFIG_FILES.filter(name => !fs.existsSync(path.join(dir, 'config', name)));
  assert.deepEqual(notSeeded, ['preferences.json', 'sources.json', 'scout_seeds.json'], 'a new config file the app learns about must be seeded here or listed as not seeded');
  assert.ok(JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')).setupDone, 'a set-up person, so the app opens the Jobs list and not the wizard');
});
