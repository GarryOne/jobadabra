// Every tab the app opens for an application carries its session in its address from its first page (owner's class rule, 12 Oct 2026;
// spec docs/superpowers/specs/2026-10-12-tab-owned.md). Openers: apply.js openOne (Apply, Start again, Reopen, the confirmation link), apply.js start
// ("Apply to N jobs"), claude-session.js prompt (Claude's own tab). A new opener with a bare mark fails the scan below.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import * as apply from '../lib/apply.js';
import * as terminals from '../lib/terminals.js';
import {sessionTabUrl} from '../lib/session-tab.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const opened = () => { const calls = []; const open = (...args) => { calls.push(args); return {unref() {}}; }; return {calls, open}; };
const urlsOf = calls => calls.flatMap(args => args.flat(3).filter(item => typeof item === 'string' && item.startsWith('http')));

test('a session\'s tab address names it, and a tab with no session is refused', () => {
  assert.equal(sessionTabUrl('https://forms.example/a/1#top', 's9'), 'https://forms.example/a/1#jobpilotto-fill=s9');
  const {calls, open} = opened();
  assert.equal(apply.openOne('https://forms.example/a/1', {open}).ok, false);
  assert.equal(calls.length, 0);
  assert.equal(apply.openOne('https://forms.example/a/1', {session: 's9', open}).ok, true);
  assert.ok(urlsOf(calls).some(url => url.endsWith('#jobpilotto-fill=s9')));
});

test('Apply: the tab it opens carries the id of the session it creates (an open session on the job keeps its own id)', async () => {
  terminals._reset();
  const {calls, open} = opened();
  const first = await apply.applyOne({}, 'https://forms.example/a/1', {company: 'A'}, {open, id: () => 'f1', run: async () => {}});
  assert.equal(first.session.id, 'f1');
  await apply.applyOne({}, 'https://forms.example/a/1', {company: 'A'}, {open, id: () => 'f2', run: async () => {}});   // reopens only the tab: of the SAME session
  assert.deepEqual(urlsOf(calls).map(url => url.split('#')[1]), ['jobpilotto-fill=f1', 'jobpilotto-fill=f1']);
});

test('Apply to N jobs: each tab carries the session made for its job', async () => {
  terminals._reset();
  const {calls, open} = opened();
  const jobs = [1, 2].map(n => ({url: `https://forms.example/a/${n}`, title: `T${n}`, company: `C${n}`, kit: true, status: 'saved', score: 90 - n}));
  const result = await apply.start({settings: () => ({}), path: () => '', dir: ''}, {n: 2, mode: 'tabs'}, open, async () => ({jobs}), undefined, () => jobs.map(job => job.url), null, () => {});
  assert.equal(result.ok, true, result.error);
  const marks = urlsOf(calls).map(url => url.split('#')[1]);
  assert.equal(marks.length, 2);
  assert.deepEqual(marks.map(mark => mark.replace('jobpilotto-fill=', '')).sort(), terminals.list().map(session => session.id).sort());
});

test('nothing builds the fill mark by hand: the address always goes through sessionTabUrl (or the prompt that is given the session)', () => {
  const dir = path.join(here, '..', 'lib');
  for (const name of fs.readdirSync(dir).filter(file => file.endsWith('.js'))) {
    if (['session-tab.js', 'review.js'].includes(name)) continue;   // the one builder; review.js only names the mark in a comment
    const lines = fs.readFileSync(path.join(dir, name), 'utf8').split('\n');
    const hit = lines.findIndex(line => /#\$\{FILL_MARK\}|#jobpilotto-fill/.test(line.replace(/\/\/.*$/, '')) && !(name === 'claude-session.js' && /session/.test(line)));
    assert.equal(hit, -1, `${name}:${hit + 1} puts the fill mark on an address by hand: use sessionTabUrl(url, sessionId)`);
  }
});
