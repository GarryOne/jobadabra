// Owns: run(), the one place a Python engine command is spawned: its output lines, the silence watchdog (LIMITS), the result file,
// the run-end listeners (onRunEnd), and stopRunning() for quitting the app.
// Guarded by: test/pipeline-run.test.js, test/run-stopped.test.js, test/stopped-head.test.js, test/stop-task.test.js, test/demo.test.js.
// Split out of pipeline.js (a pure move); pipeline.js re-exports everything.
import * as demo from './demo.js';
import * as demoSearch from './demo-search.js';
import * as engineLog from './engine-log.js';
import {log as appLog} from './log.js';
import {readResult} from './run-result.js';
import {spawn} from 'node:child_process';
import {killTree} from './kill-tree.js';
import {randomBytes} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {awakeNow} from './awake.js';
import {isDemo, pipelineEnv, python, readable, REPO} from './pipeline-env.js';
import {quietText} from './pipeline-lines.js';
import {ticketRunning} from './pipeline-queue.js';
import {draftsKits} from './pipeline-args.js';

// The pipeline processes running now: stopRunning() ends them cleanly when the app quits (instead of them
// failing on their next line once the app is gone).
const children = new Set();
export function stopRunning(options) { for (const child of [...children]) killTree(child, options); }
// Run `python -m <args>` in the repo; resolve with {code, stdout}; each output line goes to onLine (made readable).
// stdout itself stays as printed, for the callers that parse it.
// Every finished run is told to these (technical reports: a failed run, with its last lines; lib/telemetry.js).
const runEnd = new Set();
export const onRunEnd = listener => runEnd.add(listener);
// A run of the engine (`python -m src …`) that stops talking, or lasts far too long, is stopped, said so in the log and reported (technical
// reports: run_failed with timedOut). 2 Oct 2026: a friend's search sat "Running" for 40 minutes (every AI call waiting on a Claude Code that
// did not answer) and nothing, not the row in Notion, not a report, said it was stuck. SIGTERM lets the engine close its Notion row.
// The end-to-end journey shortens the silence limit (JOB_PILOTTO_E2E_IDLE_MS) so a hung AI can be tested in under a minute; never set for a user.
const E2E_IDLE = process.env.JOB_PILOTTO_E2E ? Number(process.env.JOB_PILOTTO_E2E_IDLE_MS) || 0 : 0;
export const LIMITS = {idleMs: E2E_IDLE || 15 * 60 * 1000, totalMs: 45 * 60 * 1000, checkMs: E2E_IDLE ? 1000 : 5000, killAfterMs: E2E_IDLE ? 3000 : 8000, watchAll: false};   // watchAll: tests watch any module, not only `src …`
// What a person reads when the app stopped a silent run (the row, its detail, the toast, the bottom bar). #185: it said only "no output for 10 s", with no
// next step. The prefix stays: tests and the technical log match it.
export const stoppedReason = timedOut => `Stopped by Jobadabra: ${timedOut}. The run went quiet, so it was stopped. Run it again; if it keeps stopping, check your AI key or plan in Settings.`;
// `stopAfterMs`: a run whose time is up after that long is stopped then (`endedByTime` says so), e.g. Find jobs' 180 s (lib/search-steps.js); a run whose answer is no use after that long is stopped then (7 Oct 2026: Claude's filter choices went on for 130 s after
// the page had been read without them, slowing every other Claude call of a Find jobs using your browser run).
// `inTask`: the kind of task whose command this is, when its output does not go through the task's own line handler.
// `logArgs`: what the logs and the run-end listeners see instead of `args` (a store call's arguments are the person's data). `privateOutput`:
// stdout is the caller's alone, never written to engine.log, onLine, the tail or a report (a store call's answer is the person's records;
// logs say identities, never content). stderr is still logged: it is the engine's own words.
// The type of a private run's failure ("OperationalError" of {"error": "OperationalError: …"}); its message may hold the person's data, so only the type is kept.
export const errorKindOf = stdout => /^"?([A-Za-z_][\w.]*(?:Error|Exception|Exit))\b/.exec(String((() => { try { return JSON.parse(String(stdout).trim().split('\n').pop()).error; } catch { return ''; } })() || ''))?.[1] || '';   // words-ok: matches a Python exception type name in our own engine's error, not page text

export function run(storage, args, onLine = () => {}, extraEnv = {}, {stopAfterMs = 0, logArgs = null, privateOutput = false, inTask = '', onChild = null} = {}) {
  if (isDemo() && demoSearch.isSearchRun(args)) return demoSearch.play(onLine);   // Find jobs in the demo: the scripted search (lib/demo-search.js)
  if (isDemo() && demoSearch.isQuietStep(args)) return Promise.resolve({code: 0, stdout: ''});
  if (isDemo() && !demo.pipelineAllowed(args)) { onLine('Demo mode: nothing runs and nothing is sent.'); return Promise.resolve({code: 1, stdout: ''}); }
  const started = Date.now(), tail = [], shown = logArgs || args;
  const told = onLine;
  // The run's output is written down as it comes (logs/engine.log) and its two markers go to the app log, so a run
  // that went wrong can be read back afterwards instead of being lost with the window (1 Oct 2026).
  const runId = extraEnv.JOB_PILOTTO_RUN_ID || randomBytes(6).toString('hex');
  const resultFile = path.join(os.tmpdir(), `jp-result-${runId}.json`);
  engineLog.start(shown, new Date(), runId);
  appLog('run', `start: python -m ${shown.join(' ')}`, {run_id: runId});
  onLine = line => { tail.push(line); if (tail.length > 30) tail.shift(); told(line); };
  // The task this command belongs to (its output goes to the task's own log): Stop ends it, and a stopped task starts no next step.
  const ticket = ticketRunning();
  const owner = ticket && (told === ticket.tee || (inTask && ticket.kind === inTask)) ? ticket : null;   // inTask: a command a run of that kind starts with its own line handler (visits.js engineJson): Stop ends it too (25 Oct 2026)
  if (owner?.stopped) { engineLog.end({code: null, seconds: 0, runId}); return Promise.resolve({code: null, stdout: '', result: null, runId, timedOut: false}); }
  const start = aboutFile => new Promise((resolve, reject) => {
    const child = spawn(python(), ['-m', ...args], {cwd: REPO, detached: process.platform !== 'win32', env: {...pipelineEnv(storage), ...extraEnv,
      JOB_PILOTTO_RUN_ID: runId, JOB_PILOTTO_RESULT_FILE: resultFile, JOB_PILOTTO_TIME_UP_FILE: path.join(os.tmpdir(), `jp-timeup-${runId}`), ...(aboutFile ? {JOB_PILOTTO_ABOUT_YOU_FILE: aboutFile} : {})}});
    children.add(child);
    onChild?.(child);   // a caller that must end this one command by itself (Cancel sign-in), by the child's own handle
    owner?.children.add(child);
    child.on('exit', () => { children.delete(child); owner?.children.delete(child); });
    let endedByTime = false, hardKill = null;
    const timeUpFile = path.join(os.tmpdir(), `jp-timeup-${runId}`);   // the engine reads it in its SIGTERM handler (src/notion/cron_runs.py stop_reason): a time-up, not a Stop press
    const stopper = stopAfterMs ? setTimeout(() => {
      endedByTime = true;
      try { fs.writeFileSync(timeUpFile, ''); } catch {}
      appLog('run', `stopped after ${Math.round(stopAfterMs / 1000)} s: python -m ${shown.join(' ')} (its time was up)`, {run_id: runId});
      killTree(child);   // SIGTERM: the engine closes its row and leaves (src/run_log.py); what it saved per item stays
      hardKill = setTimeout(() => killTree(child, {signal: 'SIGKILL'}), LIMITS.killAfterMs);   // a step that ignores SIGTERM is not left running
    }, stopAfterMs) : null;
    child.on('exit', () => { clearTimeout(stopper); clearTimeout(hardKill); });
    child.on('close', () => { try { fs.unlinkSync(timeUpFile); } catch {} try { if (aboutFile) fs.unlinkSync(aboutFile); } catch {} });
    let stdout = '', buffer = '', lastOutputAt = awakeNow(), timedOut = '', killTimer = null, rowUrl = '';
    const startedAwake = awakeNow();   // the watchdog's clock leaves out the time the computer slept (lib/awake.js)
    const watch = (args[0] === 'src' || LIMITS.watchAll) ? setInterval(() => {
      if (timedOut) return;
      const quiet = awakeNow() - lastOutputAt, total = awakeNow() - startedAwake;
      timedOut = quiet > LIMITS.idleMs ? `no output for ${quietText(quiet)}` : total > LIMITS.totalMs ? `still running after ${Math.round(total / 60000)} min` : '';
      if (!timedOut) return;
      appLog('run', `watchdog: python -m ${shown.join(' ')} stopped, ${timedOut}`, {run_id: runId, last: tail.at(-1) || ''});
      onLine(`⚠️ ${stoppedReason(timedOut)} The last thing it did: ${tail.at(-1) || 'nothing yet'}`);
      killTree(child);
      killTimer = setTimeout(() => killTree(child, {signal: 'SIGKILL'}), LIMITS.killAfterMs);
    }, LIMITS.checkMs) : null;
    const lines = chunk => {
      buffer += chunk;
      const parts = buffer.split(/\r?\n/);  // Windows ends lines with \r\n
      buffer = parts.pop();
      parts.filter(Boolean).forEach(raw => { engineLog.line(raw); onLine(readable(raw)); rowUrl = /^Cronjob run logged: (\S+)/.exec(raw)?.[1] || rowUrl; });
    };
    child.stdout.on('data', data => { lastOutputAt = awakeNow(); stdout += data; if (!privateOutput) lines(String(data)); });
    child.stderr.on('data', data => { lastOutputAt = awakeNow(); lines(String(data)); });
    child.on('error', reject);
    child.on('close', async exitCode => {
      clearInterval(watch);
      clearTimeout(killTimer);
      const code = timedOut ? (exitCode || 124) : exitCode;   // a killed run is a failed run, whatever status the signal gave
      if (buffer) { engineLog.line(buffer); onLine(readable(buffer)); }
      const seconds = Math.round((Date.now() - started) / 1000);
      const result = readResult(resultFile);
      try { fs.unlinkSync(resultFile); } catch {}
      if (result && code !== 0 && !endedByTime) result.ok = false;   // a time-up keeps what the engine published (it closed its row as ended, not failed)
      engineLog.end({code, seconds, runId});
      appLog('run', `end: python -m ${shown.join(' ')} -> exit ${code} in ${seconds}s`, {run_id: runId, tail: tail.slice(-3)});
      for (const listener of runEnd) { try { listener({args: shown, code, seconds: Math.round((Date.now() - started) / 1000), tail: [...tail], runId, timedOut, result, errorKind: privateOutput && code ? errorKindOf(stdout) : ''}); } catch {} }
      // Killed (by the watchdog, or from outside: no exit code), so it could not close its own row.
      if ((timedOut || exitCode === null) && rowUrl) {
        const reason = timedOut ? stoppedReason(timedOut) : 'Stopped before it finished. What it saved is kept; the next run continues.';
        const closed = await (await import('./run-history.js')).closeStopped(storage, rowUrl, reason).catch(() => false);
        appLog('run', `its run row ${closed ? 'was closed as Failed' : 'was already closed'}`, {run_id: runId});
      }
      resolve({code, stdout, result, runId, timedOut, endedByTime});
    });
  });
  // Why (owner, 28 Oct 2026, D1b): a run that drafts kits gets the CV with the Experience bank from About you, in a file of its own for this run.
  // Loaded only for such a run: the store imports this file, and About you's CV reading pulls in the CV and form modules (an import cycle at load).
  if (!draftsKits(args)) return start('');
  return import('./about-you.js').then(about => about.writeBundle(storage, 'kit', path.join(os.tmpdir(), `jp-about-you-${runId}.json`)), () => '').then(file => {
    if (!owner?.stopped) return start(file);
    try { if (file) fs.unlinkSync(file); } catch {}
    engineLog.end({code: null, seconds: 0, runId});
    return {code: null, stdout: '', result: null, runId, timedOut: false};
  });
}
