/* global document, window */
// The store setting (docs/superpowers/specs/2026-10-09-store-adapters.md): an app on the SQLite store tracks with no Notion at all, and one with no
// store chosen behaves as before. No Notion page and no token: `notion = false`. What stays here is what writes through the real app (the board's stage columns, moving a card,
// a remembered answer). Why (1 Nov 2026): the Jobs saved view, a job's page, Reports, the Funnel and Interviews' gate moved to desktop/integration/app/screen-stores.test.js.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const name = 'stores';
export const notion = false;
export const keepGoing = true;
export const minutes = 6;
// Why (29 Oct 2026, ap): stores' answers are its one stand-in plus declared kinds, so CI needs neither a live key nor the relay.
export const offlineAi = true;
export const realAi = false;
export const aiAnswers = 'backbone';   // answers its AI from the stored table in every workflow (plan-run.mjs puts it in the matrix)

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
// One store method on the e2e app's own SQLite store (its profile's data folder, as lib/pipeline-env.js gives the engine), never anyone's data:
// the folder must sit in the temp profile, and no Notion token or app-following reaches the engine.
function storeCall(ctx, entity, method, kwargs) {
  const data = path.join(ctx.profile, 'data');
  if (!path.resolve(data).startsWith(fs.realpathSync(os.tmpdir())) && !path.resolve(data).startsWith(os.tmpdir())) throw new Error(`not a temp profile: ${data}`);
  const env = {PATH: process.env.PATH, HOME: ctx.profile, JOB_PILOTTO_STORE: 'sqlite', JOB_PILOTTO_DATA_DIR: data, JOB_PILOTTO_FOLLOW_APP: '0',
    JOB_PILOTTO_DISABLE: 'mail,notion,telegram,google_jobs'};
  const out = execFileSync('python3', ['-m', 'src.stores', 'call', entity, method, JSON.stringify(kwargs)], {cwd: REPO, env, encoding: 'utf8'});
  const answer = JSON.parse(out.trim().split('\n').pop());   // {result} or {error} (src/stores/__main__.py)
  if (answer.error) throw new Error(`${entity}.${method}: ${answer.error}`);
  return answer.result;
}

const KEY = 'sk-ant-api03-e2e-stores-not-a-real-key-0000000000000000000000000000000000000000000000000000';

export async function run(ctx) {
  const {page} = ctx;
  const settle = async () => { await page.reload(); await page.waitForSelector('.view:not([hidden])', {timeout: 60000}); };

  await ctx.run('the app is set up on the SQLite store, with no Notion token', async () => {
    await page.evaluate(async key => {
      await window.pilot.saveSecret('ANTHROPIC_API_KEY', key);
      await window.pilot.saveSettings({setupDone: true, wizardStep: 'draft', setupFurthest: 'draft', store: 'sqlite'});
    }, KEY);
    await settle();
    const settings = JSON.parse(fs.readFileSync(path.join(ctx.profile, 'settings.json'), 'utf8'));
    if (settings.store !== 'sqlite') throw new Error(`the setting did not stick: store=${JSON.stringify(settings.store)}`);   // the positive control
  }, {critical: true});

  // A remembered answer kept in Availability & compensation: desktop/integration/store/remember-answer.test.mjs (moved 1 Nov 2026, R2).

  // Jobs → Board and the saved views (renderer/jobs-board-rules.js, pages/jobs-board.js): two applications made on the store, then moved
  // through the board's own menu, as a person would; the stage and its event must be in the store after a reload.
  const today = new Date().toISOString().slice(0, 10);
  const BOARD = {applied: 'https://jobs.example.test/board-applied', saved: 'https://jobs.example.test/board-saved'};
  const goBoard = async () => {
    await page.click('.nav[data-view="jobs"]');
    await page.waitForSelector('.view[data-view="jobs"]:not([hidden])');
    await page.click('[data-mode="board"]');
    await page.waitForSelector('#jobs-board:not([hidden]) .board-column');
  };
  const cardIn = (url, stage) => page.evaluate(({u, s}) => !!document.querySelector(`#jobs-board .board-column[data-stage="${s}"] .board-card[data-url="${u}"]`), {u: url, s: stage});   // Playwright: one argument

  await ctx.run('the board shows the store\'s applications in their stage columns', async () => {
    storeCall(ctx, 'applications', 'create', {job: {url: BOARD.applied, title: 'Board Test Engineer', company: 'Example Board Co', applied_on: today}, stage: 'Applied'});
    storeCall(ctx, 'applications', 'create', {job: {url: BOARD.saved, title: 'Board Saved Engineer', company: 'Example Board Co'}, stage: 'Saved'});
    if (storeCall(ctx, 'applications', 'get', {url: BOARD.applied})?.stage !== 'Applied') throw new Error('the seed did not reach the store');   // the positive control
    await settle();
    await goBoard();
    await page.waitForFunction(u => !!document.querySelector(`#jobs-board .board-card[data-url="${u}"]`), BOARD.applied, {timeout: 30000})
      .catch(() => { throw new Error('the store\'s application is not on the board (the Jobs list does not read the store?)'); });
    const columns = await page.evaluate(() => [...document.querySelectorAll('#jobs-board .board-column')].map(column => column.dataset.stage));
    if (columns.length !== 15 || columns[0] !== 'Recruiter lead' || columns.at(-1) !== 'Dismissed') throw new Error(`columns: ${columns.join(', ')}`);
    // Both cards are waited for, each in its own column: the board draws them in one pass, but a slow runner (Windows CI, 24 Oct 2026) had the Applied card up before the Saved one.
    const where = [[BOARD.applied, 'Applied'], [BOARD.saved, 'Saved']];
    const inPlace = () => Promise.all(where.map(([url, stage]) => cardIn(url, stage)));
    await page.waitForFunction(pairs => pairs.every(([u, s]) => !!document.querySelector(`#jobs-board .board-column[data-stage="${s}"] .board-card[data-url="${u}"]`)), where, {timeout: 30000}).catch(() => {});   // the message below names the card that never came
    const placed = await inPlace();
    if (!placed.every(Boolean)) throw new Error(`a card is not in its column: ${where.filter((_, i) => !placed[i]).map(([url, stage]) => `${url} (not in ${stage})`).join(', ')}`);
  }, {data: true});

  await ctx.run('moving a card to Interviewing writes the stage and its event to the store, and it stays after a reload', async () => {
    await page.click(`#jobs-board .board-card[data-url="${BOARD.applied}"] button`);   // its ⋯ "Move to"
    await page.waitForSelector('.ui-menu');
    await page.evaluate(() => [...document.querySelectorAll('.ui-menu button, .ui-menu [role="menuitem"]')].find(item => item.textContent.trim() === 'Interviewing').click());
    await page.waitForFunction(u => !!document.querySelector(`#jobs-board .board-column[data-stage="Interviewing"] .board-card[data-url="${u}"]`), BOARD.applied, {timeout: 30000})
      .catch(async () => { throw new Error(`the card did not move: ${await page.evaluate(() => document.querySelector('.toast, #toast')?.textContent || 'no message')}`); });
    const row = storeCall(ctx, 'applications', 'get', {url: BOARD.applied});
    if (row?.stage !== 'Interviewing') throw new Error(`the store holds ${row?.stage}`);
    const events = storeCall(ctx, 'events', 'list', {app_id: row.id, kind: 'Interviewing'});
    if (!events?.length) throw new Error('no Interviewing event in the store');
    await settle();
    await goBoard();
    await page.waitForFunction(u => !!document.querySelector(`#jobs-board .board-column[data-stage="Interviewing"] .board-card[data-url="${u}"]`), BOARD.applied, {timeout: 30000})
      .catch(() => { throw new Error('after a reload the card is not in Interviewing'); });
  }, {data: true});
}
