// Jobs' "Apply to jobs" dialog (owner, 28 Oct 2026 rework of #2317): how many jobs, how Jobadabra applies (Settings → Apply's own cards), "Apply to N jobs".
// A card pick saves through Settings → Apply's writer; a mode not built yet is a disabled "Coming soon" card. Pure parts: renderer/apply-dialog-model.js.
// Guard: test/apply-dialog-mode.test.js.
import {offerBrowser} from './browser-progress.js';
import {$, message} from './core.js';
import {applyOf} from '../apply-settings-model.js';
import {applyButtonLabel, applyDialogOutcome, applyDialogSelectMode, applyDialogStart, createApplyStartGate} from '../apply-dialog-model.js';
import {modeCards, save as saveApplySettings} from './apply-settings.js';
import {toastMessage} from './startup.js';

const gate = createApplyStartGate();
let settings = {};   // the saved settings the cards were last drawn from
let saving = false;

// The cards and the button from the saved settings; while a batch starts, the cards are off and the button stays "Starting…" (typing in the count changes nothing).
function draw() {
  $('apply-mode-cards').replaceChildren(modeCards(applyOf(settings).mode, pick, {busy: saving || gate.isStarting()}));
  if (gate.isStarting()) return;
  $('apply-go').textContent = applyButtonLabel($('apply-n').value);
}

async function pick(mode) {
  if (saving || gate.isStarting()) return;
  saving = true;
  draw();
  try {
    const picked = await applyDialogSelectMode({mode, save: saveApplySettings});
    if (picked.ok) settings = picked.settings;
    else if (picked.error) message('apply-message', picked.error, 'error');
  } finally {
    saving = false;
    draw();
  }
}

/** Wires the dialog once; startedApplying(): the Jobs list reads the jobs the batch marked. */
export function wireApplyDialog({startedApplying}) {
  $('apply-open').addEventListener('click', async () => {
    message('apply-message', '');
    settings = (await window.pilot.state().catch(() => null))?.settings || {};
    draw();
    $('apply-dialog').showModal();
  });
  $('apply-n').addEventListener('input', draw);
  // "Drafting kit 2 of 3…" while the batch drafts what is missing: on the button, beside the strip (no row of its own).
  window.pilot.onApplyProgress(text => { if (gate.isStarting()) $('apply-go').textContent = text; });
  $('apply-go').addEventListener('click', async event => {
    event.preventDefault();
    if (!$('apply-n').reportValidity()) return;   // 1–10 whole jobs (the field's own min/max/step), said by the field itself
    const n = Number($('apply-n').value), go = $('apply-go');
    await gate.run(async () => {
      // Feedback at once: picking the jobs reads Notion and checks each posting is still open (a few seconds). Before a first choice the
      // first-Apply dialog opens over this one (lib/apply-choice-gate.js), and the batch goes on after it.
      Object.assign(go, {disabled: true, textContent: 'Starting…'});
      go.classList.add('busy');
      $('apply-progress').hidden = false;   // the wait shows as a strip along the dialog's top edge, not as a row
      draw();
      try {
        const result = await applyDialogStart({count: n, start: options => window.pilot.apply(options)});
        if (result.ok) startedApplying();   // the batch marked the jobs it started: read the list again
        if (result.needsExtension || result.cancelled) { $('apply-dialog').close(); return; }   // the install dialog opens (extension-needed.js), or Not now in the first-Apply dialog
        // Why (2026-10-28, owner screenshot): the green "queued" line kept the dialog open with nothing left to do; a toast says it and the dialog closes (a click on it opens Sessions).
        const outcome = applyDialogOutcome(result);
        if (outcome.close) { const {title, body, target, tone} = outcome.toast; toastMessage(title, body, target, tone); $('apply-dialog').close(); return; }
        message('apply-message', outcome.error, 'error');
        offerBrowser($('apply-browser'), result.code === 'BACKGROUND_BROWSER_MISSING');   // the download, right where it was asked for
      } catch (error) {   // the call itself failed (e.g. the app updated while open): say so, the button comes back below
        message('apply-message', `Could not start applying: ${error.message}`, 'error');
      } finally {
        go.disabled = false;
        go.classList.remove('busy');
        $('apply-progress').hidden = true;
      }
    });
    settings = (await window.pilot.state().catch(() => null))?.settings || settings;   // a first-Apply choice made meanwhile
    draw();
  });
}
