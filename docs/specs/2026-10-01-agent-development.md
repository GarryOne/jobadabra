# Consistent verification and testable desktop boundaries

Implement the agreed priorities 1–3: one agent-independent verification command, lifecycle callbacks extracted from main.js, and checked session IPC contracts.

- `tools/check.sh` selects Python 3.12+ and Node 22.13+ (or supported Node 24+) and delegates to a portable Python runner. Full mode checks Python, Worker, site and desktop; area mode runs the same checks used by each CI job; fast mode performs desktop lint/staging and focused lifecycle/IPC tests. No automatic dependency installation or live service requests. Explicit failures explain how to reproduce and fix setup problems.
- `desktop/lib/lifecycle.js` owns single-instance, startup/activation, window-close, quit and terminal shutdown callbacks. Dependencies are injected. Startup initialization stays in main.js as a callback. Existing behavior and dialogs are preserved; tests import the real module rather than slicing source.
- `desktop/lib/session-contracts.js` describes arguments and responses of the session IPC channels. Main-process registration validates input before side effects and output before returning. Errors identify channel/direction/field, never payload values. Public session updates use the same shape check. IPC name coverage remains tested.
- Local hooks and CI call the shared runner. Docs explain fast/full commands and the validated boundary.

## Data ownership

No new user data, storage, Notion columns or editable local copies. Contracts describe transient data; diagnostic errors contain field names only. Existing Notion-first behavior and user submission decisions remain unchanged.

## Validation

Real-module tests cover quit/cancel/wait/shutdown, first/second instance, activation and non-Mac window close. Contract tests cover malformed arguments, invalid results, async failures, privacy of errors and real/demo session shapes. Runner tests cover runtime selection, commands and error propagation. Full verification, clean desktop dependency install and a demo smoke run before landing.

## Implemented contract boundary

All 14 session IPC channels in preload are checked: listing, output/transcript/snapshot, terminal write/resize/stop/remove, resume/cancel/restart/finish/submitted, and startup reconciliation. IDs are nonempty strings; dimensions are positive integers; response objects are checked before they reach the renderer. The public session status set is running/input/done/ended/failed; "done" continues to mean filled for user review, never employer submission. Optional legacy display fields are normalized to empty strings in terminal public views. Unknown object fields are permitted for additive evolution. This is runtime checking, so actual subprocess/service data is checked; other IPC families remain incremental follow-up work.

## Operating notes

`JOBADABRA_CHECK_PYTHON` and `JOBADABRA_CHECK_NODE` can select explicit supported executable paths. Node candidates include PATH and NVM installations; Python candidates include the standard versioned commands. Full verification runs Python 3.12+ with mail/notion/telegram/google_jobs disabled, then Worker, site and desktop npm tests. Fast desktop checks deliberately do not replace the full suites. `--clean-install` verifies lockfiles in disposable folders with install scripts disabled, without changing shared worktree node_modules. Demo smoke testing uses fictional data, not live user services.
