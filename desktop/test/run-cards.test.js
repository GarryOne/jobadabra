// Recent activity: Today's list and Find new employers as small cards (renderer/run-cards.js).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {byFit, newJobsShown, parseRunMessage, runItems, runNewCount} from '../renderer/run-cards.js';

test("Today's list: counts and one line per match", () => {
  const card = parseRunMessage(`✈️ Jobadabra · 🆕 0 new · top 10 of 37
37 open · 2 🇨🇭 · 18 applied · 59 filtered · 139 low fit
🎯 Best matches
1. Software Engineer, Cloud Infrastructure (https://jobs.ashbyhq.com/openai/29c2) · 🎯 78
   OpenAI · London, UK · Senior
2. Staff Software Engineer - Databases SRE | UK | Remote (https://job-boards.greenhouse.io/grafanalabs/jobs/61) · 🎯 76
   Grafana Labs · United Kingdom (Remote)`);
  assert.deepEqual([card.kind, card.fresh, card.open, card.local, card.applied], ['digest', 0, 37, 2, 18]);
  assert.deepEqual(card.items.map(item => [item.title, item.company, item.fit]),
    [['Software Engineer, Cloud Infrastructure', 'OpenAI', 78], ['Staff Software Engineer - Databases SRE', 'Grafana Labs', 76]]);
});

test('Find new employers: counts, one line per employer, the closing note', () => {
  const card = parseRunMessage(`🔎 Source scout · checked 15 · 🆕 7 new sources
1. Notion · Ashby · quality 64 · ⭐ Tier 1
   4 SRE-type roles · 3 in your places
   San Francisco
2. Delivery Hero · Smartrecruiters · quality 24 · ⭐ Tier 1
   1 matching roles · 1 in your places
4 without public feed · 4 low relevance · 26 feeds crawled · 616 candidates queued`);
  assert.deepEqual([card.kind, card.checked, card.fresh], ['scout', 15, 7]);
  assert.deepEqual(card.items.map(item => [item.company, item.ats, item.roles, item.yours, item.tier]),
    [['Notion', 'Ashby', 4, 3, 'Tier 1'], ['Delivery Hero', 'Smartrecruiters', 1, 1, 'Tier 1']]);
  assert.match(card.note, /^4 without public feed/);
});

test('any other message stays text', () => {
  assert.equal(parseRunMessage('Weekly report: 9 applications'), null);
});

test('a jobs check from GitHub: no brand name, jobs without a fit (an AI limit reached) still make a card', () => {
  // 29 Sep 2026: "✈️ · 🆕 173 new" (the brand variable unset on GitHub) and jobs left unscored showed as raw text.
  const card = parseRunMessage(`✈️ · 🆕 173 new · top 10 of 50
173 open · 85 🇨🇭 · 19 applied · 5 low fit
🆕 New since last run
1. DevOps Engineer (https://jobs.ch/1)
   Consult & Pepper · Winterthur · 🌍 Remote?
2. Site Reliability Engineer / Software Engineer · 🎯 71
   Intelliact · Zürich`);
  assert.deepEqual([card.kind, card.fresh, card.open, card.local, card.applied], ['digest', 173, 173, 85, 19]);
  assert.deepEqual(card.items.map(item => [item.title, item.company, item.fit, item.url]),
    [['DevOps Engineer', 'Consult & Pepper', null, 'https://jobs.ch/1'], ['Site Reliability Engineer / Software Engineer', 'Intelliact', 71, '']]);
});

test('a digest counts the jobs in your places with 📍 (older digests used 🇨🇭)', () => {
  const card = parseRunMessage('✈️ Jobadabra · 🆕 1 new · top 10 of 24\n24 open · 7 📍 · 2 applied\n🆕 New since last run\n1. Data Analyst (https://x.example/1)\n   Acme · Amsterdam');
  assert.equal(card.local, 7);
});

// 5 Oct 2026: a jobs check that ended while Recent activity was open showed its digest as raw Telegram text. A run recorded
// on this Mac has a log but no message; the window keeps the message it saw, and the card must be drawn from that.
test('a run without a message of its own is drawn from the result the window kept', async () => {
  const {cardText} = await import('../renderer/run-cards.js');
  const kept = ['✈️ Jobadabra · 🆕 4 new · top 4 of 4', '4 open · 4 📍', '🆕 New since last run',
    '1. Senior Site Reliability Engineer, no-credit (Site Reliability / Data Analyst) (https://boards.e2e.test/job/1791157083)',
    '   E2E Acme · Zurich, Switzerland or Amsterdam, Netherlands'].join('\n');
  const local = {id: 7, kind: 'search', log: ['…'], ok: true};
  const card = parseRunMessage(cardText(local, kept));
  assert.equal(card?.kind, 'digest');
  assert.deepEqual(card.items.map(item => [item.company, item.url]), [['E2E Acme', 'https://boards.e2e.test/job/1791157083']]);
  assert.equal(cardText({...local, message: 'its own'}, kept), 'its own');   // the page's message wins
  assert.equal(cardText({...local, live: true}, kept), null);                // a running job has no card yet
  assert.equal(cardText(null, kept), null);
});

// A carded run kind showing its message as plain text is a fallback the window marks for the e2e checks (uicheck.mjs card-fallback).
test('a multi-line message of a carded kind shown as text is a fallback; a short note or another kind is not', async () => {
  const {isFallback} = await import('../renderer/run-cards.js');
  const three = 'line one\nline two\nline three';
  assert.equal(isFallback('search', three), true);
  assert.equal(isFallback('weekly', three), true);
  assert.equal(isFallback('search', 'No new jobs since your last check.'), false);
  assert.equal(isFallback('add', three), false);       // Logged activity has no card: its text is the answer
  assert.equal(isFallback('search', ''), false);
});

test('emptyResult: only a finished, ok, Notion-backed run of a result kind that drew nothing', async () => {
  const {emptyResult} = await import('../renderer/run-cards.js');
  const run = {ok: true, pageId: 'p'};
  assert.equal(emptyResult('weekly', run, false), true);
  assert.equal(emptyResult('weekly', run, true), false);                  // a card or text was drawn
  assert.equal(emptyResult('weekly', {...run, live: true}, false), false); // still running
  assert.equal(emptyResult('search', run, false), false);                  // a Jobs check may find nothing
  assert.equal(emptyResult('add', run, false), false);                     // Logged activity has no card
});

test('the digest in the card layout: unindented company line, score on a Fit: line, headings and the hint are not jobs', () => {
  const text = ['✈️ Job digest', '5 new · Top 3 of 50 ranked jobs', 'In your preferred locations', 'New since your last run · 2 jobs',
    '1. Senior IT Cloud Engineer (https://example.test/1)', 'Swiss Casinos · Zürich, Switzerland · Senior', 'Fit: 58/100 · Senior cloud role in Zürich', 'Check: English',
    '2. Head of Platform Engineering (https://example.test/2)', 'Convotis · Switzerland',
    'Your pipeline', '173 open · 4 in your places · 2 applied', 'Tap a job number to mark it applied, save or dismiss it.'].join('\n');
  const card = parseRunMessage(text);
  assert.equal(card.kind, 'digest');
  assert.deepEqual(card.items.map(item => [item.title, item.company, item.fit, item.url]),
    [['Senior IT Cloud Engineer', 'Swiss Casinos', 58, 'https://example.test/1'], ['Head of Platform Engineering', 'Convotis', null, 'https://example.test/2']]);
  assert.deepEqual([card.fresh, card.open, card.local, card.applied], [5, 173, 4, 2]);
  // A run from before 7 Oct 2026 said "pinned" for the same count: still read
  assert.equal(parseRunMessage(text.replace('4 in your places', '4 pinned')).local, 4);
});

test('top matches: highest fit first, the unscored after them, in their own order', () => {
  const items = [{title: 'a', fit: 52}, {title: 'b', fit: null}, {title: 'c', fit: 64}, {title: 'd'}, {title: 'e', fit: 0}];
  assert.deepEqual(byFit(items).map(item => item.title), ['c', 'a', 'e', 'b', 'd']);
  assert.deepEqual(items.map(item => item.title), ['a', 'b', 'c', 'd', 'e'], 'the card\'s own list is left as it is');
});

test('"View new job(s)" counts what the card says, else the run\'s record', () => {
  const digest = `✈️ Jobadabra · 🆕 2 new · top 10 of 105
105 open · 91 🇨🇭 · 0 applied`;
  assert.equal(newJobsShown({new: 1}, digest), 1, 'the run\'s own count, not the digest\'s 2 (#1408)');
  assert.equal(newJobsShown({}, digest), 2, 'a run with no record: the digest\'s number');
  assert.equal(newJobsShown({new: 3}, 'Search done.'), 3, 'no card: the run\'s own count');
  assert.equal(newJobsShown({}, null), 0);
});

// Owner, 7 Oct 2026: "View 7 of 10 in Jobs" under "6 new this run". The ten is the digest's page: the new jobs, then older ones to fill it.
test('a digest card lists the jobs this run found, not the older ones that fill the page', () => {
  const text = ['✈️ Job digest', '1 new · Top 3 of 50 ranked jobs', '📍 In your preferred locations', 'New since your last run · 1 job',
    '1. Vendeur (https://example.test/1)', 'Migros · Genève', '📍 In your preferred locations', 'Best matches · 1 job',
    '2. Conseiller (https://example.test/2)', 'Coop · Genève', '🌍 Outside your preferred locations', 'More to explore · 1 job',
    '3. Caissier (https://example.test/3)', 'Manor · Gland', 'Your pipeline', '70 open · 66 in your places'].join('\n');
  const card = parseRunMessage(text);
  assert.deepEqual(card.items.map(item => item.section), ['new', 'best', 'older']);
  assert.deepEqual(runItems(card).map(item => item.title), ['Vendeur']);
  // an older message with no headings: every job it lists
  assert.equal(runItems({items: [{title: 'a', section: ''}, {title: 'b', section: ''}]}).length, 2);
  assert.deepEqual(runItems(parseRunMessage(text.replace('New since your last run · 1 job', 'Best matches · 1 job'))), []);
});

// #1408 (22 Oct 2026): the card said "9 new this run" (the digest's count since its last send), the toast and footer "7" (the run's own). Every place
// that draws a run's new count reads run.new through runNewCount; the sources below must not read the digest's `.fresh` for it.
test('every place showing a run\'s new count reads the run\'s own number', async () => {
  const run = {new: 7}, digest = parseRunMessage('✈️ Jobadabra · 🆕 9 new · top 10 of 105\n105 open · 91 🇨🇭 · 0 applied');
  assert.equal(digest.fresh, 9);
  assert.equal(runNewCount(run, digest), 7);
  assert.equal(newJobsShown(run, '✈️ Jobadabra · 🆕 9 new · top 10 of 105\n105 open'), 7);
  const {readFileSync} = await import('node:fs');
  const card = readFileSync(new URL('../renderer/pages/activity-run-card.js', import.meta.url), 'utf8');
  assert.doesNotMatch(card, /stat\(card\.fresh, 'new this run'\)/);
  assert.doesNotMatch(card, /card\.fresh (===|<)/, 'nothing-new and few-new decide on the run\'s count');
  assert.match(card, /stat\(fresh, `job\$\{fresh === 1 \? '' : 's'\} added to your list`\)/);
  assert.match(card, /'Top new since your last digest'/, 'the list is the digest\'s new section: named for what it lists, not "this run"');
  const {notice} = await import('../lib/run-history.js'), {freshOf} = await import('../lib/few-jobs.js');
  assert.match(notice({kind: 'search', ok: true, new: 7, message: '✈️ Jobadabra · 🆕 9 new · top 10 of 105'}).body, /^7 jobs added to your list/, 'the notification');
  assert.equal(freshOf({new: 7, message: '✈️ Jobadabra · 🆕 9 new · top 10 of 105'}), 7, 'the few-new-jobs nudge');
});

// Owner, 24 Oct 2026: "too many numbers". Every run card kind leads with ONE number line (the jobs/employers it added); the other counts sit in the closed Details.
test('every run card draws one headline stat and folds the rest into Details; no scoring words', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../renderer/pages/activity-run-card.js', import.meta.url), 'utf8');
  assert.equal((src.match(/stats\.append\(stat\(/g) || []).length, 2, 'one headline stat per card kind (digest, scout): a new count goes in detailsOf');
  assert.equal((src.match(/detailsOf\(/g) || []).length, 2, 'used by both kinds');
  assert.doesNotMatch(src, /strong matches|waiting for a score|stat\([^)]*scor/i, 'no scoring count (a job row\'s own fit pill is not a run count)');
});
