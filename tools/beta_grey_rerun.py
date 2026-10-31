# Re-run a beta's grey backbone jobs once on fresh runners, using the current attempt's hold evidence.
# Invariants: no red, stale or missing proof may trigger a retry; attempt two only reports a hold.
import argparse
import io
import json
import subprocess
import zipfile


def gh(*args, binary=False):
    """Injectable transport for hold artifacts and the single failed-job re-run."""
    data = subprocess.run(['gh', *args], check=True, capture_output=True).stdout
    return data if binary else data.decode('utf-8')


def decision(attempt, reports):
    """Return rerun, held or stop; every available platform must prove this attempt has no red."""
    if attempt not in (1, 2) or not reports:
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
    return ('rerun' if attempt == 1 else 'held'), sorted(suites)


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
    if action == 'rerun':
        print('::notice::Beta held grey: re-running once on fresh runners: ' + ', '.join(suites))
        github('run', 'rerun', args.run, '--failed', '--repo', args.repo)
    elif action == 'held':
        print('::notice::Beta held: grey twice on fresh runners (' + ', '.join(suites) + '): the runner, not the app')
    else:
        print('No grey-only beta hold for this attempt; no automatic re-run.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
