// Builds the Free AI quality cases for form answers (tools/free-ai-eval.mjs): the extension's real answer ask (worker/src/extension.js answerForm), captured, never copied.
// Usage: node tools/free-ai-form-cases.mjs --profile <profile.md> --answers <answers.md> --out <cases.json> [--set real]   (FICTIONAL demo profile only: the cases go to a third party).
import fs from 'node:fs';
import {answerForm, ANSWER_SCHEMA_FOR_TESTS} from '../worker/src/extension.js';
import {FORMS as REAL_FORMS} from './free-ai-form-asks.mjs';
import {FORMS, field} from './free-ai-form-list.mjs';
import {APPLICANTS} from './free-ai-form-applicants.mjs';


// The real-sized set (tools/free-ai-form-asks.mjs, [label, type, options, expect] per field) in this file's shape: ids f1.., expect keys value/empty/match/category/within.
export const realForms = () => REAL_FORMS.map(([id, list]) => ({id: `real-${id}`,
  fields: list.map(([label, type, options], i) => field(`f${i + 1}`, label, type, options)),
  expect: Object.fromEntries(list.map(([, , options, want], i) => [`f${i + 1}`, {...(want.v ? {value: want.v} : {}), ...(want.empty ? {empty: true} : {}), ...(want.maybeEmpty ? {maybeEmpty: true} : {}), ...(want.m ? {match: want.m} : {}),
    ...(want.cat ? {category: want.cat} : {}), ...(options ? {within: options} : {})}]))}));

// answerForm builds the exact request, then asks the client: ours keeps the request and stops.
export async function formCases({profile, answers, forms = FORMS}) {
  const out = [];
  for (const form of forms) {
    let params;
    const client = {messages: {create: async request => { params = request; throw new Error('captured'); }}};
    const who = form.applicant ? APPLICANTS[form.applicant] : null;   // a case the demo applicant cannot show brings its own (tools/free-ai-form-applicants.mjs)
    await answerForm({PROFILE_TEXT: who?.profile ?? profile, ANSWERS_TEXT: who?.answers ?? answers, KNOWLEDGE_TEXT: '', SEARCH_TEXT: '', CV_FACTS_TEXT: who?.cv ?? '', store: {findJob: async () => null, kit: async () => null}},
      {url: 'https://example.com/jobs/sre', fields: form.fields, page_text: who?.page ?? 'Senior Site Reliability Engineer, Zurich. Hybrid. Kubernetes, AWS, on-call.'}, client).catch(error => { if (error.message !== 'captured') throw error; });
    const {model, ...rest} = params;
    out.push({id: `form-${form.id}`, action: 'answer', expect: form.expect, params: rest, ...(form.applicant ? {applicant: form.applicant} : {})});
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const option = name => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined; };
  const need = name => option(name) || (() => { throw new Error(`--${name} is required`); })();
  const cases = await formCases({profile: fs.readFileSync(need('profile'), 'utf8'), answers: fs.readFileSync(need('answers'), 'utf8'), forms: option('set') === 'real' ? realForms() : FORMS});
  fs.writeFileSync(need('out'), JSON.stringify(cases));
  console.log(`${cases.length} form-answer cases (schema keys: ${Object.keys(ANSWER_SCHEMA_FOR_TESTS.properties).join(', ')})`);
}
