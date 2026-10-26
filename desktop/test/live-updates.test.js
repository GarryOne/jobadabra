// Live updates keep each step's result until the run ends (owner, 26 Oct 2026: "why I don't see web search, but still I see 1000 employers being
// checked?"): progress ticks replace each other, results never; and a step chip shows ✓ only once its work is done (Job boards: once read).
// Guards renderer/find-card-model.js (liveLines, stepChips) and lib/pipeline-lines.js keepRunLine (the run's log the window gets).
import test from 'node:test';
import assert from 'node:assert/strict';
import {findCard, liveLines, stepChips} from '../renderer/find-card-model.js';
import {keepRunLine} from '../lib/pipeline-lines.js';

// Each step's result line the engine prints (src/sources/board_web.py, board_yield.py, found_boards.py, aggregators.py, src/sources/feeds.py),
// with the words Live updates shows for it.
const RESULTS = [
  ['First jobs: 9 found', /9 jobs found in the first sites/],
  ['Job boards: a web search found Aero Board (Pilot jobs), Wing Jobs (Crew)', /^Job boards: a web search found Aero Board/],
  ['Job boards: no web search: searched lately, its boards are kept', /^Job boards: no web search: searched lately/],
  ['Job boards: 2 read in the last 6 h skipped; reading 3 new ones', /^Job boards: 2 read in the last 6 h skipped/],
  ['Job boards found: Aero Board 12 job(s), 3 relevant', /^Job boards found: Aero Board 12 jobs, 3 relevant/],
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
  const states = log => stepChips(log).map(chip => `${chip.label}:${chip.state}`).join(' ');
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
