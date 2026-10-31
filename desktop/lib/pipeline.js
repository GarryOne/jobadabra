// Runs the existing Python pipeline (src/) for this user: their folder, their keys, their models.
// This file is only the entry: the pieces live in pipeline-*.js and every name is re-exported here, so callers import './pipeline.js' as before.
//   pipeline-env.js       REPO, python(), MODELS, pipelineEnv, readable, demo switch
//   pipeline-run.js       run(): spawn one engine command, watchdog, stopRunning
//   pipeline-lines.js     output-line helpers, TASKS catalog
//   pipeline-queue.js     the queue: serial, tracked, Stop, unqueue, runs.json, queue.json
//   pipeline-args.js      the engine's command lines (dailyArgs, mailArgs, ...)
//   pipeline-tasks.js     tracked tasks (refresh, checkMail, scout, ...)
//   pipeline-commands.js  one-shot commands (jobs, addLead, focus, setStatus, ...)
// Guarded by: test/pipeline-run.test.js and the queue/stop/run-* tests named in each piece.
export {REPO, MODELS, python, ensureConfig, setCrashReports, pipelineEnv, readable, setDemo} from './pipeline-env.js';
export {stopRunning, hasChildren, isWatched, onRunEnd, LIMITS, stoppedReason, run} from './pipeline-run.js';
export {quietText, isDataLine, TASKS, taskName, failedLine, appMessage, taskSummary, isProgressStep, STATUS_LINE, leadStepOf, HEARTBEAT_MS} from './pipeline-lines.js';
export {stopTask, serial, RUN_HISTORY, saveRuns, runs, running, keep, queued, INTERRUPTED, freezeQueue, unqueue, takeQueue, whenIdle} from './pipeline-queue.js';
export {dailyArgs, SEARCH_BUDGET_S, SCOUT_BUDGET_S, syncMatchesArgs, mailArgs, triggerEnv, visitsArgs} from './pipeline-args.js';
export {refresh, syncMatches, mailProblem, checkMail, mailResult, scout, work, task, scoreVisits} from './pipeline-tasks.js';
export {jobs, calendarJobs, importJob, addApplied, confirmedArgs, proposeLead, addLead, posting, reviewRejection, focus, focusDone, focusHistory,
  interviewPrep, describeJob, reassignEmail, interviewHappened, feedbackAction, focusReminder, unapply, notSubmitted, markOutcome, deleteJob, clearJobs, setStatus} from './pipeline-commands.js';
