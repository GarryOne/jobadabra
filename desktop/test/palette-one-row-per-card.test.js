/* global document, window */
// ⌘K answers a card's name with that card, its path shown, its parts folded (owner, 27 Oct 2026: "when searching for Extension, I see too many options. I'd expect
// to see Settings -> Connections -> Chrome extension. and that's pretty much it"). Loops over the cards people type; renders the demo app (electron), skipped in CI
// (no display) and where electron is not installed. The CI-safe half is in palette.test.js.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';

const desktop = fileURLToPath(new URL('..', import.meta.url));
const SKIP = {skip: process.env.CI || !existsSync(`${desktop}node_modules/.bin/electron`)};

// Each card name → the top row it must give. A new card people search for: add it here.
const TOP = {
  extension: 'Settings → Connections → Chrome extension',
  chrome: 'Settings → Connections → Chrome extension',
  telegram: 'Settings → Connections → Telegram',
  gmail: 'Settings → Connections → Gmail and Calendar',
  notion: 'Settings → Connections → Notion',
  calendar: 'Open Calendar',
  cv: 'Profile → CV',
  profile: 'Open Profile',
  plan: 'Settings → Plan',
  promo: 'Redeem a promo code',
  'find jobs': 'Find jobs',
};

const probe = queries => (async () => {
  const {rank, shownLabel} = await import(new URL('palette.js', document.baseURI).href);
  const entries = window.__jp.paletteCommands(), out = {};
  const strong = (command, query) => query.split(/\s+/).some(term => command.label.toLowerCase().split(/[^a-z0-9]+/).some(word => word.startsWith(term)));
  for (const query of queries) {
    const rows = rank(entries, query);
    out[query] = {rows: rows.map(command => `${command.group}|${shownLabel(command)}`), weak: rows.some(row => !strong(row, query)) && rows.some(row => strong(row, query))};
  }
  return JSON.stringify(out);
})();

test('⌘K: a card name gives that card first, with its path; no duplicate rows, no hint-only rows beside it', SKIP, () => {
  const queries = [...Object.keys(TOP), 'stop extension', 'manual connection'];
  const run = spawnSync('node', ['scripts/shot.mjs', 'settings', '--no-picture', '--eval', `(${probe})(${JSON.stringify(queries)})`], {cwd: desktop, encoding: 'utf8', timeout: 90000});
  const result = JSON.parse(JSON.parse(run.stdout.trim().split('\n').pop()));
  for (const [query, top] of Object.entries(TOP)) {
    const {rows, weak} = result[query];
    assert.equal(rows[0]?.split('|')[1], top, `"${query}" should list ${top} first: ${rows.join(', ')}`);
    assert.equal(new Set(rows).size, rows.length, `"${query}" lists a row twice: ${rows.join(', ')}`);
    assert.equal(weak, false, `"${query}" lists a row that matched only its hint beside a label match: ${rows.join(', ')}`);
  }
  assert.deepEqual(result.extension.rows, ['Settings|Settings → Connections → Chrome extension'], 'the Chrome extension card, and that is it');
  assert.deepEqual(result['stop extension'].rows.map(row => row.split('|')[1]), ['Stop the extension']);
  assert.ok(result['manual connection'].rows[0]?.endsWith('→ Chrome extension: manual connection'), 'a part named by its own words shows, with its path');
});
