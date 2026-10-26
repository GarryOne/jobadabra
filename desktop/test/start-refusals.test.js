// Every button that starts a run says why when the run is refused (no AI credit, trial over, Notion, Always on could not start it), never a silent
// return (owner, 26 Oct 2026: "I press on 'find jobs' and nothing happens": main refused for no AI credit and the window dropped the answer).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {refusal, refusalAction} from '../renderer/refusal.js';

const root = new URL('../', import.meta.url);
const read = file => fs.readFileSync(new URL(file, root), 'utf8');
const walk = dir => fs.readdirSync(new URL(dir, root), {withFileTypes: true}).flatMap(entry =>
  entry.isDirectory() ? walk(`${dir}${entry.name}/`) : entry.name.endsWith('.js') ? [`${dir}${entry.name}`] : []);

// The channels a start button calls that can answer {ok: false, error} before anything runs -> how the window calls each (preload.cjs).
const RUN_STARTS = Object.fromEntries(['refresh', 'checkMail', 'prepareKit', 'applyOne', 'apply', 'applyWithClaude', 'command', 'tailorTop', 'visitsRun',
  'visitWithClaude', 'visitsWithClaude', 'rescoreOutdated', 'refreshLocations'].map(name => [name, new RegExp(`window\\.pilot\\.${name}\\(`)]));
RUN_STARTS.ivReview = /(?:pilot\.interviews|\biv)\.review\(/;

test('a refusal is read from the answer; a started or merely failed run is not one', () => {
  const credit = {ok: false, credit: true, error: 'Our AI needs AI credit. Top up, or use your own AI key.'};
  assert.deepEqual(refusal(credit), {text: credit.error, credit: true, allowance: false});
  assert.equal(refusalAction(refusal(credit)), 'Top up', 'Pro with no credit tops up');
  const line = refusal({ok: false, credit: true, cap: 'day', resetsAt: '2026-10-28T00:00:00.000Z', error: "You reached today's Free AI use."});
  assert.deepEqual([line.cap, line.resetsAt, refusalAction(line)], ['day', '2026-10-28T00:00:00.000Z', 'Upgrade to Pro'], 'the free tier upgrades (owner, 27 Oct 2026)');
  assert.equal(refusalAction(refusal({ok: false, allowance: true, error: 'The free trial is over.'})), 'See plans');
  assert.equal(refusal({ok: false, text: '⚠️ Connect Notion to track this.'}).text, 'Connect Notion to track this.');
  assert.equal(refusalAction(refusal({ok: false, error: 'Always on could not start it'})), '');
  for (const started of [{ok: true}, {ok: true, cloud: true}, {ok: false, run: {id: 1}}, {ok: false, removed: true, error: 'x'}, null, undefined])
    assert.equal(refusal(started), null, JSON.stringify(started));
});

test('every main handler that can refuse a new start is in RUN_STARTS (a new one is added there, then said in the window)', () => {
  const found = [];
  for (const file of ['main.js', ...walk('lib/')]) {
    // One handler: from its line to the next statement at its own indent (its closing "});" excluded).
    for (const [part, , name] of read(file).matchAll(/^( *)ipcMain\.handle\('(\w+)'[\s\S]*?(?=\n\1(?![\s}])|(?![\s\S]))/gm)) {
      if (/\ballowanceBlock\(\)|\bdispatchCloud\(|\bprepareKitFor\(|\bprepareTopMatches\(|\bstartClaude\(/.test(part)) found.push(name);
    }
  }
  assert.ok(found.includes('refresh') && found.includes('checkMail'), `the scan reads the handlers (positive control): ${found}`);
  for (const name of found) assert.ok(name in RUN_STARTS, `${name} can refuse a new start: add it to RUN_STARTS`);
});

test('every window call of a start channel reads its refusal (the class: Find jobs, Refresh, Check mail, Apply, Prepare, Redraft, Actions, ...)', () => {
  let calls = 0;
  for (const file of walk('renderer/')) {
    const lines = read(file).split('\n');
    lines.forEach((line, i) => {
      for (const [name, call] of Object.entries(RUN_STARTS)) {
        if (!call.test(line)) continue;
        calls += 1;
        const after = lines.slice(i, i + 12).join('\n');
        assert.match(after, /\brefusal\(|\bsayRefused\(|\.error\b|\bdoneMessage\(/, `${file}:${i + 1} drops a refused ${name}: pass its answer to sayRefused (pages/startup.js) or say its .error`);
      }
    });
  }
  assert.ok(calls >= 12, `the scan finds the calls (positive control): ${calls}`);
});

test('every Find jobs press goes through startSearch, which says a refusal on the card or in a pop-up', () => {
  const callers = walk('renderer/').filter(file => /window\.pilot\.refresh\(/.test(read(file)));
  assert.deepEqual(callers, ['renderer/pages/jobs.js'], 'Find jobs, Refresh, Re-score, Find employers all call startSearch');
  const jobs = read('renderer/pages/jobs.js');
  const body = jobs.slice(jobs.indexOf('export async function startSearch'), jobs.indexOf('export async function init'));
  assert.match(body, /showFindRefused\(refused\)/);
  assert.match(body, /sayRefused\(/);
  const card = read('renderer/pages/jobs-find.js');
  assert.match(card, /model\.state === 'refused'/, 'the card draws the refusal');
  assert.match(card, /if \(!refused\) keepBlock/, 'a refusal is never the next start\'s first paint');
});

test('Actions → Find jobs (the run command) answers its own reason, not a fixed "trial is over"', async () => {
  const {registerJobActionsHandlers} = await import('../lib/job-actions-handlers.js');
  const handlers = {};
  const credit = {ok: false, credit: true, error: 'Our AI needs AI credit.'};
  registerJobActionsHandlers({DEMO: false, allowanceBlock: () => credit, cloud: () => false, dispatchCloud: async () => ({ok: true}), dispatchNote: null,
    intelLib: {}, ipcMain: {handle: (name, fn) => { handlers[name] = fn; }}, log: () => {}, needsNotion: () => null, getRecipeReporter: () => null, storage: {}});
  const answer = await handlers.command({}, 'run');
  assert.equal(answer.text, '⚠️ Our AI needs AI credit.');
  assert.equal(refusal(answer).credit, true, 'the window offers the top-up dialog');
  assert.equal(refusal(await handlers.command({}, 'kits')).text, 'Our AI needs AI credit.', 'Prepare top matches too');
});
