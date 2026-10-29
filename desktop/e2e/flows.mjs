// The Applying flows' scenario matrix (docs/flows/applying.md): every scenario a session and the Chrome extension handle, and the e2e
// step or unit tests that guard it. A change to any FLOW_FILES file runs the WHOLE matrix (npm run flows), not only its own row, so a
// fix for one flow (account creation) can't quietly break another (the application form). On CI the steps run with every e2e (no push gate since 9 Oct 2026).
// Job: pick the suites
import crypto from 'node:crypto';

// The code the flows run on. A file added for a flow goes here too (test/flows-matrix.test.js).
export const FLOW_FILES = [
  'extension/fill-tab-inputs.js', 'extension/fill-tab-finish.js',
  'extension/background.js', 'extension/tab-pages.js', 'extension/same-tab.js', 'extension/review.js', 'extension/panel-form.js', 'extension/panel-markup.js', 'extension/panel-learn.js', 'extension/panel-written.js', 'extension/panel-files.js', 'extension/panel-overlay.js', 'extension/input-gap.js', 'extension/page/submit-press.js', 'extension/flow.js', 'extension/page-reads.js',
  'extension/tabs.js', 'extension/account.js', 'extension/account-step.js', 'extension/form-ready.js', 'extension/on-top.js', 'extension/next-step.js', 'extension/ladder/rung4-picture.js', 'extension/account-fill.js', 'extension/log.js', 'extension/tab-memory.js', 'extension/fill-flow.js', 'extension/fill-flow-read.js', 'extension/fill-flow-steps.js', 'extension/page-still.js', 'extension/early-answers.js', 'extension/apply-press.js', 'extension/start-route.js', 'extension/ladder/outcomes.js', 'extension/ladder/core.js',
  'extension/page-kind-final.js', 'extension/stop.js', 'extension/stop-state.js', 'extension/stop-messages.js', 'extension/settle-tabs.js', 'extension/panel-report.js', 'extension/messages-report.js', 'extension/messages-learning.js', 'extension/messages-panel.js', 'extension/messages-app.js', 'extension/submit-watch.js', 'extension/tab-report.js',
  'desktop/lib/review.js', 'desktop/lib/terminals.js', 'desktop/lib/application-journey.js', 'desktop/lib/journey-identity.js', 'extension/tab-identity.js', 'desktop/lib/apply.js', 'desktop/lib/session-handlers.js', 'desktop/lib/form-tab.js',
  'desktop/lib/session-flow.js', 'desktop/lib/ladder/rung1-kept.js', 'desktop/lib/ladder/rung2-sketch.js', 'desktop/lib/apply-handlers.js', 'desktop/lib/browser-handlers.js', 'desktop/lib/kit-handlers.js', 'desktop/lib/ext-server-handlers.js',
];

// The flows' decision core: which page is what and which tab belongs to which application. A change here can break another flow, so
// a big change here deserves the whole matrix (npm run flows, on demand). Any other flow file is checked with the best-fit method (owner, 8 Oct
// 2026: "let's not run it so often… the best fit one for every case"; AGENTS.md "Which test for which question").
export const FLOW_CORE = ['extension/fill-tab-inputs.js', 'extension/fill-tab-finish.js', 'extension/ladder/core.js', 'extension/ladder/outcomes.js', 'extension/tab-pages.js', 'extension/tabs.js', 'extension/same-tab.js', 'extension/account.js', 'extension/fill-flow.js', 'extension/fill-flow-read.js', 'extension/fill-flow-steps.js', 'extension/apply-press.js', 'extension/start-route.js',
  'desktop/lib/session-flow.js', 'desktop/lib/ladder/rung1-kept.js', 'desktop/lib/ladder/rung2-sketch.js', 'desktop/lib/review.js', 'desktop/lib/application-journey.js', 'desktop/lib/terminals.js', 'desktop/lib/journey-identity.js', 'extension/tab-identity.js'];

// The journey tests: the applying scenarios as event sequences (no browser, seconds). tools/journey-gate.mjs runs them on every push that touches a flow file.
export const JOURNEY_TESTS = ['test/journeys.test.js', 'test/application-journey.test.js', 'test/journey-identity.test.js', 'test/extension-tab-identity.test.js',
  'test/session-flow.test.js', 'test/account-check.test.js', 'test/flow-invariants.test.js'];

// One row per scenario. `e2e`: words of its step in desktop/e2e/suites/apply.mjs or lib/apply-*.mjs (E2E_STEPS); `unit`: desktop/test files.
export const MATRIX = [
  {scenario: 'What kind of page: the AI decides once per site and page shape, the structure rule only without AI', e2e: ['one page', 'wrong kind'], unit: ['test/page-kind.test.js', 'test/extension-tab-pages.test.js']},
  {scenario: 'Direct application form (Greenhouse, Workday, Lever, multi-step)', e2e: ['Greenhouse-like form', 'Workday-shaped form', 'Lever-like form', 'multi-step form'], unit: ['test/extension-tab-pages.test.js']},
  {scenario: 'Upload slots of any shape (input, hidden input, drop zone, + that creates the input): CV and cover letter by meaning, a miss reported by fingerprint', e2e: ['appears only when + is pressed'], unit: ['e2e/test/upload-slot.test.mjs']},
  {scenario: 'Posting → Apply link or form into a new tab → same tab, posted data kept', e2e: ['Apply opens a new tab'], unit: ['test/extension-same-tab.test.js']},
  {scenario: 'Apply opens its form from the page\'s script (`window.open`): opened in the same tab', e2e: ['side by side'], unit: ['test/extension-same-tab.test.js']},
  {scenario: 'A tab the person opens is the person\'s: it joins an application only through the extension\'s own press on its opener', e2e: [], unit: ['test/extension-tab-adoption.test.js']},
  {scenario: 'A page the AI judged \'other\' is never turned into the form by its fields', e2e: [], unit: ['test/page-kind-final.test.js']},
  {scenario: 'The person presses Stop (sessions page, ⌘K, the extension\'s popup or page button, Chrome\'s Cancel): nothing runs until they start it again', e2e: [], unit: ['test/extension-stop.test.js', 'test/stop-request.test.js', 'test/stop-everywhere.test.js']},
  {scenario: 'Two applications side by side: one tab and its own kit each', e2e: ['side by side'], unit: ['test/review.test.js']},
  {scenario: 'Sign-up page before the form: account step kept apart', e2e: ['sign-up page'], unit: ['test/extension-tab-pages.test.js', 'test/review.test.js', 'test/session-flow.test.js']},
  {scenario: 'Sign-in page before the form with a saved password: filled, pressed once, the form behind it filled; a refused sign-in never retried', e2e: ['sign-in page'], unit: []},
  {scenario: 'A menu whose choices are not the answer\'s words: the choice that means the same, then remembered per site', e2e: ['menu whose choices'], unit: ['test/option-pick.test.js', 'test/menu-choices.test.js']},
  {scenario: '"Needs your attention" from the extension\'s fill: a left field with its proposal and the form\'s choices; Use fills it', e2e: ['Needs your attention" from'], unit: ['test/need-proposal.test.js']},
  {scenario: 'Account and application on one page: it is the form', e2e: ['one page'], unit: ['test/extension-tab-pages.test.js']},
  {scenario: 'Form tab closed → the app sees it → Reopen fills it again', e2e: ['tab is closed'], unit: ['test/form-tab-closed.test.js', 'test/session-state.test.js']},
  {scenario: 'A second browser with the extension (another profile, a test Chrome): each browser\'s tabs kept apart, its report never closes another\'s form', e2e: ['second browser'], unit: ['test/tab-identity.test.js']},
  {scenario: 'Open in Chrome: the session\'s own tab by its id; two sessions on one form address never take each other\'s tab', e2e: [], unit: ['test/form-tab.test.js']},
  {scenario: 'Multi-step application: the next step is pressed, never a control that submits', e2e: [], unit: ['test/form-judge.test.js']},
  {scenario: 'The person submits → Applied, session leaves the list', e2e: ['person submits a form'], unit: []},
  {scenario: 'Claude takes over an account page; the unfilled tab closes', e2e: [], unit: ['test/apply-form-session.test.js', 'test/session-flow.test.js']},
  {scenario: 'Start-up "Checking…", then "Chrome isn\'t reporting"', e2e: [], unit: ['test/session-state.test.js']},
  {scenario: 'A control the fill could not settle opens a control-level door record; the row\'s page ending never reads it', e2e: [], unit: ['test/journeys.test.js']},
  {scenario: 'Never submits, never contacts another host', e2e: ['through all of it'], unit: []},
];

export const matrixSteps = () => [...new Set(MATRIX.flatMap(row => row.e2e))];
export const matrixUnits = () => [...new Set(MATRIX.flatMap(row => row.unit))];
// The flow files' content, as one short digest: a matrix pass counts only for exactly the code it ran on.
export function flowDigest(read) {
  const hash = crypto.createHash('sha256');
  for (const file of FLOW_FILES) hash.update(`${file}\0${read(file) ?? ''}\0`);
  return hash.digest('hex').slice(0, 16);
}
