---
name: compare-ai-models-on-writing
description: Measure which AI model writes better for Jobadabra's text features (cover letters, answer review, interview prep, weekly summary, rejection replies): Qwen3-30B (Free AI) against Haiku, Sonnet or Opus, with a pass/fail rubric and a blind head-to-head, on the owner's Claude plan ($0 API). Use before changing which model a Pro or Free step uses, or when the owner asks "is model X better for writing".
---

# Compare AI models on writing

Two tools, same 25 fictional cases (5 per feature, `tools/free-ai-writing-cases.mjs`). Claude models and every judge run through `claude -p` on the plan: no key, no per-call cost. Only a Workers AI writer (Qwen) spends, on the production account, so it needs `--allow-production --max-calls N`.

## 1. Pass/fail rubric (`tools/free-ai-writing-eval.mjs`): is a model good enough?
- A writer answers each case; a judge scores six yes/no criteria (voice, supported, fit_honest, specific, style, clean); the table counts "all six".
- `--claude <alias>` picks the Claude writer (haiku, sonnet, opus); the other slot is Qwen, or `--free-claude <alias>` makes it a Claude too (no Workers AI call). `--judge claude:<alias>` picks the judge. `--out <dir>` keeps `raw.json` (every answer) and `judged.json`.
- Answers are saved in `raw.json`: compare models on one saved set, never by re-running the writer (Qwen's answers change between runs).

## 2. Head-to-head (`tools/free-ai-writing-pairwise.mjs`): which of two is better?
- `node tools/free-ai-writing-pairwise.mjs --a <raw.json>:<slot>:<label> --b <raw.json>:<slot>:<label> --judges claude:sonnet,claude:opus --out <dir>`; no new writer calls.
- Each case is judged in both orders by each judge; the table gives wins per feature and a position-bias line (if the first-shown text wins about half the time, order does not matter).
- Use this, not the rubric, to rank two models that both pass: a yes/no floor check cannot reward richer text.

## Traps (each cost a rerun on 27 Oct 2026)
- **`claude not found` (exit 127):** put the real node bin first on PATH (`/Users/mac/.nvm/versions/node/<v>/bin`); a cmux shim, or an auto-update swapping the binary mid-run, hides it. Check `command -v claude` in the runner's own shell.
- **Five cases per feature is a coin-flip for close calls** (Haiku 17 vs Sonnet 13 of 25 was noise). Read a difference of fewer than ~5 cases as "not shown", never as "none"; say which in the report.
- **A judge from the writer's family favours it.** 27 Oct 2026, 15 letters, Opus vs Haiku: 23-7 under an Opus judge, 16-14 under a Sonnet judge (noise). Always read the per-judge split (the table prints it) and claim a gain only when both judges agree; a judge of a third family (not Claude) is still to be added. Read the notes behind a surprising loss (Opus prep "unsupported" were judge strictness on embellishment plus a case that confused "48 hours away" with "already past").
- **Run long runs in the background with `2>&1 | tee <log>`** and a Monitor on `PAIR|WROUND|rror`; one runner at a time, so two runs never share the plan's usage.
- Baselines go stale: re-run the cheap model (Qwen) beside the new ones in the same round.
- `--more-letters` (eval and pairwise) adds 10 letter cases (15 in all: fits, level/pay mismatches, a ruled-out job, language gaps) for a close call on letters; the default stays 5 per feature.
- Cases are fictional only; they go to a third party.

## Report
Per feature: rubric table, head-to-head wins, which judge, n, and cost per Pro user per month from the measured token mix (`/admin/ai-cost`, list prices). A model goes in the routing table only with its measured gain written next to it.
