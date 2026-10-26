// Every way the run panel opens reads Gmail's connection as it is now: the drawer (activity-panel.js openActivity) and Actions → Runs (runs-tab.js showTab). Without it a Gmail run showed
// "Check Gmail now" and "Gmail is not connected" for a connection nobody had read (cardstates, beta of 25 Oct 2026, after 5162b44 moved the list to Actions → Runs).
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const read = file => readFileSync(new URL(`../renderer/pages/${file}`, import.meta.url), 'utf8');

test('each entry that shows the run panel refreshes the Gmail connection', () => {
  const drawer = read('activity-panel.js').match(/export function openActivity[\s\S]*?\n}\n/)[0];
  assert.match(drawer, /refreshGmailConnection\(\)/, 'the drawer');
  const tab = read('runs-tab.js').match(/export function showTab[\s\S]*?\n}\n/)[0];
  assert.match(tab, /name === 'runs'[\s\S]*refreshGmailConnection\(\)/, 'Actions → Runs');
});
