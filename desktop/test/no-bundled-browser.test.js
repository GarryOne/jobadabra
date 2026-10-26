// Guard for the rule "large optional parts download on first use, never in the installer" (CLAUDE.md, owner 26 Oct 2026): the app's
// dependencies and installer file lists carry no browser engine (Playwright, Puppeteer, a Chromium). A hidden browser is an add-on fetched with a bar.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'));
const BROWSER = /(^|[/@-])(playwright|puppeteer|chromium|chrome-for-testing|ms-playwright)([/-]|$)/i;

test('the app ships no browser engine among its dependencies', () => {
  const bundled = Object.keys({...pkg.dependencies, ...pkg.optionalDependencies}).filter(name => BROWSER.test(name));
  assert.deepEqual(bundled, [], `a browser engine in desktop/package.json dependencies goes into the installer: make it a first-use add-on (lib/office-addon.js is the pattern)`);
});

test('the installer file lists pull in no browser engine', () => {
  const build = pkg.build || {};
  const entries = [...(build.files || []), ...(build.extraResources || []), ...(build.extraFiles || []), ...(build.asarUnpack || [])]
    .map(entry => (typeof entry === 'string' ? entry : `${entry.from || ''} ${entry.to || ''}`))
    .filter(entry => !entry.startsWith('!') && BROWSER.test(entry));
  assert.deepEqual(entries, [], 'the installer would carry a browser: download it on first use instead');
});

test('the guard spots a browser engine', () => {
  for (const name of ['playwright-core', 'playwright', '@playwright/test', 'puppeteer', 'ms-playwright/chromium-1243']) assert.ok(BROWSER.test(name), name);
  for (const name of ['pdf-lib', 'electron-log', 'docx-preview', '@xterm/xterm']) assert.ok(!BROWSER.test(name), name);
});
