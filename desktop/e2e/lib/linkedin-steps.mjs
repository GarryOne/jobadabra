/* global window */
// Job: wait on state
// LinkedIn jobs on every Find jobs, PR 2b (owner, 31 Oct 2026; spec docs/superpowers/specs/2026-10-31-linkedin-headless-design.md): the person's own Find jobs press with the
// switch on reads a stand-in for www.linkedin.com (lib/linkedin-fixture.mjs, on the forms server) in the app's hidden browser, with a FAKE copied session in the run's own secrets file.
// Why (31 Oct 2026, a8): five verdict steps (list, sign-in page, check, 429, Stop) and three "nothing leaks" steps, each a state wait with its own hang cap and an error that prints the
// fixture's request log and the hidden browser. No AI: the fixture list is a shape the extension's quick guess reads, the step passes filter:false, and the fixture places fit no strategy,
// so nothing is scored; the suite's "no AI call reached a real model" step proves it. Skipped where the hidden browser has no runtime link (Windows).
import fs from 'node:fs';
import path from 'node:path';
import {writePrivate} from '../../lib/private-file.js';
import {appLogText} from './app-log.mjs';
import {HIDDEN_NEED, closeHiddenBrowser, describeHidden, evaluateOn, hiddenPort, hiddenTargets, linkRuntime} from './background-proof.mjs';
import {FAKE_JSESSIONID, FAKE_LI_AT} from './linkedin-fixture.mjs';
import {pollUntil, stepTimeLeft} from './wait-on-state.mjs';

const SERVICE = 'jobadabra.linkedin-jobs.session';   // lib/linkedin-session.js SERVICE: the run's secrets file stands in for the Keychain (lib/keychain.js)
const searchesOf = fx => fx.requests.filter(item => item.path.startsWith('/jobs/search')).length;

/** The settings the app keeps for the switch, the last result and the pause. */
const linkedinSettings = page => page.evaluate(async () => (await window.pilot.state()).settings?.linkedinJobs || {});
// Why (31 Oct 2026): not lib/activity-steps.mjs runsData: that helper carries clock waits the ratchet would count against this new suite (test/timing-ratchet.test.mjs).
const searchRuns = page => page.evaluate(async () => {
  const data = await window.pilot.runs();
  return {running: !!data.running, runs: (data.runs || []).filter(run => run.kind === 'search').map(run => ({id: run.id}))};
});
/** The lines the newest search run kept (the app's own runs.json: the window's list merges Notion rows that carry none). */
const logOf = profile => { try { return JSON.parse(fs.readFileSync(path.join(profile, 'runs.json'), 'utf8')).find(run => run.kind === 'search')?.log || []; } catch { return []; } };

/** Switch on with the fake session (the run's secrets file), no result and no pause from an earlier step. */
async function seed(ctx, fx, caseName) {
  const file = path.join(ctx.profile, 'isolated-secrets.json');
  let items = {}; try { items = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch { /* the first item */ }
  items[SERVICE] = {value: JSON.stringify({li_at: FAKE_LI_AT, JSESSIONID: FAKE_JSESSIONID}), account: 'linkedin-jobs', comment: '', created: new Date().toISOString()};
  writePrivate(file, JSON.stringify(items, null, 2));
  await ctx.page.evaluate(() => window.pilot.saveSettings({linkedinJobs: {on: true, asked: 2, declined: 0, last: null, pauseUntil: null}}));
  fx.reset();
  fx.setCase(caseName);
}

/** The person's press: Jobs page, Find jobs. Returns when the press is queued; waits are the caller's (a state, never a delay). */
async function press(ctx) {
  await ctx.page.click('.nav[data-view="jobs"]');
  await ctx.page.click('#refresh');
}

/** Wait until the app wrote this press's LinkedIn verdict (settings.linkedinJobs.last, newer than `since`) and its search run has ended; -> {last, run}. */
async function verdictOf(ctx, since, before) {
  const {value} = await pollUntil(async () => {
    const [mine, runs] = await Promise.all([linkedinSettings(ctx.page), searchRuns(ctx.page)]);
    return {mine, runs, done: !!mine.last && Date.parse(mine.last.at) >= since && !runs.running && runs.runs.length > before};
  }, state => state.done, {capMs: stepTimeLeft()});
  if (!value.done) throw new Error(`no LinkedIn verdict before the step's hang cap (last seen: ${JSON.stringify(value.mine.last || null)}; search running: ${value.runs.running})`);
  return {last: value.mine.last, mine: value.mine};
}

/** The names of the LinkedIn cookies the app's hidden browser sends right now: a probe tab on the fixture's /__cookies, closed again. */
export async function cookiesHeld(profile) {
  const port = hiddenPort(profile);
  const made = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent('https://www.linkedin.com/__cookies')}`, {method: 'PUT'})).json();
  try {
    const {value} = await pollUntil(() => evaluateOn(made.webSocketDebuggerUrl, 'document.body ? document.body.innerText : ""'), text => /^\s*\[/.test(String(text || '')), {capMs: stepTimeLeft()});
    return JSON.parse(value);
  } finally { await fetch(`http://127.0.0.1:${port}/json/close/${made.id}`).catch(() => {}); }
}

const linkedinTabs = profile => hiddenTargets(profile).then(list => list.filter(item => item.type === 'page' && /linkedin\.com/.test(item.url)), () => []);

/** Every file the run wrote that may hold the session value, except the secrets file (the Keychain's stand-in) and the browser's own folder. */
function filesToScan(root) {
  const out = [];
  const walk = dir => { for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (!['background-browser', 'background-browser-runtime', 'node_modules'].includes(entry.name)) walk(full); } else if (entry.name !== 'isolated-secrets.json') out.push(full);
  } };
  walk(root);
  return out;
}
/** The files under `root` (and the run's artifacts) that hold the fake session value; [] when none does. Reads every file under 80 MB as bytes; the secrets file (the one place it may be) and the browser's own folder are skipped, an unreadable file counts as clean. */
export const leaks = (root, artifacts) => [...filesToScan(root), ...(artifacts ? filesToScan(artifacts) : [])]
  .filter(file => { try { return fs.statSync(file).size < 80e6 && fs.readFileSync(file).toString('latin1').includes('FAKE-LI-AT'); } catch { return false; } });

/** Wrap a step so a failure also prints the fixture's request log and what the hidden browser holds. */
const withDiagnosis = (ctx, fx, body) => async () => {
  try { await body(); } catch (error) { throw new Error(`${error.message} | fixture requests:\n  ${fx.describe()}\n  ${await describeHidden(ctx.profile)}`); }
};

const NAMES = {
  list: 'LinkedIn on: a press reads the guest list in the app\'s hidden browser with the copied session, keeps the jobs, and leaves no LinkedIn cookie in that browser',
  login: 'LinkedIn sends the read to its sign-in page: one search is opened, the read stops and says to sign in again',
  check: 'LinkedIn shows a check: one search is opened, the read stops, the check is not answered',
  limited: 'LinkedIn answers 429: one search is opened, LinkedIn is left alone for a day and the next press asks it for nothing',
  stop: 'Stop in the middle of a LinkedIn read closes its tab and takes the session out of the browser',
  leak: 'the copied session is in no log, run or store file of the app, only in the run\'s secrets file',
  off: 'with the switch off a press asks LinkedIn for nothing and the session is gone from the secrets file',
};
export const STEP_NAMES = Object.values(NAMES);

const expect = (what, ok) => { if (!ok) throw new Error(what); };
/** Seed, press, and remember when and how many searches there were before. */
async function pressed(ctx, fx, caseName) {
  await seed(ctx, fx, caseName);
  const since = Date.now(), before = (await searchRuns(ctx.page)).runs.length;
  await press(ctx);
  return {since, before};
}
/** Wait until the search run started after `before` has ended (a press that writes no verdict); throws when none ended, so "nothing reached LinkedIn" cannot pass on a press that did nothing. */
const endedAfter = async (ctx, before) => {
  const {value} = await pollUntil(async () => { const now = await searchRuns(ctx.page); return !now.running && now.runs.length > before; }, done => done, {capMs: stepTimeLeft()});
  if (!value) throw new Error('the press started no search run that ended before the step\'s hang cap');
};

async function listBody(ctx, fx) {
  const mark = await pressed(ctx, fx, 'list');
  const {last} = await verdictOf(ctx, mark.since, mark.before);
  const log = logOf(ctx.profile);
  expect('the fixture saw no request before the verdict: the hidden browser did not reach it', fx.requests.length > 0);
  expect('the first request carried no li_at: the copied session did not reach the browser', fx.requests[0].liAt);
  expect(`the verdict is "${last.state}", not done`, last.state === 'done');
  expect(`the app counted ${last.jobs} jobs, the fixture served ${fx.served()}`, last.jobs === fx.served() && last.jobs > 0);
  expect(`the run says "${log.filter(line => /LinkedIn:/.test(line)).join(' | ') || '(no LinkedIn line)'}", not "LinkedIn: ${last.jobs} jobs read" (last lines: ${JSON.stringify(log.slice(-4))})`, log.some(line => new RegExp(`LinkedIn: ${last.jobs} jobs? read`).test(line)));
  const stored = fs.readFileSync(path.join(ctx.profile, 'data', 'visits.json'), 'utf8');
  expect('a served job is missing from the engine\'s visit store', fx.servedIds().every(id => stored.includes(`/jobs/view/${id}`)));
  const held = await cookiesHeld(ctx.profile);
  expect(`the hidden browser still holds LinkedIn cookies after the read: ${JSON.stringify(held)}`, held.length === 0);
  expect('a LinkedIn tab is still open after the read', (await linkedinTabs(ctx.profile)).length === 0);
}

async function wallBody(ctx, fx, key, state) {
  const mark = await pressed(ctx, fx, key);
  const {last, mine} = await verdictOf(ctx, mark.since, mark.before);
  expect(`the verdict is "${last.state}", not "${state}"`, last.state === state);
  expect(`${searchesOf(fx)} searches were opened, expected exactly one: the read must stop at the wall (no retry, no next search)`, searchesOf(fx) === 1);
  if (key !== 'limited') return;
  expect('a 429 left no pause of about a day', Date.parse(mine.pauseUntil || '') - Date.now() > 23 * 3600e3);
  fx.reset();
  const before = (await searchRuns(ctx.page)).runs.length;
  await press(ctx);   // the next press, with the pause the app kept: no seed, so the pause stays
  await endedAfter(ctx, before);
  expect(`${fx.requests.length} request(s) reached LinkedIn on the next press, during the pause`, fx.requests.length === 0);
}

async function stopBody(ctx, fx) {
  const mark = await pressed(ctx, fx, 'hold');
  let last;
  try {   // the held response is freed even when a check below throws, so the leak and off steps start from a quiet fixture
    const seen = await pollUntil(() => fx.requests.length > 0, value => value, {capMs: stepTimeLeft()});
    expect('the held LinkedIn read never reached the fixture before Stop', seen.value);
    await ctx.page.evaluate(() => window.pilot.stopTask());
    ({last} = await verdictOf(ctx, mark.since, mark.before));
  } finally { fx.release(); }
  expect(`the verdict is "${last.state}", not "stopped"`, last.state === 'stopped');
  expect('a LinkedIn tab is still open after Stop', (await pollUntil(() => linkedinTabs(ctx.profile).then(tabs => tabs.length === 0), gone => gone, {capMs: stepTimeLeft()})).value);
  const held = await cookiesHeld(ctx.profile);
  expect(`the hidden browser still holds LinkedIn cookies after Stop: ${JSON.stringify(held)}`, held.length === 0);
}

async function leakBody(ctx) {
  const found = leaks(ctx.profile, ctx.ARTIFACTS);
  expect(`the fake session value is in: ${found.map(file => path.relative(ctx.profile, file)).join(', ')}`, found.length === 0);
  expect('the fake session value is in the app log', !appLogText(ctx.profile).includes('FAKE-LI-AT'));
}

async function offBody(ctx, fx) {
  await seed(ctx, fx, 'list');
  await ctx.page.evaluate(() => window.pilot.linkedinJobsOff());
  const before = (await searchRuns(ctx.page)).runs.length;
  await press(ctx);
  await endedAfter(ctx, before);
  expect(`${fx.requests.length} request(s) reached LinkedIn with the switch off`, fx.requests.length === 0);
  const items = JSON.parse(fs.readFileSync(path.join(ctx.profile, 'isolated-secrets.json'), 'utf8'));
  expect('the session is still in the secrets file after the switch went off', !(SERVICE in items));
}

/** The verdict steps and the checks that nothing leaks, on the suite's fixture (ctx.forms.linkedin). */
export async function runLinkedinSteps(ctx) {
  const fx = ctx.forms.linkedin, unlinked = linkRuntime(ctx.profile);   // links the downloaded-browser stand-in where the app looks for it
  const needs = [...ctx.needs, unlinked ? {name: unlinked, value: false} : HIDDEN_NEED];
  const step = (key, body) => ctx.run(NAMES[key], withDiagnosis(ctx, fx, body), {needs, data: true});   // data: the session is a credential and these steps prove where it goes and where it never goes (no beta retry, lib/beta-retry.mjs)
  try {
    await step('list', () => listBody(ctx, fx));
    for (const [key, state] of [['login', 'signed-out'], ['check', 'check'], ['limited', 'limited']]) await step(key, () => wallBody(ctx, fx, key, state));
    await step('stop', () => stopBody(ctx, fx));
    await step('leak', () => leakBody(ctx));
    await step('off', () => offBody(ctx, fx));
  } finally { await closeHiddenBrowser(ctx.profile); }
}
