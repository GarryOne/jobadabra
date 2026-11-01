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
      // Why (31 Oct 2026, owner, Worker cron; a8, night burn-in): the ten-minute verdict repairs would churn the hourly missing-start issue, so only the longer schedules are watched; a night burn-in pass is a start of e2e.yml of its own, keyed apart, or it would replace the three-a-day start (01:47) in this check.
      for (const job of jobsFor(cron, date)) {
        const night = job.inputs?.night_pass || '', key = night ? `${job.workflow}#night` : job.workflow;
        if (job.workflow !== 'pr-verdict.yml' && !latest.has(key)) latest.set(key, {workflow: job.workflow, cron, at: date.toISOString(), ...(night ? {night} : {})});
      }
    }
  }
  return [...latest.values()].sort((a, b) => a.workflow.localeCompare(b.workflow) || Boolean(a.night) - Boolean(b.night));
}

// A run is that start when it carries the on-time title, or was started by hand-or-API (workflow_dispatch) in the minutes after the slot.
export function startedAt(due, runs = []) {
  const from = Date.parse(due.at), to = from + WINDOW_MIN * 60000;
  return runs.find(run => {
    const created = Date.parse(run.createdAt);
    return created >= from - 120000 && created <= to && (run.displayTitle === TITLES[due.workflow] || run.displayTitle?.startsWith(`Night burn-in ${due.night || '-'} `) || run.event === 'workflow_dispatch');
  }) || null;
}

// runsOf: {workflow: [{createdAt, displayTitle, event, url}]} -> the due starts that have no run.
export const missingStarts = (due, runsOf) => due.filter(item => !startedAt(item, runsOf[item.workflow] || []));

export const ROUND_STALE_MIN = 45;   // the site Worker's probe round runs every 15 min; shared/synthetic.js readCard() calls it stale after the same 45
/**
 * The site Worker's probe round as one more missing start: `last` is the answer of GET /api/synthetic/last ({at}), `null` when it could not be read.
 * Stale only on a readable `at` older than ROUND_STALE_MIN; a failed read or a table with no round yet is not judged (a runner's network blip must not open an issue,
 * and a dead site Worker already shows as its missing starts). `at` stays the newest stored round, so the issue key does not change while the round stays stale.
 * Why (1 Nov 2026, nm, rs): the outside heartbeat lived in the bot Worker that is deleted; this is what of it the Worker-free watchdog can still say.
 */
export function staleRound(last, now = new Date()) {
  const at = last && typeof last.at === 'string' && !Number.isNaN(Date.parse(last.at)) ? last.at : '';
  if (!at || now.getTime() - Date.parse(at) <= ROUND_STALE_MIN * 60000) return null;
  return {round: true, workflow: 'synthetic-probe-round', cron: ROUND_CRON, at};
}
const ROUND_CRON = '5,20,35,50 * * * *';
/**
 * The stale round an open issue already names in its key, for a run that could not read the round: "not judged" must mean "unchanged", never "recovered" (Gitar on #2895: one
 * failed read closed the issue with "every start was seen again" and the next good read opened a new one). Only a successful read that finds the round fresh closes it.
 */
export function roundFromIssue(body) {
  const found = /synthetic-probe-round@(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/.exec(String(body || ''));
  return found ? {round: true, workflow: 'synthetic-probe-round', cron: ROUND_CRON, at: `${found[1]}:00.000Z`} : null;
}

const clock = iso => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
/** The text the open issue is keyed by: each missing start as workflow[#night n/5]@time, so an unchanged set is not commented again. */
export const keyOf = missing => missing.map(item => `${item.workflow}${item.night ? `#night${item.night}` : ''}@${item.at.slice(0, 16)}`).join(',');
export function issueBody(missing, {checked, runUrl = ''} = {}) {
  const starts = missing.filter(item => !item.round), round = missing.find(item => item.round), seen = `(checked ${clock(checked)}${runUrl ? `, [watchdog run](${runUrl})` : ''})`;
  return [starts.length ? `**The Worker's cron did not start ${starts.length === 1 ? 'this run' : `these ${starts.length} runs`} on time** ${seen}:` : `**The site Worker's probe rounds stopped** ${seen}:`, '',
    '| Workflow | Due | Cron |', '|---|---|---|', ...missing.map(item => (item.round ? `| synthetic probe rounds | none stored since ${clock(item.at)} | \`${item.cron}\` |`
      : `| \`${item.workflow}\`${item.night ? ` night pass ${item.night}` : ''} | ${clock(item.at)} | \`${item.cron}\` |`)), '',
    ...(round ? ['The probe round (`shared/synthetic.js` in jobadabra-web, started by the site Worker) stored nothing for over 45 min while the site answers: see the Synthetic Monitoring tab in /admin/testing, the Worker logs and the `synthetic_probes` table.', ''] : []),
    ...(starts.length ? ["GitHub's own schedule still starts them, late or not at all (it skipped 4 of 6 stats runs on 5-6 Oct). What to check:",
    '- the Worker\'s secrets: `cd worker && npx wrangler secret list` (GITHUB_TOKEN, TELEGRAM_BOT_TOKEN, OWNER_CHAT_ID; `npm run deploy` checks them)',
    "- a refused start is commented here by the Worker itself, with GitHub's answer",
    '- the schedule: `app-core/src/scheduler.js` and `worker/wrangler.toml` [triggers]', ''] : []),
    `<sub>Kept by \`.github/workflows/schedule-watchdog.yml\` (\`app-core/src/watchdog.js\`): updated each hour while a start is missing, closed when every one is seen again.</sub>`,
    `<!-- watchdog-missing: ${keyOf(missing)} -->`].join('\n');
}
export const recoveredComment = (due, runsOf) => ['✅ **Every on-time start was seen again:**', '',
  ...due.map(item => { const run = startedAt(item, runsOf[item.workflow] || []); return `- \`${item.workflow}\` ${clock(item.at)}: ${run?.url ? `[started](${run.url})` : 'started'}`; })].join('\n');
