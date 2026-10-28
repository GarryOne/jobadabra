// Proactive, once (owner, 18 Oct 2026: "be proactive"): right after setup the review drawer opens on the first missing fact (lib/missing-facts.js), so a fresh
// install is asked the most important one at once; the Jobs card keeps counting the rest. Nothing missing, or already offered: nothing opens. Guarded by test/missing-facts-open.test.js.

export const firstMissing = list => (list || []).find(each => each.details?.kind === 'missing');   // list: Fill your details' items (questionsNow().details)

/** Opens Fill your details once after setup on its first missing fact; -> true when it opened, false when already offered or nothing is missing. open: the drawer opener (tests pass their own). */
export async function openOnceAfterSetup({open = key => import('./question-review.js').then(review => review.openQuestionReview({queue: 'details', start: key}))} = {}) {
  const {shared} = await import('./shared.js'), {loadQuestions, questionsNow} = await import('./jobs-questions.js');   // read when used: the pure part above is tested without a window
  if (shared.state.settings.missingFactsOffered) return false;
  await loadQuestions({force: true});
  const first = firstMissing(questionsNow().details);
  if (!first) return false;
  shared.state.settings = await window.pilot.saveSettings({missingFactsOffered: true});
  await open(first.key);
  return true;
}
