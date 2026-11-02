// "Connect with Notion": Notion's own consent page instead of a token to create and paste. The app opens the
// Jobadabra website's /api/notion/start with a random session id; after the user approves in Notion (picking
// a page, or letting Notion copy the Jobadabra template), the website trades Notion's code for the token
// (it holds the connection's secret) and keeps it 10 minutes; the app collects it once with the session id.
import crypto from 'node:crypto';

export const SITE = process.env.JOBADABRA_SITE || 'https://www.jobadabra.top';

// The page Notion copied the Jobadabra template into ("Use a template provided by the developer" on its
// consent page; the connection's settings must offer it), as a plain 32-character id; null when the user picked
// their own page instead ("Select pages") or Notion sent something that isn't a page id.
export function templateRoot(signedIn) {
  const id = String(signedIn?.duplicated_template_id || '').replace(/-/g, '').toLowerCase();
  return /^[0-9a-f]{32}$/.test(id) ? id : null;
}

let current = null;  // one sign-in at a time; a new click cancels the previous wait
export function cancel() { if (current) current.cancelled = true; }

// -> {ok: true, access_token, workspace_name, duplicated_template_id} | {ok: false, error}
export async function connect(openExternal, {fetcher = globalThis.fetch, sleep = ms => new Promise(r => setTimeout(r, ms)),
  every = 2000, timeout = 5 * 60 * 1000, site = SITE} = {}) {
  cancel();
  const run = current = {cancelled: false};
  const session = crypto.randomBytes(32).toString('base64url');
  await openExternal(`${site}/api/notion/start?session=${session}`);
  for (let waited = 0; waited < timeout && !run.cancelled; waited += every) {
    await sleep(every);
    let data;
    try {
      const response = await fetcher(`${site}/api/notion/token`, {method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({session})});
      data = await response.json();
      if (response.status === 503) return {ok: false, error: 'Connect with Notion isn\'t available yet. Use "Having trouble? Use a token instead" below.'};
    } catch { continue; }  // offline for a moment: keep waiting
    if (data.ok) return data;
  }
  return {ok: false, error: run.cancelled ? 'Cancelled.' : 'Notion didn\'t answer in 5 minutes. Try again.'};
}
