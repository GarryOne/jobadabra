/* global document, window */
// Every Recent activity state in ONE demo window: each task's runs, one per state (fixtures/activity-states.json, fictional data only),
// newest first, so you click through them like real runs. node e2e/activity-states.mjs · Ctrl+C closes it. The cardstates suite checks them.
//   SHOTS=<folder>        save a picture of each state, its card scrolled to the end (-part2, -part3…), then the popup, the answers, Tune
//   ONLY=<regex>          only the states whose name matches (EXTRAS=1 keeps the popup/answers/Tune pictures)
//   DEMO_GOOGLE=off       Gmail disconnected now (the header, the schedule and the box follow the current connection)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DESKTOP, E2E, launch} from './lib/app.mjs';
import {openRunsList} from './lib/runs-list.mjs';

export const STATES = JSON.parse(fs.readFileSync(path.join(E2E, 'fixtures', 'activity-states.json'), 'utf8')).states;

// A demo profile whose run history is the states, a minute apart, and whose Focus holds the open "which job?" questions.
export async function openStates({google = 'on', visible = false} = {}) {
  const {focus} = JSON.parse(fs.readFileSync(path.join(E2E, 'fixtures', 'mail-states.json'), 'utf8'));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-activity-states-'));
  for (const file of fs.readdirSync(path.join(DESKTOP, 'demo'))) if (file !== 'jobs.json') fs.copyFileSync(path.join(DESKTOP, 'demo', file), path.join(profile, file));
  const now = Date.now();
  const runs = STATES.map(({run}, i) => { const at = new Date(now - (i + 1) * 60000).toISOString(); return {trigger: 'you', log: [], ...run, id: now - i, startedAt: at, endedAt: at}; });
  fs.writeFileSync(path.join(profile, 'runs.json'), JSON.stringify(runs, null, 1));
  const focusFile = path.join(profile, 'focus.json');
  const demoFocus = JSON.parse(fs.readFileSync(focusFile, 'utf8'));
  fs.writeFileSync(focusFile, JSON.stringify({...demoFocus, items: [...focus.open, ...demoFocus.items], answered_questions: focus.answered}, null, 1));
  if (visible) process.env.E2E_HIDDEN ??= '0';
  const session = await launch({profile, env: {JOB_PILOTTO_DEMO: '1', JOB_PILOTTO_DEMO_FOCUS: focusFile, ...(google === 'off' ? {JOB_PILOTTO_DEMO_GOOGLE: 'off'} : {})}});
  const {page} = session;
  await page.waitForSelector('.nav[data-view=focus]:not([hidden])', {timeout: 30000});
  await session.app.evaluate(({BrowserWindow}) => { BrowserWindow.getAllWindows()[0].setBounds({x: 40, y: 40, width: 1400, height: 940}); });
  await openRunsList(page);
  const rows = page.locator('#activity-recent li:not(.recent-group) button');
  // Select a state by name: its row, then the panel has drawn it.
  const select = async name => { await rows.nth(STATES.findIndex(state => state.name === name)).click(); await page.waitForTimeout(400); };
  const close = async () => { await session.app.close().catch(() => {}); fs.rmSync(profile, {recursive: true, force: true}); };
  return {session, page, rows, select, close};
}

// The card's text a person reads (header, box, steps, card), without the technical log, which may hold raw lines.
export const readable = page => page.evaluate(() => ['activity-selected', 'activity-status', 'activity-sub', 'activity-warnings', 'activity-phases', 'activity-card', 'activity-result']
  .map(id => document.getElementById(id)).filter(node => node && !node.hidden && node.offsetParent !== null).map(node => node.innerText).join('\n'));

// Shoot the window, then scroll the run's detail pane by a screen until its end.
async function shootScrolled(page, folder, name) {
  const pane = await page.evaluateHandle(() => { const node = document.querySelector('.ap-detail'); return node && node.scrollHeight > node.clientHeight + 4 ? node : null; });
  const has = await pane.evaluate(node => !!node);
  if (has) await pane.evaluate(node => { node.scrollTop = 0; });
  for (let part = 1; part <= 8; part++) {
    await page.waitForTimeout(300);
    await page.screenshot({path: path.join(folder, `${name}${part > 1 ? `-part${part}` : ''}.png`)});
    if (!has || !await pane.evaluate(node => { if (node.scrollTop + node.clientHeight >= node.scrollHeight - 2) return false; node.scrollTop = Math.min(node.scrollTop + node.clientHeight - 80, node.scrollHeight - node.clientHeight); return true; })) break;
  }
  if (has) await pane.evaluate(node => { node.scrollTop = 0; });
}

async function main() {
  const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null, folder = process.env.SHOTS;
  const {session, page, rows, close} = await openStates({google: process.env.DEMO_GOOGLE || 'on', visible: true});
  await session.app.evaluate(({BrowserWindow}) => { const win = BrowserWindow.getAllWindows()[0]; win.setTitle('Recent activity · every task, every state'); win.show(); win.focus(); });
  if (folder) {
    fs.mkdirSync(folder, {recursive: true});
    let n = STATES.length;
    const num = () => String(++n).padStart(2, '0');
    await page.screenshot({path: path.join(folder, '00-recent-activity--list-overview.png')});
    for (const [i, {name}] of STATES.entries()) if (!only || only.test(name)) { await rows.nth(i).click(); await page.waitForTimeout(700); await shootScrolled(page, folder, `${String(i + 1).padStart(2, '0')}-${name}`); }
    if (!only || process.env.EXTRAS) {
      // Gmail: the job picker, then answer the three questions three ways, so the card shows each answer.
      await rows.nth(0).click();
      await page.waitForTimeout(500);
      for (const [q, choice] of ['tracked', 'new', 'none'].entries()) {
        await page.locator('.mail-question-go').first().click();
        await page.waitForSelector('#reassign-dialog[open]', {timeout: 5000});
        if (q === 0) await page.screenshot({path: path.join(folder, `${num()}-gmail--which-job-popup-choose-the-job.png`)});
        await page.click(`#reassign-choices [value=${choice}]`);
        await page.click('#reassign-save');
        await page.waitForTimeout(700);
        if (q === 0) await shootScrolled(page, folder, `${num()}-gmail--1-of-3-answered-with-tracked-job-2-still-open`);
      }
      await shootScrolled(page, folder, `${num()}-gmail--all-3-answered-tracked-job-new-job-not-a-job`);
      // Tune my strategy is a dialog, not a run: its three states, drawn by its own code.
      await page.click('.nav[data-view=actions]').catch(() => {});
      for (const [name, answer] of [
        ['tune--dialog-3-proposals', {basis: {jobs: 142, dismissed: 96, engaged: 38, interviews: 5, min_dismissed: 5}, proposals: [
          {id: 'a', kind: 'drop_role', label: 'Software Engineer', dismissed: 31, engaged: 0}, {id: 'b', kind: 'drop_place', label: 'Paris', dismissed: 12, engaged: 0},
          {id: 'c', kind: 'exclude_title', label: 'Data', dismissed: 9, engaged: 0}]}],
        ['tune--dialog-nothing-to-change', {basis: {jobs: 40, dismissed: 22, engaged: 18, interviews: 2, min_dismissed: 5}, proposals: []}],
        ['tune--dialog-no-results-yet', {basis: {jobs: 0}, proposals: []}],
      ]) {
        await page.evaluate(async answer => {
          const {proposalRow, showBasis} = await import('./pages/tune.js');
          const $ = id => document.getElementById(id);
          showBasis(answer);
          $('tune-list').replaceChildren(...answer.proposals.map(proposalRow));
          for (const id of ['tune-apply', 'tune-cancel']) $(id).hidden = !answer.proposals.length;
          $('tune-list').dispatchEvent(new Event('change'));
          if (!$('tune-dialog').open) $('tune-dialog').showModal();
        }, answer);
        await page.waitForTimeout(300);
        await page.screenshot({path: path.join(folder, `${num()}-${name}.png`)});
      }
      await page.evaluate(async () => { document.getElementById('tune-dialog').close(); (await import('./pages/activity.js')).openActivity(true); });
      // A live run, mocked as the cardstates suite does (no engine): Queued behind a running search, its log streaming, scrolled up, finished.
      const live = async step => page.evaluate(async step => {
        const {shared} = await import('./pages/shared.js');
        const activity = await import('./pages/activity.js');
        const $ = id => document.getElementById(id);
        window.__live ??= {base: activity.lastActivity, id: Date.now() + 5000, at: new Date().toISOString()};
        const {base, id, at} = window.__live;
        const lines = n => ['Searching job boards…', 'Job boards: jobs.ch, SwissDevJobs', 'Checking employer career pages, then reading and scoring new jobs…', ...Array.from({length: n}, (_, i) => `Scored ${i + 1} of 60 job(s)`)];
        const running = {id, kind: 'search', trigger: 'you', where: 'mac', startedAt: at, step: 'Scored 40 of 60 job(s)'};
        shared.selectedRun = null;
        if (step === 'running') { shared.logLines = lines(40); activity.renderActivity({...base, running, queued: [{id: id + 1, kind: 'tailor', trigger: 'you', queuedAt: at}]}); $('log').scrollTop = $('log').scrollHeight; }
        if (step === 'scrolled') { $('log').scrollTop = 0; $('log').dispatchEvent(new Event('scroll')); shared.logLines = lines(52); activity.renderActivity({...activity.lastActivity}); }
        if (step === 'finished') {
          $('log').scrollTop = $('log').scrollHeight;
          activity.renderActivity({...base, running: null, queued: [], runs: [{...running, endedAt: new Date().toISOString(), ok: true, new: 2, found: 214, changed: 1, log: lines(60)}, ...base.runs]});
        }
      }, step);
      for (const [step, name] of [['running', 'live--running-log-streaming-tailor-queued'], ['scrolled', 'live--running-scrolled-up-jump-to-latest'], ['finished', 'live--finished-while-watched-log-kept-open']]) {
        await live(step);
        await page.waitForTimeout(500);
        await page.screenshot({path: path.join(folder, `${num()}-${name}.png`)});
      }
    }
    console.log(`Saved pictures in ${folder}`);
  }
  console.log(STATES.map(({name}, i) => `  ${i + 1}. ${name}`).join('\n'));
  if (process.env.EXIT) { await close(); return; }
  console.log('Window open. Ctrl+C closes it.');
  const stop = async () => { await close(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  await new Promise(() => {});
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
