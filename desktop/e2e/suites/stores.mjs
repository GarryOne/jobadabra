/* global document, window */
// The store setting (docs/superpowers/specs/2026-10-09-store-adapters.md): an app on the SQLite store tracks with no Notion at all, and one with no
// store chosen behaves as before (D7: "trying" still asks to connect). No Notion page and no token: `notion = false`. The steps that need the
// engine's callers on the store (a saved job in the Jobs list, an interview) and "Move my data to Notion" come as those pieces land.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {TABS} from '../../renderer/job-page-view.js';
import {goView} from '../lib/go-view.mjs';
import {showFilter} from '../lib/jobs-filter.mjs';

export const name = 'stores';
export const notion = false;
export const keepGoing = true;
export const minutes = 6;

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
  // Interviews is a view that asks for Notion in "trying" (Focus shows "Get started" there since 396d94e).
  const goInterviews = async () => { await goView(page, 'interviews'); await page.waitForSelector('.view[data-view="interviews"]:not([hidden])'); };
  const gateShown = () => page.evaluate(() => !!document.querySelector('.view[data-view="interviews"] .notion-gate-host')?.children.length);
  const settle = async () => { await page.reload(); await page.waitForSelector('.view:not([hidden])', {timeout: 60000}); };

  await ctx.run('the app is set up on the SQLite store, with no Notion token', async () => {
    await page.evaluate(async key => {
      await window.pilot.saveSecret('ANTHROPIC_API_KEY', key);
      await window.pilot.saveSettings({setupDone: true, wizardStep: 'extras', setupFurthest: 'extras', store: 'sqlite'});
    }, KEY);
    await settle();
    const settings = JSON.parse(fs.readFileSync(path.join(ctx.profile, 'settings.json'), 'utf8'));
    if (settings.store !== 'sqlite') throw new Error(`the setting did not stick: store=${JSON.stringify(settings.store)}`);   // the positive control
  }, {critical: true});

  await ctx.run('Interviews opens without asking to connect Notion', async () => {
    await goInterviews();
    if (await gateShown()) throw new Error('Interviews shows the Notion gate on the SQLite store');
  });

  await ctx.run('a remembered answer is kept in this Mac\'s answers.md', async () => {
    const result = await page.evaluate(() => window.pilot.rememberAnswer('What is your notice period?', 'Three months, negotiable'));
    if (result?.needsNotion) throw new Error(`the app asked for Notion: ${result.text}`);
    if (result && result.ok === false) throw new Error(`rememberAnswer failed: ${result.text || JSON.stringify(result)}`);
    const file = path.join(ctx.profile, 'answers.md');
    const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    if (!text.includes('Three months, negotiable')) throw new Error(`answers.md does not hold the answer (${text.length} characters)`);
  });

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
  });

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
  });

  await ctx.run('a saved view chip narrows the list: Saved shows the saved application only', async () => {
    await page.click('[data-mode="list"]');
    await showFilter(page, 'saved');   // the step keeps its old name: the chip is now the Show menu's Saved item
    const urls = await page.evaluate(() => [...document.querySelectorAll('#jobs-body .job-row')].map(row => row.dataset.url));
    if (urls.length !== 1 || urls[0] !== BOARD.saved) throw new Error(`the Saved view lists ${JSON.stringify(urls)}`);
    await showFilter(page, 'everything');   // off again: the next steps see the whole list
  });

  // Jobs → a job's page (pages/job-panel.js, P8 A): the store's sections and events of one application, read through the engine, no Notion.
  const PANEL = 'https://jobs.example.test/panel-job';
  const KIT = '### ✉️ Cover letter\n\nDear Example team,\n\n### Machine-readable kit\n\n```json\n' +
    JSON.stringify({cover_letter: 'Dear Example team,\n\nE2E panel letter.', answers: [{question: 'Notice period', answer: 'E2E three months', needs_review: false}],
      check_before_sending: [], highlights: []}) + '\n```';
  await ctx.run('a job\'s page shows its kit, prep and history from the store', async () => {
    const app = storeCall(ctx, 'applications', 'create', {job: {url: PANEL, title: 'Panel Test Engineer', company: 'Example Panel Co', applied_on: today}, stage: 'Applied'});
    storeCall(ctx, 'applications', 'set_section', {app_id: app.id, name: '📝 Application kit', markdown: KIT});
    storeCall(ctx, 'applications', 'set_section', {app_id: app.id, name: '🎤 Interview prep', markdown: '### Ask them\n\n- E2E who is on call?'});
    storeCall(ctx, 'events', 'add', {app_id: app.id, kind: 'Applied', at: today, note: 'E2E applied with the extension'});
    if (!storeCall(ctx, 'applications', 'sections', {app_id: app.id})?.['📝 Application kit']) throw new Error('the kit section did not reach the store');   // the positive control
    await settle();
    await page.click('.nav[data-view="jobs"]');
    await page.waitForSelector('.view[data-view="jobs"]:not([hidden])');
    await showFilter(page, 'everything');
    await page.waitForSelector(`#jobs-body .job-row[data-url="${PANEL}"]`, {timeout: 30000})
      .catch(() => { throw new Error('the store\'s application is not in the Jobs list'); });
    await page.evaluate(u => document.querySelector(`#jobs-body .job-row[data-url="${u}"]`).click(), PANEL);   // the row itself (its .meta shows only when compact)
    await page.waitForSelector('#job-panel:not([hidden]) [data-job-tab]', {timeout: 30000})
      .catch(async () => { throw new Error(`the job page has no tabs: ${await page.evaluate(() => document.getElementById('job-panel')?.textContent.slice(0, 200))}`); });
    const tabs = await page.evaluate(() => [...document.querySelectorAll('#job-panel [data-job-tab]')].map(tab => tab.dataset.jobTab));
    if (tabs.join() !== TABS.map(([key]) => key).join()) throw new Error(`tabs: ${tabs.join()}`);
    // A tab fills in after its click (a loading skeleton first: 12 Oct 2026 the slower Windows runner read the page text while it still showed it), so each check waits for its words.
    const shown = async (tab, words) => {
      await page.click(`#job-panel [data-job-tab="${tab}"]`);
      await page.waitForFunction(text => document.getElementById('job-panel')?.textContent.includes(text), words, {timeout: 20000}).catch(() => {});
      return page.evaluate(() => document.getElementById('job-panel').textContent);
    };
    for (const [tab, words] of [['application', 'E2E three months'], ['application', 'E2E who is on call?'], ['timeline', 'E2E applied with the extension']]) {   // Kit and Prep live in Application, History is the Timeline (job drawer, 10 Oct 2026)
      if (!(await shown(tab, words)).includes(words)) throw new Error(`${tab} does not show "${words}"`);
    }
    if (await page.evaluate(() => !!document.querySelector('#job-panel button.link')?.textContent.includes('Notion'))) throw new Error('"Open in Notion" on the SQLite store');
  });

  // Reports (pages/reports.js, P8 D): the store's insights, a feedback that stays, and the funnel from the store's applications.
  await ctx.run('Reports shows the weekly report and the insights; a feedback is kept in the store and after a reload', async () => {
    storeCall(ctx, 'insights', 'add', {record: {day: today, category: 'Weekly report', title: 'E2E quiet week', body: '### Change next week\n\n- E2E send the drafted kits', fields: {confidence: 'Low'}}});
    const daily = storeCall(ctx, 'insights', 'add', {record: {day: today, category: 'Timing', title: 'E2E replies come fast', fields: {evidence: 'E2E 3 of 4 within 2 days', action: 'E2E follow up on day 3'}}});
    await settle();
    await goView(page, 'reports');
    await page.waitForSelector('.view[data-view="reports"]:not([hidden])');
    await page.waitForFunction(() => document.getElementById('reports-body')?.textContent.includes('E2E quiet week'), null, {timeout: 30000})
      .catch(async () => { throw new Error(`Weekly: ${await page.evaluate(() => document.getElementById('reports-body')?.textContent.slice(0, 200))}`); });
    if (!(await page.evaluate(() => document.getElementById('reports-body').textContent)).includes('E2E send the drafted kits')) throw new Error('the report\'s body is not shown');
    await page.click('[data-reports-tab="insights"]');
    await page.waitForFunction(() => document.getElementById('reports-body')?.textContent.includes('E2E replies come fast'), null, {timeout: 15000});
    await page.evaluate(() => [...document.querySelectorAll('#reports-body .segmented button')].find(button => button.textContent === 'Acting on it').click());
    await page.waitForFunction(() => document.getElementById('reports-state')?.textContent.includes('Feedback saved'), null, {timeout: 30000})
      .catch(async () => { throw new Error(`feedback: ${await page.evaluate(() => document.getElementById('reports-state')?.textContent)}`); });
    const kept = storeCall(ctx, 'insights', 'list', {}).find(row => row.id === daily.id);
    if (kept?.fields?.feedback !== 'Acting on it' || kept.fields.evidence !== 'E2E 3 of 4 within 2 days') throw new Error(`the store holds ${JSON.stringify(kept?.fields)}`);
    await settle();
    await goView(page, 'reports');
    await page.click('[data-reports-tab="insights"]');
    await page.waitForFunction(() => [...document.querySelectorAll('#reports-body .segmented button.is-active')].some(button => button.textContent === 'Acting on it'), null, {timeout: 30000})
      .catch(() => { throw new Error('after a reload the feedback is not shown'); });
  });

  await ctx.run('Reports → Funnel shows the Pipeline table from the store\'s applications', async () => {
    await page.click('[data-reports-tab="funnel"]');
    await page.waitForSelector('#reports-body table.data-table', {timeout: 60000})
      .catch(async () => { throw new Error(`Funnel: ${await page.evaluate(() => document.getElementById('reports-body')?.textContent.slice(0, 200))}`); });
    const table = await page.evaluate(() => [...document.querySelectorAll('#reports-body tr')].map(row => [...row.children].map(cell => cell.textContent.trim())));
    if (table[0].join('|') !== 'Step|Reached|From previous|Of applied|Still open here') throw new Error(`head: ${table[0].join('|')}`);
    const applied = table.find(row => /Applied/.test(row[0]));
    if (!applied || Number(applied[1]) < 2) throw new Error(`Applied row: ${JSON.stringify(applied)} (the store has the board's and the panel's applications)`);
  });

  await ctx.run('with no store chosen and no Notion, Interviews still asks to connect (no change for anyone)', async () => {
    await page.evaluate(() => window.pilot.saveSettings({store: null}));
    await settle();
    await goInterviews();
    await page.waitForFunction(() => !!document.querySelector('.view[data-view="interviews"] .notion-gate-host')?.children.length, null, {timeout: 15000})
      .catch(() => { throw new Error('without a store chosen, Interviews no longer shows the Notion gate'); });
  });
}
