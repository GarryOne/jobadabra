// Usage-weighted pool, step 3 (private spec jobadabra-lab:docs/specs/2026-10-10-usage-weighted-pool.md): the hosts real users apply on that the smoke pool lacks ("Next sites to add" on
// /admin/form-filling/lab, k >= 3 installs each) become discovery candidates: postings on those hosts, from the loaded profile's jobs, are tried first. Everything stays on this Mac
// (discover writes the repo's pool list, desktop/e2e/smoke-sites.json); a suggested host with no posting among the jobs is listed in the report, not skipped silently.
// Guard: test/wanted-hosts.test.mjs.
import {execFileSync} from 'node:child_process';
import {SITE, skipReason} from './applying-report.mjs';
import {candidates, mayVisit} from './record-sites.mjs';

const bare = host => String(host || '').toLowerCase().replace(/^www\./, '');
const hostOf = url => { try { return bare(new URL(url).hostname); } catch { return ''; } };
const PLAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

// -> {hosts: [{host, installs, countries}], why?}: the suggestions, asked with the owner key (never printed). Nothing on CI, a control run, without a key, or when the site
// fails: discovery then runs as before.
export async function fetchWanted({env = process.env, key, fetcher = fetch} = {}) {
  const why = skipReason(env);
  if (why) return {hosts: [], why: `not asked (${why})`};
  let token = key;
  try { token ??= execFileSync('security', ['find-generic-password', '-s', 'job-pilotto.site.api_key', '-w'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim(); } catch { token = ''; }
  if (!token) return {hosts: [], why: 'not asked (no site key in the Keychain)'};
  try {
    const answer = await fetcher(`${SITE}?json`, {headers: {Authorization: `Bearer ${token}`, 'X-Caller': 'smoke-discover'}, signal: AbortSignal.timeout(20000)});
    if (!answer.ok) return {hosts: [], why: `failed (${answer.status})`};
    const sites = (await answer.json())?.next?.sites || [];
    return {hosts: sites.filter(item => PLAIN.test(String(item.host || '')) && mayVisit(`https://${item.host}/`)).slice(0, 20)
      .map(item => ({host: item.host, installs: item.installs, countries: item.countries}))};
  } catch (error) { return {hosts: [], why: `failed (${String(error?.message || error).slice(0, 60)})`}; }
}

// postings: the profile's jobs; wanted: [{host}]; known: urls already in the pool. -> {chosen: wanted hosts' postings first (a few each), then the usual candidates;
// missing: wanted hosts with no posting among the jobs at all}.
export function wantedFirst(postings, wanted, known) {
  const hosts = new Set(wanted.map(item => bare(item.host)));
  const isWanted = posting => hosts.has(hostOf(posting.url));
  const first = candidates(postings.filter(isWanted), known, {perHost: 3});
  const rest = candidates(postings.filter(posting => !isWanted(posting)), known);
  const present = new Set(postings.map(posting => hostOf(posting.url)));
  return {chosen: [...first, ...rest], missing: [...hosts].filter(host => !present.has(host))};
}
