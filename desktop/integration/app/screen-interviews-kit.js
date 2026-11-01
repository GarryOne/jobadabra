/* global document, window */
// Layer 2, Interviews: the store the e2e `interviews` suite seeds (three jobs, four interviews: three reviewed with different outcomes, one not), read through the engine's own
// commands into the files the demo window shows, and what runs inside the window (window-probe.js `use`) to open the library and read it as a person does.
// Moved from desktop/e2e/suites/interviews.mjs (1 Nov 2026), unchanged in what it reads.
import fs from 'node:fs';
import {addDays, TRANSCRIPT} from '../../e2e/lib/interview-data.mjs';
import {addInterview, addTrackedJob} from '../../e2e/lib/seed-data.mjs';
import {newStore} from './screen-store.js';

/** The day the seeded interviews count back from (a fixed day: their order and dates are what the library shows, not how long ago they were). */
export const DAY = '2026-11-01';
const demo = JSON.parse(fs.readFileSync(new URL('../../demo/interviews.json', import.meta.url), 'utf8'));
const review = text => `${text}\n\n### Strengths\n\n- SEED strength: clear incident handling\n\n### Questions\n\n- ✅ [Incidents] How do you handle an unclear root cause? — rollback, then timeline\n`;

/**
 * Seeds a SQLite store like the e2e suite and reads what the app reads: the Jobs list (src.desktop jobs), the library (src.ai.interviews list) and each interview's record (the
 * store's own `interviews get`, what "Open review" shows on this Mac's store).
 * @returns {{store: object, seed: Record<string, {id: string, day?: string}>, files: Record<string, unknown>}} `files` replace the demo window's jobs.json and interviews.json
 */
export async function interviewsStore() {
  const store = newStore(), seed = {};
  const ctx = {profile: store.profile, store: 'sqlite', token: '', data: async (entity, method, kwargs) => store.call(entity, method, kwargs)};
  for (const [key, role, company, n] of [['acme', 'Senior Site Reliability Engineer', 'E2E Acme', 9001], ['beta', 'Platform Engineer', 'E2E Beta', 9002], ['gamma', 'Senior Site Reliability Engineer', 'E2E Gamma', 9003]]) {
    const url = `https://boards.e2e.test/job/${n}`;
    seed[key] = {...(await addTrackedJob(ctx, {role, company, url})), url, company, role};
  }
  const make = async (key, fields, reviewed) => { seed[key] = {...(await addInterview(ctx, {...fields, transcript: TRANSCRIPT, ...(reviewed ? {review: review(`SEED summary ${key}`)} : {})})), day: fields.day}; };
  await make('ivPositive', {name: 'E2E Acme · Round 1', day: addDays(DAY, -10), round: 'Recruiter screen', overall: 'positive', nextStep: 'Technical interview', applicationId: seed.acme.id}, true);
  await make('ivNeutral', {name: 'E2E Beta · Round 2', day: addDays(DAY, -6), round: 'Technical', overall: 'neutral', nextStep: 'Wait for feedback', applicationId: seed.beta.id}, true);
  await make('ivNegative', {name: 'E2E Loose · Round 1', day: addDays(DAY, -3), round: 'Hiring manager', overall: 'negative'}, true);
  await make('ivFresh', {name: 'E2E Gamma · Not reviewed yet', day: addDays(DAY, -1), round: 'Call', applicationId: seed.gamma.id}, false);
  const library = store.engine('src.ai.interviews', 'list');
  if (!library?.ok) throw new Error(`the engine could not list the interviews: ${JSON.stringify(library)}`);
  const records = Object.fromEntries(library.interviews.map(row => [row.id, store.call('interviews', 'get', {interview_id: row.id})]));
  return {store, seed, files: {'jobs.json': store.engine('src.desktop', 'jobs'), 'interviews.json': {...demo, saved: library.interviews, insight: library.insight, records}}};
}

/** In the window: open the library with all its rows drawn, and read a row the way a person does. Serialised: no closure over this file. */
export const interviewsKit = base => {
  const $ = selector => document.querySelector(selector);
  const ids = () => [...document.querySelectorAll('#iv-saved tr[data-id]')].map(tr => tr.dataset.id);
  const row = id => document.querySelector(`#iv-saved tr[data-id="${id}"]`);
  const button = (scope, name) => [...scope.querySelectorAll('button')].find(one => (one.getAttribute('aria-label') || one.textContent).trim() === name);
  return {
    ids, row,
    /** The Jobs list the library finds its jobs in (the page that reads it is the Jobs page: the e2e step did the same read). */
    readJobs: async () => { const read = await window.pilot.jobs(); window.__jp.shared.allJobs = read.jobs; return read.jobs.length; },
    open: async count => {
      await base.go('interviews');
      await base.until(() => ids().length === count && $('#iv-lib-stats').textContent.trim() !== '', `${count} interview rows and the library's "saved" line`);
    },
    stats: () => $('#iv-lib-stats').textContent.trim(),
    /** The row's cells as text: [date.., job, .., outcome] by column. */
    cell: (id, column) => row(id).querySelectorAll('td')[column].innerText.replace(/\s+/g, ' ').trim(),
    jobButton: (id, name) => [...row(id).querySelectorAll('td')[1].querySelectorAll('button')].find(one => one.textContent.includes(name)),
    /** Type into a box as a person does (the page listens to input) and wait for the number of rows. */
    type: async (selector, value, count) => { const box = $(selector); box.value = value; box.dispatchEvent(new window.Event('input', {bubbles: true})); await base.until(() => ids().length === count, `${count} rows after "${value}" in ${selector}`); },
    pick: async (selector, value, count) => { const box = $(selector); box.value = value; box.dispatchEvent(new window.Event('change', {bubbles: true})); await base.until(() => ids().length === count, `${count} rows after ${selector} = "${value}"`); },
    press: (id, name) => { const found = button(row(id), name); if (!found) throw new Error(`no "${name}" button on the row ${id}`); found.click(); },
    /** ⋯ → the menu item whose text matches `label`. */
    choose: async (id, label) => {
      button(row(id), 'More actions').click();
      const item = await base.until(() => [...document.querySelectorAll('[role=menuitem]')].find(one => one.offsetParent !== null && label.test(one.textContent)), `the ⋯ menu to show ${label}`);
      item.click();
    },
  };
};
