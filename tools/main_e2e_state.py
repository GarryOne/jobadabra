#!/usr/bin/env python3
"""Main's e2e state per suite: which suites are red on main now, from the newest main-check run of each (gate G2, 26 Oct 2026).

A suite's state is its newest finished job (green or red) in a run that checks main's own code: the scheduled runs ("E2E check · ...") and runs by hand on
main ("E2E Mac + Linux · <suites> · main"). Not: mutation tests (red on purpose), RC soaks, the stable canary, release gates and bisect runs (they test other
commits). A by-hand re-run of one suite clears that suite only. Used by tools/beta-release.sh: no beta starts while main is red.
Why: 25 Oct 2026, main's 21:47 run was red on cardstates, interactions and settings; beta 2 started 1.5 h later on the same reds and nobody was told.

  tools/main_e2e_state.py [--repo o/r] [--json]     prints the red suites (one line each), or JSON; exit 0 either way
Tests: tests/test_main_e2e_state.py
"""
import json
import re
import subprocess
import sys

REPO = 'GarryOne/jobadabra'
# Runs that do not check main's own code as it is.
NOT_MAIN_CHECK = re.compile(r'^(Mutant|RC soak|Stable canary|Beta E2E tests|Gate|Bisect) ')
# Jobs of e2e.yml that are not a suite.
NOT_SUITE = {'plan', 'HTML report', 'promote', 'Telegram alert', 'Windows follows', 'Nothing tested'}
MAX_RUNS = 15   # main-check runs read, newest first (two days of schedule plus re-runs)


def suite_of(job_name):
    """`recorded-2of5` → `recorded`: a sharded suite is red when any slice is."""
    return re.sub(r'-\d+of\d+$', '', job_name)


def is_main_check(run):
    return run.get('head_branch') == 'main' and run.get('conclusion') in ('success', 'failure') and not NOT_MAIN_CHECK.match(run.get('display_title') or '')


def state(runs, jobs_of):
    """runs: e2e.yml runs newest first ({id, head_branch, head_sha, conclusion, display_title, created_at, html_url}); jobs_of(run_id) → [{name, conclusion}].
    Returns {suite: {'conclusion', 'sha', 'url', 'at'}} from each suite's newest finished job."""
    out = {}
    for run in [r for r in runs if is_main_check(r)][:MAX_RUNS]:
        slices = {}
        for job in jobs_of(run['id']):
            if job.get('name') in NOT_SUITE or job.get('conclusion') not in ('success', 'failure'):
                continue
            suite = suite_of(job['name'])
            slices[suite] = 'failure' if job['conclusion'] == 'failure' or slices.get(suite) == 'failure' else 'success'
        for suite, conclusion in slices.items():
            out.setdefault(suite, {'conclusion': conclusion, 'sha': run['head_sha'], 'url': run.get('html_url', ''), 'at': run.get('created_at', '')})
    return out


def red(st):
    return sorted(((suite, s) for suite, s in st.items() if s['conclusion'] == 'failure'), key=lambda item: item[0])


def gh_json(args):
    return json.loads(subprocess.run(['gh', *args], check=True, capture_output=True, text=True).stdout or 'null')


def live(repo):
    runs = gh_json(['api', f'repos/{repo}/actions/workflows/e2e.yml/runs?branch=main&status=completed&per_page=60', '--jq', '.workflow_runs'])
    return state(runs, lambda rid: gh_json(['api', f'repos/{repo}/actions/runs/{rid}/jobs?per_page=100', '--jq', '.jobs']) or [])


def main(argv):
    repo = argv[argv.index('--repo') + 1] if '--repo' in argv else REPO
    try:
        st = live(repo)
    except (subprocess.CalledProcessError, json.JSONDecodeError, OSError) as error:
        print(f'main_e2e_state: could not read main\'s e2e runs ({error}); unknown', file=sys.stderr)
        print(json.dumps({'unknown': True}) if '--json' in argv else '')
        return 0
    reds = red(st)
    if '--json' in argv:
        print(json.dumps({'red': [{'suite': suite, **s} for suite, s in reds]}))
    else:
        for suite, s in reds:
            print(f"{suite}\t{s['sha'][:7]}\t{s['at']}\t{s['url']}")
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
