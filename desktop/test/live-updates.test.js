// Live updates keep each step's result until the run ends (owner, 26 Oct 2026: "why I don't see web search, but still I see 1000 employers being
// checked?"): progress ticks replace each other, results never; and a step chip shows ✓ only once its work is done (Job boards: once read).
// Guards renderer/find-card-model.js (liveLines, stepChips) and lib/pipeline-lines.js keepRunLine (the run's log the window gets).
import test from 'node:test';
import assert from 'node:assert/strict';
import {findCard, liveLines, stepChips, webSearchChip} from '../renderer/find-card-model.js';
import fs from 'node:fs';
import {readableLog} from '../renderer/human-log.js';
import {keepRunLine} from '../lib/pipeline-lines.js';

// Each step's result line the engine prints (src/sources/board_web.py, board_yield.py, found_boards.py, aggregators.py, src/sources/feeds.py),
// with the words Live updates shows for it.
const RESULTS = [
  ['First jobs: 9 found', /9 jobs found in the first sites/],
  ['Job boards: a web search found Aero Board (Pilot jobs), Wing Jobs (Crew)', /^Job boards: a web search found Aero Board/],
  ['Job boards: no web search: searched lately, its boards are kept', /^Job boards: no web search: searched lately/],
  ['Job boards: 2 read in the last 6 h skipped; reading 3 new ones', /^Job boards: 2 read in the last 6 h skipped/],
  ['Job boards first: reading the 2 the web search found, before the employer sites: Aero Board, Wing Jobs', /^Job boards first: reading the 2/],
  ['Job boards: done, 15 job(s) for your search', /^Job boards: done, 15 jobs for your search/],
  ['Employers: 1045 of 2807 in your places hire for your kind of role; the others are left out.', /^Employers: 1045 of 2807 in your places/],
  ['Employers: read 1023 of 1057 sites in the time, best first; the other 34 are read first next time.', /^Employers: read 1023 of 1057 sites/],
  ['Titles: Claude sorted 480 new title(s) in your places; 1 could fit your search', /checked 480 job titles: 1 could fit you/],
  ['Scored 2 of 2 job(s)', /Scored 2 of 2 jobs/],
  ['Warning: jobs.ch refused more searches for now (HTTP 429); 4 job(s) read before that are kept', /jobs\.ch refused more searches/],
];
// A long search's noise between them: ~900 "Run counts" lines and the employer ticker (the owner's run 578c360d2620: 881 + 47 of 1135 lines).
const ticks = from => Array.from({length: 120}, (_, i) => [`⏳ Reading employer job sites: ${from + i} of 1057 · taking longer than expected`,
  ...Array(8).fill(`Run counts: looked=${from + i} matches=0 scored=0 good=0`)]).flat();

test('each step result stays in Live updates through a long run; only the newest tick shows, last', () => {
  const engine = RESULTS.flatMap(([line], i) => [line, ...ticks(i * 100)]);
  const window = engine.reduce(keepRunLine, []).slice(-300);   // what the window gets: the run's log, its last 300 lines (lib/pipeline-queue.js)
  const card = findCard({running: {kind: 'search', log: window}});
  for (const [line, shown] of RESULTS) assert.ok(card.lines.some(text => shown.test(text)), `${line}\n  not in: ${card.lines.join(' | ')}`);
  assert.equal(card.lines.filter(text => /Reading employer job sites/.test(text)).length, 1, 'ticks replace each other');
  const newest = (RESULTS.length - 1) * 100 + 119;
  assert.match(card.lines.at(-1), new RegExp(`Reading employer job sites: ${newest} of 1057`), 'the live tick is the last line');
  assert.equal(card.employers.done, newest, 'the bar reads the newest tick');
});

test('a run\'s log keeps every line once, and only the newest tick and Run counts of each kind', () => {
  const log = ['⏳ Scoring jobs: 1 of 9', 'Run counts: looked=1 matches=0 scored=0', 'Job boards: a web search found Aero Board', '⏳ Scoring jobs: 2 of 9',
    'Run counts: looked=2 matches=1 scored=0', '⏳ Still running · no new output for 30 s', '⏳ Still running · no new output for 45 s'].reduce(keepRunLine, []);
  assert.deepEqual(log, ['Job boards: a web search found Aero Board', '⏳ Scoring jobs: 2 of 9', 'Run counts: looked=2 matches=1 scored=0',
    '⏳ Still running · no new output for 45 s']);
});

test('per-employer and per-item lines are not results; the employers left out read as one line', () => {
  const log = ['Employers: harvey left out: people doing finance_admin read it and never found a job there',
    'Employers: poolside left out: people doing finance_admin read it and never found a job there', 'New job: Pilot | Air Co | https://x.test/1',
    'Claude Code haiku: answered in 3 s; tokens 10', '⏳ Still running · no new output for 30 s'];
  assert.deepEqual(liveLines(log), ['🏢 2 employers left out: people doing finance_admin read it and never found a job there']);
});

test('Job boards shows ✓ only once the engine says the boards are read, also when they are read beside the employer sites', () => {
  const states = log => stepChips(log).filter(chip => !chip.label.startsWith('Web search')).map(chip => `${chip.label}:${chip.state}`).join(' ');   // its own test below
  const reading = ['Job boards: searching the web for trade and local boards (your plan)', '⏳ Reading employer job sites: 419 of 1057',
    'Job boards: a web search found Aero Board'];
  assert.equal(states(reading), 'Job boards:active Employer sites:active More employers:pending', 'boards found mid-run are still to read');
  assert.equal(states([...reading, 'Job boards found: Aero Board 12 job(s), 3 relevant']), 'Job boards:active Employer sites:active More employers:pending');
  assert.equal(states(['Job boards first: reading the 2 the web search found, before the employer sites: Aero Board, Wing Jobs']).split(' Employer')[0], 'Job boards:active');
  assert.equal(states([...reading, 'Job boards: done, 15 job(s) for your search']), 'Job boards:done Employer sites:active More employers:pending');
  assert.equal(states(['⏳ Reading employer job sites: 1 of 9']), 'Job boards:active Employer sites:active More employers:pending',
    'the boards are read beside the employer sites from the start');
  assert.equal(states(['⏳ Reading employer job sites: 9 of 9', 'Growing your sources: finding more employers…']),
    'Job boards:done Employer sites:done More employers:active', 'the next step after the boards closes them');
  const first = ['Finding your first jobs…', 'First jobs: 9 scored in 20 s', '⏳ Reading employer job sites: 40 of 900'];
  assert.equal(states(first), 'First jobs:done All employers:active Job boards:active More employers:pending');
  assert.equal(states([...first, 'Job boards: done, 0 job(s) for your search']), 'First jobs:done All employers:active Job boards:done More employers:pending');
});

// The owner on run fe63a974c5d9 (26 Oct 2026): "is the 41/608 employers checked progress/status correct? … from the logs, it does totally
// different"; "why I don't see here a chip with Web Search?"; the panel said Free AI where the log said Claude.
const chip = (log, label) => stepChips(log).find(c => c.label.startsWith(label));

test('the web search has its own chip, with its state in words', () => {
  assert.equal(chip([], 'Web search').state, 'pending');
  assert.equal(chip(['Job boards: searching the web for trade and local boards (your plan)'], 'Web search').state, 'active');
  const found = chip(['Job boards: a web search found Aero Board (Pilot jobs, Europe), Wing Jobs (via a recruiter)'], 'Web search');
  assert.deepEqual([found.state, found.label], ['done', 'Web search · 2 boards found']);
  assert.equal(chip(['Job boards: a web search found no trade or local board'], 'Web search').label, 'Web search · none found');
  const rested = chip(['Job boards: no web search: searched 2026-10-26T01:45+00:00, next after 2026-11-02T01:45+00:00; its boards are kept'], 'Web search');
  assert.equal(rested.state, 'skipped');
  assert.match(rested.label, /^Web search · rested until \d{1,2} Nov$/);
  assert.match(rested.note, /^Searched \d{1,2} Oct, \d\d:\d\d; searches again after \d{1,2} Nov$/);
  assert.match(liveLines(['Job boards: no web search: searched 2026-10-26T01:45+00:00, next after 2026-11-02T01:45+00:00; its boards are kept'])[0],
    /^🔎 Web search rested: last searched \d{1,2} Oct, \d\d:\d\d, next after \d{1,2} Nov; its boards are kept$/, 'dates in words in Live updates too');
  const off = chip(['Job boards: no web search: no AI here searches the web (a signed-in Claude Code or Codex, an API key, or Free AI)'], 'Web search');
  assert.deepEqual([off.state, off.label], ['skipped', 'Web search · off']);
  assert.match(off.note, /no AI here searches the web/);
  assert.equal(chip(['Job boards: the web search for trade and local boards did not answer (TimeoutError)'], 'Web search').state, 'failed');
  assert.deepEqual(stepChips([]).map(c => c.label.split(' ·')[0]), ['Web search', 'Job boards', 'Employer sites', 'More employers']);
  assert.deepEqual(stepChips(['Finding your first jobs…']).map(c => c.label.split(' ·')[0]), ['First jobs', 'Web search', 'All employers', 'Job boards', 'More employers']);
});

test('the AI\'s title and place checks add up in one line each, named as the engine named the AI', () => {
  const log = ['Titles: Free AI sorted 2 new title(s) in your places; 0 could fit your search', 'Titles: Free AI sorted 21 new title(s) in your places; 1 could fit your search',
    'Places: Free AI placed 4 location(s); 3 are in your places', 'Titles: Free AI sorted 3 new title(s) in your places; 0 could fit your search',
    'Places: Free AI placed 2 location(s); 0 are in your places'];
  const lines = liveLines(log);
  assert.deepEqual(lines.filter(line => /job titles/.test(line)), ['🏷️ Free AI checked 26 job titles: 1 could fit you']);
  assert.deepEqual(lines.filter(line => /locations?/.test(line)), ['📍 Free AI placed 6 locations: 3 in your places']);
});

test('the employer read says the jobs that match so far, and where it stopped when time ran out', () => {
  const log = ['⏳ Reading employer job sites: 43 of 608 · 1,221 jobs listed · taking longer than expected', 'Run counts: looked=1201 matches=13 scored=0 good=0'];
  assert.equal(liveLines(log).at(-1), '⏳ Reading employer job sites: 43 of 608 · 1,221 jobs listed · taking longer than expected · 13 match your search so far');
  const card = findCard({running: {kind: 'search', log: [...log, 'Employers: read 78 of 608 sites in the time, best first; the other 530 are read first next time.']}});
  assert.deepEqual(card.employers, {done: 78, total: 608, stopped: true}, 'the bar ends where the read ended, not at the last tick');
});

// A second web search ask in the same run (33's #2031, 26 Oct 2026) says "searched in this run": no news, so the chip keeps what the first one showed.
test('"no web search: searched in this run" changes neither the chip nor Live updates', () => {
  const first = ['Job boards: searching the web for trade and local boards (your plan)', 'Job boards: a web search found Aero Board (Pilot jobs)'];
  const again = [...first, 'Job boards: no web search: searched in this run'];
  assert.deepEqual(webSearchChip(again), webSearchChip(first));
  assert.equal(webSearchChip(['Job boards: searching the web for x', 'Job boards: no web search: searched in this run']).state, 'active');
  assert.deepEqual(liveLines(again), liveLines(first));
});

// The run's clock stops a stage (3f's #2034, src/time_budget.py): "⏱ Time is up (<m> min <ss> s) for <stage>: <n> <noun> wait for the next
// search", once per stage. Each stays in Live updates like any result.
test('each stage\'s "Time is up" line stays in Live updates through the ticks', () => {
  const log = ['⏱ Time is up (0 min 36 s) for employer sites: 422 sites wait for the next search', ...ticks(0),
    '⏱ Time is up (2 min 33 s) for free job APIs: 4 sources wait for the next search', ...ticks(200)];
  const lines = liveLines(log.reduce(keepRunLine, []));
  assert.ok(lines.includes('⏱ Time is up (0 min 36 s) for employer sites: 422 sites wait for the next search'), lines.join(' | '));
  assert.ok(lines.includes('⏱ Time is up (2 min 33 s) for free job APIs: 4 sources wait for the next search'), lines.join(' | '));
});

// Owner, 27 Oct 2026: "it should be just 3 lines visible. the rest, either with scroll. Either at the end of the run, in the technical log".
test('a per-board line is not in Live updates, and is in the technical log; the step\'s summary line stays', () => {
  const log = ['Job boards found: xing.com 17 job(s), 7 relevant', 'Job boards found: Acme Jobs read after its scripts ran', 'Job boards: done, 15 job(s) for your search'];
  assert.deepEqual(liveLines(log), ['Job boards: done, 15 jobs for your search']);
  const technical = readableLog(log).join('\n');
  assert.match(technical, /xing\.com 17 jobs, 7 relevant/);
  assert.match(technical, /Acme Jobs read after its scripts ran/);
});

test('the Live updates fold is three rows high, one line each, and scrolls', () => {
  const css = fs.readFileSync(new URL('../renderer/find-card.css', import.meta.url), 'utf8');
  assert.match(css, /\.find-live > \.run-card-rows \{[^}]*max-height: calc\(3 \* var\(--live-row\)\)[^}]*overflow-y: auto/);
  assert.match(css, /\.find-live > \.run-card-rows > \.run-card-row \{[^}]*height: var\(--live-row\)/);
  assert.match(css, /\.find-live > \.run-card-rows \{[^}]*grid-template-columns: minmax\(0, 1fr\)/, 'the grid column may shrink, or a long line stretches it');
  assert.match(css, /text-overflow: ellipsis; white-space: nowrap/);
  assert.doesNotMatch(css.match(/\.find-live > \.run-card-rows \{[^}]*\}/)[0], /\d+(px|rem)/, 'no pixel value');
});
