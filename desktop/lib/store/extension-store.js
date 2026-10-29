// The extension's routes with the data on this Mac (worker/src/extension.js env.store): the tracked job for a form, its kit and the fill
// run's record, from the engine's store (lib/store/engine.js) instead of Notion. The values are the shared worker's own (runRecord), so a
// fill logs the same thing in either store. Guarded by test/extension-store.test.js.
import * as engine from './engine.js';
import {jobKey, runRecord} from '../../shared/worker/extension.js';
import {KIT_SECTION, kitOf} from './kit-section.js';
import {JOB_ANSWERS_SECTION, jobAnswersOf} from '../../shared/worker/job-answers.js';

export {KIT_SECTION, kitOf};   // their home is ./kit-section.js (a leaf module)

export function extensionStore(storage, {call = engine.call} = {}) {
  const store = (entity, method, kwargs) => call(storage, entity, method, kwargs);
  async function findJob(url) {
    let app = await store('applications', 'get', {url});
    const key = !app && jobKey(url);
    if (key) app = (await store('applications', 'list', {}) || []).find(each => String(each.url || '').includes(key)) || null;
    return app ? {id: app.id, title: app.title || '', company: app.company || '', stage: app.stage || '', url: app.url || '', notion_url: ''} : null;
  }
  return {
    findJob,
    kit: async id => kitOf(await store('applications', 'section', {app_id: id, name: KIT_SECTION})),
    // What the person answered for this job only (lib/job-answers.js): the fill's ask reads it for this job's form and no other.
    jobAnswers: async id => jobAnswersOf(await store('applications', 'section', {app_id: id, name: JOB_ANSWERS_SECTION})),
    async logRun(run) {
      const job = await findJob(run.url).catch(() => null);
      const made = await store('agent_runs', 'add', {run: runRecord(run, job || {})});
      return {ok: true, id: made?.id || null};
    },
    // The same run's row corrected (the record after a late retype): what changed is what a fill's end says; the row's own job, company and start stay (agent_runs.update replaces
    // the `fields` column, so the row's own values are read and kept). A row that is gone is no update, never a new row.
    async updateRun(run) {
      const id = String(run.update), was = await store('agent_runs', 'get', {run_id: id});
      if (!was) return {ok: false, skipped: true};
      const {outcome, learnings, fields} = runRecord(run, {});
      const changed = Object.fromEntries(Object.entries(fields).filter(([key]) => !['job', 'company', 'started'].includes(key)));   // the row keeps its own
      await store('agent_runs', 'update', {run_id: id, fields: {outcome, learnings, fields: {...(was.fields || {}), ...changed}}});
      return {ok: true, id};
    },
    /**
     * A confirmed submit stamped on the job's newest fill row: outcome and status "Submitted", the job's stage "Applied", the time in `data.submitted_at`; the fill's own numbers and trace stay.
     * A job with no fill row gets none made up.
     * Why (2026-10-29, owner: "use the same mechanism wherever it's background or live mode"): every mode's fill is logged by logRun, and every confirmed submit passes markApplied (lib/server-env.js), so the recap reads one row per job in any mode.
     */
    async receiptRun(url, at) {
      const rows = (await store('agent_runs', 'list', {transcript: false})) || [], key = jobKey(url);   // the transcript is not needed: only `outcome` and `fields` are written
      const row = rows.find(each => each.url === url || (key && String(each.url || '').includes(key)));   // newest first: the newest row of this job under either URL (the row holds the extension's own URL, `url` the list's canonical one)
      if (!row) return {ok: false, skipped: true};
      const was = row.fields || {};
      await store('agent_runs', 'update', {run_id: row.id, fields: {outcome: 'Submitted', fields: {...was, status: 'Submitted', job_stage: 'Applied', data: {...(was.data || {}), submitted_at: at}}}});
      return {ok: true, id: row.id};
    },
  };
}
