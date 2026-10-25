// Jobs "+ Add": one toolbar button opens a dialog of three choices, each pressing the opener of a flow that already exists; ⌘K keeps one entry per flow plus "Add".
// Checked in the source (the window needs Electron; the rendered dialog is checked with npm run shot).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const html = read('../renderer/index.html'), nav = read('../renderer/pages/nav.js'), add = read('../renderer/pages/jobs-add.js');
const FLOWS = {'import-open': 'Add job', 'applied-open': 'Add application', 'lead-open': 'Add message or update'};

test('the toolbar shows one "+ Add" button; the three old openers stay, out of sight', () => {
  const toolbar = html.slice(html.indexOf('<div class="toolbar">'), html.indexOf('id="jobs-stuck"'));
  assert.match(toolbar, /<button[^>]*id="add-open"[^>]*><i data-icon="plus"><\/i> Add<\/button>/);
  const hidden = toolbar.slice(toolbar.indexOf('<span hidden>'), toolbar.indexOf('</span>'));
  for (const id of Object.keys(FLOWS)) assert.match(hidden, new RegExp(`id="${id}"`), `${id} is still there for its flow, inside the hidden span`);
  assert.deepEqual([...toolbar.matchAll(/<button[^>]*id="(import-open|applied-open|lead-open)"/g)].map(m => m[1]).sort(), Object.keys(FLOWS).sort());
});

test('each dialog row names an existing flow opener, in the owner\'s words', () => {
  const dialog = html.slice(html.indexOf('<dialog id="add-dialog"'), html.indexOf('</dialog>', html.indexOf('<dialog id="add-dialog"')));
  assert.match(dialog, /What would you like to add\?/);
  const rows = [...dialog.matchAll(/data-add="([\w-]+)"[^>]*>.*?<b>([^<]+)<\/b>/g)].map(m => [m[1], m[2]]);
  assert.deepEqual(Object.fromEntries(rows), FLOWS);
  assert.match(add, /\$\(id\)\.click\(\)/, 'a row presses the flow\'s own opener');
  assert.match(add, /ArrowDown/); assert.match(add, /ArrowUp/);
});

test('⌘K: "Add" opens the dialog; every flow keeps a direct entry named like its row', () => {
  assert.match(nav, /button\('jobs', 'add-open'/);
  for (const [id, label] of Object.entries(FLOWS)) assert.match(nav, new RegExp(`\\['${id}', '${label}'`), `${label} has its own entry`);
});

test('no text still names the old buttons', () => {
  const stale = /Applied elsewhere…|Log job activity…|Add a job…/;
  for (const file of ['../renderer/index.html', '../renderer/pages/jobs-render.js', '../renderer/pages/nav.js']) assert.doesNotMatch(read(file), stale, file);
});
