// Recent activity: the result of a finished task shown once, and the kept status bar / kept Recent activity.
// Split out of activity.js as a pure move. Guarded by the tests that read the activity-*.js sources (desktop/test/activity-source.js) and the e2e activity suites.
import {unseenRun, withShown, settledBy} from '../result-seen.js';
import {el, pill} from '../components.js';
import {plainMessage} from '../run-cards.js';
import {runPill, noResultHead} from '../run-status.js';
import {shared} from './shared.js';
import {$, show} from './core.js';
import {clockTime, KIND, kindOf, runResults, capital, outcome, cardFor} from './activity-basics.js';
import {lastActivity, renderActivity} from './activity-render.js';
import {renderCardSkeleton, renderNoResult} from './activity-run-card.js';
import {rerunTask} from './activity-problem-box.js';
import {openView} from './nav.js';
import {openActivity} from './activity-panel.js';
import {showFullReport} from './full-report.js';
import {hasFullReport} from '../searches-view.js';
function showActionsResult(run, kind, draw, {pillOf = null} = {}) {
  show($('command-answer'), false);
  // A card with no result says how the run ended with the pill of its cause (Interrupted, Failed, No result); other cards keep "Needs a look" for a run that did not work.
  const [label, tone] = pillOf ? pillOf : run.ok && !run.off ? runPill(run) : ['Needs a look', 'bad'];
  $('actions-result-head').replaceChildren(el('b', '', `${kind.icon} ${kind.name}`), pill(label, tone), el('span', 'muted', `Finished ${clockTime(run.endedAt || run.startedAt)}`),
    ...(hasFullReport({...run, kind: kindOf(run)}) ? [Object.assign(el('button', 'link small', 'Full report →'), {type: 'button', title: 'Every number of this search, in Reports', onclick: () => showFullReport(run.pageId)})] : []));   // a search run's details, as in Recent activity
  draw($('actions-card'));
  show($('actions-result'));
  $('actions-result').scrollIntoView({behavior: 'smooth', block: 'nearest'});
}
// The Actions page shows the newest finished run's result as a card at the top, for every kind of task, however it started (your click, a schedule, Always on,
// before a reload): the run the owner has not seen yet. "Seen" is the id of the last run whose card was shown here or dismissed, kept on this Mac; the first start
// only marks what is already there as seen. Before 5 Oct 2026 it was only for the task clicked in this window, forgot a run whose Notion page had no Result yet, and
// then fell back to raw chat text.
const SEEN_KEY = 'actionsResultSeen';
const SHOWN_KEY = 'actionsResultShown';   // the ids shown since that first start (renderer/result-seen.js)
const seenResult = () => { try { return Number(localStorage.getItem(SEEN_KEY)) || 0; } catch { return 0; } };
const shownResults = () => { try { return JSON.parse(localStorage.getItem(SHOWN_KEY) || '[]').filter(Number.isFinite); } catch { return []; } };
const withShown2 = (shown, id) => withShown(shown, id);
const markResultSeen = (id, older = []) => { try { if (!seenResult()) localStorage.setItem(SEEN_KEY, String(id)); localStorage.setItem(SHOWN_KEY, JSON.stringify([id, ...older].reduce(withShown2, shownResults()))); } catch { /* private window: it shows again after a reload */ } };
const waitingForResult = new Set();   // run ids whose Notion page is being read for the result
export function showAwaitedResult(runs, {opening = false} = {}) {
  const newest = runs.find(r => r.endedAt && !r.live && KIND[kindOf(r)]);
  if (!seenResult()) { markResultSeen(newest ? newest.id : 1); return; }   // first start: what is there already is not news (1: no run yet, every later one is)
  if (!newest) return;
  const run = unseenRun(runs, {base: seenResult(), shown: shownResults()}, r => KIND[kindOf(r)]);
  if (!run || waitingForResult.has(run.id)) return;
  const onActions = opening || !document.querySelector('.view[data-view="actions"]').hidden;   // opening: drawn before the page is shown (prepareActions)
  if (!onActions && $('activity-panel').hidden) return;   // shown when the Actions page is opened
  const kind = KIND[kindOf(run)];
  const show = message => {
    if (!$('activity-panel').hidden) {
      runResults.set(run.id, message || capital(outcome(run)));  // shown under the run in Recent activity
      shared.selectedRun = run.id;
      markResultSeen(run.id, settledBy(runs, run));
      renderActivity(lastActivity);
      return;
    }
    // The same card as in Recent activity (counts, top matches, the report); a run without a message gets what its row says and a plain "No result was saved" with Retry / Log, never skeleton bars.
    const card = cardFor(run, message);
    const noResult = !card && !message;
    const head = noResult ? noResultHead({...run, kind: kindOf(run)}, kind) : null;
    const draw = card || (message ? (target => target.replaceChildren(el('p', 'run-card-note', plainMessage(message))))
      : (target => renderNoResult(head, {log: () => { shared.selectedRun = run.id; openActivity(true); },
        fix: head.fix?.retry ? () => load() : head.fix?.rerun ? () => rerunTask(run) : head.fix?.view ? () => openView(head.fix.view) : null}, target)));
    showActionsResult(run, kind, draw, {pillOf: head && (head.pill || runPill({...run, kind: kindOf(run)}))});
    markResultSeen(run.id, settledBy(runs, run));
  };
  // A run recorded on this Mac has no message when it was sent to Telegram: it is on its Notion page, written a moment after the run ends.
  // On Actions, the card takes its place at once, as skeleton bars, and fills in when the page is read: appearing seconds later at the top, it pushed the task grid
  // down while a person was about to press a task (#286). Retry runs the same read again.
  // Declared before the early return below: Retry on the no-result card calls load() even when that return was taken.
  const read = (tries = 0) => window.pilot.runDetail(run.pageId).then(detail => detail?.message || tries >= 6 ? detail?.message : new Promise(resolve => setTimeout(resolve, 4000)).then(() => read(tries + 1)))
    .catch(() => null);
  if (run.message || !run.pageId) { show(run.message); return; }
  function load() {
    waitingForResult.add(run.id);
    if ($('activity-panel').hidden) showActionsResult(run, kind, renderCardSkeleton);
    // Whatever happens, the skeleton ends in a final state: a throw while drawing is drawn again as the plain no-result card.
    read().then(message => { waitingForResult.delete(run.id); try { show(message || null); } catch (error) { console.error('actions: a result card was not drawn', error); show(null); } })
      .catch(error => { console.error('actions: a result card was not drawn', error); waitingForResult.delete(run.id); });
  }
  load();
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
