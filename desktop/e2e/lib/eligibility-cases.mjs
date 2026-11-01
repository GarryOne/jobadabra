// The eligibility judgment, tested on its own now that pool runs turn the stop off (lib/pool-eligibility.mjs): a few postings against the seeded fake applicant
// (desktop/demo/draft.json: Switzerland anywhere or remote within Europe, relocation only within Europe, fluent German or French disqualify, no US remote),
// each asked through the plain-node app's own fill route (/extension/answer: the same prompt, applicant and plan path as a pool row) several times, each
// ask with a fresh memo so it reaches the model. Run by hand: `npm run eligibility-cases` (claude -p on the plan; no API key, no money). Guard:
// e2e/test/filling/eligibility-cases.test.mjs (the scoring, on a stub).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const FIELDS = [{field: 'first_name', label: 'First name', type: 'text', required: true}, {field: 'why', label: 'Why do you want this role?', type: 'textarea', required: false}];

// Invented postings (example.org): one per kind of constraint the applicant states, both verdicts.
export const CASES = [
  {id: 'sydney-hybrid', expect: false, title: 'Customer Success Manager - Sydney', company: 'Example SaaS',
    text: 'Customer Success Manager, Sydney, Australia. Hybrid: three days a week in our Sydney office. You must be based in Sydney with the right to work in Australia.'},
  {id: 'us-onsite', expect: false, title: 'Site Reliability Engineer', company: 'Example Cloud',
    text: 'Site Reliability Engineer, New York, NY. On-site five days a week. Candidates must be authorized to work in the United States; we do not sponsor visas.'},
  {id: 'french-required', expect: false, title: 'Ingénieur SRE', company: 'Exemple Banque',
    text: 'Ingénieur SRE, Paris (hybrid). Fluent French is required: the team works and documents entirely in French. Kubernetes, Terraform, on-call.'},
  {id: 'swiss-role', expect: true, title: 'Senior Site Reliability Engineer', company: 'Example Bank Zurich',
    text: 'Senior Site Reliability Engineer, Zurich, Switzerland. Hybrid, two days in the office. English is our working language. Kubernetes, Terraform, Prometheus.'},
  {id: 'remote-europe', expect: true, title: 'Platform Engineer (Remote, Europe)', company: 'Example Infra',
    text: 'Platform Engineer, fully remote within Europe (EU or Switzerland). English. You run our Kubernetes platform and CI; occasional travel to Berlin.'},
];

export const caseUrl = item => `https://jobs.example.org/eligibility/${item.id}`;
export const answerBody = item => ({url: caseUrl(item), fields: FIELDS, page_text: `${item.title}\n${item.company}\n${item.text}`});

// ask(item, round) -> {eligible, note}. Every case asked `times` times, a round over all cases at a time (one app per round). -> [{id, expect, verdicts: [bool|null], notes}]
export async function runCases(ask, {cases = CASES, times = 3, say = () => {}} = {}) {
  const out = cases.map(item => ({id: item.id, expect: item.expect, verdicts: [], notes: []}));
  for (let round = 0; round < times; round++) {
    for (const [index, item] of cases.entries()) {
      const answer = await ask(item, round).catch(error => ({eligible: null, note: `error: ${String(error?.message || error).slice(0, 120)}`}));
      const row = out[index];
      row.verdicts.push(typeof answer?.eligible === 'boolean' ? answer.eligible : null); row.notes.push(String(answer?.note || '').slice(0, 160));
      say(`  ${item.id} #${round + 1}: ${row.verdicts.at(-1)} (expected ${item.expect}) ${row.notes.at(-1).slice(0, 100)}`);
    }
  }
  return out;
}

// A case passes when every ask agrees with the expectation; one that splits is named (the judgment wavers there), one that is wrong by majority fails.
export function summarize(results) {
  const rows = results.map(row => {
    const right = row.verdicts.filter(verdict => verdict === row.expect).length;
    return {...row, right, state: right === row.verdicts.length ? 'ok' : right * 2 > row.verdicts.length ? 'wavers' : 'wrong'};
  });
  const wrong = rows.filter(row => row.state === 'wrong'), wavers = rows.filter(row => row.state === 'wavers');
  const line = `eligibility cases: ${rows.length - wrong.length - wavers.length}/${rows.length} as expected every time`
    + (wavers.length ? `; wavers: ${wavers.map(row => `${row.id} ${row.right}/${row.verdicts.length}`).join(', ')}` : '')
    + (wrong.length ? `; WRONG: ${wrong.map(row => `${row.id} ${row.right}/${row.verdicts.length}`).join(', ')}` : '');
  return {ok: !wrong.length, line, rows};
}

// The real ask: a fresh plain-node app per round (its memo new, so the model is asked), the case's posting seeded as a fresh job (lib/seed-data.mjs).
export function appAsk({startOfflineApp, seedLivePosting, storeCall}) {
  let current = null;   // {round, app}: one app at a time, a new one (fresh memo) per round
  const appFor = async round => {
    if (current?.round === round) return current.app;
    if (current) await (await current.app).close().catch(() => {});
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-eligibility-'));
    current = {round, app: startOfflineApp({ask: true, memo: path.join(dir, 'model-memo.json')})};
    return current.app;
  };
  const ask = async (item, round) => {
    const app = await appFor(round);
    const store = {store: 'sqlite', profile: app.dir};
    await seedLivePosting({...store, data: (entity, method, kwargs) => storeCall(store, entity, method, kwargs)}, {url: caseUrl(item), title: item.title, company: item.company});
    const response = await fetch(`http://127.0.0.1:${app.port}/extension/answer`, {method: 'POST', headers: {Authorization: `Bearer ${app.token}`, 'Content-Type': 'application/json'},
      body: JSON.stringify(answerBody(item)), signal: AbortSignal.timeout(180000)});
    const body = await response.json();
    if (!response.ok) throw new Error(body?.error || `HTTP ${response.status}`);
    return {eligible: body.eligible, note: body.eligibility_note};
  };
  ask.close = async () => { if (current) await (await current.app).close().catch(() => {}); current = null; };
  return ask;
}
