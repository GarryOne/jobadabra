// The Chrome Web Store package (tools/store-zip.mjs): no "key", the stamped version, every file the manifest names, and nothing from outside extension/.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {build, storeManifest} from '../../tools/store-zip.mjs';

test('storeManifest drops the key and takes the version', () => {
  assert.deepEqual(storeManifest({name: 'x', version: '0.9', key: 'abc'}, '0.9.5'), {name: 'x', version: '0.9.5'});
});

test('the zip has the manifest without a key, with the version, and the files it points at', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'store-zip-test-'));
  const out = path.join(dir, 'ext.zip'), unpacked = path.join(dir, 'unzipped');
  build(out, {version: '0.9.7'});
  execFileSync('python3', ['-I', '-c', 'import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', out, unpacked]);
  const manifest = JSON.parse(fs.readFileSync(path.join(unpacked, 'manifest.json'), 'utf8'));
  assert.equal('key' in manifest, false);
  assert.equal(manifest.version, '0.9.7');
  for (const file of [manifest.background.service_worker, manifest.action.default_popup, manifest.options_page, ...Object.values(manifest.icons)]) {
    assert.ok(fs.existsSync(path.join(unpacked, file)), `${file} is in the zip`);
  }
  fs.rmSync(dir, {recursive: true, force: true});
});
