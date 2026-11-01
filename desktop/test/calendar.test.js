// Calendar: meetings from jobs' Next interview and saved recordings, the month grid, the agenda split.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as c from '../renderer/calendar.js';

const ZONE = 'Europe/Zurich';
const job = (id, next, extra = {}) => ({url: `https://x/${id}`, notion_url: `https://www.notion.so/Co-${id.padEnd(32, '0')}`, company: `Co ${id}`, title: 'SRE', stage: 'Interview scheduled', status: 'applied', next_interview: next, ...extra});

test('a job with a Next interview is one meeting; a dismissed or undated job is none', () => {
  const list = c.meetings([job('a', '2026-10-05T09:00:00+02:00'), job('b', ''), job('c', '2026-10-06T09:00:00+02:00', {status: 'dismissed'})], [], {zone: ZONE});
  assert.equal(list.length, 1);
  assert.equal(list[0].day, '2026-10-05');
  assert.equal(list[0].held, false);
});

test('a screening is told from an interview by the stage or the recorded round', () => {
  assert.equal(c.kindOf('Screening'), 'screening');
  assert.equal(c.kindOf('Interview scheduled'), 'interview');
  assert.equal(c.kindOf('Interviewing', 'Recruiter screen'), 'screening');
  assert.equal(c.kindOf('Screening', 'Technical 1'), 'interview');
});

test('a recording on its job\'s interview day is the same meeting, shown once as held', () => {
  const a = job('a', '2026-10-05T09:00:00+02:00');
  const list = c.meetings([a], [{id: 'r1', date: '2026-10-05', round: 'Technical 1', application: [`a`.padEnd(32, '0')]}], {zone: ZONE});
  assert.equal(list.length, 1);
  assert.equal(list[0].held, true);
  assert.equal(list[0].round, 'Technical 1');
});

test('a recording of another day, or of an unknown job, is its own past meeting', () => {
  const list = c.meetings([job('a', '2026-10-05T09:00:00+02:00')], [{id: 'r2', date: '2026-09-20', title: 'Acme call', application: []}], {zone: ZONE});
  assert.deepEqual(list.map(m => [m.day, m.held]), [['2026-09-20', true], ['2026-10-05', false]]);
  assert.equal(list[0].title, 'Acme call');
});

test('the month grid starts on Monday, has whole weeks and puts a meeting on its day', () => {
  const list = c.meetings([job('a', '2026-10-05T09:00:00+02:00')], [], {zone: ZONE});
  const weeks = c.monthGrid(2026, 9, list, '2026-10-01');
  assert.equal(weeks[0][0].day, '2026-09-28');                       // 1 Oct 2026 is a Thursday
  assert.ok(weeks.every(week => week.length === 7));
  const cell = weeks.flat().find(x => x.day === '2026-10-05');
  assert.equal(cell.meetings.length, 1);
  assert.equal(weeks.flat().find(x => x.day === '2026-10-01').today, true);
  assert.equal(weeks.flat().find(x => x.day === '2026-09-28').inMonth, false);
});

test('the agenda: coming meetings soonest first, past ones latest first, today\'s past recordings with the past', () => {
  const now = Date.parse('2026-10-05T12:00:00+02:00');
  const list = c.meetings([job('a', '2026-10-07T09:00:00+02:00'), job('b', '2026-10-05T15:00:00+02:00')],
    [{id: 'r1', date: '2026-10-01T10:00:00+02:00', application: []}, {id: 'r2', date: '2026-10-05T09:00:00+02:00', application: []}], {zone: ZONE});
  const {upcoming, past} = c.agenda(list, now, ZONE);
  assert.deepEqual(upcoming.map(m => m.day), ['2026-10-05', '2026-10-07']);
  assert.deepEqual(past.map(m => m.recording), ['r2', 'r1']);
});

test('"Today" moves the grid to this month at once, without re-reading Notion (#67: about 1 s with no sign of work)', async () => {
  const fs = await import('node:fs');
  const page = fs.readFileSync(new URL('../renderer/pages/calendar.js', import.meta.url), 'utf8');
  const handler = page.slice(page.indexOf("$('cal-today').onclick"), page.indexOf('\n', page.indexOf("$('cal-today').onclick")));
  assert.match(handler, /render\(\)/);
  assert.doesNotMatch(handler, /loadCalendar|pilot\./);
});

test('"Today" is disabled while the grid shows this month (#83: pressed there it did nothing)', async () => {
  const fs = await import('node:fs');
  const page = fs.readFileSync(new URL('../renderer/pages/calendar.js', import.meta.url), 'utf8');
  const body = page.slice(page.indexOf('export function render()'), page.indexOf('export async function loadCalendar'));
  assert.match(body, /\$\('cal-today'\)\.disabled = month\.year === now\.getFullYear\(\) && month\.month === now\.getMonth\(\);\n  \$\('cal-title'\)/);
});

test('a meeting opens its job: the Notion page when there is one, else the job\'s page in the app (never a dead click)', async () => {
  const fs = await import('node:fs');
  const page = fs.readFileSync(new URL('../renderer/pages/calendar.js', import.meta.url), 'utf8');
  const open = page.slice(page.indexOf('function open(m)'), page.indexOf('\n}\n', page.indexOf('function open(m)')));
  assert.match(open, /if \(\/\^https:\\\/\\\/\/\.test\(url \|\| ''\)\) \{ window\.pilot\.openExternal\(url\); return; \}/);
  assert.match(open, /openView\('jobs'\);\n  openJobPanel\(m\.job\);/);
});

test('a meeting\'s job id: the store\'s page_id on every store, else the Notion page\'s from its URL (an older answer)', () => {
  assert.equal(c.page({page_id: 'app-7', notion_url: ''}), 'app7');
  assert.equal(c.page({page_id: '', notion_url: 'https://www.notion.so/SRE-0123abcd'}), '0123abcd');
  assert.equal(c.page({}), '');
});

// A planted code bug (desktop/e2e/mutants.json calendar-day-dropped; #120 and #122 were this bug): the grid marked one day as outside its month. Every month, every day of it is in.
test('the month grid holds every day of its month once, and no day of another month as its own', () => {
  for (const [year, month] of [[2026, 0], [2026, 1], [2028, 1], [2026, 9], [2026, 11]]) {
    const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const inMonth = c.monthGrid(year, month, [], '').flat().filter(cell => cell.inMonth).map(cell => cell.num);
    assert.deepEqual(inMonth, Array.from({length: days}, (_, i) => i + 1), `${year}-${month + 1}`);
  }
});
