// The setup Welcome step's magic card and the shared magic effect: every state renders, the card is one real button, effects stop with reduced motion, privacy lives in Settings.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {shouldRun, burst} from '../renderer/magic.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'renderer');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('index.html');
const start = html.indexOf('<div class="step" data-step="welcome">');
const welcome = html.slice(start, html.indexOf('<div class="step" data-step="ai">', start));
const css = read('magic.css');

test('Welcome: first run and setup done each have a title, a line and a button label', () => {
  for (const when of ['first', 'done']) {
    assert.match(welcome, new RegExp(`<h1[^>]*data-when="${when}"`), `${when}: title`);
    assert.match(welcome, new RegExp(`<p[^>]*class="[^"]*magic-sub[^"]*"[^>]*data-when="${when}"`), `${when}: line`);
  }
  assert.match(welcome, /data-when="first"[^>]*>Start</);
  assert.match(welcome, /data-when="done" hidden>Review the steps</);
  assert.match(welcome, /Help me find a job/);
  assert.match(welcome, /data-look-around="welcome"/, 'Look around first (demo) stays');
  assert.match(welcome, /id="welcome-import"[^>]*data-import/, 'Import an export stays');
});

test('every [data-magic] card holds one real button with the next-step hook, covering the whole card', () => {
  const cards = [...html.matchAll(/<div[^>]*\bdata-magic\b[^>]*>([\s\S]*?<\/button>)\s*<\/div>/g)];
  assert.ok(cards.length >= 1, 'found the magic cards');
  for (const [tag, body] of cards) {
    // The CV step's two other ways in (.cv-way, pages/cv-build.js) are small side buttons above the card-wide one; the card still has exactly one stretched button.
    assert.equal((body.match(/<button\b(?![^>]*\bcv-way\b)/g) || []).length, 1, `one button in ${tag.slice(0, 60)}`);
    assert.match(body, /<button[^>]*class="[^"]*magic-go[^"]*"/, 'the stretched button');
  }
  assert.match(css, /\.magic-go::after\s*\{[^}]*inset:\s*0/, 'the button covers the whole card');
  assert.match(css, /\.magic:focus-within/, 'a visible focus ring on the card');
});

test('privacy choices stay on Welcome as two calm, preselected switches wired to the Settings ones', () => {
  for (const id of ['welcome-trace', 'welcome-telemetry']) assert.match(welcome, new RegExp(`<input type="checkbox" id="${id}" checked aria-label=`), `${id}: on by default`);
  assert.match(read('pages/report-form.js'), /welcome-trace/);
  assert.match(read('pages/telemetry.js'), /welcome-telemetry/);
  assert.match(html, /id="report-form-on"/);
  assert.match(html, /id="telemetry-on"/);
  assert.doesNotMatch(welcome, /magic-fine/, 'no loose paragraph of fine print');
  assert.match(welcome, /<button class="secondary" data-look-around="welcome">Look around first \(demo data\)<\/button>/, 'Look around is a visible button');
});

test('the effects stop with reduced motion and never run on a finger', () => {
  assert.equal(shouldRun({reduced: true, pointerType: 'mouse'}), false);
  assert.equal(shouldRun({reduced: false, pointerType: 'touch'}), false);
  for (const pointerType of ['mouse', 'pen']) assert.equal(shouldRun({reduced: false, pointerType}), true);
  const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  for (const piece of ['.magic-twinkle', '.magic-spark', '.magic:hover']) assert.ok(block.includes(piece), `${piece} is switched off with reduced motion`);
  assert.match(read('magic.js'), /prefers-reduced-motion: reduce/);
});

test('a burst is a fixed number of sparkles spread around the point', () => {
  const sparks = burst(12, 90, () => 0.5);
  assert.equal(sparks.length, 12);
  for (const spark of sparks) assert.ok(Math.hypot(spark.dx, spark.dy) <= 90 * 1.5 + 0.01);
  assert.equal(new Set(sparks.map(s => `${Math.round(s.dx)},${Math.round(s.dy)}`)).size > 1, true, 'not all on one spot');
});

test('the small cards\' buttons are tinted, not plain white', () => {
  assert.match(css, /\.magic-mini button\.secondary \{[^}]*background: var\(--teal-soft\)/);
  assert.match(welcome, /id="welcome-import"/);
});

test('the shared part is loaded by the window and started by the wizard', () => {
  assert.match(html, /<link rel="stylesheet" href="magic\.css">/);
  assert.match(read('pages/wizard.js'), /initMagic\(/);
});

test('the CV step\'s side buttons sit above the card-wide button so they can be pressed', () => {
  assert.match(css, /\.cv-way\s*\{[^}]*z-index:\s*4/, 'above .magic-go::after (z-index 3)');
});
