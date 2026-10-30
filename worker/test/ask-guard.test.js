// The one guard for every async AI answer applied to a page (extension/read-gen.js startAsk / landAsk / guarded; owner, 13 Oct 2026, the Richemont stop of pool run 38332290181): an answer is applied only if
// no newer judgment of the same page landed after its ask started. The proof forces the order of that stop: an unsure read -> the digest asked -> a confident read lands -> the digest's answer arrives.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {EXEMPT_ROUTES, GUARDED_ROUTES, forgetJudgments, guarded, landAsk, startAsk} from '../../extension/read-gen.js';

const PAGE = 'https://jobs.example/apply/create-account';
const body = extra => ({body: JSON.stringify({url: PAGE, ...extra})});
const kind = (name, confidence, extra = {}) => ({kind: name, role: name === 'posting' ? 'no-form' : 'form', confidence, ...extra});

test('the Richemont order: the digest asked for the unsure read lands after a confident read of the same page, and the confident read stays', () => {
  forgetJudgments(1);
  const digest = startAsk(1, '/extension/page-kind', body({digest: true}), '', 1000);   // the unsure first read asked the digest
  const confident = startAsk(1, '/extension/page-kind', body({}), '', 1500);   // the second look at the same page
  assert.equal(landAsk(confident, kind('account-form', 0.9), PAGE, 2000).dropped, '');   // lands first
  const late = landAsk(digest, kind('posting', 0.6, {digest: true}), PAGE, 3100);   // the digest's answer arrives 1.1 s later
  assert.equal(late.dropped, 'newer');
  assert.equal(late.answer.kind, 'account-form', 'the page-kind answer is replaced by the newer judgment');
});

test('an answer whose ask started AFTER the judgment is the newer one and is applied; so is one nothing overtook', () => {
  forgetJudgments(1);
  const first = startAsk(1, '/extension/page-kind', body({}), '', 1000);
  landAsk(first, kind('account-form', 0.9), PAGE, 1500);
  const after = startAsk(1, '/extension/page-kind', body({digest: true}), '', 2000);
  assert.equal(landAsk(after, kind('posting', 0.7), PAGE, 2600).dropped, '');
  forgetJudgments(1);
  const alone = startAsk(1, '/extension/page-kind', body({}), '', 1000);
  assert.deepEqual(landAsk(alone, kind('form', 0.9), PAGE, 1200), {answer: kind('form', 0.9), dropped: ''});
});

test('an unsure answer is not a judgment: it never overrides a later asker, and another tab or page is untouched', () => {
  forgetJudgments(1); forgetJudgments(2);
  const slow = startAsk(1, '/extension/page-kind', body({}), '', 1000);
  const quick = startAsk(1, '/extension/page-kind', body({}), '', 1100);
  landAsk(quick, kind('posting', 0.4), PAGE, 1500);
  assert.equal(landAsk(slow, kind('form', 0.9), PAGE, 2000).dropped, '', 'a 0.4 answer is no judgment');
  const other = startAsk(2, '/extension/page-kind', body({}), '', 1000);
  landAsk(startAsk(2, '/extension/page-kind', body({url: 'https://jobs.example/other'}), '', 1100), kind('form', 0.95), 'https://jobs.example/other', 1500);
  assert.equal(landAsk(other, kind('posting', 0.9), PAGE, 2000).dropped, '', 'a judgment of another page does not make this answer late');
});

test('any other answer (the picture look, an account judge of the same phase) is dropped, not replaced; a page the tab left is dropped', () => {
  forgetJudgments(1);
  const look = startAsk(1, '/extension/escalate', body({kind: 'page'}), '', 1000);
  landAsk(startAsk(1, '/extension/page-kind', body({}), '', 1200), kind('form', 0.9), PAGE, 1600);
  assert.deepEqual(landAsk(look, {action: 'click', control: 'Apply'}, PAGE, 2000), {answer: null, dropped: 'newer'});
  const judge = startAsk(1, '/extension/account-judge', body({phase: 'outcome'}), '', 1000);
  landAsk(startAsk(1, '/extension/account-judge', body({phase: 'outcome'}), '', 1100), {outcome: 'signed_in'}, PAGE, 1500);
  assert.equal(landAsk(judge, {outcome: 'error'}, PAGE, 2000).answer, null);
  const otherPhase = startAsk(1, '/extension/account-judge', body({phase: 'fill'}), '', 1000);
  assert.equal(landAsk(otherPhase, {ready: true}, PAGE, 2000).dropped, '', 'a judgment of another phase is another question');
  const moved = startAsk(1, '/extension/answer', body({}), '', 1000);
  assert.deepEqual(landAsk(moved, {answers: []}, 'https://jobs.example/next', 2000), {answer: null, dropped: 'moved'});
});

test('guarded(): through the wrapper, with the tab\'s address from the browser; a route with no tab or no address is untouched', async () => {
  forgetJudgments(5);
  const urls = [PAGE, PAGE, PAGE, PAGE];
  globalThis.chrome = {tabs: {get: async () => ({url: urls[0]}), onRemoved: {addListener() {}}}};
  const logged = [];
  try {
    const slow = guarded(5, '/extension/page-kind', body({digest: true}), async () => { await new Promise(done => setTimeout(done, 30)); return kind('posting', 0.6); }, (what, fields) => logged.push({what, fields}));
    await new Promise(done => setTimeout(done, 5));
    const quick = await guarded(5, '/extension/page-kind', body({}), async () => kind('account-form', 0.9));
    assert.equal(quick.kind, 'account-form');
    assert.equal((await slow).kind, 'account-form');
    assert.deepEqual(logged, [{what: 'late answer dropped: a newer judgment of this page landed', fields: {route: '/extension/page-kind'}}]);
    assert.equal(await guarded(null, '/extension/page-kind', body({}), async () => 'x'), 'x', 'no tab: nothing to guard');
    assert.equal(await guarded(5, '/extension/event', body({}), async () => 'ok'), 'ok', 'not an answer applied to a page');
  } finally { delete globalThis.chrome; }
});

test('class: every route a call asks with a tab is guarded or exempt, and api() goes through guarded()', () => {
  const root = new URL('../../extension/', import.meta.url).pathname;
  const files = [];
  const walk = dir => { for (const entry of fs.readdirSync(dir, {withFileTypes: true})) { const next = path.join(dir, entry.name); if (entry.isDirectory()) { if (!['page', 'node_modules'].includes(entry.name)) walk(next); } else if (entry.name.endsWith('.js')) files.push(next); } };
  walk(root);
  const used = new Set();
  for (const file of files) for (const [, route] of fs.readFileSync(file, 'utf8').matchAll(/\bapiFor\([^,()]+,\s*[^,()]+(?:\([^()]*\))?,\s*[`'](\/extension\/[a-z-]+)/g)) used.add(route);
  assert.ok(used.has('/extension/page-kind') && used.has('/extension/escalate') && used.has('/extension/account-judge'), [...used].join(', '));
  const unclassified = [...used].filter(route => !GUARDED_ROUTES.includes(route) && !EXEMPT_ROUTES.includes(route));
  assert.deepEqual(unclassified, [], 'a new ask with a tab: name its route in GUARDED_ROUTES (an AI answer applied to a page) or EXEMPT_ROUTES (read-gen.js)');
  assert.match(fs.readFileSync(path.join(root, 'flow.js'), 'utf8'), /return await guarded\(tabId, path, init, \(\) => apiCall\(config, path, init, retry, trace\)/);
});
