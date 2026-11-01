// LinkedIn jobs, refresh at each Find jobs (issue #2731; spec docs/superpowers/specs/2026-10-31-linkedin-headless-design.md, Behaviour 1). The press asks the extension for a fresh copy of the
// session and waits for its next look; a closed Chrome, a Stop or a silent extension never fails or holds the press. Fake clock and fake extension: no real wait, no real LinkedIn session.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ALIVE_MS, WAIT_MS, createRefresh} from '../lib/linkedin-refresh.js';

function clock() {
  let t = 1_000_000; const timers = [];
  return {now: () => t, later: (fn, ms) => { const entry = {at: t + ms, fn}; timers.push(entry); return () => timers.splice(timers.indexOf(entry) >>> 0, 1); },
    advance(ms) { t += ms; for (const entry of timers.filter(item => item.at <= t)) { timers.splice(timers.indexOf(entry), 1); entry.fn(); } }};
}

test('the extension\'s look sees "wanted" only while a press waits, and its answer lets the press go on', async () => {
  const c = clock(), note = createRefresh(c), said = [];
  assert.equal(note.look(), false, 'nothing wanted before a press');
  const asked = note.ask({say: line => said.push(line)});
  assert.equal(note.look(), true, 'the press is waiting: the next look gets "copy now"');
  assert.deepEqual(said, ['LinkedIn: copying your sign-in from Chrome again']);
  note.delivered();
  assert.equal(await asked, 'fresh');
  assert.equal(note.look(), false, 'once delivered it is not asked again');
});

test('no look in the last 2.5 minutes (Chrome closed, grants gone): the press does not wait at all', async () => {
  const c = clock(), note = createRefresh(c), said = [];
  assert.equal(await note.ask({say: line => said.push(line)}), 'no-extension', 'never looked');
  note.look(); c.advance(ALIVE_MS + 1);
  assert.equal(await note.ask({say: line => said.push(line)}), 'no-extension');
  assert.deepEqual(said, [], 'and says nothing about copying');
});

test('an extension that looked but never answers: the press goes on with the held copy after the cap', async () => {
  const c = clock(), note = createRefresh(c);
  note.look();
  const asked = note.ask();
  c.advance(WAIT_MS - 1);
  assert.equal(note.look(), true);
  c.advance(1);
  assert.equal(await asked, 'late');
  assert.equal(note.look(), false);
});

test('Stop ends the wait at once, and an aborted press never asks', async () => {
  const c = clock(), note = createRefresh(c), stop = new AbortController();
  note.look();
  const asked = note.ask({signal: stop.signal});
  stop.abort();
  assert.equal(await asked, 'stopped');
  const already = new AbortController(); already.abort();
  assert.equal(await note.ask({signal: already.signal}), 'stopped');
  assert.equal(note.look(), false, 'a stopped press leaves nothing wanted');
});
