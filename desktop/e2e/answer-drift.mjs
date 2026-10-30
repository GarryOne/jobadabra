// Print tonight's stored-prompt sample and coverage offline; live execution is deliberately absent.
// Job: serve stored answers
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildReport} from './lib/answer-drift.mjs';

/** Run the offline-only CLI; unknown options, including --live, are refused. */
export async function main(args = process.argv.slice(2)) {
  let limit = 20, history = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--dry-run') continue;
    if (arg === '--limit') { limit = Number(args[++index]); continue; }
    if (arg === '--history') { history = JSON.parse(fs.readFileSync(args[++index], 'utf8')); continue; }
    throw new Error(`unsupported option: ${arg}; only --dry-run [--limit N] [--history file] is available`);
  }
  const report = await buildReport({limit, history});
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
