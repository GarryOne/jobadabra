# Codex plan measurement, 28 Oct 2026 (spec PR 0)
Raw evidence for the numbers in `../../2026-10-28-ci-on-codex-subscription-design.md` (tokens per call, 4-way concurrency, calls per 1% of the week).
- `limits.mjs`: reads `primary.usedPercent` and `resetsAt` through the Codex app-server (`account/rateLimits/read`); prints no credential.
- `batch.sh` (20 sequential calls, log `sequential-20.log`) and `par.sh` (60 calls, 4 at a time, log `parallel-60.log`): one `codex exec --ignore-user-config --disable shell_tool --output-schema schema.json -i red.png` per call.
- Inputs not committed: `red.png` is a 64x64 all-red PNG; `notes.txt` is the first 6000 bytes of `docs/ARCHITECTURE.md`. A first try with 3 calls was dropped: it read the percent from a session file, which does not carry it.
- Reading: the whole-number `usedPercent` was 1 at the start of `sequential-20.log` and through `parallel-60.log` after 20 more calls, and 2 after the next 20 (calls 41-60 of the 80), so one percent is at least about 40 calls of this size. Per-call input tokens (~18k) are in `sequential-20.log`.
