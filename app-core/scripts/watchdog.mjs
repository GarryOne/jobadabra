// The watchdog of the Worker's on-time starts, on GitHub (schedule-watchdog.yml; the rules are src/watchdog.js):
//   node app-core/scripts/watchdog.mjs [--dry]       needs gh (GH_TOKEN in CI). --dry prints what it would do and changes nothing.
// A start missing -> one issue (label schedule-watchdog) is opened, or its body updated and a comment added when the missing set changed. Every start seen -> closed.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {dueStarts, issueBody, keyOf, LABEL, missingStarts, recoveredComment, TITLE} from '../src/watchdog.js';

const dry = process.argv.includes('--dry');
const gh = args => execFileSync('gh', args, {encoding: 'utf8'});
const write = args => { if (dry) console.log(`would run: gh ${args.join(' ').slice(0, 160)}`); else gh(args); };
const now = new Date();
const runUrl = process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : '';

const due = dueStarts(now);
const runsOf = Object.fromEntries(due.map(item => [item.workflow,
  JSON.parse(gh(['run', 'list', '--workflow', item.workflow, '--limit', '100', '--json', 'createdAt,displayTitle,event,url']))]));
const missing = missingStarts(due, runsOf);
for (const item of due) console.log(`${item.workflow} due ${item.at}: ${missing.includes(item) ? 'MISSING' : 'started'}`);

const [open] = JSON.parse(gh(['issue', 'list', '--label', LABEL, '--state', 'open', '--limit', '1', '--json', 'number,body']));
const bodyFile = path.join(os.tmpdir(), 'watchdog-body.md');
if (missing.length) {
  const body = issueBody(missing, {checked: now.toISOString(), runUrl});
  fs.writeFileSync(bodyFile, body);
  if (!open) {
    write(['label', 'create', LABEL, '--force', '--color', 'D93F0B', '--description', "The Worker's cron did not start a scheduled run on time"]);
    write(['issue', 'create', '--title', TITLE, '--label', LABEL, '--body-file', bodyFile]);
  } else if (!String(open.body || '').includes(`<!-- watchdog-missing: ${keyOf(missing)} -->`)) {
    write(['issue', 'edit', String(open.number), '--body-file', bodyFile]);
    write(['issue', 'comment', String(open.number), '--body', `Still missing, now: ${missing.map(item => `\`${item.workflow}\` (${item.at.slice(11, 16)} UTC)`).join(', ')}.`]);
  }
} else if (open) {
  write(['issue', 'close', String(open.number), '--comment', recoveredComment(due, runsOf)]);
}
console.log(missing.length ? `${missing.length} on-time start(s) missing` : 'every on-time start was seen');
