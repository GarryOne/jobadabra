/* global document, window */
// Layer 2, Calendar: what runs inside the window (window-probe.js `use`) to open the Calendar and read it as a person does, and the Node side's data for it.
// Moved from the e2e `calendar` suite's helpers (desktop/e2e/suites/calendar.mjs, 1 Nov 2026), unchanged in what they read.
import {newStore} from './screen-store.js';
import {addInterview, addTrackedJob} from '../../e2e/lib/seed-data.mjs';
import {calendarDates, meetingSlots} from '../../e2e/lib/interview-data.mjs';

/** The instant the window believes it is (the e2e suite read the real clock and was proven for every day of the year; here one fixed day is enough).
 * Why (1 Nov 2026): not the day this was written, so a pin that does nothing fails every day but this one. */
export const NOW = '2026-11-10T10:00:00Z';
export const MEETINGS = [['acme', 'E2E Acme', 'Senior SRE', 'Screening'], ['beta', 'E2E Beta', 'Platform Engineer', 'Interviewing'], ['gamma', 'E2E Gamma', 'Staff SRE', 'Interviewing'],
  ['delta', 'E2E Delta', 'DevOps Engineer', 'Interviewing'], ['zeta', 'E2E Zeta', 'Cloud Engineer', 'Interviewing'], ['epsilon', 'E2E Epsilon', 'Infrastructure Engineer', 'Interviewing']];

/**
 * The Calendar's two reads for a store seeded like the e2e suite's: six meetings on three days (four on one) and one next month, a held recording of the first job, an old call.
 * Both answers are the engine's own commands (src.desktop calendar, src.ai.interviews calendar), the same the app runs on this Mac's store.
 * @returns {{store: object, dates: object, slots: object, jobs: {jobs: object[]}, recordings: {interviews: object[]}, seed: Record<string, {id: string}>}}
 */
export function calendarStore() {
  const store = newStore();
  const ctx = {profile: store.profile, store: 'sqlite', token: '', data: async (entity, method, kwargs) => store.call(entity, method, kwargs)};
  const dates = calendarDates(new Date(NOW)), slots = meetingSlots(dates), seed = {};
  return {store, ctx, dates, slots, seed, async fill() {
    for (const [key, company, role, stage] of MEETINGS) seed[key] = await addTrackedJob(ctx, {role, company, url: `https://boards.e2e.test/cal/${key}`, stage, nextInterview: slots[key].at});
    // A recording on the third day linked to the Acme job (held), and an old one with no job (past).
    await addInterview(ctx, {name: 'E2E Acme · Recruiter screen', day: dates.days[2], round: 'Recruiter screen', overall: 'positive', applicationId: seed.acme.id});
    await addInterview(ctx, {name: 'E2E Old call', day: dates.oldDay, round: 'Call'});
    return this.reads();
  }, reads: () => ({jobs: store.engine('src.desktop', 'calendar'), recordings: store.engine('src.ai.interviews', 'calendar')})};
}

/** The files the demo window reads its Calendar from (lib/jobs-handlers.js calendarJobs, lib/interview-handlers.js calendarRecordings). */
export const calendarFiles = ({jobs, recordings}) => ({'jobs.json': {jobs: jobs.jobs}, 'interviews.json': {saved: recordings.interviews}});

/** In the window: pin its clock, open the Calendar once both reads are drawn, and read the grid and the agenda. Serialised: no closure over this file. */
export const calendarKit = base => {
  const $ = selector => document.querySelector(selector);
  const num = day => String(Number(day.slice(8)));
  const loaded = () => !!$('#cal-grid .cal-cell') && $('#cal-status')?.hidden && !document.querySelector('#cal-upcoming .skeleton, #cal-past .skeleton');
  const cell = day => [...document.querySelectorAll('#cal-grid .cal-cell:not(.out)')].find(one => one.querySelector('.cal-num').textContent === num(day));
  const chips = day => [...(cell(day)?.querySelectorAll('.cal-chip') || [])].map(chip => chip.textContent);
  const who = list => [...document.querySelectorAll(`${list} .cal-who`)].map(node => node.textContent);
  return {
    num, cell, chips, who,
    /** The window's clock reads `iso` from here on (Date.now() and new Date()), the way the app's own tests inject one. */
    pin: iso => { const Real = Date, at = Real.parse(iso); window.Date = class extends Real { constructor(...args) { super(...(args.length ? args : [at])); } static now() { return at; } }; },
    zone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    open: async () => { await base.go('calendar'); await base.until(loaded, 'the Calendar to finish loading'); },
    title: () => $('#cal-title').textContent,
    /** A month arrow or Today, then wait for the title to be the one asked for. */
    press: async (id, titleAfter) => { $(`#cal-${id}`).click(); if (titleAfter) await base.until(() => $('#cal-title').textContent === titleAfter, `the title to be "${titleAfter}" after ${id}`); },
    allChips: () => [...document.querySelectorAll('#cal-grid .cal-cell:not(.out)')].flatMap(one => [...one.querySelectorAll('.cal-chip')].map(chip => ({day: one.querySelector('.cal-num').textContent, text: chip.textContent, classes: chip.className}))),
    todayCells: () => document.querySelectorAll('#cal-grid .cal-cell.today:not(.out)').length,
    agenda: () => ({upcoming: who('#cal-upcoming'), past: who('#cal-past'), upcomingText: $('#cal-upcoming').innerText, pastText: $('#cal-past').innerText}),
    /** Click a chip of the day, or the agenda row naming `company`; returns after the click. */
    clickChip: day => cell(day).querySelector('.cal-chip').click(),
    clickRow: company => [...document.querySelectorAll('#cal-upcoming .cal-row, #cal-past .cal-row')].find(row => row.textContent.includes(company)).click(),
    /** The page after a click: the Jobs view with the job's panel open on `title`. */
    panelShows: async title => {
      await base.until(() => $('.view[data-view="jobs"]:not([hidden])'), 'the Jobs view to open');
      await base.until(() => ($('#job-panel:not([hidden]) h2')?.textContent || '').includes(title), `the job panel to show "${title}"`);
    },
    closeDrawer: async () => {
      document.dispatchEvent(new window.KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
      await base.until(() => $('#job-drawer-layer').hidden, 'the job drawer to close on Escape');
    },
    /** Every earlier click on the same door has been handled once this one answers (IPC calls on one channel run in order); the sentinel is the last entry of the host log. */
    barrier: async () => { await window.pilot.openExternal('https://barrier.invalid/'); },
  };
};
