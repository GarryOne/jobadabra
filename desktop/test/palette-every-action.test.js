/* global document, window */
// Every button a person can press is in ⌘K, and a task that is running stays there (owner, 18 Oct 2026: "I don't find the Chrome extension card from Settings"). Renders the demo app (electron); skipped in CI (no display) and where electron is not installed.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';

const desktop = fileURLToPath(new URL('..', import.meta.url));
const nav = readFileSync(new URL('../renderer/pages/nav.js', import.meta.url), 'utf8');
const SKIP = {skip: process.env.CI || !existsSync(`${desktop}node_modules/.bin/electron`)};

// Left out on purpose: shortcuts that lead to a page ⌘K already lists, a twin whose Actions card is listed, a sole danger button that shares its section's entry, icon-only arrows.
const LEFT_OUT = new Set(['refresh', 'ov-review-setup', 'ov-profile', 'ov-backups', 'reset-review', 'cal-prev', 'cal-next', 'ov-alert-go', 'conn-alert-go']);   // the last two: an alert's shortcut to the Chrome extension card, which is listed

const probe = () => {
  const entries = window.__jp.paletteCommands(), listed = new Set(entries.map(entry => entry.node).filter(Boolean));
  const unlisted = [...document.querySelectorAll('.view button[id], .view button.action, .view .service-card button')]
    .filter(node => !node.closest('dialog, [role="dialog"]') && !listed.has(node) && !node.closest('[hidden]:not(.view):not([data-settings-page])') && (!node.disabled || node.dataset.runBusy))
    .map(node => node.id || node.textContent.trim());
  const names = new Set(entries.flatMap(entry => [entry.label, entry.label.replace(/^[^:]+: /, '')]));
  const headings = [...document.querySelectorAll('.view :is(h2, h3, h4)')].filter(node => !node.closest('dialog, [role="dialog"], [hidden]:not(.view):not([data-settings-page])')
    && !names.has(node.textContent.replace(/\s+/g, ' ').trim()) && /\p{L}{2}/u.test(node.textContent)).map(node => node.textContent.trim());
  // A parked feature's card (data-parked: Adzuna and Jooble, Google Jobs, Brave web search, job alerts) is never in ⌘K (owner, 26 Oct 2026).
  const parked = [...document.querySelectorAll('[data-parked] :is(h3, summary)')].map(node => node.textContent.replace(/\s+/g, ' ').trim())
    .filter(text => entries.some(entry => entry.label.includes(text.replace(/^\P{L}+/u, ''))));
  const running = document.getElementById('refresh');
  running.disabled = true; running.dataset.runBusy = '1';
  document.querySelectorAll('.action[data-command="run"]').forEach(card => { card.disabled = true; card.dataset.runBusy = '1'; });
  const whileRunning = window.__jp.paletteCommands().filter(entry => /^Find jobs$/.test(entry.label)).map(entry => entry.hint);
  return {unlisted, headings, parked, whileRunning, labels: entries.map(entry => entry.label)};
};

test('every button, card and section heading has a ⌘K entry; a running search keeps "Find jobs"', SKIP, () => {
  const run = spawnSync('node', ['scripts/shot.mjs', 'settings', '--no-picture', '--eval', `JSON.stringify((${probe})())`], {cwd: desktop, encoding: 'utf8', timeout: 90000});
  const result = JSON.parse(JSON.parse(run.stdout.trim().split('\n').pop()));
  assert.deepEqual(result.unlisted.filter(id => !LEFT_OUT.has(id)), [], 'these buttons are not in ⌘K: the sweeps in pages/nav.js missed them');
  assert.deepEqual(result.headings, [], 'these card and section headings are not in ⌘K');
  assert.deepEqual(result.parked, [], 'these parked cards are listed in ⌘K (src/features.py PARKED)');
  assert.ok(result.labels.includes('Chrome extension'), 'Settings → Chrome extension card is not in ⌘K');
  assert.deepEqual(result.whileRunning.length > 0, true, '"Find jobs" vanished from ⌘K while a search runs');
});

// CI-safe: the two sweeps that close the class are still in nav.js.
test('nav.js sweeps every page button and the hidden Settings connection cards', () => {
  assert.match(nav, /querySelectorAll\('\.view:not\(\[data-view="settings"\]\) button\[id\]'\)/);
  assert.match(nav, /section\.classList\.contains\('conn-panel'\) && !section\.dataset\.parked/);
  assert.match(nav, /\.cv-card-text b/);
});
