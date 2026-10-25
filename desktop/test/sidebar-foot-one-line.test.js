// Setup sidebar foot: the privacy note and the version are one line each; the privacy detail sits in the .tip tooltip (hover and keyboard focus).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'renderer');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const foot = html.match(/<div class="steps-foot">([\s\S]*?)<\/aside>/)[1];
const rows = [...foot.matchAll(/<(?:p|button)[^>]*class="fine (steps-[a-z]+)[^"]*"[^>]*>[\s\S]*?<\/(?:p|button)>/g)];

test('the sidebar-foot rows (privacy, version) have no line break and are cut with an ellipsis', () => {
  assert.deepEqual(rows.map(r => r[1]), ['steps-privacy', 'steps-version']);
  for (const [row, name] of rows) {
    assert.doesNotMatch(row, /<br/, `${name}: one line`);
    assert.match(css, new RegExp(`\\.${name} span[^{]*\\{[^}]*white-space: nowrap[^}]*text-overflow: ellipsis`), `${name}: nowrap + ellipsis`);
  }
});

test('the privacy note opens a popover with every old fact and its own close button (x, Esc, click-away)', () => {
  assert.match(rows[0][0], /<span>Encrypted<\/span>/, 'one word beside the shield');
  assert.match(rows[0][0], /aria-expanded="false"/);
  const pop = html.match(/<div class="privacy-pop"[\s\S]*?<\/div>/)[0];
  assert.match(pop, /id="privacy-close"[^>]*aria-label="Close"/);
  assert.match(pop, /this Mac/);
  assert.match(pop, /Keychain/);
  assert.match(pop, /encrypted/);
  assert.match(pop, /While Always on is off/);
  assert.doesNotMatch(pop, /Notion/, 'the Notion part is added only when connected');
  const store = fs.readFileSync(path.join(root, 'pages', 'store-parts.js'), 'utf8');
  assert.match(store, /privacy-text[\s\S]*connected/);
  assert.match(store, /Escape/);
  assert.match(store, /closest\('\.steps-privacy-wrap'\)/);
});

// Owner, 25 Oct 2026: the main sidebar's build line wrapped "15:39" onto a second row at some zooms. Every short status line in the foot is one row, cut with an ellipsis.
test('the main sidebar foot lines (build, plan chip, search hint, update, sessions) never wrap', () => {
  const rule = css.match(/\.sidebar \.build-line, ([^{]*)\{([^}]*)\}/);
  assert.ok(rule, 'one shared nowrap rule');
  for (const part of ['.build-line', '.allowance-chip-plan', '.allowance-chip-text', '.palette-hint span', '.nav-update span']) assert.ok(rule[0].includes(part), part);
  assert.match(rule[2], /white-space: nowrap/);
  assert.match(rule[2], /overflow: hidden/);
  assert.match(rule[2], /text-overflow: ellipsis/);
  assert.match(css, /\.nav-sessions > span:nth-child\(2\) \{[^}]*white-space: nowrap/);
  const sessions = fs.readFileSync(path.join(root, 'pages', 'sessions.js'), 'utf8');
  assert.match(sessions, /\$\('nav-sessions'\)\.title = text/, 'the full text is in the tooltip');
});
