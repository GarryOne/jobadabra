# Cover letter setup is important

Owner requirement: setup creates a cover letter through the existing draft and explicit approval flow. A missing usable letter is one HIGH PRIORITY action in Application questions and is visible in the application panel even for optional employer fields.

## State owner and invariants

`desktop/lib/letter-availability.js` derives availability from the existing base-letter and job-letter records and `letterFallback`. It owns selection, reason and action. States: missing (create), draft (review/approve), invalid (complete placeholders), disabled (set fallback preference or prepare a tailored letter), unavailable (rebuild missing PDF), ready (tailored wins, then explicitly enabled approved base). PDF and text come from the same selected record. No new persisted state or second source of truth. Failed/pending generation leaves the existing missing/draft gap until explicit approval. No auto-approval. Existing written form values and explicit kit text retain precedence.

Wizard moves the existing base-letter editor into a new step after strategy save; its current Draft with AI / Write my own / Approve flow remains intact. Entering the first empty letter starts the existing AI draft action (owner clarification, 27 Oct 2026); saved drafts, approved letters and edits are never replaced. Skip or generation failure leaves the derived queue action outstanding. Queue deduplicates by fixed setup key, ranks above form questions and opens the same editor, rather than saving a fake answer. Extension receives text, file and public status from one selection. Blank supported textareas get the selected text; absence is visible independently of employer requiredness. The panel action opens the letter settings. No consent or Submit changes.

## Data ownership

Existing records/preferences retain their existing owners. Queue and panel state are derived, never stored. No schema or store adapter addition.

## Progress

### 1. Missing cover letter
- [x] Regression fails for wizard, queue, delivery and optional textarea/panel scenario. (proof: desktop/test/letter-priority.test.js, worker/test/cover-letter-priority.test.js)
- [x] Implement shared availability and existing editor reuse; focused tests pass. (proof: desktop/test/cover-letter.test.js, desktop/test/letter-applying.test.js, desktop/test/wizard-letter.test.js)
- [x] Fictional demo preview inspected. (proof: none: local fictional wizard/editor renders inspected; PR preview retains images)
- [ ] Independent review checks the owner's scenario and opposite assertions.
- [ ] PR open with current-head checks green.
