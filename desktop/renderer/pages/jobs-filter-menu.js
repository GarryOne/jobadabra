// Jobs page, the Show menu: one multi-select holding every filter (jobs-filters.js), with each one's count. A change asks for a render through
// the "jobs-rerender" event. Guarded by: test/jobs-filters.test.js, test/jobs-board-page.test.js.
import {multiSelect} from '../multi-select.js';
import {$} from './core.js';
import {shared} from './shared.js';
import {jobsState} from './jobs-state.js';
import {DEFAULT_FILTERS, FILTER_GROUPS, FILTER_OPTIONS, countFor, normalize, summary, toggled} from '../jobs-filters.js';

let control = null;
// The filters ticked from code (a Telegram list, a counter, a job just added): validated, and the page redraws itself.
export function setFilters(ids) {
  jobsState.filters = normalize(ids);
}
export function renderFilterMenu() {
  const now = Date.now();
  const counts = Object.fromEntries(FILTER_OPTIONS.map(option => [option.id, countFor(shared.allJobs, option.id, now)]));
  control?.render({groups: FILTER_GROUPS, selected: jobsState.filters, counts, face: summary(jobsState.filters),
    canClear: jobsState.filters.join() !== DEFAULT_FILTERS.join()});
}
export function wireFilterMenu() {
  control = multiSelect($('filter-status'), {label: 'Show',
    onToggle: id => { jobsState.filters = toggled(jobsState.filters, id); jobsState.statFilter = null; document.dispatchEvent(new CustomEvent('jobs-rerender')); },
    onClear: () => { setFilters(DEFAULT_FILTERS); jobsState.statFilter = null; document.dispatchEvent(new CustomEvent('jobs-rerender')); }});
  renderFilterMenu();
}
