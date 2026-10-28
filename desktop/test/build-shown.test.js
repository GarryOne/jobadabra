// The wiring of "which build runs" (owner, 16 Oct 2026): the window's line and Restart button, the palette entry, the server's answer to the extension, the panel's foot and its Reload button.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {readPanel} from '../../worker/test/helpers/panel.js';

const read = file => fs.readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');

test('the window has the build line and the Restart button, started with the other pages, and ⌘K lists the restart', () => {
  const html = read('desktop/renderer/index.html');
  for (const id of ['build-line', 'build-text', 'build-news', 'nav-restart', 'nav-restart-text']) assert.match(html, new RegExp(`id="${id}"`), id);
  assert.match(read('desktop/renderer/app.js'), /await build\(\);/);
  assert.match(read('desktop/renderer/pages/nav.js'), /buildCommands\(\)/);
  assert.match(read('desktop/preload.cjs'), /buildState: call\('buildState'\), restartApp: call\('restartApp'\)/);
});

test('the server tells the extension its build; the worker keeps it; the panel shows it and offers Reload only when behind', () => {
  assert.match(read('desktop/lib/server.js'), /build: extensionBuild\(/);
  const report = read('extension/tab-report.js');
  assert.match(report, /appBuild: answer\?\.build/);
  assert.match(report, /panelBuild/); assert.match(report, /panelReload/);
  const review = readPanel();
  assert.match(review, /build\.behind !== 0/);
  assert.match(review, /type: 'panelReload'/);
});
