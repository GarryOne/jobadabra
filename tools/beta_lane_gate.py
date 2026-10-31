"""A beta never releases one lane alone: if either build failed, say which lane and which step, and fail the job.

Why (31 Oct 2026, a8; beta 41226261602, owner: a failed build in either lane must block the beta loudly): `Build · Mac` failed at its last step (the release upload), so its
E2E matrix, `Gate ran?` and `Release · Mac beta` were all skipped with no word, and `Release · Windows beta` ran alone and failed with "an E2E suite failed", a reason that
was not true. The release jobs and `Gate ran?` call this first:

    python3 tools/beta_lane_gate.py --mac "${{ needs.build.result }}" --windows "${{ needs.windows.result }}"

Both `success`: prints nothing and makes no API call. Otherwise one read of this run's jobs names each failed build and its failed step, and the exit is 1.
"""
import argparse
import json
import os
import subprocess
import sys

try:
    from .github_limit import GitHubLimit, run_gh
except ImportError:  # Direct workflow invocation: python3 tools/beta_lane_gate.py.
    from github_limit import GitHubLimit, run_gh

LANES = {'Mac': 'Build · Mac', 'Windows': 'Build · Windows'}


def failed_builds(jobs, results):
    """`jobs`: this run's jobs ({name, conclusion, steps: [{name, conclusion}]}); `results`: {'Mac': needs.build.result, 'Windows': needs.windows.result}
    -> one line per build that did not succeed: the failed step when the job recorded one, else how it ended."""
    lines = []
    for lane, name in LANES.items():
        result = results.get(lane, '')
        if result == 'success':
            continue
        job = next((j for j in jobs if j.get('name') == name), None)
        step = next((s['name'] for s in (job or {}).get('steps', []) if s.get('conclusion') == 'failure'), None)
        lines.append(f'{name} failed at the step "{step}"' if step else f'{name} ended {result or "unknown"}')
    return lines


def read_jobs(repo, run_id):
    """This run's jobs, one object per line from `gh api --paginate --jq` (a limit raises GitHubLimit)."""
    text = run_gh('api', '--paginate', f'repos/{repo}/actions/runs/{run_id}/jobs?per_page=100', '--jq', '.jobs[] | {name, conclusion, steps: [.steps[]? | {name, conclusion}]}')
    return [json.loads(line) for line in text.splitlines() if line.strip()]


def main(argv=None, jobs=None, out=print):
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--mac', required=True, help="needs.build.result")
    parser.add_argument('--windows', required=True, help="needs.windows.result")
    args = parser.parse_args(argv)
    results = {'Mac': args.mac, 'Windows': args.windows}
    if all(result == 'success' for result in results.values()):
        return 0
    why = ''
    try:
        read = jobs or (lambda: read_jobs(os.environ.get('GITHUB_REPOSITORY', ''), os.environ.get('GITHUB_RUN_ID', '')))
        found = read()
    except (GitHubLimit, subprocess.CalledProcessError, OSError, ValueError) as error:
        found, why = [], str(error)
    problems = failed_builds(found, results)
    out(f'::error::The beta was not released: {"; ".join(problems)}' + (f' ({why})' if why else ''))
    out('Both platforms wait for both builds: one lane is never released alone (owner, 30 Oct 2026). Fix the failed step above, then start the beta again.')
    return 1


if __name__ == '__main__':
    sys.exit(main())
