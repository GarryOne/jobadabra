// Every list of live steps draws its dot through the shared parts (components.js liveDot/liveRows, components.css .live-dot): live pulses, done is still.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = path => readFileSync(new URL(`../renderer/${path}`, import.meta.url), 'utf8');
// The running-step lists: the Find card's lines (liveRows) and the Ready card's steps (a pill with dot + is-live).
const LISTS = [
  {name: 'Find card lines', file: 'pages/jobs-find.js', uses: /liveRows\(model\.lines\)/},
  {name: 'Ready card steps', file: 'pages/ready-progress.js', uses: /dot: each\.state === 'now'[\s\S]*is-live/},
];

test('every live list draws its running step with the shared dot', () => {
  for (const {name, file, uses} of LISTS) assert.match(read(file), uses, name);
});

test('the pulse lives once, in components.css, and stops for reduced motion', () => {
  const css = read('components.css');
  assert.match(css, /\.live-dot\.is-live, \.is-live\.dot::before \{ animation: live-pulse/);
  assert.match(css, /prefers-reduced-motion: reduce\) \{ \.live-dot\.is-live, \.is-live\.dot::before \{ animation: none/);
  for (const file of ['ready-card.css', 'style.css', 'pages/jobs-find.js']) assert.doesNotMatch(read(file), /ready-pulse/, file);
});

test('the Find card and the run card show one number, jobs added to the list; no scoring words (owner, 24 Oct 2026)', () => {
  for (const file of ['pages/jobs-find.js', 'pages/activity-run-card.js']) {
    const text = read(file);
    assert.doesNotMatch(text, /'On your list'|new on your list|'on your list'|joins your list/, file);
    assert.doesNotMatch(text, /Strong matches|[Ww]aiting for a score|'Scored'/, file);
    assert.match(text, /added/, file);
  }
});
