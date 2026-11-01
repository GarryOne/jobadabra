// Education and current job on a form, tested on their own on the plan path: a form with School, Degree, start and end year, Current company and Job title in English, German
// and French, asked through the plain-node app's fill route (/extension/answer) against the seeded fake applicant, whose imported CV (fixtures/cv.json) states them.
// Run by hand: `npm run cv-facts-cases` (claude -p; no API key). Guard: test/cv-facts-cases.test.mjs (the scoring, on a stub). Pool: EQT's Greenhouse form left these empty (11 Oct 2026).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {CONTACT} from './apply-fixtures.mjs';

// What the fake CV states: field key -> a pattern the answer must match.
export const EXPECT = {school: /Example University/i, degree: /(BSc|Bachelor).*(Computer Science|Informatik|informatique)|Computer Science/i, start: /^2014$/, end: /^2018$/, company: /^Acme Cloud$/i, title: /Senior (SRE|Site Reliability)/i, address: /Musterstrasse 12/i};
const form = labels => Object.entries(labels).map(([key, label]) => ({field: key, label, type: key === 'start' || key === 'end' ? 'number' : 'text', required: true}));
export const CASES = [
  {id: 'english', fields: form({school: 'School', degree: 'Degree', start: 'Start date year', end: 'End date year', company: 'Current Company', title: 'Current Job Title'})},
  {id: 'german', fields: form({school: 'Hochschule / Universität', degree: 'Abschluss', start: 'Studienbeginn (Jahr)', end: 'Studienende (Jahr)', company: 'Aktueller Arbeitgeber', title: 'Aktuelle Position'})},
  {id: 'employer-question', fields: form({company: 'Where do you work now?', address: 'Legal Address'})},
  {id: 'employer-plain', fields: form({company: 'Employer', title: 'Position'})},
  {id: 'spanish-address', fields: form({company: 'Empresa actual', address: 'Dirección completa'})},
  {id: 'french', fields: form({school: 'École / Université', degree: 'Diplôme', start: 'Année de début', end: 'Année de fin', company: 'Entreprise actuelle', title: 'Poste actuel'})},
];
export const caseUrl = item => `https://jobs.example.org/cv-facts/${item.id}`;
export const answerBody = item => ({url: caseUrl(item), fields: item.fields, page_text: 'Senior Site Reliability Engineer, Zurich. Kubernetes, Terraform, on-call.'});

// One answer set against the expectation: the keys it got right and wrong. A field is right when its value matches and it is typed (use "fill"), not only proposed.
export function score(answers = [], item = null) {
  const byField = Object.fromEntries(answers.map(item => [item.field, item]));
  const got = key => { const item = byField[key]; return item && item.use !== 'propose' && item.use !== 'kind' ? String(item.value ?? '').trim() : ''; };
  const keys = item ? item.fields.map(f => f.field) : Object.keys(EXPECT);   // a case is scored on the fields it asks
  const right = keys.filter(key => EXPECT[key].test(got(key)));
  return {right, wrong: keys.filter(key => !right.includes(key))};
}

// ask(item, round) -> answers[]. Every case `times` times. -> [{id, rounds: [{right, wrong} | {error}]}]
export async function runCases(ask, {cases = CASES, times = 3, say = () => {}} = {}) {
  const out = cases.map(item => ({id: item.id, rounds: []}));
  for (let round = 0; round < times; round++) {
    for (const [index, item] of cases.entries()) {
      const result = await ask(item, round).then(list => score(list, item), error => ({error: String(error?.message || error).slice(0, 120)}));
      out[index].rounds.push(result);
      say(`  ${item.id} #${round + 1}: ${result.error ? `error: ${result.error}` : `${result.right.length}/${item.fields.length} right${result.wrong.length ? ` (missed: ${result.wrong.join(', ')})` : ''}`}`);
    }
  }
  return out;
}

// Every ask must get every field right; an ask that failed counts against it.
export function summarize(results) {
  const rows = results.map(row => ({...row, perfect: row.rounds.filter(round => round.right && !round.wrong.length).length}));
  const bad = rows.filter(row => row.perfect < row.rounds.length);
  return {ok: !bad.length, rows, line: `cv facts cases: ${rows.length - bad.length}/${rows.length} cases right in every ask` + (bad.length ? `; NOT: ${bad.map(row => `${row.id} ${row.perfect}/${row.rounds.length}`).join(', ')}` : '')};
}

// The real ask: a fresh plain-node app per round (a new memo, so the model is asked).
export function appAsk({startOfflineApp}) {
  let current = null;
  const appFor = async round => {
    if (current?.round === round) return current.app;
    if (current) await (await current.app).close().catch(() => {});
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-cv-facts-'));
    current = {round, app: startOfflineApp({ask: true, memo: path.join(dir, 'model-memo.json')})};
    await (await current.app).call('saveContact', CONTACT);   // as the live row does: the Profile in every ask carries the contact lines (street, postal code)
    return current.app;
  };
  const ask = async (item, round) => {
    const app = await appFor(round);
    const response = await fetch(`http://127.0.0.1:${app.port}/extension/answer`, {method: 'POST', headers: {Authorization: `Bearer ${app.token}`, 'Content-Type': 'application/json'},
      body: JSON.stringify(answerBody(item)), signal: AbortSignal.timeout(180000)});
    const body = await response.json();
    if (!response.ok) throw new Error(body?.error || `HTTP ${response.status}`);
    return body.answers || [];
  };
  ask.close = async () => { if (current) await (await current.app).close().catch(() => {}); current = null; };
  return ask;
}
