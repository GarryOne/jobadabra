// node pool-ci-summary.mjs <smoke reports folder> [baseline file]: the CI pool run's table for the job log (.github/workflows/record-sites.yml) from the newest day report record-sites.mjs wrote:
// the table on stdout (the job log), exit 1 when a row did not finish, the tripwire fired, the AI was refused or a row fell below
// its last CI run (the baseline file of pool-ci-state.mjs prepare; lib/pool-ci.mjs summary).
import fs from 'node:fs';
import path from 'node:path';
import {summary} from './lib/pool-ci.mjs';
import {liveKeyName} from './lib/engine.mjs';
import {pictureAsksOf} from './lib/picture-asks.mjs';

const dir = process.argv[2] || '';
const days = (() => { try { return fs.readdirSync(dir).filter(name => /^\d{4}-\d\d-\d\d\.json$/.test(name)).sort(); } catch { return []; } })();
if (!days.length) { console.log(`## Record sites ❌\n\nNo day report in ${dir || '(no folder given)'}: the run ended before its first row (read smoke.log in the artifact).`); process.exit(1); }
const baseline = (() => { try { return JSON.parse(fs.readFileSync(process.argv[3], 'utf8')); } catch { return {}; } })();
const {markdown, red, notRun} = summary(JSON.parse(fs.readFileSync(path.join(dir, days.at(-1)), 'utf8')), {baseline, keyName: liveKeyName(process.env)});
process.stdout.write(markdown);
const pictures = pictureAsksOf(dir);   // the screenshot step is ON in CI pool runs only (owner, 13 Oct 2026): its asks and cost on their own line, beside the AI spend
if (pictures) process.stdout.write(`\n${pictures}\n`);
if (notRun && process.env.NOT_RUN_FILE) fs.writeFileSync(process.env.NOT_RUN_FILE, `${notRun}\n`);   // the workflow comments it on the PR
process.exit(red.length ? 1 : 0);
