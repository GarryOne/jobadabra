// Actions: the compact banner of the newest unseen finished run and of the next queued one (the full report is the run panel's), and the kept status bar / kept Recent activity.
// Split out of activity.js as a pure move. Guarded by the tests that read the activity-*.js sources (desktop/test/activity-source.js) and the e2e activity suites.
import {unseenRun, withShown, settledBy} from '../result-seen.js';
import {compactRun} from '../run-compact.js';
import {queueWords} from '../run-pick.js';
import {shared} from './shared.js';
import {$, show} from './core.js';
import {clockTime, duration, KIND, kindOf, capital, outcome} from './activity-basics.js';
import {lastActivity, unqueue} from './activity-render.js';
import {rerunTask} from './activity-problem-box.js';
import {openView} from './nav.js';
import {openActivity} from './activity-panel.js';
import {drawBanner} from './run-banner.js';
import {taskName} from './runs-page.js';
// The Actions page shows the newest finished run as the compact banner (owner, 25 Oct 2026: "in Actions, we shouldn't show such a detailed card report. This should be
// the full report (Actions → Runs) or the Drawer"): its name, pill, when, how long and the Recent runs row's line, one next step, View run, Dismiss. It is drawn at
// once from the run's row (no page read, so nothing appears a moment later and pushes the task grid down: #286). Model: renderer/run-compact.js.
function showActionsResult(run) {
  show($('command-answer'), false);
  const kind = kindOf(run), name = taskName(kind);
  const model = compactRun(run, {name, kind, outcome: capital(outcome(run)), at: clockTime(run.endedAt || run.startedAt),
    took: run.endedAt && run.startedAt ? duration(run.startedAt, run.endedAt) : ''});
  drawBanner($('actions-result'), model, {
    view: () => { shared.selectedRun = run.id; openActivity(true); },   // its full report, in the run panel
    next: next => (next.view ? openView(next.view) : next.rerun ? rerunTask(run) : null),
    close: () => show($('actions-result'), false)});
  show($('actions-result'));
}
// The next queued task, compact, under the running banner: what it waits for, Cancel and View run (its queued panel). The queue itself is in Actions → Runs.
export function showQueuedBanner(data) {
  const next = data?.queued?.[0] ? {...data.queued[0], waiting: true, place: 1} : null;
  show($('actions-queued'), !!next);
  if (!next) return;
  const kind = kindOf(next), {waiting, place} = queueWords(next, data, taskName);
  drawBanner($('actions-queued'), compactRun(next, {name: taskName(kind), kind, waiting, place}), {
    view: () => { shared.selectedRun = next.id; openActivity(true); },
    close: () => unqueue({id: next.id})});
}
// The run the owner has not seen yet gets the banner, for every kind of task, however it started (your click, a schedule, Always on, before a reload). "Seen" is
// the id of the last run whose banner was shown here or dismissed, kept on this Mac; the first start only marks what is already there as seen. It never
// changes which run an open drawer shows (owner, 25 Oct 2026: "never switch an already-open drawer to another run").
const SEEN_KEY = 'actionsResultSeen';
const SHOWN_KEY = 'actionsResultShown';   // the ids shown since that first start (renderer/result-seen.js)
const seenResult = () => { try { return Number(localStorage.getItem(SEEN_KEY)) || 0; } catch { return 0; } };
const shownResults = () => { try { return JSON.parse(localStorage.getItem(SHOWN_KEY) || '[]').filter(Number.isFinite); } catch { return []; } };
const withShown2 = (shown, id) => withShown(shown, id);
const markResultSeen = (id, older = []) => { try { if (!seenResult()) localStorage.setItem(SEEN_KEY, String(id)); localStorage.setItem(SHOWN_KEY, JSON.stringify([id, ...older].reduce(withShown2, shownResults()))); } catch { /* private window: it shows again after a reload */ } };
export function showAwaitedResult(runs, {opening = false} = {}) {
  const newest = runs.find(r => r.endedAt && !r.live && KIND[kindOf(r)]);
  if (!seenResult()) { markResultSeen(newest ? newest.id : 1); return; }   // first start: what is there already is not news (1: no run yet, every later one is)
  if (!newest) return;
  const run = unseenRun(runs, {base: seenResult(), shown: shownResults()}, r => KIND[kindOf(r)]);
  if (!run) return;
  const onActions = opening || !document.querySelector('.view[data-view="actions"]').hidden;   // opening: drawn before the page is shown (prepareActions)
  if (!onActions) return;   // shown when the Actions page is opened
  showActionsResult(run);
  markResultSeen(run.id, settledBy(runs, run));
}
// The status bar's last finished state, kept on this Mac: shown the moment the window opens, instead of
// "No search yet" until the run history has been read (from Notion). A running state is never kept.
const STATUS_KEPT = 'statusBar';
export function keepStatusBar() {
  const kept = {state: $('activity').dataset.state, title: $('activity-title').textContent,
    step: $('activity-step').textContent, meta: $('activity-meta').textContent};
  try { localStorage.setItem(STATUS_KEPT, JSON.stringify(kept)); } catch {}
}
export function showKeptStatusBar() {
  let kept = null;
  try { kept = JSON.parse(localStorage.getItem(STATUS_KEPT) || 'null'); } catch {}
  if (!kept?.title || lastActivity) return;
  $('activity').dataset.state = kept.state || 'idle';
  $('activity-title').textContent = kept.title;
  $('activity-step').textContent = kept.step;
  $('activity-meta').textContent = kept.meta;
}
// Recent activity kept on this Mac: until the run history has been read from Notion (the runs of GitHub and Telegram
// live there), the panel shows the list from last time, with this Mac's newer runs on top, instead of an empty panel.
const ACTIVITY_KEPT = 'recentActivity';
export function withKept(data) {
  if (data.historyLoaded) {
    try { localStorage.setItem(ACTIVITY_KEPT, JSON.stringify(data.runs.slice(0, 20))); } catch {}
    return data;
  }
  let kept = [];
  try { kept = JSON.parse(localStorage.getItem(ACTIVITY_KEPT) || '[]'); } catch {}
  if (!kept.length) return data;
  const byId = new Map(kept.map(run => [run.id, run]));
  for (const run of data.runs) byId.set(run.id, run);  // this Mac's copy is the newer one
  const runs = [...byId.values()].sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')));
  return {...data, runs};
}
// Recent activity lists every run that took time or AI money, scheduled or started by you; the ones you started
// (a Log box entry, an interview prep kit, a Check now) carry a "By you" tag, and every row shows its AI cost.
export const byYou = run => run.trigger === 'you' && !run.live && !run.waiting;
// How many finished runs the list shows at once; "View more" adds another page and the list scrolls. The app reads
// the newest 25 from Notion, so that is as far as it goes without asking Notion again.
