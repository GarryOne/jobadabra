// Telegram's buttons with the data on this Mac, against the REAL SQLite store (D6 audit, 9 Oct 2026): the bot's own handler
// (shared/app-core handleUpdate) with the store seam (lib/store/telegram-store.js) reading and writing a temp data folder through the engine's
// adapter, and the engine mode a dispatched button starts (src/daily.py --mode apply). Isolated: a temp folder, no Notion token, no app-following,
// Telegram's API stubbed (nothing leaves this process but the python calls).
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {handleUpdate} from '../shared/app-core/index.js';
import {telegramStore} from '../lib/store/telegram-store.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const python = process.env.JOBADABRA_CHECK_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-telegram-sqlite-'));
const data = path.join(folder, 'data');
const env = {PATH: process.env.PATH, HOME: folder, JOBADABRA_STORE: 'sqlite', JOBADABRA_DATA_DIR: data, JOBADABRA_FOLLOW_APP: '0',
  JOBADABRA_DISABLE: 'mail,notion,telegram,google_jobs', PYTHONUTF8: '1'};
const call = async (_storage, entity, method, kwargs = {}) => {
  const out = execFileSync(python, ['-m', 'src.stores', 'call', entity, method, JSON.stringify(kwargs)], {cwd: REPO, env, encoding: 'utf8'});
  const answer = JSON.parse(out.trim().split('\n').pop());
  if (answer.error) throw new Error(`${entity}.${method}: ${answer.error}`);
  return answer.result;
};
const sent = [];
globalThis.fetch = async (url, init) => { sent.push({url: String(url), body: JSON.parse(init?.body || '{}')}); return {ok: true, json: async () => ({ok: true, result: {}})}; };
const dispatched = [];
const bot = {store: telegramStore({}, {call}), TELEGRAM_BOT_TOKEN: 'bot', OWNER_CHAT_ID: '1', dispatch: async inputs => { dispatched.push(inputs); }};
const tap = data => handleUpdate(bot, {callback_query: {id: 'q', data, from: {id: 1}, message: {chat: {id: 1}, message_id: 5, reply_markup: {inline_keyboard: []}}}});
const answers = () => sent.filter(each => each.url.endsWith('/answerCallbackQuery')).map(each => each.body.text);
test.after(() => fs.rmSync(folder, {recursive: true, force: true}));

test('an outcome tap writes the stage and a Telegram event to this Mac\'s store, and says nothing of Notion', async () => {
  const app = await call({}, 'applications', 'create', {job: {url: 'https://jobs.test/out', title: 'SRE', company: 'Acme'}, stage: 'Applied'});
  await tap(`out:i:${app.id}:1`);
  assert.equal((await call({}, 'applications', 'get', {url: 'https://jobs.test/out'})).stage, 'Interview scheduled');
  const events = await call({}, 'events', 'list', {app_id: app.id});
  assert.deepEqual(events.map(event => [event.kind, event.source]), [['Interview scheduled', 'Telegram']]);
  assert.match(answers().at(-1), /^SRE: Interview scheduled\. Saved\.$/);
});

test('an insight\'s 👍 is kept on the insight, its other fields kept', async () => {
  const insight = await call({}, 'insights', 'add', {record: {day: '2026-10-09', category: 'Timing', title: 'Replies come fast', fields: {evidence: '3 of 4'}}});
  await tap(`ins:u:${insight.id}`);
  const kept = (await call({}, 'insights', 'list', {})).find(row => row.id === insight.id);
  assert.deepEqual(kept.fields, {evidence: '3 of 4', feedback: 'Useful'});
});

test('/saved and /applied list this Mac\'s applications', async () => {
  await call({}, 'applications', 'create', {job: {url: 'https://jobs.test/saved', title: 'Platform', company: 'Globex'}, stage: 'Saved'});
  await handleUpdate(bot, {message: {chat: {id: 1}, text: '/saved'}});
  await handleUpdate(bot, {message: {chat: {id: 1}, text: '/applied'}});
  const texts = sent.filter(each => each.url.endsWith('/sendMessage')).map(each => each.body.text);
  assert.ok(texts.some(text => /Platform/.test(text) && /Globex/.test(text)), '/saved');
  assert.ok(texts.some(text => /SRE/.test(text) && /Acme/.test(text)), '/applied');
});

test('✅ / ⭐ / ❌ dispatch the apply mode; the engine writes that stage to this Mac\'s store', async () => {
  const urls = {applied: 'https://jobs.test/a', saved: 'https://jobs.test/s', dismissed: 'https://jobs.test/d'};
  const code = url => execFileSync(python, ['-c', `from src.notion.client import job_code; print(job_code(${JSON.stringify(url)}))`], {cwd: REPO, env, encoding: 'utf8'}).trim();
  for (const url of Object.values(urls)) await call({}, 'applications', 'create', {job: {url, title: 'Role', company: 'Initech'}, stage: 'Kit ready'});
  const letters = {applied: 'a', saved: 's', dismissed: 'd'};
  for (const [want, url] of Object.entries(urls)) {
    dispatched.length = 0;
    await tap(`act:${letters[want]}:${code(url)}:1`);
    const [inputs] = dispatched;
    assert.deepEqual(inputs, {mode: 'apply', job: code(url), action: want});
    // What the desktop's local dispatch runs for it (lib/telegram.js → pipeline.run → src.daily), on the same store.
    execFileSync(python, ['-m', 'src', 'daily', '--mode', 'apply', '--job', inputs.job, '--action', inputs.action], {cwd: REPO, env, encoding: 'utf8'});
    const stage = (await call({}, 'applications', 'get', {url})).stage;
    assert.equal(stage, {applied: 'Applied', saved: 'Saved', dismissed: 'Dismissed'}[want], want);
  }
  assert.equal(answers().filter(text => /Notion/.test(text)).length, 0, 'no button answer names Notion on this Mac');
});
