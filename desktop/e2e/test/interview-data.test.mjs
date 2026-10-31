// The helpers the Interviews and Calendar suites assert with must pass on the right input and FAIL on a deliberately broken one.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {HONOLULU, TOKYO, TRANSCRIPT, addDays, calendarDates, clockOf, dayIn, interviewProps, meetingSlots, monthTitle, monthsBetween, newestFirst, pageToMonth, showsClock, trackerProps, transcriptBlocks, weekDays} from '../lib/interview-data.mjs';
import {monthGrid} from '../../renderer/calendar.js';

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

// ---- the Calendar suite's dates over the calendar's edges ----
// Why (a8, 31 Oct 2026): the suite went red on its date twice in 7 days (fdc31ca 25 Oct, #2718 31 Oct), each found only by a beta on the one evening that
// hits it. Both are deterministic once `now` is fixed: this sweep plays every day of 2026-2027 and 2028's leap February at the hours where Tokyo (UTC+9)
// and Honolulu (UTC-10) change day or disagree on the month, through the same functions the suite calls and the app's own month grid (renderer/calendar.js).
const HOURS = ['00:30', '09:30', '10:30', '14:30', '15:30', '23:30'];   // UTC; Tokyo's midnight is 15:00, Honolulu's 10:00
function* instants() {
  for (const [from, to] of [['2026-01-01', '2027-12-31'], ['2028-01-30', '2028-03-02']]) {
    for (let d = from; d <= to; d = addDays(d, 1)) for (const hour of HOURS) yield {label: `${d}T${hour}Z`, now: new Date(`${d}T${hour}:00Z`)};
  }
}
const monthOf = day => ({year: Number(day.slice(0, 4)), month: Number(day.slice(5, 7)) - 1});
const shiftMonth = ({year, month}, n) => ({year: year + Math.floor((month + n) / 12), month: ((month + n) % 12 + 12) % 12});
const firstOf = ({year, month}) => `${year}-${String(month + 1).padStart(2, '0')}-01`;
const gridOf = (month, today = '') => monthGrid(month.year, month.month, [], today).flat();
/** The cells the suite's selector `.cal-cell.today:not(.out)` finds, and the old selector `.cal-cell.today` of fdc31ca^ finds. */
const todayInMonth = cells => cells.filter(cell => cell.today && cell.inMonth);
const todayAnywhere = cells => cells.filter(cell => cell.today);
const ownCells = (cells, day) => cells.filter(cell => cell.inMonth && cell.day === day);   // what the suite's cell(page, day) selects: one cell, or the day is missing

// The calendar as the suite drives it: a title and two arrows, one month per press.
function fakeCalendar(start) {
  let at = start;
  return {title: async () => monthTitle(firstOf(at)), click: async arrow => { at = shiftMonth(at, arrow === 'next' ? 1 : -1); }, month: () => at};
}

// One instant, as the checks below read it: `c` = {now, dates, slots, here, next, last, hereCells, nextCells}; `fail(invariant, detail)` records a broken invariant.
function contextOf(now) {
  const dates = calendarDates(now), here = monthOf(dates.today);
  return {now, dates, slots: meetingSlots(dates), here, next: shiftMonth(here, 1), last: shiftMonth(here, -1), hereCells: gridOf(here, dates.today), nextCells: gridOf(shiftMonth(here, 1), dates.today)};
}

// 1. today is Tokyo's day, its title is what an app in Tokyo shows, and the grid highlights exactly that one day of the month.
function checkToday({now, dates, hereCells}, fail) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {timeZone: TOKYO, year: 'numeric', month: 'numeric', day: 'numeric'}).formatToParts(now).map(p => [p.type, p.value]));
  if (dates.today !== `${parts.year}-${parts.month.padStart(2, '0')}-${parts.day.padStart(2, '0')}`) fail('today is not Tokyo\'s day', dates.today);
  const appTitle = new Intl.DateTimeFormat('en-US', {timeZone: TOKYO, month: 'long', year: 'numeric'}).format(now);
  if (dates.thisTitle !== appTitle) fail('the grid title is not the title of Tokyo\'s month', `${dates.thisTitle} vs ${appTitle}`);
  const marked = todayInMonth(hereCells);
  if (marked.length !== 1 || marked[0].num !== Number(dates.today.slice(8))) fail('the grid does not highlight today alone', JSON.stringify(marked));
}

// 2. the three "this week" days lie in Tokyo's month, in order, each on exactly one cell of its grid; `future` means all three are ahead of today.
function checkWeekDays({dates: {today, days, future}, hereCells}, fail) {
  const [l1, l2, l3] = days;
  if (!days.every(d => d.slice(0, 7) === today.slice(0, 7))) fail('a "this week" day leaves the month', days.join(' '));
  if (!(l1 < l2 && l2 < l3)) fail('the "this week" days are not ascending', days.join(' '));
  if (future !== (days[0] > today)) fail('`future` disagrees with the days', `${days.join(' ')} today ${today}`);
  for (const d of days) if (ownCells(hereCells, d).length !== 1) fail('a "this week" day has no single cell in the grid', d);
}

// 3. every meeting's instant lands on its day, at its clock, in Tokyo; Acme is the eve's 13:30 in Honolulu and not on l1 there.
function checkMeetingInstants({dates: {days, honoluluDay}, slots}, fail) {
  for (const [key, slot] of Object.entries(slots)) {
    const clock = clockOf(slot.at, TOKYO);
    if (dayIn(new Date(slot.at), TOKYO) !== slot.day || clock.h !== slot.clock.h || clock.m !== slot.clock.m) fail(`${key} is not on ${slot.day} at ${slot.clock.h}:${slot.clock.m} in Tokyo`, slot.at);
  }
  const acmeHere = clockOf(slots.acme.at, HONOLULU);
  if (dayIn(new Date(slots.acme.at), HONOLULU) !== honoluluDay || acmeHere.h !== 13 || acmeHere.m !== 30) fail('Acme is not on the eve at 13:30 in Honolulu', slots.acme.at);
  if (honoluluDay === days[0]) fail('Acme falls on the same day in both zones');
}

// 4. the agenda's split: with `future` every meeting of this month is ahead of now, without it the three days are gone; next month's is always ahead.
function checkAgendaSplit({now, dates: {future}, slots}, fail) {
  const ahead = key => Date.parse(slots[key].at) > now.getTime();
  for (const key of ['acme', 'beta', 'gamma', 'delta', 'zeta']) if (ahead(key) !== future) fail(`${key} is ${future ? 'not ahead' : 'ahead'} of now although future=${future}`, slots[key].at);
  if (!ahead('epsilon')) fail('next month\'s meeting is not ahead of now', slots.epsilon.at);
}

// 5. next month: the 15th, the title the "›" arrow reaches, one cell for the day; today is never highlighted on the month's own cells (the suite's `:not(.out)`). -> 1 when today is drawn on a neighbouring day.
function checkNextMonth({dates, next, nextCells}, fail) {
  if (dates.nextMonthDay !== `${firstOf(next).slice(0, 8)}15`) fail('nextMonthDay is not the 15th of next month', dates.nextMonthDay);
  if (dates.nextTitle !== monthTitle(firstOf(next))) fail('the "›" title is not next month\'s', dates.nextTitle);
  if (ownCells(nextCells, dates.nextMonthDay).length !== 1) fail('the 15th of next month has no single cell', dates.nextMonthDay);
  if (todayInMonth(nextCells).length) fail('today is highlighted on a day of next month');
  return todayAnywhere(nextCells).length && !todayInMonth(nextCells).length ? 1 : 0;
}

// 6. last month (two "‹" from next month): the title is last month's; none of this month's days is in it; the old call is behind the current month and not drawn in this month's grid.
function checkLastMonth({dates: {today, days, nextTitle, oldDay}, here, last, hereCells}, fail) {
  if (monthsBetween(nextTitle, monthTitle(firstOf(last))) !== -2) fail('two "‹" from next month do not reach last month');
  const lastCells = gridOf(last, today);
  for (const d of [...days, today]) if (ownCells(lastCells, d).length) fail('a day of this month is a day of last month\'s grid', d);
  if (!(oldDay < firstOf(here))) fail('the old call is not before this month', oldDay);
  if (hereCells.some(cell => cell.day === oldDay)) fail('the old call is drawn in this month\'s grid', oldDay);
}

// 7. Honolulu: the app starts on its own month; the arrows reach the Acme eve's month within three presses, and it has one cell for that day. -> 1 when Honolulu starts in another month.
async function checkHonolulu({now, dates: {honoluluDay, honoluluTitle}}, fail) {
  const start = monthOf(dayIn(now, HONOLULU));
  const reached = await pageToMonth(fakeCalendar(start), honoluluTitle);
  if (reached !== honoluluTitle) fail('the arrows do not reach the Acme eve\'s month', `from ${monthTitle(firstOf(start))} to ${honoluluTitle}, stopped on ${reached}`);
  if (ownCells(gridOf(monthOf(honoluluDay)), honoluluDay).length !== 1) fail('the Acme eve has no single cell', honoluluDay);
  return monthTitle(firstOf(start)) !== honoluluTitle ? 1 : 0;
}

test('the Calendar suite\'s dates hold on every day of 2026-2027 and 2028\'s February, at the hours the zones disagree', async () => {
  const failures = [];
  let swept = 0, todayDrawnOutNext = 0, zonesInOtherMonths = 0;
  for (const {label, now} of instants()) {
    swept++;
    const fail = (invariant, detail = '') => failures.push(`${label} ${invariant}${detail ? `: ${detail}` : ''}`);
    const c = contextOf(now);
    for (const check of [checkToday, checkWeekDays, checkMeetingInstants, checkAgendaSplit, checkLastMonth]) check(c, fail);
    todayDrawnOutNext += checkNextMonth(c, fail);
    zonesInOtherMonths += await checkHonolulu(c, fail);
  }
  assert.deepEqual(failures.slice(0, 8), [], `${failures.length} failure(s) over ${swept} instants`);
  assert.ok(swept > 4000, `swept ${swept} instants`);
  // The sweep must reach the edges it exists for, or it proves nothing about them.
  assert.ok(todayDrawnOutNext > 0, 'no instant draws today on a neighbouring day of next month\'s grid (fdc31ca)');
  assert.ok(zonesInOtherMonths > 0, 'no instant starts Honolulu in another month than the Acme eve (#2718)');
});

// The two failures that reached a beta. Fixed instants, so each stays a named case if the sweep above is ever reshaped.
test('#2718: at 16:50 UTC on 31 Oct 2026 Tokyo is in November, Honolulu in October, and comparing titles as text pages the wrong way', async () => {
  const now = new Date('2026-10-31T16:50:00Z'), dates = calendarDates(now);
  assert.equal(dates.thisTitle, 'November 2026');
  assert.equal(dates.honoluluTitle, 'November 2026');   // Acme's Honolulu day is 1 Nov, while Honolulu's own today is 31 Oct: it must page forward
  const textPager = async (calendar, want) => { for (let i = 0; i < 3 && (await calendar.title()) !== want; i++) await calendar.click((await calendar.title()) < want ? 'next' : 'prev'); return calendar.title(); };
  assert.equal(await pageToMonth(fakeCalendar(monthOf(dayIn(now, HONOLULU))), 'November 2026'), 'November 2026');
  assert.notEqual(await textPager(fakeCalendar(monthOf(dayIn(now, HONOLULU))), 'November 2026'), 'November 2026');   // "October 2026" < "November 2026" is false: it pages back
});

test('fdc31ca: at 17:10 UTC on 25 Oct 2026 it is the 26th in Tokyo, a day of November\'s first week, so the old "today anywhere" check fails and the month\'s own cells pass', () => {
  const dates = calendarDates(new Date('2026-10-25T17:10:00Z'));
  assert.equal(dates.today, '2026-10-26');
  const november = gridOf({year: 2026, month: 10}, dates.today);
  assert.equal(todayAnywhere(november).length, 1, 'the neighbouring day is drawn');
  assert.equal(todayInMonth(november).length, 0, 'but not as a day of November');
});
