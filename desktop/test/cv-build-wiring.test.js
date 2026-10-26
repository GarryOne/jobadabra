// "Build a CV with the AI" is wired end to end: every id the page script reads exists in the window, the three entry points exist (setup, Profile, ⌘K),
// and each IPC the window calls is registered in the main process, preloaded and blocked in demo mode (it writes the CV and calls the AI).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const script = read('renderer/pages/cv-build.js'), html = read('renderer/index.html');

test('every id the page script uses is in the window', () => {
  const ids = new Set([...script.matchAll(/\$\('([\w-]+)'\)/g)].map(m => m[1]).concat([...script.matchAll(/'((?:cvb|cv)-[\w-]+)'/g)].map(m => m[1])));
  for (const id of ids) assert.match(html, new RegExp(`id="${id}"`), `#${id}`);
});

test('the entry points: setup, Profile and ⌘K', () => {
  assert.match(html, /id="cv-build"/); assert.match(html, /id="cv-build-profile"/);
  assert.match(read('renderer/pages/nav.js'), /Build a CV with the AI/);
  assert.match(read('renderer/app.js'), /cvBuild\(\)/);
});

test('each IPC is handled, preloaded and blocked in demo mode', () => {
  for (const name of ['buildCvDraft', 'buildCvSave', 'buildCvDownload']) {
    assert.match(read('lib/cv-build-handlers.js'), new RegExp(`handle\\('${name}'`), `${name} handled`);
    assert.match(read('preload.cjs'), new RegExp(`${name}: call\\('${name}'\\)`), `${name} preloaded`);
    assert.match(read('lib/demo.js'), new RegExp(`'${name}'`), `${name} blocked in demo`);
  }
});

test('From LinkedIn is shown but disabled with a "Coming soon" tooltip until LinkedIn approves sign-in (owner, 26 Oct 2026)', () => {
  const tag = html.match(/<button[^>]*id="cv-linkedin"[^>]*>/)[0];
  assert.match(tag, /\bdisabled\b/); assert.match(tag, /title="Coming soon"/); assert.doesNotMatch(tag, /\bhidden\b/);
});
