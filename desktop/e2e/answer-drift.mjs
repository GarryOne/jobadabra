// Sample stored prompts offline by default, or report a CI-only fresh subscription-model drift night.
// Job: serve stored answers
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildReport} from './lib/answer-drift.mjs';
import {requireOidc, runLive} from './lib/answer-drift-live.mjs';
import {finalizeNight} from './lib/answer-drift-rate.mjs';

function readHistory(file) {
  if (!file || !fs.existsSync(file)) return [];
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(data)) throw new Error('live history must be a newest-first array');
  return data;
}

/** Run the offline-default CLI or a CI/OIDC-only night; dependencies permit offline broker tests. */
export async function main(args = process.argv.slice(2), {env = process.env, ask, now = () => new Date()} = {}) {
  let limit = 20, live = false, dry = false, historyFile, out = 'ai-answer-drift';
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--dry-run') { dry = true; continue; }
    if (arg === '--live') { live = true; continue; }
    if (['--limit', '--history', '--out'].includes(arg)) {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(`${arg} needs a value`);
      if (arg === '--limit') limit = Number(value);
      if (arg === '--history') historyFile = value;
      if (arg === '--out') out = value;
      continue;
    }
    throw new Error(`unsupported option: ${arg}`);
  }
  if (live && dry) throw new Error('choose --live or --dry-run');
  if (!live) {
    const history = historyFile ? JSON.parse(fs.readFileSync(historyFile, 'utf8')) : {};
    const report = await buildReport({limit, history});
    console.log(JSON.stringify(report, null, 2));
    return report;
  }
  requireOidc(env);
  const history = readHistory(historyFile), rotation = {};
  for (const night of [...history].reverse()) for (const row of night.observations) rotation[row.promptId || row.id] = {lastChecked: night.day};
  const liveReport = await runLive({env, ask, limit, history: rotation});
  const {report, history: next} = finalizeNight(liveReport, history, {runId: env.GITHUB_RUN_ID, day: now().toISOString().slice(0, 10)});
  fs.mkdirSync(out, {recursive: true});
  fs.writeFileSync(path.join(out, 'ai-answer-drift.json'), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(out, 'ai-answer-drift.md'), report.markdown);
  if (historyFile) {
    fs.mkdirSync(path.dirname(historyFile), {recursive: true});
    fs.writeFileSync(historyFile, `${JSON.stringify(next, null, 2)}\n`);
  }
  const escape = value => value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  console.log(`::notice::${escape(report.notice)}`);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(report => {
    // Why (30 Oct 2026, owner, JOB-45): only this standalone nightly check turns red; incomplete is never healthy, and warm-up only warns.
    if (['red', 'incomplete'].includes(report.verdict?.state)) process.exitCode = 1;
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
