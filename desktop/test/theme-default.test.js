// A new install starts in the dark theme; a saved choice (light, dark, system) is kept (owner, 17 Oct 2026: "let's make the dark theme the default").
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {createMainWindow} from '../lib/main-window.js';

const theme = value => {
  const nativeTheme = {themeSource: ''};
  const {applyTheme} = createMainWindow({BrowserWindow: class {}, DEMO: false, HIDDEN: true, app: {}, here: '.', nativeTheme, shell: {}, getWindow: () => null, setWindow() {}});
  return {returned: applyTheme(value), source: nativeTheme.themeSource};
};

test('no saved theme starts dark, before the window exists (no white flash)', () => {
  for (const none of [undefined, null, '']) assert.deepEqual(theme(none), {returned: 'dark', source: 'dark'}, String(none));
});

test('a saved choice is kept: light, dark and system', () => {
  for (const saved of ['light', 'dark', 'system']) assert.deepEqual(theme(saved), {returned: saved, source: saved}, saved);
});

test('the window is told the theme before it is created, and the Appearance page and telemetry agree on the default', () => {
  const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
  assert.ok(main.indexOf('applyTheme(process.env.JOBADABRA_THEME') < main.indexOf('  createWindow();'), 'applyTheme runs before createWindow');
  assert.match(fs.readFileSync(new URL('../renderer/pages/theme.js', import.meta.url), 'utf8'), /settings\?\.theme \|\| 'dark'/);
  assert.match(fs.readFileSync(new URL('../lib/app-allowance.js', import.meta.url), 'utf8'), /theme: settings\.theme \|\| 'dark'/);
});
