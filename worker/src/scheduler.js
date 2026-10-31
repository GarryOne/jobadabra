// On-time starts for the pipeline's schedules (5 Oct 2026). GitHub's own scheduler is best-effort: the nightly build started six hours late two days running and the
// 09:47 e2e run never appeared. Cloudflare's cron triggers fire on time, so they start the workflows through the API; GitHub's crons stay in the workflow files as a
// backup (a second start finds nothing new to build, and the e2e plan caps runs per commit).
//
//   desktop.yml  -nightly: true    the nightly build, at 04:00 Zurich (the build runs only when the app changed since the last release)
//   e2e.yml      -scheduled: true  the three-a-day journey runs, planned exactly as the schedule event plans them
//   self-heal-stats.yml            the numbers on the owner's /self-heal page, every 3 hours (GitHub's schedule left them 5-6 hours old on 5 Oct 2026)
//   pr-verdict.yml                repairs pending PR verdicts every 10 minutes; shares the stats trigger to stay within the account limit
//   (site-replays.yml is no longer started here since 17 Oct 2026: replays are for debugging, by hand)
// One trigger for the night's four UTC hours (00-03): Cloudflare's free plan allows 5 cron triggers per ACCOUNT (other Workers hold 2), a sixth could not be registered
// (5 Oct 2026), and a 4th trigger for this Worker was refused (14 Oct 2026): the hour that is 02:00 in Zurich starts the replay gate, the one that is 04:00 the nightly.
// Why (31 Oct 2026, owner, "Worker cron"): GitHub never started #2648's sweep on schedule; reuse the stats trigger, keeping its UTC slots below.
export const CRONS = ['0 0,1,2,3 * * *', '47 21,23,1 * * *', '*/10 * * * *'];

// The hour in Zurich (0-23) at this moment: 04:00 all year, whether UTC+1 or UTC+2.
export const zurichHour = date => Number(new Intl.DateTimeFormat('en-GB', {timeZone: 'Europe/Zurich', hour: '2-digit', hourCycle: 'h23'}).format(date));

export function jobsFor(cron, now = new Date()) {
  if (cron === '0 0,1,2,3 * * *' || cron === '0 2,3 * * *' || cron === '0 2 * * *' || cron === '0 3 * * *') {   // the night's UTC hours: 02:00 Zurich = the replay gate, 04:00 = the nightly
    const hour = zurichHour(now);
    return hour === 4 ? [{workflow: 'desktop.yml', inputs: {nightly: 'true'}}] : [];
  }
  if (cron === '47 21,23,1 * * *') return [{workflow: 'e2e.yml', inputs: {scheduled: 'true'}}];   // the site replays run once a day (the 02:00 Zurich hour above), no longer beside each e2e run (owner, 17 Oct 2026)
  if (cron === '*/10 * * * *') {
    const jobs = [{workflow: 'pr-verdict.yml'}];
    if (now.getUTCMinutes() === 40 && now.getUTCHours() % 3 === 0) jobs.push({workflow: 'self-heal-stats.yml', inputs: {scheduled: 'true'}});
    return jobs;
  }
  if (cron === '40 */3 * * *') return [{workflow: 'self-heal-stats.yml', inputs: {scheduled: 'true'}}];
  return [];
}

// The title each on-time run shows on GitHub (its run-name), so a person reading Actions sees who started it (6 Oct 2026: the owner looks at GitHub only, and these
// were plain workflow_dispatch runs by their account). desktop.yml's is read by the e2e gate too: keep it. test/watchdog.test.js holds the workflows to these.
// Until 21 Oct 2026 (remove then): site-replays.yml was replay-offline.yml (renamed 14 Oct 2026). A dispatch that finds no such workflow (404) is tried under the other
// name, so neither side of the gap between the merge and this Worker's deploy misses a tick. Test: worker/test/scheduler.test.js.
export const LEGACY_NAMES = {'site-replays.yml': 'replay-offline.yml'};
const isNotFound = error => /\b404\b/.test(String(error?.message));

export const TITLES = {'desktop.yml': 'Nightly beta', 'e2e.yml': 'E2E check · on time (Worker cron)', 'self-heal-stats.yml': 'Self-heal stats · on time (Worker cron)', 'site-replays.yml': 'Replay check · on time (Worker cron)', 'pr-verdict.yml': 'PR verdict sweep · on time (Worker cron)'};

// dispatch(env, inputs, workflow) starts a workflow on main (index.js); notify(text) tells the owner when it could not, on Telegram; report(text) on GitHub, in the
// watchdog's issue (watchdog.js), where the owner looks. Neither can reach anyone when the token is the problem: the GitHub-side watchdog covers that.
export async function runScheduled(event, env, {dispatch, notify = async () => {}, report = async () => {}, now = new Date(event?.scheduledTime || Date.now())}) {
  const started = [], failed = [];
  for (const job of jobsFor(event.cron, now)) {
    try {
      try { await dispatch(env, job.inputs, job.workflow); }
      catch (error) {
        const legacy = LEGACY_NAMES[job.workflow];
        if (!legacy || !isNotFound(error)) throw error;
        console.log(`scheduled ${job.workflow} not found: starting ${legacy}`);
        await dispatch(env, job.inputs, legacy);
      }
      started.push(job.workflow);
      console.log(`scheduled ${job.workflow} cron=${event.cron}`);
    } catch (error) {
      console.log(`scheduled start failed ${job.workflow} cron=${event.cron}: ${error.message}`);
      await notify(`⚠️ The scheduled start of ${job.workflow} failed (${event.cron}): ${error.message.slice(0, 200)}. GitHub's own schedule is the backup.`);
      await report(`The Worker's cron (${event.cron}) could not start ${job.workflow}: ${error.message.slice(0, 300)}`).catch(() => {});
      failed.push(`${job.workflow}: ${error.message.slice(0, 120)}`);
    }
  }
  // Loud, after every job had its try: the cron then shows as failed in Cloudflare. 5-6 Oct 2026: the Worker had been created afresh without its secrets, every start
  // was refused (401) for a day, and the warning above needs the Telegram token it also lacked, so each cron reported "success" while nothing started.
  if (failed.length) throw new Error(`scheduled start failed: ${failed.join('; ')}`);
  return started;
}
