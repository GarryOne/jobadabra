# The ladder: which rung decides what, and where a site fix belongs

**Verdict (5 s):** a page decision climbs from the cheapest rung to the next only when unsure. **Fix a site at the lowest rung where the information exists, and fix it as data
(a kept answer, a recipe, a prompt example) before code.** Never fix a site in a higher rung than needed, never in a rung that already answered right.
Spec: `docs/superpowers/specs/2026-10-10-ai-ladder.md` (checklist = what is built). Applying flows: `docs/flows/applying.md`. Skill for the work: `.claude/skills/fix-recorded-sites/SKILL.md`.

## The rungs
| Rung | What | Owner (file) | Fixed answers | Built |
|---|---|---|---|---|
| 0 | structure rule | `extension/tab-pages.js` `pageRole` | `form` · `account` · `no-form` | yes: answers only without AI |
| 1 | kept answer per page shape | `desktop/lib/ladder/rung1-kept.js` `pageKindCache`, `kindKey` | the kept `kind` (+ buttons) | yes |
| 2 | text sketch to a small model (three questions: the page kind, the account judge, the form judge) | `desktop/lib/ladder/rung2-sketch.js` `pageKind`; `account-judge.js`; `form-judge.js` | `KINDS`, `APPLY_BY`, `ROUTES`, `account_step`, `bot_check` | yes |
| 3 | numbered digest | `desktop/lib/ladder/rung3-digest.js`, `extension/ladder/rung3-candidates.js`, `extension/ladder/rung3-frames.js` | outcome + closed verb + candidate numbers | yes: page outcomes; the fill's control digest: asked and scored offline (`desktop/lib/ladder/fill-repair.js`, `fr-*` fixtures), acting next (fill ladder PR C2) |
| 4 | screenshot + sketch, strongest model, one action | `desktop/lib/ladder/rung4-picture.js`, `extension/ladder/rung4-picture.js` | one action from the page's own controls | yes: accounts; forms when a fill put nothing in |
| 5 | Claude takes over | `desktop/lib/ladder/rung5-takeover.js`, `extension/panel-claude.js` | none (a session) | yes: once per application |
| 6 | the person | cards (`renderer/`), `application-journey.js` `stuck` | the sentence quoted from the page | yes: generic text; quoted for email only |

**The fill stage climbs the same rungs** (spec `docs/superpowers/specs/2026-10-12-fill-ladder.md`): `fill_verify` (did each control take its value? `desktop/lib/ladder/fill-verify.js`, `fv-*`) and `fill_repair` (a closed verb on a numbered control, `desktop/lib/ladder/fill-repair.js`, `fr-*`); both see the kind of value the fill gave each control (`extension/page/value-class.js`), never the value; measured by the widget zoo (`desktop/e2e/widget-zoo/`, `npm run widget-zoo` in `desktop/e2e`, CI job `widget-zoo`, not required).

The router (which rung to ask next, from a rung's signal): `extension/ladder/core.js` (`RUNGS`, `SIGNALS`, `nextRung`, `ladderLine`); the climb that uses it is extension/ladder/climb.js (landing on branch ai-ladder).

**What a page confirmed is learned per shape** (`desktop/lib/ladder/learning.js`): a rung 3+ answer is kept (the next visit's answer, `by: learned`, one miss drops it); the fast tier's (0-2: Apply pressed → a form came, a form took the fill) is only counted. Fed by real use, the CI pool (`desktop/e2e/pool-moves.mjs`) and the recorded replays on main, each marked (`user` / `ci` / `replay`) in the site's `ladder_moves` (in the private site repo, jobadabra-web); the owner reads `GET /api/ladder-moves`). Spec: `docs/superpowers/specs/2026-10-12-one-next-move.md`.

The sketch every rung reads is one list: `SKETCH_FIELDS` in `desktop/lib/ladder/rung2-sketch.js` (extension builds it in `page-reads.js` `pageSketchOf` + `extension/ladder/outcomes.js` `mailsOf`).

## Where a fix lives (owner, 12 Oct 2026)
| What went wrong | Its home | Never |
|---|---|---|
| A wrong decision: which button, which route, what kind, when to stop | **data**: a ladder fixture + prompt example, or a learned move | a new branch in the flow |
| A field not read, a control that cannot be worked | universal **code**, with a zoo or recorded page | a site name or a word list |
| Wording | **pack data** (aliases, meanings) | a regex in a rung |
| Safety | **code** (the floors) | data that can switch it off |

Today's working code stays as the **fast tier**. A dead end gets the **one escalating fallback** (sketch → digest → picture → Claude → the person), asked at the one
dead-end door (`extension/ladder/dead-end.js`), in shadow first, then **switched on per dead end** once its own numbers hold (owner, 13 Oct 2026).
Spec: `docs/superpowers/specs/2026-10-12-one-next-move.md`.

## What may change when you fix one site
| You may | You may not |
|---|---|
| Add a kept answer / recipe / alias / prompt example (data) | Add a site name, a vendor list, a word list or a regex to any rung |
| Teach rung N's prompt a **shape** (with a fixture) | Make a higher rung do what rung N can see |
| Add a fixture + stored answer + baseline line (with a reason) | Edit a fixture's expectation to make a failing one pass |
| Add a signal or a log line saying which rung decided | Let a rung read another rung's internals |
| Raise a cap only with the owner's say-so | Skip a rung that is off or capped; press Submit; pass a bot check |

Floors never move: never Submit, never a consent on an application, never a bot check or SMS code, never read a password field, one press per control per tab,
no AI = nothing pressed. A rung's answer is accepted only when it is one of the fixed answers and names something the page itself shows.

## How a change is judged (the safety net)
| Layer | What | Run |
|---|---|---|
| Fixtures | 120+ page sketches (real captures, recorded pages, reconstructed, invented, traps) with expected outcome and the model's stored answer | `desktop/e2e/ladder-fixtures/` |
| Score | per fixture expected vs got, rung that decides, rates **per source** (never blended), the wrong-and-confident list | `cd desktop && npm run ladder-score` (live, plan path) · `-- --offline` (stored answers) |
| Ratchet | no fixture may get worse than `desktop/e2e/ladder-baseline.json` | `desktop/test/ladder-ratchet.test.js` (runs offline in seconds; `tools/ladder-gate.mjs` on a flow push) |
| Recorded pages | a fixed site replayed with the real extension | `cd desktop/e2e && npm run recorded` |
| Real extension | the extension alone on a real form | `cd desktop/e2e && npm run real-extension` |

| Prompt fingerprint | a hash of every model-facing prompt and schema (rung 2, 3, 4, account judge, form judge) in the baseline: the gate replays STORED answers, so only the hash sees a changed prompt | `desktop/e2e/lib/ladder-fingerprint.mjs`, `desktop/test/ladder-fingerprint.test.js` |

**A prompt or schema changed** (the gate says "the prompt of rung N changed"): re-run `npm run ladder-score` live (plan path), `--record` the changed answers, then `--offline --update-baseline "<why>"` (it rewrites the fingerprints too).

**Read a re-record's jump against the spread** (`desktop/e2e/ladder-spread.json`, 3 draws per fixture, measured by `npm run ladder-score -- --spread [--only <id>]` on the prompt fingerprint it records): the score labels a fixture that flips "noisy (k/3)" and says "of the N new wrong-confident, M are known to flip". A jump made only of known-noisy fixtures is noise; a jump on a steady fixture is real. Re-measure after a big prompt change or a new fixture (an older fingerprint's spread is shown as "from the previous prompt"). The ratchet gate is unchanged.

**A live capture lists frame candidates as the app sees them:** `desktop/e2e/ladder-capture.mjs` on a `capture.url` with another host's iframe waits (≤ 20 s) for one to pass the frame finder's floor and writes `sketch.frameCandidates` with the extension's own code (`extension/ladder/rung3-frames.js` + `extension/ladder/climb.js` frameSketch); `capture.frame.qualified: false` is a finding, not a pass. An offline page has no CSS: only a live load proves a frame (guard: `desktop/e2e/test/filling/ladder-capture-frames.test.mjs`).

**Auto-capture of the pool run's failures:** `node desktop/e2e/ladder-capture.mjs --from-candidates [--only <shape>]` turns the replay candidates that did NOT reach the form (`~/Library/Application Support/Job Pilotto QA/replay-candidates/<day>/<shape>/`, read-only) into `cand-<shape>` fixtures with `expect: pending`, scrubbed; `npm run ladder-score` lists them "to confirm", never scores them, the ratchet ignores them. Confirm one by writing its real `expect.outcome` (then `--record` and `--update-baseline`).

**The judges are questions of rung 2** (`desktop/lib/account-judge.js` phases `ready` and `result`, `desktop/lib/form-judge.js` the step): one fixture per question, a `question` field (`page_kind` when absent, `account_ready`, `account_result`, `form_step`, `form_ready` (the form judge's ready/needs_person/blocked: blocked = a dialog, error, overlay or a vanished page stops the person right now, with a kind; the sketch's `onTop` line comes from `extension/on-top.js`, structure only); the schema is versioned and additive), scored per question and per source by `npm run ladder-score` ("Per question, then per source", never blended across questions), covered by the ratchet and the prompt fingerprint. Fixtures live beside the page-kind ones in `desktop/e2e/ladder-fixtures/`: `acc-ready-*`, `acc-result-*`, `step-*`, `ready-*` (a judge fixture's `sketch` is the extension's `accountSketch`, `extension/account-fill.js`, captured by `desktop/e2e/ladder-capture.mjs`).

**Trailers on a flow push** (`tools/rung-trailer.mjs`, in the push hook): a commit message of a push that touches flow code (FLOW_FILES, `desktop/lib/ladder/`, the page-kind facade, the judges, `extension/ladder/`) carries `Rung: <0-6|router|judges>` and `Fixture: <id of desktop/e2e/ladder-fixtures/ | none: <why>>` (`none` only for a pure move or refactor). A flow edit no rung decides (a log line, a timing) says `Rung: none: <why>` and needs no `Fixture`. A push touching no flow file is not asked.

**Updating the baseline honestly:** improve a fixture, then `npm run ladder-score -- --offline --update-baseline "<why>"`; the reason is dated in the file.
A fixture that got worse is a bug, not a baseline edit; the only exception is a deliberate trade-off the owner agrees to, said in the commit.

## Invariants (what the tests guard)
- A rung's answer is one of its fixed values (`desktop/test/page-kind.test.js`); the structure rule never overrides a rung that answered (`desktop/test/flow-invariants.test.js`).
- Unsure currently goes **down** to rung 0 (spec gap 1); the score prints it as `unsure`, rung 0. Slice B changes this on purpose, with the baseline updated.
- Counts and logs carry the shape and the rung, never the page's text.
