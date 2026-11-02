// The e2e step running now, so an AI ask the stand-in refuses names the step that made it (lib/runner.mjs sets it; lib/ai-answers.mjs refusal reads it).
// Why (2 Nov 2026, owner: "A: remove exact matching", an unlabelled ask "fails loudly naming its step"): a refusal named only the suite, and the red step was guessed from timing.
// Job: serve stored answers
let current = '';

/** Record the step that starts now; a suite runs one step at a time, so the last one set is the one asking. */
export function setStep(name) { current = String(name || ''); }

/** The step running now, or '' before the first one and outside the e2e runner (integration tests). */
export function stepNow() { return current; }
