// Settings → Connections → Chrome extension (owner, 26 Oct 2026): "We should see the status from beginning", the fold opens or closes only when
// the state changes (a refresh after Add to Chrome closed what he had opened), and "For developers: load it from a folder" only in a development run.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {FRESH_MS, extensionFrom, extensionState} from '../renderer/service-status.js';
import {foldFollows} from '../renderer/fold-follows.js';

const read = file => fs.readFileSync(new URL(`../renderer/${file}`, import.meta.url), 'utf8');
const html = read('index.html');
const copy = {version: '0.9.626', enabled: true};

test('first paint: a kept Connected answer is still Connected, however long ago it was kept', () => {
  const at = Date.now() - 6 * 60 * 60 * 1000;   // kept six hours ago, the app restarted since
  const kept = extensionFrom({installed: [copy], seen: {at: at - 5000, version: '0.9.626'}, browserUp: true, at});
  assert.equal(kept.state, 'connected');
  assert.equal(kept.version, '0.9.626');
  assert.equal(extensionFrom(null).checking, true, 'nothing kept: Checking…, never the install steps');
});

test('just after a start, an installed extension that has not reported yet is still being checked, not "not connected"', () => {
  const args = {installed: [copy], seen: null, browserRunning: true};
  assert.equal(extensionState({...args, justStarted: true}).checking, true, 'it reports within 30 s of the start');
  assert.equal(extensionState({...args, justStarted: false}).state, 'idle', 'still silent after that: Installed · not connected');
  assert.equal(extensionState({installed: [], seen: null, justStarted: true}).state, 'absent', 'not installed is known at once');
  assert.equal(extensionState({installed: [copy], seen: {at: Date.now() - FRESH_MS - 1}, browserRunning: true, justStarted: true}).state, 'idle',
    'a report that went stale is not a start');
});

test('a fold follows the state only when the state changes: a same-state refresh keeps what the person chose', () => {
  const fold = {open: false, dataset: {}};
  foldFollows(fold, 'connected', false);
  assert.equal(fold.open, false, 'first draw: closed for Connected');
  fold.open = true;   // the person opens "Reinstall or troubleshoot"
  foldFollows(fold, 'connected', false);
  assert.equal(fold.open, true, 'a refresh with the same state leaves it open');
  foldFollows(fold, 'idle', true);
  assert.equal(fold.open, true);
  fold.open = false;   // the person closes it
  foldFollows(fold, 'idle', true);
  assert.equal(fold.open, false, 'and closed');
  foldFollows(fold, 'connected', false);
  assert.equal(fold.open, false, 'a new state decides again');
});

test('the extension card paints its kept state at first paint and folds only through foldFollows', () => {
  const code = read('pages/extension-setup.js');
  assert.match(code, /export function paintExtensionCardFirst\(/);
  assert.match(read('pages/connections.js'), /paintExtensionCardFirst\(\);/, 'called from the Connections init');
  assert.doesNotMatch(code, /\$\('ext-setup'\)\.open\s*=/, 'no forced open on each refresh');
  assert.match(code, /foldFollows\(\$\('ext-setup'\)/);
  const setup = /<details [^>]*id="ext-setup"[^>]*>/.exec(html)?.[0];
  assert.ok(setup);
  assert.doesNotMatch(setup, /\sopen\b/, 'the install steps are not open before the state is known');
});

// Every place a fold is opened or closed by code: either it follows a state (foldFollows), or it says why it may (the class).
const FOLD_SETTERS = {
  'profile-fold.js': 'the person\'s Fold all / Unfold all press',
  'page-parts.js': 'a new list drawn per action; doneOpen is the caller\'s choice',
  'survey-rows.js': 'a new editor drawn when the person presses Edit; it opens while sorting or with notes',
  'components.js': 'opens a panel the person asked to go to',
  'pages/experience.js': 'versions: remembers the person\'s toggle; What changed: a new box per answer',
  'pages/experience-profile.js': 'remembers the person\'s toggle per card',
  'pages/session-needs.js': 'the person\'s click on the bar',
  'pages/job-preferences.js': 'remembers the person\'s toggle per side',
  'pages/activity.js': 'the person\'s View technical log press',
  'pages/activity-render.js': 'only when another run is shown (dataset.for), and an empty log has nothing to open',
  'pages/application-answers.js': 'remembers the person\'s toggle; a search opens it',
  'pages/jobs.js': 'In conversation: the person\'s last toggle, kept',
  'pages/nav.js': 'opens what the person asked to go to',
  'pages/strategy-cards.js': 'opens the card the person asked to go to',
  'pages/settings.js': 'opens the help the person asked for',
  'job-drawer/parts.js': 'a new message card per drawer open; the newest starts open',
  'fold-follows.js': 'the shared rule itself',
};

test('every fold set by code is listed with why it never undoes the person\'s choice on a refresh', () => {
  const files = fs.readdirSync(new URL('../renderer/', import.meta.url), {recursive: true}).map(String).map(name => name.replace(/\\/g, '/'))
    .filter(name => name.endsWith('.js') && !name.includes('node_modules'));
  const found = new Set();
  for (const name of files) {
    // details.open = …, not state.open (a page's own "which run is open")
    if (/(?<!state)\.open\s*=(?!=)/.test(read(name))) found.add(name);
  }
  for (const name of found) assert.ok(name in FOLD_SETTERS, `${name} sets details.open: use foldFollows, or list it here with why`);
  for (const name of Object.keys(FOLD_SETTERS)) assert.ok(found.has(name), `${name} no longer sets a fold: remove it from the list`);
});

// Developer-only steps (Developer mode, Load unpacked, the extension folder) are for a run from source only, never the beta or stable install.
test('every developer-only block is hidden until the window knows it is a development run (the class)', () => {
  const blocks = [...html.matchAll(/<(\w+)\b[^>]*\bdata-dev-only\b[^>]*>/g)].map(match => match[0]);
  assert.ok(blocks.some(tag => /id="ext-dev"/.test(tag)), '"For developers: load it from a folder" is developer-only');
  for (const tag of blocks) assert.match(tag, /\shidden\b/, `${tag} starts hidden, so a packaged build never shows it`);
  assert.match(read('pages/core.js'), /\[data-dev-only\][^\n]*hidden = !shared\.state\.about\.dev/, 'only a development run shows them');
  // Words that only a developer acts on: each sits inside a developer-only block (the Install-the-extension dialog said them to everyone).
  const outside = html.replace(/<(details|div|li|section)\b[^>]*\bdata-dev-only\b[\s\S]*?<\/\1>/g, '');
  for (const words of [/Load unpacked/i, /Developer mode/i, /extension folder/i]) assert.doesNotMatch(outside, words, `${words} only inside data-dev-only`);
});
