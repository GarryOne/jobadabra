/* global document */
// The Calendar, layer 2: what the window draws from the meetings this Mac's store hands it, moved from the e2e `calendar` suite (1 Nov 2026). The jobs and recordings are the
// engine's own answers for a seeded SQLite store (screen-calendar-kit.js calendarStore), the window runs in a fixed time zone with its clock pinned to NOW, no Notion, no AI.
// Windows: an empty store (Tokyo), the meetings (Tokyo), the same meetings (Honolulu), and the meetings as a Notion store hands them (each job with its Notion page).
// What STAYS in e2e: nothing of the Calendar's: the store writes are tested in store/calendar-interviews-store.test.mjs, and the app's own setup is the journey suite's.
import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {HONOLULU, TOKYO, showsClock} from '../../e2e/lib/interview-data.mjs';
import {needsElectron} from '../../test/needs-electron.js';
import {NOW, calendarFiles, calendarKit, calendarStore} from './screen-calendar-kit.js';
import {newStore} from './screen-store.js';
import {probeWindow} from './window-probe.js';

const live = {skip: needsElectron.skip};
let held, empty, tokyo, honolulu, notion, dates, slots, seed;
const stores = [];

/** Opens the Calendar in `zone` with the clock pinned and returns the script's facts; the script is serialised, so what it needs comes in `data`. */
const inWindow = (files, zone, data, script) => probeWindow({files, use: [calendarKit], env: {TZ: zone}, settings: {store: 'sqlite'}, timeout: 180000,
  script: new Function('kit', `return (${script.toString()})(kit, ${JSON.stringify({...data, now: NOW, zone})});`)});

before(async () => {
  held = calendarStore(); stores.push(held.store);
  const reads = await held.fill();
  ({dates, slots, seed} = held);
  if (needsElectron.skip) return;
  const emptyStore = newStore(); stores.push(emptyStore);
  const none = {jobs: emptyStore.engine('src.desktop', 'calendar'), recordings: emptyStore.engine('src.ai.interviews', 'calendar')};
  empty = inWindow(calendarFiles(none), TOKYO, {}, async (kit, {now, zone}) => {
    kit.pin(now);
    await kit.open();
    return {zone: kit.zone(), upcoming: kit.agenda().upcomingText, past: kit.agenda().pastText, chips: kit.allChips().length, title: kit.title(), today: document.querySelector('#cal-grid .cal-cell.today:not(.out) .cal-num')?.textContent, layout: kit.severe('calendar')};
  });
  tokyo = inWindow(calendarFiles(reads), TOKYO, {days: dates.days, next: dates.nextMonthDay, nextTitle: dates.nextTitle},
    async (kit, {now, days, next, nextTitle}) => {
      kit.pin(now);
      const out = {zone: kit.zone(), clock: new Date().toISOString()};
      const section = async (name, read) => { try { out[name] = await read(); } catch (error) { out[name] = {error: error.message}; } };
      await kit.open();
      await section('grid', async () => ({title: kit.title(), today: document.querySelector('#cal-grid .cal-cell.today:not(.out) .cal-num')?.textContent, chips: kit.allChips(),
        busy: kit.cell(days[1]).innerText, agenda: kit.agenda(), layout: kit.severe('calendar')}));
      await section('arrows', async () => {
        const here = kit.title();
        await kit.press('next', nextTitle);
        const result = {next: kit.title(), nextChips: kit.chips(next), todayThere: kit.todayCells(), nextButtonOff: document.getElementById('cal-today').disabled};
        await kit.press('prev'); await kit.press('prev');
        result.lastMonth = kit.allChips().map(chip => chip.text);
        await kit.press('today', here);
        return {...result, back: kit.title(), here, todayOff: document.getElementById('cal-today').disabled};
      });
      await section('panel', async () => {
        await kit.open(); kit.clickChip(days[0]); await kit.panelShows('Senior SRE'); await kit.closeDrawer();
        await kit.open(); kit.clickRow('E2E Beta'); await kit.panelShows('Platform Engineer'); await kit.closeDrawer();
        return true;
      });
      return out;
    });
  honolulu = inWindow(calendarFiles(reads), HONOLULU, {day: dates.honoluluDay, l1: dates.days[0]}, async (kit, {now, day, l1}) => {
    kit.pin(now);
    await kit.open();
    return {zone: kit.zone(), title: kit.title(), chips: kit.chips(day), onTokyoDay: kit.chips(l1)};
  });
  // A Notion store hands the same jobs with their Notion page (src/desktop_strategy.py calendar_jobs: notion_url from the page); the page's address is the job's id.
  const withPages = {jobs: {jobs: reads.jobs.jobs.map(job => ({...job, notion_url: `https://www.notion.so/${String(job.page_id).replace(/-/g, '')}`}))}, recordings: reads.recordings};
  notion = inWindow(calendarFiles(withPages), TOKYO, {days: dates.days}, async (kit, {now, days}) => {
    kit.pin(now);
    await kit.open();
    kit.clickChip(days[0]); await kit.barrier();
    kit.clickRow('E2E Beta'); await kit.barrier();
    kit.clickChip(days[2]); await kit.barrier();   // the held recording: opens the job it belongs to
    return {stillOnCalendar: !!document.querySelector('.view[data-view="calendar"]:not([hidden])')};
  });
});
after(() => { for (const store of stores) store.remove(); });

const facts = (window, name) => { const value = window.result[name]; assert.equal(value?.error, undefined, `${name}: ${value?.error}`); return value; };
const num = day => String(Number(day.slice(8)));
const chipsOn = (chips, day) => chips.filter(chip => chip.day === num(day)).map(chip => chip.text);

test('the app runs in the time zone and at the time the test asked for (else the other tests prove nothing)', live, () => {
  assert.equal(Date.parse(tokyo.result.clock), Date.parse(NOW));
  assert.equal(tokyo.result.zone, TOKYO);
  assert.equal(honolulu.result.zone, HONOLULU);
});

test('an empty calendar says nothing is scheduled and shows no meeting', live, () => {
  const {upcoming, past, chips, title, today} = empty.result;
  assert.match(upcoming, /No upcoming interviews/, '"Coming up" does not say "No upcoming interviews"');
  assert.match(past, /No past meetings yet/, '"Past" does not say there are no past meetings');
  assert.equal(chips, 0, 'the grid shows a meeting in an empty calendar');
  assert.equal(title, dates.thisTitle, 'the grid does not open on the current month');
  assert.equal(today, num(dates.today), 'the highlighted day is not today');
});

test('the grid shows every meeting on its own day, in the app\'s time zone, with its time', live, () => {
  const {chips} = facts(tokyo, 'grid');
  const [l1, l2, l3] = dates.days;
  const one = chipsOn(chips, l1);
  assert.equal(one.length, 1, `${l1} shows ${JSON.stringify(one)}`);
  assert.ok(/E2E Acme/.test(one[0]) && showsClock(one[0], slots.acme.clock), `${l1} shows ${JSON.stringify(one)}, expected one chip "E2E Acme" at 08:30`);
  assert.equal(chipsOn(chips, l2).length, 3, `${l2} shows ${JSON.stringify(chipsOn(chips, l2))}, expected 3 and a "+1 more" for the fourth meeting`);
  const rec = chipsOn(chips, l3);
  assert.ok(rec.length === 1 && /^✓/.test(rec[0]) && /E2E Acme/.test(rec[0]), `${l3} shows ${JSON.stringify(rec)}, expected the held recording ("✓ … E2E Acme")`);
  const busy = new Set([l1, l2, l3].map(num)), other = chips.filter(chip => !busy.has(chip.day));
  assert.deepEqual(other, [], 'meetings appear on days that have none');
  assert.ok(chips.some(chip => /kind-screening/.test(chip.classes)), 'the Screening stage meeting has no screening style');
});

test('a day with more than three meetings shows three and says how many more', live, () => {
  const {busy, agenda} = facts(tokyo, 'grid');
  assert.match(busy, /\+1 more/, `the busy day does not say "+1 more": ${JSON.stringify(busy)}`);
  const lines = [...agenda.upcoming, ...agenda.past];
  for (const company of ['E2E Beta', 'E2E Gamma', 'E2E Delta', 'E2E Zeta']) assert.ok(lines.includes(company), `the agenda lacks the ${company} meeting that the grid hides behind "+1 more"`);
});

test('the agenda lists what is coming soonest first and what is past latest first', live, () => {
  const {agenda} = facts(tokyo, 'grid');
  assert.equal(dates.future, true, 'the pinned day has room for three days after it in its month');
  // the held recording on the third day is a meeting of the Acme job too: listed on its day, after Zeta (the 3rd) and before Epsilon (next month)
  assert.deepEqual(agenda.upcoming, ['E2E Acme', 'E2E Beta', 'E2E Gamma', 'E2E Delta', 'E2E Zeta', 'E2E Acme', 'E2E Epsilon']);
  assert.doesNotMatch(agenda.upcomingText, /No upcoming interviews/);
  assert.deepEqual(agenda.past, ['E2E Old call']);
});

test('the month arrows move through the months and Today comes back', live, () => {
  const {next, nextChips, todayThere, lastMonth, back, here, todayOff} = facts(tokyo, 'arrows');
  assert.equal(next, dates.nextTitle);
  assert.ok(nextChips.length === 1 && /E2E Epsilon/.test(nextChips[0]) && showsClock(nextChips[0], slots.epsilon.clock), `the 15th of next month shows ${JSON.stringify(nextChips)}, expected "E2E Epsilon" at 12:00`);
  assert.equal(todayThere, 0, '"today" is highlighted in another month');
  // The old call is 40 days back: only it may be in the month before this one.
  assert.ok(lastMonth.every(text => /E2E Old call/.test(text)), `last month shows a meeting of this month: ${JSON.stringify(lastMonth)}`);
  assert.equal(back, here);
  assert.equal(todayOff, true, 'Today is still enabled while this month is shown');
});

test('a meeting opens its job in Notion, from the grid and from the agenda', live, () => {
  const opened = notion.host.filter(call => call.api === 'shell.openExternal').map(call => call.args[0]).filter(url => !/barrier\.invalid/.test(url));
  const page = key => String(seed[key].id).replace(/-/g, '');
  assert.equal(opened.length, 3, `three clicks opened ${JSON.stringify(opened)}`);
  assert.ok(opened[0].includes(page('acme')), `the Acme chip opened ${opened[0]}, expected its Notion page`);
  assert.ok(opened[1].includes(page('beta')), `the Beta agenda row opened ${opened[1]}, expected its Notion page`);
  assert.ok(opened[2].includes(page('acme')), 'the recording on the third day did not open its job');
  assert.equal(notion.result.stillOnCalendar, true, 'a Notion link also moved the window off the Calendar');
});

test('on this Mac\'s store a meeting opens its job\'s side panel, from the grid and from the agenda', live, () => {
  assert.equal(facts(tokyo, 'panel'), true);
  const outside = tokyo.host.filter(call => call.api === 'shell.openExternal');
  assert.deepEqual(outside, [], `a meeting on this Mac's store opened ${JSON.stringify(outside)} outside the app`);
});

test('the same meetings fall on other days and hours in another time zone', live, () => {
  const {chips, onTokyoDay, title} = honolulu.result;
  // Acme: 23:30 UTC the day before l1 is 13:30 that day in Honolulu (and 08:30 the day after in Tokyo).
  assert.equal(title, dates.honoluluTitle);
  assert.ok(chips.some(text => /E2E Acme/.test(text) && showsClock(text, {h: 13, m: 30})), `in Honolulu ${dates.honoluluDay} shows ${JSON.stringify(chips)}, expected "E2E Acme" at 13:30`);
  assert.ok(!onTokyoDay.some(text => /E2E Acme/.test(text) && !/^✓/.test(text)), `in Honolulu the Acme call is also shown on ${dates.days[0]}, the day it falls on in Tokyo`);
});

test('the Calendar renders without layout problems, empty and with meetings', live, () => {
  assert.deepEqual(empty.result.layout, []);
  assert.deepEqual(facts(tokyo, 'grid').layout, []);
});
