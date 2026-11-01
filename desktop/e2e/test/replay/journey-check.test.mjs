// A journey is judged by what the card and the panel said, step by step, against the live run (lib/journey-check.mjs): the stall on "Logging in…", a Ready on a posting, a missing Report button.
import test from 'node:test';
import assert from 'node:assert/strict';
import {checkJourney, liveMarksOf, marksOfSteps} from '../../lib/journey-check.mjs';
import {stepOf} from '../../lib/journey-watch.mjs';
import {PAGE_LINES} from '../../../renderer/session-state.js';

const item = {id: 's1', kind: 'form', status: 'running', startedAt: new Date().toISOString()};
const PANEL = {present: true, open: false, report: true, ring: '', pill: '', headline: '', count: ''};
const at = (state, panel = PANEL, session = item) => ({at: 1, ...stepOf(session, state ? {id: 's1', total: 0, left: 0, ready: false, ...state} : undefined, panel)});
const log = (...lines) => lines.map((line, n) => `2026-10-16T12:52:${String(10 + n).padStart(2, '0')}.000Z ${line}`).join('\n');
// the live run's own page lines (builds from 16 Oct 2026)
const LIVE = log('[review] page s1: reading', '[review] page s1: posting', '[review] page s1: opening', '[review] page s1: account', '[review] page s1: signing-in', '[review] page s1: form');

test('the card says each step in the owner\'s words, for every step the extension can send', () => {
  for (const page of Object.keys(PAGE_LINES)) assert.equal(at({page}).card.words, PAGE_LINES[page][0], page);   // desktop/test/page-steps.test.js keeps these equal to review.LINE_PAGES
});

test('the live run\'s marks come from its page lines (repeats folded); a log from before them has none, so the row\'s blessed marks stand in', () => {
  assert.deepEqual(liveMarksOf(LIVE), ['reading', 'posting', 'opening', 'account', 'signing-in', 'form']);
  assert.deepEqual(liveMarksOf(log('[review] page s1: reading', '[review] page s1: reading', '[review] page s1: form')), ['reading', 'form']);
  assert.deepEqual(liveMarksOf(log('[extension] fill: progress: navigated {}')), []);
  const steps = [at({page: 'reading'}), at({total: 2, left: 0})];
  assert.deepEqual(checkJourney({steps, liveLog: '', blessed: ['reading', 'form']}).failures, []);
  assert.ok(checkJourney({steps, liveLog: ''}).failures[0].includes('no expected marks'), 'nothing to compare with is red, never a pass');
});

test('a journey that moves like live passes; the same moves in the same order are all it asks', () => {
  const steps = ['reading', 'posting', 'opening', 'account', 'signing-in'].map(page => at({page})).concat([at({total: 5, left: 2})]);
  assert.deepEqual(marksOfSteps(steps), ['reading', 'posting', 'opening', 'account', 'signing-in', 'form']);
  assert.deepEqual(checkJourney({steps, liveLog: LIVE}).failures, []);
});

test('a journey stalled on "Logging in…" fails: the form never came (Richemont, before #1013)', () => {
  const steps = ['reading', 'posting', 'opening', 'account', 'signing-in'].map(page => at({page}));
  const {failures} = checkJourney({steps, liveLog: LIVE});
  assert.ok(failures.some(line => /never showed the form's counts/.test(line)), failures.join('\n'));
  assert.ok(failures.some(line => /ends on "Logging in…"/.test(line)), failures.join('\n'));
});

test('the card never says Ready on a posting or with fields left, never Submitted, and a panel always has its Report button', () => {
  const ready = {...item, status: 'done', kind: 'form'};
  const posting = at({page: 'posting', ready: true}, PANEL, ready), counted = at({total: 4, left: 1, ready: true}, PANEL, ready);
  assert.equal(posting.card.words, 'Apply button detected. Redirecting…', 'a step line leads over ready (this is what the person sees)');
  const wrongReady = {at: 2, card: {...counted.card, words: 'Ready to submit'}, panel: PANEL}, submitted = {at: 3, card: {...counted.card, words: 'Submitted', left: 0}, panel: PANEL};
  const noReport = {at: 4, ...at({total: 3, left: 1}, {...PANEL, report: false})};
  const {failures} = checkJourney({steps: [wrongReady, submitted, noReport], liveLog: log('[review] page s1: form')});
  for (const want of [/says "Ready to submit" with 1 left of 4/, /says Submitted/, /without its Report button/]) assert.ok(failures.some(line => want.test(line)), `${want}\n${failures.join('\n')}`);
});

test('a card showing a step live never showed is a failure (an error page called "Apply button detected")', () => {
  const steps = [at({page: 'reading'}), at({page: 'posting'}), at({page: 'other'})];
  const {failures} = checkJourney({steps, liveLog: log('[review] page s1: reading', '[review] page s1: other')});
  assert.ok(failures.some(line => /showed "Apply button detected. Redirecting…", live never did/.test(line)), failures.join('\n'));
});

test('no step read at all is a failure, not a pass', () => {
  assert.ok(checkJourney({steps: [], liveLog: LIVE}).failures[0].includes('never read'));
});
