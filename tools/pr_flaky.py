"""Say which failed e2e steps of a red PR are flaky, for the PR verdict's log and its description (companion of tools/pr-verdict.py).
A step is flaky when it passed on code that has not changed in its files since (tools/flaky-verdict.mjs, desktop/e2e/lib/flaky-verdict.mjs); "Changed" is a likely regression.
Why (31 Oct 2026, owner: "You detect flakiness and immediately treat the flakiness root cause"): the tool says it on the red, so no person has to notice. Information only:
it never changes the verdict's state, and a failed read adds nothing.
Tests: tests/test_pr_flaky.py
"""
import os
import re
import shutil
import subprocess

E2E_PR_TITLE = 'E2E for PR · '   # e2e.yml run-name for a run pr-suites.yml started (same as pr-verdict.py)
WINDOW = '15'   # runs looked at per red run: the verdict writer shares a 5,000-calls-an-hour token (30 Oct 2026); main's gate and the alert look at 40
TIMEOUT_S = 120


def lines(repo, runs, run=subprocess.run, which=shutil.which, tool=None):
    """The verdict lines (Flaky/Changed/Unknown, one per failed step) for the PR's red e2e runs; [] when the tool, node or the read is unavailable."""
    tool = tool or os.path.join(os.path.dirname(os.path.abspath(__file__)), 'flaky-verdict.mjs')
    if not which('node') or not os.path.exists(tool):
        return []
    out = []
    for r in runs:
        if not str(r.get('displayTitle', '')).startswith(E2E_PR_TITLE) or r.get('conclusion') != 'failure':
            continue
        try:
            done = run(['node', tool, '--run', str(r['databaseId']), '--repo', repo, '--window', WINDOW], capture_output=True, text=True, encoding='utf-8', timeout=TIMEOUT_S)
        except (OSError, subprocess.SubprocessError):
            continue
        out += [line for line in done.stdout.splitlines() if re.match(r'(Flaky|Changed|Unknown): ', line)]
    return out


def summary(said):
    """'' or a short suffix for the status description: how many of the red steps passed on unchanged code."""
    flaky = sum(1 for line in said if line.startswith('Flaky: '))
    return f' (flaky: {flaky} of {len(said)} red step(s) passed on unchanged code)' if flaky else ''
