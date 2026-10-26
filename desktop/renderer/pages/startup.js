// Start-up: what the window opens on.
import {showMode, wireMode} from '../assistant-mode.js';
import {wireClaudeAuto} from '../claude-auto.js';
import {refreshClaudeHelp} from '../claude-help.js';
import {applyAiNames} from '../ai-name.js';
import {shared} from './shared.js';
import {$, show} from './core.js';
import {loadJobs} from './jobs.js';
import {openView, remembered} from './nav.js';
import {PANEL_KEY, openActivity} from './activity.js';
import {openSetting, settingsPage} from './settings.js';
import {refusal, refusalAction} from '../refusal.js';
import {toDraft} from './strategy-review.js';
import {openTarget} from './open-target.js';
import {goStep} from './wizard.js';

export function toastMessage(title, body, hint) {
  let target = null, action = null;
  // action: {label, run}, the next step as a button in the pop-up (owner, 7 Oct 2026: "Role added" said nothing about what to do next).
  if (typeof title === 'object') ({title, body, hint, target = null, action = null} = title);
  // The same message twice (a double click, two checks finding the same thing) replaces the first instead of stacking.
  for (const old of $('toasts').children) if (old.dataset.key === `${title}\n${body}`) old.remove();
  const toast = Object.assign(document.createElement('div'), {className: 'toast'});
  toast.dataset.key = `${title}\n${body}`;
  toast.append(Object.assign(document.createElement('b'), {textContent: title}), Object.assign(document.createElement('span'), {textContent: body}));
  if (hint) toast.append(Object.assign(document.createElement('small'), {textContent:
    window.pilot.platform === 'win32' ? 'Windows notifications are off for this app: Settings → System → Notifications → Jobadabra → On.'
      : 'macOS notifications are off for this app: System Settings → Notifications → Electron (or Jobadabra) → Allow notifications.'}));
  // A pop-up that is news about something opens it on a click (renderer/targets.js); the others just close.
  if (target) { toast.classList.add('toast-link'); toast.title = 'Click to open'; }
  if (action) {
    const next = Object.assign(document.createElement('button'), {type: 'button', className: 'secondary toast-action', textContent: action.label});
    next.addEventListener('click', event => { event.stopPropagation(); toast.remove(); action.run(); });
    toast.append(next);
  }
  toast.addEventListener('click', () => { toast.remove(); if (target) openTarget(target); });
  $('toasts').append(toast);
  setTimeout(() => toast.remove(), hint || action ? 20000 : 8000);   // a step to take stays long enough to take it
  return toast;
}

// A start button's run was refused (renderer/refusal.js): its reason in a pop-up, with Settings → Plan one press away when that fixes it.
// -> the refusal, or null when the run started (then nothing is said here).
export function sayRefused(title, result) {
  const why = refusal(result);
  if (!why) return null;
  const label = refusalAction(why);
  toastMessage({title, body: why.text, action: label ? {label, run: () => openSetting('plan')} : null});
  return why;
}

// Run at start-up, in the order the window has always done it (app.js calls each page's init in turn).
export async function init() {
  applyAiNames();   // the static texts name the AI the user chose (renderer/ai-name.js)
  // ---------- start ----------
  // Set up: the app. Without Notion (Notion later) it is only trying, so it opens on Jobs; the pages that need Notion show a gate.
  if (shared.state.settings.setupDone) {
    show($('app'));
    loadJobs();
    // After a reload (⌘R), the page and Settings section it was on, once all the code below has loaded (every page's
    // state is declared by then); else Focus.
    const view = remembered('view'), section = remembered('settingsPage');
    if (view && view !== 'focus' && document.querySelector(`.view[data-view="${view}"]`)) {
      setTimeout(() => {
        openView(view);
        if (view === 'settings' && section && document.querySelector(`[data-settings-page="${section}"]`)) settingsPage(section);
      }, 0);
    } else openView(shared.state.notion ? 'focus' : 'jobs');
    // The Recent activity panel open over it, on the same run (pages/activity.js PANEL_KEY); its content paints when the runs arrive.
    const panel = remembered(PANEL_KEY);
    if (panel) setTimeout(() => { shared.selectedRun = panel === 'live' ? null : Number(panel) || panel; openActivity(true); }, 0);
  } else {
    show($('wizard'));
    const saved = shared.state.settings.wizardStep === 'goals' ? 'cv' : shared.state.settings.wizardStep;  // the old goals step: now part of the CV step
    const resume = saved === 'notion' ? 'cv' : saved || 'welcome';  // an install that stopped on the old Notion step carries on at the CV
    if (resume === 'draft') toDraft(); else goStep(resume);
  }

  // In-window notifications (when macOS blocks system ones).
  window.pilot.onToast(toastMessage);
  window.pilot.onOpenTarget(openTarget);   // a clicked system notification

  // Help improve Jobadabra (opt-in anonymous form reports).
  // How much Jobadabra does (renderer/assistant-mode.js): "Do it for me" (the default) or "Let me check each step".
  wireMode(async patch => (shared.state.settings = await window.pilot.saveSettings(patch)));
  showMode(shared.state?.settings || {});   // the setup's question and Settings show the same choice; nothing saved yet is "Do it for me"
  wireClaudeAuto(async patch => (shared.state.settings = await window.pilot.saveSettings(patch)));   // "Always let Claude finish when I'm stuck" (claude-auto.js)
  refreshClaudeHelp();   // is Claude ready (installed, signed in)? every Claude entry point follows (claude-help.js)
}
