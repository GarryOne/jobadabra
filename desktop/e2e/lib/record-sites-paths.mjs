// The pool runs on the plain-node path (lib/record-sites.mjs smokeEngine), real users on Electron: two guards that a path difference is never read as the product's
// (owner via the coordinator, 11 Oct 2026, after a kit seeded on one path only split the Teamtailor verdict):
//  - a row that reaches less than its last result on plain node is re-run once on Electron at once (same posting): a regression only when Electron shows it
//    too, else a "path difference" said at the top of the report;
//  - a paired sample each pass: a few rows run on both paths, the least recently paired first; the report's first line says whether they agree within +-1.
// "Less than its last result" is lib/record-sites.mjs compare() itself, so the re-run covers every kind of regression the pool counts. Used by record-sites.mjs.
// Guard: e2e/test/record-sites-paths.test.mjs.
import {SITE_REFUSED, compare, rank} from './record-sites.mjs';
import {recordVar} from '../../../tools/record-env.mjs';

// An Electron leg is a second live visit of the same site: asked of the site ledger before it starts (jobs.ch, 12 Oct 2026: the plain leg took the day's last
// visit, the Electron leg ran ~190 s of app start, was refused inside the suite and read as "Electron reached nothing", a false path difference).
// guard: lib/site-ledger.mjs guardLiveVisit. -> '' (the leg goes) or the refusal (the leg is skipped and no pair is recorded); any other error stands.
export function electronLegRefused(url, guard) {
  try { guard(url, {record: false}); return ''; } catch (error) { if (error?.name === 'SiteLimitError') return error.message; throw error; }
}

// The live visits a site has left today (guard: site-ledger.mjs guardLiveVisit, asked without recording): 0 when refused; Infinity for no address or no real site.
export function visitsLeft(url, guard) {
  if (!url) return Infinity;
  try { const seen = guard(url, {record: false}); return seen ? Math.max(0, seen.limit - seen.count) : Infinity; } catch (error) { if (error?.name === 'SiteLimitError') return 0; throw error; }
}

// The row reached less than its last result (compare()'s regression, for this one row). -> the reason ('' when not).
export const lessThanLast = (previous, now) => (previous ? compare({row: previous}, {row: now})[0]?.why || '' : '');

// Two runs of one posting agree when they reached the same step and filled within one field of each other.
export function agree(node, electron) {
  if (!node || !electron) return false;
  if (rank(node.reached) !== rank(electron.reached)) return false;
  return Math.abs((node.filled ?? 0) - (electron.filled ?? 0)) <= 1;
}

const brief = result => `${result?.reached || 'none'}${result?.filled != null ? ` ${result.filled} filled` : ''}`;

// The day each shape was last paired, from earlier reports (results[shape].paired.day).
export function lastPaired(reports = []) {
  const seen = {};
  for (const report of reports) for (const [shape, result] of Object.entries(report?.results || {})) {
    const day = result?.paired?.day;
    if (day && (!seen[shape] || day > seen[shape])) seen[shape] = day;
  }
  return seen;
}

// This pass's paired sample: `size` of the chosen shapes, never paired first, then the oldest pairing; the pool's order on a tie.
// roomy(item): its site has the two visits a pair needs today (visitsLeft below); a row without them would only be skipped at its Electron leg.
export function pairedSample(chosen, paired = {}, size = 2, roomy = () => true) {
  return chosen.filter(item => roomy(item)).map((item, index) => ({item, index, day: paired[item.shape] || ''}))
    .sort((a, b) => (a.day === b.day ? a.index - b.index : a.day < b.day ? -1 : 1)).slice(0, Math.max(0, size)).map(entry => entry.item.shape);
}

// What one row's two runs mean for the report: {paired: {day, electron, agree}} on the node result, and whether a regression stands.
export function pairResult(node, electron, {day, previous = null} = {}) {
  const less = lessThanLast(previous, node);
  const together = agree(node, electron);
  const pathDifference = less && electron && !lessThanLast(previous, electron) ? `plain node ${brief(node)}, Electron ${brief(electron)} (${less})` : '';
  return {paired: {day, electron: electron ? {reached: electron.reached, filled: electron.filled ?? null, left: electron.left ?? null} : null, agree: together}, ...(pathDifference ? {pathDifference} : {})};
}

// The report's first line.
export function pairedLine(results = {}) {
  const pairs = Object.entries(results).filter(([, result]) => result?.paired && result.paired.electron !== undefined);
  if (!pairs.length) return 'paired sample: none this pass';
  const off = pairs.filter(([, result]) => !result.paired.agree);
  return off.length ? `paired sample: ${pairs.length} rows; DIFFER: ${off.map(([shape, result]) => `${shape} (plain node ${brief(result)}, Electron ${brief(result.paired.electron)})`).join('; ')}`
    : `paired sample: ${pairs.length} rows, all within +-1`;
}

export const pathDifferenceLine = (results = {}) => {
  const rows = Object.entries(results).filter(([, result]) => result?.pathDifference);
  return rows.length ? `PATH DIFFERENCE (not a regression: Electron did not show it): ${rows.map(([shape, result]) => `${shape}: ${result.pathDifference}`).join('; ')}` : '';
};

// A site that refuses the plain path but not Electron (cc, 11 Oct 2026: Louis Vuitton, a CDN's block page on plain node, the form with 6 filled on Electron) is no hold: real users take
// the Electron path. -> null (the result stands: not refused, or Electron is refused too: the hold stands), else the fields to put on the row:
// Electron's own result (judged as usual) with `pathDifference` saying so; with no Electron verdict the row is just not called refused (`note` cleared).
const ADOPTED = ['reached', 'filled', 'left', 'rung', 'signal', 'fieldList', 'marks', 'kinds', 'path', 'errors', 'verdict', 'note'];
export function settleRefusal(node, electron) {
  if (node?.note !== SITE_REFUSED) return null;
  if (!electron) return {note: undefined};
  if (electron.note === SITE_REFUSED) return null;
  if (rank(electron.reached) <= rank(node.reached)) return {note: undefined};   // Electron saw no refusal and got no further: a real stop at the posting, no hold
  const fields = Object.fromEntries(ADOPTED.map(key => [key, electron[key]]));
  return {...fields, pathDifference: `plain node ${brief(node)}, Electron ${brief(electron)} (the site refused the plain path)`};
}

// A by-hand single-row recording (--only) visits its site ONCE (owner, 15 Oct 2026: an approved single visit became two when the paired Electron sample ran, and the host hit its
// daily limit). A second visit (the paired sample, or the Electron re-run of a fallen or refused row) is for a pass over many rows, or asked for: RECORD_PAIRED=<n> or RECORD_ELECTRON_LEG=1.
export const pairedSize = (env = process.env, only = '') => (recordVar('PAIRED', env) !== undefined && recordVar('PAIRED', env) !== '' ? Math.max(0, Number(recordVar('PAIRED', env)) || 0) : only ? 0 : 2);
export const secondVisitsAllowed = (env = process.env, only = '') => !only || recordVar('ELECTRON_LEG', env) === '1' || pairedSize(env, only) > 0;
// The line said before the run starts: how many hosts and visits it will make (a re-run of a fallen row is one more, only where second visits are allowed).
export function visitPlan(chosen, pairs = new Set(), allowed = true) {
  const host = item => { try { return new URL(item.urls?.[0] || '').hostname; } catch { return ''; } };
  const hosts = new Set(chosen.map(host).filter(Boolean)), visits = chosen.length + chosen.filter(item => pairs.has(item.shape)).length;
  return {hosts: hosts.size, visits, line: `record-sites: this run will visit ${hosts.size} host(s) ${visits} time(s)${allowed ? ' (a row that falls below its last result is visited once more on Electron)' : ' (no second visit: a single-row run)'}`};
}
