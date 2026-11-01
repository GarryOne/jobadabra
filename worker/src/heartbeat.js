// The outside heartbeat of the site's synthetic probes (spec 2026-11-01-synthetic-monitoring-design.md in jobadabra-web, PR B; owner-approved report-only monitoring, coordinator mac-07, 1 Nov 2026).
// The probes run INSIDE the site Worker, so when that Worker is dead nothing probes and nothing tells. This runs in the bot Worker, a separate deployment with its own cron and its own
// Telegram bot, and asks two public questions: does the marker page answer, and is the newest probe round recent (GET /api/synthetic/last -> {at}). No store, no secret beyond the Telegram
// token it already holds, no user data. Report only: it only sends a message.
export const STALE_MIN = 45, TIMEOUT_MS = 10000;
export const SITE = 'https://www.jobadabra.top/', LAST = 'https://www.jobpilotto.workers.dev/api/synthetic/last';

/** Why (1 Nov 2026, nm): the bot Worker keeps no state, so "once per hour" is a tick rule: the 10-minute trigger asks every tick, but a problem is TOLD only on the :00 and :30 ticks (at most twice an hour while it lasts, never later than 30 minutes after it began). */
export const tellTick = date => date.getUTCMinutes() % 30 === 0;

async function get(fetcher, url) {
  try { return await fetcher(url, {signal: AbortSignal.timeout(TIMEOUT_MS)}); } catch (error) { return {ok: false, status: 0, why: error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'timeout' : 'unreachable'}; }
}

/** -> '' when the site and its probes look alive, else one short sentence naming what is wrong. Never throws. */
export async function heartbeatProblem(now = new Date(), fetcher = fetch) {
  const page = await get(fetcher, SITE);
  if (!page.ok) return `The website does not answer (${page.why || `HTTP ${page.status}`}).`;
  if (!/<title>[^<]*Jobadabra/i.test(await page.text().catch(() => ''))) return 'The website answers, but not with the Jobadabra page.';
  const last = await get(fetcher, LAST);
  if (!last.ok) return `The probe feed does not answer (${last.why || `HTTP ${last.status}`}).`;
  const at = (await last.json().catch(() => null))?.at;
  if (!at || !Number.isFinite(Date.parse(at))) return 'The site has no probe round on record.';
  const minutes = Math.round((now.getTime() - Date.parse(at)) / 60000);
  return minutes > STALE_MIN ? `The newest probe round is ${minutes} minutes old (it runs every 15).` : '';
}

/** The `*​/10` tick's heartbeat: asks, and tells (once) only on a tell tick. Returns the problem text or ''. Never throws, so it cannot fail the cron the verdict sweep shares. */
export async function heartbeat(now, {fetcher = fetch, notify = async () => {}} = {}) {
  try {
    const problem = await heartbeatProblem(now, fetcher);
    if (problem && tellTick(now)) await notify(`🚨 Jobadabra monitor, seen from outside the site: ${problem} https://www.jobadabra.top/admin/testing/overview`);
    return problem;
  } catch (error) { console.log(`heartbeat: ${error.message}`); return ''; }
}
