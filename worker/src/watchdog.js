// The GitHub-side watchdog of the Worker's on-time starts (6 Oct 2026). The owner looks at GitHub only; the Worker's own warnings live on Cloudflare (its cron history)
// and Telegram, and none of them can speak when the Worker itself is broken: on 5-6 Oct a freshly created Worker had no secrets, every start was refused for a day, and
// nothing on GitHub said so. schedule-watchdog.yml runs this on GitHub's own (late, but eventual) schedule: it lists the starts the Worker should have made, from the
// same crons and rules it runs (scheduler.js), finds each one's run, and keeps one issue open while any is missing. Pure: the CLI is scripts/watchdog.mjs.
import {CRONS, jobsFor, TITLES} from './scheduler.js';

export const LABEL = 'schedule-watchdog';
export const TITLE = '⏰ On-time starts missing';
export const GRACE_MIN = 30;     // a slot younger than this is not judged yet (the run may still be starting)
export const WINDOW_MIN = 10;    // a Worker start appears within seconds of its slot; a hand start in the same ten minutes is accepted too

// "M H * * *" with M a number and H a number, a list or */n (the forms CRONS uses) -> does it fire at this UTC minute?
const field = (spec, value) => spec === '*' || spec.split(',').some(part => (part.startsWith('*/') ? value % Number(part.slice(2)) === 0 : Number(part) === value));
export const fires = (cron, date) => { const [minute, hour] = cron.split(' '); return field(minute, date.getUTCMinutes()) && field(hour, date.getUTCHours()); };

// -> [{workflow, cron, at}]: for each workflow, its latest start that is due (older than GRACE_MIN, within `hours`), by the Worker's own rules (jobsFor: the nightly only at
// 04:00 Zurich).
export function dueStarts(now = new Date(), {hours = 26, grace = GRACE_MIN, crons = CRONS} = {}) {
  const latest = new Map();
  const end = Math.floor((now.getTime() - grace * 60000) / 60000) * 60000;
  for (let at = end; at > end - hours * 3600000; at -= 60000) {
    const date = new Date(at);
    for (const cron of crons) {
      if (!fires(cron, date)) continue;
      // Why (31 Oct 2026, owner, Worker cron): ten-minute verdict repairs would churn the hourly missing-start issue; watch the longer schedules only.
      for (const job of jobsFor(cron, date)) if (job.workflow !== 'pr-verdict.yml' && !latest.has(job.workflow)) latest.set(job.workflow, {workflow: job.workflow, cron, at: date.toISOString()});
    }
  }
  return [...latest.values()].sort((a, b) => a.workflow.localeCompare(b.workflow));
}

// A run is that start when it carries the on-time title, or was started by hand-or-API (workflow_dispatch) in the minutes after the slot.
export function startedAt(due, runs = []) {
  const from = Date.parse(due.at), to = from + WINDOW_MIN * 60000;
  return runs.find(run => {
    const created = Date.parse(run.createdAt);
    return created >= from - 120000 && created <= to && (run.displayTitle === TITLES[due.workflow] || run.event === 'workflow_dispatch');
  }) || null;
}

// runsOf: {workflow: [{createdAt, displayTitle, event, url}]} -> the due starts that have no run.
export const missingStarts = (due, runsOf) => due.filter(item => !startedAt(item, runsOf[item.workflow] || []));

const clock = iso => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
export const keyOf = missing => missing.map(item => `${item.workflow}@${item.at.slice(0, 16)}`).join(',');
export function issueBody(missing, {checked, runUrl = ''} = {}) {
  return [`**The Worker's cron did not start ${missing.length === 1 ? 'this run' : `these ${missing.length} runs`} on time** (checked ${clock(checked)}${runUrl ? `, [watchdog run](${runUrl})` : ''}):`, '',
    '| Workflow | Due | Cron |', '|---|---|---|', ...missing.map(item => `| \`${item.workflow}\` | ${clock(item.at)} | \`${item.cron}\` |`), '',
    "GitHub's own schedule still starts them, late or not at all (it skipped 4 of 6 stats runs on 5-6 Oct). What to check:",
    '- the Worker\'s secrets: `cd worker && npx wrangler secret list` (GITHUB_TOKEN, TELEGRAM_BOT_TOKEN, OWNER_CHAT_ID; `npm run deploy` checks them)',
    "- a refused start is commented here by the Worker itself, with GitHub's answer",
    '- the schedule: `worker/src/scheduler.js` and `worker/wrangler.toml` [triggers]', '',
    `<sub>Kept by \`.github/workflows/schedule-watchdog.yml\` (\`worker/src/watchdog.js\`): updated each hour while a start is missing, closed when every one is seen again.</sub>`,
    `<!-- watchdog-missing: ${keyOf(missing)} -->`].join('\n');
}
export const recoveredComment = (due, runsOf) => ['✅ **Every on-time start was seen again:**', '',
  ...due.map(item => { const run = startedAt(item, runsOf[item.workflow] || []); return `- \`${item.workflow}\` ${clock(item.at)}: ${run?.url ? `[started](${run.url})` : 'started'}`; })].join('\n');
