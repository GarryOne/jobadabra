// Why a start button's run did not start (no AI credit, the trial over, Notion missing, Always on could not start it), read from the main process's answer.
// Every button that starts a run passes its answer through here, so a refusal is said where the person pressed, never a silent return (owner, 26 Oct 2026:
// "I press on 'find jobs' and nothing happens"). Said by pages/startup.js sayRefused (a pop-up) and pages/jobs-find.js (the Find jobs card).
// Guarded by: test/start-refusals.test.js.

// -> {text, credit, allowance, cap?, resetsAt?} for a refusal, or null when the run started (or only finished badly: that is a run, shown in Recent activity).
export function refusal(result) {
  if (!result || result.ok !== false || result.removed) return null;   // removed: the person took it out of the queue
  const text = String(result.error || result.text || '').replace(/^⚠️\s*/, '').trim();
  if (!text) return null;
  // cap: a Free AI line reached (lib/ai-caps.js: 'day', 'month', 'trial', 'busy'...), with when it opens again; the top-up dialog says which.
  return {text, credit: !!result.credit, allowance: !!result.allowance, ...(result.cap ? {cap: result.cap, resetsAt: result.resetsAt || null} : {})};
}

// The button for a refusal the person can fix: the top-up dialog's way out (pages/topup-dialog.js: Top up for Pro, Upgrade to Pro for the free tier), or the plans after the trial.
export const refusalAction = why => (why?.credit ? (why.cap ? 'Upgrade to Pro' : 'Top up') : why?.allowance ? 'See plans' : '');   // the dialog's words (plan-view.js topupWords)
