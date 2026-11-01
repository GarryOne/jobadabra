// The newest issue events a correction is made of, read page by page until enough are found, so a judge job spends about 18 calls, not the whole history.
// Job: report health
// Why (31 Oct 2026, a8; budget burst 17:52-18:00 UTC): the whole event history was paginated, then cut to 600: all 170 pages (170 REST calls) per UI-verdict judge job, 12 jobs
// a run = 2,040 calls in 5 minutes of the 5,000-an-hour budget every workflow shares; every later job failed on the 403. The endpoint is newest first and 27-42% of a page is a correction
// kind (measured), so the first 600 matches are the first ~18 pages: the same events, read from the pages they are on. Guard: test/pool/reversals.test.mjs.

export const WANTED = 600;
export const PAGE_CAP = 60;   // a history with almost no corrections must not read every page either: the cap is said in the log when it ends the read
const FILTER = '{raw: length, hits: [.[] | select(.event == "reopened" or .event == "unlabeled" or .event == "closed")]}';

/**
 * `gh`: list of arguments -> stdout (execFileSync of the gh CLI, injectable); `repo`: owner/name.
 * -> the newest `wanted` events that are a reopening, an unlabeling or a closing (fewer when the history holds fewer), newest first.
 * A page the API cannot give throws: the caller runs the judges without corrections, as before.
 */
export function fetchCorrectionEvents(gh, repo, {wanted = WANTED, log = console.log} = {}) {
  const hits = [];
  for (let page = 1; page <= PAGE_CAP; page++) {
    const answer = gh(['api', `repos/${repo}/issues/events?per_page=100&page=${page}`, '--jq', FILTER]).split('\n').find(line => line.trim());
    const {raw, hits: found} = JSON.parse(answer);
    hits.push(...found);
    if (hits.length >= wanted) return hits.slice(0, wanted);
    if (raw < 100) return hits;   // the last page of the history
  }
  log(`corrections: stopped at page ${PAGE_CAP} with ${hits.length} of ${wanted} events (older history is not read)`);
  return hits;
}
