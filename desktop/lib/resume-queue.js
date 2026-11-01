// Jobs you had started when the app last quit (pipeline queue.json) start again a little after launch. The queue is taken at LAUNCH and started later: read at
// start time, it holds what you started in this session (a Run pressed in the first 20 s), and that job ran twice (2 Oct 2026, found by the activity e2e suite).
import {e2eMs} from './e2e-timing.js';
export function scheduleResume(pipeline, storage, {cloud = false, begin, delayMs = 20 * 1000, timer = setTimeout}) {
  const jobs = pipeline.takeQueue(storage).filter(job => job.trigger !== 'schedule' && !(cloud && ['search', 'mail'].includes(job.kind)));
  timer(() => begin(jobs), delayMs);
  return jobs;
}

// The wait before the last session's jobs start again: 20 s, so the schedule's own catch-up has queued what is due. The end-to-end journey shortens it (never for a user).
export const resumeDelay = (env = process.env) => e2eMs('RESUME_MS', 20 * 1000, env);

// Owner, 7 Oct 2026: what was running or waiting when you quit is not started again by itself: the app asks, "Start again" or "Leave stopped"
// (left stopped, the run stays Interrupted in Recent activity, with its log and a Run again). `ask` shows the question and resolves to the
// button's index. The end-to-end journey cannot press a native dialog: it answers JOBADABRA_E2E_RESUME (start | leave; start when unset).
export function resumeQuestion(names) {
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
  return {type: 'question', buttons: ['Start again', 'Leave stopped'], defaultId: 0, cancelId: 1,
    message: `Start ${list} again?`,
    detail: `${names.length > 1 ? 'They were' : 'It was'} running or waiting when Jobadabra closed. What a run saved is kept; started again, it continues `
      + 'from there. Left stopped, it stays in Recent activity as Interrupted, with Run again.'};
}
export async function askResume(names, {ask, env = process.env} = {}) {
  if (!names.length) return {start: false, decidedBy: 'nothing to ask'};
  if (env.JOBADABRA_E2E) return {start: env.JOBADABRA_E2E_RESUME !== 'leave', decidedBy: 'e2e'};
  const {response} = await ask(resumeQuestion(names));
  return {start: response === 0, decidedBy: 'you'};
}
