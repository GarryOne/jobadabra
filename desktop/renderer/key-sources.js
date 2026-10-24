// The job sources that need the user's own API key (Adzuna and Jooble, Web search (Brave), Google Jobs (SerpApi)) are not offered anywhere while this is false (owner, 24 Oct 2026). Python's copy: src/coverage.py KEY_SOURCES_OFFERED; desktop/test/key-sources.test.js ties them.
export const KEY_SOURCES_OFFERED = false;
export const KEY_SOURCE_IDS = ['serpapi', 'brave', 'aggregators'];
export const offered = id => KEY_SOURCES_OFFERED || !KEY_SOURCE_IDS.includes(id);
