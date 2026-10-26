---
name: triage-github-open-issues
description: Work through the open GitHub issues of GarryOne/jobadabra - validate each one, fix the real ones, close the false positives with their cause - then score the UI Finder (precision per detector, why false positives were false, severity accuracy, trend) and propose changes that make it find more real bugs and fewer false ones. Use when asked to "triage the issues", "go through the GitHub issues", "handle the open issues", review the Finder's accuracy, or on the weekly triage.
---

# Triage the open issues, then improve the Finder

The Finder (the UI loop: layout checks, AI screenshot review, interaction probe, failed test steps, AI code review) files GitHub issues
labelled `auto-ui`; people file others. This skill: **validate → adopt the real ones → reject the false ones → score the Finder → propose
improvements.** It drives the loop's own tools, so every closure counts in `/admin/self-healing`, the weekly Finder review and the
lessons the judges learn from (`desktop/e2e/lib/reversals.mjs`). Never invent a second way to label or close.

**The goal (owner, 9 Oct 2026):** the Finder reports as many meaningful, accurate, valuable bugs as possible and as few false positives as
possible. The quality bar is issue #265: a concrete mismatch between what the screen tells a job seeker and what they can do, with why it
matters. Nitpicks (wording, emoji, scrollbars) are not wanted.

## The principle: more real issues, fewer false ones, every day (owner, 9 Oct 2026)
The Finder is judged by its **yield**: real bugs found per day should go **up** and false ones **down**, day after day. Precision alone is not
the goal. A Finder that files nothing has perfect precision and is useless (7-9 Oct 2026: 0 real bugs in three days, because the noise
breaker had paused the AI screenshot review, the detector that found 21 of 29 real bugs on 3-5 Oct).
- **Real bugs first, money second.** A gate that saves tokens by switching a detector off (a budget, a breaker, a "only when the UI changed"
  rule) is a suspect whenever the yield falls. Find it in the run's plan (`desktop/e2e/plan-run.mjs` `why`, the e2e run log) before
  blaming the product or the prompt.
- **Never a permanent pause.** Every gate must let a detector earn its way back (a sliding window, a probe run). A rule that can only
  be undone by a person is a bug.
- **Caught noise is the safety net working**, not the detector failing the owner: it counts in precision and lessons, never as a reason to
  stop looking.
- **Conclusions come from the last 2-3 days, always** (owner, 12 Oct 2026). The weekly totals (the scorecard's first line) are context, never
  the verdict: a week mixes old builds, bursts of runs and findings the noise register caught before filing (12 Oct: "24 real vs 59 false,
  last week 28 vs 14" looked like a collapse; per day it was ~2-3 false and 2-5 real filed, the rest register entries). Before you call a
  detector noisy, quiet or the yield down, build the **per-day, per-detector table for the last 3 days** (real / false / not judged, filed
  issues and noise-register entries apart) and base the conclusion on it. Say the weekly figure only beside it. Real bugs falling over those
  3 days is still the first thing to explain and fix, before any other proposal.
- Daily view: per day and per detector, real / false / judged-before-filing (group `classify()` of `lib/selfheal-stats.mjs` by `createdAt`
  day, the noise register included). A detector that went silent is as suspicious as one that got noisy.

## 0. Before starting (one line each to the owner)
- **Scope:** `gh issue list --state open -L 200 --json number,title,labels,createdAt`. Say how many, by kind.
- **Leave alone:** the loop's own state issues: `noise-register`, `harness-signatures`, `top-issues`, `verdict-audit`, `finder-scorecard`,
  `release-channels`, and any issue with an open fixer PR (`gh pr list --search "<number>"`, branches `auto-fix/`, `sentry-fix/`).
- **Peers:** `ListAgents`; tell the other sessions you are triaging and which issues you take (someone may be fixing one).
- **Tier:** each fix picks its own tier (AGENTS.md "Change tiers"); judging and closing is not a code change.

## 1. Validate (one issue at a time, evidence first)
For each issue, oldest high-severity first:
1. **Read it whole:** body (what was found, where, the screenshot and the run link), comments, labels (`source:`, `kind:`, `severity:`, `version:`,
   `seen-again`, `not-seen-latest`, `confirmed`, `needs-human`).
2. **Already fixed?** `git log --oneline --since=<createdAt> -S '<the symptom's code or wording>' -- <the file>`, and the issue's `version:` vs the
   current release. Seen only on a build older than the fix → `false-positive` with `Cause: stale`.
3. **Same as another?** Search open and closed issues for the same view and symptom → `Cause: duplicate` (name the other #).
4. **Reproduce small, with a positive control** (global rule "Debugging: prove the repro"): a unit test, `npm run shot -- <page> --js "<force the
   state>"` on the demo fixtures, or `E2E_STEPS='<step>,<prerequisites>' node run-all.mjs --only <suite>`. Read the run's artifacts before re-running.
5. **Decide**, and write the verdict file `<scratch>/triage/<number>.md` in the loop's format (parsed by `desktop/e2e/lib/verdict-comment.mjs`):
   ```
   real | false-positive | harness | needs-human | fixed
   Why: <one or two sentences, with file:line evidence>
   Cause: detector | probe-race | by-design | stale | duplicate     (false-positive only)
   Severity: high | medium | low                                    (real/fixed: by the rubric below)
   Check: <what a person should look at>                            (needs-human only)
   ```
   - `real`: the product is wrong for a person using it. `false-positive`: the product is right; the detector misread it (`detector`), the probe
     raced it (`probe-race`), it is chosen on purpose (`by-design`). `harness`: the test was wrong (its data, a selector, a wait), not the product.
   - **Severity rubric** (what the person feels): **high** = blocks the journey (a task cannot finish, a wrong result or false status, a raw error,
     lost data) or forces a costly workaround; **medium** = confusing, needs a workaround, bad UX (misleading text, clipped, misaligned);
     **low** = barely noticeable; wording is low unless it misleads.
   - A person filed it (no `auto-ui`)? Never close it as false without asking the owner.
6. **Apply** with the shared script, from the repo root:
   `JUDGE="triage session (Claude Code, with the owner)" desktop/e2e/apply-verdict.sh <number> <verdict file>`
   It posts the comment, sets the severity (the filed level is kept for the scorecard), the labels and the `resolution:` label, and closes a
   false positive or harness finding. A real one is labelled `confirmed`, then fixed in step 2.

## 2. Adopt the real ones
- One issue = one worktree (`tools/worktree.sh issue-<number>`), **test first** (it fails without the fix), the fix at the root cause, and the
  whole class (global rule "A specific instruction is about its whole class": the same bug in sibling cards, screens, the palette, Telegram).
- Land with `tools/ship.sh`; commit body `Fixes #<number>`.
- Then rewrite the verdict file's first line as `fixed`, name the commit under `Why:`, and run `apply-verdict.sh` again: it closes the issue as
  completed with `resolution:fixed`.
- A real UI bug a person filed (no `auto-ui`: the Finder missed it) gets its Notion Bug Tracker row; the Finder's own findings reach the tracker through `tracker-sync.yml`.
- A real one you cannot fix in this session: leave it `confirmed` with a comment saying what is missing; never close it.

## 3. Score the Finder: consult everything collected
1. **The scorecard:** `node desktop/e2e/finder-scorecard.mjs --post` (repo root, ~5 s). Per detector: filed / real / false / open, precision,
   the false-positive causes (`resolution:` labels), how often a judge changed the filed severity, the change since the last scorecard
   (posted on the pinned `finder-scorecard` issue). It counts like `/admin/self-healing` (same `classify()`, noise register included).
2. **The /self-heal page** (all the loop's collected data), read as the owner:
   `curl -sL -H "Authorization: Bearer $(security find-generic-password -s job-pilotto.site.api_key -w)" https://www.jobpilotto.top/admin/self-healing -o <scratch>/selfheal.html`,
   then strip the tags. Read every section, not only the totals:
   - **The loop, live**: its age (published every 3 h by `self-heal-stats.yml`; older than ~6 h = the publisher is broken) and its cutoff.
   - **Recall** (planted bugs caught; which were missed) and **Mutation catch rate** (planted code bugs).
   - **Detectors under watch** (the breaker: a detector wrong in 4 of its last 10 files nothing unjudged).
   - **What the Finder found** for all time / last 7 days / since the cutoff, and **by detector**; **AI cost per real bug**.
   - **How the Finder is evolving** (per day) and **What we changed in the Finder** (did a change move precision or recall?).
   - **Escape rate** (bugs people found that the Finder missed, from the Notion Bug Tracker) and **Misses guarded** (a guard built for each).
   - **Verdict accuracy** (the owner's audit ticks), **Judge exam**, **Regression rate**, **Flake rate**.
   - **Why issues were closed** (resolution labels) and the **producer's drops** (low-or-no-impact, known-false-positive, held, over-the-cap).
   - **Real bugs it caught (latest)**: the kind of finding to get more of.
3. **The week's facts:** `node desktop/e2e/finder-review.mjs <scratch>/finder-review` (per-detector outcomes, false-positive reasons, harness
   issues, duplicates; what the Saturday self-review reads) and the escapes' lessons (`lib/bug-tracker.mjs` `missedLessons`).
4. **Check the data is right before using it** (owner, 9 Oct 2026: "make sure the data on /self-heal is accurate"):
   - The page's all-time totals must equal the scorecard's (filed, real, false, precision). A difference is a stats bug: find it and fix it.
   - Spot-check 3 issues per detector: does its `resolution:` label match how it really ended (its closing comment, a commit)?
   - A figure that contradicts another (e.g. "no defect closed by a fix" beside "43 fixed") is a bug in `desktop/e2e/lib/loop-quality.mjs`,
     `lib/selfheal-stats.mjs` or `admin/selfheal.js` (that one lives in the private repo `jobadabra-web`: fix it there, a PR with a test; `~/jobadabra-web/tools/site-run.sh <cmd>` runs commands in the joined tree): fix it with a test, like any other bug.
   - A figure that is missing and would change a decision (severity accuracy, escapes per detector, time to verdict): propose adding it.

What to look for:
- **Precision by detector** below ~70% **over the last 2-3 days**, and its main cause (e.g. failed test steps closing as `fp:harness` → the tests, not the product).
- **Escapes:** bugs a person found that the Finder did not (closed issues without `auto-ui`, Bug Tracker rows marked detector-miss).
- **Severity drift:** many ↓ (the detector over-rates) or ↑ (it under-rates) for one detector.
- **Recall:** planted bugs missed (`desktop/e2e/lib/recall.mjs`).
- **Stale backlog:** issues open with no verdict for more than a week.

## 4. Propose improvements (then build only what the owner approves)
For each weak spot, one proposal: **what changes** (file:line), **the issues it would have caught or not filed** (by number), **the expected
change** in precision or recall, and **its test** (a fixture of a closed false positive that must stay silent, or a plant that must be caught).
Prefer, in order: teaching the existing judge (lessons, the prejudge prompt, a severity cap in `lib/vision.mjs` `cappedSeverity`), fixing a
detector's rule at its root, a new plant for an escape, a harness signature for a recurring test mistake (`lib/signatures.mjs` learns these
on its own after 3 closures). Never a word list or a per-screen exception (CLAUDE.md "Universal first").

## 5. The session report (always, at the end; owner, 9 Oct 2026)
End every triage session with this report, in the reply (short table cells, explanations under the tables). Every number comes from this
session's verdict files, commits and the scorecard, never from memory.

1. **Verdict line:** `N issues triaged: V valid (F fixed, Q confirmed, still open) · P false positives · H test mistakes · S stale/duplicate · K parked for you`.
2. **Valid issues:** | # | What was wrong | Severity (filed → judged) | Fixed in |  (a commit sha, or "open: <why>").
3. **False positives:** | # | Detector | Why false (cause) |  plus one line on the pattern if a detector made the same mistake more than once.
4. **Gaps found in the UI Finder:**
   - a per-day table for the last 3 days first (detector × day: real / false / not judged, filed and register apart); the weekly figure only beside it;
   - detectors whose precision is low over those days, and their main false-positive cause;
   - severity it got wrong (over/under-rated, by detector);
   - bugs it missed (escapes: found by a person, not the Finder; planted bugs not caught);
   - data on /self-heal that was wrong or missing.
5. **What we changed this session:** product fixes (sha → issue) and Finder/stats fixes (sha → which gap it closes).
6. **Finder scorecard:** precision now, its change since the last scorecard, and the link to the scorecard comment.
7. **Proposed next improvements**, ranked by expected gain (each: the change, the issues it would have caught or not filed, its test).
   Built only once the owner says yes.
8. **Not done, and why:** a person's issue left for the owner, a fix too big for the session, anything skipped.
