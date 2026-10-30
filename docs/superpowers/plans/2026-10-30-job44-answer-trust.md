# JOB-44 — stored AI answer trust, two slices

Agreed design: keep semantic question keys and approve a data-free instruction hash
per family. A source instruction change refuses stored answers before caches or
transports and leaves a deterministic metadata-only miss for the suite ceiling.
Re-stamping accepts existing answers under new instructions; it does not establish
that those answers are correct. Replay never stamps automatically.

1. **Fixed-system families (merged as #2606).** Capture current real offline senders for
   app.decide, app.place, app.places, app.geo, app.title (sort/recheck), app.visit
   (keep/leave), app.visa, app.placeVague, and app.placeReading. Canonical hashes
   include literal framing and full schema descriptions, excluding data and
   transport settings. Stamp nine families with an offline command. Test real
   sender edits, both providers, variants, schema changes, noise, refusals before
   cache/transport, deterministic stamping and one counted miss on retry.
2. **Mixed instruction/data families (slice 2).** Capture template boundaries for
   app.score, app.interview, app.enrich and mail, including retry schemas and
   auxiliary fixed instructions. Stamp all four without hashing assembled
   persona, posting, CV, transcript or mail text.

## Progress

### 1. Fixed-system families
- [x] Instruction capture, stamping and stale refusal (proof: desktop/e2e/test/ai-answer-prompts.test.mjs)
- [x] PR checks green and Gitar Approved (merged as #2606, 773f483)

### 2. Mixed instruction/data families
- [x] Capture boundaries, stamp and verify the four remaining families (proof: desktop/e2e/test/ai-answer-prompts.test.mjs — real sender and auxiliary instruction edits, data-only stability, both providers, retry schemas, one counted miss, zero cache/transport calls)
