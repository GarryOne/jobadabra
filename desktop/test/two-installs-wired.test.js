// The "installed twice" note is wired at start: main.js hands the dialog, shell and window list to the start-up jobs, which ask once outside demo mode (the note itself: test/two-installs-notice.test.js).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

const read = name => fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

test('start-up asks the installed-twice note once, outside demo mode, with the pieces main.js passes in', () => {
  const handlers = read('lib/background-handlers.js'), main = read('main.js');
  const demoBlock = handlers.slice(handlers.indexOf('if (!DEMO) {'));
  assert.match(demoBlock, /askInstalledTwice\(\{dialog, shell, storage, window: BrowserWindow\.getAllWindows\(\)\[0\]\}\)/, 'the note is asked inside the not-demo block');
  assert.match(main, /registerBackgroundHandlers\(\{[^}]*\bBrowserWindow\b[^}]*\bdialog\b[^}]*\bshell\b/, 'main.js passes BrowserWindow, dialog and shell');
  assert.match(handlers, /const \{[^}]*\bBrowserWindow\b[^}]*\bdialog\b[^}]*\bshell\b[^}]*\} = ctx;/, 'the start-up jobs take them from ctx');
});
