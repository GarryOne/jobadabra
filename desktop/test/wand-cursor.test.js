// The wand cursor only where the AI does the work: every AI action carries the marker, the cursor rule has a hotspot and a pointer fallback, the wizard cards use it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'renderer');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('index.html');

// The registry: each AI action, found by the text that identifies its button in index.html or its builder in a script.
const STATIC = ['id="refresh"', 'data-refresh-jobs>', 'data-command="run"', 'id="tailor-top"', 'data-command="mail"', 'id="visits-run"', 'id="tune-open"',
  'data-command="weekly"', 'id="draft-build"', 'id="draft-redraft"', 'id="draft-again"', 'id="letter-draft"'];
const BUILT = [['pages/activity-visits.js', "const claude = el('button'"], ['pages/strategy-rescore.js', "const go = el('button'"], ['pages/base-letter.js', "ai.id = 'letter-start-ai'"],
  ['job-drawer/tab-documents.js', 'function tailorButton'], ['pages/ready-card.js', "'Fill tonight on the server'"], ['pages/jobs-render.js', "label: 'Prepare only'"], ['pages/jobs-render.js', "label: job.tailored ? 'Re-tailor"]];

test('every AI action in index.html carries data-wand', () => {
  for (const key of STATIC) {
    const tags = [...html.matchAll(/<button\b[^>]*>/g)].map(match => match[0]).filter(tag => tag.includes(key.replace(/>$/, '')));
    assert.ok(tags.length, `a button with ${key}`);
    for (const tag of tags) assert.match(tag, /\bdata-wand\b/, `${key} has no data-wand`);
  }
});

test('every AI action built in a script is marked (wand() or wand: true) within its block', () => {
  for (const [file, needle] of BUILT) {
    const text = read(file), at = text.indexOf(needle);
    assert.ok(at >= 0, `${file}: ${needle}`);
    assert.match(text.slice(Math.max(0, at - 60), at + 900), /wand\(|wand: true/, `${file}: ${needle} is not marked`);
  }
});

test('a button that says it uses the AI is marked: no unmarked "with AI" / "with Claude" button in index.html', () => {
  for (const [tag, label] of html.matchAll(/(<button\b[^>]*>)(?:<[^>]*>)*[^<]*(?:with AI|with Claude)/g)) assert.match(tag, /data-wand/, label);
});

test('the cursor: a wand with its tip as hotspot, a pointer fallback, only on marked or magic buttons, never app-wide', () => {
  const css = read('magic.css');
  const rule = css.match(/([^{}]+)\{\s*cursor:\s*url\(assets\/wand\.svg\)\s+(\d+)\s+(\d+),\s*pointer;\s*\}/);
  assert.ok(rule, 'cursor rule with a pointer fallback');
  assert.match(rule[1], /\[data-wand\]/);
  assert.match(rule[1], /\.magic-go/);
  assert.doesNotMatch(rule[1], /(^|,)\s*(body|html|button|\*)\s*(,|:|$)/, 'not app-wide');
  const svg = read('assets/wand.svg'), box = svg.match(/viewBox="(-?\d+) (-?\d+) (\d+)/), size = Number(svg.match(/width="(\d+)"/)[1]);
  assert.ok(size <= 32, 'a small cursor (owner, 25 Oct 2026: 43 px was too big)');
  const tip = n => -Number(n) * size / Number(box[3]);   // in cursor pixels (half a pixel off is fine)
  assert.ok(Math.abs(tip(box[1]) - Number(rule[2])) <= 1, 'hotspot x = the star centre');
  assert.ok(Math.abs(tip(box[2]) - Number(rule[3])) <= 1, 'hotspot y = the star centre');
});

test('the wizard cards (Welcome, Your CV) and the Jobs empty card use the wand', () => {
  assert.equal((html.match(/class="primary magic-go"/g) || []).length >= 2, true);
  assert.match(read('pages/jobs-find.js'), /primary magic-go/);
});

test('the cursor light over every Actions task card: one listener for the .task-card class, the CSS paints it from --mx/--my, hover and fine pointers only', () => {
  assert.match(read('pages/actions.js'), /initGlow\(\)/);
  assert.match(read('magic.js'), /closest\?\.\('\.task-card'\)/);
  const css = read('magic.css');
  assert.match(css, /\.task-card::before\s*\{[^}]*var\(--mx/);
  assert.match(css, /\(hover: hover\) and \(pointer: fine\)\s*\{\s*\.task-card:hover::before/);
  assert.match(css, /prefers-reduced-motion: reduce\)\s*\{\s*\.task-card::before/);
  const cards = [...html.matchAll(/class="[^"]*\btask-card\b[^"]*"/g)];
  assert.ok(cards.length >= 6, 'the Actions cards are found');
});
