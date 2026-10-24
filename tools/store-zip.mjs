// Builds the Chrome Web Store package of the extension: a copy of extension/ without the manifest's "key" (the store refuses it and signs with its own), stamped with the build version, zipped. Usage: node tools/store-zip.mjs <out.zip>. Guard: desktop/test/store-zip.test.js.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {forBuild} from '../desktop/scripts/extension-stamp.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The manifest the store gets: the repo's, with the stamped version and no "key". Pure.
export function storeManifest(manifest, version) {
  const {key, ...rest} = manifest;
  return {...rest, version};
}

export function build(out, {repo = REPO, version = forBuild({repo})} = {}) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'store-zip-'));
  const copy = path.join(work, 'extension');
  fs.cpSync(path.join(repo, 'extension'), copy, {recursive: true, filter: file => !/(^|[\\/])(README\.md|\.DS_Store)$/.test(file)});
  const file = path.join(copy, 'manifest.json');
  fs.writeFileSync(file, JSON.stringify(storeManifest(JSON.parse(fs.readFileSync(file, 'utf8')), version), null, 2) + '\n');
  const target = path.resolve(out);
  fs.rmSync(target, {force: true});
  execFileSync('python3', ['-I', '-c', 'import shutil,sys; shutil.make_archive(sys.argv[1][:-4], "zip", sys.argv[2])', target, copy]);
  fs.rmSync(work, {recursive: true, force: true});
  return {out: target, version};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]?.endsWith('.zip')) { console.error('usage: node tools/store-zip.mjs <out.zip>'); process.exit(2); }
  const {out, version} = build(process.argv[2]);
  console.log(`store zip ${out} version ${version}`);
}
