// A step whose clock ran out ends with its own message: no wait in desktop/e2e is handed a time left that can be 0, which Playwright reads as "no timeout".
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {stepClock, stepTimeLeft, stepWait} from '../lib/wait-on-state.mjs';

// A Playwright-style wait: `timeout: 0` means NO timeout (waits for the page forever), any other number rejects when it is spent.
const playwrightWait = ({timeout} = {}) => new Promise((_, fail) => { if (timeout) setTimeout(() => fail(new Error(`Timeout ${timeout}ms exceeded`)), timeout); });
const SPENT_MS = 1500;   // inside lib/wait-on-state.mjs REPORT_MS (2000): the step's clock is spent for any wait
const settles = (promise, ms) => Promise.race([promise.then(() => 'resolved', error => error), new Promise(done => setTimeout(() => done('still waiting'), ms))]);

test('the lead: a raw stepTimeLeft() handed to a Playwright wait never ends once the step\'s clock is spent', async () => {
  stepClock(SPENT_MS);
  try {
    assert.equal(stepTimeLeft(), 0, 'the clock is spent: stepTimeLeft() says 0');
    assert.equal(await settles(playwrightWait({timeout: stepTimeLeft()}), 300), 'still waiting', '0 is "no timeout" to Playwright: the cleanup waits forever');
  } finally { stepClock(null); }
});

test('stepWait ends a spent step at once with the step\'s own message, never calling the wait', async () => {
  stepClock(SPENT_MS);
  let called = 0;
  try {
    const result = await settles(stepWait('the triage dialog opened', timeout => { called += 1; return playwrightWait({timeout}); }), 300);
    assert.match(String(result?.message), /the step's clock ran out before the triage dialog opened/);
    assert.equal(called, 0, 'no wait was started');
  } finally { stepClock(null); }
});

test('stepWait gives a running step the time it has left, and no step the wait\'s own default', async () => {
  stepClock(60000);
  try {
    let given = 0;
    await stepWait('x', timeout => { given = timeout; });
    assert.ok(given > 56000 && given <= 58000, `the time left, ${given} ms`);
  } finally { stepClock(null); }
  let outside = 'unset';
  await stepWait('x', timeout => { outside = timeout; });
  assert.equal(outside, undefined, 'no step (a unit test): Playwright\'s default');
});

// Why (31 Oct 2026, owner: "E: no zero timeouts"; a8 2/5 #2701): the guard reads the harness source, so a new raw `timeout: stepTimeLeft()` cannot come back.
test('no harness file passes a computed time left that can reach 0 as a timeout', () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const files = [];
  const walk = dir => fs.readdirSync(dir, {withFileTypes: true}).forEach(entry => {
    if (entry.name === 'node_modules' || entry.name === 'test') return;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full); else if (entry.name.endsWith('.mjs')) files.push(full);
  });
  walk(root);
  const bad = [];
  for (const file of files) fs.readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
    if (/timeout\s*:\s*[^,}]*(stepTimeLeft\s*\(|Math\.max\(\s*0)/.test(line)) bad.push(`${path.relative(root, file)}:${index + 1}`);
  });
  assert.deepEqual(bad, [], 'wrap the wait in stepWait(what, timeout => …) (lib/wait-on-state.mjs): a spent clock then ends with its own message');
});
