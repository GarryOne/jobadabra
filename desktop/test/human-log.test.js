// The Technical log in plain words (owner, 7 Oct 2026): what happened, one line each; Claude's timings only when slow or waiting.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readableLog} from '../renderer/human-log.js';

const REFRESH = [
  'Time budget: this search stops its AI steps at 3 min 00 s; what is left waits for the next one',
  'Cronjob run logged: https://app.notion.com/p/x',
  'AI: Claude Code, on your Claude plan (no API budget to watch)',
  'Pool labels: roles sales_retail',
  '⏳ Reading employer job sites: 0 of 102',
  '⏳ Reading employer job sites: 102 of 102 · 6,565 jobs listed',
  '⏱ This refresh places 240 of 608 job locations (2 round(s) of 2 calls, about 7.9 s each); 368 wait for the next refresh, best places first',
  'Places: asking Claude where 240 job location(s) are, in 4 batch(es) of up to 60',
  'Claude Code haiku: answered in 7 s (model 5 s, Claude Code itself 1 s; turns 2; reported 6 s)',
  'Places: Claude placed 240 location(s); 10 are in your places',
  'Added 3 new job(s): Lyss 1, Spreitenbach 1, Fribourg 1',
  'Closed 0 job(s) not seen for 7 days',
  'Closed 18 job(s) outside your places: Switzerland 18',
  'Warning: jobs.ch refused more searches for now (HTTP 403); 20 job(s) read before that are kept',
  'Scored 1 of 29 job(s)',
  'Claude Code sonnet: answered in 5 s (model 3 s, Claude Code itself 2 s, waited 34 s for a free slot; turns 2; reported 3 s)',
  'Scored 2 of 29 job(s)',
  'Claude Code sonnet: answered in 21 s (model 19 s, Claude Code itself 1 s; turns 2; reported 19 s)',
  'Job Matches: 16 created, 1 updated (so far)',
  'Scored 29 of 29 job(s) with claude-sonnet-5-5; 0 failed; tokens in 58 (+86797 cached), out 10315',
  '<<<message', '✈️ Job digest', '1. A job', 'message>>>',
  'Digest ready: 10 jobs, 1 new. Telegram isn\'t connected, so nothing was sent.',
  'Descriptions: read 8 of 12 missing job texts, 2 refused by career.hm.com, 2 on sign-in sites (ch.indeed.com) → readable in your browser (Actions, Find jobs using your browser)',
  'Something new the engine says',
];

test('a refresh reads as what happened', () => {
  assert.deepEqual(readableLog(REFRESH), [
    '⏱ Claude gets up to 3 min 00 s this refresh; what is left waits for the next one',
    '⏳ Reading employer job sites: 102 of 102 · 6,565 jobs listed',
    '📍 Asking Claude where 240 of 608 job locations are (368 next time)',
    '📍 Claude placed 240 locations: 10 in your places',
    '➕ Added 3 new jobs: Lyss 1, Spreitenbach 1, Fribourg 1',
    '🗑️ Closed 18 jobs outside your places: Switzerland 18',
    '⚠️ jobs.ch refused more searches for now (HTTP 403); 20 jobs read before that are kept',
    '🎯 Scored 29 of 29 jobs',
    '⏳ Waited 34 s for Claude Code: it answers two things at a time',
    '🐢 Claude Code was slow: 21 s for one answer',
    '📨 Digest ready: 10 jobs, 1 new',
    '📄 Read 8 of 12 missing job texts, 2 refused by career.hm.com, 2 on sign-in sites (ch.indeed.com) → readable in your browser (Actions, Find jobs using your browser)',
    'Something new the engine says',
  ]);
});

test('no Claude timing, pool, Notion link or digest text reaches the readable log', () => {
  const text = readableLog(REFRESH).join('\n');
  for (const raw of ['model 3 s', 'Pool labels', 'app.notion.com', '✈️ Job digest', '(so far)', 'tokens in']) assert.ok(!text.includes(raw), raw);
});

// 10 Oct 2026: the engine says what happened to a job (expired, unmatched, removed); a run from before still says Closed and still reads.
test('job states in the readable log: expired, unmatched and removed, and the old Closed lines', () => {
  assert.deepEqual(readableLog(['Expired 0 job(s) not seen for 7 days', 'Expired 4 job(s) not seen for 7 days', 'Expired 2 job(s) from employers your search no longer reads',
    'Unmatched 18 job(s) outside your places: Switzerland 18', "Removed 120 old unmatched or expired job(s) from this computer's cache", 'Closed 3 job(s) outside your places: Basel 3']), [
    '🗓️ 4 jobs expired: no longer listed for 7 days', '🗓️ 2 jobs expired: from employers you no longer search', '↪️ 18 jobs set aside outside your places: Switzerland 18',
    "🧹 Removed 120 old jobs from this computer's cache", '🗑️ Closed 3 jobs outside your places: Basel 3']);
});
