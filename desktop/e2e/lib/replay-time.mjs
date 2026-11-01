// Fill time per recorded case, and a PR's against main's (owner, 12 Oct 2026: a flow PR that makes filling slower fails, as one that makes it wrong does).
// A case's fill time is its fill record's own clock (/extension/run: started, ended; flow.js), not the case's whole window, which waits on its checks.
// Rule: the median, over the cases both runs filled, of (PR - main) seconds; +1 s or more is slower. Fewer than MIN_CASES in both: nothing to judge, said.
// Used by e2e/test/record/recorded-pages.test.mjs (each result's `fill`) and e2e/replay-time.mjs (the report job). Guard: e2e/test/replay/replay-time.test.mjs.
export const SLOWER_SECONDS = 1;
export const MIN_CASES = 5;

// The last fill record of the case's own hosts. Read by pattern: the stand-in keeps the first 20000 characters of a body, and started/ended come first.
export function fillSeconds(requests, hosts) {
  const mine = requests.filter(request => request.route === '/extension/run' && hosts.some(host => request.body.includes(`://${host}`)));
  const last = mine.at(-1);
  if (!last) return null;
  const at = key => Date.parse((new RegExp(`"${key}":"([^"]+)"`).exec(last.body) || [])[1] || '');
  const seconds = (at('ended') - at('started')) / 1000;
  return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 100) / 100 : null;
}

const median = list => { const sorted = [...list].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2; };
const round = value => Math.round(value * 100) / 100;

// pr, main: [{name, fill}] (replay results). -> {slower, cases, median, worst: [{name, pr, main, delta}] (the 3 most slowed), why}
export function compareFill(pr, main) {
  const before = new Map(main.filter(row => Number.isFinite(row?.fill)).map(row => [row.name, row.fill]));
  const pairs = pr.filter(row => Number.isFinite(row?.fill) && before.has(row.name)).map(row => ({name: row.name, pr: row.fill, main: before.get(row.name), delta: round(row.fill - before.get(row.name))}));
  if (pairs.length < MIN_CASES) return {slower: false, cases: pairs.length, median: null, worst: [], why: `only ${pairs.length} case(s) with a fill time in both runs (${MIN_CASES} needed)`};
  const middle = round(median(pairs.map(pair => pair.delta)));
  return {slower: middle >= SLOWER_SECONDS, cases: pairs.length, median: middle, worst: [...pairs].sort((a, b) => b.delta - a.delta).slice(0, 3), why: ''};
}
