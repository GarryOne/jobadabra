// A run that drafts kits gets About you's kit bundle (the CV with the Experience bank) in a file of its own, gone when the run ends; any other run gets none
// (owner, 28 Oct 2026, D1b option A; src/ai/kit.py about_you reads it). A real spawn: a probe module stands in for the engine and prints what it was given.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {logTo} from '../lib/log.js';
import * as engineLog from '../lib/engine-log.js';
import * as pipeline from '../lib/pipeline.js';
import {draftsKits} from '../lib/pipeline-args.js';

const PROBE = `import json, os
file = os.environ.get('JOB_PILOTTO_ABOUT_YOU_FILE', '')
print('ABOUT', json.dumps({'name': file and json.load(open(file, encoding='utf-8'))['parts']['cv']['name'], 'file': file}))
`;

test('draftsKits: Prepare, Prepare top matches and a search with auto-kits; not a search without them', () => {
  assert.ok(draftsKits(['src', 'daily', '--mode', 'prepare', '--job', 'abc']));
  assert.ok(draftsKits(['src', 'daily', '--mode', 'kits']));
  assert.ok(draftsKits(['src', 'daily', '--mode', 'run', '--auto-kit-max', '3']));
  assert.ok(!draftsKits(['src', 'daily', '--mode', 'today', '--auto-kit-max', '0']));
  assert.ok(!draftsKits(['src', 'daily', '--mode', 'run']));
});

test('a kit run reads the CV from its own bundle file, removed after the run; another run gets no file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-kit-bundle-'));
  const storage = {settings: () => ({}), secret: () => '', saveSettings: () => {}, path: (...parts) => path.join(dir, ...parts)};
  logTo(dir);
  engineLog.setFile(path.join(dir, 'engine.log'));
  fs.mkdirSync(path.join(dir, 'cv'), {recursive: true});
  fs.writeFileSync(path.join(dir, 'cv', 'cv.json'), JSON.stringify({name: 'Alex Morgan', jobs: []}));
  fs.writeFileSync(path.join(dir, 'jp_about_probe.py'), PROBE);
  const kit = await pipeline.run(storage, ['jp_about_probe', '--mode', 'kits'], () => {}, {PYTHONPATH: dir});
  const said = stdout => JSON.parse(/^ABOUT (.*)$/m.exec(stdout)?.[1] || '{}');
  const {name, file} = said(kit.stdout);
  assert.equal(name, 'Alex Morgan', kit.stdout);
  assert.ok(!fs.existsSync(file), 'the bundle file is gone after the run');
  const other = await pipeline.run(storage, ['jp_about_probe', '--mode', 'today'], () => {}, {PYTHONPATH: dir});
  assert.deepEqual(said(other.stdout), {name: '', file: ''}, 'a run that drafts no kit gets no bundle');
  logTo(null);
  engineLog.setFile(null);
});
