// What the engine-backed tests (run-*.test.mjs) read after a run: the row the store holds for it as Recent runs reads it (lib/run-rows.js fromRecord, the app's own), the app's own
// record of the run, and every word a person could be shown for it. One place, so the AI, Notion and channel tests cannot judge a run differently.
// Job: serve stored answers
import assert from 'node:assert/strict';
import {badSummary, leaks} from '../../e2e/lib/activity.mjs';
import {whenDrained} from '../../e2e/lib/ai-proxy.mjs';
import {merge} from '../../lib/run-history.js';
import {fromRecord} from '../../lib/run-rows.js';
import {aiLimitHead, deliveryHead, failureHead, notConnectedHead, runPill, stoppedHead, waitedHead} from '../../renderer/run-status.js';
import {groupWarnings, isSpendingLimit, runWarningLines} from '../../renderer/run-warnings.js';

/**
 * What a person is shown for the run `done` (the result of kit.runTask), built by the app's own code: the row the store holds for it (lib/run-rows.js fromRecord) merged with this
 * Mac's record of it (lib/run-history.js merge, as Recent activity does), then the pill (renderer/run-status.js runPill) and the warning lines (renderer/run-warnings.js, each as humanError
 * says it). `mode` is the store row's mode for the task (search 'run', Gmail 'mail', report 'weekly', employers 'scout'): the app's record keeps the LAST "Cronjob run logged" link of a task, and
 * a Find jobs ends by running the employer finder, so its link is the finder's row, not the search's: the task's own row is found by mode and start time.
 * -> {stored, shown, app, pill, warnings, result, words, rows}; `words` is everything a person could read about the run.
 */
export async function whatARunShows(kit, done, {mode = 'run'} = {}) {
  const rows = await kit.storedRuns();
  const app = done.run;
  const began = Date.parse(app.startedAt) - 2000;
  const stored = rows.filter(row => row.mode === mode && Date.parse(row.started_at) >= began).sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))[0] || null;
  const own = stored ? {...app, notionUrl: fromRecord(stored).notionUrl} : app;
  const shown = merge(stored ? [fromRecord(stored)] : [], [own]).runs[0] || own;
  const pill = runPill(shown)[0];
  // The box above the log (pages/activity-result-top.js): a head the app words itself for a failure, a stop, a spending limit or a missed delivery, else the run's warning lines grouped.
  // The raw lines stay in the Technical log below it, where the engine's own words are meant to be.
  const kinded = {...shown, kind: shown.kind || 'search'};
  const head = aiLimitHead(kinded) || stoppedHead(kinded) || deliveryHead(kinded) || notConnectedHead(kinded) || waitedHead(kinded) || failureHead(kinded);
  const warnings = head ? [] : [].concat(groupWarnings(runWarningLines(shown))).map(group => (typeof group === 'string' ? group : JSON.stringify(group)));
  const result = String(shown.result || shown.summary || '');
  // `words`: what a person reads first (the pill, the result line, the reason, the box's head); `warnings`: the detail lines under it, which keep the engine's own technical wording by design
  // (the headline sentence above them, renderer/pages/activity-basics.js warningSummary, is what says "your spending limit was reached": mirrored by `limited`).
  const words = [pill, result, shown.problem, shown.message, head ? JSON.stringify(head) : ''].filter(Boolean).join('\n');
  const limited = runWarningLines(shown).some(isSpendingLimit) || isSpendingLimit(words);
  return {stored, shown, app, pill, head, warnings, result, words, limited, rows, lines: done.lines};
}

/** The problems every run must be free of, whatever failed (none = right): a sound summary line, no raw API / Notion / traceback words where a person reads, no secret or folder in the log. */
export function commonProblems(kit, seen, {secrets = []} = {}) {
  const found = [];
  // The list's own line (renderer/pages/activity-basics.js outcome) needs the DOM; the words a record brings are judged here, the line drawn from the record in screen-activity-failures.test.js.
  const bad = seen.result ? badSummary(seen.result) : '';
  if (bad) found.push(`the list's words are wrong: ${bad}`);
  const raw = /rate_limit_error|api_error|authentication_error|invalid_request_error|\{'type': 'error'|Traceback|<!DOCTYPE|<html|Bad Gateway<|"object":\s*"error"|rate_limited|internal_server_error|ECONNRE|socket hang up/.exec(seen.words);
  if (raw) found.push(`raw technical words are shown to the person: "...${seen.words.slice(Math.max(0, raw.index - 80), raw.index + 80).replace(/\n/g, ' | ')}..."`);
  const markup = /<!DOCTYPE|<html|Bad Gateway<|Traceback \(most recent/.exec(seen.warnings.join('\n'));
  if (markup) found.push(`a warning detail shows markup or a traceback: "${markup[0]}"`);
  for (const leak of leaks(`${seen.app.log.join('\n')}\n${seen.words}\n${seen.warnings.join('\n')}`, {secrets: ['sk-ant-e2e-dummy-key', ...secrets], dirs: [kit.profile, kit.feeds]})) found.push(`the log shows ${leak}`);
  return found;
}

/** Nothing is left Running: the app runs nothing, and no row of the store says Running (the check "no row stays Running"). */
export async function assertNothingRunning(kit) {
  assert.equal(kit.running(), null, `the app still says "${kit.running()?.kind}" is running`);
  const running = (await kit.storedRuns()).filter(row => row.status === 'Running');
  assert.deepEqual(running.map(row => `${row.kind} ${row.summary}`), [], 'a run row of the store still says Running');
}

/** A fault set on the proxy must have fired on this run, and the run's connections close before the next scenario: the same checks as the e2e steps' consumedFault/releaseFault. */
export async function releaseFault(kit, fault) {
  kit.proxy.setMode('pass');
  await whenDrained(fault);
  assert.equal(fault.pending, 0, `AI ${fault.mode} left ${fault.pending} request(s) pending after its run ended`);
}
