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

test('the card offers delete in every state that is not on, and says when the profile was last copied or deleted', () => {
  const now = new Date(2026, 9, 27, 12, 0);
  const on = model({on: true, email: 'a@example.com', copiedAt: new Date(2026, 9, 27, 9, 14).toISOString()}, null, now);
  assert.equal(on.erase, false);   // "Turn off and delete" covers it while on
  assert.equal(on.held, 'Your profile was last copied to our servers today at 9:14.');
  for (const mine of [{skipped: true, email: 'a@example.com'}, {email: 'a@example.com'}, {skipped: true}, {}]) assert.equal(model(mine, null, now).erase, true, JSON.stringify(mine));
  assert.equal(model({skipped: true, email: 'a@example.com', deletedAt: new Date(2026, 9, 26, 10, 2).toISOString()}, null, now).held, 'Nothing of yours is on our servers (deleted 26 Oct at 10:02).');
  assert.equal(model({skipped: true, email: 'a@example.com'}, null, now).held, '');
  assert.equal(stamp('nope', now), '');
});
