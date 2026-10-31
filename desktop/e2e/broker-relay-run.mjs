// Runs a command whose AI calls go through the Codex broker, with the relay (lib/broker-relay-serve.mjs) on 127.0.0.1 in front of it, and says out loud when any AI call failed.
//   node broker-relay-run.mjs --job central-scout --cap 40 -- python -m src scout --publish-index      (.github/workflows/central-scout.yml)
// Why (31 Oct 2026, owner: "We should use fully the Codex"; coordinator: "the silent green is a bug in its own right"): central-scout run 41192760002 ended `success` with 1,417 logged AI failures
// (the Anthropic workspace's usage limit, HTTP 400) and 1,552 "regain access on 2026-11-01" lines: nobody saw that the day's judgments were skipped. Every AI call of the command passes through the
// relay, so the relay's counts are the truth: any failed call becomes an "AI skipped/failed" annotation, a step summary line, ai-capped.json for the ONE alert of the run, and skipped=true for the steps after.
// The command keeps its own exit code (a refused judgment leaves items unjudged, never fails the day's publish) and never gets a real Anthropic key or an address off this machine.
// Job: report health
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {noteSkipped} from './lib/broker-job.mjs';
import {startRelay} from './lib/broker-relay-serve.mjs';

/** The env the command gets: the relay's address, a dummy key (the SDK wants one), the cap as the engine's own limit, and no other AI address or key. */
export function childEnv(env, url, cap) {
  const rest = {...env};
  for (const name of ['ANTHROPIC_BASE_URL', 'OPENAI_API_KEY', 'OPENAI_BASE_URL']) delete rest[name];
  return {...rest, JOB_PILOTTO_AI_BASE_URL: url, ANTHROPIC_API_KEY: 'codex-relay-local', ...(cap ? {JOB_PILOTTO_CENTRAL_MAX_CALLS: String(cap)} : {})};
}

/**
 * Takes the relay's stats and the job name; returns {line, why}: one plain line for the log, and the reason when any call failed ('' when none did).
 * A cap reached by design (capHit) is said but is not a failure.
 */
export function outcomeOf(stats, job) {
  const line = `broker relay (${job}): ${stats.calls} calls reached the broker, ${stats.ok} answered, ${stats.failed} failed or refused${stats.capHit ? `, ${stats.capHit} past the run's cap (those items wait for the next run)` : ''}`;
  if (!stats.failed) return {line, why: ''};
  const first = stats.latched || stats.reasons[0] || 'unknown';
  return {line, why: `${stats.failed} AI calls failed or were refused (${first}); their items stay unjudged until a run gets an answer`};
}

/** Runs `argv` behind a relay; resolves to the command's exit code. Takes {job, cap, argv, env, dir}. */
export async function runBehindRelay({job, cap = 0, argv, env = process.env, dir, answer}) {
  const relay = await startRelay({cap, env, ...(answer ? {answer} : {})});
  const code = await new Promise(resolve => {
    const child = spawn(argv[0], argv.slice(1), {stdio: 'inherit', env: childEnv(env, relay.url, cap)});
    child.on('error', error => { console.error(`::error::${job}: cannot start ${argv[0]}: ${error.message}`); resolve(127); });
    child.on('exit', (status, signal) => resolve(status ?? (signal ? 128 : 1)));
  });
  await relay.close();
  const {line, why} = outcomeOf(relay.stats, job);
  console.log(line);
  if (env.GITHUB_STEP_SUMMARY) { try { fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `${why ? `⚠️ **AI skipped/failed (${job}):** ${why}\n\n` : ''}${line}\n`); } catch { /* a summary never breaks the run */ } }
  if (why) noteSkipped({job, why: `AI skipped/failed: ${why}`, env, ...(dir ? {dir} : {})});
  return code;
}

async function main() {
  const args = process.argv.slice(2), split = args.indexOf('--');
  const flag = name => (args.indexOf(name) >= 0 && args.indexOf(name) < (split < 0 ? args.length : split) ? args[args.indexOf(name) + 1] : '');
  if (split < 0 || split === args.length - 1) throw new Error('usage: broker-relay-run.mjs --job <name> [--cap <calls>] -- <command...>');
  process.exitCode = await runBehindRelay({job: flag('--job') || 'ai job', cap: Number(flag('--cap')) || 0, argv: args.slice(split + 1)});
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main().catch(error => { console.error(`::error::${error.message}`); process.exit(1); });
