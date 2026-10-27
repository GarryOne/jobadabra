# Base letter default and draft loading implementation plan

> **For agentic workers:** Implement in this task worktree, using the existing project workflow. Keep the change bounded to the Profile cover-letter card and its existing delivery path.

Canonical spec: [2026-10-27-cover-letter-priority.md](../specs/2026-10-27-cover-letter-priority.md), section 3.

## Files and responsibilities

- `desktop/lib/cover-letter.js`: compatibility default for fallback eligibility.
- `desktop/lib/letter-availability.js`: tailored-first availability and approved-base status copy.
- `desktop/renderer/pages/letter-fallback.js`: remove obsolete setting behavior.
- `desktop/renderer/pages/base-letter.js`, `desktop/renderer/index.html`, and `desktop/renderer/style.css`: remove checkbox markup and add card-level busy/status treatment.
- `desktop/test/letter-fallback.test.js`, `desktop/test/cover-letter.test.js`, `desktop/test/job-letter.test.js`, `desktop/test/journeys-letter-fallback.test.js`, and `desktop/test/base-letter.test.js`: assert compatibility, delivery precedence, and explicit drafting state behavior.
- `desktop/docs/ui/` plus PR body assets: fictional visual evidence only.

## Bounded tasks

1. Write focused failing tests for the legacy false/absent fallback behavior, tailored precedence, and rejection of unapproved or incomplete base letters. Run only the affected test files.
2. Add the read-time default and remove checkbox/helper copy while retaining explicit approval and PDF validation.
3. Add failing renderer tests for one request, card-wide busy/status/pointer blocking, stable text/focus during the request, restoration after failure, and draft state after success. Use a faithful fake `window.pilot.coverLetterDraft`; never call a real model.
4. Implement the positioned overlay and reliably clear busy in `finally`; keep status and error recovery accessible. Add restrained token-based glow/sparkle styling with reduced-motion fallback.
5. Run changed test files, lint every changed JS/MJS file, and the complete fast gate in this worktree. Capture and inspect fictional normal, narrow, light, dark, and representative loading frames. Check status/error and existing approved PDF behavior.
6. Use the regular `tools/ship.sh` PR path, register its exact log, then monitor the current head through owner merge. Do not touch frozen ship/e2e/workflow files or wait for PR #2315.
