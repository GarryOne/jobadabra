import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker, { afterAction, appliedKeyboard, formatApplied, formatSaved, parseCommand, withActionRow, withOutcomeRows } from '../src/index.js';

const env = {
  TELEGRAM_BOT_TOKEN: 'tg', OWNER_CHAT_ID: '42', WEBHOOK_SECRET: 's3cret', GITHUB_TOKEN: 'gh',
  NOTION_TOKEN: 'nt', GITHUB_REPO: 'owner/repo', WORKFLOW_FILE: 'daily.yml', NOTION_APPLICATIONS_DB: 'db1',
  NOTION_EVENTS_DB: 'ev1',
};

// Replace fetch with a recorder; respond by URL.
function mockFetch(responses = {}) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, body: init.body ? JSON.parse(init.body) : null, headers: init.headers });
    const key = Object.keys(responses).find((k) => url.includes(k));
    const r = key ? responses[key] : { status: 200, json: { ok: true } };
    return new Response(r.status === 204 ? null : JSON.stringify(r.json ?? {}), { status: r.status ?? 200 });
  };
  return calls;
}

async function send(text, { chatId = 42, secret = 's3cret' } = {}) {
  const pending = [];
  const request = new Request('https://bot.test/telegram', {
    method: 'POST',
    headers: { 'X-Telegram-Bot-Api-Secret-Token': secret },
    body: JSON.stringify({ message: { chat: { id: chatId }, text } }),
  });
  const response = await worker.fetch(request, env, { waitUntil: (p) => pending.push(p) });
  await Promise.all(pending);
  return response;
}

test('parses commands, codes and bot suffixes', () => {
  assert.deepEqual(parseCommand('/apply_AB12cd34@sre_job_pilotto_bot'), { name: 'apply', arg: 'ab12cd34' });
  assert.deepEqual(parseCommand('/run'), { name: 'run', arg: '' });
  assert.equal(parseCommand('hello'), null);
});

test('rejects requests without the webhook secret', async () => {
  const calls = mockFetch();
  const response = await send('/run', { secret: 'wrong' });
  assert.equal(response.status, 403);
  assert.equal(calls.length, 0);
});

test('ignores chats other than the owner', async () => {
  const calls = mockFetch();
  assert.equal((await send('/run', { chatId: 7 })).status, 200);
  assert.equal(calls.length, 0);
});

test('/apply_<code> dispatches the workflow and confirms', async () => {
  const calls = mockFetch({ '/dispatches': { status: 204 } });
  await send('/apply_ab12cd34');
  assert.match(calls[0].url, /repos\/owner\/repo\/actions\/workflows\/daily\.yml\/dispatches$/);
  assert.deepEqual(calls[0].body, { ref: 'main', inputs: { mode: 'apply', job: 'ab12cd34' } });
  assert.equal(calls[1].body.chat_id, '42');
  assert.match(calls[1].body.text, /Marking it applied/);
});

async function tap(data, { chatId = 42, markup } = {}) {
  const pending = [];
  const request = new Request('https://bot.test/telegram', {
    method: 'POST',
    headers: { 'X-Telegram-Bot-Api-Secret-Token': 's3cret' },
    body: JSON.stringify({ callback_query: { id: 'q1', data,
      message: { chat: { id: chatId }, message_id: 9, reply_markup: markup } } }),
  });
  await worker.fetch(request, env, { waitUntil: (p) => pending.push(p) });
  await Promise.all(pending);
}

const digestMarkup = { inline_keyboard: [
  [{ text: '1', callback_data: 'pick:ab12cd34:1' }, { text: '2', callback_data: 'pick:cd34ef56:2' }],
  [{ text: '➕ Next 10', callback_data: 'more:7:2' }]] };

test('tapping a number adds an action row for that job', async () => {
  const calls = mockFetch();
  await tap('pick:cd34ef56:2', { markup: digestMarkup });
  assert.match(calls[0].url, /editMessageReplyMarkup$/);
  const rows = calls[0].body.reply_markup.inline_keyboard;
  assert.deepEqual(rows[0].map((b) => b.callback_data), ['act:a:cd34ef56:2', 'act:s:cd34ef56:2', 'act:d:cd34ef56:2', 'close']);
  assert.deepEqual(rows[1].map((b) => b.callback_data), ['act:p:cd34ef56:2']);
  assert.equal(rows.length, 4);
});

test('Prepare dispatches a prepare run and marks the number', async () => {
  const calls = mockFetch({ '/dispatches': { status: 204 } });
  await tap('act:p:cd34ef56:2', { markup: withActionRow(digestMarkup, 'cd34ef56', 2) });
  assert.deepEqual(calls[0].body, { ref: 'main', inputs: { mode: 'prepare', job: 'cd34ef56' } });
  const rows = calls[1].body.reply_markup.inline_keyboard;
  assert.equal(rows.length, 2);  // both action rows removed
  assert.equal(rows[0][1].text, '📝 2');
  assert.match(calls[2].body.text, /application kit/);
});

test('Save dispatches a saved action and stars the number', async () => {
  const calls = mockFetch({ '/dispatches': { status: 204 } });
  await tap('act:s:cd34ef56:2', { markup: withActionRow(digestMarkup, 'cd34ef56', 2) });
  assert.deepEqual(calls[0].body, { ref: 'main', inputs: { mode: 'apply', job: 'cd34ef56', action: 'saved' } });
  const rows = calls[1].body.reply_markup.inline_keyboard;
  assert.equal(rows.length, 2);  // action row removed
  assert.equal(rows[0][1].text, '⭐ 2');
  assert.match(calls[2].url, /answerCallbackQuery$/);
});

test('Dismiss and Applied map to their actions', () => {
  assert.equal(afterAction(digestMarkup, 1, '❌').inline_keyboard[0][0].text, '❌ 1');
});

test('/saved lists saved jobs', () => {
  assert.match(formatSaved([], 'x'), /No saved jobs/);
  const page = { properties: { Job: { title: [{ plain_text: 'SRE' }] }, Company: { rich_text: [{ plain_text: 'Acme' }] },
    'Job URL': { url: 'https://x.test/1' } } };
  assert.match(formatSaved([page], 'https://n.test'), /Saved jobs<\/b>\n1 saved/);
});

test('legacy ✅ button dispatches apply and answers the tap', async () => {
  const calls = mockFetch({ '/dispatches': { status: 204 } });
  await tap('apply:ab12cd34');
  assert.deepEqual(calls[0].body, { ref: 'main', inputs: { mode: 'apply', job: 'ab12cd34', action: 'applied' } });
  assert.match(calls[1].url, /answerCallbackQuery$/);
  assert.equal(calls[1].body.callback_query_id, 'q1');
});

test('➕ Next button dispatches the next page with the same seed', async () => {
  const calls = mockFetch({ '/dispatches': { status: 204 } });
  await tap('more:123456:2');
  assert.deepEqual(calls[0].body, { ref: 'main', inputs: { mode: 'more', seed: '123456', page: '2' } });
  assert.match(calls[1].body.text, /next jobs/);
});

test('buttons from other chats are ignored', async () => {
  const calls = mockFetch();
  await tap('apply:ab12cd34', { chatId: 7 });
  assert.equal(calls.length, 0);
});

test('invalid apply code is not dispatched', async () => {
  const calls = mockFetch();
  await send('/apply_zz');
  assert.equal(calls.length, 1);
  assert.match(calls[0].body.text, /Tap the/);
});

test('dispatch failure is reported to the owner', async () => {
  const calls = mockFetch({ '/dispatches': { status: 401, json: { message: 'Bad credentials' } } });
  await send('/run');
  assert.match(calls.at(-1).body.text, /⚠️ GitHub dispatch failed: 401/);
});

test('/applied queries Notion and formats rows', async () => {
  const page = { id: '3e562be8-fd86-81af-9a4d-d8732964fd94', properties: {
    Job: { title: [{ plain_text: 'SRE <Zurich>' }] }, Company: { rich_text: [{ plain_text: 'Acme' }] },
    Stage: { select: { name: 'Interview scheduled' } }, 'Applied on': { date: { start: '2026-09-24' } },
    'Next interview': { date: { start: '2026-10-01T10:00:00.000+02:00' } }, 'Job URL': { url: 'https://x.test/1' },
  } };
  const calls = mockFetch({ 'api.notion.com': { json: { results: [page] } } });
  await send('/applied');
  assert.deepEqual(calls[0].body.filter.and.map((f) => f.select.does_not_equal), ['Saved', 'Kit ready', 'Dismissed', 'Closed']);
  const text = calls[1].body.text;
  assert.match(text, /Applications<\/b>\n1 tracked/);
  assert.match(text, /SRE &lt;Zurich&gt;/);
  assert.match(text, /Acme · 🗓 Interview scheduled\nApplied: 2026-09-24\nInterview: 2026-10-01 · 10:00/);
  assert.deepEqual(calls[1].body.reply_markup.inline_keyboard,
    [[{ text: '1', callback_data: 'opick:1:3e562be8fd8681af9a4dd8732964fd94' }]]);
});

const PAGE = '3e562be8fd8681af9a4dd8732964fd94';

test('outcome buttons: numbers in rows of six, callback data within Telegram\'s 64 bytes', () => {
  const pages = Array.from({ length: 13 }, (_, i) => ({ id: `${PAGE.slice(0, -2)}${String(i).padStart(2, '0')}` }));
  const rows = appliedKeyboard(pages).inline_keyboard;
  assert.deepEqual(rows.map((r) => r.length), [6, 6, 1]);
  const outcome = withOutcomeRows({ inline_keyboard: rows }, 13, PAGE).inline_keyboard;
  for (const button of outcome.flat()) assert.ok(Buffer.byteLength(button.callback_data) <= 64, button.callback_data);
  assert.equal(appliedKeyboard([]), null);
});

test('tapping an application number shows the outcome choices', async () => {
  const calls = mockFetch();
  await tap(`opick:1:${PAGE}`, { markup: appliedKeyboard([{ id: PAGE }]) });
  const rows = calls[0].body.reply_markup.inline_keyboard;
  assert.equal(rows.length, 4);
  assert.ok(rows.flat().some((b) => b.callback_data === `out:s:${PAGE}:1`));
});

test('an outcome updates Stage and logs an Application Events row', async () => {
  const props = { Job: { title: [{ plain_text: 'Staff SRE' }] }, Company: { rich_text: [{ plain_text: 'Acme' }] },
                  'Job URL': { url: 'https://x.test/1' } };
  const calls = mockFetch({ [`pages/${PAGE}`]: { json: { properties: props } }, 'v1/pages': { json: { id: 'e1' } } });
  await tap(`out:s:${PAGE}:1`, { markup: withOutcomeRows(appliedKeyboard([{ id: PAGE }]), 1, PAGE) });
  const patch = calls.find((c) => c.body?.properties?.Stage);
  assert.deepEqual(patch.body.properties.Stage, { select: { name: 'Screening' } });
  const event = calls.find((c) => c.body?.parent?.database_id === 'ev1');
  assert.equal(event.body.properties.Kind.select.name, 'Screening');
  assert.equal(event.body.properties.Source.select.name, 'Telegram');
  assert.deepEqual(event.body.properties.Application.relation, [{ id: PAGE }]);
  assert.equal(event.body.properties['Job URL'].url, 'https://x.test/1');
  const edit = calls.find((c) => /editMessageReplyMarkup$/.test(c.url));
  assert.deepEqual(edit.body.reply_markup.inline_keyboard, [[{ text: '📞 1', callback_data: `opick:1:${PAGE}` }]]);
  assert.match(calls.at(-1).body.text, /Staff SRE: Screening/);
});

test('a Notion failure on an outcome is shown to the owner', async () => {
  const calls = mockFetch({ [`pages/${PAGE}`]: { status: 404, json: {} } });
  await tap(`out:r:${PAGE}:1`, { markup: appliedKeyboard([{ id: PAGE }]) });
  assert.ok(!calls.some((c) => c.body?.parent?.database_id));
  assert.match(calls.at(-1).body.text, /⚠️ Notion page read failed: 404/);
});

test('/scout dispatches the scout workflow', async () => {
  const calls = mockFetch({ '/dispatches': { status: 204 } });
  await send('/scout');
  assert.match(calls[0].url, /actions\/workflows\/scout\.yml\/dispatches$/);
  assert.deepEqual(calls[0].body, { ref: 'main', inputs: { batch: '15' } });
});

test('empty applications list points to Notion', () => {
  assert.match(formatApplied([], 'https://notion.test/db'), /No applications yet/);
});

test('/insight dispatches an insight run', async () => {
  const calls = mockFetch({ '/dispatches': { status: 204 } });
  await send('/insight');
  assert.deepEqual(calls[0].body, { ref: 'main', inputs: { mode: 'insight' } });
  assert.match(calls[1].body.text, /insight arrives/);
});

test('insight feedback is saved on the Insights row and replaces the buttons', async () => {
  const calls = mockFetch();
  await tap(`ins:a:${PAGE}`);
  assert.match(calls[0].url, new RegExp(`pages/${PAGE}$`));
  assert.deepEqual(calls[0].body, { properties: { Feedback: { select: { name: 'Acting on it' } } } });
  assert.deepEqual(calls[1].body.reply_markup, { inline_keyboard: [[{ text: "✅ You're acting on it", callback_data: 'noop' }]] });
});

async function sendMessage(message) {
  const pending = [];
  const request = new Request('https://bot.test/telegram', {
    method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': 's3cret' },
    body: JSON.stringify({ message: { chat: { id: 42 }, ...message } }),
  });
  await worker.fetch(request, env, { waitUntil: (p) => pending.push(p) });
  await Promise.all(pending);
}

test('a transcript file starts an interview run with its caption', async () => {
  const calls = mockFetch({ '/dispatches': { status: 204 } });
  await sendMessage({ document: { file_id: 'F1', file_name: 'grafana.srt', file_size: 9000 }, caption: 'Grafana, round 1' });
  assert.deepEqual(calls[0].body, { ref: 'main', inputs: { mode: 'interview', file: 'F1', note: 'Grafana, round 1' } });
  assert.match(calls[1].body.text, /Got <b>grafana.srt<\/b>/);
});

test('recordings start an interview run: voice notes, audio and video files', async () => {
  let calls = mockFetch({ '/dispatches': { status: 204 } });
  await sendMessage({ voice: { file_id: 'V1', file_size: 800000, duration: 1800 }, caption: 'Grafana, round 1' });
  assert.deepEqual(calls[0].body.inputs, { mode: 'interview', file: 'V1', note: 'Grafana, round 1' });
  assert.match(calls[1].body.text, /Got the voice note\. Transcribing it with speakers/);
  calls = mockFetch({ '/dispatches': { status: 204 } });
  await sendMessage({ document: { file_id: 'F2', file_name: 'call.m4a', file_size: 9000 } });
  assert.equal(calls[0].body.inputs.file, 'F2');
  calls = mockFetch({ '/dispatches': { status: 204 } });
  await sendMessage({ audio: { file_id: 'A1', file_name: 'zoom.mp3', file_size: 9000 } });
  assert.equal(calls[0].body.inputs.file, 'A1');
});

test('other files and files over 20 MB are refused without a run', async () => {
  let calls = mockFetch();
  await sendMessage({ document: { file_id: 'F3', file_name: 'slides.pdf', file_size: 9000 } });
  assert.equal(calls.length, 1);
  assert.match(calls[0].body.text, /isn't a recording or a text transcript/);
  calls = mockFetch();
  await sendMessage({ video: { file_id: 'F4', file_size: 90 * 1024 * 1024 } });
  assert.equal(calls.length, 1);
  assert.match(calls[0].body.text, /over 20 MB/);
});

test('/interview with notes dispatches them; without notes it explains', async () => {
  let calls = mockFetch({ '/dispatches': { status: 204 } });
  await sendMessage({ text: '/interview Grafana round 1\nThey asked about Kubernetes upgrades.' });
  assert.deepEqual(calls[0].body.inputs, { mode: 'interview', note: '/interview Grafana round 1\nThey asked about Kubernetes upgrades.' });
  calls = mockFetch();
  await sendMessage({ text: '/interview' });
  assert.equal(calls.length, 1);
  assert.match(calls[0].body.text, /transcript file/);
});

test('/add dispatches the job URL and the date words', async () => {
  let calls = mockFetch({ '/dispatches': { status: 204 } });
  await sendMessage({ text: '/add https://jobs.techtree.dev/job/86d0 on or before 23 Sep' });
  assert.deepEqual(calls[0].body.inputs, { mode: 'add', job: 'https://jobs.techtree.dev/job/86d0', note: 'on or before 23 Sep' });
  calls = mockFetch();
  await sendMessage({ text: '/add' });
  assert.equal(calls.length, 1);
  assert.match(calls[0].body.text, /followed by the job URL/);
});

test('/add with a recruiter message, or a forwarded message, dispatches a recruiter lead', async () => {
  const pitch = "Hi Sam, I'm looking for a remote SRE for Acme Robotics. 120-220K EUR, 1 day every other month in Vienna.";
  let calls = mockFetch({ '/dispatches': { status: 204 } });
  await sendMessage({ text: `/add ${pitch}` });
  assert.deepEqual(calls[0].body.inputs, { mode: 'add', note: pitch });
  assert.match(calls[1].body.text, /Notion/);
  calls = mockFetch({ '/dispatches': { status: 204 } });
  await sendMessage({ text: `/add https://jobs.example/1 ${pitch}` });  // a link inside a message is still a message
  assert.deepEqual(calls[0].body.inputs, { mode: 'add', note: `https://jobs.example/1 ${pitch}` });
  calls = mockFetch({ '/dispatches': { status: 204 } });
  await sendMessage({ text: pitch, forward_origin: { type: 'hidden_user', sender_user_name: 'Jordan Lee' } });
  assert.deepEqual(calls[0].body.inputs, { mode: 'add', note: `From: Jordan Lee\n\n${pitch}` });
  calls = mockFetch();
  await sendMessage({ text: 'ok', forward_origin: { type: 'hidden_user', sender_user_name: 'X' } });  // too short: not a pitch
  assert.ok(!calls.some((call) => /dispatches/.test(call.url)));
});

test('a screenshot (photo or image file) dispatches it with its caption; other files stay interviews', async () => {
  let calls = mockFetch({ '/dispatches': { status: 204 } });
  await sendMessage({ photo: [{ file_id: 'small', file_size: 900 }, { file_id: 'big', file_size: 90000 }], caption: 'recruiter on LinkedIn' });
  assert.deepEqual(calls[0].body.inputs, { mode: 'add', file: 'big', note: 'recruiter on LinkedIn' });
  assert.match(calls[1].body.text, /screenshot/);
  calls = mockFetch({ '/dispatches': { status: 204 } });
  await sendMessage({ document: { file_id: 'D1', file_name: 'Screenshot 2026-09-28.png', mime_type: 'image/png', file_size: 5000 } });
  assert.deepEqual(calls[0].body.inputs, { mode: 'add', file: 'D1', note: '' });
  calls = mockFetch({ '/dispatches': { status: 204 } });
  await sendMessage({ document: { file_id: 'T1', file_name: 'call.txt', file_size: 5000 } });
  assert.equal(calls[0].body.inputs.mode, 'interview');
});

test('/mail dispatches the Gmail and Calendar workflow', async () => {
  const calls = mockFetch({ '/dispatches': { status: 204 } });
  await send('/mail');
  assert.match(calls[0].url, /workflows\/mail\.yml\/dispatches$/);
  assert.deepEqual(calls[0].body, { ref: 'main', inputs: { delay: '0' } });
});
