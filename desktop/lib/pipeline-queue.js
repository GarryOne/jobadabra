// Owns: the run queue and its state: serial() (one crawl at a time), tracked() (one task from queued to its history row), Stop (stopTask),
// unqueue, the saved queue (queue.json), runs.json history, keep(), queued(), running(), whenIdle().
// The shared mutable state (current, waiting, runningTicket, keepLine) lives only in this file; others reach it through the getters.
// Guarded by: test/queue.test.js, test/unqueue.test.js, test/stop-task.test.js, test/run-join.test.js, test/run-note.test.js,
// test/interrupted-task.test.js, test/resume-queue.test.js, test/task-log-keep.test.js, test/live-status-line.test.js.
// Split out of pipeline.js (a pure move); pipeline.js re-exports the public names.
import {awakeNow} from './awake.js';
import {killTree} from './kill-tree.js';
import {HEARTBEAT_MS, isDataLine, isProgressStep, keepRunLine, quietText, taskName} from './pipeline-lines.js';

// Crawls share one SQLite file: run them one at a time, like the workflow's concurrency group. In order, except a task queued `first`
// (7 Oct 2026: the light scoring run after Find jobs using your browser waited behind a 15-minute Find new employers queued before it).
const lane = [];
let laneBusy = false;
export function serial(task, {first = false} = {}) {
  return new Promise((resolve, reject) => {
    const job = {task, resolve, reject};
    if (first) lane.unshift(job); else lane.push(job);
    pumpLane();
  });
}
function pumpLane() {
  if (laneBusy || !lane.length) return;
  laneBusy = true;
  const job = lane.shift();
  Promise.resolve().then(() => job.task()).then(job.resolve, job.reject).finally(() => { laneBusy = false; pumpLane(); });
}

// Find new jobs: job boards, then employer feeds + Google Jobs, AI facts and fit scores (with a key),
// and the Telegram digest (when connected). mode 'scheduled' sends only when there's something new.
// Past runs for the activity bar (newest first, last 50): what (kind: 'search' when absent, or 'mail'),
// when, why, what came out, and the log.
export const RUN_HISTORY = 50;
export function saveRuns(storage, list) { storage.writeText('runs.json', JSON.stringify(list.slice(0, RUN_HISTORY))); }
export function runs(storage) { try { return JSON.parse(storage.readText('runs.json')) || []; } catch { return []; } }
let current = null;
export const running = () => current;
// The task the Mac is running now (read by run() to tie a command to its task; the binding itself stays in this file).
export const ticketRunning = () => runningTicket;
// Lines the app shows in the window while a tracked task runs but that don't come through the task's own output (a step it starts with its own
// command, like Find jobs using your browser' filter choice): kept in the task's log too, so the Technical log after a reopen or ⌘R is what was shown live
// (7 Oct 2026: a reset brought back 4 lines of a log that had shown many more). main.js's log() calls it for every line it sends.
let keepLine = null, teeing = false;
export function keep(line) { if (keepLine && !teeing) keepLine(line); }
// Tracked tasks waiting behind the running one (oldest first), so Recent activity lists them at once.
let waiting = [], nextTicket = 0, runningTicket = null;
export const queued = () => waiting.map(({id, kind, trigger, queuedAt, note}) => ({id, kind, trigger, queuedAt, ...(note ? {note} : {})}));

// The queue survives quitting the app: queue.json holds the running job and the waiting ones with how to start
// each again (resume: a search's mode, a task's command). The app starts the ones you started again next time
// (the schedule catches up its own). freezeQueue() keeps it as it is while the app quits.
const QUEUE_FILE = 'queue.json';
export const INTERRUPTED = 'Interrupted: Jobadabra was closed while this ran';
let frozen = false;
function saveQueue(storage) {
  if (frozen) return;
  // The running task with its log and its Notion row, so the next start lists it as Interrupted with what it said (7 Oct 2026: a restarted
  // Find new employers showed only the lines after the restart), whether or not it is started again.
  const jobs = [...(current ? [{...current, interrupted: true}] : []), ...waiting]
    .map(({kind, trigger, queuedAt, startedAt, resume, interrupted, log, rowUrl}) => ({kind, trigger, queuedAt: queuedAt || startedAt, resume,
      ...(interrupted ? {interrupted, startedAt, log: (log || []).slice(-300), ...(rowUrl ? {notionUrl: rowUrl} : {})} : {})}));
  storage.writeText(QUEUE_FILE, JSON.stringify(jobs));
}
export function freezeQueue(storage) { saveQueue(storage); frozen = true; }
// Remove a task that waits its turn (Recent activity's queued row, ⌘K; owner, 7 Oct 2026: "can I unqueue a queued task?"). It never starts,
// leaves queue.json, and whoever started it gets {ok: false, removed: true}. A running task is stopped with stopTask instead. -> {ok, kind}.
export function unqueue(storage, id) {
  const ticket = waiting.find(other => other.id === id);
  if (!ticket) return {ok: false, error: 'It is no longer waiting: it has started or finished'};
  ticket.removed = true;
  waiting = waiting.filter(other => other !== ticket);
  saveQueue(storage);
  return {ok: true, kind: ticket.kind};
}
// The jobs saved when the app last quit (and forgets them: they're started again, or dropped).
export function takeQueue(storage) {
  let jobs = [];
  try { jobs = JSON.parse(storage.readText(QUEUE_FILE)) || []; } catch {}
  storage.writeText(QUEUE_FILE, '[]');
  // The task that was running stays in Recent activity as Interrupted, with what it said and its Notion row (so it is listed once), whether it
  // is started again or not: a restart is a new run (7 Oct 2026: Find jobs using your browser vanished after a restart; a restarted scout lost its log).
  const lost = jobs.filter(job => job && job.kind && job.interrupted);
  if (lost.length) {
    const endedAt = new Date().toISOString();
    const rows = lost.map((job, i) => ({id: Date.parse(job.startedAt || job.queuedAt) || Date.now() + i, kind: job.kind, trigger: job.trigger,
      startedAt: job.startedAt || job.queuedAt, endedAt, ok: false, interrupted: true, summary: INTERRUPTED,
      ...(job.notionUrl ? {notionUrl: job.notionUrl} : {}), log: [...(job.log || []), `${INTERRUPTED}.`]}));
    const taken = new Set(rows.map(row => row.id));   // one run, one record: an ending the quit already wrote is replaced by this one
    storage.writeText('runs.json', JSON.stringify([...rows, ...runs(storage).filter(run => !taken.has(run.id))].slice(0, RUN_HISTORY)));
  }
  return jobs.filter(job => job && job.kind && job.resume);
}
// Resolves once nothing runs and nothing waits (for "Quit when done").
export async function whenIdle(poll = 2000) {
  while (current || waiting.length) await new Promise(resolve => setTimeout(resolve, poll));
}
// Stop the running task (Actions and Recent activity, owner 7 Oct 2026: a search ran for an hour with no way to stop it). Its commands are
// ended (SIGTERM, then SIGKILL after 5 s) and its next steps don't start; what it saved stays (each job read or scored is saved as it
// finishes), its Notion row is closed (run()'s close handler) and the next run continues. -> {ok, kind} or {ok: false, error}.
export function stopTask() {
  const ticket = runningTicket;
  if (!ticket || !current?.stoppable) return {ok: false, error: 'Nothing that can be stopped is running'};
  if (ticket.stopped) return {ok: true, kind: ticket.kind};
  ticket.stopped = true;
  ticket.abort?.abort();   // the app's own tasks (work()): their loops end at their next step
  ticket.tee?.('⏹ Stopped by you. What it saved is kept; the next run continues from there.');
  for (const child of ticket.children) {
    killTree(child);
    setTimeout(() => { if (child.exitCode === null && child.signalCode === null) killTree(child, {signal: 'SIGKILL'}); }, 5000).unref?.();
  }
  return {ok: true, kind: ticket.kind};
}
// One tracked task (a search or a Gmail check): `running()` shows it while it runs, and it's kept in
// runs.json afterwards (kind, trigger, times, ok, log and what summarize() adds) for the activity bar.
export function tracked(storage, kind, trigger, onLine, work, resume, summarize, {first = false, note = ''} = {}) {
  // The same task already waiting, or already running: a second click joins it instead of queueing it again (a second search seconds after the first, with nothing
  // new to find, was run in full; 2 Oct 2026). Another task still waits its turn.
  const twin = waiting.find(ticket => ticket.kind === kind) || (runningTicket?.kind === kind ? runningTicket : null);
  if (twin) {
    // Joined: the run already queued or going says what this click wanted too (7 Oct 2026: Re-score joined a running refresh and nothing showed it).
    if (note && !twin.note) { twin.note = note; if (runningTicket === twin && current) current = {...current, note}; saveQueue(storage); }
    return twin.done;
  }
  const ticket = {id: `q${++nextTicket}`, kind, trigger, queuedAt: new Date().toISOString(), resume, ...(note ? {note} : {})};
  if (first) waiting.unshift(ticket); else waiting.push(ticket);
  saveQueue(storage);
  ticket.done = serial(async () => {
    if (ticket.removed) return {ok: false, removed: true, run: null};   // taken out of the queue before its turn (unqueue)
    waiting = waiting.filter(other => other !== ticket);
    runningTicket = ticket;
    const log = [];
    const startedAt = new Date().toISOString();   // the id is this very moment, so a record of the quit (takeQueue: Date.parse(startedAt)) is the same run
    const record = {id: Date.parse(startedAt), ticket: ticket.id, kind, trigger, startedAt, ...(ticket.note ? {note: ticket.note} : {})};   // ticket: a run picked while queued stays picked (renderer/run-pick.js)
    current = {...record, step: 'Starting', resume, stoppable: true};   // every task the Mac runs can be stopped (Actions banner, Recent activity)
    ticket.children = new Set();
    ticket.abort = new AbortController();
    saveQueue(storage);
    let inMessage = false;  // a message for the app (appMessage) isn't a progress step
    let lastAt = awakeNow();
    const tee = line => {
      if (isDataLine(line)) return;
      keepRunLine(log, line);   // a tick replaces the earlier one of its kind; results stay
      if (!line.startsWith('⏳ Still running')) lastAt = awakeNow();
      current = {...current, log: log.slice(-300)};   // the window can be reloaded (⌘R) without losing what the run said so far
      const rowUrl = /^Cronjob run logged: (\S+)/.exec(line)?.[1];
      if (rowUrl) current = {...current, rowUrl};   // the banner's "View log" link; the line itself is not a step
      if (line === '<<<message' || line === 'message>>>') inMessage = line === '<<<message';
      else if (!inMessage && !line.startsWith('⏳ Still running') && isProgressStep(line)) current = {...current, step: line};
      teeing = true;
      try { onLine(line); } finally { teeing = false; }
    };
    ticket.tee = tee;
    keepLine = line => {
      if (isDataLine(line)) return;
      keepRunLine(log, line);
      current = {...current, log: log.slice(-300)};
    };
    let ok = false, result = null;
    // A task can go quiet for minutes (an AI call, a wait for another run): say it is still alive, with how long it has been quiet (tasks 'tracked' here are all of them).
    const beat = setInterval(() => {
      const quiet = awakeNow() - lastAt;
      if (quiet >= HEARTBEAT_MS.quiet) tee(`⏳ Still running · no new output for ${quietText(quiet)}`);
    }, HEARTBEAT_MS.every);
    try {
      const outcome = (await work(tee, ticket.abort.signal)) || {};
      ok = outcome.ok;
      result = outcome.result || null;
    } catch (error) {
      tee(`${taskName(kind)} failed: ${error.message}`);
    } finally {
      clearInterval(beat);
      const notionUrl = result?.notion_url || log.map(line => line.match(/^Cronjob run logged: (\S+)/)?.[1]).filter(Boolean).pop() || null;
      Object.assign(record, {endedAt: new Date().toISOString(), ok, notionUrl, runId: result?.run_id || null,
        log: log.slice(-400), ...summarize(record, log)});
      if (ticket.stopped) {   // the app's own work can return normally after Stop: still not a success
        ok = false;
        Object.assign(record, {ok: false, stopped: 'you', summary: 'Stopped by you. What it saved is kept; the next run continues from there.'});
      }
      if (ticket.note) record.note = ticket.note;   // a click that joined while it ran
      // The quit already listed this run as Interrupted (takeQueue); the ending of the killed run must not list it again under the same id.
      const earlier = runs(storage);
      if (!earlier.some(run => run.id === record.id && run.interrupted)) storage.writeText('runs.json', JSON.stringify([record, ...earlier].slice(0, RUN_HISTORY)));
      current = null;
      keepLine = null;
      runningTicket = null;
      saveQueue(storage);
    }
    return {ok, run: record};
  });
  return ticket.done;
}
