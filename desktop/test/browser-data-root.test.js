// Every reader of the browsers' user data (Chrome's profiles, the extension's install) goes through lib/browser-profile.js browserData, and
// JOBADABRA_BROWSER_DATA moves all of them: the e2e harness's own folder (e2e/lib/context.mjs), so a test run never reads the owner's browser
// profiles (16 Oct 2026: a local run read the owner's Chrome Local State and launched Chrome with its profile).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {browserData, lastUsedProfile} from '../lib/browser-profile.js';
import {support} from '../lib/extension-install.js';
import {chromeProfiles} from '../lib/apply.js';

const ROOT = path.join(path.sep, 'tmp', 'jp-e2e-browser-data-x');

test('JOBADABRA_BROWSER_DATA moves every browser-data reader, on Mac and PC', () => {
  for (const platform of ['darwin', 'win32']) {
    const env = {JOBADABRA_BROWSER_DATA: ROOT, HOME: '/Users/owner', LOCALAPPDATA: 'C:\\Users\\owner\\AppData\\Local'};
    assert.equal(browserData(platform, env), ROOT, platform);
    assert.equal(support(platform, env), ROOT, platform);
    assert.ok(String(chromeProfiles(platform, '/Users/owner', env)).replace(/\\/g, '/').startsWith(ROOT.replace(/\\/g, '/')), platform);
    const read = [];
    lastUsedProfile('Google Chrome', platform, env, file => { read.push(file); throw new Error('none'); });
    const slash = file => String(file).replace(/\\/g, '/');   // a PC path is joined with backslashes
    assert.ok(read.length && read.every(file => slash(file).startsWith(slash(ROOT))), `${platform}: ${read}`);
  }
});

test('without it, the browsers\' own folders (the product, unchanged)', () => {
  assert.equal(browserData('darwin', {HOME: '/Users/a'}), path.join('/Users/a', 'Library', 'Application Support'));
  assert.equal(browserData('win32', {LOCALAPPDATA: 'C:\\L'}), 'C:\\L');
});

test('no other lib file finds a browser\'s profile folder by itself (the class: a new reader goes through browserData)', () => {
  const lib = new URL('../lib/', import.meta.url);
  const offenders = fs.readdirSync(lib).filter(name => name.endsWith('.js') && !['browser-profile.js', 'apply.js'].includes(name))
    .filter(name => /['"]Application Support['"]\s*\)?[^\n]*(Chrome|Edge|Brave|Vivaldi|Chromium)|(Chrome|Edge|Brave|Chromium)[^\n]*['"]User Data['"]/.test(fs.readFileSync(new URL(name, lib), 'utf8')));
  assert.deepEqual(offenders, [], 'read browser data through lib/browser-profile.js browserData');
  assert.match(fs.readFileSync(new URL('apply.js', lib), 'utf8'), /if \(env\.JOBADABRA_BROWSER_DATA\) return path\.join\(browserData\(platform, env\), 'Google', 'Chrome'\);/);
});

test('the e2e harness gives every run its own browser-data folder, and refuses one under the real home', () => {
  const context = fs.readFileSync(new URL('../e2e/lib/context.mjs', import.meta.url), 'utf8');
  assert.match(context, /const browserEnv = \{JOBADABRA_BROWSER_DATA: fs\.mkdtempSync\(/);
  assert.match(context, /a test run must not read the owner's browser profiles/);
});
