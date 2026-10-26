// The first-Apply dialog (owner, 26 Oct 2026: new installs and existing users see it once; "I check each form" pre-selected): any Apply before the choice
// answers {needsApplyChoice} (lib/apply-choice-gate.js), preload.cjs holds that press and raises pilot-needs-apply-choice; this asks "How should Jobadabra
// apply for you?". Continue saves the choice and the held press goes on (pilot-apply-chosen); Adjust settings… opens Settings → Apply with Confirm;
// Not now or Esc lets it go (pilot-apply-not-chosen). Guard: test/apply-choice-gate.test.js, test/apply-settings.test.js.
import {$} from './core.js';
import {applyOf} from '../apply-settings-model.js';
import {askConfirm, confirming, modeCards, save, settingsNow, todayLine} from './apply-settings.js';

const answer = chosen => window.dispatchEvent(new Event(chosen ? 'pilot-apply-chosen' : 'pilot-apply-not-chosen'));

export function init() {
  const dialog = $('apply-choice-dialog');
  if (!dialog) return;
  let pick = 'check';
  const draw = () => {
    $('apply-choice-modes').replaceChildren(modeCards(pick, id => { pick = id; draw(); }, {dialog: true}));
    todayLine($('apply-choice-today'), pick);
  };
  window.addEventListener('pilot-needs-apply-choice', () => {
    if (dialog.open || confirming()) return;   // one question at a time: every press waiting goes on with the same answer
    pick = applyOf(settingsNow()).mode;   // "I check each form" unless a mode was saved before
    draw();
    dialog.showModal();
  });
  dialog.addEventListener('cancel', () => answer(false));   // Esc
  $('apply-choice-later').addEventListener('click', () => { dialog.close(); answer(false); });
  $('apply-choice-go').addEventListener('click', async () => { await save({mode: pick}, {chosen: true}); dialog.close(); answer(true); });
  $('apply-choice-adjust').addEventListener('click', async () => { dialog.close(); await save({mode: pick}); askConfirm(answer); });
}
