// Job: run the backbone
/* global window */
// Profile → Experience, end to end (journey J14, Tier 1; owner, 1 Nov 2026: "Profile (CV, Experience)"): the person edits their Professional summary, presses the Profile's one save bar,
// the app writes it to the store, and after the app is quit and started again the card shows it and the store still holds it. Used by e2e/suites/settings.mjs. Fake applicant text only.
// The same rule below the browser, on every PR: desktop/integration/store/profile-experience-edit.test.mjs (the textEdit handler, a restart, the apply side's read, a stale edit refused).
import {changesFor, profileParts} from '../../renderer/experience-profile-model.js';
import {pollUntil, stepWait, waitForLogLine} from './wait-on-state.mjs';

const SEEDED = 'Platform engineer with 8 years on AWS, written by the e2e suite.';
const EDITED = 'Site reliability engineer who has run on-call for 40 services, edited by the e2e suite.';

const outlineOf = ctx => ctx.page.evaluate(() => window.pilot.textOutline('profile'));
const summaryOf = outline => (outline?.items ? (profileParts(outline.items).summary?.lines || []).map(line => line.text) : []);

// Poll the store's Profile until its summary lines are `want`; the error names the lines it saw last.
async function waitForSummary(ctx, want, what) {
  const {value} = await pollUntil(async () => summaryOf(await outlineOf(ctx)), seen => JSON.stringify(seen) === JSON.stringify(want), {log: () => {}});
  if (JSON.stringify(value) !== JSON.stringify(want)) throw new Error(`${what}: the Profile's summary should be ${JSON.stringify(want)}, last seen ${JSON.stringify(value)}`);
}

// Profile → Experience as a person opens it: the menu's Profile, then its Experience tab.
async function openExperience(ctx) {
  await stepWait('the Profile menu item', timeout => ctx.page.getByRole('button', {name: 'Profile', exact: true}).click({timeout}));
  await stepWait('the Experience tab', timeout => ctx.page.getByRole('tab', {name: 'Experience', exact: true}).click({timeout}));
}

export async function profileExperienceStep(ctx) {
  // The start-up move into the store finishes first: it may drop this Mac's profile copy once Notion has it (see settings.mjs roundTrip).
  await waitForLogLine(ctx.profile, /startup moves finished/g, {what: 'the app\'s start-up move into the store'});

  // Seed through the app's own textEdit: exactly one summary line, so the card has one box to edit.
  const seed = changesFor('summary', profileParts(await outlineOf(ctx)).summary, [SEEDED]);
  if (seed.length) {
    const seeded = await ctx.page.evaluate(changes => window.pilot.textEdit('profile', changes), seed);
    if (!seeded.ok) throw new Error(`the e2e summary could not be put in the Profile: ${seeded.error}`);
  }
  await waitForSummary(ctx, [SEEDED], 'after seeding');
  await ctx.page.reload();   // the Profile page reads the store afresh

  await openExperience(ctx);
  await stepWait('Edit on the Professional summary', timeout => ctx.page.getByRole('button', {name: 'Edit professional summary'}).click({timeout}));
  await stepWait('the Professional summary box', timeout => ctx.page.getByRole('textbox', {name: 'Professional summary'}).fill(EDITED, {timeout}));
  const bar = ctx.page.getByRole('region', {name: 'Unsaved changes'});
  await stepWait('the save bar to show the change', timeout => bar.getByRole('button', {name: 'Save all changes'}).click({timeout}));

  // The save's own result: the store holds the new summary and the card is back to its Edit button.
  await waitForSummary(ctx, [EDITED], 'after Save all changes');
  await stepWait('the summary card to close its editor', timeout => ctx.page.getByRole('button', {name: 'Edit professional summary'}).waitFor({state: 'visible', timeout}));

  // The app is quit as a person quits it and started again on the same data folder.
  await ctx.relaunch({}, undefined, {how: 'quit'});
  const {value: setUp} = await pollUntil(() => ctx.page.evaluate(async () => (await window.pilot.state()).settings.setupDone === true), value => value, {log: () => {}});
  if (!setUp) throw new Error('after the restart the app is not set up again');
  await waitForLogLine(ctx.profile, /startup moves finished/g, {what: 'the restarted app\'s start-up move into the store'});
  await waitForSummary(ctx, [EDITED], 'after the app started again');

  await openExperience(ctx);
  await stepWait('the saved summary on the Experience card', timeout => ctx.page.getByText(EDITED).waitFor({state: 'visible', timeout}));
}
