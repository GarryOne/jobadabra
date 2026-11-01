// One broker call for a scheduled job that may be refused: the Codex budget is used up, the login is lost, the broker is down. The job then SKIPS with the reason (green with a warning, its later steps grey),
// writes ai-capped.json for the one alert of the run (credit-alert.mjs --artifacts), and never moves to another provider.
//   const answer = await askOrSkip(body, {job: 'ui-verdict'});   // {ok: true, text, model, tier, ms, usage} or {ok: false, why}
// Why (31 Oct 2026, owner: "is this expected? Why Anthropic is reached? We should use fully the Codex"; "over-budget jobs skip (grey) until Codex resets on 4 Nov, never paid"): four jobs of one UI-verdict run
// each failed red on Anthropic's empty credit and each sent its own Telegram alert. A refused call is a skip with a reason, and one alert per run.
// Job: report health
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {askBroker} from './broker-client.mjs';

/** The broker statuses that mean "no answer today" (skip); anything else (a 4xx/5xx of its own) is a real failure the job shows red. */
export const SKIPPED = ['capped', 'no-token', 'unreachable'];

/** Where a skipped job leaves its note: AI_CAPPED_DIR, else <runner temp>/ai-capped (outside the checkout, so the fixer's `git status` never sees it); the workflow uploads it as ai-capped-<job>. */
export const cappedDir = (env = process.env) => env.AI_CAPPED_DIR || path.join(env.RUNNER_TEMP || os.tmpdir(), 'ai-capped');

const annotation = text => String(text).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

/**
 * Records the skip: a warning line, ai-capped.json in `dir` (the shape credit-alert.mjs reads), and the step output skipped=true for the steps after it.
 * Takes {job, why, dir, env}; returns the why. Never throws on a file that cannot be written (a note never breaks a run).
 */
export function noteSkipped({job, why, env = process.env, dir = cappedDir(env)}) {
  // Why (1 Nov 2026, owner saw a fixture skip as a warning on a green harness job, #2787): a GitHub annotation only where env sets GITHUB_ACTIONS; a test passes its own env, so its fixture skips print a plain line.
  console.log(env.GITHUB_ACTIONS ? `::warning title=AI skipped (${annotation(job)})::${annotation(why)}` : `AI skipped (${job}): ${why}`);
  try {
    fs.mkdirSync(dir, {recursive: true});
    fs.writeFileSync(path.join(dir, 'ai-capped.json'), JSON.stringify({why: `${job}: ${why}`, provider: 'Codex broker', job, at: new Date().toISOString()}));
    if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, 'skipped=true\n');
  } catch { /* a note never breaks the run */ }
  return why;
}

/**
 * Asks the broker one Messages-shaped question (lib/broker-client.mjs). Takes the body and {job, dir, env, ask}.
 * Returns {ok: true, text, model, tier, ms, usage} on an answer, {ok: false, why} after a skip (noteSkipped ran), and throws on any other failure so the job goes red.
 */
export async function askOrSkip(body, {job, dir, env = process.env, ask = askBroker} = {}) {
  const answer = await ask(body, {env});
  if (answer.ok) return {ok: true, text: answer.message.content[0].text, model: answer.model, tier: answer.tier, ms: answer.ms, usage: answer.message.usage};
  if (SKIPPED.includes(answer.status)) return {ok: false, why: noteSkipped({job, why: answer.detail || answer.status, ...(dir ? {dir} : {}), env})};
  throw new Error(`the Codex broker failed (${answer.status}): ${answer.detail}`);
}
