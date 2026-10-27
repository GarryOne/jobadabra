// Application questions (owner's mockup, 17 Oct 2026: "THIS IS TOO CROWDED/OVERWHELMING... Move the questionnaire out of the Jobs page"): Jobs shows
// one compact card whose count is the review queue (never the set-aside ones), and the questions are answered one at a time in a drawer
// (pages/question-review.js) that shares the job drawer's overlay slot. Every way in (Jobs' card, Profile → Application answers, ⌘K) opens it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {install} from './tiny-dom.js';

const body = install();
const LIST = [
  {key: 'start', question: 'What is your earliest start date, and are there any constraints we should be aware of?', company: 'DeepJudge AG', proposal: '1 December 2026', coveredBy: 'Notice period / earliest start', format: {kind: 'text', control: 'text', options: []}},
  {key: 'salary', question: 'What is your salary expectation? (In USD monthly)', company: 'Colonist', format: {kind: 'text', control: 'text', options: []}},
  {key: 'permit', question: 'Do you have a valid permission to work in Switzerland?', company: 'DeepJudge AG', format: {kind: 'yes_no', control: 'yes_no', options: ['Yes', 'No']}},
];
const HIDDEN = [{key: 'title', question: 'Title', company: 'Adnovum', format: {kind: 'single', control: 'single', options: ['Mr', 'Ms']}}];
const calls = [];
const ids = ['questions', 'questions-count', 'questions-details', 'questions-error', 'questions-retry', 'questions-review', 'questions-manage', 'review-drawer-layer', 'review-drawer-backdrop', 'review-panel'];
for (const id of ids) { const node = globalThis.document.createElement('div'); node.id = id; body.append(node); }
globalThis.window.pilot = new Proxy({
  openQuestions: async () => ({list: LIST.map(q => ({...q})), hidden: HIDDEN, consent: 2}),
  answerQuestion: async (key, value) => { calls.push([key, value]); return {ok: true, homeName: key === 'start' ? 'Your details → 💶 Availability & compensation' : ''}; },
}, {get: (all, key) => all[key] || (() => null)});
const {loadQuestions} = await import('../renderer/pages/jobs-questions.js');
const review = await import('../renderer/pages/question-review.js');
const slot = await import('../renderer/overlay-slot.js');
const $ = id => globalThis.document.getElementById(id);
const panel = () => $('review-panel');
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

test('Jobs: one compact card, its count is the review queue (3), not the queue plus the set-aside one; no inputs, no Notion, no "every application"', async () => {
  await loadQuestions({force: true});
  assert.equal($('questions').hidden, false);
  assert.equal($('questions-count').textContent, '3 need review');
  assert.equal($('questions').querySelectorAll('input').length + $('questions').querySelectorAll('select').length, 0);
  const html = fs.readFileSync(new URL('../renderer/index.html', import.meta.url), 'utf8');
  const card = html.slice(html.indexOf('id="questions"'), html.indexOf('</section>', html.indexOf('id="questions"')));
  assert.match(card, /Application questions/);
  assert.match(card, /Review missing answers and suggested matches\./);
  assert.match(card, /Review questions/);
  assert.doesNotMatch(card, /Manage saved answers/, 'one action on the card; Saved answers lives in the drawer header');
  assert.doesNotMatch(card, /Notion|every application|Answer once/);
});

test('the drawer: Question 1 of 3, a suggested answer told apart from a missing one', async () => {
  await review.openQuestionReview();
  assert.equal($('review-drawer-layer').hidden, false);
  assert.match(panel().textContent, /Question 1 of 3/);
  assert.ok(panel().querySelector('#review-saved-answers'), 'Saved answers is in the header while a question is open too');
  assert.ok(panel().querySelector('.qr-answer.is-suggested'), 'a proposal is a suggestion');
  assert.match(panel().textContent, /Suggested from saved answer/);
  assert.match(panel().querySelector('.qr-source').textContent, /Notice period \/ earliest start/);
  assert.match(panel().textContent, /DeepJudge AG · Application form/);
  for (const id of ['qr-back', 'qr-skip', 'qr-confirm']) assert.ok(panel().querySelector(`.qr-foot #${id}`), id);
  panel().querySelector('#qr-skip').click();
  assert.match(panel().textContent, /Question 2 of 3/);
  assert.ok(panel().querySelector('.qr-answer.is-missing'), 'no answer yet: missing');
  assert.equal(panel().querySelector('#qr-confirm').disabled, true, 'Confirm waits for an answer (UI loop #64)');
  panel().querySelector('#qr-back').click();
  assert.match(panel().textContent, /Question 1 of 3/);
});

test('a draft is kept when the drawer closes; Confirm & next saves, says where, and the queue shrinks; Don’t keep saves an empty answer', async () => {
  calls.length = 0;
  await review.openQuestionReview();
  panel().querySelector('#qr-skip').click();   // the salary question
  const field = panel().querySelector('#qr-control');
  field.value = '9000';
  field.dispatch('input');
  assert.equal(panel().querySelector('#qr-confirm').disabled, false);
  review.closeQuestionReview();
  assert.equal($('review-drawer-layer').hidden, true);
  await review.openQuestionReview({start: 'salary'});
  assert.equal(panel().querySelector('#qr-control').value, '9000', 'the draft came back');
  panel().querySelector('#qr-confirm').click();
  await flush();
  assert.deepEqual(calls, [['salary', '9000']]);
  assert.match(panel().textContent, /Question 2 of 2/);
  assert.match(panel().textContent, /✓ Saved to your application answers/);
  panel().querySelector('#qr-back').click();
  panel().querySelector('#qr-confirm').click();   // accept the suggested start date
  await flush();
  assert.deepEqual(calls[1], ['start', '1 December 2026']);
  assert.match(panel().textContent, /Saved to Your details → 💶 Availability & compensation/);
  panel().querySelector('#qr-drop').click();
  await flush();
  assert.deepEqual(calls[2], ['permit', '']);
  assert.match(panel().textContent, /All questions reviewed/);
});

test('it shares the job drawer\'s overlay slot: opening it closes a job or Recent activity, never stacks', async () => {
  let closed = 0;
  slot.registerOverlay('job', {close: () => { closed++; }, open() {}});
  slot.claimOverlay('job');
  await review.openQuestionReview();
  assert.equal(closed, 1);
  review.closeQuestionReview();
});

test('every way in opens the same drawer: Jobs\' card, Profile → Application answers, ⌘K', () => {
  const read = file => fs.readFileSync(new URL(`../renderer/pages/${file}`, import.meta.url), 'utf8');
  assert.match(read('question-review.js'), /\$\('questions-review'\)\?\.addEventListener\('click', \(\) => openQuestionReview\(\)\)/);
  assert.match(read('application-answers.js'), /answers-review-go[\s\S]{0,400}openQuestionReview\(\)/);
  assert.match(read('nav.js'), /'Review application questions'[\s\S]{0,300}openQuestionReview\(\)/);
});

// The navigator (owner, 18 Oct 2026: "I don't like this dropdown... make it nice. Modern." → option A of
// https://claude.ai/artifact/7hsZipME4De62YarGwUTTP): one segment per question, a button naming the question that opens the queue list
// (kind tile, where it comes from, its state, the set-aside ones apart), and previous / next arrows. No native select.
const menu = () => globalThis.document.body.querySelector('.ui-menu');
const rows = () => menu().querySelectorAll('.ui-menu-row');

test('navigator: no native select; one segment per question, the current one marked; a segment jumps there', async () => {
  await review.openQuestionReview();
  assert.equal(panel().querySelector('.qr-head select'), null, 'no dropdown in the header');
  const segs = panel().querySelectorAll('.qr-seg');
  assert.equal(segs.length, 3);
  assert.equal(segs[0].getAttribute('aria-current'), 'step');
  assert.match(segs[1].title, /2 · What is your salary expectation/);
  segs[2].click();
  assert.match(panel().textContent, /Question 3 of 3/);
  assert.equal(panel().querySelectorAll('.qr-seg')[2].getAttribute('aria-current'), 'step');
  panel().querySelector('#qr-next').click();
  assert.match(panel().textContent, /Question 1 of 3/, 'next wraps like Skip');
  panel().querySelector('#qr-prev').click();
  assert.match(panel().textContent, /Question 3 of 3/);
});

test('navigator: the button names the question; its list shows kind, source and state, the set-aside one apart, and jumps', async () => {
  await review.openQuestionReview();
  const nav = panel().querySelector('#qr-nav');
  assert.match(nav.textContent, /What is your earliest start date/);
  assert.match(nav.textContent, /1 \/ 3/);
  nav.click();
  assert.equal(menu().hidden, false);
  assert.equal(rows().length, 4, '3 in the queue + 1 set aside');
  assert.equal(rows()[0].getAttribute('aria-current'), 'true');
  assert.deepEqual(rows().map(row => row.querySelector('.ui-pill').textContent), ['Suggested', 'Missing', 'Missing', 'Set aside']);
  assert.match(rows()[0].querySelector('.ui-menu-detail').textContent, /DeepJudge AG · Application form/);
  assert.ok(rows()[2].querySelector('.ui-menu-tile'), 'a kind tile');
  assert.match(menu().querySelector('.ui-menu-heading').textContent, /Set aside · 1 · not counted/);
  assert.equal(menu().querySelector('.ui-menu-search'), null, '3 questions: no search');
  rows()[3].click();
  assert.match(panel().textContent, /A set-aside question/);
  assert.match(panel().querySelector('#qr-nav').textContent, /Title/);
  panel().querySelector('#qr-nav').click();
  rows()[1].click();
  assert.match(panel().textContent, /Question 2 of 3/);
});

test('navigator: a question you typed into and left shows as Draft, in the list and its segment', async () => {
  await review.openQuestionReview();
  panel().querySelector('#qr-skip').click();
  const field = panel().querySelector('#qr-control');
  field.value = '8000';
  field.dispatch('input');
  panel().querySelector('#qr-skip').click();
  assert.ok(panel().querySelectorAll('.qr-seg')[1].classList.contains('is-draft'));
  panel().querySelector('#qr-nav').click();
  assert.equal(rows()[1].querySelector('.ui-pill').textContent, 'Draft');
  menu().querySelector('button').click();
});

test('navigator: a Your details item says what it asks; from 9 questions the list has a search box; past 30 one bar, no segments', async () => {
  const many = n => Array.from({length: n}, (_, i) => ({key: `q${i}`, question: `Question number ${i + 1}`, company: 'Acme', format: {kind: 'date', control: 'date', options: []},
    ...(i === 0 ? {details: {kind: 'which', where: 'Your details → Work permit', source: 'Two copies disagree'}} : {})}));
  for (const [n, search, segs] of [[9, true, 9], [31, true, 0]]) {
    globalThis.window.pilot.openQuestions = async () => ({list: many(n), hidden: [], consent: 0});
    await review.openQuestionReview({force: true});
    assert.equal(panel().querySelectorAll('.qr-seg').length, segs, `${n} questions`);
    assert.equal(Boolean(panel().querySelector('.qr-bar')), segs === 0, `${n}: the plain bar only past 30`);
    panel().querySelector('#qr-nav').click();
    assert.equal(Boolean(menu().querySelector('.ui-menu-search')), search);
    assert.equal(rows()[0].querySelector('.ui-pill').textContent, 'Pick the right one');
    assert.match(rows()[0].querySelector('.ui-menu-detail').textContent, /Your details → Work permit/);
    menu().querySelector('.ui-menu-row').click();
  }
  globalThis.window.pilot.openQuestions = async () => ({list: LIST.map(q => ({...q})), hidden: HIDDEN, consent: 2});
  review.closeQuestionReview();
});

// The class (owner's rule: a specific instruction is about its whole class): no renderer screen moves between items with a native <select>.
// Filters (Show, Outcome, Day) and answer pickers stay selects; a select named "Jump to…" / "Go to…" is a navigator and fails here.
test('no native select is used as a navigator anywhere in the renderer', () => {
  const dir = new URL('../renderer/', import.meta.url);
  const files = fs.readdirSync(dir, {recursive: true}).filter(name => /\.(js|html)$/.test(name));
  for (const file of files) {
    const text = fs.readFileSync(new URL(file, dir), 'utf8');
    for (const [hit] of text.matchAll(/(?:el\('select'|createElement\('select'\)|<select)[^\n]{0,160}/g))
      assert.doesNotMatch(hit, /jump|go to|navigate/i, `${file}: a select used to move between items; use the navigator (renderer/question-nav.js)`);
  }
});

test('a HIGH PRIORITY letter item opens setup rather than offering a fake answer or reuse switch', async () => {
  LIST.unshift({key: 'setup:cover-letter', question: 'Set up your cover letter', priority: 'HIGH PRIORITY', hint: 'Your letter needs approval.', setup: {kind: 'cover-letter', action: 'Review cover letter'}});
  try {
    await loadQuestions({force: true});
    assert.match($('questions-count').textContent, /1 HIGH PRIORITY/);
    await review.openQuestionReview({start: 'setup:cover-letter'});
    assert.match(panel().textContent, /HIGH PRIORITY/);
    assert.ok(panel().querySelector('#qr-setup-letter'));
    assert.equal(panel().querySelector('#qr-control'), null);
    assert.equal(panel().querySelector('#qr-confirm'), null);
    assert.equal(panel().querySelector('#qr-reuse'), null);
  } finally { LIST.shift(); review.closeQuestionReview(); }
});
