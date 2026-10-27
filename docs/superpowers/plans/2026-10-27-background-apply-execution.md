# Plan: background Apply execution

Spec: [2026-10-27-background-apply-execution.md](../specs/2026-10-27-background-apply-execution.md)

## Bounded work

1. **Specify the integration contract** — inspect `desktop/lib/apply.js`, `apply-handlers.js`, session/report routes in `terminals.js` and `server.js`, extension tab/session ownership, extension page-state judgments, and Ready/night/live code. Canonical per-job persistence is an Applications section through every store adapter; terminal and extension records are caches.
2. **State machine first** — focused tests cover canonical mode dispatch, duplicate dispatch, terminal CAPTCHA handoff, and guarded auto-submit decisions through `background-apply-store.js` and `background-apply-controller.js`. Do not maintain a second pure policy disconnected from actual dispatch.
3. **Hidden execution** — use the existing app extension and its tab/session identity to start the same form flow in a non-visible browser window. Mode 2 ends in Ready/review. Mode 3 alone may request the existing extension-owned submit action after all gates are rechecked.
4. **Handoff and outcomes** — persist CAPTCHA/manual override per job; reveal the owned session without creating a new form; send an actionable notice; keep handoff alive. Confirm mode 3 through the existing submit/confirmation outcome route only. Unknown or incomplete states stay needs-user.
5. **Proof and integration** — run fictional browser-contract smoke through the real extension/session machinery (do not edit frozen `desktop/e2e` harness libraries); lint all changed JS, run only the affected focused tests and full fast gate. Send d17 the exact mode-capability/dispatch exports and integrate their reviewed Apply-dialog patch in this PR if their owner can deliver it without a serial prerequisite PR.

## Files expected to change

- New: `desktop/lib/background-apply-store.js`, `background-apply-controller.js`, `background-browser.js`, `background-browser-download.js`, `background-browser-handlers.js`; matching focused tests and the opt-in fictional `desktop/test/background-apply-browser.test.js`. Extension ownership and one-shot final action live in `extension/background-session.mjs`, `background-apply.js` and `background-submit.js` and reuse the real filler.
- Existing: `desktop/lib/apply.js`, `desktop/lib/apply-handlers.js`, `desktop/lib/terminals.js` or extension event/submit route, `extension/background.js` and the narrow hidden-tab/session module, relevant focused tests, and `CLAUDE.md`/`docs/apply-flow.md` safety wording after the behavior is implemented.
- Do not edit `.github/workflows`, `desktop/e2e` harness libraries, or `tools/ship*` (session 32 freeze).

## Dependencies and stop conditions

- d17 owns PR #2317 and will consume the final single-mode dispatch/capability API; send exact names once established. No prerequisite merge is required.
- If an existing approved hidden browser runtime cannot be used without copying the user's browser profile or bundling a large browser, stop before claiming hidden execution and report the concrete runtime blocker. Do not replace the extension with a second filler or a fake browser runner.
- Never run a real application or submit during implementation. No broad suites, paid AI, or manual production form interaction.

## Premise correction and next bounded step

Actual Chrome on macOS initially activates a minimized-created window. The no-focus browser regression remains red; later minimization is insufficient. Owner decision is pending on replacing native reveal with the existing Ready live view of the exact held headless page. Before dependent implementation: resolve that choice, then reuse `hosted/ready-fill/live.mjs` rather than write another input protocol/filler. A local viewer needs a sender-bound IPC adapter, runtime target ownership checks, human-only input, loading/error states and rendered approval before its visual commit. Keep the same live browser/page alive on app exit, and never treat reopening the viewer as permission to resume automation.

Independent safety work completed while that decision is pending: per-employer daily counting, persisted form-seen CAPTCHA phase classification, account-page handoff before credential automation, and recycled-tab protection on Cancel. Focused regressions pass. Final acceptance review, fast gate and PR remain outstanding.
