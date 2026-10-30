# JOB-45 — stored AI answer drift

Owner-approved three-PR split, 30 Oct 2026. This records the supplied decisions; it adds no new scope.

## PR sequence

| Slice | Work | State |
|---|---|---|
| 1/3 | Subscription broker cap and `drift` lane in private `jobadabra-web` | Prerequisite reported complete by the supervisor |
| 2/3 | Linked request file, offline sample and comparer | Merged as #2607 |
| 3/3 | Isolated nightly live check, rate history, artifacts and deduplicated issue | This PR |

## Owner's decisions (30 Oct 2026; exact)

1. Each night ask the real model 20 linked prompts + up to 4 judge calls (24 total), on the Codex subscription only (never a paid API, never a fallback).
2. On drift: a rate with a bar, like qualityai. Warning only for the first 5 nights (warm-up), then the nightly check goes red when a bar breaks; a red that lasts (2 nights in a row) opens or updates ONE deduplicated GitHub issue listing the changed answers. Never blocks a PR or a beta; never rewrites a stored answer.
3. The 24-a-day cap is enforced by the broker (PR 1/3 in jobadabra-web adds lane `drift` for the workflow file `.github/workflows/ai-answer-drift.yml`); this job also stops itself at 24 and treats a broker 429 as "incomplete", never as healthy evidence.

## Verification and handoff

Use fake brokers only for implementation verification. The live path requires GitHub OIDC and pins Codex. Every broker attempt consumes the local cap; refusals stop the night. At most four prose judgments contribute evidence; remaining prose stays unjudged.

History keeps immutable run evidence and resets changed prompt fingerprints by source location. Bars borrow qualityai's exact agreement over ten fact nights (99.5%, at least five nights) and judged-different over about ninety texts (10%). The nightly workflow alone can fail and maintain the fixed-title issue after consecutive red UTC dates.

Workflow reports live in JSON/Markdown artifacts. History is cached and saved on main only. No PR/beta gate and no stored answer write is added. The owner reviews and merges the PR by hand.

## Progress

- [x] 1/3 broker cap and lane prerequisite reported complete for the authorized ship (proof: none: private-repo implementation, supervisor lifted the hold).
- [x] 2/3 request references and offline comparer merged (proof: desktop/e2e/lib/answer-drift.mjs @58be538).
- [x] 3/3 implementation and fake-only verification complete (proof: desktop/e2e/test/answer-drift-nightly.test.mjs).
- [ ] 3/3 PR green, Gitar approved and READY for the owner.
