#!/usr/bin/env bash
# Recorded replays of a fix on the new build AND on the old build, under ONE heavy-lock hold (a fix cost ~15 min of waiting when each replay queued by itself). Guarded by tests/test_recorded_both.py.
#   npm run recorded-both -- <old extension folder>        (or OLD_EXTENSION_DIR=<folder>)
# Runs `npm run recorded` on the new build (must pass), then again with REAL_EXTENSION_DIR=<old> (must FAIL: the fix's recorded page is the positive control). JP_REPLAY_CASES,
# JP_REPLAY_SHARD and JP_REPLAY_TABS reach both runs. Exit 0 = new passes and old fails; 1 = the new build fails; 3 = the old build passes everything (the control proves nothing).
# RECORDED_SKIP_OLD=1 runs only the new build. Not under the lock (JOBADABRA_HEAVY=0, or run outside `npm run recorded-both`) the two runs still happen in order.
old="${1:-${OLD_EXTENSION_DIR:-}}"
[ -n "$old" ] || [ "${RECORDED_SKIP_OLD:-}" = 1 ] || { echo "recorded-both: name the old build: npm run recorded-both -- <folder> (or OLD_EXTENSION_DIR=<folder>; RECORDED_SKIP_OLD=1 runs the new build only)" >&2; exit 2; }
[ -z "$old" ] || [ -d "$old" ] || { echo "recorded-both: $old is not a folder" >&2; exit 2; }
here="$(cd "$(dirname "$0")" && pwd)"; cd "$here"
echo "recorded-both: the new build ($(pwd))"
npm run recorded; new_code=$?
echo "recorded-both: new build exit $new_code"
[ "$new_code" = 0 ] || exit 1
[ "${RECORDED_SKIP_OLD:-}" = 1 ] && exit 0
echo "recorded-both: the old build ($old): it must fail"
REAL_EXTENSION_DIR="$old" npm run recorded; old_code=$?
echo "recorded-both: old build exit $old_code ($([ "$old_code" = 0 ] && echo "PASSED: the control proves nothing" || echo "failed, as it must"))"
[ "$old_code" = 0 ] && exit 3
exit 0
