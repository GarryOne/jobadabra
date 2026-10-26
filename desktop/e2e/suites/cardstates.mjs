/* global document, location */
// Every Recent activity state, checked in the real window on fictional data (fixtures/activity-states.json, the state viewer's): what a person
// reads, the actions each state offers, the technical log's defaults, and a live run from Queued to Running to Completed or Failed, driven by
// mocked activity data (no engine, no Notion, no AI). Owner, 6 Oct 2026: the redesigns of that day, kept from drifting back.
import {STATES, openStates, readable} from '../activity-states.mjs';

export const name = 'cardstates';
export const minutes = 4;
export const keepGoing = true;   // each step reports on its own: one broken state does not hide the others
export const light = true;   // its own demo window: no Notion page, no AI key, no browser

const RAW = /Traceback|\b[A-Z]\w*(?:Error|Exception)\b|Had problems|invalid_grant|\{'type':/;
const text = (page, selector) => page.locator(selector).first().innerText().catch(() => '');
const visible = (page, selector) => page.locator(`${selector}:visible`).count().then(count => count > 0);

export async function run(ctx) {
  let states = null;
  try {
    await ctx.run('every finished state reads in plain words, with its technical log folded', async () => {
      states = await openStates();
      const problems = [];
      for (const {name: state} of STATES) {
        await states.select(state);
        const words = await readable(states.page);
        const raw = RAW.exec(words);
        if (raw) problems.push(`${state}: shows "${raw[0]}"`);
        if (await states.page.evaluate(() => document.getElementById('activity-log').open)) problems.push(`${state}: the technical log is open`);
      }
      if (problems.length) throw new Error(problems.join('; '));
    });

    // Read with Claude follows Claude being ready (renderer/claude-help.js: Claude Code installed and signed in): off, a stopped site offers Open it myself only; on, Read with Claude too.
    await ctx.run('Find jobs using your browser: its card counts the sites and jobs; a stopped site offers Open it myself, and Read with Claude only with Claude help on', async () => {
      const {page, select} = states;
      // Claude help is "Claude Code installed and signed in" (renderer/claude-help.js, spec 2026-10-10 part 4): the step decides it, so the result does not depend on this machine.
      const claudeReady = async ready => {
        // The window asks the main process (the 'claudePrereqs' answer); this step is the one that says whether Claude Code is installed, so the result is the same on every machine.
        await states.session.app.evaluate(({ipcMain}, ready) => {
          ipcMain.removeHandler('claudePrereqs');
          ipcMain.handle('claudePrereqs', async () => ({claude: ready, signedIn: ready, windows: false, inApp: false}));
        }, ready);
        await page.evaluate(async () => { await (await import(new URL('claude-help.js', location.href).href)).refreshClaudeHelp(); });
      };
      await claudeReady(false);
      await select('visits--2-of-3-sites-read-1-stopped');
      const card = await text(page, '#activity-card');
      const problems = [];
      if (!/Read 2 of 3 sites · 116 jobs \(51 new\)/.test(card)) problems.push(`heading: "${card.split('\n').slice(0, 3).join(' / ')}"`);
      if (await page.locator('#activity-card .item-rows > li').count() !== 3) problems.push('not one row per site');
      const stopped = page.locator('#activity-card .item-rows > li.is-failed');
      if (!/Rolex/.test(await stopped.innerText().catch(() => ''))) problems.push('Rolex is not the stopped row');
      if (!await stopped.getByRole('button', {name: 'Open it myself'}).count()) problems.push('no "Open it myself" on the stopped site');
      if (await stopped.getByRole('button', {name: 'Read with Claude'}).count()) problems.push('"Read with Claude" shows with Claude help off');
      // Claude help on (this demo window only): the card drawn again offers Read with Claude beside Open it myself.
      await claudeReady(true);
      await select('tailor--3-of-5-partial');
      await select('visits--2-of-3-sites-read-1-stopped');
      const again = page.locator('#activity-card .item-rows > li.is-failed');
      // Claude's takeover is OFF (owner, 15 Oct 2026; 510d60c): Read with Claude is offered only where resumeOffered() says so, so even with Claude ready the stopped site offers Open it myself alone.
      if (!await again.getByRole('button', {name: 'Open it myself'}).count()) problems.push('Claude help on: no "Open it myself" on the stopped site');
      if (await again.getByRole('button', {name: 'Read with Claude'}).count()) problems.push('Claude help on: "Read with Claude" shows while the takeover is off');
      await claudeReady(false);   // back to the default for the steps after
      if (problems.length) throw new Error(problems.join('; '));
    });

    await ctx.run('a partial Tailor run: its counts, its row actions and its warning status agree', async () => {
      const {page, select} = states;
      await select('tailor--3-of-5-partial');
      const problems = [];
      // The result card's top no longer repeats the count as a heading (ffe56e3: one result card top for every run); the count is the run's line in the list, the card says what failed.
      if (!/Tailored 3 of 5 CVs, 2 failed/.test(await text(page, '#activity-recent .recent-row.current'))) problems.push('the run\'s line does not say "Tailored 3 of 5 CVs, 2 failed"');
      if (!/2 CVs could not be tailored/.test(await text(page, '#activity-card'))) problems.push('the card does not say "2 CVs could not be tailored"');
      const views = await page.locator('.kits-jobs li:not(.is-failed) button').count();
      const failed = await page.locator('.kits-jobs li.is-failed').count();
      if (views !== 3 || failed !== 2) problems.push(`${views} View CV and ${failed} Not tailored rows, for 3 and 2`);
      if (!/Completed with warnings/.test(await text(page, '#activity-status'))) problems.push('the header does not say Completed with warnings');
      if (!/With warnings/.test(await text(page, '#activity-recent li:not(.recent-group) button.current, #activity-recent button[aria-current]'))) {
        const row = await page.locator('#activity-recent li:not(.recent-group) button').nth(STATES.findIndex(state => state.name === 'tailor--3-of-5-partial')).innerText();
        if (!/With warnings/.test(row)) problems.push(`the list row says "${row.replace(/\s+/g, ' ')}"`);
      }
      if (problems.length) throw new Error(problems.join('; '));
    });

    await ctx.run('Gmail "which job?" answers: three questions open, then each answer its own saved outcome', async () => {
      const {page, select} = states;
      await select('gmail--7-emails-3-which-job-questions-open');
      // The count sits in the run's notes box (#activity-warnings: "N need your answer · Answer N questions"), not in the card, since the run view shares one result card top.
      if (!/3 need your answer/.test(await text(page, '#activity-warnings'))) throw new Error(`the count is not 3: "${(await text(page, '#activity-warnings')).slice(0, 200)}"`);
      for (const choice of ['tracked', 'new', 'none']) {
        await page.locator('.mail-question-go').first().click();
        await page.waitForSelector('#reassign-dialog[open]', {timeout: 5000});
        await page.click(`#reassign-choices [value=${choice}]`);
        await page.click('#reassign-save');
        await page.waitForTimeout(600);
      }
      const card = await text(page, '#activity-card');
      const missing = ['Linked to', 'Created a job for', 'Marked as not job-related'].filter(words => !card.includes(words));
      if (missing.length || /Not in my list yet/.test(card)) throw new Error(`missing ${missing.join(', ') || '—'}${/Not in my list yet/.test(card) ? '; the picker label shows as a job' : ''}`);
    });
    await states?.close();
    states = null;

    await ctx.run('Gmail connected now: past not-connected and revoked runs stay as history, without a button', async () => {
      states = await openStates({google: 'on'});
      const {page, select} = states;
      const problems = [];
      await select('gmail--gmail-not-connected');
      if (!/Gmail was not connected/.test(await text(page, '#activity-warnings'))) problems.push('the not-connected run does not say it was not connected then');
      if (await visible(page, '#activity-warnings-fix')) problems.push('it still offers a button to connect');
      await select('gmail--failed-google-signin-revoked');
      if (!/Gmail is connected now/.test(await text(page, '#activity-warnings'))) problems.push('the revoked run does not say Gmail is connected now');
      if (await visible(page, '#activity-warnings-fix')) problems.push('the revoked run still offers Reconnect Google');
      if ((await text(page, '#check-mail')) !== 'Check Gmail now') problems.push(`the header says "${await text(page, '#check-mail')}"`);
      await states.close();
      states = null;
      if (problems.length) throw new Error(problems.join('; '));
    });

    await ctx.run('Gmail disconnected now: one way to connect, and the schedule says it waits for it', async () => {
      states = await openStates({google: 'off'});
      const {page, select} = states;
      const problems = [];
      await select('gmail--gmail-not-connected');
      if ((await text(page, '#activity-warnings-fix')) !== 'Connect Gmail') problems.push('the box does not offer Connect Gmail');
      if (await visible(page, '#check-mail')) problems.push('the header offers a second button');
      if (!/Connection required/.test(await text(page, '#activity-schedule'))) problems.push('the schedule does not say Connection required');
      await select('gmail--failed-google-signin-revoked');
      if ((await text(page, '#activity-warnings-fix')) !== 'Reconnect Google') problems.push('the revoked run does not offer Reconnect Google');
      if (await visible(page, '#check-mail')) problems.push('the revoked run has a header button beside it');
      await select('gmail--nothing-new');
      if ((await text(page, '#check-mail')) !== 'Connect Gmail') problems.push(`a Gmail run's header says "${await text(page, '#check-mail')}" while Gmail is disconnected`);
      if (problems.length) throw new Error(problems.join('; '));
    });

    await ctx.run('a live run, mocked: Queued, then Running with its log open and Live, Jump to latest when scrolled up, then Completed keeps what you chose; reopened, folded', async () => {
      const problems = await states.page.evaluate(async () => {
        const {shared} = await import('./pages/shared.js');
        const activity = await import('./pages/activity.js');
        const $ = id => document.getElementById(id);
        const base = activity.lastActivity;
        const out = [];
        // Distinct lines, one per thing that happened: the log shows them in plain words (renderer/human-log.js), where 55 "Scored N of 60" progress lines
        // are ONE line, too short to scroll (7 Oct 2026: the step failed with "no Jump to latest" on Mac and Windows).
        const lines = n => Array.from({length: n}, (_, i) => `Reading employer site ${i + 1}: example${i + 1}.com`);
        const id = Date.now() + 1000, startedAt = new Date().toISOString();
        shared.selectedRun = null;
        activity.renderActivity({...base, running: null, queued: [{id: id - 1, kind: 'search', trigger: 'you', queuedAt: startedAt}]});
        if (!/Queued/.test($('activity-recent').innerText)) out.push('a queued run does not say Queued');
        shared.logLines = lines(40);
        activity.renderActivity({...base, queued: [], running: {id, kind: 'search', trigger: 'you', where: 'mac', startedAt, step: 'Scored 40 of 60 job(s)'}});
        if (!$('activity-log').open) out.push('the log of a running run is not open');
        if ($('log-live').hidden) out.push('no Live tag while it runs');
        $('log').scrollTop = 0;
        $('log').dispatchEvent(new Event('scroll'));
        shared.logLines = lines(55);
        activity.renderActivity({...activity.lastActivity});
        if ($('log').scrollTop > 5) out.push('new lines pulled the log down while the person read above');
        if ($('log-latest').hidden) out.push('no Jump to latest while scrolled up');
        $('log-latest').click();
        if ($('log').scrollHeight - $('log').scrollTop - $('log').clientHeight > 40) out.push('Jump to latest did not reach the newest line');
        activity.renderActivity({...activity.lastActivity, running: null, runs: [{id, kind: 'search', trigger: 'you', where: 'mac', startedAt, endedAt: new Date().toISOString(), ok: true, new: 2, log: lines(60)}, ...base.runs]});
        if (!$('activity-log').open) out.push('finishing while watched folded the log the person had open');
        if (!$('log-live').hidden) out.push('Live still shows after the run finished');
        shared.selectedRun = base.runs[0].id;
        activity.renderActivity({...activity.lastActivity});
        shared.selectedRun = id;
        activity.renderActivity({...activity.lastActivity});
        if ($('activity-log').open) out.push('reopened, a finished run’s log is open');
        // And a run that fails: Failed, its box, the log folded.
        shared.selectedRun = null;
        shared.logLines = ['Fetching feeds…', "KeyError: 'location'"];
        activity.renderActivity({...activity.lastActivity, running: {id: id + 1, kind: 'search', trigger: 'you', where: 'mac', startedAt, step: 'Fetching feeds…'}});
        $('activity-log').open = false;
        activity.renderActivity({...activity.lastActivity, running: null, runs: [{id: id + 1, kind: 'search', trigger: 'you', where: 'mac', startedAt, endedAt: new Date().toISOString(), ok: false, log: shared.logLines}, ...activity.lastActivity.runs]});
        if (!/Failed/.test($('activity-status').innerText)) out.push(`a failed run says "${$('activity-status').innerText}"`);
        if (!/stopped unexpectedly/.test($('activity-warnings').innerText)) out.push('a failed run without a reason has no box saying so');
        return out;
      });
      if (problems.length) throw new Error(problems.join('; '));
    });
  } finally {
    await states?.close();
  }
}
