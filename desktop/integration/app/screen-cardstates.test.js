/* global document, Event */
// Recent activity, layer 2: every finished state in plain words, the visits card, a partial Tailor run, the Gmail "which job?" answers, Gmail connected or not, and a live run.
// Moved from the e2e `cardstates` suite (1 Nov 2026): the same fictional states (e2e/fixtures/activity-states.json) in the app's demo window, no browser, no engine, no AI.
import assert from 'node:assert/strict';
import {before, test} from 'node:test';
import {STATES, activityKit, demoFocus, googleEnv, indexOf, stateFiles, withData} from './screen-activity-kit.js';
import {needsElectron} from '../../test/needs-electron.js';
import {probeWindow} from './window-probe.js';

const live = {skip: needsElectron.skip};
const NOW = Date.now();
const NAMES = Object.fromEntries(['visits--2-of-3-sites-read-1-stopped', 'tailor--3-of-5-partial', 'gmail--7-emails-3-which-job-questions-open', 'gmail--gmail-not-connected', 'gmail--failed-google-signin-revoked', 'gmail--nothing-new'].map(name => [name, indexOf(name)]));
let connected, disconnected;

before(() => {
  if (needsElectron.skip) return;
  const files = stateFiles(NOW, demoFocus());
  connected = probeWindow({files, use: [activityKit], timeout: 180000, script: withData({states: STATES.map(state => state.name), at: NAMES}, async (kit, {states, at}) => {
    await kit.until(() => document.querySelector('.nav[data-view=focus]:not([hidden])'), 'the menu');
    await kit.openRuns();
    const out = {};
    // Each section records its facts, or the error that stopped it, so one broken state does not hide the others.
    const section_ = async (target, name, read) => { try { target[name] = await read(); } catch (error) { target[name] = {error: error.message}; } };
    const RAW = /Traceback|\b[A-Z]\w*(?:Error|Exception)\b|Had problems|invalid_grant|\{'type':/;
    await section_(out, 'plain', async () => {
      const problems = [];
      for (const [index, state] of states.entries()) {
        await kit.select(index);
        const raw = RAW.exec(kit.readable());
        if (raw) problems.push(`${state}: shows "${raw[0]}"`);
        if (document.getElementById('activity-log').open) problems.push(`${state}: the technical log is open`);
      }
      return problems;
    });
    await section_(out, 'visits', async () => {
      await kit.select(at['visits--2-of-3-sites-read-1-stopped']);
      const stopped = document.querySelector('#activity-card .item-rows > li.is-failed');
      const buttons = [...(stopped?.querySelectorAll('button') || [])].map(button => button.textContent.trim());
      return {card: kit.text('#activity-card'), rows: document.querySelectorAll('#activity-card .item-rows > li').length, stopped: stopped?.innerText || '', buttons};
    });
    await section_(out, 'partial', async () => {
      await kit.select(at['tailor--3-of-5-partial']);
      return {line: kit.text('#activity-recent .recent-row.current'), card: kit.text('#activity-card'), views: document.querySelectorAll('.kits-jobs li:not(.is-failed) button').length,
        failed: document.querySelectorAll('.kits-jobs li.is-failed').length, status: kit.text('#activity-status')};
    });
    await section_(out, 'questions', async () => {
      await kit.select(at['gmail--7-emails-3-which-job-questions-open']);
      const count = kit.text('#activity-warnings');
      for (const [answered, choice] of ['tracked', 'new', 'none'].entries()) {
        // The next question is asked only once the card has drawn the previous answer (the picker closes before the save is shown).
        await kit.until(() => document.querySelectorAll('.mail-question-go').length === 3 - answered, `${3 - answered} open questions`);
        document.querySelector('.mail-question-go').click();
        await kit.until(() => document.getElementById('reassign-dialog').open, 'the job picker');
        document.querySelector(`#reassign-choices [value=${choice}]`).click();
        document.getElementById('reassign-save').click();
        await kit.until(() => !document.getElementById('reassign-dialog').open, 'the picker to close');
      }
      return {count, card: await kit.until(() => /Marked as not job-related/.test(kit.text('#activity-card')) && kit.text('#activity-card'), 'the third answer on the card')};
    });
    await section_(out, 'history', async () => {
      await kit.select(at['gmail--gmail-not-connected']);
      const notConnected = {warnings: kit.text('#activity-warnings'), button: kit.shown('#activity-warnings-fix')};
      await kit.select(at['gmail--failed-google-signin-revoked']);
      // The connection is asked of the main process after the window opens: the box and the header follow it once it has answered.
      await kit.until(() => /Gmail is connected now/.test(kit.text('#activity-warnings')), 'the revoked run to say Gmail is connected now');
      return {notConnected, revoked: {warnings: kit.text('#activity-warnings'), button: kit.shown('#activity-warnings-fix')}, header: kit.text('#check-mail')};
    });
    await section_(out, 'liveRun', async () => {
      const {shared} = await import('./pages/shared.js');
      const activity = await import('./pages/activity.js');
      const $ = id => document.getElementById(id);
      const base = activity.lastActivity, problems = [];
      const lines = n => Array.from({length: n}, (_, i) => `Reading employer site ${i + 1}: example${i + 1}.com`);
      const id = Date.now() + 1000, startedAt = new Date().toISOString();
      shared.selectedRun = null;
      activity.renderActivity({...base, running: null, queued: [{id: id - 1, kind: 'search', trigger: 'you', queuedAt: startedAt}]});
      if (!/Queued/.test($('activity-recent').innerText)) problems.push('a queued run does not say Queued');
      shared.logLines = lines(40);
      activity.renderActivity({...base, queued: [], running: {id, kind: 'search', trigger: 'you', where: 'mac', startedAt, step: 'Scored 40 of 60 job(s)'}});
      if (!$('activity-log').open) problems.push('the log of a running run is not open');
      if ($('log-live').hidden) problems.push('no Live tag while it runs');
      $('log').scrollTop = 0;
      $('log').dispatchEvent(new Event('scroll'));
      shared.logLines = lines(55);
      activity.renderActivity({...activity.lastActivity});
      if ($('log').scrollTop > 5) problems.push('new lines pulled the log down while the person read above');
      if ($('log-latest').hidden) problems.push('no Jump to latest while scrolled up');
      $('log-latest').click();
      if ($('log').scrollHeight - $('log').scrollTop - $('log').clientHeight > 40) problems.push('Jump to latest did not reach the newest line');
      activity.renderActivity({...activity.lastActivity, running: null, runs: [{id, kind: 'search', trigger: 'you', where: 'mac', startedAt, endedAt: new Date().toISOString(), ok: true, new: 2, log: lines(60)}, ...base.runs]});
      if (!$('activity-log').open) problems.push('finishing while watched folded the log the person had open');
      if (!$('log-live').hidden) problems.push('Live still shows after the run finished');
      shared.selectedRun = base.runs[0].id;
      activity.renderActivity({...activity.lastActivity});
      shared.selectedRun = id;
      activity.renderActivity({...activity.lastActivity});
      if ($('activity-log').open) problems.push('reopened, a finished run’s log is open');
      shared.selectedRun = null;
      shared.logLines = ['Fetching feeds…', "KeyError: 'location'"];
      activity.renderActivity({...activity.lastActivity, running: {id: id + 1, kind: 'search', trigger: 'you', where: 'mac', startedAt, step: 'Fetching feeds…'}});
      $('activity-log').open = false;
      activity.renderActivity({...activity.lastActivity, running: null, runs: [{id: id + 1, kind: 'search', trigger: 'you', where: 'mac', startedAt, endedAt: new Date().toISOString(), ok: false, log: shared.logLines}, ...activity.lastActivity.runs]});
      if (!/Failed/.test($('activity-status').innerText)) problems.push(`a failed run says "${$('activity-status').innerText}"`);
      if (!/stopped unexpectedly/.test($('activity-warnings').innerText)) problems.push('a failed run without a reason has no box saying so');
      return problems;
    });
    return out;
  })});
  disconnected = probeWindow({files, use: [activityKit], env: googleEnv('off'), script: withData({at: NAMES}, async (kit, {at}) => {
    await kit.until(() => document.querySelector('.nav[data-view=focus]:not([hidden])'), 'the menu');
    await kit.openRuns();
    await kit.select(at['gmail--gmail-not-connected']);
    await kit.until(() => /Connection required/.test(kit.text('#activity-schedule')), 'the schedule to follow the Gmail connection');
    const notConnected = {fix: kit.text('#activity-warnings-fix'), header: kit.shown('#check-mail'), schedule: kit.text('#activity-schedule')};
    await kit.select(at['gmail--failed-google-signin-revoked']);
    const revoked = {fix: kit.text('#activity-warnings-fix'), header: kit.shown('#check-mail')};
    await kit.select(at['gmail--nothing-new']);
    return {notConnected, revoked, mailHeader: kit.text('#check-mail')};
  })});
});

const facts = name => { const value = connected.result[name]; assert.equal(value?.error, undefined, `${name}: ${value?.error}`); return value; };

test('every finished state reads in plain words, with its technical log folded', live, () => {
  assert.deepEqual(facts('plain'), []);
  assert.ok(STATES.length >= 30, 'the fixture lost its states');
});

test('Find jobs using your browser: its card counts the sites and jobs; a stopped site offers Open it myself and not Read with Claude (Claude takeover is off, owner 15 Oct 2026)', live, () => {
  const {card, rows, stopped, buttons} = facts('visits');
  assert.match(card, /Read 2 of 3 sites · 116 jobs \(51 new\)/);
  assert.equal(rows, 3, 'not one row per site');
  assert.match(stopped, /Rolex/, 'Rolex is not the stopped row');
  assert.ok(buttons.includes('Open it myself'), 'no "Open it myself" on the stopped site');
  assert.equal(buttons.includes('Read with Claude'), false, '"Read with Claude" shows while the takeover is off');
});

test('a partial Tailor run: its counts, its row actions and its warning status agree', live, () => {
  const {line, card, views, failed, status} = facts('partial');
  assert.match(line, /Tailored 3 of 5 CVs, 2 failed/);
  assert.match(card, /2 CVs could not be tailored/);
  assert.deepEqual([views, failed], [3, 2], 'View CV and Not tailored rows, for 3 and 2');
  assert.match(status, /Completed with warnings/);
});

test('Gmail "which job?" answers: three questions open, then each answer its own saved outcome', live, () => {
  const {count, card} = facts('questions');
  assert.match(count, /3 need your answer/);
  for (const words of ['Linked to', 'Created a job for', 'Marked as not job-related']) assert.ok(card.includes(words), `the card lacks "${words}": ${card}`);
  assert.doesNotMatch(card, /Not in my list yet/, 'the picker label shows as a job');
});

test('Gmail connected now: past not-connected and revoked runs stay as history, without a button', live, () => {
  const {notConnected, revoked, header} = facts('history');
  assert.match(notConnected.warnings, /Gmail was not connected/);
  assert.equal(notConnected.button, false, 'the not-connected run still offers a button to connect');
  assert.match(revoked.warnings, /Gmail is connected now/);
  assert.equal(revoked.button, false, 'the revoked run still offers Reconnect Google');
  assert.equal(header, 'Check Gmail now');
});

test('Gmail disconnected now: one way to connect, and the schedule says it waits for it', live, () => {
  const {notConnected, revoked, mailHeader} = disconnected.result;
  assert.equal(notConnected.fix, 'Connect Gmail');
  assert.equal(notConnected.header, false, 'the header offers a second button');
  assert.match(notConnected.schedule, /Connection required/);
  assert.equal(revoked.fix, 'Reconnect Google');
  assert.equal(revoked.header, false, 'the revoked run has a header button beside it');
  assert.equal(mailHeader, 'Connect Gmail');
});

test('a live run, mocked: Queued, then Running with its log open and Live, Jump to latest when scrolled up, then Completed keeps what you chose; reopened, folded', live, () => {
  assert.deepEqual(facts('liveRun'), []);
});
