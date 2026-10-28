# Plan: About you, everywhere (What we learned PR D)

Spec: [2026-10-28-about-you-everywhere-design.md](../specs/2026-10-28-about-you-everywhere-design.md) (approved 28 Oct 2026;
sketch https://claude.ai/artifact/QkXa9AcY1FMtwg6wdBzNCm). Builder: session 64 after PR B2b. This draft PR carries the plan
and becomes the build PR (owner, 28 Oct 2026: "open individual PRs with their specs and plans. To not forget about them").

## Before coding

1. Settle where the builder lives (spec "Open"): read `desktop/lib/pipeline-commands.js`, `desktop/lib/pipeline-args.js`,
   `desktop/lib/cloud-handlers.js` and `.github/workflows/daily.yml`; list which engine steps run on the Mac vs in the cloud
   and what each can reach (`cv/` files, store). Write the choice and why here, amending this plan.
2. List today's prompt case sets for every reader touched (`tools/prompt-cases.mjs`).

## Decided before coding (28 Oct 2026)

- **Builder:** one on this Mac, `desktop/lib/about-you.js` (the sketch's option a, approved). `src daily` runs the kit both on the Mac (the app
  starts it: `desktop/lib/pipeline-args.js --auto-kit-max`) and in the cloud (`.github/workflows/daily.yml`); the app hands the bundle to the
  engine steps it starts, a cloud run without one names the parts it lacked (criterion 6).
- **Case sets today:** `question-reuse` (the sensitive flag), `form` (live: worker answerForm), `writing` (prep, insights, rejection);
  kit, CV tailoring and letters have none yet: D1b/D1c add theirs.
- **Sensitive** (owner, 28 Oct 2026: "Reuse judge"): a `sensitive` flag in the question-reuse call, cached per question (verdicts v7: judged
  again once); anything but a plain false stays out of every reader but form filling and kit answers.
- **Salary** for CV tailoring and letters: the AI's kind (a line's `[salary]` mark, else the kept question format) and Strategy's pay fields;
  a learning whose kind was never judged stays out of them too. No word list.
- **Three PRs** (owner, 28 Oct 2026): D1a = this PR (interface, sensitive flag, interface tests); D1b = form filling + kit answers + the class
  test; D1c = CV tailoring + letters with their new case sets.
- **D1b, option A** (owner, 28 Oct 2026, sketch https://claude.ai/artifact/CXDYvPtDtjbB3rpMo8bej4, table https://claude.ai/artifact/4Wbd1RQ667BmdesQdbGhmz):
  measured on the demo Profile, the bundle kept 9 of its 38 lines (deal-breakers, surveys, CV gaps, Strengths dropped), while form filling
  already read all four parts and kits read no CV at all. So form filling and kits keep reading the full Profile and answers pages; kits take
  the CV + Experience bank from About you (a per-run file, `JOB_PILOTTO_ABOUT_YOU_FILE`); Strategy gains deal-breakers and other preferences.
  Before D1c switches a reader: the Profile's "CV gaps" and free notes get a part, or are decided out.
- **Readers page** (owner via the coordinator, 28 Oct 2026: "publish on the website … this table"): a separate page, linked from Intelligence,
  every cell generated from `READERS` (exported as data the class test checks), live only. Builder: session 64, after D1b; site PR first.

## PR D1 · interface + writers

| Task | Files | Test (written first) |
|---|---|---|
| Interface: parts, readers table, exclusions, budget priority (details > learned > cv > strategy > history) | new `desktop/lib/about-you.js` (or the engine twin per step 1) | new `desktop/test/about-you.test.js`: one unique fact per part; each reader gets exactly its parts; salary/sensitive exclusions; conflicts left out |
| Form filling | none (option A: reads the pages, CV + bank since 16 Oct) | — |
| Kit answers | `src/ai/kit.py`, `lib/pipeline-run.js` (per-run bundle file) | `tests/test_kit_about_you.py`, `test/kit-bundle-run.test.js`; set `kit` (`tools/kit-cases.py`) |
| CV tailoring | `desktop/lib/kit-handlers.js:65-75`, `desktop/lib/cv.js` | the summary may use a learning; roles never take one; salary absent |
| Letters | `desktop/lib/job-letter.js`, `desktop/lib/cover-letter.js` | base letter + Writing preferences as voice; no salary |
| Class test | one loop over every reader through a recording fake AI client | fails when any reader reads knowledge outside the interface |

Prompt cases (spec criterion 4): a letter that must not mention salary; a CV summary that uses a learning; a form answer that
uses an Experience bank bullet. Replay each changed prompt's whole set.

Cost: measure the added input tokens per reader on the fixed sets; show the owner before shipping.

## Readers page (after D1b)

| Task | Where | Test |
|---|---|---|
| Export `READERS` (parts, exclusions) as data | public repo, e.g. `docs/about-you-readers.json` | the class test checks it equals `READERS` |
| The page, linked from Intelligence | `jobadabra-web` (site PR first) | reads the export; shows only what ships |

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
