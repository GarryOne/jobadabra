// Focus's Suggestions, the Jobs bar and a home's rows: which entries each place shows and the words around them, free of the DOM so the tests
// can check them. Entries come from the engine's pool (src/suggestions.py); pages/focus-suggestions.js draws them and runs their buttons.
// Spec: docs/superpowers/specs/2026-10-28-insights-with-actions-design.md (PR 1a). Guarded by test/suggestions.test.js.

export const SHOWN = 3;                              // Focus shows the 3 first, then "Show all N" (spec)
export const JOBS_TOPICS = ['search', 'applying'];   // the Jobs bar's (spec: "only the search- and applying-related ones")
// Every actions[].do the engine writes (src/suggestions.py, src/suggestions_search.py), each run by pages/focus-suggestions.js RUN.
export const DOES = ['open_insight', 'open_rejection', 'read_week', 'analyze', 'tune', 'find_jobs', 'tailor', 'prep', 'change_search', 'read_site', 'see_all', 'show_jobs', 'edit_minimum'];   // the Jobs drawers' rows write theirs in the window: question-entries.js QUESTION_DOES
// Each producer's row: its icon, its edge colour and its badge.
export const LOOK = {insight: {icon: 'bulb', tone: 'warn', badge: 'Insight'}, rejection: {icon: 'alert', tone: 'warn', badge: 'Rejection'},
  week: {icon: 'chart', tone: 'good', badge: 'Your week'}, analyze: {icon: 'chart', tone: 'info', badge: 'Analyze'}, tune: {icon: 'sliders', tone: 'info', badge: 'Tune'},
  // Strategy's search rows (PR 1b): the icons of their Strategy rows
  places: {icon: 'pin', tone: 'info', badge: 'Places'}, ideas: {icon: 'briefcase', tone: 'info', badge: 'Roles'}, coverage: {icon: 'search', tone: 'info', badge: 'Role words'},
  filters: {icon: 'sliders', tone: 'info', badge: 'Filters'}, visits: {icon: 'external', tone: 'warn', badge: 'Sites'},
  pay: {icon: 'coins', tone: 'info', badge: 'Pay'},   // Insights PR 3 (#15): matches held under High fit by their pay
  // The Jobs drawers' rows (PR 1c): the colours of the cards they replace (cover letter and Fill your details amber, What we learned blue)
  letter: {icon: 'file', tone: 'bad', badge: 'High priority'}, details: {icon: 'user', tone: 'warn', badge: 'Details'}, learned: {icon: 'bulb', tone: 'info', badge: 'Learned'},
  'questions-error': {icon: 'alert', tone: 'bad', badge: 'Not loaded'},
  skills: {icon: 'file', tone: 'info', badge: 'Your CV'}};   // Insights PR 2 (#6): skills only the Experience bank has

/** Up next: the Focus items that can't wait (src/suggestions.place; null = left out). An item read before places existed (a saved Focus) stays there. */
export const upNext = items => (items || []).filter(item => ('place' in item ? item.place : 'up_next') === 'up_next');

/** The Focus items that moved to Suggestions, in Focus's order (they keep their own buttons). */
export const movedItems = items => (items || []).filter(item => item.place === 'suggestions');

/** Focus's Suggestions list: the pool's entries as the engine sorted them (today's insight first), then the moved items. -> [{entry} | {item}] */
export const focusRows = (entries, items) => [...(entries || []).map(entry => ({entry})), ...movedItems(items).map(item => ({item}))];

/** The Jobs bar's entries: the search- and applying-related ones. */
export const jobsEntries = entries => (entries || []).filter(entry => JOBS_TOPICS.includes(entry.topic));

/**
 * What the Jobs bar shows, from its four states (the one owner of that decision): kept paint = the line last drawn, until Focus is read; Focus unavailable = hidden
 * (gated or failed, nothing to fill it); Focus read = its entries, hidden at zero. `rows` says whether the list below may be redrawn (only once Focus is read).
 * Why (#2382, owner 28 Oct 2026: "I clicked on it. It vanished"): the toggle used to redraw from entries that were empty until Focus was read, so the kept bar was hidden.
 */
export function barView({focusRead, unavailable = false, kept = null, entries = [], open = false, line = ''}) {
  if (!focusRead) return {shown: Boolean(kept?.shown) && !unavailable, rows: false, ...jobsBarWords(Number(kept?.count) || 0, open, kept?.line || '')};
  return {shown: entries.length > 0, rows: true, ...jobsBarWords(entries.length, open, line)};
}

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
