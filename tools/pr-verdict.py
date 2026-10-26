#!/usr/bin/env python3
"""Writes a pull request's one required status, "All checks passed", from the state of every workflow run of its head commit, in seconds.

pr-verdict.yml runs it when any PR workflow ends (workflow_run), and a PR's e2e suite job runs it with --red the moment it fails. No job holds a runner to wait
(owner, 26 Oct 2026: "How could you design such a slow and inefficient method of checking PRs?"; on #1992 two polling jobs took 43 of 206 runner-minutes of one push).
Counted: the runs of the commit started by the pull request, and the e2e run pr-suites.yml started for it (title "E2E for PR · ..."): a red suite blocks the merge
(gate G1a; the owner rejected report only, 26 Oct 2026). The newest run of each workflow
decides (a description edit re-runs the gate; a re-run replaces a red). Any red: failure at once. Any running: pending. All green or skipped: success, with the wall time.
Budget (owner's yes, 26 Oct 2026): a PR that changes how CI runs PRs (ci_change) and whose checks took over BUDGET_MIN goes red, unless a commit of it says
"CI-budget: <why>". Each slowdown so far (781637a, bc585e3, a7a6a9f, 7083bb7) landed without saying a PR's time.
  tools/pr-verdict.py --repo <owner/repo> --sha <head sha> [--red "<why>"] [--dry-run]       Guard: tests/test_pr_verdict.py
"""
import argparse
import json
import os
import re
import subprocess
import sys
from datetime import datetime

CONTEXT = 'All checks passed'
E2E_PR_TITLE = 'E2E for PR · '   # e2e.yml run-name for a run pr-suites.yml started
BUDGET_MIN = 10
RED = {'failure', 'cancelled', 'timed_out', 'startup_failure', 'action_required', 'stale'}
CI_FILES = re.compile(r'^(\.github/|tools/pr-|desktop/e2e/(lib/plan|lib/pr-suites|lib/coverage|pr-suites\.mjs|plan-run\.mjs))')


def ci_change(files):
    return any(CI_FILES.match(file) for file in files)


def _at(text):
    return datetime.fromisoformat(str(text).replace('Z', '+00:00'))


def counted(runs):
    """The newest run of each workflow among those that judge this PR's commit."""
    mine = [r for r in runs if r.get('event') == 'pull_request' or str(r.get('displayTitle', '')).startswith(E2E_PR_TITLE)]
    newest = {}
    for r in sorted(mine, key=lambda r: (r.get('createdAt') or '', r.get('databaseId') or 0)):
        newest[r['workflowName']] = r
    return list(newest.values())


def verdict(runs, files=(), messages=()):
    """-> (state or None, description, the runs counted). None: no run of a pull request on this commit (nothing to write)."""
    live = counted(runs)
    if not live:
        return None, '', live
    short = lambda names: ', '.join(names)[:100]
    red = [r['workflowName'] for r in live if r.get('status') == 'completed' and r.get('conclusion') in RED]
    if red:
        return 'failure', f'red: {short(red)}'[:140], live
    running = [r['workflowName'] for r in live if r.get('status') != 'completed']
    if running:
        return 'pending', f'{len(running)} running: {short(running)}'[:140], live
    minutes = (max(_at(r['updatedAt']) for r in live) - min(_at(r['createdAt']) for r in live)).total_seconds() / 60
    if minutes > BUDGET_MIN and ci_change(files) and not any(re.search(r'(?m)^CI-budget: \S', m or '') for m in messages):
        return 'failure', f'checks took {minutes:.1f} min, over the {BUDGET_MIN}-min budget for a CI change (or "CI-budget: <why>")', live
    return 'success', f'{len(live)} workflow(s) green in {minutes:.1f} min', live


def gh(*args):
    return subprocess.run(['gh', *args], check=True, capture_output=True, text=True).stdout


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--repo', required=True); ap.add_argument('--sha', required=True)
    ap.add_argument('--red', default='', help='a red e2e suite: write failure now, without reading the runs')
    ap.add_argument('--dry-run', action='store_true')
    a = ap.parse_args()
    url = f"{os.environ.get('GITHUB_SERVER_URL', 'https://github.com')}/{a.repo}/actions/runs/{os.environ.get('GITHUB_RUN_ID', '')}"
    if a.red:
        state, why = 'failure', a.red[:140]
    else:
        runs = json.loads(gh('run', 'list', '-R', a.repo, '--commit', a.sha, '-L', '100', '--json',
                             'databaseId,workflowName,status,conclusion,event,createdAt,updatedAt,displayTitle'))
        files, messages = [], []
        number = gh('api', f'repos/{a.repo}/commits/{a.sha}/pulls', '--jq', '.[0].number // empty').strip()
        if number:
            files = gh('api', '--paginate', f'repos/{a.repo}/pulls/{number}/files', '--jq', '.[].filename').split()
            messages = json.loads(gh('api', f'repos/{a.repo}/pulls/{number}/commits?per_page=100', '--jq', '[.[].commit.message]') or '[]')
        state, why, live = verdict(runs, files, messages)
        for r in live:
            print(f"  {r.get('conclusion') or r.get('status'):10} {r['workflowName']}")
        if state is None:
            print(f'no pull request run on {a.sha[:7]}: nothing to write'); return 0
    print(f'{CONTEXT}: {state}: {why}')
    summary = os.environ.get('GITHUB_STEP_SUMMARY')
    if summary:
        with open(summary, 'a') as out: out.write(f'**{CONTEXT}** on `{a.sha[:7]}`: {state}: {why}\n')
    if not a.dry_run:
        gh('api', f'repos/{a.repo}/statuses/{a.sha}', '-f', f'state={state}', '-f', f'context={CONTEXT}', '-f', f'description={why}', '-f', f'target_url={url}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
