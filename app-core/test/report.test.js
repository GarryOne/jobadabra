import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleReport, newer, sanitize } from '../src/report.js';

const report = { site: 'job-boards.greenhouse.io', version: '0.6.2', fields: [
  { label: 'Location (City)', type: 'combobox', required: true, reason: 'dropdown clicked, but no option matched', options: ['Geneva, Switzerland'] },
  { label: 'Pronouns', type: 'text', reason: 'no answer in the kit, Profile or your details' },
  { label: '<script>x</script>'.repeat(20), type: 'text', reason: 'answer given, but the field did not take it', value: 'secret' }] };

test('reports keep only mechanical failures, as form structure; no values, no markup', () => {
  const clean = sanitize(report);
  assert.equal(clean.fields.length, 2);  // the missing answer is a data gap, not a code bug
  assert.ok(!JSON.stringify(clean).includes('secret'));
  assert.ok(!JSON.stringify(clean).includes('<'));
  assert.equal(sanitize({ site: 'not a host', fields: report.fields }), null);
});

test('only the owner\'s app (REPORT_TOKEN) is trusted; others go to triage', async () => {
  const calls = [];
  const dispatch = async (_env, inputs, workflow) => calls.push({ inputs, workflow });
  const post = (auth) => new Request('https://w/report/fill-failure', { method: 'POST', body: JSON.stringify(report),
    headers: auth ? { Authorization: `Bearer ${auth}` } : {} });
  assert.equal((await (await handleReport(post('t0k'), { REPORT_TOKEN: 't0k' }, dispatch)).json()).trusted, true);
  assert.equal((await (await handleReport(post('nope'), { REPORT_TOKEN: 't0k' }, dispatch)).json()).trusted, false);
  assert.equal(calls[0].workflow, 'fill-failure-intake.yml');
  assert.equal(calls[1].inputs.trusted, 'false');
});

test('untrusted reports are limited: 10 per sender per day', async () => {
  const store = new Map();
  const kv = { get: async (key) => store.get(key) ?? null, put: async (key, value) => { store.set(key, value); } };
  const dispatch = async () => {};
  const post = (body, ip = '1.2.3.4') => new Request('https://x/report/fill-failure',
    { method: 'POST', headers: { 'CF-Connecting-IP': ip }, body: JSON.stringify(body) });
  const now = Date.parse('2026-09-29T12:00:00Z');
  for (let i = 0; i < 10; i++) await handleReport(post({ ...report, site: `site${i}.example.com` }), { WAITLIST: kv }, dispatch, now);
  const over = await handleReport(post({ ...report, site: 'eleven.example.com' }), { WAITLIST: kv }, dispatch, now);
  assert.equal(over.status, 429);
  const other = await handleReport(post({ ...report, site: 'eleven.example.com' }, '5.6.7.8'), { WAITLIST: kv }, dispatch, now);
  assert.equal(other.status, 200);  // another sender isn't affected
  const trusted = await handleReport(new Request('https://x', { method: 'POST', headers: { Authorization: 'Bearer t', 'CF-Connecting-IP': '1.2.3.4' },
    body: JSON.stringify(report) }), { WAITLIST: kv, REPORT_TOKEN: 't' }, dispatch, now);
  assert.equal(trusted.status, 200);  // the owner's app is never limited
});

test('a failure becomes an issue only when it recurs: three different senders, or ten reports; then again only on a newer build', async () => {
  const store = new Map();
  const kv = { get: async (key) => store.get(key) ?? null, put: async (key, value) => { store.set(key, value); } };
  const calls = [];
  const dispatch = async () => calls.push(1);
  const now = Date.parse('2026-09-29T12:00:00Z');
  const post = (ip, body = report) => handleReport(new Request('https://x/report/fill-failure', { method: 'POST', headers: { 'CF-Connecting-IP': ip }, body: JSON.stringify(body) }), { WAITLIST: kv }, dispatch, now);
  const first = await (await post('1.1.1.1')).json();
  assert.deepEqual([first.issue, first.counted, first.senders, calls.length], [false, 1, 1, 0]);   // data, not a ticket
  await post('1.1.1.1');
  assert.equal(calls.length, 0);   // the same sender again: still not enough senders
  await post('2.2.2.2');
  assert.equal(calls.length, 0);
  await post('3.3.3.3');
  assert.equal(calls.length, 1);   // three different senders: one issue
  await post('4.4.4.4');
  assert.equal(calls.length, 1);   // not again on the same build
  // one install failing over and over also counts, at ten reports
  const other = { ...report, site: 'solo.example.com' };
  const reports = [];
  for (let i = 0; i < 10; i++) reports.push(await post(`9.9.9.${i % 2}`, other));
  assert.equal(calls.length, 2);
  // without the site's storage (the Telegram bot's worker) every report is passed on, as before
  await handleReport(new Request('https://x', { method: 'POST', body: JSON.stringify(report) }), {}, dispatch, now);
  assert.equal(calls.length, 3);
});

test('the owner\'s signed report and a required question nobody read go to triage on first sight; others wait', async () => {
  const store = new Map();
  const kv = { get: async (key) => store.get(key) ?? null, put: async (key, value) => { store.set(key, value); } };
  const calls = [];
  const dispatch = async () => calls.push(1);
  const post = (body, auth) => handleReport(new Request('https://x/report/fill-failure', { method: 'POST', body: JSON.stringify(body),
    headers: { 'CF-Connecting-IP': '5.5.5.5', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) } }), { WAITLIST: kv, REPORT_TOKEN: 't0k' }, dispatch);
  await post({ site: 'boards.example.com', fields: [{ label: 'Pick one', reason: 'dropdown clicked, but no option matched' }] });
  assert.equal(calls.length, 0);   // a stranger's widget quirk: counted, waits for others
  await post({ site: 'boards.example.com', fields: [{ label: 'Team size', reason: 'question on the page not read' }] });
  assert.equal(calls.length, 1);   // a whole question missed: at once
  await post({ site: 'own.example.com', fields: [{ label: 'Pick one', reason: 'dropdown clicked, but no option matched' }] }, 't0k');
  assert.equal(calls.length, 2);   // the owner's app: at once
});

test('each field counts on its own: the same field beside other fields is the same failure, passed on alone', async () => {
  // 20 Oct 2026: a field reported beside different fields (or in another language's combination) opened a new issue each time: 8 of 40 were duplicates
  const store = new Map();
  const kv = { get: async (key) => store.get(key) ?? null, put: async (key, value) => { store.set(key, value); } };
  const sent = [];
  const dispatch = async (env, inputs) => sent.push(JSON.parse(inputs.report));
  const post = (ip, fields, version = '0.9.448') => handleReport(new Request('https://x/report/fill-failure', { method: 'POST', headers: { 'CF-Connecting-IP': ip },
    body: JSON.stringify({ site: 'boards.example.com', version, fields }) }), { WAITLIST: kv }, dispatch);
  const city = { label: 'City', type: 'combobox', reason: 'dropdown clicked, but no option matched' };
  const box = { label: 'Alerts', type: 'checkbox', reason: 'answer given, but the field did not take it' };
  await post('1.1.1.1', [city]);
  await post('2.2.2.2', [city, box]);
  await post('3.3.3.3', [box, city]);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].fields.map((f) => f.label), ['City']);   // the box was seen by two senders only: it waits
  assert.equal([...store.keys()].filter((key) => key.startsWith('report:site:')).length, 1);   // one record per site, whatever the fields
});

test('a field already passed on comes again only from a newer build', async () => {
  const store = new Map();
  const kv = { get: async (key) => store.get(key) ?? null, put: async (key, value) => { store.set(key, value); } };
  const sent = [];
  const dispatch = async (env, inputs) => sent.push(JSON.parse(inputs.report));
  const post = (version) => handleReport(new Request('https://x/report/fill-failure', { method: 'POST', headers: { Authorization: 'Bearer t' },
    body: JSON.stringify({ site: 'own.example.com', version, fields: [{ label: 'Country', reason: 'dropdown not clicked: the click failed' }] }) }), { WAITLIST: kv, REPORT_TOKEN: 't' }, dispatch);
  await post('0.9.448');
  await post('0.9.448');
  await post('0.9.440');
  assert.equal(sent.length, 1);
  const again = await (await post('0.9.460')).json();
  assert.equal(sent.length, 2);
  assert.equal(again.issue, true);
  assert.equal(sent[1].version, '0.9.460');
});

test('builds compare by number; an unstamped copy is no later than a stamped one', () => {
  assert.equal(newer('0.9.460', '0.9.448'), true);
  assert.equal(newer('0.10.0', '0.9.999'), true);
  assert.equal(newer('0.9.448', '0.9.448'), false);
  assert.equal(newer('0.9', '0.9.448'), false);
  assert.equal(newer('0.9.461-dev', '0.9.460'), true);
  assert.equal(newer('0.9.1', ''), true);
  assert.equal(newer('', '0.9.1'), false);
});
