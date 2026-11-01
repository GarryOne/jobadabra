// The start state of the strategy tests and of the 3 journey steps in suites/strategy.mjs (moved out of it when the rest of that suite became integration/store/strategy-integration.test.mjs and strategy-notion-integration.test.mjs,
// owner, 1 Nov 2026): the page's sections and the same values in the config files' shape. Guarded by test/app/strategy-start.test.mjs and test/app/strategy-headings.test.mjs.
import {withRoles} from '../lib/search-roles.mjs';

// The start state of every section these steps change (snapshot preseeding, lib/notion.mjs restoreSections). Roles: the persona's own, none of which a fixture
// posting of this suite matches (so before any change the check keeps neither); places, level and companies empty; regions to skip: the real list, no test word.
export const START = {   // the page's sections; on this Mac's store the same values go into the config files (sqliteStart)
  'Target roles': ['data analyst', 'business intelligence', '"bi"', 'analytics engineer', 'reporting analyst'],
  'Your level': [],
  'Best places': [],
  // The region step keeps only what is in its region: an applicant's strategy may also search the whole country or abroad (the e2e applicant's: all Switzerland).
  'Anywhere in the country': [],
  'Places abroad': [],
  'Companies to skip': [],
  // The level step keeps a "Junior" title: an applicant's strategy may skip junior titles (the e2e applicant's does: desktop/demo/draft.json), so none is skipped here.
  'Job titles to skip': [],
  'Remote jobs: regions to skip': ['/\\busa?\\b/', 'united states', 'canada', 'apac', 'latam'],
};

// A section entry as the engine turns it into a regex fragment (src/notion/search_settings.py fragment_of; START has no accent or other special character):
// plain = anywhere, "quoted" = whole word, /…/ = as written.
const fragment = entry => (entry.length > 2 && entry.startsWith('/') && entry.endsWith('/') ? entry.slice(1, -1)
  : entry.length > 2 && entry.startsWith('"') && entry.endsWith('"') ? `\\b${entry.slice(1, -1)}\\b` : entry);
// START in the config files' shape (the same SECTIONS map as the engine's): what the page would have written into them.
export function sqliteStart(search, preferences) {
  const m = list => list.map(fragment);
  return {search: {...withRoles(search, m(START['Target roles'])), level: START['Your level'], title_exclude_keywords: m(START['Job titles to skip']),
    remote_excluded_regions: m(START['Remote jobs: regions to skip']),
    locations: {...search.locations, top_tier: m(START['Best places']), country_wide: m(START['Anywhere in the country']), abroad: m(START['Places abroad'])}},
  preferences: {...preferences, excluded_companies: START['Companies to skip']}};
}
