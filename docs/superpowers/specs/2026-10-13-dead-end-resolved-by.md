# A dead end's resolution: who moved the page on, and with which move

**Status: deferred until installs exist (owner, 13 Oct 2026).** The CI pool has no person and starts no takeover, so none of the three steps gives data before real installs report; the design below is kept as it was agreed. Nothing here is on the one-next-move list.

Owner, 13 Oct 2026: the dead-end resolution is **one more field on fill-ladder's door record**, not a separate store. Direction OK'd by the owner (cc's relay, 13 Oct): one record in the log, joined by door, no store.
Agreed with job-pilotto-fill-ladder (13 Oct): the record is today a log line, `decide('fill', 'dead end: <why>', {host, ending, named, door, …evidenceOf})` (`extension/ladder/dead-end.js`); fill-ladder adds `level` ('control' | page) in its own PR (5th in its queue, not built). `resolved` is one more optional key, owned here; nothing in its record says who moved the page on.

## Box 7 is split: this spec covers one of its three sources
Box 7 of `2026-10-12-one-next-move.md` ("the dead-end fixtures' moves from the other sources", line 229) names three. Measured 13 Oct (job-pilotto-78, offline):
| source | state |
|---|---|
| a replay's confirmed press | **parked.** Recorded replays run on a stand-in app that writes no log of the pressed label; 80 of 90 cases are hand-cut. A replay emitter is possible (recorded-pages writes {case, pressed label, next page kind}) but its "confirmed" is weaker than the pool's; the pool source grows with every run. Not built. |
| the row-to-case cases of dead-end rows | **closed at 0.** The 10 captured cases are form-field shapes, none is a posting-to-form press; real dead-end rows are already the pool source. |
| a person's / the takeover's resolution | **this spec.** |
On landing, box 7 becomes three boxes (pool: ticked; replay: parked with its reason; resolution: this spec's), and only what a test proves is ticked.

## The field
`resolved: {by, verb, role, form}`: fixed values only, no page words.
| key | values |
|---|---|
| `by` | `person` · `takeover` |
| `verb` | `press` · `fill` · `choose` (the digest's verbs) |
| `role` | the pressed control's kind from the sketch's own fixed list (`button`, `link`, `submit`, `text`, `select`…), never its label |
| `form` | `true`: the page after the move shows a form or new fields (the pool's rule: confirmed only if a form followed) |
The digest's candidate number is **not** in the cross-install record: it is a position in one page's list and means nothing across installs (cc). It may stay on the local line for joining one page's own stop to the move (`-1`: the control was not listed, the `not_listed` label of #583).

## Where it lives
- **A stop is written at the stop; the resolution comes later.** One logical record, two physical lines joined by `door`: the stop line stays as it is; a later line `dead end resolved {door, by, verb, role, form}`. Readers (`desktop/e2e/lib/pool-shadow.mjs`, the move labeller) merge them by `door`, as `desktop/e2e/lib/pool-shadow.mjs` already joins the shadow question.
- **Log only, like the door record.** No store, no adapter, no schema. (If fill-ladder's record is stored later, `resolved` rides along, through every adapter then.)
- `RESOLVED_KEYS`, a fixed-values check and a guard test like `worker/test/dead-end.test.js` (a caller's keys must be listed; no page word can reach the line).

## How each source is observed, and what it yields (measured, not assumed)
- **takeover:** `rung5-takeover.js` starts only on the person's "Continue" or the visible countdown. **A CI pool run starts none**: 0 mentions of a takeover in the 47 app logs of the 13 Oct pool runs (no consent in the harness). So PR 1 yields **no real takeover fixture from the pool**: only a test with a synthetic resolution. Real takeover resolutions exist only on real installs.
- **person (owner OK'd 13 Oct 2026, on these conditions):** a capture-phase click listener on a dead-end tab that records ONLY the pressed control's `role` and its position (never its label), then the next read says whether a form followed. The one flow-core touch (`FLOW_CORE`): the invariants block read first, a journey scenario.
  - it only listens: never presses, blocks or changes anything (no `preventDefault`, no `stopPropagation`);
  - only on a tab at a recorded dead end (a door id exists); removed when the tab moves on or closes;
  - a guard test fails if any label, text, URL or value can reach the line.
- **Both of the above come from installs, so they are counts, not fixtures:** the CI pool has neither a person nor a takeover. They travel through the existing learned-counts path: `desktop/lib/ladder/learning.js` `counts()` → `desktop/lib/recipes.js` `createReporter` (the `ladder` map of the token-gated batch, fixed lists and integers).
  - **Key:** `why` + `verb` + `role` + `by`: what holds everywhere. The value is `{n, form}`.
  - **Never** the shape, the candidate number or a page word.
  - The site aggregates with k>=3 only when it is built (below).

## Build order (each its own PR, no spend, no live run)
1. **Record:** `resolved` keys, the `dead end resolved` line, the guard test, the reader merge in `desktop/e2e/lib/pool-shadow.mjs`; after fill-ladder's door PR lands (or its key list is sent to it). Tested on a synthetic resolution; yields no real fixture, as above.
2. **Person observer (owner OK'd 13 Oct 2026, with the conditions above):** the flow-core touch, recording role and position only; a journey scenario.
3. **Counts:** the counts map in `learning.js` / `recipes.js` for what step 1-2 log. **The site aggregation is out of this spec** until person resolutions exist in numbers (a separate spec then).

## Progress
- [ ] `resolved` on the door record: keys, line, guard test, reader merge, a synthetic resolution (proof: a test; no real takeover fixture is claimed)
- [ ] the person's press observed (role and position, never the label); the owner OK'd the flow-core touch on 13 Oct 2026 with the conditions above (proof: a journey scenario and the guard test)
- [ ] the resolution counts keyed on why + verb + role + by through `learning.js` / `recipes.js` (proof: a test; the site side is not in this spec)
