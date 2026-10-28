// An answer given for ONE job only (the review drawer's "Reuse for matching questions" off, owner 17 Oct 2026), kept with that job's application as a
// section of its record, through the store interface (the engine's applications section: every adapter, tests/store_contract.py). The fill reads it for
// that job's form only (worker/src/extension.js answerContext). Why (PR B1, owner 28 Oct 2026: "there cannot be things that we learned and should be
// applied only to one job"): its writer is gone; answers kept before still show and fill. Guarded by test/job-answers.test.js.
import * as engine from './store/engine.js';
import {JOB_ANSWERS_SECTION, jobAnswersOf} from '../shared/worker/job-answers.js';

// One job's own answers by its link: [{question, answer}].
export async function forUrl(storage, url, {call = engine.call} = {}) {
  const job = url ? await call(storage, 'applications', 'get', {url}) : null;
  return job ? jobAnswersOf(await call(storage, 'applications', 'section', {app_id: job.id, name: JOB_ANSWERS_SECTION})) : [];
}
