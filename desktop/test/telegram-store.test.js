// The Telegram bot reads the same whichever store holds the data (app-core/src/index.js env.store): /saved and /applied list the same jobs
// from Notion and from the store on this Mac (lib/store/telegram-store.js), only Notion's "Open in Notion" link differs; an outcome tap
// writes the stage and one Telegram event.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {handleCommand, handleUpdate} from '../shared/app-core/index.js';
import {telegramStore} from '../lib/store/telegram-store.js';

// No network in this file: every call is answered by a stub below, and anything else fails the test (9 Oct 2026: a stale staged worker
// fell back to Notion and reached api.notion.com with no token).
const offline = async url => { throw new Error(`no network in this test: ${url}`); };
globalThis.fetch = offline;

const UUID = '1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b';
const APPS = [
  {id: UUID, title: 'SRE', company: 'Acme', stage: 'Interview scheduled', applied_on: '2026-10-02', next_interview: '2026-10-12T09:00', url: 'https://acme.example/1', created_at: '2026-10-01'},
  {id: '2a2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b', title: 'Platform', company: 'Globex', stage: 'Saved', applied_on: '', next_interview: '', url: 'https://globex.example/2', created_at: '2026-10-05'},
  {id: '3b2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b', title: 'DevOps', company: 'Initech', stage: 'Applied', applied_on: '2026-10-04', next_interview: '', url: '', created_at: '2026-10-03'},
];
const rich = text => [{plain_text: text}];
const row = app => ({id: app.id, url: `https://www.notion.so/${app.id}`, properties: {Job: {title: rich(app.title)}, Company: {rich_text: rich(app.company)},
  Stage: {select: {name: app.stage}}, 'Applied on': {date: app.applied_on ? {start: app.applied_on} : null},
  'Next interview': {date: app.next_interview ? {start: app.next_interview} : null}, 'Job URL': {url: app.url || null}}});

// Notion answers the bot's own queries (app-core/src/index.js queryApplications / applied), filtered and sorted as Notion would.
async function withNotion(run) {
  globalThis.fetch = async (url, init) => {
    if (!String(url).startsWith('https://api.notion.com/v1/databases/apps/query')) return offline(url);
    const body = JSON.parse(init.body);
    const saved = body.filter?.select?.equals === 'Saved';
    const list = saved ? APPS.filter(a => a.stage === 'Saved') : APPS.filter(a => !['Saved', 'Kit ready', 'Dismissed', 'Closed'].includes(a.stage))
      .sort((a, b) => String(b.applied_on).localeCompare(String(a.applied_on)));
    return {ok: true, json: async () => ({results: list.map(row)})};
  };
  try { return await run({NOTION_TOKEN: 'n', NOTION_APPLICATIONS_DB: 'apps'}); } finally { globalThis.fetch = offline; }
}
function macEnv() {
  const writes = [];
  const call = async (_, entity, method, kwargs) => {
    if (entity === 'applications' && method === 'list') return APPS.filter(a => !kwargs.stages || kwargs.stages.includes(a.stage)).map(a => ({...a}));
    if (entity === 'applications' && method === 'update') { writes.push(['stage', kwargs.app_id, kwargs.fields.stage]); return APPS.find(a => a.id === kwargs.app_id); }
    if (entity === 'events' && method === 'add') { writes.push(['event', kwargs.app_id, kwargs.kind, kwargs.source]); return {}; }
    throw new Error(`unexpected ${entity}.${method}`);
  };
  return {env: {store: telegramStore({}, {call, now: () => new Date('2026-10-09T12:00:00Z')})}, writes};
}
const withoutNotionLink = text => String(text?.text ?? text).replace(/ · <a href="[^"]*">Open in Notion<\/a>/, '').replace(/<a href="https:\/\/www\.notion\.so[^"]*">/g, '<a>');

test('/saved and /applied list the same jobs from Notion and from this Mac', async () => {
  for (const name of ['saved', 'applied']) {
    const fromNotion = await withNotion(env => handleCommand(env, {name}));
    const fromMac = await handleCommand(macEnv().env, {name});
    assert.equal(withoutNotionLink(fromMac), withoutNotionLink(fromNotion), name);
    assert.doesNotMatch(String(fromMac?.text ?? fromMac), /Notion/, name);
  }
  const applied = await handleCommand(macEnv().env, {name: 'applied'});
  assert.match(applied.keyboard.inline_keyboard[0][0].callback_data, /^opick:1:[0-9a-f]{32}$/);
});

test('an outcome tap on this Mac: the stage, one Telegram event, and "Saved" without Notion', async () => {
  const {env, writes} = macEnv();
  const said = [];
  globalThis.fetch = async (url, init) => {
    if (!String(url).startsWith('https://api.telegram.org/botbot/')) return offline(url);
    said.push([String(url).split('/').pop(), JSON.parse(init.body)]);
    return {ok: true, json: async () => ({ok: true})};
  };
  try {
    await handleUpdate({...env, TELEGRAM_BOT_TOKEN: 'bot', OWNER_CHAT_ID: '1'}, {callback_query: {id: 'q', data: `out:i:${UUID.replace(/-/g, '')}:1`,
      message: {chat: {id: 1}, message_id: 5, reply_markup: {inline_keyboard: []}}}});
  } finally { globalThis.fetch = offline; }
  assert.deepEqual(writes.map(w => w.slice(0, 2)), [['stage', UUID], ['event', UUID]]);
  assert.equal(writes[0][2], writes[1][2]);   // the same stage on the job and its event
  assert.equal(writes[1][3], 'Telegram');
  assert.match(said.find(([method]) => method === 'answerCallbackQuery')[1].text, /^SRE: .*\. Saved\.$/);
});

test('an insight feedback tap on this Mac: kept on the insight, its other fields untouched', async () => {
  const INSIGHT = '4c2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b';
  const writes = [];
  const call = async (_, entity, method, kwargs) => {
    if (entity === 'insights' && method === 'list') return [{id: INSIGHT, fields: {basis: 'funnel'}}];
    if (entity === 'insights' && method === 'update') { writes.push(kwargs); return {}; }
    throw new Error(`unexpected ${entity}.${method}`);
  };
  const said = [];
  globalThis.fetch = async (url, init) => {
    if (!String(url).startsWith('https://api.telegram.org/botbot/')) return offline(url);
    said.push(JSON.parse(init.body));
    return {ok: true, json: async () => ({ok: true})};
  };
  try {
    await handleUpdate({store: telegramStore({}, {call}), TELEGRAM_BOT_TOKEN: 'bot', OWNER_CHAT_ID: '1'}, {callback_query: {id: 'q',
      data: `ins:u:${INSIGHT.replace(/-/g, '')}`, message: {chat: {id: 1}, message_id: 6, reply_markup: {inline_keyboard: []}}}});
  } finally { globalThis.fetch = offline; }
  assert.equal(writes.length, 1);
  assert.equal(writes[0].insight_id, INSIGHT);
  assert.equal(writes[0].fields.fields.basis, 'funnel');
  assert.ok(writes[0].fields.fields.feedback);
});
