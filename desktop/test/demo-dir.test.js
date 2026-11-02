// The demo reads its fictional data from one folder (lib/demo.js folder/demoPath): demo/ by default, JOBADABRA_DEMO_DIR
// for another fictional person (the product media's personas). A read that names demo/ itself would show the default person.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {demoPath, folder} from '../lib/demo.js';

const desktop = path.join(import.meta.dirname, '..');

test('the demo folder is demo/ unless JOBADABRA_DEMO_DIR names another one', () => {
  assert.equal(folder('/app', {}), path.join('/app', 'demo'));
  assert.equal(folder('/app', {JOBADABRA_DEMO_DIR: '/tmp/nurse'}), '/tmp/nurse');
  assert.equal(demoPath(desktop, 'jobs.json'), path.join(folder(desktop), 'jobs.json'));
});

test('every demo read in the main process goes through demoPath, so a persona folder changes all screens', () => {
  const files = [path.join(desktop, 'main.js'), ...fs.readdirSync(path.join(desktop, 'lib'), {recursive: true})
    .filter(name => /\.(c|m)?js$/.test(name)).map(name => path.join(desktop, 'lib', name))];
  const offenders = files.filter(file => /path\.join\(\s*here\s*,\s*['"]demo['"]/.test(fs.readFileSync(file, 'utf8')))
    .map(file => path.relative(desktop, file).replaceAll('\\', '/'));
  assert.deepEqual(offenders, ['lib/demo.js'], 'read demo data with demoPath(here, name) from lib/demo.js');
  assert.ok(files.filter(file => fs.readFileSync(file, 'utf8').includes('demoPath(here,')).length >= 12, 'the handlers use demoPath');
});
