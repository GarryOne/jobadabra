// Start-up: what the window opens on.
import {showMode, wireMode} from '../assistant-mode.js';
import {wireClaudeAuto} from '../claude-auto.js';
import {refreshClaudeHelp} from '../claude-help.js';
import {applyAiNames} from '../ai-name.js';
import {shared} from './shared.js';
import {$, show} from './core.js';
import {loadJobs} from './jobs.js';
import {openView, remembered} from './nav.js';
import {restoreView} from '../view-memory.js';
import {PANEL_KEY, openActivity} from './activity.js';
import {settingsPage} from './settings.js';
import {refusal, refusalAction} from '../refusal.js';
import {openTopupDialog} from './topup-dialog.js';
import {toDraft} from './strategy-review.js';
import {openTarget} from './open-target.js';
import {clean} from '../targets.js';
import {TONES, toneOf} from '../toast-tone.js';
import {icon} from '../icons.js';
import {goStep} from './wizard.js';

// toastMessage(title, body, target, tone) or toastMessage({title, body, target, tone, action, hint}). target: where a click leads (renderer/targets.js),
// or a NO_PLACE reason when there is none; tone: bad | warn | good | info, its colour and icon (renderer/toast-tone.js). test/toast-targets.test.js
// checks every call names both.
export function toastMessage(title, body, target = null, tone = 'info') {
  let hint = false, action = null;
  // action: {label, run}, the next step, run by a click on the pop-up itself (owner, 7 Oct 2026: "Role added" said nothing about what to do next;
  // 27 Oct 2026: "The toast notifications shouldn't really have a button, but just clicking them, should produce an action"). No button in a pop-up.
  if (typeof title === 'object') ({title, body, hint, target = null, action = null, tone = 'info'} = title);
  // The same message twice (a double click, two checks finding the same thing) replaces the first instead of stacking.
  for (const old of $('toasts').children) if (old.dataset.key === `${title}\n${body}`) old.remove();
  const kind = toneOf(tone);
  const toast = Object.assign(document.createElement('div'), {className: `toast tone-${kind}`});
  toast.append(icon(TONES[kind], 'icon toast-icon'));
  toast.dataset.key = `${title}\n${body}`;
  toast.append(Object.assign(document.createElement('b'), {textContent: title}), Object.assign(document.createElement('span'), {textContent: body}));
  if (hint) toast.append(Object.assign(document.createElement('small'), {textContent:
    window.pilot.platform === 'win32' ? 'Windows notifications are off for this app: Settings → System → Notifications → Jobadabra → On.'
      : 'macOS notifications are off for this app: System Settings → Notifications → Electron (or Jobadabra) → Allow notifications.'}));
  // One click, one thing: the action when there is one, else open what the pop-up is about (renderer/targets.js); the others just close.
  const place = clean(target);   // a NO_PLACE reason (a string) is no place
  if (action) { toast.append(Object.assign(document.createElement('small'), {className: 'toast-next', textContent: `${action.label} ›`})); toast.title = `Click: ${action.label}`; }
  else if (place) toast.title = 'Click to open';
  if (action || place) toast.classList.add('toast-link');
  toast.addEventListener('click', () => { toast.remove(); if (action) action.run(); else if (place) openTarget(place); });
  $('toasts').append(toast);
  setTimeout(() => toast.remove(), hint || action ? 20000 : 8000);   // a step to take stays long enough to take it
  return toast;
}

// A start button's run was refused (renderer/refusal.js): no AI credit or a Free AI line opens the top-up dialog (owner, 26 Oct 2026: "Blocking, but showing a topup
// popup/dialog"; retry: the same press, run again after a promo code added credit); any other reason in a pop-up whose click opens Settings → Plan's card
// when Plan fixes it, else place (what the press was about: a job's row, Recent activity).
// -> the refusal, or null when the run started (then nothing is said here).
export function sayRefused(title, result, {place = null, retry = null} = {}) {
  const why = refusal(result);
  if (!why) return null;
  if (why.credit) { openTopupDialog(why, {action: title.replace(/ did not start$/, ''), retry}); return why; }
  const label = refusalAction(why);
  toastMessage({title, body: why.text, target: label ? {card: 'license'} : place, tone: 'warn'});   // the click opens Settings → Plan's card (no button)
  return why;
}

// Run at start-up, in the order the window has always done it (app.js calls each page's init in turn).
export async function init() {
  applyAiNames();   // the static texts name the AI the user chose (renderer/ai-name.js)
  // A Free AI line found after a run or a refused AI step (lib/ai-caps.js): the top-up dialog, at most once per half hour for steps nobody pressed.
  window.pilot.onAiCap?.(cap => openTopupDialog({cap: cap.capped, resetsAt: cap.resetsAt, text: cap.message}));
  // ---------- start ----------
  // Set up: the app. Without Notion (Notion later) it is only trying, so it opens on Jobs; the pages that need Notion show a gate.
  if (shared.state.settings.setupDone) {
    show($('app'));
    loadJobs();
    // After a reload (⌘R), the page and Settings section it was on, once all the code below has loaded (every page's
    // state is declared by then); else Focus.
    setTimeout(() => restoreView({document, openView, settingsPage, fallback: shared.state.notion ? 'focus' : 'jobs'}), 0);
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
  window.pilot.onToast(toast => toastMessage(toast.retrySave ? {...toast, action: {label: 'Retry', run: () => window.pilot.retrySave(toast.retrySave)}} : toast));   // a save Windows held too long: the click retries (lib/save-notice.js)
  window.pilot.onOpenTarget(openTarget);   // a clicked system notification

  // Help improve Jobadabra (opt-in anonymous form reports).
  // How much Jobadabra does (renderer/assistant-mode.js): "Do it for me" (the default) or "Let me check each step".
  wireMode(async patch => (shared.state.settings = await window.pilot.saveSettings(patch)));
  showMode(shared.state?.settings || {});   // the setup's question and Settings show the same choice; nothing saved yet is "Do it for me"
  wireClaudeAuto(async patch => (shared.state.settings = await window.pilot.saveSettings(patch)));   // "Always let Claude finish when I'm stuck" (claude-auto.js)
  refreshClaudeHelp();   // is Claude ready (installed, signed in)? every Claude entry point follows (claude-help.js)
}
