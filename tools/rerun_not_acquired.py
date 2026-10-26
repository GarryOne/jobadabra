"""Re-runs, once, the e2e jobs GitHub never started: a job that got no runner ("The job was not acquired by Runner of type hosted even after multiple
attempts", ran 0 steps) is GitHub's capacity, not a red suite. Beta 3 (run 40341958250, 26 Oct 2026): interactions waited 29 min for a macOS runner,
was cancelled with no log, and read as "hit the 30-min job limit"; the Free plan runs 5 macOS jobs at once and a beta needs 7.
A real red stays red: when any job that ran failed, nothing is re-run (the run is red anyway; the next beta tests the never-started suite).
Called by .github/workflows/rerun-not-acquired.yml when a beta or e2e run ends. Tests: tests/test_rerun_not_acquired.py
"""
import json
import os
import re
import subprocess
import sys

NOT_ACQUIRED = re.compile(r'not acquired by Runner', re.I)
BAD = ('failure', 'cancelled', 'timed_out', 'startup_failure')
DOWNSTREAM = ('Release · ',)   # fail only because an E2E job before them did (needs: test-mac / test-windows); re-run with it


def never_started(job, annotations):
    """GitHub gave this job no runner: it ran no step, and its annotation says so."""
    return (job.get('conclusion') in BAD and not job.get('steps') and not job.get('runner_name')
            and any(NOT_ACQUIRED.search(a.get('message', '')) for a in annotations.get(str(job['id']), [])))


def decide(jobs, annotations):
    """(action, never-started job names, real red job names): 'rerun' when every red of the run is a never-started job or downstream of one."""
    missed = [j for j in jobs if never_started(j, annotations)]
    ids = {j['id'] for j in missed}
    reds = [j for j in jobs if j.get('conclusion') in BAD and j['id'] not in ids and not j.get('name', '').startswith(DOWNSTREAM)]
    action = 'rerun' if missed and not reds else 'keep'
    return action, [j['name'] for j in missed], [j['name'] for j in reds]


def gh_json(*args):
    out = subprocess.run(['gh', *args], capture_output=True, text=True, check=True).stdout
    return [json.loads(line) for line in out.splitlines() if line.strip()]


def main(argv):
    run_id, repo = argv[0], os.environ.get('GITHUB_REPOSITORY', 'GarryOne/jobadabra')
    attempt = int(os.environ.get('RUN_ATTEMPT', '1'))
    if attempt > 1:
        print(f'run {run_id} is attempt {attempt}: never-started jobs are re-run once only')
        return 0
    jobs = gh_json('api', '--paginate', f'repos/{repo}/actions/runs/{run_id}/jobs?per_page=100',
                   '--jq', '.jobs[] | {id, name, conclusion, runner_name, steps: (.steps | length)}')
    annotations = {}
    for job in jobs:
        if job.get('conclusion') in BAD and not job.get('steps'):
            annotations[str(job['id'])] = gh_json('api', f"repos/{repo}/check-runs/{job['id']}/annotations", '--jq', '.[] | {message}')
    action, missed, reds = decide(jobs, annotations)
    if not missed:
        print(f'run {run_id}: every job got a runner')
        return 0
    print(f"run {run_id}: GitHub gave no runner to: {', '.join(missed)} (infra: GitHub's capacity, not a red suite)")
    if action == 'keep':
        print(f"not re-run: the run is red anyway on {', '.join(reds)} (a real red stays red; the next run tests them)")
        return 0
    if '--dry-run' in argv:
        print('dry run: would re-run them once')
        return 0
    subprocess.run(['gh', 'run', 'rerun', run_id, '--failed', '-R', repo], check=True)   # the never-started jobs and the Release jobs that waited on them
    print(f're-run once: {", ".join(missed)}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
