---
name: report-sessions-roundup
description: Coordinator's round-up of every running Jobadabra session - one table (Session, Work, Status, Waiting on, Progress %, ETA), closed sessions left out, an overall % and the one thing everyone waits on, then what the owner should merge or decide. Use when the owner says "round-up", "roundup", "where do the sessions stand", "update the table", "what is blocking", or "/report-sessions-roundup".
---

# Sessions round-up (coordinator)

Owner, 15 Oct 2026: "when triggered, present me this report". One table, read in 5 seconds; facts measured now, never from memory.

## 1. Gather (one round, in parallel, ~1 min)
- **Who runs:** `ListAgents`, called fresh for THIS round-up. **Only sessions it lists go in the table**: one missing from it is closed, even if it was in the last table or just finished (owner, 15 Oct 2026: 42 was reported "close now" after the owner had closed it). A finished session still listed gets "ask to close" (send it the may-I-close message below); never carry a row over from memory. Short name = the part after the last `-` (`jobadabra-70` and the older `job-pilotto-70` are both 70).
- **PRs:** `gh pr list --state all --limit 20 --json number,state,headRefName,title,statusCheckRollup` and count each open PR's checks: green / running / failing. A failing "All checks passed" summary next to running checks is the old result: say "re-run running", not "red".
- **CI the sessions wait on:** the runs they named (recordings `record-sites.yml`, `fix-verdicts.yml`, refills): `gh run view <id> --json status,conclusion`. A run `pending`/`queued` for >10 min: say why (GitHub's parallel-job limit full, a concurrency group) after one check (`gh api repos/<repo>/actions/runs/<id>`), never a guess.
- **The Mac:** `uptime`. Load above ~20: name the cause before reporting it (memory feedback-no-artificial-load-on-mac: orphaned loops first).
- **Circles (every round-up, unasked; owner, 27 Oct 2026: "we fix one thing tens of times… going in circles… Pretending each time like it's the last time"):** count merged fix commits per product area in the last 7 days
  (`git log origin/main --since=7.days --name-only --format=@@%h` grouped by file, then by area: the files one subject lives in), and per open session the tries on its current symptom.
  An area with **3+ fixes this week**, or a session on **try 3** of one symptom, is a circle: name it 🌀 under the table (area, count, the last 3 commit subjects) and **propose the step back yourself**:
  the intended behaviour in the owner's words (states, their one owner, the verdicts that change them), what to simplify or replace, who builds it, as a sketch and one AskUserQuestion.
  Never brief "try N+1" on a circle. Golden rule: `~/.claude/CLAUDE.md` "Going in circles"; once `tools/area-circles.mjs` lands, read its count instead of the git one-liner.
- **Ask each running session for 3 lines only when its state is not visible** from PRs and runs: (1) done since last report, (2) what blocks it, (3) ETA. `SendMessage`, first line self-contained; do not wait more than ~3 min for replies: mark "no reply" and use what is measured.

## 2. The table (exact columns, a few words per cell)
| | Session | Age | Work | Status | Waiting on | Progress | ETA |
- **The first column is one health circle** (owner, 15 Oct 2026: "a visual message on how it is progressing, compared with the time since it started"):
  - 🟢 **on track**: progress fits its age (e.g. <1 h old and moving, or ≥75% with an ETA under ~30 min), nothing failing, waits only on CI.
  - 🔵 **your move**: done, or green and waiting only on the owner (a merge, a yes, a decision). Bold "ask to close" when done.
  - 🟡 **slow**: older than its progress explains (e.g. >2 h and under 75%), an ETA that slipped once, or stuck >30 min in GitHub's queue or on the Mac.
  - 🔴 **in trouble**: a failing check it has not fixed, a refusal or blocker it cannot clear, no reply, >4 h old and not near done, or an ETA that slipped twice.
  - Say the reason for every 🟡/🔴 in a few words in its Status cell.
- **Age** = time since the session started (ListAgents' "started …"), e.g. "25 min", "7 h".
- **Progress %**: 100 = its PRs merged and nothing left (bold, ETA "**ask to close**"); 95 = PR green, only the owner's merge; ~85 = PR checks running; ~75 = still publishing/recording/refilling; ~5-30 = building. Be consistent with the previous table: a number goes down only with a reason said under the table.
- **Waiting on**: name the real blocker: "**your merge**" (bold when it is the owner), "CI", "GitHub's job queue", "the Mac", a peer by name, or "nothing".
- **ETA**: minutes from now, "+ merge" when the owner's merge follows. Never "soon".
- Order: done first (to close), then by progress, highest first.
- **Closing** (owner, 18 Oct 2026: "don't ask me. just check with the session every time"): send the session "may I close your workspace now? Is anything open, or is the owner in a conversation with you?"; close (`cmux close-workspace --force`) only on its explicit "yes, close" to THAT message. An earlier "done, you can close" is not enough: e0 was closed while the owner was mid-conversation with it.

## 3. Under the table (max 5 bullets)
- **Overall: ~N%** (average of the rows), the circles counted (e.g. 🟢 3 · 🔵 2 · 🟡 1 · 🔴 0) and **the one wait most rows share** (the owner's merges, GitHub's queue, the Mac).
- **🌀 Circles**, when any: the area, its fixes this week, and the step back you propose (or "none this week").
- **Ready for you to merge**, in order, with links only for PRs that turned green since the last round-up.
- **Needs your word:** decisions only the owner makes (an accept, a live visit's yes in a session's own window, spending).
- A correction of an earlier ETA or claim, said plainly.

## Coordination rules learned (15 Oct 2026, #824 blocked ~4 h)
- While a prompt-changing PR is being refilled, no new recording of a PINNED row is published (it replaces the refilled record with old-prompt answers: coreweave and Greenhouse did, twice).
- A refill publishes each group as soon as it is refilled, never all at the end.

## Never
- List a session `ListAgents` did not list (closed), or invent a status for a session that did not reply ("no reply" is a status).
- Count a PR's stale red summary as failing while its re-run runs.
- Close a session without its "yes, close" to the may-I-close message, or ask the owner instead of the session.
- Narrate peers' coordination: the owner sees only the table and what needs them.
