// Jobs page, shared state: one jobsState object (a value reassigned later stays ONE binding for every piece) and the link keys. Guarded by: the Jobs tests (count-flash, live-count, activity-selection-kept).

// Apply with Claude: offered (and recommended) when Claude Code is installed and Notion is connected.
export const jobsState = {
  jobsLoading: false,  // the first load from Notion is under way: the list keeps its spinner
  statFilter: null,  // the counter clicked above the list: 'applied', 'waiting', 'interviews', 'closed', 'high', 'companies', 'stuck' or null (Inbound picks the menu's filter)
  claudeReady: false,
  benchmarkText: {},   // url -> the board's typical reply line (lib/benchmarks.js), refreshed with the jobs list
  lastJobsData: null,   // the list as last loaded: a deleted job is recounted from it at once
  filters: ['open'],   // the ticked filters of the one Show menu (jobs-filters.js): a job shows when any of them holds it
  mode: 'list',   // 'list' or 'board' (pages/jobs-views.js, remembered on this computer)
};
export const MORE = 500;   // rows each "Show more" adds
export const pageKey = url => String(url || '').split('#')[0].replace(/\/$/, '');
// The whole link, #part included: recruiter leads differ only there (linkedin.com/messaging/#jp-…, a Gmail thread).
// Exported: the activity panel counts how many of a run's matches this list really holds (pages/activity.js).
export const fullKey = url => String(url || '').trim().replace(/\/$/, '');
