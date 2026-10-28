// The Apply button makes a form session (no terminal): one per job, in the Applying page, moved to Applying in Notion.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as apply from '../lib/apply.js';
import * as terminals from '../lib/terminals.js';

const URL1 = 'https://jobs.ashbyhq.com/openai/621bb104-9daa-4c9e-949a-03d5730334e8';
const harness = () => {
  terminals._reset();
  const opened = [], ran = [];
  return {opened, ran, options: {open: (...args) => { opened.push(args); return {unref() {}}; }, term: terminals, run: async (_, args) => { ran.push(args); return {}; }, id: () => 'f1'}};
};

test('Apply opens the form tab and makes one form session for the job, marked Applying', async () => {
  const {opened, ran, options} = harness();
  const result = await apply.applyOne({}, URL1, {title: 'Software Engineer', company: 'OpenAI', location: 'London'}, options);
  assert.equal(result.ok, true);
  assert.equal(opened.length, 1);
  assert.ok(opened[0].flat(2).some(part => String(part).endsWith('#jobpilotto-fill=f1')));
  const [session] = terminals.list();
  assert.deepEqual([session.kind, session.id, session.company, session.status, session.live, session.url], ['form', 'f1', 'OpenAI', 'done', false, URL1]);
  assert.deepEqual(ran, [['src.ai.apply_batch', '--mark-applying', URL1]]);
});

test('Apply again on the same job reopens the tab only: still one session, no second Notion write', async () => {
  const {opened, ran, options} = harness();
  await apply.applyOne({}, URL1, {company: 'OpenAI'}, options);
  await apply.applyOne({}, URL1, {company: 'OpenAI'}, {...options, id: () => 'f2'});
  assert.equal(opened.length, 2);
  assert.equal(terminals.list().length, 1);
  assert.equal(ran.length, 1);
});

test('a job without a link opens nothing and makes no session', async () => {
  const {opened, options} = harness();
  const result = await apply.applyOne({}, '', {}, options);
  assert.equal(result.ok, false);
  assert.equal(opened.length + terminals.list().length, 0);
});

test('a form session is kept on disk as a form session and comes back after a restart', () => {
  terminals._reset();
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'form-session-')), 'sessions.json');
  terminals.persist(file);
  terminals.startForm({id: 'f1', url: URL1, company: 'OpenAI', title: 'SE'});
  terminals.saveNow();
  terminals._sessions.clear();
  terminals.restore();
  const [session] = terminals.list();
  assert.deepEqual([session.kind, session.status, session.company], ['form', 'done', 'OpenAI']);
});

test('a form session never reports to the Claude run statistics', () => {
  terminals._reset();
  const heard = [];
  terminals.onStatus(view => heard.push(view.id));
  terminals.startForm({id: 'f1', url: URL1, company: 'OpenAI'});
  terminals.setOutcome('f1', 'submitted');
  terminals.onStatus(() => {});
  assert.deepEqual(heard, []);
  assert.equal(terminals.get('f1').outcome, 'submitted');
});

test('known sites open on the form itself, others as they are', () => {
  const id = '621bb104-9daa-4c9e-949a-03d5730334e8';
  assert.equal(apply.formUrl(`https://jobs.ashbyhq.com/openai/${id}`), `https://jobs.ashbyhq.com/openai/${id}/application`);
  assert.equal(apply.formUrl(`https://jobs.ashbyhq.com/openai/${id}/`), `https://jobs.ashbyhq.com/openai/${id}/application`);
  assert.equal(apply.formUrl(`https://jobs.ashbyhq.com/openai/${id}/application`), `https://jobs.ashbyhq.com/openai/${id}/application`);
  assert.equal(apply.formUrl(`https://jobs.lever.co/palantir/${id}?lever-source=x`), `https://jobs.lever.co/palantir/${id}/apply?lever-source=x`);
  assert.equal(apply.formUrl('https://apply.workable.com/acme/j/ABC123DEF4/'), 'https://apply.workable.com/acme/j/ABC123DEF4/apply');
  assert.equal(apply.formUrl('https://job-boards.greenhouse.io/anthropic/jobs/5211305008'), 'https://job-boards.greenhouse.io/anthropic/jobs/5211305008');
  assert.equal(apply.formUrl('https://www.jobs.ch/en/vacancies/detail/abc/'), 'https://www.jobs.ch/en/vacancies/detail/abc/');
  assert.equal(apply.formUrl('not a url'), 'not a url');
});

test('Apply opens the form url with the fill mark, and the session keeps the posting url', async () => {
  const {opened, options} = harness();
  const id = '621bb104-9daa-4c9e-949a-03d5730334e8';
  await apply.applyOne({}, `https://jobs.ashbyhq.com/openai/${id}`, {company: 'OpenAI'}, options);
  assert.ok(opened[0].flat(2).includes(`https://jobs.ashbyhq.com/openai/${id}/application#jobpilotto-fill=f1`));
  assert.equal(terminals.list()[0].url, `https://jobs.ashbyhq.com/openai/${id}`);
});

test('a stuck form session says so, is cleared when a form shows up, and is dropped when Claude takes over', () => {
  terminals._reset();
  terminals.startForm({id: 'f1', url: URL1, company: 'OpenAI'});
  terminals.noteStuck('f1', 'no-form');
  assert.equal(terminals.get('f1').stuck, 'no-form');
  assert.match(terminals.get('f1').note, /can't reach the form/);
  terminals.clearStuck('f1');
  assert.equal(terminals.get('f1').stuck, '');
  assert.equal(terminals.noteStuck('f1', 'account'), true);    // the first report: the app hands the job to Claude
  assert.equal(terminals.noteStuck('f1', 'account'), false);   // the page reloads and reports again: nothing changed
  assert.equal(terminals.noteStuck('f1', 'no-form'), false);   // the posting tab behind the sign-in says "no form": the account step stays
  assert.equal(terminals.get('f1').stuck, 'account');
  terminals.dropForm(URL1);
  assert.equal(terminals.list().length, 0);
  terminals.startForm({id: 'f2', url: URL1});
  terminals.setOutcome('f2', 'submitted');
  assert.equal(terminals.noteStuck('f2', 'no-form'), false);  // a submitted one is never marked stuck
  assert.equal(terminals.get('f2').stuck, '');
});

test('a stuck report belongs to its own job only, never to another job at the same company', () => {
  const posting = 'https://jobs.ashbyhq.com/openai/621bb104-9daa-4c9e-949a-03d5730334e8';
  assert.equal(apply.isFormOf(`${posting}/application`, posting), true);
  assert.equal(apply.isFormOf(`${posting}#jobpilotto-fill`, posting), true);
  assert.equal(apply.isFormOf(posting, posting), true);
  assert.equal(apply.isFormOf('https://jobs.ashbyhq.com/openai/0000aaaa-9daa-4c9e-949a-03d5730334e8/application', posting), false);
  assert.equal(apply.isFormOf('', posting), false);
});

test('the job-site password is read from the Keychain on a Mac only, and a missing one is null', async () => {
  const sitePassword = await import('../lib/site-password.js');
  const calls = [];
  assert.equal(sitePassword.read('darwin', (...args) => { calls.push(args); return 'Maple-Rocket-42\n'; }), 'Maple-Rocket-42');
  assert.deepEqual(calls[0].slice(0, 2), ['security', ['find-generic-password', '-a', 'job-pilotto', '-s', 'job-pilotto.sites.password', '-w']]);
  assert.equal(sitePassword.read('darwin', () => { throw new Error('not found'); }), null);
  assert.equal(sitePassword.read('win32', () => 'x'), null);
});

test('the stage follows the tab: account with its site, then the form; the account site is kept', () => {
  terminals._reset();
  terminals.startForm({id: 'f1', url: URL1});
  terminals.noteStuck('f1', 'account', 'career55.sapsf.eu');
  assert.deepEqual([terminals.get('f1').stage, terminals.get('f1').accountHost], ['account', 'career55.sapsf.eu']);
  assert.equal(terminals.setStage('f1', 'form'), true);
  assert.equal(terminals.setStage('f1', 'form'), false);
  assert.deepEqual([terminals.get('f1').stage, terminals.get('f1').accountHost], ['form', 'career55.sapsf.eu']);
});

test('Claude taking a job over closes its form tab only when nothing was filled there', async () => {
  const {formTabsAtHandOver} = await import('../lib/apply.js');
  const sessions = [{id: 'f1', kind: 'form', url: URL1, outcome: ''}, {id: 'f2', kind: 'form', url: URL1, outcome: 'submitted'},
    {id: 'c1', kind: 'claude', url: URL1, outcome: ''}, {id: 'f3', kind: 'form', url: 'https://other.example/job', outcome: ''}];
  assert.deepEqual(formTabsAtHandOver(sessions, `${URL1}#jobpilotto-fill`), [{id: 'f1', close: true, why: 'nothing filled'}]);   // Coop's sign-in tab
  assert.deepEqual(formTabsAtHandOver(sessions, URL1, id => (id === 'f1' ? 4 : 0)), [{id: 'f1', close: false, why: 'answers filled there'}]);
});

// SmartRecruiters (twin, 9 Oct 2026): a robot check stood in front of the form; the card said only "No application form found on the page yet".
test('a page with a bot check in front says what the person must do, on the card and in its steps', async () => {
  terminals._reset();
  terminals.startForm({id: 'f1', url: URL1, company: 'H&M'});
  terminals.noteStuck('f1', 'no-form', 'jobs.smartrecruiters.com', "This site wants a quick check: solve it, then I'll continue");
  assert.equal(terminals.get('f1').stuck, 'no-form');
  assert.equal(terminals.get('f1').note, "Needs you: This site wants a quick check: solve it, then I'll continue");
  const {sessionSteps} = await import('../renderer/session-steps-list.js');
  assert.ok(sessionSteps(terminals.get('f1')).some(step => step.text === "Needs you: This site wants a quick check: solve it, then I'll continue"));
  terminals._reset();
  terminals.startForm({id: 'f2', url: URL1, company: 'Plain'});
  terminals.noteStuck('f2', 'no-form');
  assert.ok(sessionSteps(terminals.get('f2')).some(step => step.text === 'No application form found on the page yet'), 'no need: the old wording');
  const flow = ['fill-flow.js', 'fill-flow-read.js', 'fill-flow-steps.js'].map(file => fs.readFileSync(new URL(`../../extension/${file}`, import.meta.url), 'utf8')).join('\n');
  assert.match(flow, /const botCheck = role === 'no-form' && kind\?\.botCheck === true;/);
  assert.match(flow, /watchForFields\(tab, jobUrl, undefined, botCheck \? 60 : 10, counts\?\.frameHosts \|\| \[\], \(\) => markPage\(tab\.id, role, pressed, kind\)\)/);
  assert.match(flow, /deadEndHere\(tab, jobUrl, host, role === 'account' \? 'account' : 'no-form', botCheck \? BOT_CHECK_NEED : '',/, 'the no-form dead end carries the bot check\'s need');
  const reads = fs.readFileSync(new URL('../../extension/page-reads.js', import.meta.url), 'utf8');   // pageSketchOf (moved out of fill-flow.js)
  assert.match(reads, /frames: \[\.\.\.new Set\(frames\)\]\.slice\(0, 5\)/, 'the sketch carries the visible frames\' hosts');
});

// #1737 (24 Oct 2026): eight forms open and the Jobs chips still counted "Applying 0", "Kit ready 11": Apply answered before its Stage write, so the
// window had nothing to read again. Apply answers once the job is marked Applying (a failed mark still opens the form).
test('Apply answers only after the job is marked Applying, and a failed mark still answers ok', async () => {
  const {options} = harness();
  let release, marked = false;
  const run = () => new Promise(resolve => { release = () => { marked = true; resolve({}); }; });
  const answer = apply.applyOne({}, URL1, {company: 'OpenAI'}, {...options, run});
  let answered = false; answer.then(() => { answered = true; });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(answered, false, 'Apply answered before the job was marked Applying');
  release();
  assert.equal((await answer).ok, true);
  assert.equal(marked, true);
  const failed = await apply.applyOne({}, `${URL1}-2`, {company: 'OpenAI'}, {...harness().options, run: async () => { throw new Error('store down'); }, id: () => 'f9'});
  assert.equal(failed.ok, true);
});
