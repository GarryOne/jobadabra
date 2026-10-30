# JOB-44 — stored AI answer trust, two slices

Agreed design: keep semantic question keys and approve a data-free instruction hash
per family. A source instruction change refuses stored answers before caches or
transports and leaves a deterministic metadata-only miss for the suite ceiling.
Re-stamping accepts existing answers under new instructions; it does not establish
that those answers are correct. Replay never stamps automatically.

1. **Fixed-system families (this PR).** Capture current real offline senders for
   app.decide, app.place, app.places, app.geo, app.title (sort/recheck), app.visit
   (keep/leave), app.visa, app.placeVague, and app.placeReading. Canonical hashes
   include literal framing and full schema descriptions, excluding data and
   transport settings. Stamp nine families with an offline command. Test real
   sender edits, both providers, variants, schema changes, noise, refusals before
   cache/transport, deterministic stamping and one counted miss on retry.
2. **Mixed instruction/data families (next PR).** Capture template boundaries for
   app.score, app.interview, app.enrich and mail. They remain unstamped and keep
   existing replay behavior in slice 1. Do not hash assembled persona/posting text.

## Progress

### 1. Fixed-system families
- [x] Instruction capture, stamping and stale refusal (proof: desktop/e2e/test/ai-answer-prompts.test.mjs)
- [ ] PR checks green and Gitar Approved

### 2. Mixed instruction/data families
- [ ] Capture boundaries, stamp and verify the four remaining families
