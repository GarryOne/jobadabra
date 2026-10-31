// The owner's corrections become lessons for the judges; the loop's own events never do.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {lessonsBlock, reversalsFrom} from '../lib/reversals.mjs';

const issue = (number, labels, extra = {}) => ({number, title: `[auto-ui] jobs: thing ${number}`, labels: labels.map(name => ({name})), ...extra});
const event = (kind, who, iss, extra = {}) => ({event: kind, actor: {login: who}, issue: iss, created_at: '2026-10-05T10:00:00Z', ...extra});

test('a reopened noise issue, a removed confirmed and a confirmed closed as not planned are corrections; the bot\'s are not', () => {
  const events = [
    event('reopened', 'GarryOne', issue(1, ['auto-ui', 'wontfix-auto'])),
    event('unlabeled', 'GarryOne', issue(2, ['auto-ui']), {label: {name: 'confirmed'}}),
    event('closed', 'GarryOne', issue(3, ['auto-ui', 'confirmed'], {state_reason: 'not_planned'})),
    event('unlabeled', 'github-actions[bot]', issue(4, ['auto-ui']), {label: {name: 'confirmed'}}),
    event('reopened', 'GarryOne', issue(5, ['auto-ui'])),
    event('unlabeled', 'GarryOne', issue(6, ['auto-ui']), {label: {name: 'not-seen-latest'}}),
    event('reopened', 'GarryOne', issue(7, ['wontfix-auto'])),
    event('unlabeled', 'GarryOne', issue(8, ['auto-ui'], {comments: 3}), {label: {name: 'confirmed'}}),   // GitHub's event: comments is a count
  ];
  const words = {1: {comments: [{author: {login: 'GarryOne'}, authorAssociation: 'OWNER', body: 'This is real: the menu cannot be reached at 640 px.'}]}};
  const list = reversalsFrom(events, words);
  assert.deepEqual(list.map(item => item.number), [1, 2, 3, 8]);
  assert.match(list[0].now, /reopened it: it was real/);
  assert.equal(list[0].words, 'This is real: the menu cannot be reached at 640 px.');
  const block = lessonsBlock(list);
  assert.match(block, /PAST VERDICTS A PERSON CORRECTED/);
  assert.match(block, /#1 "jobs: thing 1": the loop judged noise .* Their words: "This is real/);
  assert.equal(lessonsBlock([]), '');
});

// 31 Oct 2026, a8: every UI-verdict judge job read ALL 170 pages of the repo's issue events (gh --paginate), then kept the first 600 matches: 170 calls a job, 12 jobs a run,
// 2,040 calls in 5 minutes of a 5,000-an-hour budget shared by every workflow. The same 600 events must now come from the pages they are on.
import {fetchCorrectionEvents, PAGE_CAP} from '../lib/reversal-events.mjs';

// A recorded-shape history: newest first, 100 events a page, one in three of the kind a correction is made of (measured: 27-42% a page on 31 Oct 2026).
const history = pages => Array.from({length: pages * 100}, (_, i) => ({id: i, event: i % 3 === 0 ? ['reopened', 'unlabeled', 'closed'][(i / 3) % 3] : ['labeled', 'commented', 'assigned'][i % 3], created_at: `2026-10-${31 - Math.floor(i / 1000)}T00:00:00Z`}));
const KINDS = new Set(['reopened', 'unlabeled', 'closed']);

// The fake gh answers like `gh api .../issues/events?per_page=100&page=N --jq <filter>`: one JSON line per page, {raw, hits}.
const fakeGh = (events, calls) => args => {
  calls.push(args);
  const page = Number(/[?&]page=(\d+)/.exec(args[1])?.[1] || 1);
  const slice = events.slice((page - 1) * 100, page * 100);
  return `${JSON.stringify({raw: slice.length, hits: slice.filter(item => KINDS.has(item.event))})}\n`;
};

test('the 600 events are the same ones the full read kept, from far fewer pages', () => {
  const events = history(170), calls = [];
  const today = events.filter(item => KINDS.has(item.event)).slice(0, 600);   // what `--paginate` then `.slice(0, 600)` produced
  const got = fetchCorrectionEvents(fakeGh(events, calls), 'o/r');
  assert.deepEqual(got.map(item => item.id), today.map(item => item.id));
  assert.equal(got.length, 600);
  assert.equal(calls.length, 18, 'one call a page until 600 matches (1 in 3 here: 18 pages), not 170');
  assert.ok(calls.every(args => !args.includes('--paginate')), 'no unbounded --paginate');
});

test('a short history ends at its last page and returns every match', () => {
  const events = history(2).slice(0, 140), calls = [];
  const got = fetchCorrectionEvents(fakeGh(events, calls), 'o/r');
  assert.equal(calls.length, 2, 'page 2 holds 40 events: the end of the history');
  assert.deepEqual(got.map(item => item.id), events.filter(item => KINDS.has(item.event)).map(item => item.id));
});

test('a history with almost no corrections stops at the page cap and says so', () => {
  const events = Array.from({length: 100 * 100}, (_, i) => ({id: i, event: i % 50 === 0 ? 'closed' : 'labeled'})), calls = [], said = [];
  const got = fetchCorrectionEvents(fakeGh(events, calls), 'o/r', {log: line => said.push(line)});
  assert.equal(calls.length, PAGE_CAP);
  assert.equal(got.length, PAGE_CAP * 2, '2 matches a page');
  assert.match(said.join('\n'), new RegExp(`stopped at page ${PAGE_CAP}`));
});
