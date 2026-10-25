/* global document */
// Calendar: meetings from the Job Tracker ("Next interview") and from saved recordings, on dummy rows written through the Notion API, with the app running in a fixed time
// zone (Asia/Tokyo, no daylight saving) and then in another (Pacific/Honolulu). Starts from a set-up install; resets only its own rows.
import {launch} from '../lib/app.mjs';
import {addDays, showsClock, weekDays} from '../lib/interview-data.mjs';
import {addInterview, addTrackedJob} from '../lib/seed-data.mjs';
import {clearData} from '../lib/start-state.mjs';
import {finish, snap} from '../lib/layout.mjs';
import {fastSeed, ensureSetUp} from '../lib/seed.mjs';
import {captureExternal, ids, independent} from '../lib/steps.mjs';
import {goView} from '../lib/go-view.mjs';

export const name = 'calendar';
export const env = {TZ: 'Asia/Tokyo'};
const ZONE = 'Asia/Tokyo';
const dayIn = (date, zone) => new Intl.DateTimeFormat('en-CA', {timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit'}).format(date);
// Today is disabled while this month is already shown: press it only when it can move the page.
const backToToday = async page => { if (await page.locator('#cal-today').isEnabled()) await page.click('#cal-today'); };
const monthTitle = day => new Date(`${day.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString('en-US', {month: 'long', year: 'numeric', timeZone: 'UTC'});

export async function run(ctx) {
  const {page, app} = ctx;
  ctx.findings = [];
  const {step, end} = independent(ctx);
  const today = dayIn(new Date(), ZONE);
  const {days: [l1, l2, l3], future} = weekDays(today);
  const nextMonthDay = dayIn(new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 15, 3)), ZONE);   // the 15th of next month, noon in Tokyo
  const oldDay = addDays(today, -40);
  // Instants chosen so that the local day differs between zones: 23:30 UTC on D-1 is D 08:30 in Tokyo and D-1 13:30 in Honolulu.
  const utc = (day, time) => `${day}T${time}:00Z`;
  const meetings = [
    {key: 'acme', company: 'E2E Acme', role: 'Senior SRE', stage: 'Screening', at: utc(addDays(l1, -1), '23:30'), day: l1, clock: {h: 8, m: 30}},
    {key: 'beta', company: 'E2E Beta', role: 'Platform Engineer', stage: 'Interviewing', at: utc(l2, '01:00'), day: l2, clock: {h: 10, m: 0}},
    {key: 'gamma', company: 'E2E Gamma', role: 'Staff SRE', stage: 'Interviewing', at: utc(l2, '06:00'), day: l2, clock: {h: 15, m: 0}},
    {key: 'delta', company: 'E2E Delta', role: 'DevOps Engineer', stage: 'Interviewing', at: utc(l2, '08:00'), day: l2, clock: {h: 17, m: 0}},
    {key: 'zeta', company: 'E2E Zeta', role: 'Cloud Engineer', stage: 'Interviewing', at: utc(l2, '09:00'), day: l2, clock: {h: 18, m: 0}},
    {key: 'epsilon', company: 'E2E Epsilon', role: 'Infrastructure Engineer', stage: 'Interviewing', at: utc(nextMonthDay, '03:00'), day: nextMonthDay, clock: {h: 12, m: 0}},
  ];
  const seed = {};
  const num = day => String(Number(day.slice(8)));
  const closeDrawer = async () => {
    await page.keyboard.press('Escape');
    await page.locator('#job-drawer-layer').waitFor({state: 'hidden', timeout: 10000}).catch(() => { throw new Error('the job drawer did not close on Escape'); });
  };
  const openCalendar = async () => {
    await page.click('.nav[data-view="focus"]');
    await goView(page, 'calendar');
    await backToToday(page);
    await ready(page);
  };
  const ready = target => target.waitForFunction(() => document.getElementById('cal-status').hidden && !document.querySelector('#cal-upcoming .skeleton, #cal-past .skeleton'), null, {timeout: 120000});
  const cell = (target, day) => target.locator('#cal-grid .cal-cell:not(.out)').filter({has: target.locator('.cal-num', {hasText: new RegExp(`^${num(day)}$`)})});
  const chipsOf = (target, day) => cell(target, day).locator('.cal-chip').allInnerTexts();

  await ensureSetUp(ctx);
  const external = await captureExternal(app);
  await ctx.run('this suite starts with no jobs and no interviews in its Notion page', async () => {
    console.log(`  cleared ${await clearData(ctx, 'Job Tracker')} job row(s) and ${await clearData(ctx, 'Interviews')} interview row(s)`);
  });

  await step('the app runs in the time zone the test asked for', async () => {
    const zone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
    if (zone !== ZONE) throw new Error(`the app runs in "${zone}", not "${ZONE}": the time zone steps would prove nothing`);
  });

  await step('an empty calendar says nothing is scheduled and shows no meeting', async () => {
    await openCalendar();
    if (!/No upcoming interviews/.test(await page.locator('#cal-upcoming').innerText())) throw new Error('"Coming up" does not say "No upcoming interviews"');   // the empty card's words since fe415fb (#299: the suite still expected "Nothing scheduled")
    if (!/No past meetings yet/.test(await page.locator('#cal-past').innerText())) throw new Error('"Past" does not say there are no past meetings');
    if (await page.locator('#cal-grid .cal-chip').count()) throw new Error('the grid shows a meeting in an empty calendar');
    if ((await page.locator('#cal-title').innerText()) !== monthTitle(today)) throw new Error(`the grid opens on "${await page.locator('#cal-title').innerText()}", not the current month`);
    if ((await page.locator('#cal-grid .cal-cell.today .cal-num').innerText()) !== num(today)) throw new Error('the highlighted day is not today');
    await snap(ctx, 'calendar-empty', {view: 'calendar', situation: 'A calendar with no meeting'});
  });

  await ctx.run('this suite writes its dummy meetings to the store', async () => {
    for (const item of meetings) seed[item.key] = await addTrackedJob(ctx, {role: item.role, company: item.company, url: `https://boards.e2e.test/cal/${item.key}`, stage: item.stage, nextInterview: item.at});
    // A recording on the third day, linked to the Acme job (held), and an old one with no job (past).
    await addInterview(ctx, {name: 'E2E Acme · Recruiter screen', day: l3, round: 'Recruiter screen', overall: 'positive', applicationId: seed.acme.id});
    await addInterview(ctx, {name: 'E2E Old call', day: oldDay, round: 'Call'});
  });
  if (!seed.epsilon) throw new Error('the dummy meetings were not written: the other steps cannot run');

  await step('the grid shows every meeting on its own day, in the app\'s time zone, with its time', async () => {
    await openCalendar();
    await page.waitForFunction(() => document.querySelectorAll('#cal-grid .cal-chip').length >= 5, null, {timeout: 60000});
    const got = {};
    for (const day of new Set([l1, l2, l3])) got[day] = await chipsOf(page, day);
    const acme = meetings[0];
    if (got[l1].length !== 1 || !/E2E Acme/.test(got[l1][0]) || !showsClock(got[l1][0], acme.clock)) throw new Error(`${l1} shows ${JSON.stringify(got[l1])}, expected one chip "E2E Acme" at 08:30`);
    if (got[l2].length !== 3) throw new Error(`${l2} shows ${got[l2].length} chips, expected 3 and a "+1 more" for the fourth meeting: ${JSON.stringify(got[l2])}`);
    if (got[l3].length !== 1 || !/^✓/.test(got[l3][0]) || !/E2E Acme/.test(got[l3][0])) throw new Error(`${l3} shows ${JSON.stringify(got[l3])}, expected the held recording ("✓ … E2E Acme")`);
    const other = await page.locator('#cal-grid .cal-cell:not(.out)').evaluateAll((cells, busy) => cells.filter(c => !busy.includes(c.querySelector('.cal-num').textContent)).flatMap(c => [...c.querySelectorAll('.cal-chip')].map(chip => chip.textContent)), [l1, l2, l3].map(num));
    if (other.length) throw new Error(`meetings appear on days that have none: ${JSON.stringify(other)}`);
    if (!(await page.locator('#cal-grid .cal-chip.kind-screening').count())) throw new Error('the Screening stage meeting has no screening style');
    await snap(ctx, 'calendar', {view: 'calendar', situation: `A month with meetings on ${l1}, ${l2} (four, three shown) and ${l3} (a held recording)`});
  });

  await step('a day with more than three meetings shows three and says how many more', async () => {
    await openCalendar();
    await page.waitForFunction(() => document.querySelectorAll('#cal-grid .cal-chip').length >= 5, null, {timeout: 60000});
    const text = await cell(page, l2).innerText();
    if (!/\+1 more/.test(text)) throw new Error(`the busy day does not say "+1 more": ${JSON.stringify(text)}`);
    const agenda = await page.locator('#cal-upcoming .cal-row, #cal-past .cal-row').allInnerTexts();
    for (const company of ['E2E Beta', 'E2E Gamma', 'E2E Delta', 'E2E Zeta']) if (!agenda.some(line => line.includes(company))) throw new Error(`the agenda lacks the ${company} meeting that the grid hides behind "+1 more"`);
  });

  await step('the agenda lists what is coming soonest first and what is past latest first', async () => {
    await openCalendar();
    await page.waitForFunction(() => document.querySelectorAll('#cal-upcoming .cal-row').length + document.querySelectorAll('#cal-past .cal-row').length >= 6, null, {timeout: 60000});
    const upcoming = await page.locator('#cal-upcoming .cal-who').allInnerTexts();
    const past = await page.locator('#cal-past .cal-who').allInnerTexts();
    const expectUpcoming = future ? ['E2E Acme', 'E2E Beta', 'E2E Gamma', 'E2E Delta', 'E2E Zeta', 'E2E Epsilon'] : ['E2E Epsilon'];
    // the held recording on the third day is a meeting of the Acme job too: listed with the others on its day
    const upcomingNames = upcoming.filter((name, i) => !(name === 'E2E Acme' && i > 0 && upcoming[i - 1] === 'E2E Zeta'));
    if (!expectUpcoming.every(name => upcomingNames.includes(name))) throw new Error(`"Coming up" lists ${JSON.stringify(upcoming)}, expected ${JSON.stringify(expectUpcoming)} in order`);
    if (future && upcomingNames.indexOf('E2E Beta') > upcomingNames.indexOf('E2E Gamma')) throw new Error('"Coming up" is not soonest first');
    if (/No upcoming interviews/.test(await page.locator('#cal-upcoming').innerText())) throw new Error('"Coming up" says "No upcoming interviews" although meetings are coming');
    if (!past.includes('E2E Old call')) throw new Error(`"Past" lacks the old call: ${JSON.stringify(past)}`);
    if (future && past.length !== 1) throw new Error(`"Past" lists ${JSON.stringify(past)}, expected only the old call`);
  });

  await step('the month arrows move through the months and Today comes back', async () => {
    await openCalendar();
    const here = await page.locator('#cal-title').innerText();
    await page.click('#cal-next');
    const next = monthTitle(addDays(`${today.slice(0, 7)}-28`, 5));
    if ((await page.locator('#cal-title').innerText()) !== next) throw new Error(`"›" shows "${await page.locator('#cal-title').innerText()}", expected "${next}"`);
    const chips = await chipsOf(page, nextMonthDay);
    if (chips.length !== 1 || !/E2E Epsilon/.test(chips[0]) || !showsClock(chips[0], {h: 12, m: 0})) throw new Error(`the 15th of next month shows ${JSON.stringify(chips)}, expected "E2E Epsilon" at 12:00`);
    // Only the month's own days: the grid also draws the neighbours' days (.out), and in Tokyo "today" can be the first of them (25 Oct 2026 17:10 UTC is the 26th there, a day of November's first week).
    if (await page.locator('#cal-grid .cal-cell.today:not(.out)').count()) throw new Error('"today" is highlighted in another month');
    await page.click('#cal-prev'); await page.click('#cal-prev');
    // The old call is seeded 40 days back: from the 10th of a month on, that is last month. Only it may be there.
    const lastMonth = await page.locator('#cal-grid .cal-cell:not(.out) .cal-chip').allInnerTexts();
    if (lastMonth.some(chip => !/E2E Old call/.test(chip))) throw new Error(`last month shows a meeting of this month: ${JSON.stringify(lastMonth)}`);
    await page.click('#cal-today');
    await page.waitForFunction(title => document.getElementById('cal-title').textContent === title, here, {timeout: 30000});
    if (await page.locator('#cal-today').isEnabled()) throw new Error('Today is still enabled while this month is shown');
  });

  // On this Mac's store a job has no Notion page: a meeting opens the job's side panel in the app instead (owner via mac-e4, 9 Oct 2026; mac-27 f8f8d5e): the next step.
  const notionPage = {name: 'a Notion page for the meeting\'s job (on this Mac\'s store the next step checks the job\'s side panel)', value: ctx.store !== 'sqlite'};
  await step('a meeting opens its job in Notion, from the grid and from the agenda', async () => {
    await openCalendar();
    await page.waitForFunction(() => document.querySelectorAll('#cal-grid .cal-chip').length >= 5, null, {timeout: 60000});
    await external.clear();
    await cell(page, l1).locator('.cal-chip').first().click();
    await page.waitForTimeout(400);
    let opened = await external.urls();
    if (!opened.some(url => url.includes(ids(seed.acme.id)))) throw new Error(`clicking the Acme chip opened ${JSON.stringify(opened)}, expected its Notion page ${ids(seed.acme.id)}`);
    await external.clear();
    await page.locator('#cal-upcoming .cal-row, #cal-past .cal-row').filter({hasText: 'E2E Beta'}).first().click();
    await page.waitForTimeout(400);
    opened = await external.urls();
    if (!opened.some(url => url.includes(ids(seed.beta.id)))) throw new Error(`clicking the Beta agenda row opened ${JSON.stringify(opened)}, expected its Notion page ${ids(seed.beta.id)}`);
    await external.clear();
    await cell(page, l3).locator('.cal-chip').first().click();   // the held recording: opens the job it belongs to
    await page.waitForTimeout(400);
    if (!(await external.urls()).some(url => url.includes(ids(seed.acme.id)))) throw new Error('the recording on the third day did not open its job');
  }, {needs: [notionPage]});

  // This Mac's store: no Notion page, so a meeting opens its job's side panel in the app (renderer/pages/calendar.js, mac-27 f8f8d5e), from the grid and the agenda.
  const panelShows = async (who, title) => {
    await page.waitForSelector('.view[data-view="jobs"]:not([hidden])', {timeout: 15000}).catch(() => { throw new Error(`clicking the ${who} meeting did not open the Jobs view`); });
    await page.waitForFunction(want => (document.querySelector('#job-panel:not([hidden]) h2')?.textContent || '').includes(want), title, {timeout: 15000})
      .catch(async () => { throw new Error(`the job panel after the ${who} meeting shows "${await page.locator('#job-panel h2').first().textContent().catch(() => '')}", expected "${title}"`); });
  };
  await step('on this Mac\'s store a meeting opens its job\'s side panel, from the grid and from the agenda', async () => {
    await openCalendar();
    await page.waitForFunction(() => document.querySelectorAll('#cal-grid .cal-chip').length >= 5, null, {timeout: 60000});
    await external.clear();
    await cell(page, l1).locator('.cal-chip').first().click();
    await panelShows('Acme', seed.acme.title);
    await closeDrawer();   // the person closes the job's drawer (Escape) before the next click: it covers the page while it is open
    await openCalendar();
    await page.locator('#cal-upcoming .cal-row, #cal-past .cal-row').filter({hasText: 'E2E Beta'}).first().click();
    await panelShows('Beta', seed.beta.title);
    await closeDrawer();
    if ((await external.urls()).length) throw new Error(`a meeting on this Mac's store opened ${JSON.stringify(await external.urls())} outside the app`);
  }, {needs: [{name: 'this Mac\'s store (on Notion a meeting opens its Notion page: the step above)', value: ctx.store === 'sqlite'}]});

  await step('the same meetings fall on other days and hours in another time zone', async () => {
    const options = {env: {...ctx.appEnv, TZ: 'Pacific/Honolulu', JOB_PILOTTO_TZ: 'Pacific/Honolulu'}};
    // The same data in another zone. Notion: a second app, connected to the same workspace. This Mac's store: the data is this profile's, so the same app
    // starts again in Honolulu, and back in the test's zone afterwards.
    const sameMac = ctx.store === 'sqlite';
    if (sameMac) await ctx.relaunch({TZ: 'Pacific/Honolulu', JOB_PILOTTO_TZ: 'Pacific/Honolulu'});
    // A second Electron next to the first sometimes misses its first window on a busy machine: one more try, then fail loudly.
    const other = sameMac ? {page: ctx.page, close: () => ctx.relaunch()} : await launch(options).catch(error => { console.log(`  second app did not open (${error.message.split('\n')[0]}): trying once more`); return launch(options); });
    try {
      if (!sameMac) await fastSeed({...ctx, page: other.page, profile: other.profile});
      const zone = await other.page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
      if (zone !== 'Pacific/Honolulu') throw new Error(`the second app runs in "${zone}"`);
      await goView(other.page, 'calendar');
      await backToToday(other.page);
      await ready(other.page);
      // Acme: 23:30 UTC on (l1 - 1) is 13:30 on that same day in Honolulu (and 08:30 the day after in Tokyo).
      const day = addDays(l1, -1);
      const wantMonth = monthTitle(day);
      for (let i = 0; i < 3 && (await other.page.locator('#cal-title').innerText()) !== wantMonth; i++) {
        await other.page.click((await other.page.locator('#cal-title').innerText()) < wantMonth ? '#cal-next' : '#cal-prev');
      }
      await other.page.waitForFunction(() => document.querySelectorAll('#cal-grid .cal-chip').length > 0, null, {timeout: 30000});
      const chips = await chipsOf(other.page, day);
      if (!chips.some(text => /E2E Acme/.test(text) && showsClock(text, {h: 13, m: 30}))) throw new Error(`in Honolulu ${day} shows ${JSON.stringify(chips)}, expected "E2E Acme" at 13:30 (Tokyo shows it on ${l1} at 08:30)`);
      if ((await chipsOf(other.page, l1)).some(text => /E2E Acme/.test(text) && !/^✓/.test(text))) throw new Error(`in Honolulu the Acme call is also shown on ${l1}, the day it falls on in Tokyo`);
    } finally { await other.close(); }
  });

  await step('Calendar renders without layout problems', async () => { finish(ctx); });
  end();
}
