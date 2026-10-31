#!/usr/bin/env python3
"""Main's e2e state per suite: which suites are red on main now, from the newest main-check run of each (gate G2, 26 Oct 2026).

A suite's state is its newest finished job (green or red) in a run that checks main's own code: the scheduled runs ("E2E check · ...") and runs by hand on
main ("E2E Mac + Linux · <suites> · main"). Not: mutation tests (red on purpose), RC soaks, the stable canary, release gates and bisect runs (they test other
commits). A by-hand re-run of one suite clears that suite only. The steps run after a merge ("E2E after merge · <sha> · <suites>", main-steps.yml) count
for red only: their red names that commit; their green covers a few steps, never the suite, so it clears nothing. Used by tools/beta-release.sh: no beta starts while main is red.
Why: 25 Oct 2026, main's 21:47 run was red on cardstates, interactions and settings; beta 2 started 1.5 h later on the same reds and nobody was told.

  tools/main_e2e_state.py [--repo o/r] [--json]     prints the red suites (one line each), or JSON; exit 0 either way
Tests: tests/test_main_e2e_state.py
"""
import json
import re
import subprocess
import sys
from pathlib import Path

REPO = 'GarryOne/jobadabra'
LANES = Path(__file__).resolve().parent.parent / 'desktop/e2e/lanes.json'
# Runs that do not check main's own code as it is.
NOT_MAIN_CHECK = re.compile(r'^(Mutant|RC soak|Stable canary|Beta E2E tests|Grey beta check|Gate|Bisect|E2E check · outside world) ')   # the outside world is health, never main's state (#2502)
# Jobs of e2e.yml that are not a suite.
NOT_SUITE = {'plan', 'HTML report', 'promote', 'Telegram alert', 'Windows follows', 'Nothing tested', 'AI credit health'}
AFTER_MERGE = 'E2E after merge · '   # e2e.yml run-name for the steps main-steps.yml starts after a merge
MAX_RUNS = 15   # main-check runs read, newest first (two days of schedule plus re-runs)


GREY_TITLE = 'Grey: the runner, not the app'


def is_grey(annotations):
    """Only the proof step's exact annotation title identifies a grey job."""
    return any(note.get('title') == GREY_TITLE for note in annotations)


def annotations_of(repo, job_id, github):
    """Read all check-run annotations through the caller's transport; absent evidence stays red."""
    if job_id is None:
        return []
    try:
        pages = json.loads(github('api', '--paginate', '--slurp', f'repos/{repo}/check-runs/{job_id}/annotations?per_page=100'))
        if not isinstance(pages, list) or any(not isinstance(page, list) or any(not isinstance(note, dict) for note in page) for page in pages):
            return []
        return [note for page in pages for note in page]
    except (OSError, ValueError, TypeError, subprocess.CalledProcessError):
        return []


def suite_of(job_name):
    """Job key → suite, without burn-in, store-leg or shard suffixes; any backbone slice can be red."""
    key = re.sub(r'^E2E · (?:Mac \+ Linux · )?', '', job_name)
    key = re.sub(r' · burn-in \d+/\d+$', '', key)
    key = re.sub(r'-(?:standin|sqlite)$', '', key)
    return re.sub(r'-\d+of\d+$', '', key)


def is_main_check(run):
    return run.get('head_branch') == 'main' and run.get('conclusion') in ('success', 'failure') and not NOT_MAIN_CHECK.match(run.get('display_title') or '')


def counts_green(run):
    """A main check whose green clears a suite: not the few steps run after a merge."""
    return is_main_check(run) and not (run.get('display_title') or '').startswith(AFTER_MERGE)


def state(runs, jobs_of, annotations=lambda jid: []):
    """runs: e2e.yml runs newest first ({id, head_branch, head_sha, conclusion, display_title, created_at, html_url}); jobs_of(run_id) → [{id, name, conclusion}].
    Returns {suite: {'conclusion', 'sha', 'url', 'at', 'jobs'}} from each suite's newest finished job; 'jobs': the ids of its red jobs in that run
    (tools/pr-verdict.py reads their failure lines to tell main's own red from a PR's)."""
    out = {}
    for run in [r for r in runs if is_main_check(r)][:MAX_RUNS]:
        slices, reds = {}, {}
        for job in jobs_of(run['id']):
            if job.get('name') in NOT_SUITE or job.get('conclusion') not in ('success', 'failure'):
                continue
            suite = suite_of(job['name'])
            conclusion = job['conclusion']
            if is_grey(annotations(job.get('id'))):
                conclusion = 'grey'
            priority = {'success': 0, 'grey': 1, 'failure': 2}
            if priority[conclusion] > priority.get(slices.get(suite), -1):
                slices[suite] = conclusion
            if conclusion == 'failure':
                reds.setdefault(suite, []).append(job.get('id'))
        for suite, conclusion in slices.items():
            if conclusion == 'success' and not counts_green(run):
                continue
            out.setdefault(suite, {'conclusion': conclusion, 'sha': run['head_sha'], 'url': run.get('html_url', ''), 'at': run.get('created_at', ''), 'jobs': reds.get(suite, [])})
    return out


def lane_suites(lanes=('tolerant', 'suspended', 'retired')):
    """Read checkout suites in the requested lanes; a missing, unreadable or malformed registry excludes nothing."""
    try:
        registry = json.loads(LANES.read_text(encoding='utf-8'))
        if not isinstance(registry, dict) or not isinstance(registry.get('suites'), dict):
            return set()
        entries = registry['suites']
        if any(not isinstance(entry, dict) for entry in entries.values()):
            return set()
        return {suite for suite, entry in entries.items() if entry.get('lane') in lanes}
    except (OSError, ValueError):
        return set()


def red(st, excluded=None):
    """Blocking backbone reds only; tolerant, suspended and retired results never make main red."""
    # Why (30 Oct 2026, owner): rule D reports non-backbone results as rates or suspensions, never red main.
    excluded = lane_suites() if excluded is None else excluded
    return sorted(((suite, s) for suite, s in st.items() if s['conclusion'] == 'failure' and suite not in excluded), key=lambda item: item[0])


def gh_json(args):
    # UTF-8, not the locale: pr-verdict.py also runs this on Windows runners, where text=True decodes as cp1252 (#2062)
    return json.loads(subprocess.run(['gh', *args], check=True, capture_output=True, encoding='utf-8').stdout or 'null')


def live(repo):
    runs = gh_json(['api', f'repos/{repo}/actions/workflows/e2e.yml/runs?branch=main&status=completed&per_page=60', '--jq', '.workflow_runs'])
    return state(runs, lambda rid: gh_json(['api', f'repos/{repo}/actions/runs/{rid}/jobs?per_page=100', '--jq', '.jobs']) or [],
                 lambda jid: annotations_of(repo, jid, lambda *args: json.dumps(gh_json(list(args)))))


def main(argv):
    repo = argv[argv.index('--repo') + 1] if '--repo' in argv else REPO
    try:
        st = live(repo)
    except (subprocess.CalledProcessError, json.JSONDecodeError, OSError) as error:
        print(f'main_e2e_state: could not read main\'s e2e runs ({error}); unknown', file=sys.stderr)
        print(json.dumps({'unknown': True}) if '--json' in argv else '')
        return 3   # unknown is never green: the gate refuses a beta on it
    suspended = lane_suites(('suspended',))
    reds = red(st)
    if '--json' in argv:
        print(json.dumps({'grey': [{'suite': suite, **s} for suite, s in sorted(st.items()) if s['conclusion'] == 'grey'],
                          'red': [{'suite': suite, **s} for suite, s in reds],
                          'suspended': [{'suite': suite, **st[suite]} for suite in sorted(suspended) if suite in st]}))
    else:
        for suite, s in reds:
            print(f"{suite}\t{s['sha'][:7]}\t{s['at']}\t{s['url']}")
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
