// Recent activity: the header filter, the open/close of the panel and the run announcements.
// Split out of activity.js as a pure move. Guarded by the tests that read the activity-*.js sources (desktop/test/activity-source.js) and the e2e activity suites.
import {claimOverlay, registerOverlay, releaseOverlay} from '../overlay-slot.js';
import {humanError} from '../run-warnings.js';
import {doneTitle} from '../run-status.js';
import {shared} from './shared.js';
import {$, aiReady, show} from './core.js';
import {panelClosed, panelOpened, remembered} from './nav.js';
import {toastMessage} from './startup.js';
import {renderDraft, showDraftIntro} from './strategy-review.js';
import {goStep} from './wizard.js';
import {CV_FILES} from '../cv-files.js';
import {KIND, kindOf, capital, outcome, refreshGmailConnection} from './activity-basics.js';
import {lastActivity, renderActivity} from './activity-render.js';
import {mountInDrawer, pinDefault, runsTabShown, showRunsTab} from './runs-tab.js';
import {runTone} from '../toast-tone.js';
// The bar's action: hide the open panel, watch what's running, or see the details.
export function barLabel() {
  $('activity-open').textContent = !$('activity-panel').hidden ? 'Hide activity ⌄' : lastActivity?.running ? 'View progress ↑' : 'Details ▴';
}
// fromHistory: ⌘← / ⌘→ opened or closed it (pages/nav.js); anything else is a step of its own there.
// The panel, and the run it shows, kept for a reload (⌘R) beside the page (pages/nav.js remembered; owner, 8 Oct 2026: "preserve the Recent
// activity modal being open after Cmd+R"). '' = closed, 'live' = the running task, else the run's id. Restored by pages/startup.js.
export const PANEL_KEY = 'activityPanel';
export const panelMemory = (open, run) => (open ? (run == null ? 'live' : String(run)) : '');
export function openActivity(open, {fromHistory = false} = {}) {
  // Actions → Runs on screen holds the run panel: the run shows there, never in a drawer over it (owner, 25 Oct 2026).
  if (open && runsTabShown()) { showRunsTab(shared.selectedRun ?? undefined); return; }
  if (open) { mountInDrawer(); pinDefault(); }   // the generic Details: the running, next queued or latest run, then kept (renderer/run-pick.js)
  if (!fromHistory && open === $('activity-panel').hidden) (open ? panelOpened : panelClosed)(shared.selectedRun);
  if (open) claimOverlay('activity'); else releaseOverlay('activity');   // a job's drawer and this panel take turns (renderer/overlay-slot.js)
  show($('activity-panel'), open);
  remembered(PANEL_KEY, panelMemory(open, shared.selectedRun));
  if (open) refreshGmailConnection();   // Gmail's connection as it is now, for the header button and the schedule
  // No dimming: the panel is part of the bottom bar; a press anywhere else on the page closes it (below).
  $('activity').classList.toggle('open', open);
  $('activity-toggle').setAttribute('aria-expanded', open);
  if (open) $('log').scrollTop = $('log').scrollHeight;
  barLabel();
  if (lastActivity) renderActivity(lastActivity);  // the bar drops "Next jobs check" while the panel shows it
}

registerOverlay('activity', {close: () => openActivity(false), open: () => openActivity(true)});

// In-app notifications: a scheduled job starting, and any job ending (with its result); click one to see it.
let announced = null;  // {running: id of the run announced as started, done: ids of finished runs already seen}
export function announceRuns({running, runs}) {
  if (!announced) { announced = {running: running?.id ?? null, done: new Set(runs.map(run => run.id))}; return; }
  const where = run => run.source === 'github' ? ' · on GitHub' : '';
  if (running && running.id !== announced.running) {
    announced.running = running.id;
    const kind = KIND[kindOf(running)] || KIND.search;
    if (running.trigger === 'schedule') toastMessage({title: `${kind.icon} ${kind.name} started`, body: `Scheduled${where(running)}`, target: {activity: true}, tone: 'info'});
  }
  for (const run of runs.filter(r => !announced.done.has(r.id))) {
    announced.done.add(run.id);
    if (Date.now() - Date.parse(run.endedAt || run.startedAt) > 3 * 60000) continue;  // history arriving (Notion), not news
    const kind = KIND[kindOf(run)] || KIND.search;
    toastMessage({title: doneTitle(kind.name, run), body: `${capital(outcome(run))}${where(run)}`, target: {run: run.id}, tone: runTone(run)});   // a click opens this run's result
  }
}

// Setup step 2's card: empty (drop-zone wording) or holding the chosen file (name, when added) with Replace as its one button.
export function refreshCv() {
  const {cvName, cvAddedAt} = shared.state.settings, kinds = CV_FILES.label;
  show($('cv-file'), !!cvName);
  $('cv-name').textContent = cvName || 'No CV chosen yet';
  $('cv-meta').textContent = cvName && cvAddedAt ? `Added ${new Date(cvAddedAt).toLocaleDateString(undefined, {day: 'numeric', month: 'short'})}` : '';
  $('cv-choose').classList.toggle('primary', !cvName);   // chosen: Replace is quiet, Continue is the one primary
  $('cv-choose').classList.toggle('secondary', !!cvName);
  $('cv-choose-label').textContent = cvName ? 'Replace CV…' : `Choose your CV (${kinds})…`;
  $('cv-kinds').textContent = `· ${kinds}`;
  $('cv-next').disabled = !shared.state.hasCv;
}

// The wizard asks nothing but an optional note (strategy step, before building): the AI proposes the goals from the CV, the review corrects them.
export const QUESTIONS = {anything_else: 'q-more'};
export const currentAnswers = () => Object.fromEntries(Object.entries(QUESTIONS).map(([key, id]) => [key, $(id).value.trim()]));

export async function buildDraft() {
  goStep('draft');
  shared.rebuildAsked = false;
  show($('draft-intro'), false); show($('draft-actions'));
  show($('draft-loading')); show($('draft-view'), false); show($('draft-error'), false); show($('draft-stale'), false);
  $('draft-title').textContent = 'Your strategy'; show($('draft-subtitle'), false); show($('draft-cost'), false);
  $('draft-save').disabled = true;
  if (!aiReady()) {
    showDraftIntro();
    $('draft-error').textContent = 'Building your strategy needs AI (step 1: Claude Code, Codex or an API key). Go back and add it, or skip to use the example settings.';
    show($('draft-error'));
    return;
  }
  const answers = currentAnswers();
  // Progress while Claude writes: the part it's on, how much has arrived, and the time so far.
  const started = Date.now();
  $('draft-part').textContent = 'Reading your CV'; $('draft-percent').textContent = ''; $('draft-bar').style.width = '2%';
  const clock = setInterval(() => {
    const seconds = Math.round((Date.now() - started) / 1000);
    $('draft-time').textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} so far. Usually 1 to 2 minutes; you can leave this window open and wait.`;
  }, 1000);
  try {
    shared.draft = await window.pilot.draftStrategy(answers);
  } catch (error) {
    clearInterval(clock);
    showDraftIntro();  // the note stays, Build tries again
    $('draft-error').textContent = `Couldn't draft your strategy: ${humanError(error.message.replace(/^Error invoking remote method '[^']+': /, ''))}`;
    show($('draft-error'));
    return;
  }
  clearInterval(clock);
  renderDraft();
}

