/* global document, window */
// The SQLite store on screen, layer 2: what the engine reads from this Mac's store is what the window draws, with no Notion token and no browser. Moved from the e2e `stores` suite
// (1 Nov 2026). Records are written through the store's own commands (src.stores), read back by the app's own modules (lib/job-page-handlers.js, lib/reports-handlers.js) and the
// engine's Jobs list and Focus payloads, and the demo window draws those. What STAYS in e2e: the board's stage columns and moving a card (a write through the real app), and the
// remembered answer (it asks the AI). Interviews' Notion gate is the main process's, so it is tested here as the function it is (lib/notion-gate.js).
import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {check as gate} from '../../lib/notion-gate.js';
import {jobCore, jobRest} from '../../lib/job-page-handlers.js';
import {insightsList, setFeedback} from '../../lib/reports-handlers.js';
import {TABS} from '../../renderer/job-page-view.js';
import {needsElectron} from '../../test/needs-electron.js';
import {newStore} from './screen-store.js';
import {probeWindow} from './window-probe.js';

const live = {skip: needsElectron.skip};
const today = new Date().toISOString().slice(0, 10);
const URLS = {applied: 'https://jobs.example.test/board-applied', saved: 'https://jobs.example.test/board-saved', panel: 'https://jobs.example.test/panel-job'};
const KIT = '### ✉️ Cover letter\n\nDear Example team,\n\n### Machine-readable kit\n\n```json\n' +
  JSON.stringify({cover_letter: 'Dear Example team,\n\nE2E panel letter.', answers: [{question: 'Notice period', answer: 'E2E three months', needs_review: false}], check_before_sending: [], highlights: []}) + '\n```';
let store, call, jobs, page, reports, afterFeedback, focus, kept, window1, window2;

before(async () => {
  store = newStore();
  const storage = {settings: () => ({store: 'sqlite'}), secret: () => ''};
  call = async (_, entity, method, kwargs) => store.call(entity, method, kwargs);
  store.call('applications', 'create', {job: {url: URLS.applied, title: 'Board Test Engineer', company: 'Example Board Co', applied_on: today}, stage: 'Applied'});
  store.call('applications', 'create', {job: {url: URLS.saved, title: 'Board Saved Engineer', company: 'Example Board Co'}, stage: 'Saved'});
  const app = store.call('applications', 'create', {job: {url: URLS.panel, title: 'Panel Test Engineer', company: 'Example Panel Co', applied_on: today}, stage: 'Applied'});
  store.call('applications', 'set_section', {app_id: app.id, name: '📝 Application kit', markdown: KIT});
  store.call('applications', 'set_section', {app_id: app.id, name: '🎤 Interview prep', markdown: '### Ask them\n\n- E2E who is on call?'});
  store.call('events', 'add', {app_id: app.id, kind: 'Applied', at: today, note: 'E2E applied with the extension'});
  store.call('insights', 'add', {record: {day: today, category: 'Weekly report', title: 'E2E quiet week', body: '### Change next week\n\n- E2E send the drafted kits', fields: {confidence: 'Low'}}});
  const daily = store.call('insights', 'add', {record: {day: today, category: 'Timing', title: 'E2E replies come fast', fields: {evidence: 'E2E 3 of 4 within 2 days', action: 'E2E follow up on day 3'}}});
  jobs = store.engine('src.desktop', 'jobs');
  focus = store.engine('src.focus');
  const core = await jobCore(storage, URLS.panel, {call, links: false, placesNow: async () => null});
  page = {app: core.app, match: core.match, ...await jobRest(storage, app.id, {call})};
  reports = await insightsList(storage, {call});
  const saved = await setFeedback(storage, daily.id, 'Acting on it', {call});
  assert.equal(saved.ok, true, 'the feedback was refused');
  kept = store.call('insights', 'list', {}).find(row => row.id === daily.id);
  afterFeedback = await insightsList(storage, {call});
  if (needsElectron.skip) return;
  const base = {settings: {store: 'sqlite', lastSearchAt: new Date().toISOString()}, timeout: 180000};
  window1 = probeWindow({...base, files: {'jobs.json': jobs, 'job-pages.json': {[URLS.panel]: page}, 'reports.json': reports, 'focus.json': focus}, script: async kit => {
    await kit.until(() => document.querySelector('.nav[data-view=focus]:not([hidden])'), 'the menu');
    const out = {};
    const section = async (name, read) => { try { out[name] = await read(); } catch (error) { out[name] = {error: error.message}; } };
    const showFilter = async id => {
      document.getElementById('filter-status').click();
      const checked = await kit.until(() => { const found = [...document.querySelectorAll('.ui-multi [aria-checked="true"]')]; return found.length && found.map(node => node.dataset.id); }, 'the Show menu');
      if (!checked.includes(id)) document.querySelector(`.ui-multi [data-id="${id}"]`).click();
      for (const other of checked) if (other !== id) document.querySelector(`.ui-multi [data-id="${other}"]`).click();
      document.dispatchEvent(new window.KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
    };
    const rowUrls = () => [...document.querySelectorAll('#jobs-body .job-row')].map(row => row.dataset.url);
    await section('saved', async () => {
      await kit.go('jobs');
      await kit.until(() => document.getElementById('filter-status')?.offsetParent && !document.querySelector('#jobs-body .list-loading'), 'the Jobs list');
      await showFilter('saved');
      const only = await kit.until(() => { const urls = rowUrls(); return urls.length === 1 && urls; }, 'the Saved view to list one job');
      await showFilter('everything');
      const all = await kit.until(() => { const urls = rowUrls(); return urls.length >= 3 && urls; }, 'the whole list to come back');
      return {only, all};
    });
    await section('panel', async () => {
      document.querySelector(`#jobs-body .job-row[data-url="${out.panelUrl || 'https://jobs.example.test/panel-job'}"]`).click();
      await kit.until(() => document.querySelector('#job-panel:not([hidden]) [data-job-tab]'), 'the job page tabs');
      const tabs = [...document.querySelectorAll('#job-panel [data-job-tab]')].map(tab => tab.dataset.jobTab);
      const shown = {};
      for (const tab of ['application', 'timeline']) {
        document.querySelector(`#job-panel [data-job-tab="${tab}"]`).click();
        await kit.until(() => document.getElementById('job-panel').textContent.includes(tab === 'application' ? 'E2E who is on call?' : 'E2E applied with the extension'), `the ${tab} tab to fill in`);
        shown[tab] = document.getElementById('job-panel').textContent;
      }
      return {tabs, shown, notion: !!document.querySelector('#job-panel button.link')?.textContent.includes('Notion')};
    });
    await section('reports', async () => {
      await kit.go('reports');
      const body = () => document.getElementById('reports-body')?.textContent || '';
      await kit.until(() => body().includes('E2E quiet week'), 'the weekly report');
      const weekly = body();
      document.querySelector('[data-reports-tab="insights"]').click();
      await kit.until(() => body().includes('E2E replies come fast'), 'the insight');
      [...document.querySelectorAll('#reports-body .segmented button')].find(button => button.textContent === 'Acting on it').click();
      await kit.until(() => document.getElementById('reports-state')?.textContent.includes('Feedback saved'), '"Feedback saved"');
      document.querySelector('[data-reports-tab="funnel"]').click();
      await kit.until(() => document.querySelector('#reports-body table.data-table'), 'the Funnel table');
      return {weekly, table: [...document.querySelectorAll('#reports-body tr')].map(row => [...row.children].map(cell => cell.textContent.trim()))};
    });
    return out;
  }});
  window2 = probeWindow({...base, files: {'reports.json': afterFeedback}, script: async kit => {
    await kit.until(() => document.querySelector('.nav[data-view=focus]:not([hidden])'), 'the menu');
    await kit.go('reports');
    document.querySelector('[data-reports-tab="insights"]').click();
    await kit.until(() => [...document.querySelectorAll('#reports-body .segmented button.is-active')].some(button => button.textContent === 'Acting on it'), 'the kept feedback to show');
    return true;
  }});
});
after(() => store?.remove());

const facts = name => { const value = window1.result[name]; assert.equal(value?.error, undefined, `${name}: ${value?.error}`); return value; };

test('with the data on this Mac, Interviews asks for no Notion; with no store chosen and no Notion it still asks to connect', () => {
  assert.equal(gate({settings: () => ({store: 'sqlite'}), secret: () => ''}, 'interviews'), null, 'Interviews shows the Notion gate on the SQLite store');
  const asked = gate({settings: () => ({store: null}), secret: () => ''}, 'interviews');
  assert.equal(asked?.needsNotion, true, 'without a store chosen, Interviews no longer asks to connect Notion');
  assert.match(asked.text, /Connect Notion/);
});

test('a saved view chip narrows the list: Saved shows the saved application only', live, () => {
  const {only, all} = facts('saved');
  assert.deepEqual(only, [URLS.saved]);
  for (const url of Object.values(URLS)) assert.ok(all.includes(url), `${url} is not in the Jobs list read from the store`);
});

test('a job\'s page shows its kit, prep and history from the store, with no "Open in Notion"', live, () => {
  assert.equal(page.sections['📝 Application kit'] !== undefined, true, 'the kit section did not reach the store');
  const {tabs, shown, notion} = facts('panel');
  assert.equal(tabs.join(), TABS.map(([key]) => key).join());
  assert.ok(shown.application.includes('E2E three months'), 'Application does not show the kit\'s answer');
  assert.ok(shown.application.includes('E2E who is on call?'), 'Application does not show the prep');
  assert.ok(shown.timeline.includes('E2E applied with the extension'), 'the Timeline does not show the event');
  assert.equal(notion, false, '"Open in Notion" on the SQLite store');
});

test('Reports shows the weekly report and the insights; a feedback is kept in the store and shown after a reload', live, () => {
  const {weekly} = facts('reports');
  assert.ok(weekly.includes('E2E send the drafted kits'), 'the report\'s body is not shown');
  assert.equal(kept?.fields?.feedback, 'Acting on it');
  assert.equal(kept.fields.evidence, 'E2E 3 of 4 within 2 days', 'the feedback replaced the insight\'s other fields');
  assert.equal(window2.result, true);
});

test('Reports → Funnel shows the Pipeline table from the store\'s applications', live, () => {
  const {table} = facts('reports');
  assert.equal(table[0].join('|'), 'Step|Reached|From previous|Of applied|Still open here');
  const applied = table.find(row => /Applied/.test(row[0]));
  assert.ok(applied && Number(applied[1]) >= 2, `Applied row: ${JSON.stringify(applied)} (the store has the board's and the panel's applications)`);
});
