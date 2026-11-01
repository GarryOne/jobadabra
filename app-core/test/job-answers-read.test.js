// The fill reads an answer given for one job only, for THAT job's form only (owner, 17 Oct 2026: "Job-specific details stay with this application"):
// one test per reader of the answer context, the data on this Mac (env.store) and the Notion row (the Worker); both hand it to the model as the job's own drafted answers.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answerForm } from '../src/extension.js';
import { JOB_ANSWERS_SECTION } from '../src/job-answers.js';

const reply = { stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5, billing: 'subscription' }, content: [{ type: 'text', text: JSON.stringify({ eligible: true, eligibility_note: '', answers: [] }) }] };
const client = (seen) => ({ messages: { create: async (request) => { seen.push(request); return reply; } } });
const fields = [{ field: 'start', label: 'Earliest start date', type: 'text', required: true }];
const base = { PROFILE_TEXT: 'SRE', ANSWERS_TEXT: '', KNOWLEDGE_TEXT: '' };
const JOB = 'https://example.test/job/1', OTHER = 'https://example.test/job/2';

test('on this Mac: the job\'s own answers reach the ask as drafted answers, and only for that job', async () => {
  const asked = [];
  const store = {
    findJob: async (url) => ({ id: url === JOB ? 'a1' : 'a2', title: 'SRE', company: 'Acme', stage: 'To apply', url, notion_url: '' }),
    kit: async () => null,
    jobAnswers: async (id) => { asked.push(id); return id === 'a1' ? [{ question: 'Earliest start date', answer: '1 December 2026; no constraints' }] : []; },
  };
  const seen = [];
  await answerForm({ ...base, store }, { url: JOB, fields }, client(seen));
  assert.match(seen[0].messages[0].content, /<drafted_kit>[\s\S]*1 December 2026; no constraints/);
  const other = [];
  await answerForm({ ...base, store }, { url: OTHER, fields }, client(other));
  assert.doesNotMatch(other[0].messages[0].content, /1 December 2026/, 'another job\'s form never sees it');
  assert.deepEqual(asked, ['a1', 'a2'], 'each ask reads its own job\'s section');
});

test('on Notion (the Worker): the toggle section of the job\'s page reaches the ask the same way', async () => {
  const env = { ...base, NOTION_TOKEN: 'nt', NOTION_APPLICATIONS_DB: 'db1' };
  const saved = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const reply = (json) => new Response(JSON.stringify(json));
    if (String(url).includes('/databases/db1/query')) return reply({ results: [{ id: 'page1', url: 'https://www.notion.so/page1', properties: { Job: { title: [{ plain_text: 'SRE' }] }, Company: { rich_text: [{ plain_text: 'Acme' }] }, Stage: { select: { name: 'To apply' } }, 'Job URL': { url: JOB } } }] });
    if (String(url).includes('/blocks/page1/children')) return reply({ results: [{ id: 'h2', type: 'heading_3', has_children: true, heading_3: { rich_text: [{ plain_text: JOB_ANSWERS_SECTION }] } }], has_more: false });
    if (String(url).includes('/blocks/h2/children')) return reply({ results: [{ id: 'b1', type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ plain_text: 'Earliest start date — 1 December 2026; no constraints' }] } }], has_more: false });
    return new Response('{}', { status: 500 });
  };
  try {
    const seen = [];
    await answerForm(env, { url: JOB, fields }, client(seen));
    assert.match(seen[0].messages[0].content, /<drafted_kit>[\s\S]*Earliest start date[\s\S]*1 December 2026; no constraints/);
  } finally { globalThis.fetch = saved; }
});
