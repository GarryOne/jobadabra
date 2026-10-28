// The Actions page by importance: Find jobs large, Tailor CVs and Check Gmail medium, the smaller tasks under a collapsed "More · N" (the sidebar's component), and each scheduled task's real schedule under its name. The Run buttons are untouched: pages/runs-page.js keeps every one of them off while a task runs.
import {$} from './core.js';
import {shared} from './shared.js';
import {moreGroup} from '../more-group.js';
import {DEFAULT_SCHEDULE, scheduleLine} from '../schedule-line.js';

let more = null;

const smallRows = () => document.querySelectorAll('#actions-more-list > .task-card').length;
// The tasks with a schedule: the saved frequency (Settings → Automation) and the next run the app computes.
function showSchedules() {
  const schedule = {...DEFAULT_SCHEDULE, ...(shared.state?.settings?.schedule || {})};
  const next = shared.nextRuns || {};
  document.querySelectorAll('[data-task-schedule]').forEach(node => {
    const kind = node.dataset.taskSchedule;
    node.textContent = scheduleLine(schedule[kind], next[kind]);
  });
}

export function drawActionsMore() { more?.draw(smallRows()); }   // Read this board joins the list later (actions-board.js)

export function initActionsLayout() {
  more = moreGroup({root: $('actions-more'), head: $('actions-more-head'), list: $('actions-more-list'), title: $('actions-more-title'), key: 'jp.actions.more'});
  drawActionsMore();
  showSchedules();
  window.addEventListener('activity-updated', showSchedules);
}
