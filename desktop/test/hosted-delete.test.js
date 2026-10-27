// Always on "on our servers": delete my data at any time, also when it is off, and the time the profile was last copied there (owner, 27 Oct 2026:
// "we should check if we offer a 'delete/destroy my data'. I think we should give at any time this option. But also when the user disabled the 'Always on'.
// Also, we should show him when last time his personal data was copied on our servers"). lib/hosted-search.js deleteData, copiedAt, deletedAt; renderer/hosted-words.js.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {deleteData, pushConfig, state, turnOff} from '../lib/hosted-search.js';
import {model, stamp} from '../renderer/hosted-words.js';

const FREE = 'JPF1.install-0001.tok';
function store(settings = {}, key = FREE) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-hosted-del-')), mine = {...settings};
  fs.mkdirSync(path.join(dir, 'config'));
  fs.writeFileSync(path.join(dir, 'config', 'search.json'), '{}');
  return {dir, settings: () => mine, saveSettings: patch => Object.assign(mine, patch), secret: name => (name === 'ANTHROPIC_API_KEY' ? key : ''), setSecret() {}, path: name => path.join(dir, name)};
}
function site(routes) {
  const calls = [];
  const fetcher = async (url, init = {}) => {
    const key = `${init.method || 'GET'} ${new URL(url).pathname}`;
    calls.push(key);
    const answer = routes[key];
    return answer ? Response.json(answer.body ?? answer, {status: answer.status || 200}) : Response.json({ok: false, error: 'no route'}, {status: 404});
  };
  return {calls, fetcher};
}
const recent = iso => Date.now() - Date.parse(iso) < 60000;

test('a profile copied to our servers is remembered with its time; a failed copy keeps the last good time', async () => {
  const st = store({hostedSearch: {on: true, copiedAt: '2026-10-20T08:00:00.000Z'}});
  await pushConfig(st, {fetcher: site({'PUT /api/hosted/config': {status: 500, body: {ok: false}}}).fetcher});
  assert.equal(state(st).copiedAt, '2026-10-20T08:00:00.000Z');
  await pushConfig(st, {fetcher: site({'PUT /api/hosted/config': {ok: true}}).fetcher});
  assert.ok(recent(state(st).copiedAt));
});

test('turning off deletes, forgets the copy time and remembers when it was deleted', async () => {
  const st = store({hostedSearch: {on: true, email: 'a@example.com', copiedAt: '2026-10-26T08:00:00.000Z'}});
  await turnOff(st, {fetcher: site({'DELETE /api/hosted/data': {ok: true}, 'PUT /api/hosted/schedule': {ok: true}}).fetcher});
  assert.equal(state(st).copiedAt, '');
  assert.ok(recent(state(st).deletedAt));
});

test('delete my data works while Always on is off: it asks our servers and deletes whatever is left', async () => {
  const st = store({hostedSearch: {on: false, skipped: true}}), s = site({'DELETE /api/hosted/data': {ok: true, receipt: {objects: 1}}, 'PUT /api/hosted/schedule': {ok: true}});
  const done = await deleteData(st, {fetcher: s.fetcher});
  assert.deepEqual(s.calls, ['DELETE /api/hosted/data', 'PUT /api/hosted/schedule']);
  assert.deepEqual([done.ok, state(st).on, state(st).skipped], [true, false, true]);
  assert.ok(recent(state(st).deletedAt));
});

test('delete my data with no account on our servers (401) is done: nothing is held', async () => {
  const st = store({hostedSearch: {skipped: true}});
  const done = await deleteData(st, {fetcher: site({'DELETE /api/hosted/data': {status: 401, body: {ok: false}}, 'PUT /api/hosted/schedule': {status: 401, body: {ok: false}}}).fetcher});
  assert.equal(done.ok, true);
  assert.ok(recent(state(st).deletedAt));
});

test('a failed delete says so and claims nothing', async () => {
  const st = store({hostedSearch: {skipped: true}});
  const done = await deleteData(st, {fetcher: site({'DELETE /api/hosted/data': {status: 503, body: {ok: false, error: 'Down'}}}).fetcher});
  assert.equal(done.ok, false);
  assert.equal(state(st).deletedAt, undefined);
});

test('an install with no key never sent anything: nothing to delete, no call', async () => {
  const st = store({}, ''), s = site({});
  assert.deepEqual(await deleteData(st, {fetcher: s.fetcher}), {ok: true, nothing: true});
  assert.deepEqual(s.calls, []);
});

test('the card offers "Delete our copy" only while off and only when we hold a copy, whatever the store; it says when the profile was copied or deleted', () => {
  const now = new Date(2026, 9, 27, 12, 0), at = (d, h, m) => new Date(2026, 9, d, h, m).toISOString();
  const on = model({on: true, email: 'a@example.com', copiedAt: at(27, 9, 14)}, null, now);
  assert.equal(on.erase, false);   // "Turn off and delete" covers it while on
  assert.equal(on.held, 'Your profile was last copied to our servers today at 9:14.');
  // Never copied to us (a Notion or SQLite user who never used Always on): no button, nothing said. The store plays no part (owner, 27 Oct 2026).
  for (const mine of [{skipped: true, email: 'a@example.com'}, {email: 'a@example.com'}, {skipped: true}, {}]) {
    for (const store of ['sqlite', 'notion']) assert.deepEqual([model({...mine, store}, null, now).erase, model({...mine, store}, null, now).held], [false, ''], JSON.stringify({mine, store}));
  }
  // A delete that failed leaves our copy: the button stays and the line says so.
  const left = model({skipped: true, email: 'a@example.com', copiedAt: at(26, 8, 0)}, null, now);
  assert.deepEqual([left.erase, left.held], [true, 'A copy of your profile is still on our servers (copied 26 Oct at 8:00).']);
  const gone = model({skipped: true, email: 'a@example.com', deletedAt: at(26, 10, 2)}, null, now);
  assert.deepEqual([gone.erase, gone.held], [false, 'Nothing of yours is on our servers (deleted 26 Oct at 10:02).']);
  assert.equal(stamp('nope', now), '');
});
