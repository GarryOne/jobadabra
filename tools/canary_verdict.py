"""Who a red stable-canary run blames: the stable build (a suite failed), our own harness (the plan job failed, no suite ever ran on the build), or nobody yet (every failed step only ran out of time)."""
import json
import re
import sys
from pathlib import Path

# Why (1 Nov 2026, a8; stable canary 41312012476, owner: "Fix the input, no retry"): three applyflows steps failed with "the fill did not finish within 257.365 s (last seen: null)",
# "... 176.41 s ..." and "the app never saw the earlier form closed after waiting 45027 ms": every note was a wait running out, none a wrong answer, and the issue said "promote the
# previous build". The cause was a form tab the extension never saw, not a broken build and not a slow runner, so a red made ONLY of waits running out is reported as "timeouts",
# whose text says to look again before any rollback. These are the shapes of a wait running out; desktop/e2e/lib/triage-match.mjs TIMEOUT_FAILURE is the wider list the UI loop
# uses (a subset here on purpose: a note this does not recognise stays a stable red).
TIMEOUT_NOTE = re.compile(r'did not (?:appear|finish|go quiet) within|never saw .{0,160}? after waiting \d+ ?ms|\(it hung\)|Timeout \d+\s?ms exceeded|budget ran out|still busy after')
FAILED = ('failure', 'timed_out', 'startup_failure')


def timeouts_only(bad, failures):
    """True when every failed job is a suite job with a recorded failure and every recorded failure note is a wait running out.
    `failures`: the run's suite-failures.json records ([{suite, step, message}]); `bad`: its failed jobs. No record for a failed job = a crash we cannot read: not timeouts."""
    if not failures or any(not TIMEOUT_NOTE.search(str(item.get('message', ''))) for item in failures):
        return False
    suites = {str(item.get('suite', '')) for item in failures if item.get('suite')}
    return bool(suites) and all(any(suite in str(job.get('name', '')) for suite in suites) for job in bad)


def verdict(jobs, failures=None):
    """jobs = the e2e run's jobs ([{name, conclusion}]) -> 'green' | 'stable' | 'harness' | 'timeouts'.
    A failed `plan` job (main's harness unit tests, the suite list) ran before any suite touched the stable tag: that is not the stable build failing.
    `timeouts`: the suites' own failure records are all waits running out (see TIMEOUT_NOTE); nobody knows yet whether the build is at fault."""
    bad = [j for j in jobs if j.get('conclusion') in FAILED]
    if not bad:
        return 'green'
    if all(j.get('name') == 'plan' for j in bad):
        return 'harness'
    if timeouts_only(bad, failures):
        return 'timeouts'
    return 'stable'


def failures_in(folder):
    """Every suite-failures.json under a downloaded run's artifacts, as one list; a missing or unreadable file adds nothing."""
    found = []
    for path in sorted(Path(folder).rglob('suite-failures.json')):
        try:
            records = json.loads(path.read_text())
        except (OSError, ValueError):
            continue
        if isinstance(records, list):
            found.extend(item for item in records if isinstance(item, dict))
    return found


if __name__ == '__main__':
    # python3 tools/canary_verdict.py [--failures <folder of downloaded e2e-artifacts-*>] < jobs.json
    args = sys.argv[1:]
    where = args[args.index('--failures') + 1] if '--failures' in args else ''
    print(verdict(json.load(sys.stdin).get('jobs', []), failures_in(where) if where else None))
