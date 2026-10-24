// The job sources that need the user's own API key (Adzuna and Jooble, Web search (Brave), Google Jobs (SerpApi)) are not offered anywhere while `keySources.offered` is false (owner, 24 Oct 2026). Python's copy: src/coverage.py KEY_SOURCES_OFFERED; desktop/test/result-panels-basic.test.js ties them. An object, so a test can turn them on.
export const keySources = {offered: false};
export const KEY_SOURCE_IDS = ['serpapi', 'brave', 'aggregators'];
export const offered = id => keySources.offered || !KEY_SOURCE_IDS.includes(id);
