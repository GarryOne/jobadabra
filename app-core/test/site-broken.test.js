// The site_broken ending (extension/ladder/site-broken.js; spec 2026-10-12-one-next-move.md phase 1a): an error page or an unreadable one with no form is loaded again a few
// times, then reported plainly; a page a form led to is never loaded again; a form served with an error code is still filled.
import assert from 'node:assert/strict';
import test from 'node:test';
import {GONE, TRIES, brokenNeed, brokenOf, closedOf, forgetBroken, noteCommitted, onBrokenPage} from '../../extension/ladder/site-broken.js';

const shape = (status, fields = 0) => ({fields, textareas: 0, files: 0, status});

test('which page is broken: an error or gone status with no form, or a page that could not be read; never a form, never a wall the AI judges', () => {
  assert.equal(brokenOf(null), 'unreadable');
  for (const status of GONE) assert.equal(brokenOf(shape(status)), 'gone');
  for (const status of [500, 502, 503, 504, 599]) assert.equal(brokenOf(shape(status)), 'error');
  for (const status of [0, 200, 201, 301, 401, 403, 429, 600]) assert.equal(brokenOf(shape(status)), null, `${status}: not ours to call broken (a wall, a redirect, unknown)`);
  assert.equal(brokenOf(shape(503, 2)), null, 'a form served with an error code is filled');
  assert.equal(brokenOf({...shape(404), textareas: 1, files: 1}), null);
});

test('what the person reads: a fixed sentence per kind, with the status, at most 80 characters', () => {
  for (const [kind, status] of [['gone', 404], ['gone', 410], ['error', 503], ['unreadable', 0]]) {
    const need = brokenNeed(kind, status);
    assert.ok(need.length <= 80, need);
    if (status) assert.match(need, new RegExp(String(status)));
  }
});

// A fake flow: the loads, waits, reports and steps it was asked for.
function flow(tabId, page = 'https://jobs.example/1') {
  const calls = {reloads: 0, waits: [], reports: [], said: [], logged: []};
  return {calls, deps: {key: `${tabId} ${page}`, tabId, host: 'jobs.example', wait: async ms => { calls.waits.push(ms); }, reload: async () => { calls.reloads += 1; },
    report: async need => { calls.reports.push(need); }, say: text => calls.said.push(text), decide: (area, what) => calls.logged.push(what)}};
}

test('an error page is loaded again after each wait, then reported once with its status; the steps say so', async () => {
  noteCommitted({tabId: 1, frameId: 0, transitionType: 'link'});
  const {calls, deps} = flow(1);
  const outcomes = [];
  for (let load = 0; load <= TRIES.error.length; load++) outcomes.push(await onBrokenPage('error', {...deps, status: 503}));
  assert.deepEqual(outcomes, ['retry', 'retry', 'reported']);
  assert.deepEqual(calls.waits, TRIES.error);
  assert.equal(calls.reloads, 2);
  assert.deepEqual(calls.reports, [brokenNeed('error', 503)]);
  assert.match(calls.said[0], /503/);
  assert.deepEqual(calls.logged, ['a broken page: loading it again', 'a broken page: loading it again', 'a broken page: reported as site_broken']);
  forgetBroken(1);
});

test('a gone posting is reported at once; an unreadable page is loaded again once', async () => {
  noteCommitted({tabId: 2, frameId: 0, transitionType: 'typed'});
  const gone = flow(2);
  assert.equal(await onBrokenPage('gone', {...gone.deps, status: 404}), 'reported');
  assert.equal(gone.calls.reloads, 0);
  assert.deepEqual(gone.calls.reports, ['This posting is gone: the site answered 404']);
  const unreadable = flow(2, 'https://jobs.example/2');
  assert.deepEqual([await onBrokenPage('unreadable', unreadable.deps), await onBrokenPage('unreadable', unreadable.deps)], ['retry', 'reported']);
  forgetBroken(2);
});

test('a page a form led to (or one whose start was not seen) is never loaded again: a reload could send the form twice', async () => {
  noteCommitted({tabId: 3, frameId: 0, transitionType: 'form_submit'});
  const posted = flow(3);
  assert.equal(await onBrokenPage('error', {...posted.deps, status: 502}), 'reported');
  assert.equal(posted.calls.reloads, 0);
  noteCommitted({tabId: 3, frameId: 7, transitionType: 'link'});   // a frame's commit changes nothing
  assert.equal(await onBrokenPage('error', {...flow(3, 'https://jobs.example/x').deps, status: 502}), 'reported');
  const unseen = flow(99);
  assert.equal(await onBrokenPage('error', {...unseen.deps, status: 500}), 'reported');
  assert.equal(unseen.calls.reloads, 0);
  assert.equal(await onBrokenPage(null, unseen.deps), null, 'not broken: nothing done');
  forgetBroken(3);
});

test('a closed tab is forgotten: a new tab with its id starts with fresh tries', async () => {
  noteCommitted({tabId: 4, frameId: 0, transitionType: 'link'});
  const first = flow(4);
  await onBrokenPage('unreadable', first.deps);
  forgetBroken(4);
  noteCommitted({tabId: 4, frameId: 0, transitionType: 'link'});
  assert.equal(await onBrokenPage('unreadable', flow(4).deps), 'retry');
  forgetBroken(4);
});

test('a posting the page-kind AI calls closed is reported at once, never loaded again, and only when the page shows no form', () => {
  assert.equal(closedOf({kind: 'closed'}, shape(200)), 'closed');   // a 200 "not found" page: no status says gone
  assert.equal(closedOf({kind: 'closed'}, shape(200, 2)), null, 'a form is there: the AI is overruled (AND)');
  assert.equal(closedOf({kind: 'closed'}, null), null);
  for (const kind of ['posting', 'other', 'form', 'account', undefined]) assert.equal(closedOf({kind}, shape(200)), null, String(kind));
  assert.deepEqual(TRIES.closed, []);
  assert.equal(brokenNeed('closed', 200), 'This posting is closed');
});
