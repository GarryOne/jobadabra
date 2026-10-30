# Codex PR event delivery

> For agentic workers: execute inline with superpowers:executing-plans; do not delegate implementation.

**Goal:** Codex receives the same RED, COMMENT, READY, MERGED and CLOSED events already emitted by ship-watch.sh without manual GitHub polling.

**Design:** The existing watcher remains the only GitHub reader. For a Codex-owned watch, queue unseen complete log events through the installed CLI's `codex queue --thread <id> --message <text> --resume`. A locked local cursor fingerprints consumed log bytes, survives watcher restarts and resets if the log was replaced. Failed queueing leaves events pending for the next existing watcher look. No terminal input, extra GitHub poller, model API, merge or job submission. Claude-only watches do not invoke Codex. The owner requested permanent integration and said go on 30 Oct 2026.

**Idle behavior:** Queueing is durable and active delivery was verified with an acknowledged native queue probe. The installed CLI warned that no local daemon could resume this thread; an idle-wake claim needs a separate receipt after the turn ends. Never start a second agent on the same thread merely to bypass that warning.

**Files:** tools/codex-pr-events.py owns native queue delivery and its cursor; tools/ship-watch.sh calls it at event emission and existing looks; tests/test_codex_pr_events.py and the existing watcher tests isolate delivery from real Codex/GitHub; AGENTS.md explicitly requires ship.sh for PR creation and updates.

**Validation:** First observe the missing helper/behavior red. Check event routing, one-time delivery, retry after failed queueing, partial lines and replaced logs; run a stubbed watcher RED-to-MERGED journey. Existing watcher tests preserve Claude and check semantics. Review independently, then open the focused PR with ship.sh and --body. Inspect CI before ready.

## Progress

- [x] Verify native queue CLI and acknowledge a real active-session delivery probe. (proof: none: installed codex queue --help plus acknowledged probe in session 01a18ac0-a906-7ba1-bf47-93e2bf1db6a7)
- [x] Prove focused delivery tests red, then green without a real daemon/model. (proof: tests/test_codex_pr_events.py)
- [x] Prove watcher routes RED and MERGED to its own Codex thread once. (proof: tests/test_ship_watch.py)
- [ ] Independent review and focused PR CI.
- [ ] Confirm actual watcher event receipt; record idle-wake limitation or proof.
