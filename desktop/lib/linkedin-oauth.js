// "Connect with LinkedIn": LinkedIn's own consent page (Sign In with LinkedIn using OpenID Connect). Same shape as lib/notion-oauth.js: the app opens
// the website's /api/linkedin/start with a random session id; the website (which holds the secret) trades LinkedIn's code for the member's OpenID
// profile (name, email, LinkedIn id) and keeps only that for 10 minutes; the app collects it once. LinkedIn gives positions and skills only to
// registered companies, so this is identity: the Experience tab's data comes from the CVs and the data-export ZIP. Guarded by test/linkedin-oauth.test.js.
import crypto from 'node:crypto';

export const SITE = process.env.JOBADABRA_SITE || 'https://www.jobpilotto.top';

let current = null;  // one sign-in at a time; a new click cancels the previous wait
export function cancel() { if (current) current.cancelled = true; }

// -> {ok: true, sub, name, given_name, family_name, email, locale} | {ok: false, error}
export async function connect(openExternal, {fetcher = globalThis.fetch, sleep = ms => new Promise(r => setTimeout(r, ms)),
  every = 2000, timeout = 5 * 60 * 1000, site = SITE} = {}) {
  cancel();
  const run = current = {cancelled: false};
  const session = crypto.randomBytes(32).toString('base64url');
  await openExternal(`${site}/api/linkedin/start?session=${session}`);
  for (let waited = 0; waited < timeout && !run.cancelled; waited += every) {
    await sleep(every);
    let data;
    try {
      const response = await fetcher(`${site}/api/linkedin/token`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({session})});
      if (response.status === 503) return {ok: false, error: 'Connect with LinkedIn isn\'t available yet on this server.'};
      data = await response.json();
    } catch { continue; }  // offline for a moment: keep waiting
    if (data.ok) return data;
  }
  return {ok: false, error: run.cancelled ? 'Cancelled.' : 'LinkedIn didn\'t answer in 5 minutes. Try again.'};
}

// What the app keeps of a connection: who it is, never a token (the website did not keep one either).
export const kept = (profile, now = new Date()) => ({sub: String(profile.sub), name: profile.name || '', givenName: profile.given_name || '',
  familyName: profile.family_name || '', email: profile.email || '', connectedAt: now.toISOString()});
