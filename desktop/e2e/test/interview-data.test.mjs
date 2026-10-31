// The helpers the Interviews and Calendar suites assert with must pass on the right input and FAIL on a deliberately broken one.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {TRANSCRIPT, addDays, clockOf, interviewProps, monthsBetween, newestFirst, showsClock, trackerProps, transcriptBlocks, weekDays} from '../lib/interview-data.mjs';

test('week days stay inside the month: the next days, or the last days when the month is nearly over', () => {
  assert.deepEqual(weekDays('2026-10-02'), {days: ['2026-10-03', '2026-10-04', '2026-10-05'], future: true});
  assert.deepEqual(weekDays('2026-10-29'), {days: ['2026-10-26', '2026-10-27', '2026-10-28'], future: false});   // +3 would be November
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('newest first: detects an out-of-order library', () => {
  assert.ok(newestFirst(['2026-10-05', '2026-10-03', '2026-10-03', '2026-09-30']));
  assert.ok(!newestFirst(['2026-10-03', '2026-10-05']));   // the broken list
});

test('the clock in a zone: a 23:30 UTC call is 08:30 the next morning in Tokyo and 13:30 the same day in Honolulu', () => {
  assert.deepEqual(clockOf('2026-10-05T23:30:00Z', 'Asia/Tokyo'), {h: 8, m: 30});
  assert.deepEqual(clockOf('2026-10-05T23:30:00Z', 'Pacific/Honolulu'), {h: 13, m: 30});
});

test('showsClock reads 24 h and 12 h forms, and rejects another time', () => {
  assert.ok(showsClock('✓ 13:30 Gamma', {h: 13, m: 30}));
  assert.ok(showsClock('01:30 PM Gamma', {h: 13, m: 30}));
  assert.ok(showsClock('Mon · 08:30 AM', {h: 8, m: 30}));
  assert.ok(!showsClock('01:30 AM Gamma', {h: 13, m: 30}));   // AM is not PM
  assert.ok(!showsClock('08:30 Gamma', {h: 13, m: 30}));      // the UTC-shifted time is not the local one
  assert.ok(!showsClock('11:30 Gamma', {h: 1, m: 30}));       // 11:30 is not 1:30
});

test('rows are built with the columns the app reads', () => {
  const job = trackerProps({role: 'SRE', company: 'Acme', url: 'https://x.test/1', nextInterview: '2026-10-05T09:00:00Z'});
  assert.equal(job['Next interview'].date.start, '2026-10-05T09:00:00Z');
  assert.ok(!('Next interview' in trackerProps({role: 'SRE', company: 'Acme', url: 'https://x.test/1'})));
  const row = interviewProps({name: 'Acme · Round 1', day: '2026-10-01', overall: 'positive', applicationId: 'abc'});
  assert.equal(row.Overall.select.name, 'positive');
  assert.ok(!('Overall' in interviewProps({name: 'n', day: '2026-10-01'})));   // not reviewed
  assert.equal(transcriptBlocks('hello')[0].heading_3.rich_text[0].text.content, 'Transcript');
  assert.ok(TRANSCRIPT.length > 40 && /^\[\d\d:\d\d:\d\d\] Recruiter:/m.test(TRANSCRIPT));
});

// Beta 41220959824 (31 Oct 2026, 16:50 UTC): Tokyo was in November, Honolulu in October, and the text comparison paged back to September.
test('months between two calendar titles count by date, never by text', () => {
  assert.equal('October 2026' < 'November 2026', false, 'the text comparison that paged the wrong way');
  assert.equal(monthsBetween('October 2026', 'November 2026'), 1);
  assert.equal(monthsBetween('December 2026', 'January 2027'), 1);
  assert.equal(monthsBetween('November 2026', 'October 2026'), -1);
  assert.equal(monthsBetween('May 2026', 'May 2026'), 0);
  assert.throws(() => monthsBetween('Okt 2026', 'November 2026'), /not a month title/);
});
