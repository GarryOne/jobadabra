// An answer given for ONE job only (the review drawer's "Reuse for matching questions" off, owner 17 Oct 2026; the switch is gone since 28 Oct 2026, owner:
// "there cannot be things that we learned and should be applied only to one job"; answers kept before still show and fill): kept with that job's application as a
// section of its record, through the store interface (the engine's applications section: every adapter, tests/store_contract.py), never as a standard
// answer or a line of Your details. The fill reads it for that job's form only (worker/src/extension.js answerContext). The job is the one that asked the
// question: read from the verdicts' record of who asked (lib/question-verdicts.js record), else the one application of that company; never guessed between two.
// Guarded by test/job-answers.test.js.
import * as engine from './store/engine.js';
import {JOB_ANSWERS_SECTION, jobAnswersOf, withJobAnswer} from '../shared/worker/job-answers.js';
import {cached} from './question-verdicts.js';
import {keyOf} from '../renderer/question-filter.js';

const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
const asked = (storage, question) => cached(storage)[keyOf(question)]?.jobs || [];

// The application that asked this question: {id, url, title, company}, or null. url: the job's link when the caller knows it.
async function jobFor(storage, question, {company = '', url = '', call}) {
  const store = (method, kwargs) => call(storage, 'applications', method, kwargs);
  if (url) return store('get', {url});
  const urls = [...new Set(asked(storage, question).filter(job => !company || same(job.company, company)).map(job => job.url).filter(Boolean))];
  if (urls.length === 1) return store('get', {url: urls[0]});
  if (urls.length > 1) return null;
  const rows = (await store('list', {}) || []).filter(row => company && same(row.company, company));
  return rows.length === 1 ? rows[0] : null;
}

// Writes the answer into the job's section. -> {ok, job: {id, url, title, company}} or {ok: false, error}.
// TODO(AI): no caller since the drawer's switch went (PR A of What we learned): remove with PR B unless a job's own answer gets a writer (28 Oct 2026)
export async function save(storage, question, value, {company = '', url = '', call = engine.call} = {}) {
  const job = await jobFor(storage, question, {company, url, call});
  if (!job) return {ok: false, error: 'Jobadabra could not tell which application asked this question, so it cannot keep the answer for that job only. Reuse it for matching questions, or answer it from the job.'};
  const before = await call(storage, 'applications', 'section', {app_id: job.id, name: JOB_ANSWERS_SECTION});
  await call(storage, 'applications', 'set_section', {app_id: job.id, name: JOB_ANSWERS_SECTION, markdown: withJobAnswer(before, question, value)});
  return {ok: true, job: {id: job.id, url: job.url || '', title: job.title || '', company: job.company || ''}};
}

// One job's own answers by its link: [{question, answer}].
export async function forUrl(storage, url, {call = engine.call} = {}) {
  const job = url ? await call(storage, 'applications', 'get', {url}) : null;
  return job ? jobAnswersOf(await call(storage, 'applications', 'section', {app_id: job.id, name: JOB_ANSWERS_SECTION})) : [];
}
