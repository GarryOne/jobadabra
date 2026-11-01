// The daily discovery batch's picker (owner, 17 Oct 2026; sketch https://claude.ai/artifact/A48novQqV7PFTFEiJoquBQ): data in, up to 5 ranked rows out. Pure: the CLI
// (discovery-pick.mjs) reads the site's input, the pool and the earlier runs and passes them in. Never random sites: every row comes from one of four signals, best first:
//   1 real fills that missed   a platform where real users' forms lost required questions (input.misses), a posting of that platform from any install
//   2 stuck applications       a posting an install started applying to and did not send (candidate source 'applying'), whatever its platform
//   3 new shapes in matches    a company-run career site (platform Custom) in today's matches, by host, none recorded yet; known ATS tenants share their platform's shape, so they are skipped here
//   4 platform gaps            a platform with 2+ points more of the matches than of the pool (input.demand), unless every recorded row of it ended on a bot wall
// A host already in the pool or recorded by an earlier batch is never picked again. The weekly spend cap (calendar week, UTC, counted from the batch's own spend lines) limits the rows.
// Guard: e2e/test/pool/discovery-pick.test.mjs.
import {platformOf} from './platform.mjs';
import {mayVisit} from './record-sites.mjs';

export const SOURCES = ['misses', 'applying', 'matches', 'gaps'];
export const MAX_ROWS = 5, ROW_USD = 0.06, WEEK_CAP_USD = 3, GAP_POINTS = 2;
const WALL = 'code/bot';

export const bare = host => String(host || '').toLowerCase().replace(/^www\./, '');
const hostOf = url => { try { return bare(new URL(url).hostname); } catch { return ''; } };

// The Monday (UTC) of a day's week: '2026-10-17' -> '2026-10-12'.
export function weekOf(day) {
  const date = new Date(`${String(day).slice(0, 10)}T00:00:00Z`), back = (date.getUTCDay() + 6) % 7;
  return new Date(date.getTime() - back * 86400000).toISOString().slice(0, 10);
}

// spends: [{at, usd}] the earlier batch runs' own spend lines. -> {spent, remaining, rows}: how many rows the week's cap still pays for.
export function budget(spends = [], now = new Date(), {weekCap = WEEK_CAP_USD, rowUsd = ROW_USD, max = MAX_ROWS} = {}) {
  const week = weekOf(now.toISOString()), spent = spends.filter(item => weekOf(String(item.at)) === week).reduce((sum, item) => sum + (Number(item.usd) || 0), 0);
  const remaining = Math.max(0, weekCap - spent);
  return {week, spent: Math.round(spent * 1000) / 1000, remaining: Math.round(remaining * 1000) / 1000, rows: Math.min(max, Math.floor(remaining / rowUsd + 1e-9))};
}

// A row's platform, from its first posting; the pool's table says the same (site/src/platform.js).
const platformOfUrl = url => platformOf(hostOf(url));

// What counts as one site: a company's own host, or, on a shared application platform, the company's board on it (jobs.lever.co/acme), so one recorded Lever company does not hide every other.
const PATH_TENANT = new Set(['Greenhouse', 'Ashby', 'Lever', 'SmartRecruiters', 'Workable', 'Join']);   // platforms whose company is the first path segment; the others put it in the host
export function siteKey(url) {
  try {
    const parsed = new URL(url), host = bare(parsed.hostname);
    return PATH_TENANT.has(platformOf(host)) ? `${host}/${parsed.pathname.split('/')[1] || ''}` : host;
  } catch { return ''; }
}
// Sites that count as recorded: the pool's rows and every posting an earlier batch recorded or tried.
const recordedSites = (pool, seen) => new Set([...pool.flatMap(row => (row.urls || []).map(siteKey)), ...seen.map(item => (item.url ? siteKey(item.url) : bare(item.host)))].filter(Boolean));

// Platforms whose every recorded row ended on a bot wall: a test of the site, not of us, so a gap there is not worth a row.
function walledPlatforms(pool, seen) {
  const results = {};
  const add = (platform, wall) => { (results[platform] ||= []).push(wall); };
  for (const row of pool) { const url = (row.urls || [])[0]; if (url && row.signature) add(platformOfUrl(url), String(row.signature).endsWith(`#${WALL}`)); }
  for (const item of seen) if (item.reached) add(platformOfUrl(item.url), item.reached === WALL);
  return new Set(Object.entries(results).filter(([, list]) => list.length && list.every(Boolean)).map(([platform]) => platform));
}

// The share of the pool's rows on each platform, in percent.
function poolShares(pool) {
  const counts = {};
  for (const row of pool) { const url = (row.urls || [])[0]; if (url) counts[platformOfUrl(url)] = (counts[platformOfUrl(url)] || 0) + 1; }
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0) || 1;
  return Object.fromEntries(Object.entries(counts).map(([platform, n]) => [platform, (100 * n) / total]));
}

const rowName = host => `Discovery: ${host}`;
const rowOf = (candidate, source, why) => ({shape: rowName(bare(candidate.host || hostOf(candidate.url))), urls: [candidate.url], source, why});

// input: {candidates: [{url, host, source, installs}] newest first, demand: [{platform, share}], misses: [{platform, cause, lost}]}
// pool: the pool's rows ({shape, urls, signature?}); seen: [{url|host, reached?}] what earlier batches recorded; spends: [{at, usd}]
// -> {rows: [{shape, urls, source, why}], skipped: [{source, why}], budget}
export function pickBatch({input = {}, pool = [], seen = [], spends = [], now = new Date(), max = MAX_ROWS, weekCap = WEEK_CAP_USD} = {}) {
  const money = budget(spends, now, {weekCap, max}), skipped = [];
  if (money.rows < 1) return {rows: [], skipped: [{source: 'budget', why: `the week's cap is reached ($${money.spent} of $${weekCap})`}], budget: money, capped: true};
  const recorded = recordedSites(pool, seen), walled = walledPlatforms(pool, seen), shares = poolShares(pool);
  const usable = (input.candidates || []).filter(item => item?.url && mayVisit(item.url) && !recorded.has(siteKey(item.url)));
  const onPlatform = platform => usable.filter(item => platformOfUrl(item.url) === platform).sort((a, b) => (b.installs || 0) - (a.installs || 0));

  const lists = {misses: [], applying: [], matches: [], gaps: []};
  for (const miss of [...(input.misses || [])].sort((a, b) => (b.lost || 0) - (a.lost || 0))) {
    const [found] = onPlatform(miss.platform);
    if (found) lists.misses.push(rowOf(found, 'misses', `real forms on ${miss.platform} lost ${miss.lost} required questions (${miss.cause})`));
    else skipped.push({source: 'misses', why: `${miss.platform}: no posting from any install`});
  }
  for (const item of usable.filter(candidate => candidate.source === 'applying')) lists.applying.push(rowOf(item, 'applying', 'an application started here and not sent'));
  const byHost = {};
  for (const item of usable.filter(candidate => candidate.source === 'matches' && platformOfUrl(candidate.url) === 'Custom')) (byHost[bare(item.host || hostOf(item.url))] ||= []).push(item);
  for (const list of Object.values(byHost).sort((a, b) => b.length - a.length)) lists.matches.push(rowOf(list[0], 'matches', `a company site in today's matches (${list.length} posting${list.length === 1 ? '' : 's'}), none recorded`));
  const gaps = (input.demand || []).map(item => ({...item, gap: (item.share || 0) - (shares[item.platform] || 0)})).filter(item => item.gap >= GAP_POINTS).sort((a, b) => b.gap - a.gap);
  for (const gap of gaps) {
    if (walled.has(gap.platform)) { skipped.push({source: 'gaps', why: `${gap.platform}: every recorded row met a bot wall`}); continue; }
    const [found] = onPlatform(gap.platform);
    if (found) lists.gaps.push(rowOf(found, 'gaps', `${gap.platform} is ${gap.share}% of matches and ${Math.round(shares[gap.platform] || 0)}% of the pool`));
    else skipped.push({source: 'gaps', why: `${gap.platform}: no posting from any install`});
  }

  // Round robin over the four signals, best first, one host once.
  const rows = [], taken = new Set(), next = Object.fromEntries(SOURCES.map(source => [source, 0]));
  while (rows.length < money.rows && SOURCES.some(source => next[source] < lists[source].length)) {
    for (const source of SOURCES) {
      while (next[source] < lists[source].length) {
        const row = lists[source][next[source]++], host = siteKey(row.urls[0]);
        if (taken.has(host)) continue;
        taken.add(host); rows.push(row);
        break;
      }
      if (rows.length >= money.rows) break;
    }
  }
  return {rows, skipped, budget: money, capped: false};
}
