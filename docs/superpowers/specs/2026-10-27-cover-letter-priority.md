# Cover letter setup is important

Owner requirement: setup creates a cover letter through the existing draft and explicit approval flow. A missing usable letter is one HIGH PRIORITY action in Application questions and is visible in the application panel even for optional employer fields.

## State owner and invariants

`desktop/lib/letter-availability.js` derives availability from the existing base-letter and job-letter records. It owns selection, reason and action. States: missing (create), draft (review/approve), invalid (complete placeholders), unavailable (rebuild missing PDF), ready (usable tailored wins, then approved usable base fallback). Old `letterFallback` values are ignored at read time; no settings migration is written. PDF and text come from the same selected record. No new persisted state or second source of truth. Failed/pending generation leaves the existing missing/draft gap until explicit approval. No auto-approval. Existing written form values and explicit kit text retain precedence.

Wizard moves the existing base-letter editor into a new step after strategy save; its current Draft with AI / Write my own / Approve flow remains intact. Owner follow-up on 27 Oct 2026 requested a new PR addressing every Gitar finding, including its setup-cost concern. For this follow-up, entering the step never starts model generation; the person chooses Draft with AI, which fills the same textbox, then explicitly reviews and approves it. This supersedes the original 27 Oct clarification to start a draft on entry. Saved drafts, approved letters and edits are never replaced. Skip or generation failure leaves the derived queue action outstanding. Queue deduplicates by fixed setup key, ranks above form questions and opens the same editor, rather than saving a fake answer. Extension receives text, file and public status from one selection. Blank supported textareas get the selected text; absence is visible independently of employer requiredness. The panel action opens the letter settings. General missing setup stays in the queue, while per-form readiness is gated only when a supported letter control is actually present. A form without a letter field can be ready. Tailoring redraw preserves the observed letter. No consent or Submit changes.

## Data ownership

Existing records/preferences retain their existing owners. Queue and panel state are derived, never stored. No schema or store adapter addition.

## Progress

### 1. Missing cover letter
- [x] Regression fails for wizard, queue, delivery and optional textarea/panel scenario. (proof: desktop/test/letter-priority.test.js, worker/test/cover-letter-priority.test.js)
- [x] Implement shared availability and existing editor reuse; focused tests pass. (proof: desktop/test/cover-letter.test.js, desktop/test/letter-applying.test.js, desktop/test/wizard-letter.test.js)
- [x] Fictional demo preview inspected. (proof: none: local fictional wizard/editor renders inspected; PR preview retains images)
- [x] Independent review checks the owner's scenario and opposite assertions. (proof: worker/test/cover-letter-priority.test.js)
- [x] PR #2304 merged with current-head checks green. (proof: none: GitHub merge and check state is external evidence; owner merged #2304)

The frozen wizard integration source is session32 commit `be1f04cc9ca4af723cb3bf2bc0a7823d0eafd46f`; the owner recorded session32's authorship and same-PR authorization in [the PR comment](https://github.com/GarryOne/jobadabra/pull/2304#issuecomment-6449530151). Local e2e execution is explicitly excluded by the owner; CI verified prefill → explicit approval → PDF → continue on #2304.

### 2. Gitar review follow-up
- [x] The six product and test findings closed by Gitar are present in merged #2304 and covered by focused regression tests. (proof: desktop/test/letter-priority.test.js @262a7ed, desktop/test/letter-applying.test.js @262a7ed, desktop/e2e/lib/wizard.mjs @3146cea)
- [x] Regression fails on the old auto-draft entry and proves opening the step makes zero draft calls before the person clicks Draft with AI. (proof: desktop/test/wizard-letter.test.js)
- [x] Wizard generation starts only after the existing Draft with AI action; fake-AI test still verifies explicit approval. (proof: desktop/test/wizard-letter.test.js)
- [x] Session32 updates the frozen e2e wizard helper to make the same explicit action. (proof: desktop/e2e/lib/wizard.mjs, desktop/test/harness-wizard-letter.test.js)
- [ ] Follow-up PR passes current-head checks.

### 3. Automatic fallback and full-card draft state

Owner follow-up on 27 Oct 2026: remove the visible fallback checkbox and helper. A complete, approved base letter with its PDF is the automatic fallback when no complete tailored letter/PDF is usable; a usable tailored letter wins. Drafts, placeholders and missing PDFs are never delivered. Keep approval and PDF creation explicit. Treat old `letterFallback: false` and missing settings as the same automatic default at read time; do not write user profile/settings data.

Draft with AI / Redraft with AI remains explicit. While the one paid request is pending, show an accessible, card-contained loading treatment over the existing editor, preserve its text/focus, block clickthrough and stale PDF opening, and keep the layout fixed. Reduced motion gets a static glow. Success yields an unapproved draft with no PDF; failure keeps the previously approved letter/PDF and restores actions with an error. Opening the card never generates.

Approaches: a code-level automatic default that ignores legacy flag values (chosen; no migration write), and an absolute card overlay (chosen; keeps the editor and layout) over replacing the editor with a skeleton. Use existing Jobadabra tokens and fake AI responses only.

- [x] Regression covers absent and legacy false settings, tailored precedence, and rejection of unapproved/incomplete base letters. (proof: desktop/test/letter-fallback.test.js, desktop/test/cover-letter.test.js, desktop/test/job-letter.test.js, desktop/test/journeys-letter-fallback.test.js)
- [x] Fake-renderer regression covers explicit one-call generation, full-card busy/status, stable text/focus, and success/error cleanup while preserving a failed redraft's approved PDF. (proof: desktop/test/base-letter.test.js)
- [x] Fictional card shots inspected in normal light/dark, narrow light, and narrow dark states plus a representative loading frame. (proof: none: rendered captures are hosted under PR asset tag `pr-assets-d19-base-letter-visuals` and linked in the PR screenshot table.)
- [x] Reduced-motion preference uses a static treatment. (proof: desktop/test/base-letter.test.js, desktop/renderer/style.css)
- [ ] Focused tests, changed-JS lint, and complete fast gate pass; PR assets and current-head checks are monitored through owner merge.
