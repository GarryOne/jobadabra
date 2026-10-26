#!/usr/bin/env python3
"""A red e2e suite on main gets an owner (gate G2b, 26 Oct 2026): bisect it to the PR that broke it, tell that PR, and keep one `red-main` issue per suite.

  after-run <run id>        e2e.yml's alert job, after a scheduled main run: closes the `red-main` issue of each suite this run passed, and starts
                            e2e-bisect.yml for ONE red suite with no open issue whose cause is not the test environment (the next check starts the next)
  after-merge <run id>      e2e.yml's alert job, after the steps run after a merge (main-steps.yml): files each new red suite on the merged commit's
                            PR at once (no bisect: it is the one commit in range); closes nothing (a few green steps are not the suite)
  bisect <suite> <bad sha>  e2e-bisect.yml: finds the last main check where <suite> was green, runs <suite> on the commits in between (e2e.yml with
                            target_ref + bisect: titled "Bisect <suite> <sha>", never counted as a main check or filed by the Finder), then names the
                            first red commit's PR in a `red-main` issue ("Breaking PR: #n (branch `b`)") and on the PR itself. The session that
                            shipped branch b reads it at its next prompt (tools/pr-red-check.sh).
Why: 25 Oct 2026, main went red at 21:47 on cardstates, interactions and settings; the Finder filed an issue and no session was woken.
Tests: tests/test_e2e_bisect.py
"""
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from tools.e2e_causes import ENVIRONMENT_CAUSES, classify  # noqa: E402
from tools.main_e2e_state import NOT_SUITE, counts_green, suite_of  # noqa: E402

REPO = os.environ.get('GITHUB_REPOSITORY', 'GarryOne/jobadabra')
LABEL = 'red-main'
MAX_STEPS = 8          # 2^8 = 256 commits between green and red
POLL = int(os.environ.get('E2E_BISECT_POLL', '30'))
STEP_WAIT = int(os.environ.get('E2E_BISECT_STEP_S', '3600'))


def bisect(commits, test):
    """commits: oldest → newest; commits[0] was green, commits[-1] is red. test(sha) → 'success' | 'failure' | None (could not tell).
    Returns (first red sha or None, (lo, hi) the last known green/red indices, tested [(sha, result)])."""
    lo, hi, tested = 0, len(commits) - 1, []
    while hi - lo > 1 and len(tested) < MAX_STEPS:
        mid = (lo + hi) // 2
        result = test(commits[mid])
        tested.append((commits[mid], result))
        if result == 'success':
            lo = mid
        elif result == 'failure':
            hi = mid
        else:
            return None, (lo, hi), tested
    return (commits[hi] if hi - lo == 1 else None), (lo, hi), tested


def issue_title(suite):
    return f'Red main: {suite}'


def issue_body(suite, bad, run_url, found=None, pr=None, good=None, tested=(), candidates=()):
    lines = [f"Main's `{suite}` e2e suite is red since {bad[:7]} ([run]({run_url})).", '']
    if pr:
        lines.append(f"Breaking PR: #{pr['number']} (branch `{pr['branch']}`)")
        lines.append(f"First red commit: {found[:7]} · {pr['title']}")
    elif found:
        lines.append(f'First red commit: {found[:7]} (no pull request found for it)')
    else:
        lines.append('Breaking PR: not found. Commits still in range: ' + (', '.join(c[:7] for c in candidates) or '(none)'))
    if good:
        lines.append(f'Bisect: green at {good[:7]}; ' + (', '.join(f'{sha[:7]} {result or "unknown"}' for sha, result in tested) or 'one commit in range, no run needed'))
    lines += ['', f'Fix it now (skill fix-failing-e2e). This issue closes when the next main check passes `{suite}`; '
              'until then `tools/beta-release.sh` refuses a beta (gate G2a).']
    return '\n'.join(lines)


def gh(*args, check=True):
    out = subprocess.run(['gh', *args], capture_output=True, text=True)
    if check and out.returncode:
        raise RuntimeError(f"gh {' '.join(args[:3])}: {out.stderr.strip()[:200]}")
    return out.stdout.strip()


def gh_json(*args):
    return json.loads(gh(*args) or 'null')


def open_issues():
    return gh_json('issue', 'list', '-R', REPO, '--label', LABEL, '--state', 'open', '--json', 'number,title') or []


def jobs_of(run_id):
    return gh_json('api', f'repos/{REPO}/actions/runs/{run_id}/jobs?per_page=100', '--jq', '.jobs') or []


def log_of(job_id):
    return gh('run', 'view', '--job', str(job_id), '-R', REPO, '--log-failed', check=False)


def suite_results(jobs):
    out = {}
    for job in jobs:
        if job.get('name') in NOT_SUITE or job.get('conclusion') not in ('success', 'failure'):
            continue
        suite = suite_of(job['name'])
        out[suite] = 'failure' if job['conclusion'] == 'failure' or out.get(suite) == 'failure' else 'success'
    return out


def red_cause(jobs, suite):
    """The cause of `suite`'s red in this run, from its first failed job's log (tools/e2e_causes.py)."""
    job = next((j for j in jobs if j.get('name') not in NOT_SUITE and suite_of(j['name']) == suite and j.get('conclusion') == 'failure'), None)
    return classify(log_of(job['id']) if job and job.get('id') else '')[0]


def after_run(run_id):
    """Closes the issues of suites green again; starts ONE bisect, for the first new red whose cause is not the environment. The next main check starts
    the next. Why: 26 Oct 2026, the dead Claude key turned 10 suites red, 10 bisects started at once (one concurrency group per suite), each running
    the e2e suite on main's commits, and the job queue held PR checks for 20+ minutes; a key or service red has no breaking PR to find."""
    run = gh_json('api', f'repos/{REPO}/actions/runs/{run_id}')
    jobs = jobs_of(run_id)
    results = suite_results(jobs)
    issues = {i['title']: i['number'] for i in open_issues()}
    started = None
    for suite, result in sorted(results.items()):
        number = issues.get(issue_title(suite))
        if result == 'success' and number:
            gh('issue', 'close', str(number), '-R', REPO, '--comment', f"Main's `{suite}` passed again in {run['html_url']} ({run['head_sha'][:7]}).")
            print(f'closed #{number}: {suite} green again')
        elif result == 'failure' and not number:
            if started:
                print(f'{suite}: red, bisected after `{started}` (one bisect at a time: the next main check starts it)')
                continue
            cause = red_cause(jobs, suite)
            if cause in ENVIRONMENT_CAUSES:
                print(f'{suite}: red on the test environment ({cause}): not bisected, no PR broke it')
                continue
            gh('workflow', 'run', 'e2e-bisect.yml', '-R', REPO, '--ref', 'main', '-f', f'suite={suite}', '-f', f"bad={run['head_sha']}", '-f', f"run_url={run['html_url']}")
            print(f'bisect started: {suite} red at {run["head_sha"][:7]} ({cause})')
            started = suite


def after_merge(run_id):
    """The steps a merge touched went red: that merge broke them (or they were red already and have an issue). Every new product red is filed on its PR."""
    run = gh_json('api', f'repos/{REPO}/actions/runs/{run_id}')
    jobs = jobs_of(run_id)
    issues = {i['title'] for i in open_issues()}
    for suite, result in sorted(suite_results(jobs).items()):
        if result != 'failure' or issue_title(suite) in issues:
            continue
        cause = red_cause(jobs, suite)
        if cause in ENVIRONMENT_CAUSES:
            print(f'{suite}: red on the test environment ({cause}): not filed, no PR broke it')
            continue
        bad = run['head_sha']
        pr = pr_of(bad)
        report(suite, issue_body(suite, bad, run['html_url'], found=bad, pr=pr) + '\n\nFound by the steps run after this merge (main-steps.yml): no bisect needed.', pr)


def last_green(suite, bad, is_ancestor):
    runs = gh_json('api', f'repos/{REPO}/actions/workflows/e2e.yml/runs?branch=main&status=completed&per_page=100', '--jq', '.workflow_runs') or []
    for run in runs:
        if not counts_green(run) or run['head_sha'] == bad or not is_ancestor(run['head_sha'], bad):
            continue
        if suite_results(jobs_of(run['id'])).get(suite) == 'success':
            return run['head_sha']
    return None


def run_suite_at(suite, sha):
    since = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(time.time() - 5))
    gh('workflow', 'run', 'e2e.yml', '-R', REPO, '--ref', 'main', '-f', f'suite={suite}', '-f', f'target_ref={sha}', '-f', 'fixed=true', '-f', 'bisect=true')
    title, start, rid = f'Bisect {suite} {sha}', time.time(), None
    while time.time() - start < STEP_WAIT:
        if rid is None:
            found = gh('api', f'repos/{REPO}/actions/workflows/e2e.yml/runs?event=workflow_dispatch&branch=main&per_page=20', '--jq',
                       f'.workflow_runs[] | select(.created_at >= "{since}" and .display_title == "{title}") | .id', check=False)
            rid = (found.split() or [None])[-1]
        if rid:
            state = gh('api', f'repos/{REPO}/actions/runs/{rid}', '--jq', '"\\(.status) \\(.conclusion // "-")"', check=False)
            if state.startswith('completed '):
                conclusion = state.split(' ', 1)[1]
                print(f'  {sha[:7]}: {conclusion} https://github.com/{REPO}/actions/runs/{rid}')
                return suite_results(jobs_of(rid)).get(suite) if conclusion in ('success', 'failure') else None
        time.sleep(POLL)
    return None


def pr_of(sha):
    pulls = gh_json('api', f'repos/{REPO}/commits/{sha}/pulls') or []
    merged = [p for p in pulls if p.get('merged_at')] or pulls
    return {'number': merged[0]['number'], 'branch': merged[0]['head']['ref'], 'title': merged[0]['title']} if merged else None


def git(*args):
    return subprocess.run(['git', *args], capture_output=True, text=True)


def report(suite, body, pr):
    gh('label', 'create', LABEL, '-R', REPO, '--force', '--color', 'B60205', '--description', "A main e2e suite went red: its breaking PR and the bisect", check=False)
    existing = {i['title']: i['number'] for i in open_issues()}.get(issue_title(suite))
    if existing:
        gh('issue', 'edit', str(existing), '-R', REPO, '--body', body)
        number = existing
    else:
        url = gh('issue', 'create', '-R', REPO, '--title', issue_title(suite), '--label', LABEL, '--body', body)
        number = int(re.search(r'/issues/(\d+)', url).group(1))
    if pr:
        gh('pr', 'comment', str(pr['number']), '-R', REPO, '--body',
           f"🔴 Main's `{suite}` e2e suite went red with this PR (bisect in #{number}). Fix it now: skill fix-failing-e2e, push the fix through tools/ship.sh.")
    print(f'reported in #{number}')


def run_bisect(suite, bad, run_url):
    good = last_green(suite, bad, lambda a, b: git('merge-base', '--is-ancestor', a, b).returncode == 0)
    if not good:
        report(suite, issue_body(suite, bad, run_url, candidates=[bad]) + '\n\nNo green main check of this suite in the last 100 runs: nothing to bisect from.', None)
        return
    commits = [good] + [c for c in git('rev-list', '--first-parent', '--reverse', f'{good}..{bad}').stdout.split() if c]
    print(f'{suite}: green at {good[:7]}, red at {bad[:7]}, {len(commits) - 1} commit(s) in range')
    found, (lo, hi), tested = bisect(commits, lambda sha: run_suite_at(suite, sha))
    pr = pr_of(found) if found else None
    report(suite, issue_body(suite, bad, run_url, found=found, pr=pr, good=good, tested=tested, candidates=commits[lo + 1:hi + 1]), pr)


def main(argv):
    if argv[:1] == ['after-run'] and len(argv) == 2:
        after_run(argv[1])
    elif argv[:1] == ['after-merge'] and len(argv) == 2:
        after_merge(argv[1])
    elif argv[:1] == ['bisect'] and len(argv) >= 3:
        run_bisect(argv[1], argv[2], argv[3] if len(argv) > 3 else '')
    else:
        print(__doc__)
        return 2
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
