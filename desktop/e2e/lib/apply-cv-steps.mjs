// The apply suite's tailored-CV steps (moved out of suites/apply.mjs, 8 Oct 2026): none are left in e2e. Guards the CV flow in docs/flows/applying.md through the integration tests named below.
// Job: wait on state
// Why (1 Nov 2026, owner: "Only tier 1 … should stay e2e"): no step of this file is a Tier 1 journey, so each is an integration test now. Tailor CV on a job and Tailor on the session page (J8):
// integration/store/tailored-cv.test.mjs (what the app hands the form, the restart) and integration/extension/extension-form-shapes.test.mjs (the extension attaches it). Tailor CVs for top matches (J8):
// integration/store/tailor-top-matches.test.mjs (the real store lists the jobs, the picker takes the best N). Apply on a saved job without a kit (Retry apply): integration/app/screen-apply.test.js.
// TODO(AI): no step is left here: delete this file, the 'cv' part and its call in suites/apply.mjs, and re-point the tests that read it (import-graph, step-slices, fill-attempt) (1 Nov 2026).

/**
 * The apply suite's tailored-CV part, which runs after its form steps. It takes the suite's context and helpers and ignores both: no step is left, so it reads and writes nothing and cannot fail.
 * @returns {Promise<void>}
 */
export async function runCvSteps() {}
