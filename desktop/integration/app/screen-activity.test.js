/* global document, window */
// Recent activity, layer 2: the Actions page's Recent runs, the run filter, a finished run's result card and Technical log, the pop-up that opens a run, a run whose message
// is on its Notion page only, and a run read only from Notion. Moved from the e2e `activity` suite (1 Nov 2026) on the demo window with runs written for the purpose.
// The three steps that PRESS Find jobs, Check Gmail and Analyze and wait for the real run stay in e2e (a real run, a real store).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {before, test} from 'node:test';
import {badSummary, leaks} from '../../e2e/lib/activity.mjs';
import {activityKit} from './screen-activity-kit.js';
import {needsElectron} from '../../test/needs-electron.js';
import {probeWindow} from './window-probe.js';

const live = {skip: needsElectron.skip};
const demo = name => JSON.parse(fs.readFileSync(new URL(`../../demo/${name}`, import.meta.url), 'utf8'));
const NOW = Date.now();
const at = minutes => new Date(NOW - minutes * 60000).toISOString();
const weekly = (id, minutes, fields) => ({id, kind: 'weekly', trigger: 'you', where: 'mac', ok: true, startedAt: at(minutes), endedAt: at(minutes), ...fields});
const REPORT = '📊 Search analysis\nLast 7 days\nFinding: Replies come mostly from referrals, not from direct applications.\nChange next week\n• Ask two people for an introduction';
// Three Search analysis runs besides the demo's: one with its message and log on this Mac; one sent to Telegram (no message here, a log of its own, the report on its Notion
// page); one that exists only in Notion (no record on this Mac: the page brings its result and its log).
const RUNS = [
  weekly(NOW, 1, {summary: 'Kept on this Mac', message: REPORT, log: ['Search analysis: reading 9 applications', 'Search analysis: done']}),
  weekly(NOW - 1, 2, {summary: 'Sent to Telegram', pageId: 'page-sent', log: ['Search analysis ran on this Mac']}),
  weekly(NOW - 2, 3, {summary: 'Read from Notion', pageId: 'page-only'}),
  ...demo('runs.json'),
];
const PAGES = {
  'page-sent': {message: REPORT.replace('referrals', 'introductions'), log: ['Reading employer site 1: sent.example.com'], report: []},
  'page-only': {message: REPORT.replace('referrals', 'colleagues'), log: ['Reading employer site 1: only-in-notion.example.com', 'Reading employer site 2: example2.com'], report: []},
};
let seen;

before(() => {
  if (needsElectron.skip) return;
  seen = probeWindow({files: {'runs.json': RUNS, 'run-pages.json': PAGES}, use: [activityKit], timeout: 180000, script: async kit => {
    await kit.until(() => document.querySelector('.nav[data-view=focus]:not([hidden])'), 'the menu');
    const out = {};
    const section = async (name, read) => { try { out[name] = await read(); } catch (error) { out[name] = {error: error.message}; } };
    const log = () => document.getElementById('log')?.textContent || '';
    const panel = () => ({message: kit.text('#activity-message'), card: kit.text('#activity-card'), result: kit.text('#activity-result'), log: log()});
    await section('rows', async () => {
      await kit.go('actions');
      await kit.until(() => document.querySelectorAll('#runs-table .runs-row').length, 'the Recent runs rows');
      return [...document.querySelectorAll('#runs-table .runs-row')].map(row => ({kind: row.querySelector('b')?.textContent || '', pill: row.querySelector('.ui-pill, .pill')?.textContent?.trim() || '', result: row.querySelector('.runs-result')?.textContent?.trim() || ''}));
    });
    await section('filter', async () => {
      await kit.openRuns();
      const rowKinds = () => kit.rows().map(row => row.querySelector('.run-kind')?.textContent || '');
      const all = rowKinds();
      const count = kit.text('#activity-count').trim();
      const pick = async pattern => {
        document.getElementById('activity-filter').click();
        const entries = await kit.until(() => { const found = [...document.querySelectorAll('.ui-menu button')]; return found.length && found; }, 'the filter menu');
        const names = entries.map(entry => entry.textContent.trim());
        entries.find(entry => pattern.test(entry.textContent.trim()))?.dispatchEvent(new window.MouseEvent('click', {bubbles: true}));
        return names;
      };
      const entries = await pick(/^Gmail check/);
      await kit.until(() => rowKinds().length && rowKinds().every(kind => kind === 'Gmail check'), 'only Gmail checks to be listed');
      const mailOnly = rowKinds();
      await pick(/^(✓ )?Any task/);
      await kit.until(() => rowKinds().length >= all.length, 'every run to be back');
      return {count, entries, all, mailOnly, back: rowKinds().length};
    });
    await section('result', async () => {
      await kit.selectWhere('Kept on this Mac');
      return await kit.until(() => { const now = panel(); return now.log.includes('reading 9 applications') && now; }, 'the run\'s result card and log');
    });
    await section('sent', async () => {
      await kit.selectWhere('Sent to Telegram');
      return await kit.until(() => { const now = panel(); return /introductions/.test(`${now.message} ${now.card}`) && now; }, 'the report from the Notion page');
    });
    await section('only', async () => {
      await kit.selectWhere('Read from Notion');
      return await kit.until(() => { const now = panel(); return /colleagues/.test(`${now.message} ${now.card}`) && /only-in-notion/.test(now.log) && now; }, 'the report and the log from the Notion page');
    });
    await section('popup', async () => {
      const activity = await import('./pages/activity.js');
      const {announceRuns} = await import('./pages/activity-panel.js');
      await kit.selectWhere('Kept on this Mac');
      const before = kit.text('#activity-selected').replace(/\s+/g, ' ').trim();
      // The run ends while the panel shows an older one: the app announces it (its poll does this), and the pop-up's click is the only thing that switches the panel.
      const mail = {id: Date.now() + 5, kind: 'mail', trigger: 'you', where: 'mac', ok: true, startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), summary: 'Mail: 2 new email(s) classified', log: ['Gmail: done']};
      announceRuns({running: null, runs: activity.lastActivity.runs});   // the baseline the poll keeps
      const runs = [mail, ...activity.lastActivity.runs];
      activity.renderActivity({...activity.lastActivity, runs});
      announceRuns({running: null, runs});
      const toast = await kit.until(() => [...document.querySelectorAll('.toast.toast-link')].find(one => /Gmail check/i.test(one.textContent)), 'the Gmail pop-up');
      toast.click();
      const after = await kit.until(() => /Gmail check/i.test(kit.text('#activity-selected')) && kit.text('#activity-selected').replace(/\s+/g, ' ').trim(), 'the panel to show the announced run');
      return {before, after};
    });
    out.severe = {actions: (await kit.go('actions'), kit.severe('actions'))};
    return out;
  }});
});

const facts = name => { const value = seen.result[name]; assert.equal(value?.error, undefined, `${name}: ${value?.error}`); return value; };

test('the Actions page lists Recent runs: a kind, an end and a result in plain words for each', live, () => {
  const rows = facts('rows');
  assert.ok(rows.length >= 3, `only ${rows.length} rows`);
  for (const row of rows) {
    assert.ok(row.kind, 'a row without its task name');
    assert.equal(badSummary(row.result), '', `${row.kind}: ${row.result}`);
    assert.ok(row.pill, `${row.kind} has no end`);
  }
  assert.ok(rows.some(row => row.kind === 'Search analysis'), `kinds: ${rows.map(row => row.kind)}`);
});

test('the link to all runs opens Actions → Runs, and its task filter keeps one kind of run at a time', live, () => {
  const {count, entries, all, mailOnly, back} = facts('filter');
  assert.match(count, /^\d+$/, 'Runs does not count its runs');
  for (const wanted of ['Find jobs', 'Gmail check', 'Search analysis']) assert.ok(entries.some(entry => entry.replace(/^✓ /, '').startsWith(`${wanted} ·`)), `the filter has no "${wanted}" entry: ${entries.join(' | ')}`);
  assert.ok(mailOnly.length > 0 && mailOnly.every(kind => kind === 'Gmail check'), `the Gmail filter shows: ${mailOnly.join(', ') || 'nothing'}`);
  assert.ok(back >= all.length, '"Any task" did not bring the other runs back');
});

test('opening a finished run shows its result card and its Technical log', live, () => {
  const {message, card, result, log} = facts('result');
  const words = `${message} ${card} ${result}`.trim();
  assert.ok(words.length >= 20, `the finished search analysis shows no result ("${words}")`);
  assert.equal(badSummary(words.slice(0, 200)), '');
  assert.match(log, /reading 9 applications/);
});

test('clicking the pop-up of a finished task opens that task\'s result in Recent activity', live, () => {
  const {before, after} = facts('popup');
  assert.doesNotMatch(before, /Gmail check/i, 'the test could not open an older run first');
  assert.match(after, /Gmail check/i);
});

test('a run recorded on this Mac without its message still shows its result from the Notion page, and keeps its own log', live, () => {
  const {message, card, log} = facts('sent');
  assert.ok(`${message} ${card}`.trim().length >= 20, 'a local run without its message opens to no result: its Notion page is not read');
  assert.match(log, /Search analysis ran on this Mac/, 'reading the Notion page replaced the run\'s own log');
});

test('a run read only from Notion (no local record) still shows its log, without a leak', live, () => {
  const {log} = facts('only');
  assert.match(log, /only-in-notion\.example\.com/, 'the log of the Notion page is not shown');
  assert.doesNotMatch(log, /^(Nothing to show yet|No log for this run)/);
  assert.deepEqual(leaks(log, {dirs: [process.cwd(), process.env.HOME]}), []);
});

test('the Actions page and Recent runs render without layout problems', live, () => {
  assert.deepEqual(facts('severe').actions, []);
});
