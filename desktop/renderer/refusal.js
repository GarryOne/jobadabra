// Why a start button's run did not start (no AI credit, the trial over, Notion missing, Always on could not start it), read from the main process's answer.
// Every button that starts a run passes its answer through here, so a refusal is said where the person pressed, never a silent return (owner, 26 Oct 2026:
// "I press on 'find jobs' and nothing happens"). Said by pages/startup.js sayRefused (a pop-up) and pages/jobs-find.js (the Find jobs card).
// Guarded by: test/start-refusals.test.js.

// -> {text, credit, allowance} for a refusal, or null when the run started (or only finished badly: that is a run, shown in Recent activity).
export function refusal(result) {
  if (!result || result.ok !== false || result.removed) return null;   // removed: the person took it out of the queue
  const text = String(result.error || result.text || '').replace(/^⚠️\s*/, '').trim();
  return text ? {text, credit: !!result.credit, allowance: !!result.allowance} : null;
}

// The pop-up's button for a refusal the Plan page fixes (Settings → Plan: Add credit, or the plans after the trial).
export const refusalAction = why => (why?.credit ? 'Add credit' : why?.allowance ? 'See plans' : '');
