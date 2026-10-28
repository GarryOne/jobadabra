// The shared "AI is writing this text" state (renderer/ai-writing.js; owner, 28 Oct 2026, option A): a strip with a live timer above the box, the kept
// text faded, skeleton lines for an empty box; stop() puts the box back. Also the class: every box the AI rewrites uses it (base letter, a job's letter).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {install} from './tiny-dom.js';

install();
const {aiWriting, elapsed} = await import('../renderer/ai-writing.js');
const read = file => fs.readFileSync(new URL(`../renderer/${file}`, import.meta.url), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));

// A clock the test moves: every() keeps each tick by its period (1000 the timer, 220 the stars), clear() counts what it stopped.
function clock() {
  const state = {at: 1000, ticks: {}, cleared: []};
  return {state, now: () => state.at, every: (fn, ms) => { state.ticks[ms] = fn; return ms; }, clear: id => { state.cleared.push(id); delete state.ticks[id]; }};
}

test('the timer reads m:ss', () => {
  assert.equal(elapsed(0), '0:00');
  assert.equal(elapsed(12), '0:12');
  assert.equal(elapsed(75), '1:15');
});

test('a box with text: a lit strip above it says what runs and counts; the box glows in a frame, its text kept and faded; stars twinkle; stop() puts it back', () => {
  const doc = globalThis.document;
  doc.body.replaceChildren();
  const box = Object.assign(doc.createElement('textarea'), {value: 'Fictional old letter'});
  doc.body.append(box);
  const {state, now, every, clear} = clock();
  const stop = aiWriting(box, {title: 'Writing a new draft', note: 'Your current letter stays until the new one is ready.', now, every, clear, rand: () => 0.5});
  const [strip, frame] = doc.body.children;
  assert.equal(strip.className, 'ai-writing-strip');
  assert.equal(strip.getAttribute('role'), 'status');
  assert.equal(strip.textContent, 'Writing a new draft · 0:00Your current letter stays until the new one is ready.');
  assert.equal(strip.querySelector('.ai-writing-time').getAttribute('aria-hidden'), 'true', 'the ticking clock is not read aloud every second');
  assert.equal(frame.className, 'ai-writing-frame', 'the glowing frame stands where the box stood, under the strip, never over its text');
  assert.equal(box.parentNode, frame);
  assert.equal(box.value, 'Fictional old letter');
  assert.match(box.className, /\bis-ai-writing\b/);
  assert.equal(box.getAttribute('aria-busy'), 'true');
  state.at += 12_400;
  state.ticks[1000]();
  assert.match(strip.textContent, /· 0:12/);
  for (let i = 0; i < 20; i += 1) state.ticks[220]();
  const stars = frame.children.filter(node => node.classList?.contains('ai-writing-spark'));
  assert.equal(stars.length, 12, 'stars twinkle over the box, never more than twelve at once');
  assert.match(stars[0].className, /\bmagic-spark\b/, 'the app\'s own star (magic.css)');
  assert.equal(stars[0].style['--x'], '50.0%');
  stop();
  stop();
  assert.deepEqual(state.cleared.sort(), [1000, 220].sort(), 'the timer and the stars stop, once');
  assert.deepEqual(doc.body.children, [box], 'the box is back where it stood');
  assert.equal(box.parentNode, doc.body);
  assert.equal(box.className, '');
  assert.equal(box.getAttribute('aria-busy'), null);
  assert.equal(box.value, 'Fictional old letter', 'the text is the caller\'s to replace');
});

test('an empty box: letter-shaped skeleton lines stand where the text will land; stop() shows the box again', () => {
  const doc = globalThis.document;
  doc.body.replaceChildren();
  const box = doc.createElement('textarea');
  doc.body.append(box);
  const {now, every, clear} = clock();
  const stop = aiWriting(box, {title: 'Writing your first draft', now, every, clear});
  const [strip, frame] = doc.body.children;
  assert.equal(strip.className, 'ai-writing-strip');
  const bones = frame.children[0];
  assert.equal(bones.className, 'ai-writing-bones');
  assert.ok(bones.children.filter(line => line.className === 'skeleton').length >= 6, 'a greeting, two paragraphs and a sign-off');
  assert.ok(bones.children.some(line => line.className === 'ai-writing-gap'), 'with gaps between paragraphs');
  assert.equal(box.hidden, true);
  stop();
  assert.deepEqual(doc.body.children, [box]);
  assert.equal(box.hidden, false);
});

test('reduced motion: no stars are made', () => {
  const doc = globalThis.document;
  doc.body.replaceChildren();
  const box = Object.assign(doc.createElement('textarea'), {value: 'Fictional old letter'});
  doc.body.append(box);
  const {state, now, every, clear} = clock();
  globalThis.matchMedia = query => ({matches: query === '(prefers-reduced-motion: reduce)'});
  try {
    const stop = aiWriting(box, {title: 'Writing a new draft', now, every, clear});
    assert.deepEqual(Object.keys(state.ticks), ['1000'], 'only the timer runs');
    stop();
  } finally { delete globalThis.matchMedia; }
});

test("a job's letter, Write again: the strip over the kept letter, the pill says Writing…, the buttons wait; a failure says why and gives them back", async () => {
  const doc = globalThis.document;
  doc.body.replaceChildren();
  let finish;
  globalThis.window.pilot = {jobLetter: async () => ({text: 'Fictional job letter.\n\nSecond paragraph.', pdf: true, source: 'ai', warnings: []}),
    jobLetterAgain: () => new Promise(resolve => { finish = resolve; })};
  const {jobLetterView} = await import('../renderer/job-drawer/job-letter.js');
  const card = jobLetterView({code: 'J-1', url: 'https://jobs.example.test/1'});
  doc.body.append(card);
  await settle();
  const button = label => card.querySelectorAll('button').find(node => node.textContent === label);
  button('Write again').click();
  await settle();
  const strip = card.querySelector('.ai-writing-strip');
  assert.match(strip.textContent, /^Writing a new letter for this job · 0:00The letter below stays until the new one is ready\.$/);
  assert.match(card.querySelector('.letter-shown').className, /\bis-ai-writing\b/);
  assert.match(card.querySelector('.letter-shown').textContent, /Fictional job letter/, 'the kept letter stays until the new one lands');
  assert.ok(card.querySelectorAll('.ui-pill').some(node => node.textContent === 'Writing…'));
  assert.ok(!card.querySelectorAll('.ui-pill').some(node => node.textContent === 'Ready'), 'Ready is not true while it is rewritten');
  const again = button('Writing…');
  assert.equal(again.getAttribute('aria-busy'), 'true');
  assert.ok(card.querySelectorAll('button').every(node => node.disabled), 'Copy, Edit and Open PDF wait for the new letter');
  finish({ok: false, error: 'Fictional generation failure'});
  await settle();
  assert.equal(card.querySelector('.ai-writing-strip'), null);
  assert.ok(card.querySelectorAll('.ui-pill').some(node => node.textContent === 'Ready'));
  assert.ok(button('Write again'));
  assert.ok(card.querySelectorAll('button').every(node => !node.disabled));
  assert.match(card.textContent, /Fictional generation failure/);
});

// The class (owner, 28 Oct 2026: one shared "AI is writing this" pattern): every box the AI rewrites shows it, and the look is linked where it is drawn.
test('the class: the base letter and a job letter use the shared part; no overlay or bare "Writing… (about N s)" button is left', () => {
  for (const file of ['pages/base-letter.js', 'job-drawer/job-letter.js']) assert.match(read(file), /import \{aiWriting\} from '\.\.\/ai-writing\.js';/, file);
  assert.doesNotMatch(read('job-drawer/job-letter.js'), /Writing… \(about/);
  assert.doesNotMatch(read('index.html'), /letter-busy|letter-card-busy/);
  assert.doesNotMatch(read('style.css'), /letter-card-busy|letter-busy-sparkles/);
  for (const page of ['index.html', 'gallery.html']) assert.match(read(page), /<link rel="stylesheet" href="ai-writing\.css">/, page);
  const css = read('ai-writing.css');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.ai-writing-strip, \.ai-writing-strip > \.icon, \.ai-writing-title, \.ai-writing-frame, \.ai-writing-frame::after, \.is-ai-writing \{ animation: none; \}/,
    'every motion stops with reduced motion');
  assert.match(read('magic.css'), /\.magic-spark \{/, 'the stars are the shared magic effect\'s');
  assert.match(read('components.css'), /button\[aria-busy="true"\] > \.icon \{ display: none; \}/, 'the spinner stands in for a busy button\'s icon');
});
