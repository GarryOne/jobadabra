// Logged activity: the green box linking to the job a run created or updated (renderer/job-link.js, lib/job-line.js).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {jobHeadline, jobLinkActions, withListJob} from '../renderer/job-link.js';
import {jobFrom} from '../lib/job-line.js';
import * as history from '../lib/run-history.js';

const LINE = 'Job logged: {"page_id": "3e5-app-1", "url": "https://www.notion.so/3e5app1", "title": "Web3 DevOps", "job_url": "https://lead.test/1", "created": true}';

test('the engine\'s "Job logged" line is the run\'s job; a run without one has none', () => {
  assert.deepEqual(jobFrom(['⏳ Reading', LINE, '🤝 Tracked recruiter lead: Web3 DevOps — Acme']),
    {pageId: '3e5-app-1', url: 'https://www.notion.so/3e5app1', title: 'Web3 DevOps', jobUrl: 'https://lead.test/1', created: true});
  assert.equal(jobFrom(['ℹ️ Already tracked: Acme — SRE (Applied). Nothing new to log.']), null);
  assert.equal(jobFrom(['Job logged: {broken']), null);
});

test('created or updated, in the headline', () => {
  assert.equal(jobHeadline({created: true, title: 'Web3 DevOps'}), 'Job created — Web3 DevOps');
  assert.equal(jobHeadline({created: false, title: 'Web3 DevOps'}), 'Job updated — Web3 DevOps');
  assert.equal(jobHeadline({created: false}), 'Job updated');
});

test('Open job in Notion (⌘-click: in a Jobadabra window) and Show in Jobs call their handlers', () => {
  const calls = [];
  const job = {url: 'https://www.notion.so/3e5app1', title: 'Web3 DevOps', jobUrl: 'https://lead.test/1', created: true};
  const actions = jobLinkActions(job, {openNotion: (url, inWindow) => calls.push(['notion', url, inWindow]), show: shown => calls.push(['jobs', shown.jobUrl])});
  assert.deepEqual(actions.map(action => action.label), ['Open job in Notion ↗', 'Show in Jobs']);
  actions[0].run({metaKey: true});
  actions[0].run({});
  actions[1].run({});
  assert.deepEqual(calls, [['notion', 'https://www.notion.so/3e5app1', true], ['notion', 'https://www.notion.so/3e5app1', false], ['jobs', 'https://lead.test/1']]);
  // Its place in the Jobs list unknown: only the Notion link.
  assert.deepEqual(jobLinkActions({...job, jobUrl: ''}, {openNotion() {}, show() {}}).map(action => action.id), ['notion']);
});

test('a run read from Notion knows only the job\'s page: its title and list key come from the Jobs list', () => {
  const jobs = [{page_id: '3e5a-pp1', title: 'Web3 DevOps', url: 'https://lead.test/1'}, {page_id: 'other', title: 'SRE', url: 'https://x.test/2'}];
  assert.deepEqual(withListJob({pageId: '3e5app1', url: 'https://www.notion.so/3e5app1', title: '', jobUrl: '', created: true}, jobs),
    {pageId: '3e5app1', url: 'https://www.notion.so/3e5app1', title: 'Web3 DevOps', jobUrl: 'https://lead.test/1', created: true});
  assert.equal(withListJob(null, jobs), null);
});

const row = (mode, summary, relation, status = 'OK') => ({id: 'run-1', url: 'https://www.notion.so/run1', created_time: '2026-09-30T09:00:00.000Z', properties: {
  Started: {date: {start: '2026-09-30T09:00:00Z'}}, Mode: {select: {name: mode}}, Status: {select: {name: status}}, Trigger: {select: {name: 'Mac (you)'}},
  Summary: {rich_text: [{plain_text: summary}]}, 'Duration (s)': {number: 20}, Application: {relation: relation ? [{id: relation}] : []}}});

test('a Logged activity row with its Application is a run with a job (created: "Tracked…"); other rows have none', () => {
  const now = Date.parse('2026-09-30T10:00:00Z');
  assert.deepEqual(history.fromRow(row('add', '🤝 Tracked recruiter lead: Web3 DevOps — Acme (Screening) (AI cost $0.010)', '3e5a-pp1'), now).job,
    {pageId: '3e5a-pp1', url: 'https://www.notion.so/3e5app1', title: '', jobUrl: '', created: true});
  assert.equal(history.fromRow(row('add', '❌ Updated: Acme — SRE → Rejected', 'p1'), now).job.created, false);
  assert.equal(history.fromRow(row('add', 'ℹ️ Already tracked', null), now).job, undefined);
  assert.equal(history.fromRow(row('prep', 'Huxley · Principal SRE: Prep kit ready', 'p1'), now).job, undefined);  // not a logged job
  assert.equal(history.fromRow(row('add', '⚠️ Failed', 'p1', 'Failed'), now).job, undefined);
});

test('a run\'s page gives its job from the technical log', async () => {
  const para = (type, content) => ({type, [type]: {rich_text: [{plain_text: content}]}});
  const fetcher = async url => Response.json(url.includes('blocks/toggle-1/') ? {results: [para('code', `⏳ Reading\n${LINE}\n🤝 Tracked`)]}
    : {results: [{id: 'toggle-1', type: 'toggle', has_children: true, toggle: {rich_text: [{plain_text: 'Technical log (last 3 lines)'}]}}]});
  const detail = await history.detail({secret: () => 'secret_x', settings: () => ({})}, 'run-1', {fetcher});
  assert.equal(detail.job.title, 'Web3 DevOps');
  assert.equal(detail.job.created, true);
});
