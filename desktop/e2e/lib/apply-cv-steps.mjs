// The apply suite's tailored-CV steps (moved out of suites/apply.mjs, 8 Oct 2026): none are left in e2e. Guards the CV flow in docs/flows/applying.md through the integration tests named below.
// Job: wait on state
// Why (1 Nov 2026, owner: "Only tier 1 … should stay e2e"): the two Tailor steps (Tailor CV on a job, Tailor on the session page; night journey J8, Tier 2) are integration tests now:
// desktop/integration/store/tailored-cv.test.mjs (what the app hands the form, the restart) and integration/extension/extension-form-shapes.test.mjs (the extension attaches it).
// Why (1 Nov 2026, same ask): "Tailor CVs for top matches" (the bulk Tailor, J8) is desktop/integration/store/tailor-top-matches.test.mjs: the real store lists the jobs, the picker takes the best N without a CV.
// Why (1 Nov 2026, R3): "Apply on a saved job without a kit" (Retry apply when the kit cannot be drafted) is integration/app/screen-apply.test.js.
// TODO(AI): no step is left here: delete this file, the 'cv' part and its call in suites/apply.mjs, and re-point the tests that read it (import-graph, step-slices, fill-attempt) (1 Nov 2026).

export async function runCvSteps() {}
