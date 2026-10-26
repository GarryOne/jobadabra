// The job sources that need the user's own API key (Adzuna and Jooble, Web search (Brave), Google Jobs (SerpApi)) are not offered anywhere while `keySources.offered` is false (owner, 24 Oct 2026),
// and are parked since 26 Oct 2026 (src/features.py PARKED: off even with a saved key; their Connections cards carry data-parked). Python's copies: src/coverage.py KEY_SOURCES_OFFERED,
// features.PARKED; desktop/test/result-panels-basic.test.js and tests/test_parked_features.py tie them. An object, so a test can turn them on.
export const keySources = {offered: false};
export const KEY_SOURCE_IDS = ['serpapi', 'brave', 'aggregators'];
export const offered = id => keySources.offered || !KEY_SOURCE_IDS.includes(id);
// Strategy's Google Jobs searches and places: kept as saved, not drawn while Google Jobs is not offered (pages/strategy-targets.js, strategy.js).
const GOOGLE_JOBS_LISTS = new Set(['gqueries', 'gplaces']);
export const shownLists = lists => lists.filter(([name]) => offered('serpapi') || !GOOGLE_JOBS_LISTS.has(name));
