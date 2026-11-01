// The discovery batch's two commands end to end on fake data: pick (site input + earlier states -> rows file, outputs, cap alert once a week) and report (verdicts, ONE message, state file).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {fetchInput, main as pick, readStates} from '../../discovery-pick.mjs';
import {main as report} from '../../discovery-report.mjs';
import {postTelegram} from '../../lib/telegram-post.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'discovery-'));
const quiet = async fn => { const log = console.log; const lines = []; console.log = (...args) => lines.push(args.join(' ')); try { return {value: await fn(), lines}; } finally { console.log = log; } };
const NOW = '2026-10-17T06:00:00Z';
const input = {candidates: [{url: 'https://jobs.elastic.co/jobs/1', host: 'jobs.elastic.co', source: 'matches', installs: 1}, {url: 'https://www.mongodb.com/careers/2', host: 'www.mongodb.com', source: 'matches', installs: 1}], demand: [], misses: []};
const withInput = async fn => { const real = globalThis.fetch; globalThis.fetch = async () => new Response(JSON.stringify(input)); try { return await fn(); } finally { globalThis.fetch = real; } };
const env = extra => ({REPLAYS_PUBLISH_KEY: 'k', DISCOVERY_NOW: NOW, GITHUB_OUTPUT: path.join(tmp(), 'out.txt'), ...extra});

test('pick writes the rows file in the pool\'s format and the outputs the next job reads; no candidate means count 0', async () => {
  const out = tmp(), states = tmp(), e = env();
  await withInput(() => quiet(() => pick([out, states], e, async () => 'sent')));
  const rows = JSON.parse(fs.readFileSync(path.join(out, 'discovery-rows.json'), 'utf8'));
  assert.deepEqual(rows.shapes.map(row => row.shape), ['Discovery: jobs.elastic.co', 'Discovery: mongodb.com']);
  const outputs = fs.readFileSync(e.GITHUB_OUTPUT, 'utf8');
  assert.match(outputs, /^count=2$/m);
  assert.match(outputs, /^only=Discovery: jobs\.elastic\.co\|Discovery: mongodb\.com$/m);
  assert.match(outputs, /^max_usd=0\.24$/m);
  // the same candidates again, now recorded by an earlier run: nothing new
  const before = tmp(); fs.mkdirSync(path.join(before, '1')); fs.writeFileSync(path.join(before, '1', 'discovery.json'), JSON.stringify({at: '2026-10-16T06:00:00Z', usd: 0.12, rows: rows.shapes.map(row => ({shape: row.shape, url: row.urls[0], verdict: 'fine'}))}));
  const e2 = env();
  await withInput(() => quiet(() => pick([tmp(), before], e2, async () => 'sent')));
  assert.match(fs.readFileSync(e2.GITHUB_OUTPUT, 'utf8'), /^count=0$/m);
});

test('a failing row of an earlier run rides along in the rows file (not picked again), a site error is a red job', async () => {
  const out = tmp(), states = tmp();
  fs.mkdirSync(path.join(states, '1'));
  fs.writeFileSync(path.join(states, '1', 'discovery.json'), JSON.stringify({at: '2026-10-16T06:00:00Z', usd: 0.1, rows: [{shape: 'Discovery: old.example', url: 'https://old.example/j/1', verdict: 'stopped-early'}, {shape: 'Discovery: fine.example', url: 'https://fine.example/j/1', verdict: 'fine'}]}));
  await withInput(() => quiet(() => pick([out, states], env(), async () => 'sent')));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out, 'discovery-rows.json'), 'utf8')).shapes.map(row => row.shape), ['Discovery: jobs.elastic.co', 'Discovery: mongodb.com', 'Discovery: old.example']);
  assert.equal(readStates(states).length, 1);
  await assert.rejects(() => fetchInput({env: {REPLAYS_PUBLISH_KEY: 'k'}, fetcher: async () => new Response('no', {status: 404})}), /answered 404/);
  await assert.rejects(() => fetchInput({env: {}}), /not set/);
});

test('at the week\'s cap nothing is recorded and the alert goes once: the next run finds the week told', async () => {
  const states = tmp(); fs.mkdirSync(path.join(states, '1'));
  fs.writeFileSync(path.join(states, '1', 'discovery.json'), JSON.stringify({at: '2026-10-15T06:00:00Z', usd: 2.98, rows: []}));
  const sent = [], out = tmp(), e = env();
  await withInput(() => quiet(() => pick([out, states], e, async text => { sent.push(text); return 'sent'; })));
  assert.match(fs.readFileSync(e.GITHUB_OUTPUT, 'utf8'), /^count=0$/m);
  assert.match(fs.readFileSync(e.GITHUB_OUTPUT, 'utf8'), /^cap_alert=1$/m);
  assert.match(sent[0], /paused: \$2\.98 of the \$3\.00 week cap/);
  const told = path.join(out, 'alert-state'), next = tmp(); fs.cpSync(told, path.join(next, '2'), {recursive: true}); fs.cpSync(path.join(states, '1'), path.join(next, '1'), {recursive: true});
  const e2 = env();
  await withInput(() => quiet(() => pick([tmp(), next], e2, async text => { sent.push(text); return 'sent'; })));
  assert.equal(sent.length, 1, 'told once');
  assert.match(fs.readFileSync(e2.GITHUB_OUTPUT, 'utf8'), /^cap_alert=0$/m);
});

test('report: one message when something failed, none when all is fine; the state file carries rows, spend and the verdicts', async () => {
  const reports = tmp(), picked = path.join(tmp(), 'picked.json'), form = extra => ({url: 'https://a.example/j/1', reached: 'form', ending: 'ready', cause: 'ready', usd: 0.06, signature: 'posting>form@a.example#form', ...extra});
  fs.writeFileSync(picked, JSON.stringify({rows: [{shape: 'Discovery: a.example', urls: ['https://a.example/j/1'], source: 'matches'}, {shape: 'Discovery: b.example', urls: ['https://b.example/j/1'], source: 'gaps'}]}));
  const run = async results => { fs.writeFileSync(path.join(reports, '2026-10-17.json'), JSON.stringify({day: '2026-10-17', results, thisRun: {ran: Object.keys(results)}})); const out = tmp(), sent = []; await quiet(() => report([reports, picked, out, tmp()], env(), async text => { sent.push(text); return 'x'; })); return {out, sent}; };
  const bad = await run({'Discovery: a.example': form(), 'Discovery: b.example': form({url: 'https://b.example/j/1', reached: 'posting', ending: 'unresolved', cause: 'no-reason', signature: 'posting@b.example#posting'})});
  assert.equal(bad.sent.length, 1);
  assert.match(bad.sent[0], /2 sites recorded, 1 failed/);
  const state = JSON.parse(fs.readFileSync(path.join(bad.out, 'discovery.json'), 'utf8'));
  assert.equal(state.usd, 0.12);
  assert.deepEqual(state.rows.map(row => row.verdict), ['fine', 'stopped-early']);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(bad.out, 'pool-add.json'), 'utf8')).map(row => row.shape), ['Discovery: a.example', 'Discovery: b.example']);
  const good = await run({'Discovery: a.example': form(), 'Discovery: b.example': form({url: 'https://b.example/j/1'})});
  assert.deepEqual(good.sent, [''], 'nothing failed: the sender is handed no text and sends nothing');
});

test('the Telegram sender sends nothing for no text, skips without keys, and never prints the token', async () => {
  const calls = [];
  const fetcher = async (url, init) => { calls.push([url, JSON.parse(init.body)]); return new Response('{}', {status: 200}); };
  assert.equal(await postTelegram('', {env: {BUILDLOG_TELEGRAM_TOKEN: 't', BUILDLOG_TELEGRAM_CHAT: 'c'}, fetcher}), 'telegram: nothing to say');
  assert.match(await postTelegram('hi', {env: {}, fetcher}), /not sent/);
  assert.equal(await postTelegram('hi', {env: {BUILDLOG_TELEGRAM_TOKEN: 't', BUILDLOG_TELEGRAM_CHAT: 'c'}, fetcher}), 'telegram: sent');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].chat_id, 'c');
});

test('a row that reached a new shape is added to the pool list once; a known name or posting is left alone', async () => {
  const {addRows} = await import('../../discovery-pool-add.mjs');
  const pool = {about: 'x', shapes: [{shape: 'Lever row', urls: ['https://jobs.lever.co/a/1']}]};
  const added = addRows(pool, [{shape: 'Discovery: a.example', urls: ['https://a.example/j/1'], signature: 'posting>form@a.example#form'}, {shape: 'Lever row', urls: ['https://x.example/1']},
    {shape: 'Discovery: dup.example', urls: ['https://jobs.lever.co/a/1']}, {shape: 'Discovery: a.example', urls: ['https://a.example/j/2']}, {shape: 'no urls', urls: []}]);
  assert.deepEqual(added, ['Discovery: a.example']);
  assert.deepEqual(pool.shapes.at(-1), {shape: 'Discovery: a.example', urls: ['https://a.example/j/1'], signature: 'posting>form@a.example#form'});
  assert.equal(pool.shapes.length, 2);
});
