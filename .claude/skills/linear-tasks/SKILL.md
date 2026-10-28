---
name: linear-tasks
description: How tasks, ideas and initiatives are tracked in Linear (team JOB, MCP `linear`): park an idea by ROI, take a task the owner asks for, measure an unknown impact, pick what to do next, start and finish a task, groom the backlog. Use when exploring finds something the task does not need, when the owner says "park it", "add to Linear", "what's next", "backlog", or when a session starts or finishes a JOB issue.
---

# Tasks in Linear (owner, 28-29 Oct 2026)

Linear holds tasks, ideas and initiatives. **GitHub issues hold real bugs** (something broken that a user or the Finder saw), never tasks. Tool: MCP `linear` (`save_issue`, `list_issues`, `save_issue_label`, `save_comment`), team `Jobadabra`, key JOB. Before creating: `list_issues` with a query for the same thing (no duplicates).

## Fields on every issue (so the backlog sorts by ROI)
| Field | Values |
|---|---|
| Priority | 1 Urgent = a user hit it or money/safety; 2 High; 3 Medium; 4 Low = nice to have |
| Impact label (one) | `High impact`, `Medium impact`, `Low impact`; or `needs-measurement` when it cannot be judged yet |
| Effort = Linear **estimate** | 1 under 2 h, 2 half a day, 3 about a day, 5 several days, 8 a week or more, or money |
| Area label | e.g. `Code Quality / LLM Guardrails`; a new area gets its label first (`save_issue_label`) |
| First line of the description | `**ROI:** impact <H/M/L> (<why>) · effort <size> (<why>) → priority <name>.` |

## Scenarios
1. **Park an idea** (found while exploring or fixing). Park only when the task's outcome does not need it AND it is small value at our stage (few users) AND it serves a rare case (about 1% of situations); one alone is not enough, then build it or ask. Create the issue with all fields, add `Why parked` and `Revisit when:` (a concrete trigger), reply in one line `parked as JOB-n (priority, impact, effort)`, build nothing of it.
2. **The owner asks to add a task.** It is not parked: no ROI test. Take his words as the title, his priority if he gives one, else propose one. Still set Impact and estimate, or `needs-measurement`.
3. **Unknown impact.** Label `needs-measurement` and no Impact label. The description says what to measure, how (a command or query) and which number makes it High or Low. When measured: swap the label for an Impact label, set the priority, say the number in a comment. Never invent a number for the ROI line.
4. **What next?** `list_issues` (team JOB, Backlog and Todo), order by priority, then impact, then smaller estimate. Offer the top 3 with a recommendation (AskUserQuestion); nothing starts without his pick. `needs-measurement` items are offered as "measure first", never as work.
5. **Start.** Assign, set `In Progress`, put `JOB-n` in the PR title or body (Linear links the PR from it). One issue per session; work the task needs but that splits off follows the hand-off rule in CLAUDE.md (a brief and "start it?"), and gets its own JOB issue only once the owner says to do it (scenario 2). Scenario 1 is only for what the task does not need.
6. **Finish.** PR merged → `Done` (if Linear did not move it) and a comment with the PR link and the measured before and after. Abandoned or obsolete → `Canceled` with the reason in a comment; never leave it open.
7. **Groups.** A plan with 3 or more PRs gets one Linear Project named like the plan; its issues are `n/N` and link the plan file. An Initiative groups Projects only when the owner asks for one.
8. **Groom** (when the owner asks): list issues missing an Impact label, an estimate or an Area; `needs-measurement` older than 14 days (measure it or cancel it); priority 1 or 2 untouched for a week. Report counts from the list output, never typed by hand.

**Never:** park a bug, a safety item or something the current task needs; spend money to park (a paid tool is an issue, not a purchase); park by editing CLAUDE.md or a doc instead of Linear.
