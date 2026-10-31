# Re-run a beta's grey backbone jobs once each on fresh runners, using the current attempt's hold evidence.
# Invariants: no red, stale or missing proof may trigger a retry; a job re-runs at most once; GitHub re-runs one job of a run at a time, so one grey job
# re-runs per completed attempt and the next follows when that attempt ends; once every grey job has had its fresh runner, the beta is held.
import argparse
import io
import json
import subprocess
import zipfile


def gh(*args, binary=False):
    """Injectable transport for hold artifacts and the single annotation-proven job re-run."""
    data = subprocess.run(['gh', *args], check=True, capture_output=True).stdout
    return data if binary else data.decode('utf-8')


def decision(attempt, reports):
    """Return grey (with its suites) or stop; every available platform must prove this attempt has no red."""
    if attempt < 1 or not reports:
        return 'stop', []
    suites = set()
    for report in reports:
        if not isinstance(report, dict) or report.get('attempt') != attempt:
            return 'stop', []
        if any(not isinstance(report.get(key), list) or any(not isinstance(suite, str) for suite in report[key]) for key in ('grey', 'red')):
            return 'stop', []
        if report['red']:
            return 'stop', []
        suites.update(report['grey'])
    if not suites:
        return 'stop', []
    return 'grey', sorted(suites)


def hold_reports(repo, rid, github):
    """Read the one or two platform hold artifacts without extracting untrusted archive paths."""
    pages = json.loads(github('api', '--paginate', '--slurp', f'repos/{repo}/actions/runs/{rid}/artifacts?per_page=100'))
    reports = []
    for artifact in (artifact for page in pages for artifact in page['artifacts']):
        if artifact['name'] not in ('beta-held-mac', 'beta-held-windows'):
            continue
        data = github('api', f"repos/{repo}/actions/artifacts/{artifact['id']}/zip", binary=True)
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            reports.append(json.loads(archive.read('beta-held.json')))
    return reports


def grey_jobs(repo, rid, github):
    """The suite jobs (latest attempt of each, success or failure) that carry the shared grey proof annotation, as (job id, the attempt it ran in)."""
    try:
        from .beta_rate_gate import jobs_of, LANE_NAMES
        from .main_e2e_state import annotations_of, is_grey
    except ImportError:  # Direct workflow invocation.
        from beta_rate_gate import jobs_of, LANE_NAMES
        from main_e2e_state import annotations_of, is_grey
    prefixes = tuple(f'E2E · {lane} · ' for lane in LANE_NAMES.values())
    return sorted({(job['id'], job.get('run_attempt', 1)) for job in jobs_of(repo, rid, github)
                   if job.get('name', '').startswith(prefixes) and job.get('conclusion') in ('success', 'failure')
                   and is_grey(annotations_of(repo, job.get('id'), github))})


def main(argv=None, *, github=gh):
    """Handle one completed desktop run; only the first proven grey attempt starts fresh jobs."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', required=True)
    parser.add_argument('--run', required=True)
    parser.add_argument('--attempt', required=True, type=int)
    args = parser.parse_args(argv)
    try:
        action, suites = decision(args.attempt, hold_reports(args.repo, args.run, github))
    except (OSError, ValueError, KeyError, zipfile.BadZipFile, subprocess.CalledProcessError) as error:
        print(f'::notice::Beta grey proof unavailable ({type(error).__name__}); no automatic re-run')
        return 0
    if action == 'grey':
        jobs = grey_jobs(args.repo, args.run, github)
        if not jobs:
            print('::notice::No job carries the grey proof annotation; no automatic re-run')
            return 0
        # Why (31 Oct 2026, Gitar on #2665): GitHub refuses a second job re-run while the first one runs, so one job per completed attempt.
        fresh = [job_id for job_id, tried in jobs if tried == 1]
        if fresh:
            print(f'::notice::Beta held grey ({", ".join(suites)}): re-running job {fresh[0]} once on a fresh runner; '
                  f'{len(fresh) - 1} more grey job(s) follow, one per attempt')
            github('run', 'rerun', args.run, '--job', str(fresh[0]), '--repo', args.repo)
        else:
            print('::notice::Beta held: grey again on fresh runners (' + ', '.join(suites) + '): the runner, not the app')
    else:
        print('No grey-only beta hold for this attempt; no automatic re-run.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
