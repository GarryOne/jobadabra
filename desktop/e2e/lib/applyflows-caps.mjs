// Measured hang caps for applyflows' state waits, keyed by the exact step names.
// Job: wait on state
// Why (29 Oct 2026, a8, 21b): 3 x calm main p95 from the measuring tool tools/e2e-step-timings.mjs (applyflows, 14 runs) on 29 Oct 2026 (13 runs, 25 calm shard-runs), rounded up to 5 s with a 30 s noise floor; applicant setup keeps its measured 305 s cap.
// tools/e2e-step-timings.mjs --suite applyflows --runs 14; inline p95 values are seconds.
export const hangCaps = {
  "\"I submitted it\" marks the job Applied and takes its session off the list": 30,   // p95 4.80 s
  "\"Needs your attention\" from the extension's fill: the left menu is listed with its proposal and choices, and Use fills the form": 160,   // p95 52.40 s
  "a form drawn after a spinner: its submit is never pressed as Apply, and it is filled once its fields come": 175,   // p95 58.20 s
  "a form with collapsed sections: they are opened and the questions inside are filled": 260,   // p95 85.70 s
  "a menu whose choices are not the answer's words: the choice that means the same is picked, then remembered for the next form on the site": 185,   // p95 60.20 s
  "a posting whose Apply opens a new tab, then a \"To apply\" step, then the form: the journey is followed and the form filled": 185,   // p95 61.50 s
  "a second browser with the extension and no tabs: the form open in the first stays open": 285,   // p95 93.70 s
  "a sign-in page before the form that refuses the password: \"Sign in\" is pressed once, never again, and you are told; on the stuck sign-up page Take over with Claude only with Claude help on, never started": 215,   // p95 70.60 s
  "a sign-in page before the form: your email and saved password are filled, \"Sign in\" is pressed once, and the form behind it is filled": 190,   // p95 62.60 s
  "a sign-up page before the form: the account step is kept apart from the application form": 120,   // p95 38.40 s
  "an upload slot that appears only when + is pressed: the app's CV reaches it, the rest of the form is filled": 140,   // p95 45.60 s
  "the account and the application on one page: it is the application form, its passwords stay account fields": 180,   // p95 58.60 s
  "the AI gave a page the wrong kind: the page contradicts it, the kind is dropped and the form is filled": 190,   // p95 62.40 s
  "the app has an applicant, jobs with drafted kits for every fixture form, and an AI that answers only what the kits do not": 305,   // p95 100.50 s
  "the app is seeded as a set-up install from the existing workspace": 60,   // p95 19.30 s
  "the app is set up on this Mac's store with the applicant's strategy": 35,   // p95 10.50 s
  "the form tab is closed: the app sees it and Reopen opens the form again, filled, for the same session": 90,   // p95 30.00 s
  "the Notion stand-in answered every request the app made": 30,   // p95 0.60 s
  "through all of it: Submit was never clicked or submitted, and no host but the fixture job sites was contacted": 55,   // p95 18.30 s
  "two applications side by side, one whose Apply opens its form from script: each keeps one tab and its own kit": 250,   // p95 83.30 s
};
