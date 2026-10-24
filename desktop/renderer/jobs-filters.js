// Jobs page, the filters in ONE multi-select: the old "Show" menu and the saved-view chips merged, each filter once, ticked together (a job
// shows when ANY ticked filter holds it). No DOM here so the tests can check it. Guarded by: test/jobs-filters.test.js. Drawn by pages/jobs-filter-menu.js.
import {isInbound} from './origin.js';
import {VIEWS} from './jobs-board-rules.js';
import {openMatches} from './jobs-view.js';

export const DEFAULT_FILTERS = ['open'];   // New matches: the jobs waiting for a first look
// Saved and Dismissed live on both the old menu (a status) and the chips (a stage): one option each. A job counts when either says so
// (columnOf folds the status into the stage), so neither old list loses a job.
const STATUS_OPTIONS = [
  {id: 'open', label: 'New matches', title: 'Job matches you have not decided on', test: job => !isInbound(job) && job.status === 'unreviewed'},
  {id: 'applied', label: 'Applied', title: 'Job matches you applied to', test: job => !isInbound(job) && job.status === 'applied'},
  {id: 'saved', label: 'Saved', title: 'Jobs you saved for later', test: (job, now) => (!isInbound(job) && job.status === 'saved') || VIEW_TEST.saved(job, now)},
  {id: 'dismissed', label: 'Dismissed', title: 'Jobs you set aside', test: (job, now) => (!isInbound(job) && job.status === 'dismissed') || VIEW_TEST.dismissed(job, now)},
];
const VIEW_TEST = Object.fromEntries(VIEWS.map(view => [view.id, view.test]));
const VIEW_LABEL = {all: 'Any stage'};   // "All" beside "All matches" read as the same thing
const SHARED = new Set(['saved', 'dismissed']);
export const FILTER_GROUPS = [
  {name: 'Job matches', options: [...STATUS_OPTIONS,
    {id: 'all', label: 'All matches', title: 'Every job match, whatever its status', test: job => openMatches([job]).length > 0}]},
  {name: 'Your applications', options: VIEWS.filter(view => !SHARED.has(view.id)).map(view => ({
    id: `view:${view.id}`, label: VIEW_LABEL[view.id] || view.label, title: view.title, test: view.test}))},
  {name: 'Opportunities that found you', options: [{id: 'inbound', label: 'Inbound', title: 'Recruiters and employers who wrote to you', test: isInbound}]},
  {name: 'Everything', options: [{id: 'everything', label: 'Everything', title: 'Job matches and inbound together', test: () => true}]},
];
export const FILTER_OPTIONS = FILTER_GROUPS.flatMap(group => group.options);
const BY_ID = new Map(FILTER_OPTIONS.map(option => [option.id, option]));
export const isFilter = id => BY_ID.has(id);

// What is ticked, kept valid: known ids only, never empty (nothing ticked is the default).
export const normalize = ids => {
  const known = [...new Set(ids || [])].filter(isFilter);
  return known.length ? known : [...DEFAULT_FILTERS];
};
// The jobs the ticked filters hold: any of them.
export const inFilters = (job, ids, now = Date.now()) => ids.some(id => BY_ID.get(id)?.test(job, now));
// Inside a list a counter chose (its own jobs, applied ones too), the match lists' own narrowing steps aside: All matches / Everything let every one through.
export const inFiltersLoose = (job, ids, now = Date.now()) => ids.some(id => id === 'all' || id === 'everything') || inFilters(job, ids, now);
// The one menu value an old caller or a counter means, when exactly one filter is ticked; '' when several are.
export const soleFilter = ids => (ids.length === 1 ? ids[0] : '');
export const countFor = (jobs, id, now = Date.now()) => jobs.filter(job => BY_ID.get(id).test(job, now)).length;
// Ticking toggles one filter; unticking the last one goes back to the default.
export const toggled = (ids, id) => normalize(ids.includes(id) ? ids.filter(one => one !== id) : [...ids, id]);
// The words on the button: one name, or the first with "+ n".
export const summary = ids => {
  const names = ids.map(id => BY_ID.get(id)?.label).filter(Boolean);
  return names.length <= 1 ? names[0] || '' : `${names[0]} + ${names.length - 1}`;
};
// Filters that mean something on the board (a stage column): the others (new matches, inbound, all, everything) leave every application showing.
export const BOARD_FILTERS = new Set(['saved', 'applied', 'dismissed', ...VIEWS.filter(view => !SHARED.has(view.id)).map(view => `view:${view.id}`)]);
export const boardIds = ids => ids.filter(id => BOARD_FILTERS.has(id));
// A view option is a narrowing of your applications: the Talking section and the menu's own lists step aside for them.
export const hasViewOption = ids => ids.some(id => id.startsWith('view:'));
