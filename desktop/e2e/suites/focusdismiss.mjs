/* global document */
// Job: serve stored answers
// The dismissal half of Focus, on a REAL Notion page (night journey J19). Why (1 Nov 2026, owner: "I'd like the beta to have only the critical e2e/user journeys"; R2): the rest of the Focus checks
// are desktop/integration/app/screen-focus*.test.js, and the five ways to finish an Up next card, the in-app hold and Focus's load and layout are screen-focus-dismiss.test.js, on every PR touching Focus.
// What stays here is what a window on a fake store cannot prove: Dismiss on a job in process written through the real app against a store that lists a write LATE (the stand-in's lag).
import {readData, resetFocusData, scenario} from '../lib/focus-data.mjs';
import {ensureSetUp} from '../lib/seed.mjs';
import {pollUntil, stepTimeLeft, stepWait} from '../lib/wait-on-state.mjs';

export const name = 'focusdismiss';
export const keepGoing = true;
// Why (30 Oct 2026, #2601): setup's contact_from_cv ask already has a reviewed kind reply; do not depend on a hash cache or live AI.
export const aiAnswers = 'backbone';
// Why (30 Oct 2026, #2601): the dismissal step injects Notion listing lag with ctx.standIn.setLag; keep that existing fault path reachable.
export const store = 'standin';
export const minutes = 15;
/** The suite entry: runs the dismissal step on ctx; a failing step is reported by the runner. */
export const run = ctx => runFocus(ctx);

const LIST_LAG_MS = 15000;   // the stand-in's listing lag for the dismissal step (lib/notion-fake.mjs setLag)

async function runFocus(ctx) {
  const {page} = ctx;
  ctx.findings = [];
  const now = new Date();
  let rows, events;

  const readStore = async () => ({rows, events} = await readData(ctx));

  await ensureSetUp(ctx);
  await ctx.run('a search with applications in every stage is written to the store (dummy employers, target 5)', async () => {
    await resetFocusData(ctx, {data: scenario(now)});
    await pollUntil(readStore, data => data.rows.length === 10 && data.events.length === 14, {capMs: stepTimeLeft()});
    if (rows.length !== 10 || events.length !== 14) throw new Error(`expected 10 applications and 14 events in the store, found ${rows.length} and ${events.length}`);
  }, {needs: ctx.needs, critical: true});

  // Night journey J19: the one dismissal that goes through the real store and a reload (a job in process bounced back to "Interview scheduled", 3 Oct 2026).
  await ctx.run('Dismiss on a job in process leaves the In process list at once, and is still gone after a reload (it was bouncing back to "Interview scheduled", 3 Oct 2026)', async () => {
    ctx.standIn?.setLag(LIST_LAG_MS);   // Why (R2, 1 Nov 2026): the lag used to be set by the five-card step before this one; a dismissal the app does not keep would come back from a late listing
    const ember = () => page.locator('#jobs-body .job-row', {hasText: 'Ember Data'});
    await page.click('.nav[data-view="jobs"]');
    await page.click('.stat[data-stat="interviews"]');
    await ember().waitFor({timeout: 30000});
    if (!/Interview scheduled/.test(await ember().innerText())) throw new Error('the Ember Data row should start as "Interview scheduled"');
    await ember().getByRole('button', {name: 'More actions'}).click();
    await page.getByRole('menuitem', {name: 'Dismiss'}).click();
    // At once: no waiting for a refresh. The screen must not claim a change Notion has not taken.
    await ember().waitFor({state: 'detached', timeout: 5000}).catch(() => { throw new Error('the dismissed job is still in the In process list 5 seconds after Dismiss'); });
    const stageInNotion = async () => (await ctx.data('applications', 'list', {})).find(item => item.company === 'Ember Data')?.stage;
    const {value: stage} = await pollUntil(stageInNotion, stage => stage === 'Closed', {capMs: stepTimeLeft()});
    if (stage !== 'Closed') throw new Error(`the store's stage for the dismissed job should be Closed, it is "${stage}"`);
    await page.reload();
    await page.waitForSelector('.view:not([hidden])', {timeout: 60000});
    await page.click('.nav[data-view="jobs"]');
    await page.click('.stat[data-stat="interviews"]');
    await stepWait('the Jobs list finished loading', timeout => page.waitForFunction(() => !document.querySelector('#jobs-body .list-loading')
      && !/Loading|Refreshing|updating/.test(document.querySelector('#jobs-stats')?.textContent || ''), null, {timeout}));
    if (await ember().count()) throw new Error(`after a reload the dismissed job is back in the In process list: "${(await ember().innerText()).replace(/\s+/g, ' ')}" (the store says ${await stageInNotion()})`);
  }, {needs: ctx.needs});
}
