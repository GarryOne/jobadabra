// Drawer → Match: the score with its parts, why it fits and what to check (the Jobs list's own analysis, pages/jobs-fit.js fitDetail),
// then the fit line the search saved. Not scored: a state card. A score read with an earlier Profile says so.
import {matchGroups, matchView} from '../job-page-view.js';
import {lastActivity} from '../pages/activity-render.js';
import {fitDetail} from '../pages/jobs-fit.js';
import {button, group, skeleton, stateCard} from './parts.js';
import {plainError} from '../run-warnings.js';

export function matchTab({job, page}) {
  const match = matchView(job, page);
  if (!match) {
    // A check is running: this job is waiting its turn (the Recent activity bar knows). Else it waits for the next one; "Check now" starts it, as on the Jobs page.
    if (lastActivity?.running && (lastActivity.running.kind || 'search') === 'search') {
      return [stateCard({icon: 'info', title: 'Scoring in progress', text: 'A check is running now. This job is scored when it reaches it.'}), ...skeleton()];
    }
    return [stateCard({icon: 'target', title: 'Not scored yet', text: 'No description to read, or excluded by your filters. It is scored when the next check reads it.',
      actions: [button('Check now', () => document.getElementById('refresh').click(), 'primary')]})];
  }
  const nodes = [];
  if (match.older_places) nodes.push(olderPlacesCard(job));
  if (match.scoring_method === 'Previous') {
    nodes.push(stateCard({title: 'Score from an earlier Profile', text: 'It was scored before your Profile last changed. The next check scores it again.'}));
  }
  if (match.fit_detail) nodes.push(fitDetail(match));
  nodes.push(...matchGroups(match).filter(part => part.title === 'Fit').map(part => group(part.title, part.lines)));
  return nodes;
}

// Scored with other places than today's (owner, 17 Oct 2026): said on this job, with a Refresh for this one job. Nothing re-scores by itself.
function olderPlacesCard(job) {
  const refresh = button('Refresh this score', async event => {
    const control = event.currentTarget;
    control.disabled = true;
    const result = await window.pilot.refreshLocations(job.url).catch(error => ({ok: false, error: error.message}));
    control.textContent = plainError(result.ok ? (result.queued ? 'Queued: the next check scores it again' : 'Nothing to refresh') : result.error || 'Not queued');
  });
  return stateCard({title: 'Scored with older places', text: 'Your locations changed after this score. It is kept as it is until you refresh it.', actions: [refresh]});
}
