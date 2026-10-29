#!/usr/bin/env python3
# Prove two after-merge backbone reds before offering an owner-reviewed revert.
"""Prove two completed after-merge backbone failures on one commit from GitHub run/attempt evidence.

Job: run the backbone
Invariants: one suite, two distinct attempts, latest two observations red; a flip/grey never authorizes a revert.
Reuses the existing main-run identities and environment classifier; missing evidence refuses action.
"""
import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from tools.e2e_causes import classify  # noqa: E402
from tools.main_e2e_state import AFTER_MERGE, suite_of  # noqa: E402

WORKFLOW = '.github/workflows/e2e.yml'


def after_merge(run, sha):
    """True only for e2e.yml on main whose tested SHA agrees with the merge SHA in its title."""
    title = re.fullmatch(re.escape(AFTER_MERGE) + r'([0-9a-f]{7,40}) · (.+)', run.get('display_title', ''))
    return bool(title and sha.startswith(title[1]) and run.get('head_sha') == sha
                and run.get('head_branch') == 'main' and run.get('path') == WORKFLOW
                and run.get('event') == 'workflow_dispatch')


def job_state(job, log):
    """Run JSON job + failed-job log -> red/green/grey; only an actual suite failure is red."""
    if job.get('conclusion') == 'success':
        return 'green'
    if job.get('conclusion') != 'failure':
        return 'grey'
    failed = [step['name'] for step in job.get('steps', []) if step.get('conclusion') == 'failure']
    suite_step = lambda name: (name.startswith('Run the ') and ' suite' in name) or name.startswith('First try failed:')
    # Why (28 Oct 2026, owner): install/runner failures are health grey, not a red product check.
    if not failed or not all(suite_step(name) for name in failed):
        return 'grey'
    cause, detail = classify(log)
    # Why (28 Oct 2026, owner): health and red/green flips are not a breaking diff; an unreadable log proves nothing.
    return 'red' if detail and cause in ('check-failed', 'one-cause', 'timeout') else 'grey'


def suite_states(record, lanes):
    """One attempt -> active backbone suite states; incomplete shards and health evidence stay grey."""
    run = record['run']
    result = {}
    selected = set(run['display_title'].split(' · ', 2)[2].split(','))
    grouped = {}
    for job in record['jobs']:
        suite = suite_of(job['name'])
        # Why (28 Oct 2026, owner): tolerant, suspended and retired suites never authorize a revert.
        if suite not in selected or lanes.get(suite, {}).get('lane', 'backbone') != 'backbone':
            continue
        grouped.setdefault(suite, []).append(job_state(job, record.get('logs', {}).get(str(job.get('id')), '')))
    for suite in selected:
        if lanes.get(suite, {}).get('lane', 'backbone') != 'backbone':
            continue
        states = grouped.get(suite, ['grey'])
        names = {j['name'] for j in record['jobs'] if suite_of(j['name']) == suite}
        shards = [re.fullmatch(re.escape(suite) + r'-(\d+)of(\d+)', name) for name in names]
        if any(shards):
            count = int(next(m[2] for m in shards if m))
            if names != {f'{suite}-{n}of{count}' for n in range(1, count + 1)}:
                states = ['grey']
        # Why (28 Oct 2026, owner): absent or running evidence is health grey, never an old red's authorization.
        if run.get('status') != 'completed' or run.get('conclusion') not in ('success', 'failure'):
            states = ['grey']
        result[suite] = 'grey' if 'grey' in states else 'red' if 'red' in states else 'green'
    return result


def candidate(records, sha, lanes):
    """Recorded {run,jobs,logs} responses + tested SHA + registry suites -> revert proof or None.

    Reads the latest two observations of each backbone suite on this SHA; any red/green flip vetoes that suite.
    Multiple shards in one attempt count once. This does not count the retry steps inside a job as another workflow attempt.
    """
    if not re.fullmatch(r'[0-9a-f]{40}', sha):
        return None
    observations = {}
    seen = set()
    ordered = sorted(records, key=lambda record: (record['run'].get('run_started_at', ''), int(record['run']['id']), int(record['run'].get('run_attempt', 1))))
    for record in ordered:
        run = record['run']
        if not after_merge(run, sha):
            continue
        identity = f"{run['id']}/{run.get('run_attempt', 1)}"
        if identity in seen:
            continue
        seen.add(identity)
        for suite, state in suite_states(record, lanes).items():
            url = run.get('html_url', '') + f'/attempts/{run.get("run_attempt", 1)}'
            observations.setdefault(suite, []).append((state, identity, url))
    for suite, values in sorted(observations.items()):
        pair = values[-2:]
        # Why (28 Oct 2026, owner): a flip is a suspended check, even before the registry's suspension lands.
        known = [value[0] for value in values if value[0] != 'grey']
        flipped = any(a == 'red' and b == 'green' for a, b in zip(known, known[1:]))
        if not flipped and len(pair) == 2 and all(value[0] == 'red' for value in pair):
            return {'sha': sha, 'suite': suite, 'attempts': [value[1] for value in pair], 'urls': [value[2] for value in pair]}
    return None


def second_attempt_run(records, sha, lanes):
    """Return an after-merge run id with one completed red attempt, never a run already attempted twice.

    The caller validates that sha is main's current PR merge. Uses the same suite/health rules as candidate().
    """
    if not re.fullmatch(r'[0-9a-f]{40}', sha):
        return None
    attempts = {}
    for record in records:
        run = record['run']
        if after_merge(run, sha):
            attempts.setdefault(run['id'], set()).add(int(run.get('run_attempt', 1)))
    for record in records:
        run = record['run']
        # Why (29 Oct 2026, a8 on Gitar #2424): a lone backbone red requests its own second attempt, never a third.
        if after_merge(run, sha) and attempts[run['id']] == {1} and 'red' in suite_states(record, lanes).values():
            return run['id']
    return None


def gh_json(endpoint):
    """GitHub REST endpoint -> decoded response; API/JSON failures propagate and refuse a revert."""
    return json.loads(subprocess.run(['gh', 'api', endpoint], check=True, capture_output=True, encoding='utf-8').stdout)


def pages(endpoint, key, read):
    """Collect a REST list across pages (100/page); any read failure propagates, never a partial success."""
    out, page = [], 1
    while True:
        result = read(f'{endpoint}&per_page=100&page={page}')
        batch = result[key]
        out.extend(batch)
        total = result.get('total_count', len(out))
        # Why (28 Oct 2026, owner): partial evidence cannot prove main's red is still present.
        if not batch and len(out) < total:
            raise ValueError('incomplete paginated evidence')
        if len(out) >= total:
            return out
        page += 1


def collect(repo, sha, read=gh_json, log_of=None):
    """Fetch after-merge runs and each completed attempt's paginated jobs/logs; no retries or dispatches.

    A failed read/log aborts the proof. Historical attempts are read explicitly because GitHub lists only the latest attempt.
    """
    if log_of is None:
        def log_of(job):
            return subprocess.run(['gh', 'api', f'repos/{repo}/actions/jobs/{job["id"]}/logs'], check=True, capture_output=True, encoding='utf-8').stdout
    runs = pages(f'repos/{repo}/actions/workflows/e2e.yml/runs?branch=main&head_sha={sha}', 'workflow_runs', read)
    records = []
    for run in runs:
        if not after_merge(run, sha):
            continue
        for attempt in range(1, int(run.get('run_attempt', 1)) + 1):
            endpoint = f'repos/{repo}/actions/runs/{run["id"]}/attempts/{attempt}'
            metadata = read(endpoint)
            jobs = pages(f'{endpoint}/jobs?', 'jobs', read) if metadata.get('status') == 'completed' else []
            logs = {str(job['id']): log_of(job) for job in jobs if job.get('conclusion') == 'failure' and suite_of(job['name']) in run['display_title'].split(' · ', 2)[2].split(',')}
            records.append({'run': metadata, 'jobs': jobs, 'logs': logs})
    return records


def main(argv=None):
    """Validate current main and PR provenance, then print proof or request an owner-reviewed PR."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', default='GarryOne/jobadabra')
    parser.add_argument('--sha')
    parser.add_argument('--run', type=int)
    parser.add_argument('--runs-json', type=Path, help='offline recorded REST evidence (tests and dry-run)')
    parser.add_argument('--open', action='store_true', help='open the owner-reviewed revert PR once evidence passes')
    args = parser.parse_args(argv)
    root = Path(__file__).resolve().parent.parent
    try:
        if args.runs_json and (args.open or args.run):
            raise ValueError('offline evidence cannot authorize writes or live run lookups')
        sha = args.sha
        if args.run:
            run = gh_json(f'repos/{args.repo}/actions/runs/{args.run}')
            sha = run['head_sha']
            if not after_merge(run, sha):
                print('backbone-red: not an after-merge run of the tested commit; no revert')
                return 0
        if not sha or not re.fullmatch(r'[0-9a-f]{40}', sha):
            raise ValueError('a full tested SHA is required')
        snapshot = json.loads(args.runs_json.read_text(encoding='utf-8')) if args.runs_json else None
        head = snapshot['main'] if snapshot is not None else gh_json(f'repos/{args.repo}/commits/main')
        # Why (28 Oct 2026, owner): an old red must not undo work after main has moved on.
        if head['sha'] != sha:
            print('backbone-red: target is no longer the head of main; no revert')
            return 2 if args.sha else 0
        pulls = snapshot['pulls'] if snapshot is not None else gh_json(f'repos/{args.repo}/commits/{sha}/pulls?per_page=100')
        merged = [p for p in pulls if p.get('merged_at') and p.get('base', {}).get('ref') == 'main' and p.get('merge_commit_sha') == sha]
        # Why (28 Oct 2026, owner): revert the merged PR (including squash merges), never an unrelated commit.
        if len(merged) != 1:
            print('backbone-red: target is not the merge commit of one merged PR to main; no revert')
            return 2 if args.sha else 0
        data = snapshot['records'] if snapshot is not None else collect(args.repo, sha)
        raw = subprocess.run(['git', '-C', str(root), 'show', f'{sha}:desktop/e2e/lanes.json'], check=True, capture_output=True, encoding='utf-8').stdout
        registry = json.loads(raw)
        if registry.get('v') != 1 or not isinstance(registry.get('suites'), dict):
            raise ValueError('unreadable lane registry')
        proof = candidate(data, sha, registry['suites'])
        if not proof:
            retry = second_attempt_run(data, sha, registry['suites']) if args.open and snapshot is None else None
            if retry is not None:
                # Why (29 Oct 2026, a8 on Gitar #2424): the workflow token has actions:write; the App token is for the PR/branch writes.
                env = {**os.environ, 'GH_TOKEN': os.environ['RERUN_TOKEN']} if os.environ.get('RERUN_TOKEN') else None
                subprocess.run(['gh', 'run', 'rerun', str(retry), '--failed', '--repo', args.repo], check=True, env=env)
                print(f'backbone-red: one red on attempt 1; second attempt requested (run {retry})')
                return 0
            print('backbone-red: no same-suite red/red pair on this commit (flip, health, non-backbone or incomplete evidence)')
            return 2 if args.sha else 0
        proof['pr'] = merged[0]['number']
        print(json.dumps(proof), flush=True)
        if args.open:
            return subprocess.run(['bash', str(root / 'tools/revert-red.sh'), sha], cwd=root).returncode
        return 0
    except (OSError, ValueError, KeyError, subprocess.CalledProcessError) as error:
        print(f'backbone-red: evidence unreadable; no revert ({error})', file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
