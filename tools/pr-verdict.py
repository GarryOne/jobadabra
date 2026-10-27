#!/usr/bin/env python3
"""Writes a pull request's one required status, "All checks passed", from the state of every workflow run of its head commit, in seconds.

Every job a pull request starts runs it as its last step, "Write the PR's verdict" (--job-status): the job it runs in counts as ended with that status, so the
status lands within seconds of the last check (owner on #2042, 26 Oct 2026: "it shows green, but I cannot merge": a separate verdict job waited minutes for one of
the ~20 busy runners). Of jobs ending together, the one with the highest id waits a few seconds for the others' ends and writes; the rest leave it to it.
A run whose jobs all ended but which is not marked ended ("settling") is waited on for a few seconds: it may be about to create the jobs that need them. So a job
that a deciding job needs (e2e's plan, page-cases' replays) has no verdict step: it would see its own run as ended before its dependents exist.
pr-verdict.yml (workflow_run) runs it again when a workflow ends, as a backstop. No job holds a runner to wait (owner, 26 Oct 2026: "How could you design such a
slow and inefficient method of checking PRs?"; on #1992 two polling jobs took 43 of 206 runner-minutes of one push). A merged or closed PR gets nothing (#2041).
Counted: the runs of the commit started by the pull request, and the e2e run pr-suites.yml started for it (title "E2E for PR · ..."): a red suite blocks the merge
(gate G1a; the owner rejected report only, 26 Oct 2026). The newest run of each workflow
decides (a description edit re-runs the gate; a re-run replaces a red). Any red: failure at once. Any running: pending. All green or skipped: success, with the wall time.
Budget (owner's yes, 26 Oct 2026): a PR that changes how CI runs PRs (ci_change) and whose checks RAN over BUDGET_MIN goes red, unless a commit of it says
"CI-budget: <why>". Each slowdown so far (781637a, bc585e3, a7a6a9f, 7083bb7) landed without saying a PR's time.
Running time, not queue (owner, 27 Oct 2026: "Count running time only": "Red only when the PR's own jobs run over 10 min; queue wait is still shown on the PR"):
the wall-clock minutes while at least one of the PR's jobs runs (running_minutes; parallel jobs count once, a stretch where every job waits for a runner not at
all). #2215 took 12.4 min, of which its jobs ran 7.x and waited the rest; summed job time (12.0) would punish parallel jobs. The wait stays in the status text.
  tools/pr-verdict.py --repo <owner/repo> --sha <head sha> [--job-status <success|failure|cancelled>] [--dry-run]       Guard: tests/test_pr_verdict.py
"""
import argparse
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timezone

CONTEXT = 'All checks passed'
E2E_PR_TITLE = 'E2E for PR · '   # e2e.yml run-name for a run pr-suites.yml started
BUDGET_MIN = 10
STEP = "Write the PR's verdict"   # the last step of every PR job (tests/test_pr_verdict.py checks each one has it)
# Jobs that only report (an HTML report, a results upload) never hold or turn the verdict: on #2044 the settings suite was green at 04:36 and the PR waited on
# e2e's "HTML report" queued for a runner (owner, 26 Oct 2026: "again, why I cannot merge this PR?").
REPORT_JOBS = {'HTML report', 'Windows HTML report', 'AI review of the screenshots'}   # never decide a PR (page-cases' report does: its fill time vs main; it gets the verdict step). The review: after the suites, on main and release runs only (.github/actions/e2e-review)
RED = {'failure', 'cancelled', 'timed_out', 'startup_failure', 'action_required', 'stale'}
CI_FILES = re.compile(r'^(\.github/|tools/pr-|desktop/e2e/(lib/plan|lib/pr-suites|lib/coverage|pr-suites\.mjs|plan-run\.mjs))')
# The workflows a pull request can start: a pull_request trigger, or started by one of them. A workflow outside it (the users' Always On daily/scout/mail.yml,
# the nightly, a release) never runs on a PR, so editing it does not slow a PR: #2137 went red at 11.4 min, every check green, for daily/scout/mail.yml.
# Guard: tests/test_pr_verdict.py recomputes it from .github/workflows (a new PR workflow fails there until listed).
PR_WORKFLOWS = {'beta-approve.yml', 'e2e-windows.yml', 'e2e.yml', 'extension-store-publish.yml', 'harness.yml', 'hosted-probe.yml', 'key-org-proof.yml', 'prompt-cases.yml',
                'office-addon.yml', 'page-cases.yml', 'pr-closed-cancel.yml', 'pr-gate.yml', 'pr-suites.yml', 'ready-fill-image.yml', 'search-personas.yml', 'tests-desktop-windows.yml',
                'tests-desktop.yml', 'tests-python.yml', 'tests-worker.yml'}


def ci_change(files):
    workflow = re.compile(r'^\.github/workflows/([^/]+)$')
    return any(CI_FILES.match(file) and (not workflow.match(file) or workflow.match(file).group(1) in PR_WORKFLOWS) for file in files)


def _at(text):
    return datetime.fromisoformat(str(text).replace('Z', '+00:00'))


def counted(runs):
    """The newest run of each workflow among those that judge this PR's commit."""
    mine = [r for r in runs if r.get('event') == 'pull_request' or str(r.get('displayTitle', '')).startswith(E2E_PR_TITLE)]
    newest = {}
    for r in sorted(mine, key=lambda r: (r.get('createdAt') or '', r.get('databaseId') or 0)):
        newest[r['workflowName']] = r
    return list(newest.values())


def job_state(job, me=None, my_status=''):
    """One job of a running workflow -> 'running', 'finishing' (only its verdict step and clean-up are left) or its conclusion."""
    if me is not None and job.get('id') == me:
        return {'success': 'success', 'failure': 'failure'}.get(my_status, 'cancelled')
    if job.get('status') == 'completed':
        return job.get('conclusion') or 'success'
    steps = job.get('steps') or []
    left = [st for st in steps if st.get('status') != 'completed' and st.get('name') != STEP and not str(st.get('name', '')).startswith('Post ') and st.get('name') != 'Complete job']
    return 'finishing' if any(st.get('name') == STEP for st in steps) and not left else 'running'


def clock(at):
    """'07:04 Zurich' (the owner's time); 'HH:MM UTC' where Python has no time-zone data (Windows runners)."""
    try:
        from zoneinfo import ZoneInfo
        return at.astimezone(ZoneInfo('Europe/Zurich')).strftime('%H:%M Zurich')
    except Exception:   # zoneinfo missing, or no tz database (ZoneInfoNotFoundError)
        return at.astimezone(timezone.utc).strftime('%H:%M UTC')


def label(r, running_jobs=()):
    """How the status names a run it waits for: the PR's e2e run by its suites (the run is not in the PR's checks list), others by workflow."""
    title = str(r.get('displayTitle', ''))
    if title.startswith(E2E_PR_TITLE):
        return 'e2e ' + (', '.join(running_jobs) or title[len(E2E_PR_TITLE):].split(' · ')[0])
    return r['workflowName'].replace('CI · ', '')


def running_minutes(spans, now=None):
    """[(started_at, completed_at or None)] of every job that started -> minutes while at least one ran (overlaps count once). None: no span to read."""
    now = now or datetime.now(timezone.utc)
    parts = sorted((_at(start), _at(end) if end else now) for start, end in spans if start)
    if not parts:
        return None
    total, (lo, hi) = 0.0, parts[0]
    for start, end in parts[1:]:
        if start > hi:
            total += (hi - lo).total_seconds(); lo, hi = start, end
        else:
            hi = max(hi, end)
    return (total + (hi - lo).total_seconds()) / 60


def verdict(runs, files=(), messages=(), jobs=None, me=None, my_status='', now=None, spans=None):
    """-> (state or None, description, the runs counted, the ids of other jobs finishing now, the run to link). None: no run of a pull request on this commit.
    jobs: {run id: [job]} for the runs read job by job (not ended, or red); me: the id of the job this runs in, my_status its status so far.
    spans: [(started_at, completed_at)] of every job of the counted runs (a CI change only, job_spans): the budget counts their running time, else the wall time."""
    live = counted(runs)
    if not live:
        return None, '', live, [], None
    now = now or datetime.now(timezone.utc)   # a run still ending (its jobs done or finishing) ends about now
    short = lambda names: ', '.join(names)[:110]
    red, running, finishing, settling = [], [], [], []
    for r in live:
        listed = (jobs or {}).get(r.get('databaseId'))
        if listed is None:
            if r.get('status') != 'completed': running.append((r, []))
            elif r.get('conclusion') in RED: red.append(r)
            continue
        states = [(job, job_state(job, me, my_status)) for job in listed if job.get('name') not in REPORT_JOBS]
        ending = [job['id'] for job, state in states if state == 'finishing' or job.get('id') == me]
        if any(state in RED for _, state in states): red.append(r)
        elif (not states and r.get('status') != 'completed') or any(state == 'running' for _, state in states):
            running.append((r, [job['name'] for job, state in states if state == 'running']))
        elif r.get('status') != 'completed' and not ending: settling.append(r)   # all its jobs ended, yet the run is not: about to end, or to create the jobs that need them
        else: finishing += [job['id'] for job, state in states if state == 'finishing']
    if red:
        return 'failure', f'red: {short(label(r) for r in red)}'[:140], live, [], red[0].get('databaseId')
    if settling and not running:
        return 'settling', f'{short(label(r) for r in settling)} ending', live, [], None
    if running:
        # A clock time, never minutes so far: the status is written only when a job ends, so a counter froze between writes (26 Oct 2026, the owner: "it stays
        # like that: 'waiting 3 min: e2e quality' for more than 5 minutes. this is a bug").
        since = clock(min(_at(r['createdAt']) for r, _ in running))
        first = next((r for r, _ in running if str(r.get('displayTitle', '')).startswith(E2E_PR_TITLE)), running[0][0])
        return 'pending', f'{short(label(r, names) for r, names in running)} running since {since}'[:140], live, [], first.get('databaseId')
    minutes = (max(_at(r['updatedAt']) if r.get('status') == 'completed' else now for r in live) - min(_at(r['createdAt']) for r in live)).total_seconds() / 60
    ran = running_minutes(spans, now) if spans else None
    took = f'{minutes:.1f} min' if ran is None else f'{ran:.1f} min running + {max(0.0, minutes - ran):.1f} min waiting for runners'
    if (minutes if ran is None else ran) > BUDGET_MIN and ci_change(files) and not any(re.search(r'(?m)^CI-budget: \S', m or '') for m in messages):
        return 'failure', f'checks ran {took}, over the {BUDGET_MIN}-min budget for a CI change (or "CI-budget: <why>")'[:140], live, finishing, None
    return 'success', f'{len(live)} workflow(s) green in {took}'[:140], live, finishing, None


def job_spans(repo, runs):
    """[(started_at, completed_at)] of every job of the counted runs (one call per run; only for a CI change, the one kind of PR with a budget)."""
    spans = []
    for r in counted(runs):
        for j in json.loads(gh('api', f"repos/{repo}/actions/runs/{r['databaseId']}/jobs?per_page=100", '--jq', '[.jobs[] | {started_at, completed_at, name}]') or '[]'):
            if j.get('name') not in REPORT_JOBS:
                spans.append((j.get('started_at'), j.get('completed_at')))
    return spans


def gh(*args):
    # UTF-8 always: on a Windows runner text=True alone decodes as cp1252, "E2E for PR · " no longer matched, and #2062's Windows job wrote a false green
    # while the Linux e2e run still ran.
    return subprocess.run(['gh', *args], check=True, capture_output=True, encoding='utf-8').stdout


def leave_it(finishing, me):
    """Jobs ending together: the one with the highest id writes (it waits for the others' ends); the backstop (me None) leaves it to them."""
    return bool(finishing) and (me is None or max(finishing) > me)


def open_pr(pulls):
    """-> (number or '', whether to write). A commit no PR names (a dispatched e2e run's branch) is written; one whose PRs are all merged or closed is not (#2041)."""
    if not pulls:
        return '', True
    live = [p for p in pulls if p.get('state') == 'open' and not p.get('merged_at')]
    return (str(live[0]['number']), True) if live else ('', False)


def read(repo, sha, my_run):
    runs = json.loads(gh('run', 'list', '-R', repo, '--commit', sha, '-L', '100', '--json',
                         'databaseId,workflowName,status,conclusion,event,createdAt,updatedAt,displayTitle'))
    jobs = {}
    for r in counted(runs):
        if r.get('status') != 'completed' or r.get('conclusion') in RED or str(r.get('databaseId')) == my_run:
            jobs[r['databaseId']] = json.loads(gh('api', f"repos/{repo}/actions/runs/{r['databaseId']}/jobs?per_page=100", '--jq', '.jobs'))
    return runs, jobs


def main():
    sys.stdout.reconfigure(encoding='utf-8')   # a Windows runner's console is cp1252
    ap = argparse.ArgumentParser()
    ap.add_argument('--repo', required=True); ap.add_argument('--sha', required=True)
    ap.add_argument('--job-status', default='', help="the status so far of the job this step ends (${{ job.status }}); empty: the workflow_run backstop")
    ap.add_argument('--dry-run', action='store_true')
    a = ap.parse_args()
    my_run = os.environ.get('GITHUB_RUN_ID', '')
    server = os.environ.get('GITHUB_SERVER_URL', 'https://github.com')
    number, write = open_pr(json.loads(gh('api', f'repos/{a.repo}/commits/{a.sha}/pulls', '--jq', '[.[] | {number, state, merged_at}]') or '[]'))
    if not write:
        print(f'the pull request of {a.sha[:7]} is merged or closed: nothing to write'); return 0
    files, messages = [], []
    if number:
        files = gh('api', '--paginate', f'repos/{a.repo}/pulls/{number}/files', '--jq', '.[].filename').split()
        messages = json.loads(gh('api', f'repos/{a.repo}/pulls/{number}/commits?per_page=100', '--jq', '[.[].commit.message]') or '[]')
    me = None
    for attempt in range(20):   # at most ~60 s, only while jobs with a lower id end with us
        runs, jobs = read(a.repo, a.sha, my_run)
        if a.job_status and me is None:
            mine = [j for j in jobs.get(int(my_run or 0), []) if j.get('status') != 'completed' and j.get('runner_name') == os.environ.get('RUNNER_NAME')]
            me = mine[0]['id'] if mine else None
        spans = job_spans(a.repo, runs) if ci_change(files) and not any(r.get('status') != 'completed' for r in counted(runs) if str(r.get('databaseId')) != my_run) else None
        state, why, live, finishing, target = verdict(runs, files, messages, jobs, me, a.job_status, spans=spans)
        if state in (None, 'failure', 'pending') or (state != 'settling' and not finishing):
            break
        if state != 'settling' and leave_it(finishing, me):
            print(f'{CONTEXT}: job(s) {finishing} end with this one and write it'); return 0
        time.sleep(3)
    else:
        state, why, target = 'pending', f'still ending: {why}'[:140], None
    for r in live:
        print(f"  {r.get('conclusion') or r.get('status'):10} {r['workflowName']}")
    if state is None:
        print(f'no pull request run on {a.sha[:7]}: nothing to write'); return 0
    print(f'{CONTEXT}: {state}: {why}')
    url = f'{server}/{a.repo}/actions/runs/{target or my_run}'   # the run it waits on, or the red one: the PR's e2e run is not in its checks list
    if not a.dry_run:
        gh('api', f'repos/{a.repo}/statuses/{a.sha}', '-f', f'state={state}', '-f', f'context={CONTEXT}', '-f', f'description={why}', '-f', f'target_url={url}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
