// Focus's Suggestions, the Jobs bar and a home's rows: which entries each place shows and the words around them, free of the DOM so the tests
// can check them. Entries come from the engine's pool (src/suggestions.py); pages/focus-suggestions.js draws them and runs their buttons.
// Spec: docs/superpowers/specs/2026-10-28-insights-with-actions-design.md (PR 1a). Guarded by test/suggestions.test.js.

export const SHOWN = 3;                              // Focus shows the 3 first, then "Show all N" (spec)
export const JOBS_TOPICS = ['search', 'applying'];   // the Jobs bar's (spec: "only the search- and applying-related ones")
// Every actions[].do the engine writes (src/suggestions.py, src/suggestions_search.py), each run by pages/focus-suggestions.js RUN.
export const DOES = ['open_insight', 'open_rejection', 'read_week', 'analyze', 'tune', 'find_jobs', 'tailor', 'prep', 'change_search', 'read_site', 'see_all'];   // the Jobs drawers' rows write theirs in the window: question-entries.js QUESTION_DOES
// Each producer's row: its icon, its edge colour and its badge.
export const LOOK = {insight: {icon: 'bulb', tone: 'warn', badge: 'Insight'}, rejection: {icon: 'alert', tone: 'warn', badge: 'Rejection'},
  week: {icon: 'chart', tone: 'good', badge: 'Your week'}, analyze: {icon: 'chart', tone: 'info', badge: 'Analyze'}, tune: {icon: 'sliders', tone: 'info', badge: 'Tune'},
  // Strategy's search rows (PR 1b): the icons of their Strategy rows
  places: {icon: 'pin', tone: 'info', badge: 'Places'}, ideas: {icon: 'briefcase', tone: 'info', badge: 'Roles'}, coverage: {icon: 'search', tone: 'info', badge: 'Role words'},
  filters: {icon: 'sliders', tone: 'info', badge: 'Filters'}, visits: {icon: 'external', tone: 'warn', badge: 'Sites'},
  // The Jobs drawers' rows (PR 1c): the colours of the cards they replace (cover letter and Fill your details amber, What we learned blue)
  letter: {icon: 'file', tone: 'bad', badge: 'High priority'}, details: {icon: 'user', tone: 'warn', badge: 'Details'}, learned: {icon: 'bulb', tone: 'info', badge: 'Learned'},
  'questions-error': {icon: 'alert', tone: 'bad', badge: 'Not loaded'}};

/** Up next: the Focus items that can't wait (src/suggestions.place; null = left out). An item read before places existed (a saved Focus) stays there. */
export const upNext = items => (items || []).filter(item => ('place' in item ? item.place : 'up_next') === 'up_next');

/** The Focus items that moved to Suggestions, in Focus's order (they keep their own buttons). */
export const movedItems = items => (items || []).filter(item => item.place === 'suggestions');

/** Focus's Suggestions list: the pool's entries as the engine sorted them (today's insight first), then the moved items. -> [{entry} | {item}] */
export const focusRows = (entries, items) => [...(entries || []).map(entry => ({entry})), ...movedItems(items).map(item => ({item}))];

/** The Jobs bar's entries: the search- and applying-related ones. */
export const jobsEntries = entries => (entries || []).filter(entry => JOBS_TOPICS.includes(entry.topic));

/**
 * What the Jobs bar may do on a render: `null` = leave it as it is drawn (Focus has not been read, so the drawer rows are still withheld and the entries
 * would be empty), else {shown, entries}. Why (owner, 28 Oct 2026: "I clicked on it. It vanished"): the bar is painted from the kept state at start; the first
 * render before Focus arrived (the click, the questions count) hid it.
 */
export const barState = (known, entries) => (known ? {shown: entries.length > 0, entries} : null);

/** A home screen's own entries (Strategy's Tune row). */
export const homeEntries = (entries, home) => (entries || []).filter(entry => entry.home === home);

/** The Focus head's count: "3 of 5" while folded, else the total. */
export const countWords = (shown, total) => (shown < total ? `${shown} of ${total}` : String(total));

/** The Jobs bar's line, folded ("2 suggestions for your search", or `line` when the drawers' rows are in it: foldedLine) and open. */
export const jobsBarWords = (count, open, line = '') => ({title: open ? 'Suggestions for your search' : line || `${count} suggestion${count === 1 ? '' : 's'} for your search`,
  detail: open ? '' : 'Show'});

/** A row's parts: its look, its meta line (where it comes from unless the badge says it, what it says), and the evidence behind it for the hover. */
export function entryParts(entry) {
  const look = LOOK[entry.kind] || {icon: 'bulb', tone: 'info', badge: ''};
  const source = entry.source === look.badge ? '' : entry.source;
  return {...look, headline: entry.title, meta: [source, entry.detail].filter(Boolean), evidence: (entry.evidence || []).join('\n')};
}
