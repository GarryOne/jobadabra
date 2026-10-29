// The desktop follows the page in real time (owner, 16 Oct 2026): "Reading this page" → "Apply button detected. Redirecting…" → "Sign in form detected" → "Logging in…" → the
// form's own state. The extension's worker sends each step (extension/page-mark.js), so a page with no panel (a small sign-in page) moves the card too.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import * as review from '../lib/review.js';
import {pageLine, PAGE_LINES} from '../renderer/session-state.js';

test('each step the extension sends replaces the card\'s line at once, with no counts; the form brings back the panel\'s counts', () => {
  review._reset();
  const seen = [];
  review.setReporter(state => seen.push(state.page || 'form'));
  for (const page of ['reading', 'posting', 'opening', 'reading', 'account', 'signing-in', 'reading']) {
    assert.equal(review.notePage('s1', page), true, page);
    const state = review.allStates().find(entry => entry.id === 's1');
    assert.deepEqual([state.page, state.total, state.ready], [page, 0, false], page);
  }
  assert.equal(review.notePage('s1', 'form'), true);
  assert.equal(review.allStates().find(entry => entry.id === 's1').page, undefined, 'the line goes; the form\'s panel reports its counts');
  assert.deepEqual(seen, ['reading', 'posting', 'opening', 'reading', 'account', 'signing-in', 'reading', 'form']);
  assert.equal(review.notePage('s1', 'whatever'), false, 'only the known steps');
});

test('the owner\'s words for each step, on the card and the list row', () => {
  assert.equal(pageLine('reading'), 'Reading this page…');
  assert.equal(pageLine('posting'), 'Apply button detected. Redirecting…');
  assert.equal(pageLine('opening'), 'Apply button detected. Redirecting…');
  assert.equal(pageLine('account'), 'Sign in form detected');
  assert.equal(pageLine('signing-in'), 'Logging in…');
  for (const page of review.LINE_PAGES) assert.ok(PAGE_LINES[page], `${page} has words`);
});

test('the worker says every step to the app, and the sign-in press says "Logging in"', async () => {
  const read = name => fs.readFileSync(new URL(`../../extension/${name}`, import.meta.url), 'utf8');
  assert.match(read('page-mark.js'), /type: 'page', page, session/);
  assert.match(['fill-flow.js', 'fill-flow-read.js', 'fill-flow-steps.js'].map(read).join('\n'), /sayStep\(tab\.id, 'Reading this page…'\); markPage\(tab\.id, 'reading'\);/);
  assert.match(read('account-step.js'), /markPage\(tab\.id, 'signing', false, \{accountStep: step\}\);/);
  const {markOf} = await import('../../extension/tab-pages.js');
  assert.deepEqual([markOf('signing', false, 'sign_in'), markOf('signing', false, 'sign_up')], ['signing-in', 'signing-up']);
  assert.match(fs.readFileSync(new URL('../lib/ext-server-handlers.js', import.meta.url), 'utf8'), /server\.setPageHandler\(/);
  assert.match(fs.readFileSync(new URL('../lib/server.js', import.meta.url), 'utf8'), /if \(event\.type === 'page'\) \{ pageHandler\(event\); return; \}/);
});

// Owner, 16 Oct 2026 (Adnovum on SuccessFactors): Reopen went to the form's address without its query and the site answered with an error page, which the card called
// "Apply button detected. Redirecting…". Now: the full address is reopened; a page the AI judged no job page says so; Reopen's error page goes back to the posting.
test('a page the AI judged "other" is never "Apply button detected"; only a posting is', async () => {
  const {markOf} = await import('../../extension/tab-pages.js');
  assert.equal(markOf('no-form', false, '', 'posting'), 'posting');
  assert.equal(markOf('no-form', true, '', 'posting'), 'opening');
  assert.equal(markOf('no-form', false, '', 'other'), 'other');
  assert.equal(markOf('no-form', true, '', 'other'), 'other');
  assert.equal(markOf('no-form'), 'posting', 'no AI answer: the structure rule, as before');
  assert.equal(pageLine('other'), 'This page shows no application');
});

test('a broken page mid-application goes back to its posting once; never from the posting itself, never in a loop', async () => {
  const stored = {}, moves = [], said = [];
  globalThis.chrome = {storage: {session: {}}};
  const store = {get: async key => ({[key]: stored[key]}), set: async values => Object.assign(stored, values)};
  const {restartFromPosting} = await import('../../extension/restart-from-posting.js');
  const tab = {id: 7, url: 'https://career74.example.test/portalcareer#jobpilotto-fill=s9'};
  const posting = 'https://careers.example.test/job/1';
  const go = (at, on = tab) => restartFromPosting(on, posting, {decide: (_, line) => said.push(line), move: async (id, url) => moves.push([id, url]), store, now: at});
  assert.equal(await go(1000), true);
  assert.deepEqual(moves, [[7, 'https://careers.example.test/job/1#jobpilotto-fill=s9']], 'the posting, with the session\'s own mark');
  assert.equal(await go(2000), false, 'once: a posting that keeps failing ends in its plain report');
  assert.equal(await go(1000 + 11 * 60 * 1000), true, 'again after ten minutes');
  assert.equal(await go(5000, {id: 8, url: `${posting}#jobpilotto-fill=s9`}), false, 'already on the posting');
  assert.ok(said.every(line => line === 'a broken page mid-application: started again from the posting'));
});

test('both dead ends of a broken page go through it, and the app reopens a closed tab from the posting', () => {
  const read = name => fs.readFileSync(new URL(`../../${name}`, import.meta.url), 'utf8');
  const flow = ['extension/fill-flow.js', 'extension/fill-flow-read.js', 'extension/fill-flow-steps.js'].map(read).join('\n');
  assert.match(flow, /if \(other && await restartFromPosting\(tab, jobUrl, \{decide\}\)\) return;/);
  assert.match(flow, /report: async need => \(await restartFromPosting\(tab, jobUrl, \{decide\}\)\) \|\| deadEndHere\(tab, jobUrl, host, 'site_broken'/);
  assert.match(read('desktop/lib/session-handlers.js'), /const opened = apply\.openOne\(old\.url, \{session: old\.id, reuse: true\}\);/);
  assert.doesNotMatch(read('desktop/lib/session-handlers.js'), /formUrl/);
});
