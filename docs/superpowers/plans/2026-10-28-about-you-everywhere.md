# Plan: About you, everywhere (What we learned PR D)

Spec: [2026-10-28-about-you-everywhere-design.md](../specs/2026-10-28-about-you-everywhere-design.md) (approved 28 Oct 2026;
sketch https://claude.ai/artifact/QkXa9AcY1FMtwg6wdBzNCm). Builder: session 64 after PR B2b. This draft PR carries the plan
and becomes the build PR (owner, 28 Oct 2026: "open individual PRs with their specs and plans. To not forget about them").

## Before coding

1. Settle where the builder lives (spec "Open"): read `desktop/lib/pipeline-commands.js`, `desktop/lib/pipeline-args.js`,
   `desktop/lib/cloud-handlers.js` and `.github/workflows/daily.yml`; list which engine steps run on the Mac vs in the cloud
   and what each can reach (`cv/` files, store). Write the choice and why here, amending this plan.
2. List today's prompt case sets for every reader touched (`tools/prompt-cases.mjs`).

## PR D1 · interface + writers

| Task | Files | Test (written first) |
|---|---|---|
| Interface: parts, readers table, exclusions, budget priority (details > learned > cv > strategy > history) | new `desktop/lib/about-you.js` (or the engine twin per step 1) | new `desktop/test/about-you.test.js`: one unique fact per part; each reader gets exactly its parts; salary/sensitive exclusions; conflicts left out |
| Form filling | `desktop/lib/server-contact.js` | extension `/extension/me` carries `learned` + bank bullets for open answers |
| Kit answers | `src/ai/kit.py` (+ how the app passes the bundle) | `tests/test_kit*.py`: prompt holds the bundle's parts |
| CV tailoring | `desktop/lib/kit-handlers.js:65-75`, `desktop/lib/cv.js` | the summary may use a learning; roles never take one; salary absent |
| Letters | `desktop/lib/job-letter.js`, `desktop/lib/cover-letter.js` | base letter + Writing preferences as voice; no salary |
| Class test | one loop over every reader through a recording fake AI client | fails when any reader reads knowledge outside the interface |

Prompt cases (spec criterion 4): a letter that must not mention salary; a CV summary that uses a learning; a form answer that
uses an Experience bank bullet. Replay each changed prompt's whole set.

Cost: measure the added input tokens per reader on the fixed sets; show the owner before shipping.

## PR D2 · analysis readers

| Reader | Files |
|---|---|
| Job fit score | `src/ai/score.py` |
| Daily insight, Analyze my search | `src/ai/insights.py`, `src/ai/insights_data.py` |
| Interview prep (with `this_job`) | `src/ai/prep.py` |
| Interview insights, rejection review | `src/ai/interview_insights.py`, `src/ai/rejection.py` |

Same class test extended; cloud runs without `cv/` name the parts they lacked (spec criterion 6).

## Verification per PR

Lint over changed JS, the fast push gate, the focused tests above; suites on CI. Ready = All checks passed + Gitar ✅ Approved
+ no unanswered comment. Unblocks: Insights with actions PRs 2-6 and Your portrait.
